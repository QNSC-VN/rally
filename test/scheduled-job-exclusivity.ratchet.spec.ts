/**
 * Scheduled-job exclusivity ratchet — every `@Cron`/`@Interval`/`@Timeout` must be
 * single-writer across pods.
 *
 * Why this exists: `@Cron` and `@Interval` fire on EVERY replica, so a rolling deploy that
 * briefly overlaps two worker tasks runs each job twice, concurrently. `daily-cleanup`
 * DELETES rows, so a double run is not a cosmetic problem.
 *
 * Both crons already took a lock when this was added — this pins that down so the next one
 * cannot quietly skip it. The sibling opshub repo had eight jobs with no guard at all,
 * which is what prompted writing it down as a check rather than a convention.
 *
 * Nothing catches this by testing: a single replica makes every job look correctly
 * serialised no matter what.
 *
 * Two ways to satisfy this, both real:
 *   1. Run the body through `ExclusiveJob.run()` — cache lock plus in-process overlap guard.
 *   2. Extend `AbstractOutboxRelay`, whose claim query is `FOR UPDATE SKIP LOCKED`, so
 *      concurrent relays partition rows instead of duplicating them.
 *
 * An ALLOWLIST, not a count, for the same reason as the param ratchet: whoever adds a job
 * has to say out loud that it is safe to run twice, which is the judgement a reviewer needs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `__dirname`, matching the other ratchets: this project's tsconfig module setting rejects
// `import.meta`, and vitest transpiles it away so only `tsc -b` sees the error.
const ROOT = join(__dirname, '..');

const SCHEDULE_DECORATOR = /@(Cron|Interval|Timeout)\(/;

/**
 * Jobs that are deliberately NOT serialised, with the reason they are safe to run
 * concurrently. Add an entry only when concurrent execution is genuinely harmless — never
 * to quiet a real finding.
 */
const CONCURRENCY_SAFE = new Set<string>([
  // Nothing yet. Every scheduled job currently either locks or partitions with SKIP LOCKED.
]);

function sourceFiles(): string[] {
  return (
    execFileSync('git', ['ls-files', '*.ts'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.endsWith('.spec.ts'))
      // `git ls-files` reports the INDEX, so a file deleted but not yet staged would throw
      // ENOENT here and kill the check with an error that looks nothing like a job problem.
      .filter((f) => existsSync(join(ROOT, f)))
  );
}

function scheduledJobFiles(): { file: string; source: string }[] {
  return sourceFiles()
    .map((file) => ({ file, source: readFileSync(join(ROOT, file), 'utf8') }))
    .filter(({ source }) => SCHEDULE_DECORATOR.test(source));
}

describe('every scheduled job runs on one pod at a time', () => {
  it('finds the scheduled jobs it claims to guard', () => {
    // A scanner that stops seeing jobs reports zero violations, which is indistinguishable
    // from a codebase where every job is correctly locked.
    expect(
      scheduledJobFiles().length,
      'Found almost no scheduled jobs. The scanner is broken, not the schedule.',
    ).toBeGreaterThanOrEqual(7);
  });

  it('has no scheduled job without a lock or SKIP LOCKED partitioning', () => {
    const offenders: string[] = [];

    for (const { file, source } of scheduledJobFiles()) {
      const base = file.split('/').pop()!;
      if (CONCURRENCY_SAFE.has(base)) continue;

      const locked = source.includes('exclusive.run(') || source.includes('ExclusiveJob');
      // The relay base class defines the decorator in a docblock example and claims rows
      // with FOR UPDATE SKIP LOCKED; subclasses inherit that partitioning.
      const partitions = source.includes('AbstractOutboxRelay') || source.includes('SKIP LOCKED');

      if (!locked && !partitions) offenders.push(file);
    }

    expect(
      offenders,
      `These scheduled jobs fire on every replica with nothing stopping two pods running ` +
        `them at once:\n  ${offenders.join('\n  ')}\n\n` +
        `Wrap the body in ExclusiveJob.run(), extend AbstractOutboxRelay, or declare the ` +
        `file in CONCURRENCY_SAFE with the reason a double run is harmless.`,
    ).toEqual([]);
  });

  it('gives every scheduled job a stable name for its lock and metrics', () => {
    // An unnamed @Cron gets a generated name, so its metric label and lock key change
    // between builds — which silently defeats both.
    const unnamed: string[] = [];
    for (const { file, source } of scheduledJobFiles()) {
      if (file.includes('abstract-outbox-relay')) continue; // docblock example, not a job
      for (const m of source.matchAll(/@Cron\(([^)]*)\)/g)) {
        if (!m[1].includes('name:')) unnamed.push(`${file}: @Cron(${m[1].trim()})`);
      }
    }

    expect(
      unnamed,
      `These @Cron jobs have no { name: ... }, so their lock key and metric label are ` +
        `generated and unstable:\n  ${unnamed.join('\n  ')}`,
    ).toEqual([]);
  });
});
