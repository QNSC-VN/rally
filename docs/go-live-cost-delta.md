# Go-live cost delta — what launch does to the AWS bill

**Bottom line: the bill roughly triples at go-live, from ~$140/mo to ~$305/mo, and none
of that increase is waste.** It is the price of the durability and observability that
production is deliberately running without while it has no users.

This exists because the go-live checklist in `infra/live/prod/main.tf` has never been
costed. Every item in it is correct; the total was simply never added up. A CEO
optimising a $140 bill should know it is about to become $305+ regardless of what is
trimmed today.

Prices are ap-southeast-1 (Singapore), on-demand, as of 2026-08. Monthly figures assume
730 hours.

## The two postures

Production today is **pre-launch idle**: zero tasks, RDS stopped, no cache node, several
alarms off. That is not a degraded state — it is a deliberate, documented posture with a
defined end date, and `infra/live/prod/main.tf` names every flag that flips.

| | today (idle) | at go-live | delta |
|---|---|---|---|
| RDS instance | t4g.micro, **stopped** (bills $0) | t4g.small Multi-AZ | **+$96.36** |
| RDS storage | 30 GB gp3 | 30 GB gp3 Multi-AZ (×2) | **+$4.14** |
| RDS Enhanced Monitoring | off | 60s interval | **+$2.10** |
| Fargate api | 0 tasks | 1× 1024/2048 on-demand | **+$41.45** |
| Fargate worker | 0 tasks | 1× 512/1024 Spot | **+$6.22** |
| ElastiCache | none | cache.t4g.micro | **+$12.41** |
| CloudWatch alarms | 12 | 21 (autoscaling + target health) | **+$0.90** |
| **total** | | | **+$164/mo** |

Add the dev environment and shared platform layer, which do not change at go-live:

| | $/mo |
|---|---|
| current run-rate (both environments bundled, 2026-08-02) | ~140 |
| go-live delta | +164 |
| **projected at launch (1 task per service)** | **~305** |
| with realistic autoscaling headroom (see below) | **~345** |

The ~$140 baseline is a projection from the last complete billing day, not a settled
month. July's actual bill was $264.72, but most of that was costs that no longer exist
(interface VPC endpoints, Multi-AZ RDS, AWS Config at CONTINUOUS recording, Container
Insights). August is the first clean read.

## Line by line

### RDS: +$102.60 — the single biggest item, and more than half the total delta

The checklist flips three things together:

```hcl
instance_class      = "db.t4g.small"   # 2 GB rather than 1 GB
multi_az            = true             # AZ failure becomes a failover, not an outage
monitoring_interval = 60               # per-process and per-device visibility
```

These compound. Multi-AZ doubles the instance rate **and** bills the mirrored volume,
and the class change doubles the base rate before that:

| | rate | $/mo |
|---|---|---|
| t4g.micro single-AZ | $0.033/hr | 24.09 |
| t4g.small single-AZ | $0.066/hr | 48.18 |
| **t4g.small Multi-AZ** | **$0.132/hr** | **96.36** |

The instance is **stopped today**, billing storage only — so the delta against the live
bill is the full $96.36, not the difference between two running instances. That is the
single most important number in this document and the easiest one to underestimate.

Plus:

- storage mirror: 30 GB × $0.138 = **+$4.14**
- Enhanced Monitoring at 60s ≈ **+$2.10/mo** in CloudWatch metrics

`prod/main.tf` already argues this correctly: every dollar currently buys durability for
a database with no users. That reverses the moment there are users.

### Fargate: +$47.67

Both services sit at `min_count = 0` today. Production has **never served a real user** —
the ALB logged 4, 1, 0, 1 requests on four consecutive days, and the non-zero days since
are SCM webhooks and synthetic probes.

At go-live both floors return to 1:

- **api**, 1024 CPU / 2048 MB, on-demand: (1 × $0.04656 + 2 × $0.00511) × 730 =
  **$41.45/mo**
- **worker**, 512 CPU / 1024 MB, on-demand would be $20.72; at ~70% Spot discount →
  **$6.22/mo**

The worker being Spot is worth $15.60/mo and is already justified in the code: the relay
claims rows `FOR UPDATE SKIP LOCKED` and every write is an idempotent upsert, so an
interruption loses no work. The api stays on-demand because an interruption there is a
dropped request and a broken SSE stream.

### ElastiCache: +$12.41

`cache.enabled = false` today. ElastiCache has no stopped state — only delete — so the
node is the one component of an idled environment that keeps billing, which is why it
was removed.

cache.t4g.micro: $0.017/hr = **$12.41/mo**.

A `check` block in the stack module enforces that `cache.enabled = false` and
`min_count = 0` move together, because a task that cannot reach its cache does not fail
— it falls back to localhost and runs with the token denylist and rate limiter **failed
open**. So restoring the cache is not optional at go-live; it is coupled to restoring
the floors.

Recreating the node issues a **new endpoint** and takes ~10 minutes. Harmless now
(no sessions to lose); not harmless later.

### CloudWatch alarms: +$0.90

Autoscaling returns (4 alarms per service × 2 = 8 at $0.10) and
`monitor_target_health` comes back on (1 alarm). 12 alarms today → 21.

`monitor_target_health` is the only alarm that catches an outage producing no load to
move CPU, latency or 5xx. It is off today precisely because zero tasks is the intended
state and the alarm treats missing data as breaching.

## What the table does not include

**Autoscaling headroom.** The figures above price *one* task per service — the floor,
not the steady state. `max_count = 10` for the api. Real traffic at
`cpu_target_pct = 60` will hold more than one task during business hours. A realistic
2-task average on the api adds **~$41/mo**, which is where the ~$345 figure comes from.
This is the number most likely to be wrong, in either direction, and only real traffic
will settle it.

**Data transfer.** Currently $0 because of the 100 GB/month free allowance, ~15%
consumed pre-launch — and **99% of that was ECR image pulls**, which scale with deploy
frequency, not users. Real user traffic starts consuming it. Past 100 GB/mo the rate is
~$0.12/GB.

`runtime-prod/main.tf` sets the trigger to revisit interface VPC endpoints at ~70 GB/mo
of internet egress, pinned to **one** subnet (~$28/mo, not the ~$85/mo that three
endpoints across three AZs cost in July).

**Backups past the free allowance.** Snapshots ≤ allocated storage are free. At 30 GB
allocated with 30-day retention, growth past that starts billing at ~$0.114/GB-month.

**Log volume.** Prod retains 90 days (SOC 2 CC7.2 minimum). Ingestion scales with
traffic; today it is negligible.

**opshub.** A second product already has `infra/live/prod` written against the shared
runtime layer. When it launches it adds its own RDS, cache, Fargate and secrets — a
second copy of most of this table. The shared ALB, VPC and NAT are already paid for and
do **not** double.

## What does not change at go-live

Worth stating, because it is where the money already is:

| | $/mo | why it is fixed |
|---|---|---|
| 2× ALB + 6 public IPv4 | 62 | shared platform layer; 3-AZ is load-bearing |
| dev environment | ~44 | unchanged by prod launch |
| 2× fck-nat instance | 8 | already the cheap option ($3 vs $33 NAT gateway) |
| secrets | 0.80 | post-bundling |
| Config, KMS, ECR, S3 | ~12 | already minimised |

The 3-AZ ALB is not padding: a 2-AZ ALB cannot reach targets in the third AZ, which
caused roughly one task placement in three to fail health checks and rolled back
opshub#85. That is documented in `runtime-dev/main.tf`.

## Recommendations

**1. Set the budget expectation at ~$305–345/mo, not $100.** The current <$100 target is
unreachable while both environments exist, and it does not survive launch under any
configuration. A production environment with Multi-AZ durability and one task per
service has a floor, and this is close to it.

**2. Do not pre-provision.** Every item above should flip **at** go-live, not before.
The current idle posture is correct and is saving roughly $164/mo right now.

**3. Watch these three after launch,** in order of how wrong the estimate could be:

- api task count under real traffic (the ±$40 line)
- data transfer out, once past the 100 GB free tier
- RDS storage growth — `max_allocated_storage_gb = 500` autoscales, and **RDS refuses to
  shrink a volume**. Treat any increase as permanent; coming back down needs the
  instance replaced (`docs/runbooks/rds-storage-shrink.md`).

**4. If the number is genuinely unaffordable, the lever is Multi-AZ, not trimming.**
Staying single-AZ on t4g.small saves **$52.32/mo** ($48.18 instance + $4.14 storage
mirror) — a third of the entire delta, and more than every other candidate combined. It
converts an AZ failure from a transparent failover into an outage plus a restore from
backup.

That is a business risk decision, not an engineering one. Make it deliberately, in the
open, rather than by leaving the flag unflipped and discovering the posture during an
incident.

**5. Revisit Fargate Spot for the api only if the budget forces it.** It saves ~$29/mo
and costs dropped requests and broken SSE streams on interruption. The worker is already
Spot for sound reasons; the api is not, for equally sound ones.

## The go-live checklist itself

For completeness, what flips (all in `infra/live/prod/main.tf`):

```hcl
monitor_target_health = true            # restore the outage alarm

# remove entirely — a schedule that stops production every Sunday
idle_schedule = "cron(0 1 ? * SUN *)"

cache = { enabled = true }              # ~10 min, issues a NEW endpoint

rds = {
  instance_class      = "db.t4g.small"
  multi_az            = true
  monitoring_interval = 60
}

api    = { min_count = 1, enable_autoscaling = true }
worker = { min_count = 1, enable_autoscaling = true }
```

A `validation` block on the stack module's `api` and `worker` variables enforces the
`min_count`/`enable_autoscaling` pairing, because autoscaling on with a floor of 0 is a
live environment that cannot self-heal: nothing publishes a metric at zero tasks, so
whatever scaled it down is permanent.

**One item is not in the file.** `v0.6.1` is tagged and promoted to ECR but was never
deployed — both prod approvals were cancelled on 2026-08-01 while prod was idle. The tag
and prod are permanently out of step, so go-live must **deliberately re-run the deploy
for the intended release** rather than assuming the newest tag is live.
