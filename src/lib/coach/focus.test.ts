import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog/exercises';
import { regionsOf } from '../catalog/regions';
import type { BodyRegion, Exercise, RegionGoal } from '../types';
import { fitWeek, type MuscleBudget, type WeekPlan } from './budget';
import { applyFocus, heldEnough, trainsShortFocus, weekSets } from './focus';
import { planNextType, type RotationWorkout } from './next';

const exercises = new Map<string, Exercise>(CATALOG.map((e) => [e.id, e]));
type Goals = Partial<Record<BodyRegion, RegionGoal>>;

/** A Monday. */
const TODAY = '2026-03-02';
const pace = { today: TODAY, perWeek: 3 };

function daysBefore(days: number): string {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const on = (daysAgo: number, exerciseIds: string[], sets: Record<string, number> = {}): RotationWorkout => {
  const date = daysBefore(daysAgo);
  return { id: date, date, exerciseIds, workSets: Object.fromEntries(exerciseIds.map((id) => [id, sets[id] ?? 3])) };
};

const CHEST = ['barbell-bench-press', 'incline-dumbbell-press', 'machine-chest-press', 'pec-deck', 'cable-crossover'];
const LEGS = ['barbell-squat', 'leg-press', 'lying-leg-curl', 'leg-extension', 'seated-leg-curl'];
const BACK = ['barbell-row', 'lat-pulldown', 'seated-cable-row', 'shrug', 'straight-arm-pulldown'];

/** `next`, `other`, `next`, `other`, every two days and all over a week ago, so `next` comes up today. */
const alternating = (next: string[], other: string[]): RotationWorkout[] =>
  [20, 18, 16, 14, 12, 10].map((daysAgo, i) => on(daysAgo, i % 2 ? other : next));

const plan = (workouts: RotationWorkout[], goals: Goals = {}, pick = {}) => planNextType(workouts, exercises, pace, pick, goals)!;
const week = (workouts: RotationWorkout[]) => weekSets(workouts, exercises, TODAY);

describe('weekSets', () => {
  it('counts a main region in full and a helper as half', () => {
    const sets = week([on(1, ['barbell-bench-press'], { 'barbell-bench-press': 8 })]);
    expect(sets.get('chest')).toBe(8);
    expect(sets.get('triceps')).toBe(4);
  });

  it('counts the last 7 days and nothing else', () => {
    const sets = week([on(7, ['pec-deck']), on(6, ['pec-deck']), on(0, ['pec-deck']), on(-1, ['pec-deck'])]);
    expect(sets.get('chest')).toBe(6);
  });

  it('skips exercises it doesn’t know', () => {
    expect(week([on(1, ['gone'])]).size).toBe(0);
  });
});

describe('with no goals', () => {
  const workouts = [...alternating(CHEST, LEGS), on(8, ['lateral-raise'])];

  it('plans just as before', () => {
    expect(plan(workouts)).toEqual(planNextType(workouts, exercises, pace));
    expect(plan(workouts).focus).toEqual([]);
  });

  it('treats Ignore as no goal', () => {
    expect(plan(workouts, { sideDelts: 'ignore', chest: 'ignore' })).toEqual(plan(workouts));
  });

  it('follows no goal without today’s date', () => {
    const goals: Goals = { sideDelts: 'focus', chest: 'maintain' };
    expect(planNextType(workouts, exercises, undefined, {}, goals)).toEqual(planNextType(workouts, exercises));
  });
});

describe('a Focus muscle', () => {
  const history = alternating(CHEST, [...LEGS.slice(0, 4), 'lateral-raise']);

  it('goes on top of a five-exercise workout, last', () => {
    const { exerciseIds, focus } = plan(history, { sideDelts: 'focus' });
    expect(exerciseIds).toEqual([...CHEST, 'lateral-raise']);
    expect(focus).toEqual([{ exerciseId: 'lateral-raise', region: 'sideDelts', fresh: false }]);
  });

  it('takes the last filler’s place for a second muscle, the shortest first', () => {
    const { exerciseIds, focus } = plan(history, { sideDelts: 'focus', rearDelts: 'focus' });
    expect(exerciseIds).toEqual([...CHEST.slice(0, 4), 'lateral-raise', focus[1].exerciseId]);
    expect(focus[0]).toMatchObject({ region: 'sideDelts' });
    expect(focus[1]).toMatchObject({ region: 'rearDelts', fresh: true, replaced: 'cable-crossover' });
  });

  it('only swaps in a workout that’s already at six', () => {
    const six = [...CHEST.slice(0, 4), 'dumbbell-fly', 'cable-crossover'];
    const { exerciseIds, focus } = plan(alternating(six, [...LEGS.slice(0, 4), 'lateral-raise']), { sideDelts: 'focus' });
    expect(exerciseIds).toEqual([...six.slice(0, 5), 'lateral-raise']);
    expect(focus).toEqual([{ exerciseId: 'lateral-raise', region: 'sideDelts', fresh: false, replaced: 'cable-crossover' }]);
  });

  it('never goes past six exercises or two picks', () => {
    const goals: Goals = { sideDelts: 'focus', rearDelts: 'focus', biceps: 'focus', triceps: 'focus', abs: 'focus' };
    const { exerciseIds, focus } = plan(history, goals);
    expect(exerciseIds).toHaveLength(6);
    expect(focus).toHaveLength(2);
  });

  it('never touches a main lift, and leaves a muscle unserved with no filler to swap', () => {
    const three = CHEST.slice(0, 3);
    const { exerciseIds, focus } = plan(alternating(three, LEGS.slice(0, 3)), { sideDelts: 'focus', rearDelts: 'focus' });
    expect(exerciseIds.slice(0, 3)).toEqual(three);
    expect(exerciseIds).toHaveLength(4);
    expect(focus).toHaveLength(1);
  });

  it('swaps a Maintain muscle’s filler before the last filler', () => {
    const goals: Goals = { upperBack: 'maintain', sideDelts: 'focus', rearDelts: 'focus' };
    const { exerciseIds, focus } = plan(alternating(BACK, [...LEGS.slice(0, 4), 'lateral-raise']), goals);
    expect(focus[1].replaced).toBe('shrug');
    expect(exerciseIds).toContain('straight-arm-pulldown');
  });

  it('never swaps a filler of another Focus muscle', () => {
    const { focus } = plan(alternating(BACK, [...LEGS.slice(0, 4), 'lateral-raise']), { lats: 'focus', sideDelts: 'focus', rearDelts: 'focus' });
    expect(focus.map((pick) => pick.region)).toEqual(['sideDelts', 'rearDelts']);
    expect(focus[1].replaced).toBe('shrug');
  });

  it('leaves a partner muscle’s filler alone', () => {
    const day = [...CHEST.slice(0, 3), 'pec-deck', 'barbell-curl'];
    const { focus } = plan(alternating(day, [...LEGS.slice(0, 4), 'lateral-raise']), { sideDelts: 'focus', rearDelts: 'focus' });
    expect(focus[1].replaced).toBe('pec-deck');
  });

  it('changes nothing once the week’s range is met', () => {
    const met = [...history.slice(0, -1), on(3, [...LEGS.slice(0, 4), 'lateral-raise'], { 'lateral-raise': 9 })];
    expect(plan(met, { sideDelts: 'focus' }).exerciseIds).toEqual(CHEST);
  });

  it('counts what’s already planned for the muscle', () => {
    // Chest's Focus range starts at 12 sets, and five exercises come to 15.
    expect(plan(history, { chest: 'focus' }).focus).toEqual([]);
  });

  it('adds what a helper left short, and not what it covered', () => {
    const benched = (sets: number) => [...alternating(LEGS, CHEST).slice(0, -1), on(3, CHEST, { ...Object.fromEntries(CHEST.map((id) => [id, 0])), 'barbell-bench-press': sets })];
    expect(plan(benched(18), { triceps: 'focus' }).focus).toEqual([]);
    expect(plan(benched(16), { triceps: 'focus' }).focus.map((pick) => pick.region)).toEqual(['triceps']);
  });

  it('waits for its own day when it’s chest, back or legs', () => {
    expect(plan(alternating(LEGS, CHEST), { chest: 'focus' }).exerciseIds).toEqual(LEGS);
    expect(plan(alternating(CHEST, LEGS), { quads: 'focus' }).exerciseIds).toEqual(CHEST);
  });

  it('joins any day when it’s shoulders or a small muscle', () => {
    const legDay = alternating(LEGS, CHEST);
    expect(plan(legDay, { sideDelts: 'focus' }).focus).toHaveLength(1);
    expect(plan(legDay, { biceps: 'focus' }).focus).toHaveLength(1);
    expect(plan(alternating(CHEST, LEGS), { calves: 'focus' }).focus).toHaveLength(1);
  });

  it('prefers what the user did lately, then earlier, then something new', () => {
    const long = [on(70, ['machine-lateral-raise']), ...alternating(CHEST, LEGS)];
    const fromOlder = plan(long, { sideDelts: 'focus' }).focus[0];
    expect(fromOlder).toEqual({ exerciseId: 'machine-lateral-raise', region: 'sideDelts', fresh: false });
    const lately = [on(70, ['machine-lateral-raise']), ...alternating(CHEST, [...LEGS.slice(0, 4), 'lateral-raise'])];
    expect(plan(lately, { sideDelts: 'focus' }).focus[0].exerciseId).toBe('machine-lateral-raise');
  });

  it('turns to the catalogue with no history, preferring equipment in use and isolation work', () => {
    const { focus } = plan(alternating(CHEST, LEGS), { sideDelts: 'focus' });
    const picked = exercises.get(focus[0].exerciseId)!;
    expect(focus[0].fresh).toBe(true);
    expect(regionsOf(picked).main).toContain('sideDelts');
    expect(picked.compound).toBe(false);
    expect(['barbell', 'dumbbell', 'machine', 'cable']).toContain(picked.equipment);
  });

  it('takes a user’s own exercise too', () => {
    const own: Exercise = { ...exercises.get('pec-deck')!, id: 'custom-1', muscle: 'calves', compound: false };
    const withOwn = new Map([[own.id, own], ...exercises]);
    const { focus } = planNextType(alternating(CHEST, LEGS), withOwn, pace, {}, { calves: 'focus' })!;
    expect(focus[0]).toMatchObject({ exerciseId: 'custom-1', fresh: true });
  });

  it('doesn’t take back what the week left out', () => {
    const fit = applyFocus(
      { exerciseIds: CHEST, anchors: CHEST.slice(0, 3), groups: ['chest'], partners: [], leftOut: ['lateral-raise'], max: 6, recent: ['lateral-raise', 'cable-lateral-raise'], older: [] },
      { sideDelts: 'focus' },
      new Map(),
      exercises,
    );
    expect(fit.picks.map((pick) => pick.exerciseId)).toEqual(['cable-lateral-raise']);
  });

  it('works the same on a type picked by hand', () => {
    const { exerciseIds, focus } = plan(history, { sideDelts: 'focus' }, { type: 'legs' });
    expect(exerciseIds).toContain(focus[0].exerciseId);
    expect(exerciseIds.slice(0, 3)).toEqual(LEGS.slice(0, 3));
    expect(focus[0].region).toBe('sideDelts');
  });

  it('keeps its filler when the muscle’s usual week would leave it out', () => {
    // Curls once a week with chest, and this week's already came with legs.
    const workouts: RotationWorkout[] = [];
    for (let week = 7; week >= 1; week--) workouts.push(on(7 * week + 5, [...CHEST.slice(0, 4), 'barbell-curl']), on(7 * week + 2, LEGS));
    workouts.push(on(5, [...LEGS.slice(0, 4), 'barbell-curl']));
    expect(plan(workouts).leftOut).toEqual(['barbell-curl']);
    const { exerciseIds, leftOut } = plan(workouts, { biceps: 'focus' });
    expect(leftOut).toEqual([]);
    expect(exerciseIds).toContain('barbell-curl');
  });
});

describe('a Maintain muscle', () => {
  const day = [...CHEST.slice(0, 3), 'pec-deck', 'barbell-curl'];
  const curledThisWeek = [...alternating(day, LEGS).slice(0, -1), on(3, [...LEGS.slice(0, 4), 'barbell-curl'])];

  it('gives up a filler once it has had enough', () => {
    const { exerciseIds, leftOut } = plan(curledThisWeek, { biceps: 'maintain' });
    expect(leftOut).toEqual(['barbell-curl']);
    expect(exerciseIds).not.toContain('barbell-curl');
  });

  it('keeps it while the week is short of the lower range', () => {
    expect(plan(alternating(day, LEGS), { biceps: 'maintain' }).exerciseIds).toEqual(day);
  });

  it('leaves its main lifts alone', () => {
    const met = [...alternating(CHEST, LEGS).slice(0, -1), on(3, [...LEGS, 'pec-deck'])];
    const { exerciseIds, leftOut } = plan(met, { chest: 'maintain' });
    expect(exerciseIds).toEqual(CHEST.slice(0, 3));
    expect(leftOut).toEqual(CHEST.slice(3));
  });

  it('keeps an exercise that’s also for a muscle with no goal', () => {
    const day = ['lat-pulldown', 'close-grip-pulldown', 'machine-pulldown', 'seated-cable-row', 'straight-arm-pulldown'];
    const met = [...alternating(day, LEGS).slice(0, -1), on(3, [...LEGS, 'straight-arm-pulldown'])];
    expect(regionsOf(exercises.get('seated-cable-row')!).main).toEqual(['lats', 'upperBack']);
    const { exerciseIds, leftOut } = plan(met, { lats: 'maintain' });
    expect(leftOut).toEqual(['straight-arm-pulldown']);
    expect(exerciseIds).toContain('seated-cable-row');
  });

  it('never counts an exercise with no region as held', () => {
    expect(heldEnough(exercises.get('treadmill')!, {}, new Map())).toBe(false);
  });
});

describe('fitWeek with goals', () => {
  const lift = (id: string, muscle: Exercise['muscle']): Exercise => ({ id, names: { en: id, de: id, ru: id }, muscle, equipment: 'barbell', load: 'weight', compound: true });
  const own = new Map([lift('a', 'chest'), lift('b', 'chest'), lift('c', 'biceps'), lift('d', 'biceps')].map((e) => [e.id, e]));
  const base: WeekPlan = {
    exerciseIds: ['a', 'b', 'c'],
    anchors: ['a'],
    groups: ['chest'],
    partners: [],
    elsewhere: [],
    size: 3,
    min: 3,
    pool: [],
    borrowable: [],
  };

  it('holds the floor even when a filler has had enough', () => {
    expect(fitWeek({ ...base, enough: (id) => id === 'c' }, new Map(), own).exerciseIds).toEqual(['a', 'b', 'c']);
    expect(fitWeek({ ...base, min: 2, enough: (id) => id === 'c' }, new Map(), own)).toMatchObject({ exerciseIds: ['a', 'b'], leftOut: ['c'] });
  });

  it('doesn’t bring it back from the pool', () => {
    const fit = fitWeek({ ...base, exerciseIds: ['a', 'b'], min: 2, pool: ['d'], enough: (id) => id === 'd' }, new Map(), own);
    expect(fit.exerciseIds).toEqual(['a', 'b']);
  });

  it('keeps what a goal needs over the usual count', () => {
    const budgets = new Map<Exercise['muscle'], MuscleBudget>([['biceps', { usual: 1, done: 1 }]]);
    const floor = { ...base, min: 2 };
    expect(fitWeek(floor, budgets, own).leftOut).toEqual(['c']);
    expect(fitWeek({ ...floor, needed: (id) => id === 'c' }, budgets, own).leftOut).toEqual([]);
  });
});

describe('trainsShortFocus', () => {
  const curl = exercises.get('barbell-curl')!;

  it('goes by the Focus range', () => {
    expect(trainsShortFocus(curl, { biceps: 'focus' }, new Map([['biceps', 8]]))).toBe(true);
    expect(trainsShortFocus(curl, { biceps: 'focus' }, new Map([['biceps', 9]]))).toBe(false);
    expect(trainsShortFocus(curl, { biceps: 'maintain' }, new Map())).toBe(false);
  });
});
