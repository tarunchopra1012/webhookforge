# WebhookForge

**A multi-tenant webhook delivery service.** Ingest events over HTTP, deliver
them to subscriber endpoints with HMAC signing, exponential-backoff retries, a
dead-letter queue, and per-tenant isolation.

> **Status: in active development.** See the [build status](#build-status) table
> below for what is implemented today. This is a personal engineering project —
> it is not running in production and has no users.

---

## Why this exists

Most SaaS platforms eventually need to notify their customers' systems when
something happens — an order is created, a shipment moves, an invoice is paid.
The naive version is a `fetch()` in a request handler. That breaks the moment the
receiver is slow, down, or returns a 500.

Doing it properly means solving a specific cluster of problems:

- **The receiver is unreliable.** Deploys, timeouts, 500s. Needs retries with
  backoff, and a dead-letter queue for deliveries that never succeed.
- **The receiver must be able to trust the sender.** Anyone can POST to a public
  URL. Needs request signing, and replay protection.
- **Retrying creates duplicates.** A timeout doesn't mean the request failed —
  it may have succeeded with a lost response. Needs idempotency and atomic state
  transitions.
- **Many customers share one system.** Needs strict tenant isolation and
  per-tenant rate limiting.
- **The sender's request must stay fast.** Delivery cannot happen inline. Needs a
  queue, workers, and backpressure.

WebhookForge is a from-scratch implementation of that delivery layer.

<!-- TODO (write this yourself, in your own words — 2-3 sentences):
     What real system did you work on that made you want to build this?
     Keep it about the engineering problem, not the employer. -->

---

## Architecture

```
                         ┌─────────────────────────────────────┐
   POST /v1/events  ───► │  Ingest API                         │
   (tenant API key)      │  validate → persist → fan out       │
                         │  → enqueue                          │
                         └──────────────┬──────────────────────┘
                                        │  202 Accepted (immediate)
                                        ▼
                              ┌──────────────────┐
                              │  Redis / BullMQ  │
                              └────────┬─────────┘
                                       │
                         ┌─────────────▼──────────────┐
                         │  Delivery workers          │
                         │  sign → POST → record      │
                         │  → backoff or dead-letter  │
                         └─────────────┬──────────────┘
                                       │
                        ┌──────────────┴───────────────┐
                        ▼                              ▼
                Subscriber endpoint            dead_letters
                (customer's server)         (exhausted retries)

   Scheduled sweeper (distributed lock) re-enqueues deliveries whose
   nextAttemptAt has passed.
```

### Layer contract

Hexagonal architecture (ports and adapters) with a DDD module layout:

```
HTTP → Guard → Interceptor → Controller → UseCase → [Service] → RepositoryPort
                                                              ⇅
                                     Repository → Mapper ↔ Persistence → Postgres
```

| Layer              | Responsibility                                                              |
| ------------------ | --------------------------------------------------------------------------- |
| **Controller**     | HTTP only. Validates the DTO, calls one UseCase, throws on `AppError`.      |
| **UseCase**        | Application service. All orchestration and business rules. One per operation. |
| **Service**        | Domain service. Optional — only where an aggregate's behaviour has more than one caller. |
| **RepositoryPort** | Abstract class owned by the domain. States what it needs from storage.      |
| **Repository**     | TypeORM adapter implementing the port. Returns domain types. Tenant-scoped. |
| **Mapper**         | `toDomain()` / `toPersistence()`. Field mapping only.                       |
| **Persistence**    | TypeORM entity. Table shape only.                                           |

**The dependency arrow points inward.** UseCases inject
`SubscriptionRepositoryPort`, an abstract class living in the domain module — not
the TypeORM class that implements it. The module wires the two together:

```ts
providers: [
  ...useCases,
  { provide: SubscriptionRepositoryPort, useClass: SubscriptionRepository },
];
```

Abstract class rather than `interface` because TypeScript interfaces are erased
at compile time and cannot serve as dependency-injection tokens. The practical
payoff is that nothing above the adapter knows a database exists: swapping the
store, or running a use case against an in-memory fake in a test, is a one-line
change in one file.

**There is no thin facade layer.** A Service that only forwards a call is a file
that does nothing, so Controllers call UseCases directly. A domain Service is
added only when an aggregate owns behaviour that a second caller already needs —
`DeliveryService` owns the retry state machine shared by the ingest path, the
retry worker and the sweeper. That one is earned; a `SubscriptionService`
wrapping `save` and `findById` would not be.

**Errors are returned, not thrown.** UseCase, Service, Port and Repository
methods return `Promise<T | AppError>`. Only the Controller throws, after an
`instanceof` check. This makes error paths explicit in the type signature rather
than invisible control flow.

### Domain model

| Entity            | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `Tenant`          | Isolation boundary. Every other table carries `tenantId`.  |
| `ApiKey`          | Hashed key + display prefix. Authenticates the ingest API. |
| `Subscription`    | A tenant's endpoint: url, secret, subscribed event types.  |
| `Event`           | Ingested payload + idempotency key (unique per tenant).    |
| `Delivery`        | One event → one subscription. The retry state machine.     |
| `DeliveryAttempt` | Immutable log of every HTTP attempt.                       |
| `DeadLetter`      | Deliveries that exhausted their retries.                   |
| `CronJobLock`     | Lease rows making scheduled jobs safe across instances.    |

---

## Stack

|                       |                                                                |
| --------------------- | -------------------------------------------------------------- |
| Runtime               | Node.js 20+, TypeScript (strict)                               |
| Framework             | NestJS                                                         |
| Database              | PostgreSQL 16 + TypeORM (migrations only, never `synchronize`) |
| Queue / cache / locks | Redis 7 + BullMQ                                               |
| Observability         | Prometheus + Grafana                                           |
| Local infra           | Docker Compose                                                 |
| Tests                 | Jest (unit + e2e)                                              |

---

## Getting started

### Prerequisites

Node.js 20+, Docker, and Docker Compose.

### Run it

Two ways, both from one `.env`.

**Dependencies in Docker, app on the host.** The faster loop — hot reload with
no container rebuild. This is the default.

```bash
git clone https://github.com/<you>/webhookforge.git
cd webhookforge
cp .env.example .env

npm install
npm run infra:start           # Postgres 16 + Redis 7
npm run start:dev             # API on :3000
```

**Everything in Docker.** One command, nothing installed on the host but Docker.

```bash
cp .env.example .env
npm run dev:start             # builds the image, starts all three
```

Source is bind-mounted, so hot reload works in the container too. Inside the
compose network the app reaches its dependencies by service name — the compose
file overrides `POSTGRES_HOST` and `REDIS_HOST`, so the same `.env` drives both
paths without edits.

| Script               | Does                                                       |
| -------------------- | ---------------------------------------------------------- |
| `npm run infra:start`| Postgres + Redis only                                      |
| `npm run infra:stop` | Stop them, keep the data                                   |
| `npm run dev:start`  | Build and start everything, app included                   |
| `npm run dev:stop`   | Stop everything, keep the data                             |
| `npm run dev:restart`| `dev:stop` then `dev:start`                                |
| `npm run dev:reset`  | Stop everything **and delete the Postgres and Redis data** |
| `npm run dev:logs`   | Tail the app container                                     |

| URL                            | What                                |
| ------------------------------ | ----------------------------------- |
| `http://localhost:3000/health` | Liveness — process, database, Redis |

### Verify it

```bash
curl -s localhost:3000/health
```

Expect `200`, with `database`, `redis` and `process` all reporting `up`.

The health check queries its dependencies rather than reporting a fixed value.
To confirm that, stop one and watch the status turn:

```bash
docker compose stop redis && sleep 2 && curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/health && docker compose start redis
```

`503` with `redis: down` while it is stopped, back to `200` once the client
reconnects — no app restart needed.

### Docker layout

`Dockerfile` is multi-stage:

| Stage   | Purpose                                                                 |
| ------- | ----------------------------------------------------------------------- |
| `deps`  | `npm ci` alone, so a source change does not reinstall dependencies       |
| `dev`   | Hot-reload target used by the `app` compose profile                     |
| `build` | Compiles TypeScript, then prunes dev dependencies in place              |
| `prod`  | `dist` + production dependencies only. No source, no toolchain, non-root |

Database and Redis data live in **named volumes**, not a bind-mounted host
directory. On macOS a bind mount crosses the Docker VM boundary through a
file-sync layer on every write, which is the worst case for Postgres' many
small random writes; a named volume stays inside the VM's own filesystem.
`npm run dev:reset` wipes them.

The `app` service sits behind a compose profile, so a bare `docker compose up -d`
brings up dependencies only.

### Not built yet

Everything below is the intended shape of the finished service. It does **not**
work today. See [build status](#build-status) for what is actually implemented.

| URL                             | What                | Arrives with |
| ------------------------------- | ------------------- | ------------ |
| `http://localhost:3000/api`     | Swagger UI          | Slice 1      |
| `http://localhost:3000/metrics` | Prometheus metrics  | Slice 8      |
| `http://localhost:3001`         | Grafana dashboards  | Slice 8      |
| `http://localhost:3000/console` | Operator console    | Slice 9      |

| Command                    | Arrives with |
| -------------------------- | ------------ |
| `npm run migration:run`    | Slice 1      |
| `npm run start:worker`     | Slice 6      |
| `npm run load-test`        | Slice 10     |

The API the slices are building toward:

```bash
# 1. Create a tenant and issue an API key
curl -X POST localhost:3000/v1/tenants \
  -H 'Content-Type: application/json' \
  -d '{"name":"ShopFlow"}'

# 2. Register a subscription
curl -X POST localhost:3000/v1/subscriptions \
  -H 'X-Api-Key: <key>' -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/hooks","eventTypes":["order.created"]}'

# 3. Send an event
curl -X POST localhost:3000/v1/events \
  -H 'X-Api-Key: <key>' -H 'Idempotency-Key: 8f3a...' \
  -H 'Content-Type: application/json' \
  -d '{"eventType":"order.created","payload":{"orderId":"A-1001"}}'
```

---

## Engineering decisions

<!-- TODO: Fill each of these in AFTER you build the corresponding slice, in
     your own words. These are the questions an interviewer will ask. If you
     can't write the answer here, you can't answer it out loud either. -->

### Idempotency at ingest

_What is the uniqueness constraint? What happens when two identical requests
race? Why this approach over the alternatives?_

### Preventing double delivery

_Two workers can pick up the same delivery. How is the status transition made
atomic, and why is read-then-write insufficient?_

### Retry and backoff policy

_What is the schedule, why jitter, and how was `maxAttempts` chosen?_

### Distributed locking for the sweeper

_Postgres lease table vs Redis `SET NX PX` — what happens when the holder
crashes mid-run, what happens under clock skew, and why the chosen one?_

### Tenant isolation

_Where is `tenantId` resolved, how is it propagated, and what stops a query from
omitting it?_

---

## Security

- **Request signing** — HMAC-SHA256 over `timestamp.body`, sent in a signature
  header alongside the timestamp.
- **Replay protection** — receivers reject signatures whose timestamp falls
  outside a 5-minute tolerance window. A `verifySignature()` helper and
  subscriber-side example are included.
- **SSRF protection** — subscription URLs are attacker-controlled, so localhost,
  link-local (`169.254.0.0/16`), and private ranges are rejected. Validation runs
  at both registration _and_ delivery time, because DNS can change in between
  (rebinding).
- **Secrets** — subscription secrets are returned once at creation and never
  again. API keys are stored hashed. Neither is ever logged.
- **Rotation** — secrets can be rotated with a grace window during which both old
  and new signatures verify.

---

## Reliability

- Ingest returns `202` immediately; delivery is fully asynchronous.
- Every attempt is recorded in `delivery_attempts`, success or failure.
- Failed deliveries back off exponentially with jitter, then dead-letter.
- Dead-lettered deliveries can be replayed manually.
- A scheduled sweeper recovers stuck deliveries; a distributed lock ensures
  exactly one instance sweeps per tick.
- Delivery state transitions are atomic conditional updates, so concurrent
  workers cannot double-deliver.

---

## Performance

<!-- TODO: Run scripts/load-test.ts and paste the REAL numbers. Do not estimate,
     round up, or copy these placeholders. An interviewer will ask about the
     machine and the methodology. -->

| Metric             | Result |
| ------------------ | ------ |
| Machine            | _TBD_  |
| Events ingested    | _TBD_  |
| Ingest throughput  | _TBD_  |
| Ingest p95 / p99   | _TBD_  |
| Queue drain rate   | _TBD_  |
| Time to full drain | _TBD_  |

Reproduce with:

```bash
npm run load-test -- --events 10000 --concurrency 200
```

---

## Testing

```bash
npm test          # unit — use cases, mappers, backoff, signing
npm run test:cov  # coverage
npm run test:e2e  # full delivery path against a local test subscriber
```

Cases deliberately covered: idempotent ingest under concurrent duplicates,
backoff schedule correctness, single-dead-letter guarantee, cross-tenant access
denial on every read path, lock contention between two sweeper instances, and
signature verification against tampered and stale requests.

---

## Build status

| Slice | Scope                                                                 | Status |
| ----- | --------------------------------------------------------------------- | ------ |
| 0     | Project scaffold, Docker, config, health                              | ✅     |
| 1     | Platform spine — errors, filters, logging, `@Api()`, `BaseRepository` | ⬜     |
| 2     | Tenants + API-key auth                                                | ⬜     |
| 3     | Codify the module pattern                                             | ⬜     |
| 4     | Subscriptions                                                         | ⬜     |
| 5     | Event ingest + idempotency                                            | ⬜     |
| 6     | Delivery worker, retries, DLQ, signing                                | ⬜     |
| 7     | Distributed cron locks                                                | ⬜     |
| 8     | Prometheus + Grafana                                                  | ⬜     |
| 9     | Operator console                                                      | ⬜     |
| 10    | Load harness + measured results                                       | ⬜     |

---

## Project structure

```
src/
├── main.ts, main.module.ts, orm.ts
├── constant.ts, type.ts, error.ts, event.ts
├── utils/              config, decorators, filters, interceptors, logger
├── shared/
│   ├── database/       persistence · repository · mapper · migration · helper
│   ├── cache/          Redis
│   ├── queue/          BullMQ producers + delivery workers
│   ├── lock/           distributed lock service
│   ├── signature/      HMAC signing + verification
│   └── metrics/        Prometheus registry
├── tenant/  subscription/  event/  delivery/  cron-job/  health/
└── console/            operator console (server-rendered)
```

Each domain module follows the same shape: `controller · module · dto · types ·
repository.port` plus an `initiator/` directory holding one use case per
operation. Ports sit with the domain; their TypeORM adapters sit under
`shared/database/`. A `service.ts` appears only in modules whose aggregate earned
one.

---

## License

MIT
