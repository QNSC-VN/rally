/**
 * Member progress on Team Status — ONE formula, wherever the row is drawn from.
 *
 * Team_Status SRS §10: `Progress Percent = actualHours / estimateHours * 100`, capped at 100, and
 * `0` when there is no estimate to measure against. The server computes exactly this in
 * `TeamStatusService.buildMemberGroup` for the unfiltered group.
 *
 * It exists because the page had a SECOND definition: under the State filter it recomputed the bar
 * as `completedTaskCount / taskCount * 100`. That is a different metric wearing the same label —
 * one measures hours burned, the other counts rows — so filtering silently redefined it, and a
 * member with 1 of 2 tasks Completed read 50% under a filter and 12% without one. A filter may
 * change the POPULATION a number is measured over; it may never change the formula.
 */
export function memberProgressPercent(estimateHours: number, actualHours: number): number {
  if (!(estimateHours > 0)) return 0
  return Math.min(100, Math.round((actualHours / estimateHours) * 100))
}
