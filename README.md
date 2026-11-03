# lab-processor

The shared processor of the lab: a NestJS service that will consume the events published by both producers and own its database.

## Role in the lab

Runs in the `platform` namespace of the k3s cluster, next to Kafka. There is one processor for the whole lab, shared by [lab-producer-a](https://github.com/CarlosFerOrduna/lab-producer-a) and [lab-producer-b](https://github.com/CarlosFerOrduna/lab-producer-b). ArgoCD deploys it from [lab-gitops](https://github.com/CarlosFerOrduna/lab-gitops) (`platform/processor`).

## Status

Today:

- `GET /health` returns `200 {"status":"ok"}`.
- An HTTP API for events (see [API](#api)): producers send events with `POST /events`, and anyone reads them with `GET /events`.
- Its own PostgreSQL, separate from the process, accessed through TypeORM. The schema lives in versioned SQL migrations (`migrations/postgres/`), applied by a separate command before the service starts.
- A reproducible script that copied the events of the previous SQLite version into PostgreSQL (see [Data migration from SQLite](#data-migration-from-sqlite)).
- Environment configuration validated at startup with Joi.
- Multi-stage `Dockerfile` that runs as the unprivileged `node` user, on a base image pinned by digest.
- A `compose.yaml` with PostgreSQL, the migrations as a one-shot service, and the service itself.
- npm scripts that CI will call:

| Script                 | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `npm run lint`         | ESLint, without `--fix`, so violations fail the build.    |
| `npm run migrate`      | Applies the pending migrations (`dist/migrate.js`).       |
| `npm run migrate:data` | Copies the events of the old SQLite file into PostgreSQL. |
| `npm test`             | Jest unit tests (`*.spec.ts` next to the code they test). |
| `npm run build`        | Compiles to `dist/`.                                      |
| `npm start`            | Runs `dist/main`.                                         |
| `npm run start:dev`    | Watch mode for local work.                                |
| `npm run format`       | Prettier over `src/`.                                     |

NestJS 12 ships as ES modules only, so `npm test` runs Jest with `--experimental-vm-modules`.

Planned:

- Consume the Kafka topics of both producers (`producer-a.*` and `producer-b.*`), replacing `POST /events`.
- Serve the producers' requests through the platform gateway.
- Own its database. Producers never write to it directly. The database evolves in three steps:
  1. Start with an embedded SQLite database inside the process, the pattern most services use today. (Done.)
  2. Migrate to a separate PostgreSQL, moving the existing data with a reproducible migration script. **(Today.)**
  3. Only after that migration, deploy to the cluster, with PostgreSQL running as its own StatefulSet.

  The migration comes before the deployment because the SQLite file lives in a volume that only one pod can mount. While the service stays on SQLite, it cannot run two replicas or deploy without downtime.

- Graceful shutdown: stop consuming, drain in-flight work, then exit.

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

`better-sqlite3` is a native module, needed only by the data migration script: npm runs its install script only because `package.json` approves that exact version in `allowScripts`. It goes away with the script.

## API

| Method and path   | What it does                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /events`    | Receives an event from a producer and answers `202`. The producer sets the event `id`: sending the same `id` again stores nothing new, so retries are safe. |
| `GET /events`     | The latest events first. Optional `source`, `limit` (1 to 100, default 20) and `offset`.                                                                    |
| `GET /events/:id` | One event, or `404`.                                                                                                                                        |

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

`npm run migrate` needs only the `DATABASE_*` variables. An invalid value stops the service at startup with a validation error. The image carries no environment-specific values: the same image runs in dev, stage and prod, and each environment's values come from its overlay in [lab-gitops](https://github.com/CarlosFerOrduna/lab-gitops).

## Migrations

Schema changes are versioned SQL files in `migrations/postgres/`, applied in file name order. The runner records each applied file in the `schema_migration` table and runs every file in its own transaction: a failing migration leaves no trace and stops the run.

- Add a change as a new file (`0002_<what_it_does>.sql`); never edit an applied one.
- The service never changes the schema: TypeORM runs with `synchronize: false`.
- Migrations run before the service, as a separate command. The runner holds a PostgreSQL advisory lock while it works, so several replicas starting at once apply each migration exactly once.

## Data migration from SQLite

The first version kept its events in an embedded SQLite file. `npm run migrate:data` (`src/scripts/migrate-sqlite-to-postgres.ts`) copies them into PostgreSQL:

- Reads every row of the SQLite `event` table, read-only.
- Converts the types: JSON text to `jsonb`, and SQLite's zone-less UTC timestamps to `timestamptz`. A corrupt payload or timestamp stops the run instead of being copied.
- Inserts everything in one transaction with `ON CONFLICT (id) DO NOTHING`, so running it again inserts nothing new.
- Checks that every SQLite `id` is in PostgreSQL, and fails otherwise.

With compose, the old SQLite data is the `processor-data` volume, mounted read-only:

```bash
docker compose run --rm migrate-data
# Read 4 events from SQLite: inserted 4, already present 0. All 4 are in PostgreSQL.
```

The script, `better-sqlite3` and the `processor-data` volume stay until the processor runs in the cluster and its data is verified; then they are removed.

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
