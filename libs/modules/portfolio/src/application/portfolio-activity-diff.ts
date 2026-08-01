import type { ActivityDiffConfig } from '@modules/activity';

/**
 * Fields whose changes appear in a portfolio item's Revision History.
 *
 * `state` gets its own action, matching how milestones separate a status change from an
 * ordinary edit — a funnel transition is the event a reader scans for.
 *
 * `notes` / `releaseNotes` / `description` are declared as RICH TEXT so the logger records
 * that they changed without storing the body. That is the same rule every other module
 * follows and the reason `activity_logs` never holds rich text: the history is a feed, not
 * a second copy of the document.
 *
 * Deliberately excluded: `rank` (reordering is not a content change and would bury the
 * feed), and the derived rollup/progress/health values, which no one edits.
 */
export const PORTFOLIO_ACTIVITY_CONFIG: ActivityDiffConfig<Record<string, unknown>> = {
  fields: [
    'name',
    'description',
    'notes',
    'releaseNotes',
    'state',
    'projectId',
    'parentId',
    'teamId',
    'releaseId',
    'ownerId',
    'preliminaryEstimate',
    'refinedEstimate',
    'refinedItemCountEstimate',
    'plannedStartDate',
    'plannedEndDate',
    'marketReleaseDate',
  ],
  richText: ['description', 'notes', 'releaseNotes'],
  action: (f) => (f === 'state' ? 'portfolio_item.state_changed' : 'portfolio_item.updated'),
};
