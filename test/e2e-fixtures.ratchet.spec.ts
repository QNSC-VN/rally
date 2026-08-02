import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The BE e2e suite must stop building what the seed already provides.
 *
 * History: 37 files, `afterAll` in every one of them closing the Nest app and cleaning NOTHING, and
 * 84 `createProject` calls per run between them. A dev database therefore grew by ~84 projects and
 * their whole graph on every pass. Twice that pushed `portfolio_items.rank` — `varchar(255)`, extended
 * by appending — to exactly 255 characters at ~1,900 items, after which every insert failed with
 * `value too long for type character varying(255)` and the suite could not run at all.
 *
 * `global-setup.ts` now truncates and re-seeds once per run, so the leak is bounded. This ratchet is
 * the other half: the COUNT may only fall. Two seeded projects exist (`SEEDED.nxp` for depth,
 * `SEEDED.pay` for "somewhere else"), so a new file needing a project has one waiting.
 *
 * Creating a project is still legitimate — for tests ABOUT creation, key minting, or a project a test
 * must then archive. Those are the ones that should be left when the number stops falling.
 */
const E2E_DIR = join(__dirname, 'e2e');

/**
 * Measured 2026-08-02: 84 before the two-project fixture existed, 81 after `context-isolation-rbac`
 * moved onto `SEEDED.nxp` / `SEEDED.pay`. Lower it as more files move; never raise it.
 */
const MAX_CREATE_PROJECT_CALLS = 81;

function e2eFiles(): string[] {
  return readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.spec.ts'));
}

describe('BE e2e fixture ratchet', () => {
  it('does not grow the number of self-built projects', () => {
    const perFile = e2eFiles()
      .map((file) => {
        const body = readFileSync(join(E2E_DIR, file), 'utf8');
        return { file, calls: (body.match(/createProject\(/g) ?? []).length };
      })
      .filter((row) => row.calls > 0)
      .sort((a, b) => b.calls - a.calls);

    const total = perFile.reduce((sum, row) => sum + row.calls, 0);
    // The message names the worst offenders, because "84 is too many" is not actionable and
    // "project-delivery-flow builds 15 of them" is.
    expect(
      total,
      `createProject calls: ${total} (cap ${MAX_CREATE_PROJECT_CALLS}). Heaviest: ${perFile
        .slice(0, 3)
        .map((r) => `${r.file}=${r.calls}`)
        .join(', ')}. Prefer SEEDED.nxp / SEEDED.pay from the harness.`,
    ).toBeLessThanOrEqual(MAX_CREATE_PROJECT_CALLS);
  });

  it('keeps the one reset in ONE place', () => {
    /**
     * A file that truncates or re-seeds on its own would fight `global-setup.ts` and make failures
     * depend on file order — the exact class of bug the single reset removes.
     *
     * Comments are stripped first. Four files mention `pnpm db:seed` in their prereq docblocks, which
     * is documentation rather than behaviour; matching the raw text failed all four and would have
     * taught the next person to delete a true comment to silence a false alarm.
     */
    const offenders = e2eFiles().filter((file) => {
      const code = readFileSync(join(E2E_DIR, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return /TRUNCATE\s+TABLE|seedBaseline\s*\(|\bseed\s*\(\s*\)/i.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
