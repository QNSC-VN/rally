/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Keeps `vitest.config.ts`'s coverage `include` list honest.
 *
 * The list is enumerated by hand so it is visible and reviewable, which means it
 * rots silently: it used to name four files, one of which
 * (`libs/modules/planning/src/application/planning.service.ts`) had been deleted
 * with its module, while 26 other files had specs. So `pnpm test:cov` enforced a
 * 49% floor over three files and passed — a green check with almost nothing
 * behind it.
 *
 * Two ratchets fix that class of bug rather than the instance:
 *  1. every spec's subject must BE in the list — a new service + spec cannot land
 *     unmeasured;
 *  2. every entry must still EXIST — a deleted file cannot linger and silently
 *     shrink the measured set.
 */

// __dirname, not import.meta.dirname: this project compiles as CommonJS, so the
// meta-property fails `tsc --noEmit -p tsconfig.json` (TS1343) even though vitest
// transforms it fine. The web ratchet test can use import.meta because apps/web is ESM.
const ROOT = join(__dirname, '..');

/** Files the coverage config claims to measure. */
function configuredIncludes(): string[] {
  const config = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8');
  const block = /include:\s*\[([^\]]*)\]/.exec(config.slice(config.indexOf('coverage:')));
  if (!block) throw new Error('Could not find the coverage include list in vitest.config.ts');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Subjects of the backend unit specs: `foo.service.spec.ts` → `foo.service.ts`.
 *
 * A spec with no same-named sibling is skipped on purpose — variant specs
 * (`*.workspace-isolation.spec.ts`), specs for a subject that lives in a
 * published package (`permission.guard.spec.ts`), and cross-boundary contract
 * specs (`fe-permission-contract.spec.ts`) have no single file to attribute.
 * `apps/web` is excluded because it runs under its own vitest project and
 * coverage config.
 */
function specSubjects(): string[] {
  const tracked = execFileSync('git', ['ls-files', '*.spec.ts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  return tracked
    .filter((spec) => !spec.startsWith('test/') && !spec.startsWith('apps/web/'))
    .map((spec) => `${spec.slice(0, -'.spec.ts'.length)}.ts`)
    .filter((subject) => existsSync(join(ROOT, subject)));
}

describe('coverage include list', () => {
  it('measures every file that has a unit spec', () => {
    const configured = new Set(configuredIncludes());
    const missing = specSubjects().filter((subject) => !configured.has(subject));

    expect(
      missing,
      `These files have specs but are not measured. Add them to the coverage ` +
        `include list in vitest.config.ts:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('does not name files that no longer exist', () => {
    const stale = configuredIncludes().filter((entry) => !existsSync(join(ROOT, entry)));

    expect(
      stale,
      `The coverage include list names files that are gone, which silently shrinks ` +
        `the measured set. Remove them from vitest.config.ts:\n${stale.join('\n')}`,
    ).toEqual([]);
  });
});
