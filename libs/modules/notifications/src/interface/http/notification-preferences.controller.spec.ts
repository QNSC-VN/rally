import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { NotificationPreferencesController } from './notification-preferences.controller';
import type { NotificationPreferencesService } from '../../application/notification-preferences.service';
import type { JwtPayload } from '@platform';

/**
 * Regression guard: the `:type` path param must be validated against the
 * real NotificationTemplateName union (or '*'). Previously it accepted any
 * string, so a caller following the (then-wrong) docs example
 * 'work_item.assigned' would silently create a preference row that never
 * matches the real stored type 'WORK_ITEM_ASSIGNED' — the opt-out would
 * never fire, with no error surfaced anywhere.
 */
describe('NotificationPreferencesController — :type validation', () => {
  const mockService = {
    listPreferences: vi.fn(),
    upsert: vi.fn(),
    reset: vi.fn(),
  } as unknown as NotificationPreferencesService;

  const controller = new NotificationPreferencesController(mockService);
  const user = { sub: 'user-1', workspaceId: 'ws-1' } as JwtPayload;

  it('rejects a lowercase-dot type key on upsert (the previously-documented but wrong format)', async () => {
    await expect(
      controller.upsert(user, 'work_item.assigned', { inApp: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockService.upsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown type key on reset', async () => {
    await expect(controller.reset(user, 'not_a_real_type')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockService.reset).not.toHaveBeenCalled();
  });

  it('accepts a real NotificationTemplateName value on upsert', async () => {
    vi.mocked(mockService.upsert).mockResolvedValue({
      id: 'pref-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      type: 'WORK_ITEM_ASSIGNED',
      inApp: false,
      email: true,
      updatedAt: new Date(),
    });

    await controller.upsert(user, 'WORK_ITEM_ASSIGNED', { inApp: false });

    expect(mockService.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'WORK_ITEM_ASSIGNED', inApp: false }),
    );
  });

  it("accepts the '*' wildcard on upsert and reset", async () => {
    vi.mocked(mockService.upsert).mockResolvedValue({
      id: 'pref-2',
      workspaceId: 'ws-1',
      userId: 'user-1',
      type: '*',
      inApp: false,
      email: false,
      updatedAt: new Date(),
    });

    await controller.upsert(user, '*', { inApp: false, email: false });
    await controller.reset(user, '*');

    expect(mockService.upsert).toHaveBeenCalledWith(expect.objectContaining({ type: '*' }));
    expect(mockService.reset).toHaveBeenCalledWith('ws-1', 'user-1', '*');
  });
});
