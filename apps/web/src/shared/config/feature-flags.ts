/**
 * Static feature flags — controls whether a feature is enabled in this deployment.
 * Separate from permissions: a feature can be permission-gated (who can use it)
 * AND feature-flagged (whether it's deployed/built at all).
 *
 * Phase 0: planning, iteration, quality, portfolio, releases, reports are not yet built.
 * Flip to `true` when the feature ships in a later phase.
 */
export const FEATURE_FLAGS: Record<string, boolean> = {
  'feature.backlog': true,
  // Phase 2: Timeboxes/Iterations (Plan) and Iteration Status (Track) are live.
  'feature.timeboxes': true,
  'feature.iteration-status': true,
  'feature.team-status': true,
  'feature.team-board': false,
  'feature.board': false,
  'feature.quality': true,
  'feature.portfolio': false,
  'feature.releases': true,
  'feature.milestones': true,
  'feature.reports': false,
  // Phase 0 features that are live:
  'feature.home': true,
  'feature.projects': true,
  'feature.notifications': true,
  'feature.settings': true,
} as const

export function isFeatureEnabled(flag: string): boolean {
  return FEATURE_FLAGS[flag] ?? false // unknown flags default to disabled
}
