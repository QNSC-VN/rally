import { describe, expect, it } from 'vitest';
import { buildBurndownSeries, combineBaselines, combineTeamSnapshots, idealLine } from './burndown';
import { DEFAULT_WORKING_DAYS } from './report-scope';

describe('idealLine (IB-BR-03)', () => {
  it('starts at the baseline and reaches exactly zero on the last WORKING day', () => {
    // The approved mockup interpolates over calendar days and never reaches zero; the SRS
    // indexes by working day and requires it. This is the divergence, pinned.
    expect(idealLine(40, 5)).toEqual([40, 30, 20, 10, 0]);
  });

  it('renders a single-working-day iteration as the baseline alone', () => {
    // N - 1 = 0 makes the formula undefined; IB-BR-03 says show the baseline at the start
    // of that day.
    expect(idealLine(16, 1)).toEqual([16]);
  });

  it('clamps to [0, baseline] and never goes negative', () => {
    expect(idealLine(-5, 3)).toEqual([0, 0, 0]);
    expect(idealLine(10, 3).every((v) => v >= 0 && v <= 10)).toBe(true);
  });

  it('has no points when there are no working days', () => {
    expect(idealLine(40, 0)).toEqual([]);
  });
});

const WEEK = { startDate: '2026-01-05', endDate: '2026-01-09' }; // Mon–Fri

describe('buildBurndownSeries', () => {
  it('plots working days only, with the ideal reaching zero on Friday', () => {
    const series = buildBurndownSeries({
      ...WEEK,
      workingDays: DEFAULT_WORKING_DAYS,
      totalTaskEstimateAtStart: 40,
      snapshots: [
        { date: '2026-01-05', remainingToDo: 40, acceptedPoints: 0 },
        { date: '2026-01-06', remainingToDo: 32, acceptedPoints: 0 },
        { date: '2026-01-07', remainingToDo: 24, acceptedPoints: 5 },
        { date: '2026-01-08', remainingToDo: 12, acceptedPoints: 5 },
        { date: '2026-01-09', remainingToDo: 0, acceptedPoints: 13 },
      ],
    });
    expect(series.points.map((p) => p.date)).toEqual([
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
    ]);
    expect(series.points.map((p) => p.ideal)).toEqual([40, 30, 20, 10, 0]);
    expect(series.historyState).toBe('complete');
    expect(series.status).toBe('on-track');
  });

  it('reports a missing day as a gap, never as zero', () => {
    // A zero would read as "no work remained" — measured performance. IB §5: missing
    // snapshots are reported as unavailable and must not be interpolated.
    const series = buildBurndownSeries({
      ...WEEK,
      workingDays: DEFAULT_WORKING_DAYS,
      totalTaskEstimateAtStart: 40,
      snapshots: [
        { date: '2026-01-05', remainingToDo: 40, acceptedPoints: 0 },
        { date: '2026-01-07', remainingToDo: 24, acceptedPoints: 5 },
      ],
    });
    expect(series.points.map((p) => p.remainingToDo)).toEqual([40, null, 24, null, null]);
    expect(series.historyState).toBe('partial');
  });

  it('distinguishes no snapshots at all from no baseline', () => {
    const noHistory = buildBurndownSeries({
      ...WEEK,
      workingDays: DEFAULT_WORKING_DAYS,
      totalTaskEstimateAtStart: 40,
      snapshots: [],
    });
    expect(noHistory.historyState).toBe('missing');
    expect(noHistory.status).toBe('unknown');

    /**
     * A missing baseline costs the IDEAL LINE, not the measured history.
     *
     * IB §3 scopes the baseline to the Ideal line and §5 makes only missing SNAPSHOTS
     * unavailable, so `historyState` reports what was captured and `totalTaskEstimateAtStart`
     * reports whether a trajectory can be drawn. Conflating them made a real, measured day of
     * Task-To-Do render as "no burndown to show".
     */
    const noBaseline = buildBurndownSeries({
      ...WEEK,
      workingDays: DEFAULT_WORKING_DAYS,
      totalTaskEstimateAtStart: null,
      snapshots: [{ date: '2026-01-05', remainingToDo: 40, acceptedPoints: 0 }],
    });
    expect(noBaseline.historyState).toBe('partial');
    expect(noBaseline.totalTaskEstimateAtStart).toBeNull();
    // The measured day SURVIVES — that is the whole point of the split.
    expect(noBaseline.points.find((p) => p.date === '2026-01-05')?.remainingToDo).toBe(40);
    // Status still cannot be judged: there is nothing to compare the measurement against.
    expect(noBaseline.status).toBe('unknown');
    // Every Ideal value is null, not 0: a zero line gets plotted and reads as "the plan was
    // to do nothing", which is the same fabrication the null snapshot values avoid.
    expect(noBaseline.points.every((p) => p.ideal === null)).toBe(true);
  });

  it('reports NO WINDOW for an iteration with no dates, rather than throwing', () => {
    // The service has nothing but `''` to pass for a dateless iteration, and `'' < ''` slipped
    // past the inverted-range guard into `addDays('')`, which threw `RangeError: Invalid time
    // value` — a 500 on 99 of 206 iterations in the local database.
    const dateless = buildBurndownSeries({
      startDate: '',
      endDate: '',
      workingDays: DEFAULT_WORKING_DAYS,
      totalTaskEstimateAtStart: 40,
      snapshots: [],
    });
    expect(dateless.historyState).toBe('no-window');
    expect(dateless.points).toEqual([]);
    expect(dateless.status).toBe('unknown');
  });

  it('ignores a weekend snapshot stored for audit when judging completeness', () => {
    const series = buildBurndownSeries({
      startDate: '2026-01-05',
      endDate: '2026-01-12',
      workingDays: DEFAULT_WORKING_DAYS,
      totalTaskEstimateAtStart: 40,
      snapshots: [
        { date: '2026-01-10', remainingToDo: 20, acceptedPoints: 5 }, // Saturday
        { date: '2026-01-11', remainingToDo: 20, acceptedPoints: 5 }, // Sunday
      ],
    });
    expect(series.points.some((p) => p.date === '2026-01-10')).toBe(false);
    expect(series.historyState).toBe('missing');
  });

  it('calls the latest day Behind plan above ideal and On track at equality (IB §8.5)', () => {
    const at = (remaining: number) =>
      buildBurndownSeries({
        ...WEEK,
        workingDays: DEFAULT_WORKING_DAYS,
        totalTaskEstimateAtStart: 40,
        snapshots: [
          { date: '2026-01-05', remainingToDo: 40, acceptedPoints: 0 },
          { date: '2026-01-06', remainingToDo: remaining, acceptedPoints: 0 },
        ],
      });
    expect(at(31).status).toBe('behind-plan');
    expect(at(30).status).toBe('on-track'); // equality is On track
    expect(at(29).status).toBe('on-track');
    expect(at(31).latestSnapshotDate).toBe('2026-01-06');
  });
});

describe('All Teams aggregation', () => {
  it('sums the participating baselines and keeps null when none exist', () => {
    expect(combineBaselines([16, 24, null])).toBe(40);
    expect(combineBaselines([null, null])).toBeNull();
    expect(combineBaselines([])).toBeNull();
  });

  it('fuses the Teams rows of one shared timebox per date', () => {
    expect(
      combineTeamSnapshots([
        { date: '2026-01-06', remainingToDo: 10, acceptedPoints: 2 },
        { date: '2026-01-05', remainingToDo: 20, acceptedPoints: 0 },
        { date: '2026-01-06', remainingToDo: 15, acceptedPoints: 3 },
      ]),
    ).toEqual([
      { date: '2026-01-05', remainingToDo: 20, acceptedPoints: 0 },
      { date: '2026-01-06', remainingToDo: 25, acceptedPoints: 5 },
    ]);
  });

  it('omits a date no Team snapshotted rather than treating absence as zero remaining', () => {
    const fused = combineTeamSnapshots([
      { date: '2026-01-05', remainingToDo: 20, acceptedPoints: 0 },
    ]);
    expect(fused.map((f) => f.date)).toEqual(['2026-01-05']);
  });
});
