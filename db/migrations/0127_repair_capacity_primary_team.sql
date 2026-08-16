-- Repair: a Feature that HAS a team on a plan but no primary reads as `Not assigned` (P5-CP-032).
--
-- `Planned Team Assignment` is projected from `is_primary` (`capacity-plans.service.ts`,
-- `primaryTeamId: row.isPrimary ? row.teamId : null`) while `Teams by Total` and the Team Capacity
-- rail are projected from `team_id` + `value`. All three read the same allocation ledger, which is
-- what P5-CAP-AC-020 requires — but they read different COLUMNS of it, so a row with a team and no
-- primary flag makes the selector say `Not assigned` beside a team chip and a charged rail. That is
-- exactly the retest evidence: "Planned Team displays `Not assigned` while the same row shows Team
-- Pegasus, estimate `Allocated 8`, and Team rail 8/30".
--
-- The WRITERS were fixed on 2026-08-06: `updateAllocation` promotes a parked row that gains a team
-- when the Feature has no primary yet, and `allocateToTeam` does the same on the park→team path and
-- on a first team row. Nothing repaired the rows written BEFORE that, and AC-020 is about state
-- "after save and reload" — so the ledger a planner reloads is still wrong on every such row. The
-- retest reproduced on rally-dev eight days after the writer fix, which is what a stranded row looks
-- like and not what a live writer defect looks like.
--
-- The only `is_primary` repair ever written is 0075's, which ran before those rows existed. This is
-- the backfill CLAUDE.md requires for a grain change over existing rows ("backfill inside the same
-- migration, always"); it is being written late rather than not at all.
--
-- Rule: for each (plan, Feature) where at least one allocation row names a team and NONE is primary,
-- promote exactly one — the OLDEST team-assigned row.
--
-- Why the oldest, and not the largest: it is the same choice 0075 made ("the first team to receive
-- work is the one that was assigned it", Rally's assign-then-allocate order) and the same choice the
-- live code makes every time it hands an orphaned assignment on — `oldestTeamAllocation`, whose own
-- docblock rejects "biggest allocation wins" because that would move ownership whenever a slice is
-- edited. A repair that picked differently from the service would be a second rule for one fact.
-- `created_at, id` is that function's exact ordering: `id` breaks the tie between two rows written in
-- the same statement, which `created_at` alone cannot do deterministically.
--
-- Why this cannot violate `uq_capacity_allocation_primary` — unique on
-- (plan_id, portfolio_item_id) WHERE is_primary, i.e. at most ONE primary row per (plan, Feature):
--   * `distinct on (plan_id, portfolio_item_id)` yields at most one id per group, so the UPDATE can
--     never write two primaries into the same group;
--   * the `not exists` clause skips any group that ALREADY has a primary, so it can never add a
--     second one beside a row the service set.
-- `ck_capacity_primary_has_team` is satisfied by `team_id is not null`, which is also what makes an
-- Unallocated placeholder ineligible: a parked row names no team, so it cannot own the work. A
-- Feature with only parked rows is therefore left alone — `Not assigned` is the TRUE answer there,
-- and inventing an owner for it would be the mirror defect.
with promotable as (
  select distinct on (a.plan_id, a.portfolio_item_id) a.id
  from work.capacity_plan_allocations a
  where a.team_id is not null
    and not exists (
      select 1
      from work.capacity_plan_allocations p
      where p.plan_id = a.plan_id
        and p.portfolio_item_id = a.portfolio_item_id
        and p.is_primary
    )
  order by a.plan_id, a.portfolio_item_id, a.created_at, a.id
)
update work.capacity_plan_allocations a
set is_primary = true,
    updated_at = now()
from promotable p
where a.id = p.id;
