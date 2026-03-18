# Live Code Execution Platform Design

This document describes the current design of the live code execution backend as implemented in this repository. The system is built as two NestJS applications:

- `apps/code-platform`: the HTTP API
- `apps/worker`: the asynchronous execution worker

Supporting infrastructure:

- PostgreSQL for durable application state
- Redis + BullMQ for queueing execution jobs

The design intentionally separates request handling from code execution so the API can remain responsive while untrusted user code is executed in the background.

## 1. Architecture Overview

### System Topology

```text
Client
  -> NestJS API (`apps/code-platform`)
    -> PostgreSQL (`CodeSession`, `Execution`, `ExecutionEvent`)
    -> Redis / BullMQ (`code-execution-runs`)

NestJS Worker (`apps/worker`)
  -> consumes BullMQ jobs
  -> loads latest session + execution state
  -> executes code in a temporary workspace
  -> writes terminal result back to PostgreSQL

Client
  -> polls API for execution result
```

### End-to-end Request Flow

#### Code session creation

Entry point:

- `POST /code-sessions`

Flow:

1. The API validates the request body with Nest validation pipes and DTOs.
2. The caller provides a `language` and may optionally provide `template_code`.
3. If `template_code` is omitted, the API inserts a default starter template for the selected language:
   - Python: `print('Hello World')`
   - JavaScript: `console.log('Hello World');`
4. The API enforces a maximum source-size limit before persistence.
5. A `CodeSession` row is created in PostgreSQL with:
   - a generated UUID
   - `ACTIVE` status
   - the initial source snapshot
   - `version = 1`
6. The API returns the new `session_id` immediately.

Design intent:

- keep the create flow very cheap
- ensure every later run operates on a persisted session snapshot
- establish a durable identifier that the frontend can reuse for autosave and execution

#### Autosave behavior

Entry point:

- `PATCH /code-sessions/:sessionId`

Flow:

1. The API validates the `sessionId` as a UUID.
2. The request body must contain `language` and `source_code`.
3. The API enforces the same source-size limit used at session creation time.
4. The repository updates the existing session:
   - replaces `language`
   - replaces `sourceCode`
   - increments `version`
   - updates `updatedAt`
5. If the session does not exist, the API returns `404 Not Found`.

Design intent:

- keep autosave idempotent at the HTTP layer from the client's perspective
- always store the latest source of truth in PostgreSQL
- avoid carrying large execution payloads through Redis jobs by letting the worker fetch the latest session state directly

#### Execution request

Entry point:

- `POST /code-sessions/:sessionId/run`

Flow:

1. The API loads the session from PostgreSQL.
2. It rejects the request if the session does not exist.
3. It revalidates the stored session source against `MAX_SOURCE_BYTES`.
4. It checks per-session run pressure by counting recent queued executions within `RUN_RATE_LIMIT_WINDOW_MS`.
5. If the recent run count is above `RUN_RATE_LIMIT_COUNT`, the API returns `429 Too Many Requests`.
6. The API creates a new `Execution` row with:
   - `status = QUEUED`
   - `queuedAt = now`
   - `attemptCount = 0`
7. In the same transactional flow, it records an `ExecutionEvent` for the initial `QUEUED` state.
8. The API publishes a BullMQ job with:
   - queue name: `code-execution-runs`
   - job name: `run-code`
   - job payload: `{ executionId }`
   - `jobId = executionId`
9. The API returns `202 Accepted` with the `execution_id`.

Design intent:

- the API never executes code inline
- every execution request becomes durable before queue publication
- the queue payload stays small and stable

#### Background execution

Entry point:

- BullMQ worker consuming `code-execution-runs`

Flow:

1. The worker receives a job containing `executionId`.
2. It loads the `Execution` row from PostgreSQL.
3. If the execution does not exist, the worker stops.
4. If the execution is already terminal, processing becomes a no-op.
5. If the execution is `QUEUED`, the worker attempts to atomically transition it to `RUNNING`.
   - this is done with a guarded database update: only `QUEUED` rows can become `RUNNING`
6. The worker records an `ExecutionEvent` for `QUEUED -> RUNNING`.
7. The worker loads the corresponding `CodeSession`.
8. If the session is missing, it finalizes the execution as `FAILED`.
9. The worker resolves the executor from the language registry.
10. The selected executor writes source code into a temporary working directory and spawns a child process:
    - Python executor uses the configured Python binary
    - JavaScript executor uses the configured Node binary
11. During execution, the worker enforces:
    - max runtime
    - max stdout/stderr size
    - max memory usage via RSS monitoring from `/proc/<pid>/status`
12. The worker maps runtime outcomes into one of the terminal states:
    - `COMPLETED`
    - `FAILED`
    - `TIMEOUT`
13. It finalizes the execution in PostgreSQL and records another `ExecutionEvent`.

Design intent:

- keep execution compute out of the API path
- protect state transitions with database-level conditions
- centralize result mapping in the worker so API behavior stays simple and predictable

#### Result polling

Entry point:

- `GET /executions/:executionId`

Flow:

1. The API validates the `executionId`.
2. It loads the `Execution` row from PostgreSQL.
3. If the row does not exist, it returns `404 Not Found`.
4. It always returns status and timestamps.
5. It only returns `stdout`, `stderr`, and `execution_time_ms` once the execution is terminal.

Design intent:

- polling is simple for any client to implement
- all state is durable, so polling is cheap and safe even across API restarts
- the API does not need to keep long-lived connections open

### Queue-based Execution Design

The queue is the boundary between "request accepted" and "code actually running."

Core properties of the current design:

- The API publishes jobs to Redis using BullMQ.
- The worker consumes jobs independently of the API.
- Queue settings support retries via `attempts` and exponential backoff.
- Queue job IDs are deterministic: `jobId = executionId`.
- The queue payload contains only the execution identifier, not the source code itself.

Why this matters:

- request latency stays short even when executions are slow
- workers can scale horizontally without changing API behavior
- retries happen at the job level while execution state remains durable in PostgreSQL
- clients receive an immediate acknowledgement instead of waiting for code execution

### Execution Lifecycle and State Management

The system currently supports this execution lifecycle:

```text
QUEUED -> RUNNING -> COMPLETED
                  -> FAILED
                  -> TIMEOUT
```

State definitions:

- `QUEUED`: execution record exists and is waiting to be processed
- `RUNNING`: a worker has claimed the execution and started processing it
- `COMPLETED`: child process exited successfully
- `FAILED`: execution ended with a runtime failure, missing dependency/state, or internal error
- `TIMEOUT`: execution exceeded the configured runtime limit

Transition rules:

- `QUEUED -> RUNNING`
- `RUNNING -> COMPLETED`
- `RUNNING -> FAILED`
- `RUNNING -> TIMEOUT`

Terminal states:

- `COMPLETED`
- `FAILED`
- `TIMEOUT`

The repository and worker design enforce lifecycle correctness in two ways:

- only `QUEUED` executions can be claimed as `RUNNING`
- only `RUNNING` executions can be finalized to a terminal state

`ExecutionEvent` rows provide an auditable history of those transitions.

## 2. Reliability & Data Model

### Data Model

#### `CodeSession`

Purpose:

- stores the durable source-of-truth snapshot for a live coding session

Important fields:

- `id`
- `language`
- `sourceCode`
- `status`
- `version`
- `createdAt`
- `updatedAt`

Key design note:

- the latest source is always loaded from PostgreSQL at execution time, which avoids trusting stale client-side state

#### `Execution`

Purpose:

- stores a single run attempt against a session

Important fields:

- `id`
- `sessionId`
- `status`
- `queuedAt`
- `startedAt`
- `completedAt`
- `stdout`
- `stderr`
- `executionTimeMs`
- `attemptCount`
- `errorType`
- `errorMessage`

Key design note:

- `Execution` is the durable lifecycle record that the API polls and the worker updates

#### `ExecutionEvent`

Purpose:

- stores transition history and optional metadata for observability

Important fields:

- `executionId`
- `fromStatus`
- `toStatus`
- `at`
- `metadataJson`

Key design note:

- transition history is intentionally modeled separately so operators can inspect lifecycle behavior without overloading the main execution row

### Execution States

The current state machine is:

```text
QUEUED -> RUNNING -> COMPLETED / FAILED / TIMEOUT
```

This is intentionally simple.

What it optimizes for:

- clear lifecycle semantics
- predictable client polling behavior
- easy worker-side reasoning
- straightforward persistence logic

What it does not attempt yet:

- paused executions
- cancellation
- partial progress reporting
- manual replay states

### Idempotency Handling

The current design includes multiple layers of idempotency and duplicate-protection behavior.

#### Preventing duplicate execution runs

What is implemented:

- each execution request creates a unique `Execution` row
- the BullMQ job uses `jobId = executionId`
- the worker claims work by transitioning `QUEUED -> RUNNING` with a guarded database update

Why this helps:

- if the same queue job is retried or re-delivered, only one worker can successfully claim a still-queued execution
- if another worker sees the same execution after it is already terminal, it exits without re-running the code

Important nuance:

- this does not deduplicate two separate user requests to `/run`
- if a user intentionally calls `POST /code-sessions/:sessionId/run` twice, the system will create two separate `Execution` rows
- that is currently a product decision, not a bug

#### Safe reprocessing of jobs

The worker is written to make job reprocessing safe:

- if an execution is already in a terminal state, processing is a no-op
- if an execution is still `QUEUED`, the worker can safely claim it
- finalization only succeeds when the execution is still `RUNNING`

This means retries are safe because the database state is the real source of truth, not the queue job alone.

There is also basic stale-execution handling:

- if the worker finds an execution already in `RUNNING`
- and its `startedAt` is older than `WORKER_STALE_EXECUTION_MS`
- the worker increments `attemptCount` and continues processing

That provides a basic path for safe reprocessing after worker interruption, although it is still a relatively lightweight recovery model.

### Failure Handling

#### Retries

Retries are managed at the queue layer:

- BullMQ `attempts` is configurable through `QUEUE_ATTEMPTS`
- exponential backoff is configured with an initial delay of 500 ms

Operationally, that means transient worker failures can cause BullMQ to redeliver the same execution job.

Because execution state is stored in PostgreSQL and transitions are guarded, retries do not automatically imply duplicate execution side effects at the state-machine level.

#### Error states

The worker normalizes runtime outcomes into durable states:

- `TIMEOUT`
  - execution exceeded `MAX_RUNTIME_MS`
- `FAILED`
  - runtime error
  - memory limit exceeded
  - output limit exceeded
  - session missing
  - internal execution error
- `COMPLETED`
  - process exited successfully

The execution row stores:

- `errorType`
- `errorMessage`
- `stdout`
- `stderr`
- `executionTimeMs`

This gives clients and operators enough data to distinguish between application-level failures and infrastructure-level failures.

#### Dead-letter or failed execution handling

What exists today:

- BullMQ retries failed jobs
- worker failures are logged through `ExecutionLifecycleLogger`
- execution rows keep terminal failure details

What does not exist yet:

- a dedicated dead-letter queue
- an operator workflow for replaying poisoned jobs
- automated triage for jobs that repeatedly fail without reaching a useful terminal state

So the current design has failed-execution persistence, but not a full dead-letter management subsystem.

### Additional Reliability Controls

The implementation includes a few explicit controls to reduce abuse and runaway workloads:

- max source size: `MAX_SOURCE_BYTES`
- max runtime: `MAX_RUNTIME_MS`
- max output size: `MAX_OUTPUT_BYTES`
- max memory usage: `MAX_MEMORY_BYTES`
- per-session run rate limit:
  - `RUN_RATE_LIMIT_COUNT`
  - `RUN_RATE_LIMIT_WINDOW_MS`

These limits are not a complete security model, but they do provide a meaningful first layer of protection.

## 3. Scalability Considerations

### Handling Many Concurrent Live Coding Sessions

The design is well suited to many active editing sessions because:

- autosave writes only update a single session row
- execution requests are asynchronous
- the API does not hold compute-heavy work in memory while serving HTTP

This means session count and execution throughput can scale somewhat independently.

Likely scaling pressures under many live sessions:

- high write volume from frequent autosaves
- large numbers of queued executions during spikes
- database contention on execution status updates
- worker CPU and memory saturation when many jobs run concurrently

### Horizontal Scaling of Workers

The worker tier is horizontally scalable by design.

Reasons:

- work is pulled from a shared Redis queue
- execution state lives in PostgreSQL rather than worker memory
- queue claims and execution finalization are coordinated through durable state transitions

Scaling knobs:

- add more worker replicas
- increase or decrease `WORKER_CONCURRENCY`
- separate workers by runtime profile in the future if some languages are heavier than others

The current design is therefore much more scalable than a single-process API executor.

### Queue Backlog Handling

A queue backlog is the expected mechanism for absorbing bursts.

What the current design already does well:

- accepts requests quickly and durably
- lets backlog accumulate in Redis instead of overloading API request threads
- processes jobs according to worker capacity
- retries transient failures automatically

What backlog growth still means operationally:

- higher user-visible latency between `QUEUED` and `RUNNING`
- more database churn as status checks and transitions pile up
- greater memory and CPU pressure on workers when concurrency is increased too aggressively

Practical mitigation strategies:

- add more worker replicas
- tune `WORKER_CONCURRENCY`
- tune retry attempts and backoff
- reduce unnecessary run requests through client-side debouncing or UX constraints
- introduce backlog-aware admission control if queue depth becomes too large

### Potential Bottlenecks and Mitigation Strategies

#### 1. PostgreSQL write contention

Why it can bottleneck:

- autosaves update sessions frequently
- execution state transitions create multiple writes per run
- `ExecutionEvent` creates extra audit rows

Mitigations:

- keep indexes focused on hot access patterns
- batch or coalesce autosaves upstream when possible
- review transaction scope under production load
- partition or archive historical execution data if volume grows substantially

#### 2. Redis queue depth and memory pressure

Why it can bottleneck:

- bursty run traffic can outpace worker throughput
- retries can amplify queue occupancy

Mitigations:

- scale worker replicas horizontally
- tune retry counts and backoff
- add monitoring for queue depth and job age
- introduce traffic shaping or per-tenant fairness later if needed

#### 3. Worker host resource saturation

Why it can bottleneck:

- code execution is CPU- and memory-sensitive
- concurrency that is too high can degrade throughput instead of improving it

Mitigations:

- keep `WORKER_CONCURRENCY` conservative relative to host capacity
- isolate workers by machine size or runtime profile
- add per-language scheduling if runtimes diverge materially

#### 4. Polling load on the API

Why it can bottleneck:

- large numbers of clients polling frequently can create many lightweight reads

Mitigations:

- add caching or short poll intervals with jitter
- move to SSE or WebSockets in a later version
- provide richer execution status responses so clients can poll less aggressively

## 4. Trade-offs

### Technology Choices and Why

#### NestJS

Why chosen:

- structured modular backend architecture
- strong fit for DTO validation and controller/service separation
- familiar developer ergonomics for TypeScript services

Trade-off:

- more framework structure than a lightweight custom service
- some extra ceremony for a relatively small backend

#### PostgreSQL + Prisma

Why chosen:

- durable relational model fits sessions, executions, and transition events well
- Prisma provides migrations and typed queries
- a relational store is a better source of truth for lifecycle state than Redis alone

Trade-off:

- every execution lifecycle step now depends on database availability
- more operational overhead than an in-memory prototype

#### Redis + BullMQ

Why chosen:

- mature async queue model for Node.js
- built-in retry and backoff behavior
- clean decoupling between API and worker

Trade-off:

- introduces another infrastructure dependency
- queue semantics and durable state semantics must be kept in sync carefully

#### Process-based executors

Why chosen:

- fast to implement
- easy to reason about
- good enough to demonstrate async execution, output capture, and resource limits

Trade-off:

- weaker isolation than container-per-execution or VM-based sandboxing
- Linux-specific memory monitoring through `/proc`
- not strong enough for hostile multi-tenant production workloads

### What the Current Design Optimizes For

The current design mainly optimizes for:

- simplicity
- correctness of the execution lifecycle
- clear separation of responsibilities
- decent reliability under retry and worker restart scenarios
- fast iteration speed for an assignment-scale or MVP backend

It is not primarily optimized for:

- strongest possible sandbox security
- lowest possible infrastructure cost
- sub-second real-time push updates
- multi-region or multi-tenant production operations

In other words, the design intentionally leans toward:

- simplicity over maximum sophistication
- reliability over raw execution speed
- operational clarity over feature breadth

### Production Readiness Gaps

The current system is solid as an MVP backend, but several gaps remain before calling it production-ready for untrusted code execution at scale.

#### 1. Sandbox strength

Gap:

- execution runs as a child process with resource guards, not as a fully isolated sandbox

Impact:

- insufficient hard isolation for hostile workloads

#### 2. Dead-letter and replay operations

Gap:

- no dedicated dead-letter queue or operator replay tooling

Impact:

- repeated poison jobs are harder to inspect and remediate systematically

#### 3. Distributed abuse protection

Gap:

- run rate limiting is per session and backed by application logic, not a stronger distributed abuse-control layer

Impact:

- weaker protection against broad traffic abuse or coordinated misuse

#### 4. Real-time client updates

Gap:

- polling is the only status-delivery mechanism

Impact:

- extra read load and a less responsive UX under heavy usage

#### 5. Operational observability

Gap:

- there is lifecycle logging, but no full metrics/tracing platform integrated yet

Impact:

- harder to reason about queue age, runtime distribution, failure classes, and worker saturation in production

#### 6. Infrastructure consistency and deployment hardening

Gap:

- the current setup is still closer to a strong development/deployment baseline than a fully hardened production platform

Impact:

- more work is needed around deployment validation, image hardening, and runtime policy enforcement

## Summary

The current design is a durable, queue-based live code execution backend with:

- clear separation between API and worker responsibilities
- a small but well-defined execution state machine
- durable lifecycle persistence in PostgreSQL
- retry-safe queue processing through guarded state transitions
- resource-limited child-process execution for Python and JavaScript

It is a strong MVP architecture because it balances simplicity, correctness, and extensibility. The main gaps are the same ones commonly seen in early execution platforms: stronger sandboxing, richer operations tooling, better backlog visibility, and more production-grade failure handling.
