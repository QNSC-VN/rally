# deploy/ecs — ECS deploy descriptors

Rally's ECS **task definitions are infrastructure-owned**, not stored as standalone JSON templates here. This is deliberate and matches the OpenTofu↔deploy boundary in [TECH_STACK.md §3](https://github.com/QNSC-VN/.github/blob/main/docs/TECH_STACK.md):

- **Baseline task definitions + services** are created by the `ecs-service` module in [`infra/live/<env>/main.tf`](../../infra/live) (family, CPU/mem, IAM task role, secrets, ALB target group, autoscaling).
- **CI patches only the image** on each deploy: `aws ecs describe-task-definition` → swap the container image tag → `aws ecs register-task-definition` (new revision) → `aws ecs update-service`. See `.github/workflows/` (via `QNSC-VN/qnsc-ci`).
- The **migrator** one-off task def is defined inline in `infra/live/<env>/main.tf` and run as an ECS `run-task` gate before the API rolls out.

So there is no task-def template to maintain here — OpenTofu owns the shape, CI owns the image tag. This file documents that contract.

**At the EKS phase** (architecture §13.2, trigger-driven) this directory is replaced by a Helm `chart/`, and CD moves from push (`update-service`) to pull (ArgoCD).
