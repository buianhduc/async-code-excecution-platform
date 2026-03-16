# Live Code Execution Backend (NestJS)

Backend for live code sessions and asynchronous execution in a job simulation platform.

## Highlights

- `POST /code-sessions` create a live coding session
- `PATCH /code-sessions/:sessionId` autosave source code
- `POST /code-sessions/:sessionId/run` enqueue async execution
- `GET /executions/:executionId` poll execution status/result
- Queue-based worker with BullMQ + Redis
- Postgres metadata persistence via Prisma
- Pluggable runner adapters (Python implemented, JavaScript placeholder)
- Time, output, memory, and abuse controls
- Swagger docs at `/docs`

## Architecture

```text
Client
  -> Nest API
    -> Postgres (sessions + executions + lifecycle events)
    -> BullMQ Queue (Redis)

BullMQ Worker
  -> Fetch execution + session
  -> Run language executor in isolated temp workspace
  -> Persist final state + output + error metadata
```

## Tech Stack

- NestJS (TypeScript)
- Prisma ORM
- PostgreSQL
- Redis + BullMQ
- Jest (unit + integration)
- Docker + Docker Compose

## Project Structure

```text
src/
  code-sessions/     # session create/autosave + run endpoint
  executions/        # execution polling endpoint
  runner/            # execution processor + executors + worker
  queue/             # BullMQ queue producer
  database/          # Prisma service + repository implementations
  observability/     # lifecycle logging
  health/            # health endpoint
  config/            # typed env config
```

## Environment Configuration

Copy `.env.example` to `.env` and adjust values.

Core DB/queue variables:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `DATABASE_URL`
- `REDIS_HOST`
- `REDIS_PORT`

Execution controls:

- `MAX_SOURCE_BYTES`
- `MAX_OUTPUT_BYTES`
- `MAX_RUNTIME_MS`
- `MAX_MEMORY_BYTES`
- `RUN_RATE_LIMIT_COUNT`
- `RUN_RATE_LIMIT_WINDOW_MS`
- `WORKER_CONCURRENCY`
- `WORKER_STALE_EXECUTION_MS`

## Local Run

```bash
npm install
DATABASE_URL='postgresql://user:pass@localhost:5432/code_platform?schema=public' npm run prisma:generate
DATABASE_URL='postgresql://user:pass@localhost:5432/code_platform?schema=public' npm run prisma:migrate
npm run start:dev
```

In another terminal, run worker:

```bash
npm run start:worker:dev
```

## Docker (Backend + Database + Redis + Worker)

Two Dockerfiles are provided and compose-ready:

- `Dockerfile.backend` for API/worker services
- `Dockerfile.postgres` for the database service

Start all services:

```bash
docker compose up --build
```

Compose connection wiring:

- DB credentials come from `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- API/worker connect with:
  - `DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public`
  - `REDIS_HOST=redis`
  - `REDIS_PORT=6379`

## API Reference

### `POST /code-sessions`
Create session.

Request:

```json
{
  "language": "PYTHON",
  "template_code": "print('Hello World')"
}
```

Response:

```json
{
  "session_id": "uuid",
  "status": "ACTIVE"
}
```

### `PATCH /code-sessions/:sessionId`
Autosave source.

Request:

```json
{
  "language": "PYTHON",
  "source_code": "print('Hello')"
}
```

Response:

```json
{
  "session_id": "uuid",
  "status": "ACTIVE",
  "updated_at": "2026-03-16T00:00:00.000Z"
}
```

### `POST /code-sessions/:sessionId/run`
Queue async execution.

Response (`202 Accepted`):

```json
{
  "execution_id": "uuid",
  "status": "QUEUED"
}
```

### `GET /executions/:executionId`
Poll execution status.

Example completed response:

```json
{
  "execution_id": "uuid",
  "status": "COMPLETED",
  "stdout": "Hello World\\n",
  "stderr": "",
  "execution_time_ms": 120,
  "queued_at": "...",
  "started_at": "...",
  "completed_at": "..."
}
```

## Testing

```bash
npm run lint
npm run build
npm test
npm run test:e2e
```

Coverage includes:

- unit tests for session service, execution service, state machine, python executor
- integration-style API flow tests for create/autosave/run/poll/rate-limit behavior

## Design Decisions and Trade-offs

- **Queue-first async execution**: avoids blocking API and supports horizontal worker scaling.
- **Prisma repositories behind interfaces**: cleaner boundaries and easier testing with in-memory fakes.
- **MVP runtime isolation**: per-job temporary workspace + process spawn + hard limits. Not full container isolation yet.
- **Polling model**: simple client integration and explicit lifecycle states.

## What I Would Improve Next

- Add per-execution container sandboxing (Docker or Firecracker)
- Add distributed rate-limits and abuse heuristics by actor/IP
- Add retry classification with dead-letter queue management
- Add metrics export (Prometheus/OpenTelemetry)
- Add migration/seeding CI pipeline and compose smoke tests in CI

## Swagger

Once running, open:

- `http://localhost:3000/docs`
