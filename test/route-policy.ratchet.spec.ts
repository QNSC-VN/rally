/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Route-policy ratchet — every HTTP route must declare who may call it.
 *
 * `PolicyGuard` is the single authorization decision point (its own docblock
 * says it "replaces PermissionGuard + ProjectPermissionGuard + service-level
 * assertProjectPermission"), and services below it now generally re-check only
 * the workspace. That design has one sharp edge, at policy.guard.ts:81:
 *
 *     if (!meta) return true;
 *
 * A handler with no `@RequirePermission` is not denied — it is ALLOWED, to any
 * authenticated caller. `@AuthPolicy()` on the controller does not help: it only
 * wires `UseGuards(JwtAuthGuard, PolicyGuard)` and sets no policy metadata. So a
 * forgotten decorator is not a broken route that someone will notice; it is a
 * silently open one. With a single workspace in practice, "open to any
 * authenticated caller" means open to every colleague in the company, including
 * for projects they hold no grant on.
 *
 * This counts route handlers carrying neither `@RequirePermission` nor
 * `@Public`. The count may only ever DECREASE.
 *
 * It will not reach zero, and should not: a real subset is self-scoped by
 * construction and has no permission to check —
 *   • `/v1/bff/*` and `auth/*` — they run before or around a session existing;
 *   • `notifications/*`, `me/*`, `notification-preferences/*` — addressed by
 *     `user.sub`, so the caller can only ever reach their own rows;
 *   • `scm/webhook/:provider` — authenticated by provider signature, not a user.
 * The rest are ordinary reads and writes that resolve a project or workspace
 * resource from the request and currently check nothing beyond authentication.
 * Those are the ones to work off. Lower the number by decorating them.
 *
 * __dirname, not import.meta.dirname: CommonJS (see coverage-include.spec.ts).
 */

// ── Baseline — LOWER as routes get decorated, NEVER raise ────────────────────
//
// 44 → 45 on 2026-08-04, and this is the ONE shape that justifies it: authorization
// MOVED INTO THE SERVICE, it was not dropped.
//
// `GET /portfolio-items` carried `@RequirePermission('workspace:view')`. That code is
// admin-reserved, so a correctly project-scoped Project Admin or Project Member 403'd at
// the guard even though P5-PI-FR-017 grants Project Member read access — and the service's
// own `listReadableProjectIds` narrowing never ran. `portfolio:view` is project-tier and
// this route's `projectId` is optional, so no decorator can express the check; the tier-safe
// overloads correctly refuse to pretend otherwise. `work-items/by-key` hit the same wall and
// set the precedent. The check now lives in `PortfolioItemsService.list`, pinned by
// `test/e2e/portfolio-isolation.e2e.spec.ts`, which asserts both directions.
//
// Raising this number is otherwise forbidden. If you are here because your change made the
// count rise, the answer is almost always to decorate the route, not to edit this line — and
// note that this counter reads SOURCE TEXT, so it cannot tell a correct decorator from a
// misspelled code. It is a smoke detector, not an authorization test.
// See 09_Gap_Audit/PHASE_5_6_DECISION_MATRIX.md#P5-PI-16
const MAX_UNPOLICED_ROUTES = 0;

/** Sanity floor: if the scanner stops finding routes, fail loudly, not silently. */
const MIN_ROUTES_FOUND = 150;

/**
 * Routes carrying `@AuthzGap` — a DECLARED missing check. MAY ONLY FALL.
 *
 * One: `GET workspaces/:id/members-with-profile`, which CLAUDE.md already recorded as an open
 * decision. It carries `phone`, `lastLoginAt` and role ids, is documented "for the User
 * Management UI", and yet feeds the Portfolio and Projects owner pickers — so gating it needs
 * the feed split first, and whether a staff directory is member-visible is a product call.
 *
 * Declaring it is the point: it was previously indistinguishable from the 44 routes nobody had
 * decorated, and a note in a markdown file is not something CI can hold.
 */
const MAX_AUTHZ_GAPS = 1;

const ROOT = join(__dirname, '..');
const HTTP_METHOD = /^\s*@(Get|Post|Patch|Put|Delete)\(/;
const AUTHORIZED_IN_SERVICE = '@AuthorizedInService(';
const SPEC_NAME = /\.(?:spec|e2e)\.ts$/;
const DECORATOR = /^\s*@\w+\(/;
const HANDLER = /^\s*(?:async\s+)?[\w[\]'"]+\s*\(/;
/**
 * Anchored to the start of the line (modulo indent) so it matches a real
 * decorator and not prose. An unanchored /@RequirePermission/ also matched the
 * comment above `export class ProjectsController` that mentions the decorator by
 * name, which silently excluded that entire controller — nine unpoliced routes,
 * including `GET /projects/:id` and `GET /projects/:id/activity`, reported clean.
 */
const POLICY =
  /^\s*@(RequirePermission|Public|SelfScoped|SharedRead|AuthorizedInService|AuthzGap)\b/;
const COMMENT = /^\s*(\/\/|\/?\*)/;

interface Route {
  file: string;
  line: number;
  signature: string;
}

function scanRoutes(): { all: Route[]; unpoliced: Route[] } {
  const files = controllerFiles();

  const all: Route[] = [];
  const unpoliced: Route[] = [];

  for (const file of files) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');

    // A class-level @RequirePermission would cover every handler in the file
    // (Reflector.getAllAndOverride reads handler THEN class). None exist today;
    // if one is ever added, honour it rather than reporting false positives.
    const classDeclaration = lines.findIndex((l) => /^export class/.test(l));
    const classPolicied =
      classDeclaration > 0 &&
      lines.slice(0, classDeclaration).some((l) => !COMMENT.test(l) && POLICY.test(l));

    for (let i = 0; i < lines.length; i++) {
      if (!HTTP_METHOD.test(lines[i])) continue;

      // Everything between the HTTP verb and the handler signature is this
      // route's decorator block.
      const decorators: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (COMMENT.test(lines[j])) continue;
        if (DECORATOR.test(lines[j])) decorators.push(lines[j]);
        else if (HANDLER.test(lines[j])) break;
      }

      const route = { file, line: i + 1, signature: lines[i].trim() };
      all.push(route);
      // Per line, not against the joined block: POLICY is `^`-anchored and the
      // regex has no `m` flag, so testing the join would only ever match the
      // FIRST decorator of each route.
      if (!classPolicied && !decorators.some((d) => POLICY.test(d))) unpoliced.push(route);
    }
  }

  return { all, unpoliced };
}

/** Every controller file, once — three checks below need the same list. */
function controllerFiles(): string[] {
  return execFileSync('git', ['ls-files', 'libs/**/*.controller.ts', 'apps/**/*.controller.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

interface Citation {
  file: string;
  line: number;
  pinnedBy: string;
}

/**
 * The `pinnedBy` argument of every `@AuthorizedInService(reason, pinnedBy)`.
 *
 * Paren-balanced rather than a single regex because the call is routinely wrapped over four
 * lines by the formatter, and a line-oriented match sees only the fragment. The pinned spec is
 * the LAST string literal inside the call — `reason` is prose and may itself contain a comma,
 * a colon or brackets (one reason mentions `[]` and `null`), so position, not shape, is what
 * identifies it.
 */
function scanServiceAuthzCitations(): Citation[] {
  const citations: Citation[] = [];

  for (const file of controllerFiles()) {
    const source = readFileSync(join(ROOT, file), 'utf8');

    for (let at = source.indexOf(AUTHORIZED_IN_SERVICE); at !== -1;) {
      let depth = 0;
      let end = at + AUTHORIZED_IN_SERVICE.length - 1;
      for (; end < source.length; end++) {
        if (source[end] === '(') depth++;
        else if (source[end] === ')' && --depth === 0) break;
      }

      const args = source.slice(at + AUTHORIZED_IN_SERVICE.length, end);
      const literals = [...args.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
      const pinnedBy = literals.at(-1);
      if (pinnedBy !== undefined) {
        citations.push({
          file,
          // Count newlines rather than tracking them: this runs once per citation, not per line.
          line: source.slice(0, at).split('\n').length,
          pinnedBy,
        });
      }

      at = source.indexOf(AUTHORIZED_IN_SERVICE, end);
    }
  }

  return citations;
}

function report(routes: Route[]): string {
  const byFile = new Map<string, string[]>();
  for (const r of routes) {
    byFile.set(r.file, [...(byFile.get(r.file) ?? []), `${r.signature}  (line ${r.line})`]);
  }
  return [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([file, rs]) => `  ${file}\n${rs.map((r) => `      ${r}`).join('\n')}`)
    .join('\n');
}

describe('route-policy ratchet (only ever decreases)', () => {
  it('finds the controller surface it claims to guard', () => {
    const { all } = scanRoutes();
    expect(
      all.length,
      'Found almost no route handlers. The scanner is broken, not the controllers.',
    ).toBeGreaterThanOrEqual(MIN_ROUTES_FOUND);
  });

  it(`route handlers with neither @RequirePermission nor @Public <= ${MAX_UNPOLICED_ROUTES}`, () => {
    const { unpoliced } = scanRoutes();

    if (unpoliced.length > MAX_UNPOLICED_ROUTES) {
      throw new Error(
        `Unpoliced routes rose to ${unpoliced.length} (baseline ${MAX_UNPOLICED_ROUTES}).\n` +
          `PolicyGuard ALLOWS a handler with no policy metadata, so a new route ` +
          `without @RequirePermission is open to every authenticated caller. Add ` +
          `the decorator — do not raise the baseline.\n\n${report(unpoliced)}`,
      );
    }

    expect(unpoliced.length).toBeLessThanOrEqual(MAX_UNPOLICED_ROUTES);
  });

  /**
   * Every spec named by `@AuthorizedInService(reason, pinnedBy)` must EXIST.
   *
   * `@AuthorizedInService` is the one mode that moves the authorization decision somewhere a
   * reviewer cannot see from the route, and `pinnedBy` is the whole compensating control — the
   * decorator's own docblock calls it "the test asserting BOTH directions", and the boot audit
   * accepts the route because of it. Nothing checked that the named file was real.
   *
   * It was not. Twelve routes across three controllers cited `project-authz.e2e.spec.ts`,
   * including `GET /projects` (the cross-project list whose ONLY authorization is
   * `listReadableProjectIds`) and `GET /projects/:id/estimation-settings`. That file has never
   * existed in this repository. So a dozen routes carried a citation as their proof, the boot
   * audit passed, this ratchet passed, and the claim was unfalsifiable — which is how the two
   * P0 access defects of 2026-08-14 survived: the control that was supposed to catch them was
   * itself unverified.
   *
   * Matched by suffix as well as full path, because a citation is conventionally the bare
   * filename. That is deliberately permissive: the property worth enforcing is "a reviewer can
   * find this file", not a path convention.
   */
  it('every spec named by @AuthorizedInService exists', () => {
    const citations = scanServiceAuthzCitations();

    expect(
      citations.length,
      'Found no @AuthorizedInService citations at all — the scanner is broken, not the ' +
        'controllers. Do not delete this check.',
    ).toBeGreaterThan(0);

    // `--others --exclude-standard` as well as the index, so a spec being written right now counts.
    // Tracked-only would fail on the author's machine and pass in CI after the commit, which
    // teaches exactly the wrong lesson: that the citation is a formality satisfied by `git add`.
    // Ignored files are still excluded — a citation must point somewhere a reviewer can read.
    const present = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);

    const missing = citations.filter(
      (c) => !present.some((p) => p === c.pinnedBy || p.endsWith(`/${c.pinnedBy}`)),
    );

    expect(
      missing.length,
      `${missing.length} route(s) name a pinning spec that does not exist:\n` +
        missing.map((c) => `  ${c.file}:${c.line} → ${c.pinnedBy}`).join('\n') +
        `\n\n@AuthorizedInService moves the authorization decision into the service, and ` +
        `pinnedBy is the only thing that proves anyone checked it. A citation to a file that ` +
        `does not exist is worse than no citation: it reads as evidence. Write the spec, or ` +
        `re-point the citation at the spec that really covers the route.`,
    ).toBe(0);
  });

  /**
   * A `pinnedBy` must also name a TEST file, not a source file or a markdown note.
   *
   * Cheap to get wrong in the direction that matters: pointing at the service being defended
   * ("authorized in `projects.service.ts`") satisfies the existence check above while proving
   * nothing at all.
   */
  it('every @AuthorizedInService citation names a test file', () => {
    const notTests = scanServiceAuthzCitations().filter((c) => !SPEC_NAME.test(c.pinnedBy));

    expect(
      notTests.length,
      `${notTests.length} citation(s) do not name a *.spec.ts / *.e2e.ts file:\n` +
        notTests.map((c) => `  ${c.file}:${c.line} → ${c.pinnedBy}`).join('\n') +
        `\n\npinnedBy must be the TEST that asserts both directions. A source file or a doc ` +
        `cannot fail when the behaviour regresses.`,
    ).toBe(0);
  });

  it(`declared authorization gaps <= ${MAX_AUTHZ_GAPS}`, () => {
    const gaps: string[] = [];
    const files = controllerFiles();

    for (const file of files) {
      readFileSync(join(ROOT, file), 'utf8')
        .split('\n')
        .forEach((l, i) => {
          if (/^\s*@AuthzGap\(/.test(l)) gaps.push(`${file}:${i + 1}`);
        });
    }

    expect(
      gaps.length,
      `Declared authorization gaps rose to ${gaps.length} (max ${MAX_AUTHZ_GAPS}):\n  ` +
        `${gaps.join('\n  ')}\n\n@AuthzGap ships a KNOWN hole — argue it in review rather ` +
        `than using it to satisfy the boot audit.`,
    ).toBeLessThanOrEqual(MAX_AUTHZ_GAPS);

    expect(
      gaps.length,
      `MAX_AUTHZ_GAPS is ${MAX_AUTHZ_GAPS} but only ${gaps.length} remain — lower it.`,
    ).toBe(MAX_AUTHZ_GAPS);
  });
});
