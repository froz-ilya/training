import { describe, expect, it } from 'vitest';
import { changeText, comparableBefore, fmtCompact, fmtPlanned, isPlan, levelNote, percentValue, signed, weightCell, weightHeading } from './display';

const change = (deltaKg: number, deltaReps: number, deltaSeconds = 0) => ({
  trend: 'up' as const,
  deltaKg,
  deltaReps,
  deltaSeconds,
  previous: { kind: 'work' as const, weightKg: 0, reps: 0 },
});

describe('partial reps', () => {
  it('show as written', () => {
    expect(fmtCompact({ weightKg: 30, reps: 4.3 }, 'weight')).toBe('30 × 4.3');
    expect(fmtCompact({ weightKg: 30, reps: 7.5 }, 'body')).toBe('+30 × 7.5');
    expect(changeText(change(0, 0.5))).toBe('+0.5');
  });
});

describe('fmtCompact', () => {
  it('leaves units out for the table', () => {
    expect(fmtCompact({ weightKg: 34.875, reps: 8 }, 'weight')).toBe('34.875 × 8');
    expect(fmtCompact({ weightKg: 10, reps: 8 }, 'body')).toBe('+10 × 8');
    expect(fmtCompact({ weightKg: 0, reps: 12 }, 'body')).toBe('× 12');
    expect(fmtCompact({ weightKg: 0, reps: 0, seconds: 100 }, 'time')).toBe('1:40');
  });

  it('shows the level, with or without added weight', () => {
    expect(fmtCompact({ weightKg: 0, reps: 10, level: 12 }, 'body')).toBe('Lv. 12 ×\u00a010');
    expect(fmtCompact({ weightKg: 5, reps: 10, level: 12 }, 'body')).toBe('Lv. 12 +5\u00a0×\u00a010');
  });

  it('shows weight added to a timed set', () => {
    expect(fmtCompact({ weightKg: 5, reps: 0, seconds: 100 }, 'time')).toBe('+5 × 1:40');
  });
});

describe('weightCell', () => {
  it('shows added weight for bodyweight exercises', () => {
    expect(weightCell(10, 'body')).toBe('+10');
    expect(weightCell(0, 'body')).toBe('–');
    expect(weightCell(0, 'weight')).toBe('0');
  });

  it('shows the level in place of a dash', () => {
    expect(weightCell(0, 'body', 12)).toBe('Lv. 12');
    expect(weightCell(5, 'body', 12)).toBe('+5');
  });
});

describe('levelNote', () => {
  it('adds the level only where the cell shows the weight', () => {
    expect(levelNote(5, 'body', 12)).toBe('Lv. 12');
    expect(levelNote(0, 'body', 12)).toBeNull();
    expect(levelNote(5, 'body')).toBeNull();
    expect(levelNote(50, 'weight', 12)).toBeNull();
  });
});

describe('weightHeading', () => {
  it('names what the column shows', () => {
    expect(weightHeading([{ weightKg: 80 }], 'weight', false)).toBe('kg');
    expect(weightHeading([{ weightKg: 5 }], 'body', false)).toBe('+kg');
    expect(weightHeading([{ weightKg: 0 }], 'body', false)).toBe('+kg');
    expect(weightHeading([{ weightKg: 0 }], 'body', true)).toBe('Level');
    expect(weightHeading([{ weightKg: 0, level: 3 }], 'body', false)).toBe('Level');
  });

  it('stays the same whichever set carries the weight', () => {
    const sets = [{ weightKg: 0, level: 3 }, { weightKg: 5, level: 3 }];
    expect(weightHeading(sets, 'body', true)).toBe('+kg, Lv.');
    expect(weightHeading([...sets].reverse(), 'body', true)).toBe('+kg, Lv.');
  });
});

describe('fmtPlanned', () => {
  it('says the level beside the reps', () => {
    expect(fmtPlanned({ weightKg: 0, reps: 10, level: 12 }, 'body')).toBe('Lv. 12 · 10 reps');
    expect(fmtPlanned({ weightKg: 5, reps: 10, level: 12 }, 'body')).toBe('Lv. 12 · +5 kg × 10');
  });

  it('leaves a plain set as it was', () => {
    expect(fmtPlanned({ weightKg: 80, reps: 7 }, 'weight')).toBe('80 kg × 7');
    expect(fmtPlanned({ weightKg: 0, reps: 0, seconds: 100 }, 'time')).toBe('1:40');
  });

  it('keeps weight added to a timed set', () => {
    expect(fmtPlanned({ weightKg: 5, reps: 0, seconds: 100 }, 'time')).toBe('+5 kg × 1:40');
  });
});

describe('changeText', () => {
  it('names what changed', () => {
    expect(changeText(change(2.5, 0))).toBe('+2.5 kg');
    expect(changeText(change(0, -1))).toBe('−1');
    expect(changeText(change(2.5, -1))).toBe('+2.5 kg, −1');
    expect(changeText(change(0, 0, 5))).toBe('+5 s');
    expect(changeText(change(0, 0))).toBe('same');
  });
  it('uses a real minus sign', () => {
    expect(signed(-2)).toBe('−2');
  });
});

describe('percentValue', () => {
  it('keeps a small change visible', () => {
    expect(percentValue(3.4)).toBe(3);
    expect(percentValue(-4.6)).toBe(5);
    expect(percentValue(0.42)).toBe(0.4);
  });
});

describe('comparableBefore', () => {
  const earlier = { date: '2026-03-01' };
  const later = { date: '2026-03-08' };

  it('keeps the session before when nothing changed in between', () => {
    expect(comparableBefore(later, earlier, [])).toBe(earlier);
    expect(comparableBefore(later, earlier, [{ date: '2026-02-01' }, { date: '2026-04-01' }])).toBe(earlier);
  });

  it('drops it across a change, and on the day of one', () => {
    expect(comparableBefore(later, earlier, [{ date: '2026-03-05' }])).toBeUndefined();
    expect(comparableBefore(later, earlier, [{ date: later.date }])).toBeUndefined();
  });

  it('keeps it when the change came on the earlier day', () => {
    expect(comparableBefore(later, earlier, [{ date: earlier.date }])).toBe(earlier);
  });

  it('has nothing to hold the first session against', () => {
    expect(comparableBefore(later, undefined, [])).toBeUndefined();
  });
});

describe('isPlan', () => {
  const previous = { weightKg: 80, reps: 9 };
  it('is a plan while it holds last time’s numbers', () => {
    expect(isPlan({ ...previous, done: false }, previous)).toBe(true);
  });
  it('stops once changed or checked', () => {
    expect(isPlan({ weightKg: 80, reps: 10, done: false }, previous)).toBe(false);
    expect(isPlan({ ...previous, done: true }, previous)).toBe(false);
  });
  it('needs a last time', () => {
    expect(isPlan({ ...previous, done: false }, undefined)).toBe(false);
  });
});
