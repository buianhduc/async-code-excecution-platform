# Live Code Execution Platform

This repository contains a two-process NestJS backend for collaborative code sessions and asynchronous code execution. The system lets a client create a session, autosave code edits, enqueue a run request, and poll for the resulting execution state.

The current implementation is intentionally split into:

- an API application in `apps/code-platform`
- a background worker in `apps/worker`
- PostgreSQL for persistent session and execution metadata
- Redis + BullMQ for queueing execution jobs

Python and JavaScript execution are both implemented end to end. Neither runtime is executed in its own dedicated container today, but each execution still runs inside an engine-specific isolated environment: Python uses a fresh temporary workspace plus `python -I`, and JavaScript uses a dedicated `isolated-vm` isolate for each run.

## Table of Contents

- [System Overview](#system-overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Setup Instructions](#setup-instructions)
- [Environment Variables](#environment-variables)
- [API Documentation](#api-documentation)
- [Execution Lifecycle](#execution-lifecycle)
- [Design Decisions and Trade-offs](#design-decisions-and-trade-offs)
- [Testing and Verification](#testing-and-verification)
- [What I Would Improve with More Time](#what-i-would-improve-with-more-time)

## System Overview

The main product flow is:

1. A client creates a live coding session with a selected language.
2. The client keeps autosaving the latest source code into that session.
3. The client requests a run for the current version of the session.
4. The API stores an `Execution` record in `QUEUED` state and pushes a BullMQ job into Redis.
5. The worker consumes the queue, loads the latest session source from PostgreSQL, executes it, and writes the terminal result back to PostgreSQL.
6. The client polls the execution endpoint until the result reaches a terminal state.

This is a queue-first design. The API never executes user code directly inside the request/response cycle.

## Architecture

### High-level Diagram

```text
                                   +-------------------+
                                   |     Swagger UI    |
                                   |      /docs        |
                                   +---------+---------+
                                             |
                                             v
+-----------+        HTTP        +---------------------------+
|  Client   +------------------->+  NestJS API Application   |
|  / Frontend|                   |  apps/code-platform       |
+-----------+                    +------------+--------------+
                                              |\
                                              | \
                                  PostgreSQL  |  \ Redis / BullMQ
                                              |   \
                                              v    v
                                   +----------+--+ +-------------------+
                                   |  Postgres   | |   Run Queue       |
                                   | CodeSession | | execution_id jobs  |
                                   | Execution   | +---------+---------+
                                   | ExecutionEvent|          |
                                   +-------------+-+          |
                                                 ^            v
                                                 |   +----------------------+
                                                 +---+ NestJS Worker App    |
                                                     | apps/worker          |
                                                     | - dequeue job        |
                                                     | - load session       |
                                                     | - run executor       |
                                                     | - persist result     |
                                                     +----------+-----------+
                                                                |
                                                                v
                                                     +----------------------+
                                                     | Temp workspace       |
                                                     | child process run    |
                                                     | Python / JS executor |
                                                     +----------------------+
```

### Component Responsibilities

#### API application: `apps/code-platform`

Responsible for:

- request validation with NestJS pipes and DTOs
- code session creation and autosave
- run eligibility checks such as source size and per-session rate limiting
- creation of `Execution` records in PostgreSQL
- publishing jobs into BullMQ
- exposing polling and health endpoints
- exposing Swagger documentation at `/docs`

#### Worker application: `apps/worker`

Responsible for:

- consuming run jobs from Redis
- transitioning execution state from `QUEUED` to `RUNNING`
- loading the latest session source from PostgreSQL
- selecting the appropriate executor for the session language
- enforcing runtime, memory, and output limits during execution
- persisting terminal execution state and failure metadata

#### PostgreSQL

Stores durable application state:

- `CodeSession`
- `Execution`
- `ExecutionEvent`

This makes the API and worker stateless with respect to execution lifecycle coordination.

#### Redis + BullMQ

Acts as the async boundary between the request path and the compute path:

- absorbs bursty run traffic
- allows the worker pool to scale independently of the API
- supports retries and backoff without blocking HTTP requests

## Project Structure

```text
apps/
  code-platform/
    src/
      code-sessions/    # create, autosave, run endpoints
      executions/       # execution polling endpoint
      queue/            # BullMQ producer and queue wiring
      database/         # Prisma access and repository implementations
      health/           # liveness endpoint
      observability/    # execution lifecycle logging
      config/           # typed API config access
  worker/
    src/
      runner/           # queue worker, processor, language executors
      database/         # Prisma access and repository implementations
      queue/            # Redis connection and shared queue constants
      observability/    # worker-side lifecycle logging
      config/           # typed worker config access
prisma/
  schema.prisma         # relational model
  migrations/           # DB migrations
docker/
  postgres/init.sql     # Postgres initialization
docker-compose.yml      # local multi-service environment
Dockerfile.backend      # API image build
Dockerfile.worker       # worker image build
Dockerfile.postgres     # Postgres image build
DESIGN.md               # design notes
```

## Setup Instructions

There are two practical ways to run the project locally:

- full containerized startup with Docker Compose
- API and worker running directly on the host, with PostgreSQL and Redis available locally

### Prerequisites

You will need:

- Node.js 22+
- npm
- PostgreSQL 16+ or Docker
- Redis 7+ or Docker
- Python 3 available on the machine that runs the worker

### Option A: Run Everything with Docker Compose

This is the simplest path if you want the full system, including PostgreSQL, Redis, API, and worker, started together.

```bash
docker compose up --build
```

The compose stack starts:

- `postgres`
- `redis`
- `api`
- `worker`

Default exposed ports:

- API: `3000`
- PostgreSQL: `5432`
- Redis: `6379`

Once the stack is healthy:

- health check: `http://localhost:3000/health`
- Swagger docs: `http://localhost:3000/docs`

### Option B: Run API and Worker Directly on Your Machine

#### 1. Install dependencies

```bash
npm install
```

#### 2. Start PostgreSQL and Redis

If you already have them installed locally, make sure they are reachable using your configured connection details.

If you only want infrastructure from Docker, you can start just those services:

```bash
docker compose up -d postgres redis
```

#### 3. Set environment variables

The project reads environment variables through Nest's `ConfigModule`. There is no committed `.env.example` in the repo right now, so create a local `.env` file or export variables in your shell.

Example local configuration:

```bash
PORT=3000
DATABASE_URL=postgresql://code_platform_user:code_platform_password@localhost:5432/code_platform?schema=public
REDIS_HOST=localhost
REDIS_PORT=6379
WORKER_CONCURRENCY=4
WORKER_STALE_EXECUTION_MS=30000
MAX_SOURCE_BYTES=50000
MAX_OUTPUT_BYTES=50000
MAX_RUNTIME_MS=5000
MAX_MEMORY_BYTES=134217728
RUN_RATE_LIMIT_COUNT=10
RUN_RATE_LIMIT_WINDOW_MS=60000
QUEUE_ATTEMPTS=3
PYTHON_BIN=python3
```

#### 4. Generate the Prisma client

```bash
npm run prisma:generate
```

#### 5. Apply database migrations

The repository uses:

```bash
npm run prisma:migrate
```

That script runs `prisma migrate deploy`, which applies checked-in migrations to the configured database.

#### 6. Start the API

```bash
npm run start:dev
```

The default Nest app is the `code-platform` API project.

#### 7. Start the worker in a second terminal

```bash
npm run start:worker:dev
```

The API and the worker are separate processes and both must be running for execution requests to complete.

### Local Smoke Test

After starting the stack, the quickest manual verification flow is:

1. `POST /code-sessions`
2. `PATCH /code-sessions/:sessionId`
3. `POST /code-sessions/:sessionId/run`
4. `GET /executions/:executionId`

If you submit Python code such as `print("hello")` or JavaScript code such as `console.log("hello")`, the polled execution should eventually move to `COMPLETED` with `stdout` populated.

## Environment Variables

### API process

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port for the API service |
| `DATABASE_URL` | none | Prisma/PostgreSQL connection string |
| `REDIS_HOST` | `localhost` | Redis host for BullMQ |
| `REDIS_PORT` | `6379` | Redis port for BullMQ |
| `WORKER_CONCURRENCY` | `4` | Used by queue-related config and relevant to deployment sizing |
| `WORKER_STALE_EXECUTION_MS` | `30000` | Stale running execution threshold |
| `MAX_SOURCE_BYTES` | `50000` | Maximum request/session source size accepted by the API |
| `MAX_OUTPUT_BYTES` | `50000` | Shared output limit used during execution |
| `MAX_RUNTIME_MS` | `5000` | Shared runtime limit used during execution |
| `MAX_MEMORY_BYTES` | `134217728` | Shared RSS memory ceiling used during execution |
| `RUN_RATE_LIMIT_COUNT` | `11` in code, `10` in compose | Max recent runs allowed per session in the configured window |
| `RUN_RATE_LIMIT_WINDOW_MS` | `60000` | Size of the per-session run rate-limit window |
| `QUEUE_ATTEMPTS` | `3` | BullMQ retry attempts |
| `PYTHON_BIN` | `python3` | Python interpreter path passed to the executor |

### Worker process

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | none | Prisma/PostgreSQL connection string |
| `REDIS_HOST` | `localhost` | Redis host for BullMQ worker |
| `REDIS_PORT` | `6379` | Redis port for BullMQ worker |
| `WORKER_CONCURRENCY` | `4` | Number of jobs processed concurrently |
| `WORKER_STALE_EXECUTION_MS` | `30000` | Time after which a `RUNNING` job may be considered stale |
| `MAX_OUTPUT_BYTES` | `50000` | Max combined stdout/stderr bytes per stream before aborting |
| `MAX_RUNTIME_MS` | `5000` | Max child process runtime |
| `MAX_MEMORY_BYTES` | `134217728` | Max observed resident memory for the child process |
| `PYTHON_BIN` | `python3` | Python interpreter binary for the Python executor |

## API Documentation

Swagger is available at:

```text
http://localhost:3000/docs
```

The sections below summarize the current REST contract implemented in code.

### Common Enums

#### Supported languages

```json
["PYTHON", "JAVASCRIPT"]
```

Important implementation note:

- `PYTHON` is executed in a fresh temporary workspace by spawning `python -I`.
- `JAVASCRIPT` is executed inside a dedicated `isolated-vm` isolate per run.
- neither language currently gets a container-per-execution sandbox; isolation is provided by the language runtime strategy plus the worker’s runtime, output, and memory controls.

#### Execution statuses

```json
["QUEUED", "RUNNING", "COMPLETED", "FAILED", "TIMEOUT"]
```

#### Session statuses

```json
["ACTIVE"]
```

### `GET /health`

Simple liveness endpoint.

#### Response: `200 OK`

```json
{
  "status": "ok",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `POST /code-sessions`

Creates a new code session and seeds it with either caller-provided template code or a language default.

#### Request body

```json
{
  "language": "PYTHON",
  "template_code": "print('Hello World')\n"
}
```

#### Validation rules

- `language` is required and must be one of `PYTHON` or `JAVASCRIPT`
- `template_code` is optional
- `template_code` must be a string when provided
- `template_code` is capped at 50,000 characters by DTO validation
- the service also enforces a byte-size limit using `MAX_SOURCE_BYTES`

#### Behavior

- if `template_code` is omitted, the API injects a language-specific default:
  - Python: `print('Hello World')`
  - JavaScript: `console.log('Hello World');`
- a `CodeSession` row is created with status `ACTIVE`

#### Response: `200 OK`

```json
{
  "session_id": "2f42721f-6f87-48c3-bf31-2d45982d4c6d",
  "status": "ACTIVE"
}
```

### `PATCH /code-sessions/:sessionId`

Autosaves the current code for an existing session.

#### Path params

- `sessionId`: UUID

#### Request body

```json
{
  "language": "PYTHON",
  "source_code": "print('updated source')\n"
}
```

#### Validation rules

- `sessionId` must be a valid UUID
- `language` is required and must be a supported enum value
- `source_code` is required
- `source_code` must be a string
- `source_code` is capped at 50,000 characters by DTO validation
- the service also enforces a byte-size limit using `MAX_SOURCE_BYTES`

#### Behavior

- updates `language`
- updates `sourceCode`
- increments the session version in the repository implementation
- refreshes `updatedAt`

#### Response: `200 OK`

```json
{
  "session_id": "2f42721f-6f87-48c3-bf31-2d45982d4c6d",
  "status": "ACTIVE",
  "updated_at": "2026-03-18T08:15:30.000Z"
}
```

#### Possible error cases

- `404 Not Found` if the session does not exist
- `413 Payload Too Large` if the source exceeds `MAX_SOURCE_BYTES`
- `400 Bad Request` if validation fails

### `POST /code-sessions/:sessionId/run`

Creates an execution record and enqueues asynchronous execution.

#### Path params

- `sessionId`: UUID

#### Request body

No body is required.

#### Pre-run checks

Before queueing, the API verifies:

- the session exists
- the stored source code still respects `MAX_SOURCE_BYTES`
- the number of recent queued executions for that session does not exceed the configured rate limit window

#### Behavior

- persists a new `Execution` row with status `QUEUED`
- enqueues a BullMQ job whose `jobId` is the execution UUID
- returns immediately without waiting for actual code execution

#### Response: `202 Accepted`

```json
{
  "execution_id": "b8d2f81f-7f2b-4c33-8d76-c8dfe1a9ab0d",
  "status": "QUEUED"
}
```

#### Possible error cases

- `404 Not Found` if the session does not exist
- `413 Payload Too Large` if the stored source exceeds `MAX_SOURCE_BYTES`
- `429 Too Many Requests` if the per-session run rate limit is exceeded
- `400 Bad Request` if `sessionId` is not a UUID

### `GET /executions/:executionId`

Returns the current execution state and, once terminal, the captured output and timing metadata.

#### Path params

- `executionId`: UUID

#### Response while still queued

```json
{
  "execution_id": "b8d2f81f-7f2b-4c33-8d76-c8dfe1a9ab0d",
  "status": "QUEUED",
  "queued_at": "2026-03-18T08:16:00.000Z"
}
```

#### Response while running

```json
{
  "execution_id": "b8d2f81f-7f2b-4c33-8d76-c8dfe1a9ab0d",
  "status": "RUNNING",
  "queued_at": "2026-03-18T08:16:00.000Z",
  "started_at": "2026-03-18T08:16:01.000Z"
}
```

#### Response after completion

```json
{
  "execution_id": "b8d2f81f-7f2b-4c33-8d76-c8dfe1a9ab0d",
  "status": "COMPLETED",
  "stdout": "hello\n",
  "stderr": "",
  "execution_time_ms": 21,
  "queued_at": "2026-03-18T08:16:00.000Z",
  "started_at": "2026-03-18T08:16:01.000Z",
  "completed_at": "2026-03-18T08:16:01.021Z"
}
```

#### Response after failure

```json
{
  "execution_id": "b8d2f81f-7f2b-4c33-8d76-c8dfe1a9ab0d",
  "status": "FAILED",
  "stdout": "",
  "stderr": "Traceback ...",
  "execution_time_ms": 18,
  "queued_at": "2026-03-18T08:16:00.000Z",
  "started_at": "2026-03-18T08:16:01.000Z",
  "completed_at": "2026-03-18T08:16:01.018Z",
  "error_type": "RUNTIME_ERROR",
  "error_message": "Process exited with code 1."
}
```

#### Response after timeout

```json
{
  "execution_id": "b8d2f81f-7f2b-4c33-8d76-c8dfe1a9ab0d",
  "status": "TIMEOUT",
  "stdout": "",
  "stderr": "",
  "execution_time_ms": 5000,
  "queued_at": "2026-03-18T08:16:00.000Z",
  "started_at": "2026-03-18T08:16:01.000Z",
  "completed_at": "2026-03-18T08:16:06.000Z",
  "error_type": "TIMEOUT",
  "error_message": "Execution exceeded configured runtime limit."
}
```

#### Possible error cases

- `404 Not Found` if the execution does not exist
- `400 Bad Request` if `executionId` is not a UUID

## Execution Lifecycle

The worker uses a constrained state machine:

```text
QUEUED -> RUNNING -> COMPLETED
                  -> FAILED
                  -> TIMEOUT
```

### Data model

#### `CodeSession`

Stores:

- selected language
- latest source code snapshot
- session status
- optimistic version counter
- timestamps

#### `Execution`

Stores:

- owning `sessionId`
- lifecycle status
- queue/start/finish timestamps
- stdout and stderr
- duration
- retry attempt count
- normalized error metadata

#### `ExecutionEvent`

Stores:

- `fromStatus`
- `toStatus`
- event timestamp
- optional metadata payload

This gives the system an audit trail of execution transitions without overloading the main execution row.

### Worker execution flow

1. Worker receives a BullMQ job carrying `executionId`.
2. It loads the execution record from PostgreSQL.
3. If the execution is already terminal, processing becomes a no-op.
4. If status is `QUEUED`, the worker attempts an atomic transition to `RUNNING`.
5. It loads the owning session and the latest saved source.
6. It resolves a language-specific executor through the registry.
7. The executor runs code inside a language-specific isolated execution environment.
8. The processor maps raw runtime results into domain statuses:
   - `COMPLETED`
   - `FAILED`
   - `TIMEOUT`
9. The terminal state is written back to PostgreSQL.
10. Execution transition events are recorded for observability.

### Runtime controls

The current execution layer enforces several controls:

- Python runs in a fresh temporary workspace for each execution
- Python uses isolated mode via `python3 -I`
- JavaScript runs in a fresh `isolated-vm` isolate for each execution
- runtime timeout limits are enforced per execution
- stdout/stderr size is capped
- memory usage is constrained and monitored by the execution engine or worker
- temporary execution artifacts are cleaned up after Python runs

These controls are materially better than executing user code inline in the API process, but they are still not equivalent to full container-per-execution sandboxing for hostile multi-tenant workloads.

## Design Decisions and Trade-offs

### 1. Separate API and worker processes

#### Decision

The API and execution engine are deployed as two Nest applications.

#### Why

- keeps HTTP latency independent from code execution latency
- isolates queue consumers from request-serving concerns
- makes it possible to scale API replicas and worker replicas separately

#### Trade-off

- introduces cross-process coordination complexity
- requires both Redis and PostgreSQL even for local development
- makes debugging slightly more involved than a single-process prototype

### 2. Queue-first execution model with BullMQ

#### Decision

Execution requests are always persisted then enqueued.

#### Why

- creates a durable execution lifecycle
- supports retries and backoff
- prevents the API from blocking on user code
- absorbs spikes in execution demand

#### Trade-off

- clients need to poll rather than receive an immediate result
- eventual consistency appears between "run requested" and "worker started"

### 3. PostgreSQL as the system of record

#### Decision

Redis is only used for queueing. PostgreSQL owns the durable domain state.

#### Why

- relational data is a good fit for sessions, executions, and execution events
- durable storage survives worker restarts and queue retries
- Prisma gives a typed data-access layer and migration workflow

#### Trade-off

- every major lifecycle transition touches the database
- high execution volume will eventually require more deliberate indexing, partitioning, and write-tuning

### 4. Repository abstractions over Prisma

#### Decision

Both applications work through repository interfaces rather than reaching into Prisma directly from every service.

#### Why

- makes services easier to unit test
- keeps domain logic separate from persistence implementation details
- supports clean in-memory test doubles, as shown in the e2e-style tests

#### Trade-off

- adds some abstraction overhead
- creates duplicate repository wiring in API and worker apps

### 5. Polling instead of push-based updates

#### Decision

Clients poll `GET /executions/:executionId` for status updates.

#### Why

- trivial to consume from any frontend or client
- easy to document and test
- avoids extra websocket or SSE infrastructure in the first version

#### Trade-off

- more repeated requests from clients
- slower perceived freshness compared with real-time push channels

### 6. Runtime isolation instead of container-per-run sandboxing

#### Decision

The current runtime uses engine-level isolation rather than a dedicated container per execution:

- Python uses a spawned process in a fresh temp directory with `python -I`
- JavaScript uses a dedicated `isolated-vm` isolate

#### Why

- significantly simpler to implement in a take-home style environment
- demonstrates the execution lifecycle and safety thinking
- keeps the implementation inspectable and testable
- still provides per-execution isolation within each runtime even without containerization

#### Trade-off

- weaker isolation than a dedicated container or VM per run
- the Python path still depends on OS process behavior and `/proc`-style inspection
- this is not strong enough for hostile multi-tenant production workloads

## Testing and Verification

### Available commands

```bash
npm run lint
npm run build:code-platform
npm run build:worker
npx jest --watchman=false
npm run test:e2e -- --watchman=false
```

## What I Would Improve with More Time

### 1. Upgrade sandboxing from runtime isolation to container isolation

For real production safety, I would move from the current runtime-level isolation model to dedicated sandboxing per execution, likely with short-lived containers and stronger kernel-level isolation. That would materially improve blast-radius control for untrusted code.

### 2. Add push-based execution updates

Polling is a good first version, but websockets or server-sent events would reduce poll pressure and make the UI feel much more responsive, especially for short-lived runs.

### 3. Tighten configuration consistency

There is already a small mismatch between code defaults and Docker Compose defaults for `RUN_RATE_LIMIT_COUNT`. I would centralize defaults and generate environment documentation from code so operational behavior is less ambiguous.

### 4. Improve operational observability

I would add:

- Prometheus metrics
- structured logs with correlation IDs
- tracing across API enqueue and worker execution
- queue depth, execution latency, and failure-rate dashboards

### 5. Harden failure recovery

The current stale-execution handling is a helpful starting point, but I would go further with:

- explicit dead-letter handling
- retry classification by failure type
- janitor jobs for orphaned executions
- clearer operator tooling for replaying or inspecting stuck jobs

### 6. Add better client-facing API ergonomics

Examples:

- API versioning
- standardized error response schemas
- idempotency keys for run requests
- pagination/filtering for execution history
- an endpoint to fetch a full session aggregate with latest execution summaries

### 7. Expand automated test coverage around infrastructure boundaries

Current tests are solid for service-level behavior, but I would add:

- containerized integration tests with real Postgres and Redis
- concurrency tests for duplicate or repeated run requests
- resilience tests around worker restarts and queue retries
- contract tests for Swagger-documented payloads
