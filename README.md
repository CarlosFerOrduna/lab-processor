# lab-processor

The shared processor of the lab: a NestJS service that consumes the events published by both producers and owns its database.

## Role in the lab

Runs in the `platform` namespace of the k3s cluster, next to Kafka. There is one processor for the whole lab, shared by [lab-producer-a](https://github.com/CarlosFerOrduna/lab-producer-a) and [lab-producer-b](https://github.com/CarlosFerOrduna/lab-producer-b). ArgoCD deploys it from [lab-gitops](https://github.com/CarlosFerOrduna/lab-gitops) (`platform/processor`).

## Status

Today:

- `GET /health` returns `200 {"status":"ok"}` while the process is up, without touching the database: for a liveness probe.
- `GET /health/ready` returns `200` only if the database answers `SELECT 1` within 1 s, and `503` otherwise: for a readiness probe.
- An HTTP API for events (see [API](#api)): producers send events with `POST /events`, and anyone reads them with `GET /events`.
- A Kafka consumer (see [Kafka consumer](#kafka-consumer)), `dist/consumer.js`, that stores the events of both producers' topics. It runs as its own process and Deployment, next to the API.
- Its own PostgreSQL, separate from the process, accessed through TypeORM. The schema lives in versioned SQL migrations (`migrations/postgres/`), applied by a separate command before the service starts.
- Environment configuration validated at startup with Joi.
- Multi-stage `Dockerfile` that runs as the unprivileged `node` user, on a base image pinned by digest.
- A `compose.yaml` with PostgreSQL, the migrations as a one-shot service, and the service itself.
- npm scripts that CI will call:

| Script              | What it does                                           |
| ------------------- | ------------------------------------------------------ |
| `npm run lint`      | ESLint, without `--fix`, so violations fail the build. |
| `npm run migrate`   | Applies the pending migrations (`dist/migrate.js`).    |
| `npm run consume`   | Runs the Kafka consumer (`dist/consumer.js`).          |
| `npm run build`     | Compiles to `dist/`.                                   |
| `npm start`         | Runs `dist/main`.                                      |
| `npm run start:dev` | Watch mode for local work.                             |
| `npm run format`    | Prettier over `src/`.                                  |

NestJS 12 ships as ES modules only, so `npm test` runs Jest with `--experimental-vm-modules`.

Planned:

- Retire `POST /events` once both producers publish to Kafka.
- Serve the producers' requests through the platform gateway.
- Own its database. Producers never write to it directly. The database evolves in three steps:
  1. Start with an embedded SQLite database inside the process, the pattern most services use today. (Done.)
  2. Migrate to a separate PostgreSQL, moving the existing data with a reproducible migration script. (Done.)
  3. Only after that migration, deploy to the cluster, with PostgreSQL running as its own StatefulSet. **(Today:** two replicas in the `platform` namespace, deployed from [lab-gitops](https://github.com/CarlosFerOrduna/lab-gitops) `platform/processor/base`.**)**

  The migration comes before the deployment because the SQLite file lives in a volume that only one pod can mount. While the service stays on SQLite, it cannot run two replicas or deploy without downtime.

- A dead letter topic (`processor.dlq`) for the messages the consumer skips.

## Run locally

Requires Node 26 (see `.nvmrc`) and Docker.

Create a local `.env` with the database password for compose. It is ignored by git and never committed:

```bash
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 16)" > .env
chmod 600 .env
```

Everything in Docker Compose, on port 3000:

```bash
docker compose up --build
```

`postgres` starts first; `migrate` waits until it is healthy, applies the migrations and exits; `processor` starts only after that succeeds. The data lives in the `postgres-data` volume (`docker compose down -v` deletes it). The service itself never reads `.env`: compose uses it to fill in `compose.yaml`.

## API

| Method and path     | What it does                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /events`      | Receives an event from a producer and answers `202`. The producer sets the event `id`: sending the same `id` again stores nothing new, so retries are safe. |
| `GET /events`       | The latest events first. Optional `source`, `limit` (1 to 100, default 20) and `offset`.                                                                    |
| `GET /events/:id`   | One event, or `404`.                                                                                                                                        |
| `GET /health`       | `200` while the process is up. Never checks the database, so a database outage does not restart the service.                                                |
| `GET /health/ready` | `200` if the database answers within 1 s, `503` otherwise. A pod that is not ready gets no traffic but is not restarted.                                    |

```bash
curl -X POST localhost:3000/events -H 'content-type: application/json' -d '{
  "id": "0b6f3c2e-6c1a-4c55-9a59-1f0d6f2c9b11",
  "source": "producer-a",
  "type": "item.created",
  "occurredAt": "2026-11-02T18:00:00Z",
  "payload": { "name": "first" }
}'
curl 'localhost:3000/events?source=producer-a&limit=5'
```

An invalid body or query answers `400` with every validation error. Timestamps are UTC.

## Kafka consumer

`node dist/consumer.js` (in the cluster, the `processor-consumer` Deployment) consumes the producers' topics as the consumer group `processor`, with its own client certificate (mTLS). It serves only `GET /health`, for its liveness probe: it has no events API.

### The message contract

Every producer publishes the same event the API takes in `POST /events`:

- **Value**: the whole event as JSON (`id`, `source`, `type`, `occurredAt`, `payload`), validated with the same schema as the API. Its `id` is what makes storing idempotent: the same `id` twice stores one row.
- **Key**: the id of the aggregate the event is about: the item's id (`itemId`) in producer-b, the message's id in producer-a. Kafka sends every message with the same key to the same partition, so the events of one aggregate stay in order. The key is not the event's `id`.

### Processing

One message at a time, without autocommit: the offset is committed only after the event is stored, so a crash reads it again (at least once) and the idempotent insert absorbs the repeat. A group without committed offsets starts from the beginning of each partition.

Only a message at fault is skipped: one that is not a valid event, or that the database rejects for its data. Any other error is retried without committing, because skipping it would lose a message that was fine: a database outage, a missing table or a bug in the consumer stop consuming instead.

| What happens                                                                                                                                                                                  | The consumer                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The value is not JSON, or not a valid event                                                                                                                                                   | Logs it, commits it and goes on. The log line has the topic, partition, offset, key, reason, SQLSTATE and the value's length, never the value itself.         |
| The database rejects it for its data: SQLSTATE class `22` (data exception) or `23` (integrity constraint) but `23505`                                                                         | Same as above. The log line has the SQLSTATE but not PostgreSQL's error message, which can repeat the rejected data.                                          |
| A duplicate (`23505`)                                                                                                                                                                         | It is already stored: commits it.                                                                                                                             |
| Any other error: the database unreachable, restarting or busy (network errors, class `08`, `57P01`, `40001`...), the schema wrong or missing (class `42`), an error without a SQLSTATE, a bug | Retries the same message, without committing, after 1 s, 2 s, 4 s... up to 30 s between attempts, logging each attempt with its SQLSTATE. Nothing is skipped. |
| SIGTERM                                                                                                                                                                                       | Finishes or abandons (uncommitted) the message in progress, leaves the group and exits.                                                                       |
| The Kafka client gives up                                                                                                                                                                     | Exits; Kubernetes restarts it, and the uncommitted message is read again.                                                                                     |

A skipped message is lost but for its log line: a dead letter topic is planned. The liveness probe does not see a stuck consumer either (retrying a message never fails it); watching the group's lag is planned with the lab's observability.

The image carries no optional dependencies (`npm prune --omit=optional`): `@platformatic/kafka` computes CRC32C in WASM instead of the prebuilt native binary of `@node-rs/crc32`, so the image has no native code. The consumer does not run in `compose.yaml`, which has no Kafka.

## Configuration

The service reads only real environment variables. `.env` files are ignored by the service, so pass values in the shell or with `docker run -e`.

| Variable            | Default      | Validation                                                |
| ------------------- | ------------ | --------------------------------------------------------- |
| `NODE_ENV`          | `production` | One of `development`, `test`, `production`.               |
| `PORT`              | `3000`       | A valid TCP port number.                                  |
| `DATABASE_HOST`     | required     | Host name of PostgreSQL.                                  |
| `DATABASE_PORT`     | `5432`       | A valid TCP port number.                                  |
| `DATABASE_NAME`     | required     | Database name.                                            |
| `DATABASE_USER`     | required     | Database user.                                            |
| `DATABASE_PASSWORD` | required     | Database password. In the cluster it comes from a Secret. |

The consumer also needs these (the API ignores them):

| Variable                  | Default              | Validation                                                                 |
| ------------------------- | -------------------- | -------------------------------------------------------------------------- |
| `KAFKA_BOOTSTRAP_BROKERS` | required             | Comma-separated `host:port` list. A host name, never an IP: TLS checks it. |
| `KAFKA_CLIENT_ID`         | `processor-consumer` | The client id the brokers log.                                             |
| `KAFKA_GROUP_ID`          | `processor`          | The consumer group; its ACL lives in the `processor` KafkaUser.            |
| `KAFKA_TOPICS`            | required             | Comma-separated topics.                                                    |
| `KAFKA_CA_FILE`           | required             | The CA that verifies the brokers (the lab's root).                         |
| `KAFKA_CERT_FILE`         | required             | The consumer's client certificate (`CN=processor`).                        |
| `KAFKA_KEY_FILE`          | required             | Its private key.                                                           |

`npm run migrate` needs only the `DATABASE_*` variables. An invalid value stops the service at startup with a validation error. The image carries no environment-specific values: the same image runs in dev, stage and prod, and each environment's values come from its overlay in [lab-gitops](https://github.com/CarlosFerOrduna/lab-gitops).

## Migrations

Schema changes are versioned SQL files in `migrations/postgres/`, applied in file name order. The runner records each applied file in the `schema_migration` table and runs every file in its own transaction: a failing migration leaves no trace and stops the run.

- Add a change as a new file (`0002_<what_it_does>.sql`); never edit an applied one.
- The service never changes the schema: TypeORM runs with `synchronize: false`.
- Migrations run before the service, as a separate command. The runner holds a PostgreSQL advisory lock while it works, so several replicas starting at once apply each migration exactly once.

## History

The first version kept its events in an embedded SQLite file. A reproducible script copied them into PostgreSQL (`ON CONFLICT DO NOTHING`, then a check that every id arrived), and it was removed once the processor ran in the cluster with its data verified. It is still in the git history (`src/scripts/migrate-sqlite-to-postgres.ts`).

## Branch model

| Branch        | Purpose                  |
| ------------- | ------------------------ |
| `development` | Deploys to dev.          |
| `stage`       | Deploys to stage.        |
| `main`        | Deploys to prod.         |
| `fer`         | Personal working branch. |

- `development`, `stage` and `main` are fixed branches: they are never deleted or force-pushed.
- Work happens on the personal branch and is merged locally into `development`, then `development` into `stage`. There are no pull requests.
- Only the production owner updates `main`.

## Pipeline

Today, `.github/workflows/image.yml` publishes the image on every push to `development`, and on demand with **Run workflow** (`workflow_dispatch`). It calls the reusable [`container-image.yml`](https://github.com/CarlosFerOrduna/lab-ci-workflows) of lab-ci-workflows, so the three services publish the same way:

- The tag is the tree hash of the commit (`git rev-parse HEAD^{tree}`): `ghcr.io/carlosferorduna/lab-processor:<tree hash>`.
- If that tag already exists, nothing is built: the same content is never published twice.
- It authenticates with the workflow's own `GITHUB_TOKEN` (`packages: write`), never with a personal token.
- The `org.opencontainers.image.source` label links the package to this repository.

Planned:

1. On push to `development`: run the npm scripts (`lint`, `test`), then build an image tagged with the tree hash (`git rev-parse HEAD^{tree}`). The image is deployed to dev only if the tests pass.
2. On push to `stage` or `main`: reuse the image whose tag matches the tree hash. The job fails if that image does not exist and never rebuilds it.
3. CI updates the image tag in the matching [lab-gitops](https://github.com/CarlosFerOrduna/lab-gitops) overlay. Dev and stage sync automatically. Prod waits for a manual ArgoCD sync.

Tagging by tree hash means a merge that leaves the files unchanged maps to the same image, so stage and prod run exactly what was tested in dev.

## Lab repositories

| Repository                                                              | Role                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [lab-infra](https://github.com/CarlosFerOrduna/lab-infra)               | Builds the infrastructure: Hyper-V VMs today, Ansible and k3s next. Holds the repository settings checklist. |
| [lab-gitops](https://github.com/CarlosFerOrduna/lab-gitops)             | Desired state of the clusters. ArgoCD applies whatever is in this repo.                                      |
| [lab-ci-workflows](https://github.com/CarlosFerOrduna/lab-ci-workflows) | Reusable GitHub Actions workflows shared by every lab repo.                                                  |
| [lab-processor](https://github.com/CarlosFerOrduna/lab-processor)       | Shared processor service, namespace `platform`.                                                              |
| [lab-producer-a](https://github.com/CarlosFerOrduna/lab-producer-a)     | Producer service, namespace `producer-a`.                                                                    |
| [lab-producer-b](https://github.com/CarlosFerOrduna/lab-producer-b)     | Producer service, namespace `producer-b`.                                                                    |
