import { describe, expect, it } from 'vitest';
import { countRecent, groupSummaries, isTimed, sessionCells, statusLists, strengthChange, trendDirection } from './overview';
import type { ExerciseState, ExerciseStatus } from './status';
import type { Session, StrengthPoint } from './strength';

const today = '2026-06-30';
const point = (date: string, value: number): StrengthPoint => ({ date, value });

describe('recent counts', () => {
  it('splits the last 4 weeks from the 4 before', () => {
    const entries = [
      { date: '2026-06-30', count: 5 },
      { date: '2026-06-03', count: 2 },
      { date: '2026-06-02', count: 3 },
      { date: '2026-05-06', count: 4 },
      { date: '2026-05-05', count: 100 },
      { date: '2026-07-01', count: 100 },
    ];
    expect(countRecent(entries, today)).toEqual({ current: 7, previous: 7 });
  });

  it('counts each entry once by default', () => {
    expect(countRecent([{ date: today }, { date: today }], today)).toEqual({ current: 2, previous: 0 });
  });
});

describe('strength change', () => {
  it('compares the best of the last 12 weeks with the 12 before', () => {
    expect(strengthChange([point('2026-02-01', 100), point('2026-03-01', 90), point('2026-05-01', 110), point('2026-06-01', 95)], today)).toBeCloseTo(0.1);
  });

  it('ignores anything older than both stretches', () => {
    expect(strengthChange([point('2025-01-01', 500), point('2026-02-01', 100), point('2026-05-01', 90)], today)).toBeCloseTo(-0.1);
  });

  it('needs sessions in both stretches', () => {
    expect(strengthChange([point('2026-05-01', 100), point('2026-06-01', 120)], today)).toBeNull();
    expect(strengthChange([point('2026-02-01', 100)], today)).toBeNull();
    expect(strengthChange([], today)).toBeNull();
  });

  it('reads a change under 1% as flat', () => {
    expect(trendDirection(0.009)).toBe('flat');
    expect(trendDirection(-0.009)).toBe('flat');
    expect(trendDirection(0.01)).toBe('up');
    expect(trendDirection(-0.02)).toBe('down');
  });
});

describe('group summaries', () => {
  const view = (muscle: 'chest' | 'triceps' | 'biceps', points: StrengthPoint[]) => ({
    exercise: { muscle },
    sessions: points.map((p) => ({ date: p.date })),
    points,
  });

  it('gives one row per group with history, in the usual order', () => {
    const views = [view('biceps', [point('2026-06-20', 30)]), view('chest', [point('2026-06-01', 100)])];
    const rows = groupSummaries(views, [], today);
    expect(rows.map((r) => r.group)).toEqual(['chest', 'arms']);
  });

  it('adds up sets, finds the last day and takes the median change', () => {
    const views = [
      view('triceps', [point('2026-02-01', 100), point('2026-06-01', 110)]),
      view('biceps', [point('2026-02-01', 100), point('2026-06-20', 90)]),
      view('biceps', [point('2026-02-01', 100), point('2026-06-01', 102)]),
      view('triceps', [point('2026-06-10', 50)]),
    ];
    const work = [
      { date: '2026-06-20', group: 'arms' as const },
      { date: '2026-06-20', group: 'arms' as const },
      { date: '2026-05-01', group: 'arms' as const },
      { date: '2026-06-20', group: 'legs' as const },
    ];
    const [arms] = groupSummaries(views, work, today);
    expect(arms).toMatchObject({ group: 'arms', lastDate: '2026-06-20', recentSets: 2, compared: 3 });
    expect(arms.trend).toBeCloseTo(0.02);
    expect(arms.weeks).toHaveLength(12);
    expect(arms.weeks.reduce((sum, w) => sum + w.sets, 0)).toBe(3);
  });

  it('has no trend when no exercise can be compared', () => {
    const [row] = groupSummaries([view('chest', [point('2026-06-01', 100)])], [], today);
    expect(row).toMatchObject({ trend: null, compared: 0 });
  });

  it('skips an exercise with no sessions', () => {
    expect(groupSummaries([view('chest', [])], [], today)).toEqual([]);
  });
});

describe('status lists', () => {
  const status = (state: ExerciseState, extra: Partial<ExerciseStatus> = {}): ExerciseStatus => ({
    state,
    best: 0,
    bestDate: null,
    sessionsSinceBest: 0,
    weeksSinceBest: 0,
    daysSinceLast: 0,
    maybeMachineChange: false,
    ...extra,
  });
  const view = (state: ExerciseState, date: string, extra: Partial<ExerciseStatus> = {}) => ({ status: status(state, extra), sessions: [{ date }] });

  it('sorts exercises under their headings and leaves out empty ones', () => {
    const lists = statusLists([view('progressing', '2026-06-01'), view('holding', '2026-06-20'), view('returning', '2026-06-25'), view('holding', '2026-01-01')], today);
    expect(lists.map((l) => [l.heading, l.items.length])).toEqual([['going', 1], ['steady', 2], ['older', 1]]);
    expect(lists[1].items[0].sessions[0].date).toBe('2026-06-25');
  });

  it('puts what needs a look first, longest since a best on top', () => {
    const near = view('stalled', '2026-06-20', { weeksSinceBest: 8 });
    const far = view('dropping', '2026-06-21', { weeksSinceBest: 20 });
    const machine = view('progressing', '2026-06-21', { weeksSinceBest: 1, maybeMachineChange: true });
    const [attention] = statusLists([near, far, machine], today);
    expect(attention.heading).toBe('attention');
    expect(attention.items).toEqual([far, near, machine]);
  });
});

describe('session cells', () => {
  const session = (...sets: [number, number][]): Session => ({
    workoutId: 'w',
    date: today,
    position: 1,
    sets: [{ kind: 'warmup', weightKg: 10, reps: 20 }, ...sets.map(([weightKg, reps]) => ({ kind: 'work' as const, weightKg, reps }))],
  });

  it('leaves warm-ups out and marks what beat the set in the same place', () => {
    const cells = sessionCells(session([30, 4], [20, 6], [15, 5], [5, 7]), session([30, 3], [25, 9], [10, 7], [5, 7]), 'weight');
    expect(cells.map((c) => c.better)).toEqual(['reps', null, 'weight', null]);
    expect(cells[0].set).toMatchObject({ weightKg: 30, reps: 4 });
  });

  it('marks nothing without a set to compare with', () => {
    expect(sessionCells(session([30, 4]), undefined, 'weight')[0].better).toBeNull();
    expect(sessionCells(session([30, 4], [20, 6]), session([30, 4]), 'weight')[1].better).toBeNull();
  });

  it('compares sets only at the same level', () => {
    const at = (level: number | undefined, reps: number): Session => ({ workoutId: 'w', date: today, position: 1, sets: [{ kind: 'work', weightKg: 0, reps, level }] });
    expect(sessionCells(at(12, 11), at(12, 9), 'body')[0].better).toBe('reps');
    expect(sessionCells(at(13, 11), at(12, 9), 'body')[0].better).toBeNull();
    expect(sessionCells(at(12, 11), at(undefined, 9), 'body')[0].better).toBeNull();
  });

  it('marks nothing against a warm-up-only session, or on a failed attempt', () => {
    const warm: Session = { workoutId: 'w', date: today, position: 1, sets: [{ kind: 'warmup', weightKg: 10, reps: 20 }] };
    expect(sessionCells(session([30, 4]), warm, 'weight')[0].better).toBeNull();
    expect(sessionCells(warm, session([5, 4]), 'weight')[0].better).toBeNull();
    expect(sessionCells(session([40, 0]), session([30, 4]), 'weight')[0].better).toBeNull();
    expect(sessionCells(session([30, 4]), session([30, 0]), 'weight')[0].better).toBeNull();
  });

  it('keeps failure and level on the set for the table', () => {
    const session: Session = { workoutId: 'w', date: today, position: 1, sets: [{ kind: 'work', weightKg: 0, reps: 9, level: 12, failure: true }] };
    expect(sessionCells(session, undefined, 'body')[0].set).toMatchObject({ level: 12, failure: true });
  });

  it('compares timed sets by time', () => {
    const timed = (seconds: number): Session => ({ workoutId: 'w', date: today, position: 1, sets: [{ kind: 'work', weightKg: 0, reps: 0, seconds }] });
    expect(sessionCells(timed(90), timed(60), 'time')[0].better).toBe('time');
    expect(sessionCells(timed(60), timed(90), 'time')[0].better).toBeNull();
    expect(isTimed({ reps: 0, seconds: 30 }, 'weight')).toBe(true);
    expect(isTimed({ reps: 8 }, 'weight')).toBe(false);
  });
});
