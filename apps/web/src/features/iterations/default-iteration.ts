/**
 * Which iteration a surface opens on when the reader has not chosen one.
 *
 * THE DEFECT THIS EXISTS TO REMOVE: every caller used `iterations[0]`, so the default was whatever
 * the server's `ORDER BY` happened to put first. That is not a default, it is an accident, and it
 * broke the moment the ordering legitimately changed — the reference feed introduced with
 * `GET /iterations/options` orders `startDate DESC` where the record list ordered `createdAt ASC`,
 * so `[0]` became the FUTURE sprint. Iteration Status then rendered no rows and Iteration Burndown
 * no series, both of which read as "this sprint has nothing in it" rather than "you are looking at a
 * sprint that has not started". Two Playwright journeys caught it; nothing in the type system could.
 *
 * So the rule is stated here once, in terms of the DOMAIN rather than of row order. STATE leads, and
 * that is the correction that matters: a first attempt ordered by date alone and picked whichever
 * window started most recently, which on real data was a `planning` sprint — one with no work broken
 * down and no recorded history, so Iteration Status and the Burndown were just as empty as before.
 * "The current sprint" means the one being EXECUTED, not the one that starts next:
 *
 *   1. among `committed` — the sprint being worked — the one whose window contains today, else the
 *      latest to have started. This is what a reader arriving at Iteration Status means by "now";
 *   2. else the latest `accepted` one: between sprints, a team looks back at what just closed;
 *   3. else the earliest `planning` one: nothing has been committed yet, so the nearest is next up;
 *   4. else the first row, then `null` — callers already handle "no timebox to show".
 *
 * Dates are the plain `YYYY-MM-DD` strings the API returns, so string comparison IS date comparison
 * and no parsing (or timezone) is involved. A row missing a date cannot win a date comparison, but it
 * can still be chosen by STATE — a committed sprint with no window is still the committed sprint.
 *
 * Callers must NOT re-sort the list to influence this — the whole point is that position carries no
 * meaning. Order the list for the READER (the picker shows newest first); decide the default here.
 */

/** The shape this needs and nothing more, so both the reference feed and the record satisfy it. */
export interface IterationWindow {
  id: string
  /** `planning | committed | accepted`. Compared as a string so the union can grow server-side. */
  state: string
  startDate: string | null
  endDate: string | null
}

/** Today as `YYYY-MM-DD` in the reader's own zone — the same basis the pickers label dates with. */
function today(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Within one state group: the window containing today, else the latest to have STARTED, else the
 * earliest still to start. The middle rule is the one to get right — "latest by start date" alone
 * picks a sprint that has not begun, which is the same empty screen this module exists to prevent.
 */
function pickByWindow(list: readonly IterationWindow[], now: string): IterationWindow {
  const dated = list.filter(
    (i): i is IterationWindow & { startDate: string } => i.startDate !== null,
  )
  if (dated.length === 0) return list[0]

  const current = dated.find((i) => i.startDate <= now && (i.endDate ?? now) >= now)
  if (current) return current

  const started = dated.filter((i) => i.startDate <= now)
  // `reduce`, not `sort`: the caller's array is the one the picker renders and must not move.
  if (started.length > 0) {
    return started.reduce((best, i) => (i.startDate > best.startDate ? i : best))
  }
  return dated.reduce((best, i) => (i.startDate < best.startDate ? i : best))
}

export function defaultIterationId(
  iterations: readonly IterationWindow[],
  now: string = today(),
): string | null {
  if (iterations.length === 0) return null

  for (const state of ['committed', 'accepted', 'planning'] as const) {
    const group = iterations.filter((i) => i.state === state)
    if (group.length > 0) return pickByWindow(group, now).id
  }

  // A state this function does not know about. Any answer is arbitrary, so give the reader an
  // openable row rather than nothing.
  return iterations[0].id
}
