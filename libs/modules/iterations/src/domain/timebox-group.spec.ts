import { describe, expect, it } from 'vitest';
import { timeboxGroupIdFor } from './timebox-group';

const PROJECT = '11111111-1111-1111-1111-111111111111';
const OTHER_PROJECT = '22222222-2222-2222-2222-222222222222';

describe('timeboxGroupIdFor', () => {
  it('gives two Teams the same group for the same window, so All Teams can fuse them', () => {
    const teamA = timeboxGroupIdFor(PROJECT, '2026-01-05', '2026-01-16');
    const teamB = timeboxGroupIdFor(PROJECT, '2026-01-05', '2026-01-16');
    expect(teamA).toBe(teamB);
  });

  it('separates different windows in the same project', () => {
    expect(timeboxGroupIdFor(PROJECT, '2026-01-05', '2026-01-16')).not.toBe(
      timeboxGroupIdFor(PROJECT, '2026-01-19', '2026-01-30'),
    );
  });

  it('separates the same window in different projects', () => {
    // Two products can run identical calendars; their timeboxes are still unrelated.
    expect(timeboxGroupIdFor(PROJECT, '2026-01-05', '2026-01-16')).not.toBe(
      timeboxGroupIdFor(OTHER_PROJECT, '2026-01-05', '2026-01-16'),
    );
  });

  it('returns null when either date is missing', () => {
    // A dateless iteration belongs to no timebox: it is excluded from All Teams rather
    // than pooled with every other unscheduled iteration.
    expect(timeboxGroupIdFor(PROJECT, null, '2026-01-16')).toBeNull();
    expect(timeboxGroupIdFor(PROJECT, '2026-01-05', null)).toBeNull();
    expect(timeboxGroupIdFor(PROJECT, null, null)).toBeNull();
    expect(timeboxGroupIdFor(PROJECT, undefined, undefined)).toBeNull();
  });

  it('emits a canonical uuid', () => {
    // The column is `uuid`, and migration 0088 stores the same value via `::uuid`, so the
    // hyphenation has to match what Postgres produces.
    expect(timeboxGroupIdFor(PROJECT, '2026-01-05', '2026-01-16')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('matches the migration expression byte for byte', () => {
    // Pinned so the TS helper and migration 0088's
    // md5(project_id || ':' || start_date || ':' || end_date)::uuid cannot drift: if they
    // did, an iteration created after the backfill would silently miss the group its
    // sibling Teams are already in. Regenerate with:
    //   select md5('<project>:<start>:<end>')::uuid;
    expect(timeboxGroupIdFor(PROJECT, '2026-01-05', '2026-01-16')).toBe(
      'bdbccb7e-4f58-ae81-60c5-89596a5281f5',
    );
  });
});
