import type { WorkItem, UpdateWorkItemInput } from '../domain/work-item.types';
import type { ActivityAction, ActivityChange } from '../domain/activity-log.types';

export interface ActivityDiffEntry {
  action: ActivityAction;
  change: ActivityChange;
}

// Rich-text fields: record that they changed, but never the body (SRS §7).
const RICH_TEXT_FIELDS = new Set([
  'description',
  'notes',
  'releaseNotes',
  'acceptanceCriteria',
  'blockedReason',
]);

/** Normalise numeric-string / null for stable comparison. */
function changed(before: unknown, after: unknown): boolean {
  const a = before === undefined ? null : before;
  const b = after === undefined ? null : after;
  if (a === null && b === null) return false;
  return String(a) !== String(b);
}

function entry(
  field: string,
  before: WorkItem,
  next: unknown,
  itemAction: ActivityAction,
  taskAction: ActivityAction,
  isTask: boolean,
): ActivityDiffEntry {
  const isRich = RICH_TEXT_FIELDS.has(field);
  return {
    action: isTask ? taskAction : itemAction,
    change: {
      field,
      old: isRich ? null : ((before as unknown as Record<string, unknown>)[field] ?? null),
      new: isRich ? null : (next ?? null),
    },
  };
}

/**
 * Compute the activity-log entries for a work-item/task update by diffing the
 * persisted row against the requested change set. Only changed fields produce
 * an entry; field→action mapping follows SRS P1-ACTIVITY §5.
 */
export function diffWorkItem(
  before: WorkItem,
  input: UpdateWorkItemInput,
  isTask: boolean,
): ActivityDiffEntry[] {
  const out: ActivityDiffEntry[] = [];
  const cur = before as unknown as Record<string, unknown>;

  const add = (
    field: keyof UpdateWorkItemInput,
    itemAction: ActivityAction,
    taskAction: ActivityAction,
  ) => {
    if (input[field] === undefined) return;
    if (!changed(cur[field], input[field])) return;
    out.push(entry(field, before, input[field], itemAction, taskAction, isTask));
  };

  add('title', 'work_item.updated', 'task.updated');
  add('description', 'work_item.updated', 'task.updated');
  add('notes', 'work_item.updated', 'task.updated');
  add('releaseNotes', 'work_item.updated', 'task.updated');
  add('acceptanceCriteria', 'work_item.updated', 'task.updated');
  add('isBlocked', 'work_item.updated', 'task.updated');
  add('blockedReason', 'work_item.updated', 'task.updated');
  add('teamId', 'work_item.updated', 'task.updated');
  add('iterationId', 'work_item.updated', 'task.updated');
  add('releaseId', 'work_item.updated', 'task.updated');
  add('statusId', 'work_item.flow_state_changed', 'task.state_changed');
  add('scheduleState', 'work_item.schedule_state_changed', 'task.state_changed');
  add('priority', 'work_item.priority_changed', 'task.updated');
  add('assigneeId', 'work_item.assigned', 'task.updated');
  add('storyPoints', 'work_item.estimate_updated', 'task.estimate_updated');
  add('estimateHours', 'work_item.estimate_updated', 'task.estimate_updated');
  add('todoHours', 'work_item.updated', 'task.todo_updated');
  add('actualHours', 'work_item.updated', 'task.actual_updated');

  return out;
}
