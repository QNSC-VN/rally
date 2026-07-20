# Changelog

## [0.2.3](https://github.com/QNSC-VN/rally/compare/v0.2.2...v0.2.3) (2026-07-20)


### ✨ Features

* per-workspace RBAC, granular permissions, project & track UX ([#102](https://github.com/QNSC-VN/rally/issues/102)) ([3c367a6](https://github.com/QNSC-VN/rally/commit/3c367a6f5c780e5d72d8db309235c8f40cb1132e))
* phase 4 BA-design alignment (audit, roles, workflow, notifications, user phone) ([#100](https://github.com/QNSC-VN/rally/issues/100)) ([c3da490](https://github.com/QNSC-VN/rally/commit/c3da490dd38e61f64f6f4860f2cead1c38f01485))
* **rally:** align BA domains (F1-F7) + dev elasticache cache fix ([#97](https://github.com/QNSC-VN/rally/issues/97)) ([e118e24](https://github.com/QNSC-VN/rally/commit/e118e24f2108a414708d9406913e4f059722f9f2))
* **rally:** readable audit log + work-item/iteration/member follow-ups ([#106](https://github.com/QNSC-VN/rally/issues/106)) ([e47b8bf](https://github.com/QNSC-VN/rally/commit/e47b8bf87b14784cef3028dd42014ef47f9b0844))
* **web:** align projects table + modals with BA design ([#105](https://github.com/QNSC-VN/rally/issues/105)) ([36de097](https://github.com/QNSC-VN/rally/commit/36de097c7a387f1edd9efda634859ef04f4d9ead))
* **web:** paginate Projects list with shared PaginationFooter ([#104](https://github.com/QNSC-VN/rally/issues/104)) ([3417fe2](https://github.com/QNSC-VN/rally/commit/3417fe215dbdb3fc52b4ad9206e7793e9e624725))
* **web:** searchable Projects & Teams accordion in workspace switcher ([#103](https://github.com/QNSC-VN/rally/issues/103)) ([2614638](https://github.com/QNSC-VN/rally/commit/2614638d77e15a3fb9409560551b5212c4a22d9c))


### 🐛 Bug Fixes

* close BA-alignment gaps + tier-split and correct the seed system ([#107](https://github.com/QNSC-VN/rally/issues/107)) ([d6e90dc](https://github.com/QNSC-VN/rally/commit/d6e90dccac0bf10a2c55bd91a1e6b6ab5119ea52))
* **infra:** stop seeding demo fixtures into prod ([#108](https://github.com/QNSC-VN/rally/issues/108)) ([b62025e](https://github.com/QNSC-VN/rally/commit/b62025e4bed86f29d7409984affb9ef01f46b713))
* **rally:** align BA domains — item_key format, stepper, fractional story points ([#99](https://github.com/QNSC-VN/rally/issues/99)) ([15ce95c](https://github.com/QNSC-VN/rally/commit/15ce95c348e24bb51dc8fe28ac174afa0649d909))

## [0.2.2](https://github.com/QNSC-VN/rally/compare/v0.2.1...v0.2.2) (2026-07-16)


### 🐛 Bug Fixes

* **infra:** grant ecr:DescribeImages to rally ecr-push role ([#91](https://github.com/QNSC-VN/rally/issues/91)) ([cbf64f3](https://github.com/QNSC-VN/rally/commit/cbf64f3f689b8fa95408aad1792478f6e603b081))
* **infra:** surface prod infra-ID publish failures loudly instead of silent green ([#93](https://github.com/QNSC-VN/rally/issues/93)) ([f7d93ff](https://github.com/QNSC-VN/rally/commit/f7d93ff0715a6cd0b153c56ccf8f5f7f754aa068))

## [0.2.1](https://github.com/QNSC-VN/rally/compare/v0.2.0...v0.2.1) (2026-07-16)


### ✨ Features

* **infra:** consume R2 attachment storage via remote state (dev+prod) ([#87](https://github.com/QNSC-VN/rally/issues/87)) ([d69aa2f](https://github.com/QNSC-VN/rally/commit/d69aa2fdf81b57187ae7b8ea3bb8c5c46acbbbbf))
* **platform:** make StorageService endpoint-aware for S3-compatible backends ([#86](https://github.com/QNSC-VN/rally/issues/86)) ([4768485](https://github.com/QNSC-VN/rally/commit/47684854a9c8585282ebf788da3843bc2b853ac3))
* **tracking:** add TA-prefixed task keys and shared work-item grid UI ([#81](https://github.com/QNSC-VN/rally/issues/81)) ([3ac95d6](https://github.com/QNSC-VN/rally/commit/3ac95d6b53c50ce1753ccb6c122ac784bd2de55d))
* **web:** work-item grid suite with shared table engine and track-page enhancements ([#85](https://github.com/QNSC-VN/rally/issues/85)) ([485a88e](https://github.com/QNSC-VN/rally/commit/485a88e484a74cb41fd3165273df8bcc4da090bb))


### 🐛 Bug Fixes

* **ci:** serialize deploys by environment to prevent concurrent prod migrations ([#75](https://github.com/QNSC-VN/rally/issues/75)) ([f3227e6](https://github.com/QNSC-VN/rally/commit/f3227e62e8ec23e320c9aabbb070cd316095bb68))


### ♻️ Refactors

* **identity:** adopt shared @qnsc-vn/identity BFF mechanism ([#73](https://github.com/QNSC-VN/rally/issues/73)) ([cea7756](https://github.com/QNSC-VN/rally/commit/cea7756d58be126a83e8aabfb6bf07139eec5bf2))

## [0.2.0](https://github.com/QNSC-VN/rally/compare/v0.1.0...v0.2.0) (2026-07-14)


### ⚠ BREAKING CHANGES

* same-origin BFF auth (Entra confidential client), remove legacy MSAL ([#43](https://github.com/QNSC-VN/rally/issues/43))

### ✨ Features

* **access:** single-source frontend permission gating + backend drift guard ([#71](https://github.com/QNSC-VN/rally/issues/71)) ([f3932c5](https://github.com/QNSC-VN/rally/commit/f3932c5b63b744ad2dd647b40ebfaddf7174cf69))
* add pgEnums for attachment status, activity entity type, sso provider ([6e8ce63](https://github.com/QNSC-VN/rally/commit/6e8ce63459bda041d0e9c7fe9eb72ca99932a35e))
* **ci:** add CODEOWNERS, PR labeler, and release commenter bot ([5bc4c6a](https://github.com/QNSC-VN/rally/commit/5bc4c6af01ed6e36b46b220eced5cd2eabb61e59))
* **deployment:** DEPLOYMENT_MODE switch for single-tenant vs SaaS ([fd04da1](https://github.com/QNSC-VN/rally/commit/fd04da16a4d44f0fb3b4a98c5c709ce36cbce855))
* harden infra — tag-gate prod, Terraform-managed DNS, clean teardowns ([10213e2](https://github.com/QNSC-VN/rally/commit/10213e239266689a865574c62141bea8852de712))
* implement BA review Phase 1 gaps ([2768ac1](https://github.com/QNSC-VN/rally/commit/2768ac1aab5e0c1009117ce01531c65a73d35fe8))
* implement phase 2 - backlog and integration ([fdc1de7](https://github.com/QNSC-VN/rally/commit/fdc1de7f871b9f5a694ecd0725e7b525188c2be9))
* **infra:** bring rally prod stack to parity with develop ([#56](https://github.com/QNSC-VN/rally/issues/56)) ([e50d250](https://github.com/QNSC-VN/rally/commit/e50d2501868f0c718c1840dae9dba0289f1632ca))
* **infra:** dev API on Cloudflare-proxied subdomain; lock ALB to CF IPs ([b3958f2](https://github.com/QNSC-VN/rally/commit/b3958f2f50f87b8c35665926d1796d3b5bef44b0))
* **infra:** migrate develop to shared runtime (Option A) ([#22](https://github.com/QNSC-VN/rally/issues/22)) ([30187f2](https://github.com/QNSC-VN/rally/commit/30187f2e91a5a32d335763a40d8309c9ad24d3e2))
* **iterations:** add assignment-options endpoint and wire teamId in frontend pickers ([cdc0053](https://github.com/QNSC-VN/rally/commit/cdc005316948f65c81356d3af019ddfd42f332f4))
* phase 2 - backlog (P2.1), timeboxes (P2.2) and iteration status (P2.3) ([703e9a4](https://github.com/QNSC-VN/rally/commit/703e9a46693fd3f5a8a0a21440de3f6b73a2e6f7))
* phase 3 — milestones, quality/defects, releases, team status, and settings pages ([#50](https://github.com/QNSC-VN/rally/issues/50)) ([d00ea23](https://github.com/QNSC-VN/rally/commit/d00ea232a17fc798580e10bd4ecb0c572b33732d))
* rally monorepo — consolidate rally-api + rally-web + rally-infra ([85da7c2](https://github.com/QNSC-VN/rally/commit/85da7c2385c38e26866b1f4217fc0e73799bf7c0))
* **rbac:** shared permission catalogue + scope-aware per-project authorization ([cb79347](https://github.com/QNSC-VN/rally/commit/cb793478b45c007eb92c50eb67e4924cde7c1fac))
* same-origin BFF auth (Entra confidential client), remove legacy MSAL ([#43](https://github.com/QNSC-VN/rally/issues/43)) ([555aa22](https://github.com/QNSC-VN/rally/commit/555aa22a6d76cf1fbfe4cffd86ec09b66a8fb618))
* **seed:** add phase 0/1/2 test data and fix project members displayName ([bed1f9b](https://github.com/QNSC-VN/rally/commit/bed1f9b6effb0b4ca473cce7c42bcb0740b86581))
* **seed:** add Phase 2 data — teams, iterations, releases, extended work items ([8f144bf](https://github.com/QNSC-VN/rally/commit/8f144bf58b726d7e465866af64f96cae3daf4161))
* **seed:** RBAC/PBAC demo coverage + restrict SSO to qnsc.vn ([1988d3b](https://github.com/QNSC-VN/rally/commit/1988d3b3c8eae2751f50e2f51f873fe5596afe99))
* **ui:** enterprise DRY primitives - Spinner, Skeleton, NativeSelect, SaveIndicator, useSaveState; router prefetch ([d300030](https://github.com/QNSC-VN/rally/commit/d30003063a980748c0f0602c9a520b19f6b59d45))
* **ui:** enterprise UX improvements - toast feedback, Tooltip component, error handling ([5c41ad7](https://github.com/QNSC-VN/rally/commit/5c41ad7b25a28259b12c52eb67ed1a7d484c5dd4))
* **web:** add shared UI component layer for enterprise consistency ([4cdbdf2](https://github.com/QNSC-VN/rally/commit/4cdbdf2af3f5ed936833525848e2d4af5dcf859d))
* **web:** migrate rally SPA to Cloudflare Pages (drop CloudFront) ([#19](https://github.com/QNSC-VN/rally/issues/19)) ([1229f78](https://github.com/QNSC-VN/rally/commit/1229f78438fd56cc3ffded3b952b2f73360d7f3f))
* **web:** team context selection and create-flow auto-fill ([eefa77a](https://github.com/QNSC-VN/rally/commit/eefa77a8776ccf5d59240462844d748e7d0d8308))


### 🐛 Bug Fixes

* add double-submit CSRF protection to refresh token endpoint ([969e5f4](https://github.com/QNSC-VN/rally/commit/969e5f44f3dfd632e609788539fc3d34ee56b6ce))
* **api:** dedupe fastify to 5.10.0 to repair backend build ([#35](https://github.com/QNSC-VN/rally/issues/35)) ([e3c7a44](https://github.com/QNSC-VN/rally/commit/e3c7a4498a6d6ee436805ba7325258fb6707cf7b))
* **api:** remove unnecessary type assertion in project-member repository ([8e7dbc7](https://github.com/QNSC-VN/rally/commit/8e7dbc79530daf6b6654284efca3ce5fbd1b3768))
* **api:** serve health probes under /v1 prefix ([be697dd](https://github.com/QNSC-VN/rally/commit/be697dd76a1549b6249afc84a7db13ae7f9e19e1))
* **auth:** self-heal SSO login, split seed by env, add refresh rotation grace ([#40](https://github.com/QNSC-VN/rally/issues/40)) ([1ebfeab](https://github.com/QNSC-VN/rally/commit/1ebfeab95afaf03dd9f23cef3352b3aadce9a105))
* **backlog:** use human-readable labels for Schedule State inline dropdown ([c77c645](https://github.com/QNSC-VN/rally/commit/c77c64513ac66ec651e5649d17059d6d8fe2de95))
* **build:** repair root typecheck scope, spec type errors, and web test setup ([48c48e7](https://github.com/QNSC-VN/rally/commit/48c48e7cdbfd55dc46ffd7c9210f8b45c2edb1a9))
* **build:** resolve TS errors and polish FE interactions ([2649077](https://github.com/QNSC-VN/rally/commit/26490777b131dcb71229d700366ad7cc30115590))
* bump stale module version pins in prod to match develop ([fcfdb76](https://github.com/QNSC-VN/rally/commit/fcfdb769d6f5e09dee578a09ec4d4369d0a16d48))
* **ci:** add pull_request edited trigger so title changes re-run checks ([b33c5ef](https://github.com/QNSC-VN/rally/commit/b33c5ef1302d16e3d5d7cabb2196c05ef671e544))
* **ci:** add pull-requests:read permission for PR title check ([8770f4c](https://github.com/QNSC-VN/rally/commit/8770f4c7d66a43aa28032a293bacfff82c8dd501))
* **ci:** add Trivy CVE scan before attest; fix ECS wait timeout ([46b332b](https://github.com/QNSC-VN/rally/commit/46b332bd06b4c89bb74169a9d2f812c3b756d16d))
* **ci:** configure git credentials for private module cloning in tofu init ([d8bf6ac](https://github.com/QNSC-VN/rally/commit/d8bf6aca8fab0baf58487bc3cd72b64dc406140b))
* **ci:** correct infra workflow paths from live/ to infra/live/ ([5657c97](https://github.com/QNSC-VN/rally/commit/5657c970135e5efb3daf2ebf21abc7e2fede6f84))
* **ci:** fix 4 failing CI checks on main ([12acc06](https://github.com/QNSC-VN/rally/commit/12acc06d79407dcae346ca262ae86b93245e0bf2))
* **ci:** fix YAML error in release-commenter, fix role ARN→name in RDS policy ([dde2932](https://github.com/QNSC-VN/rally/commit/dde2932c83431260496af68db983bdc156fdeec4))
* **ci:** gitleaks toml syntax + exclude apps/web from backend tsc ([c564390](https://github.com/QNSC-VN/rally/commit/c56439023c026df3d3fa521cf60f32894f8f2785))
* **ci:** grant id-token permission to infra-plan caller ([#52](https://github.com/QNSC-VN/rally/issues/52)) ([9448809](https://github.com/QNSC-VN/rally/commit/94488091fa6f2f1c42acd782690583efa0210b75))
* **ci:** grant packages:read to the security caller ([#45](https://github.com/QNSC-VN/rally/issues/45)) ([a45d501](https://github.com/QNSC-VN/rally/commit/a45d501d8adad74c9961b98b4772c8b26eddc09b))
* **ci:** ignore Go stdlib CVEs in esbuild dev-tool binary ([42a4cfa](https://github.com/QNSC-VN/rally/commit/42a4cfa65e1d54cd717bc4bc370e19f240b51b1c))
* **ci:** make dependency review non-blocking on private repos without GHAS ([ae29ca4](https://github.com/QNSC-VN/rally/commit/ae29ca4f54192a07a915817bbf55d6dd7ca0a3e1))
* **ci:** read CLOUDFLARE_ACCOUNT_ID as a variable, not a secret ([#53](https://github.com/QNSC-VN/rally/issues/53)) ([128df00](https://github.com/QNSC-VN/rally/commit/128df0068675316cfe97b62e87fd3901ccb9b52c))
* **ci:** release.yml — use continue-on-error for app-token fallback ([feaf9b6](https://github.com/QNSC-VN/rally/commit/feaf9b6336de40d6d2dcba30c4d113db3ad18f28))
* **ci:** remove unused imports, fix eslint warnings in app-shell ([fbed799](https://github.com/QNSC-VN/rally/commit/fbed799b311deb73238baa07eff0cda579548a42))
* **ci:** scope concurrency groups — ci-backend / ci-web ([391a447](https://github.com/QNSC-VN/rally/commit/391a4475d0b58129a9d25d84bf8120e708eb20de))
* **ci:** simplify tofu git config now qnsc-tf-modules is public (no app token needed) ([347ade7](https://github.com/QNSC-VN/rally/commit/347ade71e4e9819c1012f9847db02395939e6d4d))
* **ci:** skip dependency review (requires GHAS paid license) ([bb345ff](https://github.com/QNSC-VN/rally/commit/bb345ffd9b69d762f8f2b37fb48deffacf26ca6c))
* **ci:** SLSA attestation requires paid plan — add continue-on-error ([ddeb436](https://github.com/QNSC-VN/rally/commit/ddeb436f7d2df71fc6a6051432a9ddfe5ae8c150))
* **ci:** trivy-action 0.37.0 → 0.36.0 (latest) ([b3d1d06](https://github.com/QNSC-VN/rally/commit/b3d1d06abe4bb86b32a7349189d9879b01c645a6))
* **ci:** trivy-action tag needs v prefix (v0.36.0) ([30fde34](https://github.com/QNSC-VN/rally/commit/30fde34d3895cc69b6b422fbf0c603328259765e))
* **ci:** use GitHub App token for cross-repo private module access in tofu init ([0b9150d](https://github.com/QNSC-VN/rally/commit/0b9150d5c2f2702b3fc5d793b59649f0dc63bd39))
* **ci:** use qnsc-ci@v1.3 with fixed action SHAs for infra apply ([2a9517c](https://github.com/QNSC-VN/rally/commit/2a9517ca4049526ef668d4fad09cd6e82a68472a))
* **ci:** use qnsc-ci@v1.4 (fresh tag with fixed action SHAs) ([eed4aa5](https://github.com/QNSC-VN/rally/commit/eed4aa59de8206fe90ce15eaf004a9a6a5b47855))
* **ci:** use qnsc-ci@v1.5 (correct SHA for fixed action) ([d590105](https://github.com/QNSC-VN/rally/commit/d59010591204e2409620fff98f3e87914b1e4247))
* **ci:** use setup-tofu-aws@v1.2 composite action in infra workflows ([e0ec2bc](https://github.com/QNSC-VN/rally/commit/e0ec2bc54302c2d87568cc4c805619815e077dc8))
* **ci:** use vars instead of secrets for non-sensitive ACM/Entra config ([7f4b810](https://github.com/QNSC-VN/rally/commit/7f4b8106d1a899525d08910280574d695a20064a))
* **ci:** web deploy uses apps/web/dist; e2e passes with no tests ([b0e8827](https://github.com/QNSC-VN/rally/commit/b0e882708b9ddf95597574dfdc9e85b50ecdfbc3))
* correct CSRF cookie name mismatch and stabilize Ctrl+Enter shortcut ([020768b](https://github.com/QNSC-VN/rally/commit/020768b989a4af7e5981b9abaf708b0dc24a63e0))
* correct stale filenames in infra CI path filters, add manual dispatch ([d7e8c1a](https://github.com/QNSC-VN/rally/commit/d7e8c1a11dfd4d7772d791908c9ef9aae3147cbd))
* **db:** allow develop migrator to seed despite NODE_ENV=production ([#37](https://github.com/QNSC-VN/rally/issues/37)) ([b8dafcc](https://github.com/QNSC-VN/rally/commit/b8dafcc8201145cd141e7ac566df71c2bb35e03e))
* **db:** backfill member_capacity skipped by duplicate migration timestamp ([#65](https://github.com/QNSC-VN/rally/issues/65)) ([b60ab24](https://github.com/QNSC-VN/rally/commit/b60ab2421d78713767f367106e648abded27917f))
* **db:** drop/recreate attachments partial index across enum type change ([2e810f1](https://github.com/QNSC-VN/rally/commit/2e810f1283f31752c5f840f61dc90effa781cf12))
* **db:** widen project_counters PK before per-type seed in 0036 ([#60](https://github.com/QNSC-VN/rally/issues/60)) ([e398b3b](https://github.com/QNSC-VN/rally/commit/e398b3b313b7fb035a92f07b5d8a1baba16a7d5b))
* **deploy:** grant ecs:ListTasks + wake ECS in dev deploy guard ([adf56e5](https://github.com/QNSC-VN/rally/commit/adf56e5057ce41c83b03947fb673ac72e531298d))
* **deploy:** wait for RDS availability before migration (dev cost-saver guard) ([2d758cc](https://github.com/QNSC-VN/rally/commit/2d758cceb34fe3473f40d59df4bf824ce193231e))
* disable RDS CA verify for VPC-internal connections ([d8aa7f6](https://github.com/QNSC-VN/rally/commit/d8aa7f6b2921d096113ee3033d21f54bf7a67880))
* **docker:** bump Alpine 3.21 → 3.22 to fix CVE-2025-68121 ([3c1d497](https://github.com/QNSC-VN/rally/commit/3c1d497fe2d0cc4131c9994db4af38a177dd9e52))
* elevateToWorkspaceAdmin preserves project-scoped roles ([903d45d](https://github.com/QNSC-VN/rally/commit/903d45db909cc5a979143def2ad1d714ba65076e))
* enforce tenant isolation in repository findById/update/softDelete ([a37beec](https://github.com/QNSC-VN/rally/commit/a37beec4cfb8b4ed1953fa4a822b4275cd9a1c65))
* extract pgOptions helper, apply SSL fix to seed.ts ([0861638](https://github.com/QNSC-VN/rally/commit/0861638aaf15d71ae7e70730050c1d72cd0938a6))
* harden auth and access — wildcard perms, rate limit, constants, DRY ([a136fe9](https://github.com/QNSC-VN/rally/commit/a136fe9c2156a522412b5313eb203bec93e40fe4))
* **infra/develop:** fix 502 on /v1/* — ALB http-only + forward rule ([291bbdb](https://github.com/QNSC-VN/rally/commit/291bbdbab0b97aa9217c14b46e5343a185184614))
* **infra/develop:** pass ENTRA_TENANT_ID to migrator task for SSO seed ([25988f6](https://github.com/QNSC-VN/rally/commit/25988f626fb60a1dcb1f7283cf176d765ade97c6))
* **infra:** add rds:DescribeDBInstances+StartDBInstance to develop deploy role ([c50e932](https://github.com/QNSC-VN/rally/commit/c50e932e54f27614dbfe97934261ecd83b218235))
* **infra:** bump dns-record to v1.1.0 to adopt orphaned CNAME ([#24](https://github.com/QNSC-VN/rally/issues/24)) ([f9b73c5](https://github.com/QNSC-VN/rally/commit/f9b73c5eac7c808ce61914b7ac2f66c2d49a4885))
* **infra:** set Pages Function API_ORIGIN for same-origin BFF proxy ([#47](https://github.com/QNSC-VN/rally/issues/47)) ([e404a5b](https://github.com/QNSC-VN/rally/commit/e404a5b303b94ef33f2aa28e97e1bb1a8ac96ccf))
* **infra:** update monorepo refs (rally-api→rally, rally-infra→rally) in OIDC module ([698b9e2](https://github.com/QNSC-VN/rally/commit/698b9e2c855db82797dab043bb33d936d8aae3ff))
* **infra:** use iam-oidc-v1.1.0 with StringLike wildcard for environment OIDC support ([1d82541](https://github.com/QNSC-VN/rally/commit/1d82541842a0308231c1f6ab0d0a582c8c931bf0))
* **jwt:** align test keys to ES256 (EC P-256) ([df0443f](https://github.com/QNSC-VN/rally/commit/df0443fd380c4057fc2c95f042e70b62c5aed07b))
* **jwt:** correct .env.example keygen comment from EdDSA to EC P-256 ([6b33f79](https://github.com/QNSC-VN/rally/commit/6b33f79fc4907661aae9929c905a543152b5749a))
* migration enum cast and stale type assertions in attachment repo ([c8886d2](https://github.com/QNSC-VN/rally/commit/c8886d22f44a61cbb7a9ed16947f7ee1c96e215f))
* **phase2:** UI verification fixes for P2.2 and P2.3 ([4f56948](https://github.com/QNSC-VN/rally/commit/4f5694822c477d0d6911a748a4297f1c71ca0258))
* RDS dev-guard policy no longer needs the instance to already exist ([17ef18e](https://github.com/QNSC-VN/rally/commit/17ef18ebb7ceebf9499e801c99f8c7355b237314))
* **release:** emit vX.Y.Z tags so Release PR triggers deploy ([#66](https://github.com/QNSC-VN/rally/issues/66)) ([ee75781](https://github.com/QNSC-VN/rally/commit/ee75781d9b2bda11a8c2f4c22a5b898e126a5704))
* rename prod web bucket, rally-web-prod is claimed by another AWS account ([0fc293a](https://github.com/QNSC-VN/rally/commit/0fc293ac8a82801b402cf97d83eba4e68d7bc92b))
* resolve broken home metric links, add error states, work item delete ([cfaf52f](https://github.com/QNSC-VN/rally/commit/cfaf52fd117aca24e7dd3de922149c95edb55472))
* **seed:** link seeded teams to their projects (project_teams) ([bf797ec](https://github.com/QNSC-VN/rally/commit/bf797ec360989c86d9b442147e9fbd920b344cf7))
* **seed:** prevent counter regression with GREATEST, add release:manage to admin roles ([c6ae09e](https://github.com/QNSC-VN/rally/commit/c6ae09e1c02e6a86a7fa9e4f6a2d04228bdbcdc9))
* **spec:** restore missing imports and update stale fixtures ([93564f9](https://github.com/QNSC-VN/rally/commit/93564f9badb17cfa49ef40c0b291bf6af9bc5abd))
* stale projectId in release mutations and form sync during render ([9511e8f](https://github.com/QNSC-VN/rally/commit/9511e8f3f070918cc5876b806bd189f72f3e253a))
* strip sslmode from URL before passing ssl config to pg ([215547f](https://github.com/QNSC-VN/rally/commit/215547ffcf8837ce0cdb1c62d8695a969a4c8366))
* **test:** LOG_LEVEL 'silent' not valid — use 'error' ([805374f](https://github.com/QNSC-VN/rally/commit/805374f1ae888a38a253d16d7e37d2cb4faacaf9))
* **tests:** fix 2 failing unit tests ([4030096](https://github.com/QNSC-VN/rally/commit/403009658dc49a5ac203fad023171f7c6fa70427))
* TypeScript type errors and PLATFORM_ADMIN_EMAILS elevation ([ba5847a](https://github.com/QNSC-VN/rally/commit/ba5847a58f3a22e77a0eada68fb12c6e1d147cce))
* **ui:** add cursor-pointer and hover states to all interactive buttons ([c853d5c](https://github.com/QNSC-VN/rally/commit/c853d5c1733276416b9fe5d9b017cf6463144acb))
* **ui:** add focus ring to RichTextEditor matching Input/Textarea style ([5645aea](https://github.com/QNSC-VN/rally/commit/5645aea59b7f494f4475be12af43e756d14cb89b))
* **ui:** correct mismatched InlineSelect/NativeSelect JSX tags ([9c59f56](https://github.com/QNSC-VN/rally/commit/9c59f562a014168362d27d2b87e44c667e836647))
* unify PLATFORM_ADMIN_EMAILS elevation and add missing permission guards ([4a60e83](https://github.com/QNSC-VN/rally/commit/4a60e837367c8e8cc3fbe0875b61344a4e6c5832))
* web-deploy IAM trust policy referenced archived rally-web repo ([ea055fe](https://github.com/QNSC-VN/rally/commit/ea055fe35e1bc4a6832e46651c2fa5c57aa27df4))
* **web-deploy:** deploy Pages Functions from apps/web working dir ([#54](https://github.com/QNSC-VN/rally/issues/54)) ([ce6ad8d](https://github.com/QNSC-VN/rally/commit/ce6ad8db8e3fd9786c4c5063ff02f952b8f21939))
* **web:** consistent cursor-pointer + fix grid ID column overflow ([#62](https://github.com/QNSC-VN/rally/issues/62)) ([1a2ab78](https://github.com/QNSC-VN/rally/commit/1a2ab787be0bc8347c9a9a8591519ef0c888ab4f))
* **web:** fix backlog table overflow and inline-select text truncation ([f0af649](https://github.com/QNSC-VN/rally/commit/f0af649f7bde3277e587540178a2d13c4daefe6d))
* **web:** fix network error — CloudFront proxies /v1/* to ALB ([ddad4e4](https://github.com/QNSC-VN/rally/commit/ddad4e489e885e8c65b68b1f2d0688ab0cdde78b))
* **web:** resolve pre-existing eslint errors ([e2ea849](https://github.com/QNSC-VN/rally/commit/e2ea8490b94c2697a03ae73f22e5e4a1cf4f3e8c))
* **web:** sign-out redirects to /login for password sessions, not Microsoft ([fbaea05](https://github.com/QNSC-VN/rally/commit/fbaea055605eab9e39f53da6801b3f44c062fba8))
* **web:** unwrap members array response correctly in useProjectMembers ([8460ae0](https://github.com/QNSC-VN/rally/commit/8460ae0e50b6245c0c0310d303cd077f1102c93e))
* **work-items:** enforce project-tier work_item:view on read endpoints ([#69](https://github.com/QNSC-VN/rally/issues/69)) ([de82fc3](https://github.com/QNSC-VN/rally/commit/de82fc3899bf45c3aaee73ff0cf750f2d89777ad))


### ♻️ Refactors

* **access:** project-scoped writes + monotonic roles; migration upgrade-path CI gate ([4a3e548](https://github.com/QNSC-VN/rally/commit/4a3e548feba63cf49b70f8cec011767e39109cc3))
* adopt shared alb, dns-record, oneshot-task modules; export cloudflare facts from bootstrap ([c14e1f3](https://github.com/QNSC-VN/rally/commit/c14e1f3010481a51895a33551d398169b62c2298))
* **auth:** delegate workspace-tier guard to @qnsc-vn/identity ([#70](https://github.com/QNSC-VN/rally/issues/70)) ([c4bd59b](https://github.com/QNSC-VN/rally/commit/c4bd59be798b2f67a98e23ed44ae468b1cd62049))
* **auth:** remove legacy ENTRA_DEFAULT_TENANT_ID SSO fallback ([4232fa5](https://github.com/QNSC-VN/rally/commit/4232fa5b047f1176c5dc28c4bc699ec57f8208cf))
* **auth:** remove password login, SSO-only (mirror opshub) ([#38](https://github.com/QNSC-VN/rally/issues/38)) ([90c0cc0](https://github.com/QNSC-VN/rally/commit/90c0cc08b5150690d52ce3b4a7a0a8ae3c1b3ea2))
* drop multi-tenancy, merge tenant into workspace ([#33](https://github.com/QNSC-VN/rally/issues/33)) ([71f9cc5](https://github.com/QNSC-VN/rally/commit/71f9cc5940828a4ea58cd3551415ac9bcc45c67d))
* **infra:** drop vestigial acm_cert_arn plumbing ([#51](https://github.com/QNSC-VN/rally/issues/51)) ([2887ba1](https://github.com/QNSC-VN/rally/commit/2887ba108d51ca102787ba8e3c010f783fdd5adf))
* **infra:** make develop deployment_mode a variable, symmetric with prod ([7004f42](https://github.com/QNSC-VN/rally/commit/7004f4281f85aeba6769b3a3c09496b88d77c2f9))
* NativeSelect/InlineSelect migration, query key factories, Zustand devtools ([a9a8ecc](https://github.com/QNSC-VN/rally/commit/a9a8ecc27208ec185df5ab8a328b62232f268bd6))
* **prod:** drop lean/ha tier, single clean prod config ([#58](https://github.com/QNSC-VN/rally/issues/58)) ([f70322a](https://github.com/QNSC-VN/rally/commit/f70322ac8ebcd0ce53d9f3693ea15d2ad3241844))
* remove dead code + dedupe the wildcard-permission check ([6775fea](https://github.com/QNSC-VN/rally/commit/6775feab044092bb6ad8655ee0803135f479779e))
* **web:** extract shared OwnerCell component ([#64](https://github.com/QNSC-VN/rally/issues/64)) ([1c013ac](https://github.com/QNSC-VN/rally/commit/1c013ac9c607d6a3de083a248ce66f70f098f8a4))


### 🔒 Security

* untrack terraform.tfvars (move to .gitignore) ([a086e91](https://github.com/QNSC-VN/rally/commit/a086e91b50286a235025faf512e04ec0679f7a02))


### 📦 Dependencies

* bump the development-dependencies group across 1 directory with 14 updates ([21c68eb](https://github.com/QNSC-VN/rally/commit/21c68eb7434ed4b51eb0edefa7a6afa6b977b52b))
* bump the development-dependencies group with 3 updates ([#17](https://github.com/QNSC-VN/rally/issues/17)) ([5949737](https://github.com/QNSC-VN/rally/commit/59497370af46d35bb98de0384102f49d140ac1a3))
* bump the production-dependencies group across 1 directory with 21 updates ([#11](https://github.com/QNSC-VN/rally/issues/11)) ([5d53641](https://github.com/QNSC-VN/rally/commit/5d53641d6d2df1086a32862826fae48a5f45fb8c))
