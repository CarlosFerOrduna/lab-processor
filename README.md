# lab-processor

The shared processor of the lab: a NestJS service that will consume the events published by both producers and own its database.

## Role in the lab

Runs in the `platform` namespace of the k3s cluster, next to Kafka. There is one processor for the whole lab, shared by [lab-producer-a](https://github.com/CarlosFerOrduna/lab-producer-a) and [lab-producer-b](https://github.com/CarlosFerOrduna/lab-producer-b). ArgoCD deploys it from [lab-gitops](https://github.com/CarlosFerOrduna/lab-gitops) (`platform/processor`).

## Status

Today:

- `GET /health` returns `200 {"status":"ok"}`.
- An HTTP API for events (see [API](#api)): producers send events with `POST /events`, and anyone reads them with `GET /events`.
- An embedded SQLite database, accessed through TypeORM. Its schema lives in versioned SQL migrations (`migrations/sqlite/`), applied by a separate command before the service starts.
- Environment configuration validated at startup with Joi.
- Multi-stage `Dockerfile` that runs as the unprivileged `node` user, on a base image pinned by digest.
- A `compose.yaml` that reproduces today's starting point: the migrations run once, then the service starts on the same SQLite volume.
- npm scripts that CI will call:

| Script              | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm run lint`      | ESLint, without `--fix`, so violations fail the build.    |
| `npm run migrate`   | Applies the pending migrations (`dist/migrate.js`).       |
| `npm test`          | Jest unit tests (`*.spec.ts` next to the code they test). |
| `npm run build`     | Compiles to `dist/`.                                      |
| `npm start`         | Runs `dist/main`.                                         |
| `npm run start:dev` | Watch mode for local work.                                |
| `npm run format`    | Prettier over `src/`.                                     |

NestJS 12 ships as ES modules only, so `npm test` runs Jest with `--experimental-vm-modules`.

Planned:

- Consume the Kafka topics of both producers (`producer-a.*` and `producer-b.*`), replacing `POST /events`.
- Serve the producers' requests through the platform gateway.
- Own its database. Producers never write to it directly. The database evolves in three steps:
  1. Start with an embedded SQLite database inside the process, the pattern most services use today. **(Today.)**
  2. Migrate to a separate PostgreSQL, moving the existing data with a reproducible migration script.
  3. Only after that migration, deploy to the cluster, with PostgreSQL running as its own StatefulSet.

  The migration comes before the deployment because the SQLite file lives in a volume that only one pod can mount. While the service stays on SQLite, it cannot run two replicas or deploy without downtime.

- Graceful shutdown: stop consuming, drain in-flight work, then exit.

## Run locally

Requires Node 26 (see `.nvmrc`).

```bash
nvm use
npm ci
npm run build
npm run migrate      # creates data/processor.sqlite and applies the migrations
npm run start:dev
curl localhost:3000/health
```

`better-sqlite3` is a native module: npm runs its install script only because `package.json` approves that exact version in `allowScripts`. Upgrading it needs a new approval (`npm install-scripts approve better-sqlite3`).

With Docker Compose:

```bash
docker compose up --build
```

The `migrate` service applies the migrations and exits; `processor` starts only after it succeeds. Both mount the `processor-data` volume, so the data survives restarts. `docker compose down -v` deletes it.

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

The service reads only real environment variables. `.env` files are ignored, so pass values in the shell (`PORT=4000 npm run start:dev`) or with `docker run -e`.

| Variable        | Default                                                             | Validation                                                    |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `NODE_ENV`      | `production`                                                        | One of `development`, `test`, `production`.                   |
| `PORT`          | `3000`                                                              | A valid TCP port number.                                      |
| `DATABASE_PATH` | `data/processor.sqlite` (`/app/data/processor.sqlite` in the image) | Path of the SQLite file. Its directory is created if missing. |

An invalid value stops the service at startup with a validation error. The image carries no environment-specific values: the same image runs in dev, stage and prod, and each environment's values come from its overlay in [lab-gitops](https://github.com/CarlosFerOrduna/lab-gitops).

## Migrations

Schema changes are versioned SQL files in `migrations/sqlite/`, applied in file name order. The runner records each applied file in the `schema_migration` table and runs every file in its own transaction: a failing migration leaves no trace and stops the run.

- Add a change as a new file (`0002_<what_it_does>.sql`); never edit an applied one.
- The service never changes the schema: TypeORM runs with `synchronize: false`.
- Migrations run before the service, as a separate command, so several replicas never race to change the schema.

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

## Pipeline (planned)

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
