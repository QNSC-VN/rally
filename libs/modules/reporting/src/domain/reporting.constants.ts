/**
 * Reporting domain constants. Keep magic numbers out of controllers/services so
 * the velocity window can be reasoned about (and tuned) in one place.
 */

/** Default number of recent completed sprints returned by the velocity report. */
export const VELOCITY_DEFAULT_SPRINTS = 6;

/** Upper bound on the velocity window to keep the query bounded. */
export const VELOCITY_MAX_SPRINTS = 20;
