# Rally

Multi-tenant project-management SaaS (Zone B1 — external customer-facing). Runs on **ECS Fargate** (AWS), per the [platform architecture](https://github.com/QNSC-VN/.github/blob/main/docs/PLATFORM_ARCHITECTURE.md).

> **Monorepo.** Consolidates the former `rally-api` + `rally-web` + `rally-infra` into one repository per [REPOSITORY_STRUCTURE.md](https://github.com/QNSC-VN/.github/blob/main/docs/REPOSITORY_STRUCTURE.md). Old repos are archived (read-only) for history.

## Layout

```
rally/
├── apps/
│   ├── api/       # NestJS 11 (Fastify) HTTP API — ECS Fargate service
│   ├── worker/    # NestJS background/queue worker — ECS Fargate service
│   └── web/       # React 19 + Vite SPA — S3 + CloudFront (pnpm workspace member)
├── libs/          # shared backend libs (shared-kernel, platform, contracts, 12 domain modules)
│                  #   ↳ this is the design's "packages/" role, using the NestJS `libs/` convention
├── db/            # Drizzle schema + migrations + seeds
├── deploy/ecs/    # deploy-descriptor notes (task-def is infra-owned — see deploy/ecs/README.md)
├── infra/         # OpenTofu (product-owned resources), sources qnsc-tf-modules via git ref
│   └── live/{_shared,develop,prod}/
├── .github/workflows/   # CI/CD — calls reusable workflows/actions from QNSC-VN/qnsc-ci
├── Dockerfile     # multi-target: api, worker, migrator (web is static, no container)
└── pnpm-workspace.yaml
```

## Workspace model

- The **NestJS backend** (`apps/api`, `apps/worker`, `libs/`, `db/`) is the **root package** — resolved by `nest-cli.json` (`monorepo: true`) + tsconfig path aliases (`@shared-kernel`, `@platform`, `@contracts`, `@modules/*`). It is **not** a set of pnpm workspace packages.
- `apps/web` is the **one pnpm workspace member** (separate Vite toolchain, package name `rally-web`).
- `pnpm-workspace.yaml` lists only `apps/web`; the backend is the root.

## Develop

The shared `@qnsc-vn/*` libraries (e.g. `@qnsc-vn/identity`) are hosted on **GitHub Packages**, which requires read auth. **Do not mint a personal PAT** — reuse your existing GitHub CLI login (needs the `read:packages` scope):

```bash
gh auth login                                        # one-time, if not already
export NODE_AUTH_TOKEN="$(gh auth token)"            # per shell (or wire via direnv)
```

CI needs no setup — workflows authenticate with the built-in `GITHUB_TOKEN` (`packages: read`).

```bash
pnpm install                 # installs root (backend) + apps/web
docker compose -f docker-compose.dev.yml up -d   # local Postgres + Redis
pnpm db:migrate              # apply Drizzle migrations
pnpm start:dev               # api (watch)   |  pnpm start:dev:worker
pnpm dev:web                 # web (Vite dev server)
```

## Build

```bash
pnpm build                   # api + worker (nest build)
pnpm build:web               # web (tsc + vite build → apps/web/dist)
```

## Deploy (ECS Fargate)

Push-based CD via GitHub Actions → `QNSC-VN/qnsc-ci` reusable workflows/actions:
`build → Trivy scan → Cosign sign → push ECR → register task-def revision → update-service → health check`.
Promotion `develop → prod` is a tagged release. See `.github/workflows/` and `deploy/ecs/README.md`.

## Infra

`infra/live/{develop,prod}` compose modules from [`qnsc-tf-modules`](https://github.com/QNSC-VN/qnsc-tf-modules) (ecs-cluster, ecs-service, rds, messaging, secrets, pages-web, dns-record). The shared VPC/NAT/ALB (+ prod cache/WAF) live once per env in `qnsc-infra` (`platform/runtime-dev` / `runtime-prod`) and are consumed via `terraform_remote_state`; RDS + Fargate stay per-product (dev cache is a Valkey sidecar). State in S3 + DynamoDB (shared bootstrap). `infra/live/_shared` holds per-product ECR repos + GitHub OIDC deploy roles.
