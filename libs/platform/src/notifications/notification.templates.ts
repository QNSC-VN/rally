/**
 * Notification template registry — typed definitions for every in-app notification.
 *
 * Adding a new notification type:
 *   1. Add the name to `NotificationTemplateName`.
 *   2. Add its vars shape to `NotificationTemplateVars`.
 *   3. Add a case to `renderNotification()`.
 *
 * This is the single source of truth.  NotificationSchedulerService enforces
 * the vars shape at the call site (compile-time).  The relay renderer uses this
 * at runtime so template logic never scatters across business services.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Runtime mirror of NotificationTemplateName — the single source of truth for
 * validating a caller-supplied type string (e.g. the preferences API's
 * `:type` path param) against every real template name. Keep in sync with
 * the union below; the array-as-const/derived-union pattern keeps them
 * mechanically impossible to drift apart.
 */
export const NOTIFICATION_TEMPLATE_NAMES = [
  'WORKSPACE_INVITATION',
  'WORKSPACE_INVITATION_ACCEPTED',
  'WORK_ITEM_ASSIGNED',
  'WORK_ITEM_STATE_CHANGED',
  'WORK_ITEM_COMMENTED',
  'WORK_ITEM_MENTIONED',
] as const;

export type NotificationTemplateName = (typeof NOTIFICATION_TEMPLATE_NAMES)[number];

interface WorkItemNotificationVars {
  itemKey: string;
  itemTitle: string;
  /** Owning project id — threaded into the rendered `metadata` so the client can
   * resolve the correct project context for a cross-project deep link. */
  projectId: string;
}

export interface NotificationTemplateVars {
  WORKSPACE_INVITATION: {
    workspaceName: string;
    inviterName: string;
    role: string;
  };
  WORKSPACE_INVITATION_ACCEPTED: {
    workspaceName: string;
    accepteeName: string;
  };
  WORK_ITEM_ASSIGNED: WorkItemNotificationVars;
  WORK_ITEM_STATE_CHANGED: WorkItemNotificationVars & { newState: string };
  WORK_ITEM_COMMENTED: WorkItemNotificationVars;
  WORK_ITEM_MENTIONED: WorkItemNotificationVars;
}

/**
 * The rendered output written to in_app_notifications.
 * resourceType is a constant per template (determines the deep-link target).
 * resourceId is dynamic and supplied by the caller via ScheduleNotificationOptions.
 */
export interface RenderedNotification {
  title: string;
  body?: string;
  /** Maps to in_app_notifications.resource_type — constant per template. */
  resourceType?: string;
  /** Structured deep-link payload persisted to in_app_notifications.metadata.
   * For work-item templates this carries `{ itemKey, projectId }` so the client
   * can open the item in its own project context (not the active one). */
  metadata?: Record<string, unknown>;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export function renderNotification<K extends NotificationTemplateName>(
  type: K,
  vars: NotificationTemplateVars[K],
): RenderedNotification {
  switch (type) {
    case 'WORKSPACE_INVITATION': {
      const v = vars as NotificationTemplateVars['WORKSPACE_INVITATION'];
      return {
        title: `${v.inviterName} invited you to ${v.workspaceName}`,
        body: `You've been invited as ${v.role}. Open the notification to accept.`,
        resourceType: 'workspace',
      };
    }
    case 'WORKSPACE_INVITATION_ACCEPTED': {
      const v = vars as NotificationTemplateVars['WORKSPACE_INVITATION_ACCEPTED'];
      return {
        title: `${v.accepteeName} accepted your invitation to ${v.workspaceName}`,
        resourceType: 'workspace',
      };
    }
    case 'WORK_ITEM_ASSIGNED': {
      const v = vars as NotificationTemplateVars['WORK_ITEM_ASSIGNED'];
      return {
        title: `You were assigned ${v.itemKey}`,
        body: v.itemTitle,
        resourceType: 'work_item',
        metadata: { itemKey: v.itemKey, projectId: v.projectId },
      };
    }
    case 'WORK_ITEM_STATE_CHANGED': {
      const v = vars as NotificationTemplateVars['WORK_ITEM_STATE_CHANGED'];
      return {
        title: `${v.itemKey} moved to ${v.newState}`,
        body: v.itemTitle,
        resourceType: 'work_item',
        metadata: { itemKey: v.itemKey, projectId: v.projectId },
      };
    }
    case 'WORK_ITEM_COMMENTED': {
      const v = vars as NotificationTemplateVars['WORK_ITEM_COMMENTED'];
      return {
        title: `New comment on ${v.itemKey}`,
        body: v.itemTitle,
        resourceType: 'work_item',
        metadata: { itemKey: v.itemKey, projectId: v.projectId },
      };
    }
    case 'WORK_ITEM_MENTIONED': {
      const v = vars as NotificationTemplateVars['WORK_ITEM_MENTIONED'];
      return {
        title: `You were mentioned in ${v.itemKey}`,
        body: v.itemTitle,
        resourceType: 'work_item',
        metadata: { itemKey: v.itemKey, projectId: v.projectId },
      };
    }
    default: {
      // Exhaustiveness guard — TS will error if a case is missing.
      const _exhaustive: never = type;
      throw new Error(`Unknown notification template: ${String(_exhaustive)}`);
    }
  }
}
