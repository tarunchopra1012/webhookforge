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

Domain-Driven Design with a strict, enforced flow:

```
HTTP → Guard → Controller → Service → UseCase → Repository → Mapper ↔ Persistence
```

| Layer           | Responsibility                                                             |
| --------------- | -------------------------------------------------------------------------- |
| **Controller**  | HTTP only. Validates DTO, calls one Service method, throws on `AppError`.  |
| **Service**     | Thin facade. Delegates to UseCases. No logic.                              |
| **UseCase**     | All business logic. One use case = one operation.                          |
| **Repository**  | All DB access. Returns domain types, never entities. Always tenant-scoped. |
| **Mapper**      | `toDomain()` / `toPersistence()`. Field mapping only.                      |
| **Persistence** | TypeORM entity. Table shape only.                                          |

**Errors are returned, not thrown.** Service, UseCase, and Repository methods
return `Promise<T | AppError>`. Only the Controller throws, after an
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

```bash
git clone https://github.com/<you>/webhookforge.git
cd webhookforge
cp .env.example .env

docker compose up -d          # Postgres, Redis, Prometheus, Grafana
npm install
npm run migration:run
npm run start:dev             # API on :3000
npm run start:worker          # delivery workers
```

| URL                             | What                                |
| ------------------------------- | ----------------------------------- |
| `http://localhost:3000/health`  | Liveness — process, database, Redis |
| `http://localhost:3000/api`     | Swagger UI                          |
| `http://localhost:3000/console` | Operator console (demo)             |
| `http://localhost:3000/metrics` | Prometheus metrics                  |
| `http://localhost:3001`         | Grafana dashboards                  |

### Try it

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
| 0     | Project scaffold, Docker, config, health                              | ⬜     |
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

Each domain module follows the same shape: `controller · service · module · dto ·
types` plus an `initiator/` directory holding one use case per operation.

---

## License

MIT
