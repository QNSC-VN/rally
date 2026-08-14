/**
 * RFE-05 — the notification feed must apply the reader's CURRENT per-Project access before it
 * displays a work item's title.
 *
 * `Phase 4/02_Roles_Permissions/SRS.md` §7 :200 ("Notifications must apply the current Project/Team
 * access before displaying or routing to a Work Item") and :199 ("Denied states must not show
 * restricted title, owner, Project, Team or other business data"). Before this, every recipient-
 * scoped read filtered on workspace + recipient alone, so a user moved to No Access kept every past
 * notification for that project in the bell — each naming the item — while clicking one 403'd in the
 * item-key resolver.
 *
 * Two things are pinned here, because the bug can come back in either place:
 *   1. the SENTINEL is passed through untouched at the service seam — `null` (UNRESTRICTED) and `[]`
 *      ("no projects") are different answers, and every read seam gets the same one;
 *   2. the SQL the repository emits for each sentinel value — including that `inArray(col, [])` is
 *      never emitted, and that a notification naming NO project survives.
 *
 * A variant spec name on purpose: this measures a cross-file rule (service seam + emitted SQL), not
 * one subject, which is the shape `test/coverage-include.spec.ts` documents as exempt.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JwtPayload, DrizzleDB } from '@platform';
import type { AccessService } from '@modules/access';

import { NotificationsService } from './notifications.service';
import { NotificationDrizzleRepository } from '../infrastructure/persistence/notification.drizzle-repository';
import type { INotificationRepository } from '../domain/ports/notification.repository';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const READABLE = '33333333-3333-4333-8333-333333333333';

const actor = { sub: USER, workspaceId: WORKSPACE } as JwtPayload;

describe('notification feed — per-Project access filter (SRS §7 :199-200)', () => {
  describe('the service threads ONE access fact into every recipient-scoped read', () => {
    let repo: {
      [K in keyof INotificationRepository]: ReturnType<typeof vi.fn>;
    };
    let access: { listReadableProjectIds: ReturnType<typeof vi.fn> };
    let service: NotificationsService;

    beforeEach(() => {
      repo = {
        findById: vi.fn().mockResolvedValue(null),
        isVisibleToRecipient: vi.fn().mockResolvedValue(true),
        listForRecipient: vi.fn().mockResolvedValue([]),
        listPageForRecipient: vi.fn().mockResolvedValue({ data: [], pageInfo: {} }),
        listSince: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue(null),
        countUnread: vi.fn().mockResolvedValue(0),
        markRead: vi.fn().mockResolvedValue(undefined),
        markAllRead: vi.fn().mockResolvedValue(undefined),
      };
      access = { listReadableProjectIds: vi.fn() };
      service = new NotificationsService(
        repo as unknown as INotificationRepository,
        access as unknown as AccessService,
      );
    });

    it('asks for work_item:view — the same permission the /item/$itemKey resolver enforces', async () => {
      access.listReadableProjectIds.mockResolvedValue(null);

      await service.listNotifications(actor, { unreadOnly: false });

      expect(access.listReadableProjectIds).toHaveBeenCalledWith(WORKSPACE, USER, 'work_item:view');
    });

    /**
     * `null` is UNRESTRICTED, not "nothing". Flattening it to `[]` would empty a Workspace Admin's
     * bell, which is the failure mode in the other direction from the leak.
     */
    it('passes the null sentinel through unchanged on every read seam', async () => {
      access.listReadableProjectIds.mockResolvedValue(null);

      await service.listNotifications(actor, { unreadOnly: false });
      await service.listNotificationsPage(
        actor,
        { unreadOnly: false },
        { limit: 20, cursor: null },
      );
      await service.getUnreadCount(actor);
      await service.listMissed(actor, 'after-id');
      await service.markAllRead(actor);
      await service.isVisible(actor, 'notification-id');

      expect(repo.listForRecipient).toHaveBeenCalledWith(WORKSPACE, USER, expect.anything(), null);
      expect(repo.listPageForRecipient).toHaveBeenCalledWith(
        WORKSPACE,
        USER,
        expect.anything(),
        expect.anything(),
        null,
      );
      expect(repo.countUnread).toHaveBeenCalledWith(WORKSPACE, USER, null);
      expect(repo.listSince).toHaveBeenCalledWith(WORKSPACE, USER, 'after-id', 30, null);
      expect(repo.markAllRead).toHaveBeenCalledWith(WORKSPACE, USER, null);
      expect(repo.isVisibleToRecipient).toHaveBeenCalledWith(
        WORKSPACE,
        USER,
        'notification-id',
        null,
      );
    });

    it('passes a restricted list — including the empty one — through unchanged', async () => {
      access.listReadableProjectIds.mockResolvedValue([READABLE]);
      await service.getUnreadCount(actor);
      expect(repo.countUnread).toHaveBeenCalledWith(WORKSPACE, USER, [READABLE]);

      access.listReadableProjectIds.mockResolvedValue([]);
      await service.getUnreadCount(actor);
      expect(repo.countUnread).toHaveBeenLastCalledWith(WORKSPACE, USER, []);
    });
  });

  describe('the SQL the repository emits for each sentinel value', () => {
    const dialect = new PgDialect();
    const repo = new NotificationDrizzleRepository({} as DrizzleDB) as unknown as {
      projectAccessCondition(readableProjectIds: string[] | null): SQL | undefined;
    };
    /** Renders the predicate to real SQL text + params; throws if none was emitted. */
    const render = (ids: string[] | null): { sql: string; params: unknown[] } => {
      const condition = repo.projectAccessCondition(ids);
      if (!condition) throw new Error(`No access predicate emitted for ${JSON.stringify(ids)}`);
      const query = dialect.sqlToQuery(condition);
      return { sql: query.sql, params: query.params };
    };

    it('adds NO predicate for the unrestricted sentinel', () => {
      expect(repo.projectAccessCondition(null)).toBeUndefined();
    });

    /**
     * "No readable projects" must not become `in ()` — `inArray(col, [])` is not portable as
     * "match nothing", which is why the projects repository short-circuits it. Here the empty case
     * still emits a predicate, because a project-LESS notification stays visible.
     */
    it('emits only the project-less clause when no project is readable, never an empty IN', () => {
      const rendered = render([]);
      expect(rendered.sql).toContain("->> 'projectId'");
      expect(rendered.sql).toContain('is null');
      expect(rendered.sql).not.toContain(' in (');
      expect(rendered.params).toEqual([]);
    });

    /**
     * A workspace-scoped notification (`WORKSPACE_INVITATION`) carries no `projectId`, so the rule
     * has to be "hide a notification whose named project is denied", not "keep only notifications
     * whose project is readable" — otherwise the only surface that onboards a user disappears.
     */
    it('keeps a project-less notification alongside the readable projects', () => {
      const rendered = render([READABLE, 'other-project']);
      expect(rendered.sql).toContain('is null');
      expect(rendered.sql).toContain(' or ');
      expect(rendered.sql).toContain(' in (');
      expect(rendered.params).toEqual([READABLE, 'other-project']);
    });

    /** The project lives in metadata, not in resource_id (which is the work item's own id). */
    it('reads the project from metadata, not from resource_id', () => {
      const rendered = render([READABLE]);
      expect(rendered.sql).toContain('metadata');
      expect(rendered.sql).not.toContain('resource_id');
    });
  });
});
