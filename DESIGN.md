# DESIGN.md - Live Code Execution & Management

## 1. Architecture Overview

### End-to-End Flow

1. **Code session creation**
- API: `POST /code-sessions`
- Persist a new `CodeSession` row with `ACTIVE` status and initial template source.

2. **Autosave behavior**
- API: `PATCH /code-sessions/:sessionId`
- Update source code, language, and increment session version.

3. **Execution request**
- API: `POST /code-sessions/:sessionId/run`
- Validate source size and run-rate limit.
- Create `Execution` with `QUEUED` status.
- Publish BullMQ job with `jobId = execution_id`.

4. **Background execution**
- Worker consumes queue message.
- Transition `QUEUED -> RUNNING`.
- Fetch session source, resolve language executor, execute in isolated temp dir.
- Enforce runtime/output/memory constraints.
- Transition to terminal state.

5. **Result polling**
- API: `GET /executions/:executionId`
- Return state and output fields (when terminal).

### Queue-based Design

- Redis-backed BullMQ queue decouples request/compute paths.
- API process only enqueues work; worker process executes code.
- Worker concurrency controlled via environment config.

### Execution Lifecycle

- Supported states:
  - `QUEUED`
  - `RUNNING`
  - `COMPLETED`
  - `FAILED`
  - `TIMEOUT`

- Allowed transitions:
  - `QUEUED -> RUNNING`
  - `RUNNING -> COMPLETED | FAILED | TIMEOUT`

- Execution events are persisted in `ExecutionEvent` for observability.

## 2. Reliability & Data Model

### Data Model

- **CodeSession**
  - `id`, `language`, `sourceCode`, `status`, `version`, timestamps

- **Execution**
  - `id`, `sessionId`, `status`, timing fields, `stdout`, `stderr`, `attemptCount`, error fields

- **ExecutionEvent**
  - transition history (`fromStatus`, `toStatus`, metadata, timestamp)

### Idempotency & Safe Reprocessing

- BullMQ job is created with deterministic `jobId = execution_id`.
- Processor checks current execution state first.
- Terminal state reprocessing is a no-op.
- Stale `RUNNING` detection increments attempt counter and allows safe reprocessing.

### Failure Handling

- Runtime-level failures map to:
  - `FAILED` for runtime/output/memory issues
  - `TIMEOUT` for execution timeout
- Errors are persisted with `errorType` and `errorMessage`.
- Queue retries are configurable (`QUEUE_ATTEMPTS`).

### Safety Controls

- Max source size (`MAX_SOURCE_BYTES`)
- Max runtime (`MAX_RUNTIME_MS`)
- Max output size (`MAX_OUTPUT_BYTES`)
- Memory monitoring using process RSS (`MAX_MEMORY_BYTES`)
- Run abuse limit per session over time window

## 3. Scalability Considerations

- Horizontal scale API and worker independently.
- Worker throughput tuned by:
  - queue depth
  - worker replicas
  - `WORKER_CONCURRENCY`
- Queue absorbs burst traffic and prevents API blocking.
- Potential bottlenecks:
  - hot sessions with frequent autosaves
  - DB contention on execution updates
  - worker CPU saturation under heavy code workloads

Mitigations:

- index execution lookup/filter fields
- tune queue concurrency and backoff
- add autosave coalescing/debounce upstream
- shard workers by language/runtime profile if needed

## 4. Trade-offs

### Chosen

- **Postgres + Redis**: stronger metadata model + async queue semantics.
- **Repository interfaces + Prisma impl**: testability and modularity.
- **MVP process sandbox**: practical and demonstrable within assignment constraints.

### Not Fully Production-ready Yet

- no container-per-run hard isolation yet
- no full distributed abuse detection
- no full dead-letter triage workflow
- no external metrics backend integration

### Optimization Priority

This implementation optimizes for **reliability + clean architecture** while keeping development speed suitable for take-home scope.
