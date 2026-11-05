import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { difficultyOf } from '../catalog/difficulty';
import { CATALOG } from '../catalog/exercises';
import { regionsOf } from '../catalog/regions';
import { toISODate } from '../dates';
import { db } from '../db/schema';
import { settings } from '../settings.svelte';
import type { BodyRegion, Exercise, RegionGoal, WorkoutSet } from '../types';
import type { MuscleGroup } from '../catalog/groups';
import { typeTitle } from '../workout/title';
import { loadNextWorkout } from './data';
import { fitWeek, type MuscleBudget, type WeekPlan } from './budget';
import { applyFocus, focusWeek, heldEnough, lastMainWork, maxWorkoutSets, trainsShortFocus, weekSets, type FocusPlan, type FocusWeek, type RegionSets } from './focus';
import { planNextType, workoutTypes, type RotationWorkout } from './next';

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
      { exerciseIds: CHEST, anchors: CHEST.slice(0, 3), groups: ['chest'], partners: [], leftOut: ['lateral-raise'], max: 6, recent: ['lateral-raise', 'cable-lateral-raise'], older: [], usualPoints: 8 },
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

describe('what a Focus pick costs and where it goes', () => {
  /** LEGS comes to 8 points, so a usual day has 9 to work with. Its fillers are leg extension and seated curl. */
  const legDay: FocusPlan = { exerciseIds: LEGS, anchors: LEGS.slice(0, 3), groups: ['legs'], partners: [], leftOut: [], max: 6, recent: [], older: [], usualPoints: 8 };
  /** BACK comes to 9 points. Its fillers are shrug and straight-arm pulldown. */
  const backDay: FocusPlan = { ...legDay, exerciseIds: BACK, anchors: BACK.slice(0, 3), groups: ['back'], usualPoints: 9 };
  const fit = (base: FocusPlan, goals: Goals, sets: RegionSets = new Map()) => applyFocus(base, goals, sets, exercises);

  it('counts a planned helper at half, so helpers can cover a muscle', () => {
    // Glutes' Focus range starts at 6 sets: these help with 1.5 each.
    const helping = ['smith-squat', 'leg-press', 'hack-squat', 'goblet-squat'];
    expect(plan(alternating([...helping, 'leg-extension'], CHEST), { glutes: 'focus' }).focus).toEqual([]);
    const short = [...helping.slice(0, 3), 'leg-extension', 'seated-leg-curl'];
    expect(plan(alternating(short, CHEST), { glutes: 'focus' }).focus.map((pick) => pick.region)).toEqual(['glutes']);
  });

  it('adds no deadlift on top of a back day', () => {
    const { exerciseIds, focus } = plan([on(70, ['deadlift']), ...alternating(BACK, LEGS)], { glutes: 'focus' });
    expect(focus).toEqual([]);
    expect(exerciseIds).toEqual(BACK);
  });

  it('adds that deadlift when the day usually costs that much', () => {
    const { picks } = fit({ ...backDay, recent: ['deadlift'], usualPoints: 11 }, { glutes: 'focus' });
    expect(picks.map((pick) => pick.exerciseId)).toEqual(['deadlift']);
  });

  it('tries the next exercise, even one done more recently', () => {
    const { exerciseIds, picks } = fit({ ...backDay, partners: ['glutes'], recent: ['deadlift', 'hip-abductor'] }, { glutes: 'focus' });
    expect(picks).toEqual([{ exerciseId: 'hip-abductor', region: 'glutes', fresh: false }]);
    // Glutes join this back day, so their pick goes straight after the main lifts.
    expect(exerciseIds).toEqual([...BACK.slice(0, 3), 'hip-abductor', ...BACK.slice(3)]);
  });

  it('leaves a hard lift out of a leg day at its usual cost, even in a filler’s place', () => {
    const history = [on(70, ['bulgarian-split-squat']), ...alternating(LEGS, [...CHEST.slice(0, 4), 'hip-abductor'])];
    const { exerciseIds, focus } = plan(history, { glutes: 'focus' });
    expect(exerciseIds).toEqual([...LEGS.slice(0, 3), 'hip-abductor', ...LEGS.slice(3)]);
    expect(focus).toEqual([{ exerciseId: 'hip-abductor', region: 'glutes', fresh: false }]);
  });

  it('replaces a filler for its other main muscle rather than going on top', () => {
    const { exerciseIds, picks } = fit({ ...legDay, recent: ['bulgarian-split-squat'], usualPoints: 9 }, { glutes: 'focus' });
    expect(picks).toEqual([{ exerciseId: 'bulgarian-split-squat', region: 'glutes', fresh: false, replaced: 'leg-extension', overlap: 'quads' }]);
    expect(exerciseIds).toEqual([...LEGS.slice(0, 3), 'bulgarian-split-squat', 'seated-leg-curl']);
  });

  it('takes the last of several fillers for that muscle', () => {
    const day = [...LEGS.slice(0, 3), 'leg-extension', 'wall-sit'];
    const { picks } = fit({ ...legDay, exerciseIds: day, recent: ['bulgarian-split-squat'], usualPoints: 9 }, { glutes: 'focus' });
    expect(picks[0]).toMatchObject({ replaced: 'wall-sit', overlap: 'quads' });
  });

  it('goes on top when only a main lift trains that muscle', () => {
    const { exerciseIds, picks } = fit({ ...legDay, exerciseIds: LEGS.slice(0, 3), recent: ['bulgarian-split-squat'] }, { glutes: 'focus' });
    expect(picks).toEqual([{ exerciseId: 'bulgarian-split-squat', region: 'glutes', fresh: false }]);
    expect(exerciseIds).toEqual([...LEGS.slice(0, 3), 'bulgarian-split-squat']);
  });

  it('marks no overlap on a swap made for room', () => {
    const { picks } = fit({ ...backDay, max: 5, recent: ['lateral-raise'] }, { sideDelts: 'focus' });
    expect(picks).toEqual([{ exerciseId: 'lateral-raise', region: 'sideDelts', fresh: false, replaced: 'straight-arm-pulldown' }]);
  });

  it('keeps the on-top slot after replacing a filler for its muscle', () => {
    // Glutes are 1.5 short and calves 1, so glutes go first.
    const { exerciseIds, picks } = fit(
      { ...legDay, recent: ['bulgarian-split-squat', 'standing-calf-raise'], usualPoints: 10 },
      { glutes: 'focus', calves: 'focus' },
      new Map([['calves', 5]]),
    );
    expect(picks.map((pick) => pick.region)).toEqual(['glutes', 'calves']);
    expect(picks[1].replaced).toBeUndefined();
    expect(exerciseIds).toEqual([...LEGS.slice(0, 3), 'bulgarian-split-squat', 'seated-leg-curl', 'standing-calf-raise']);
  });

  it('puts medium and hard picks straight after the main lifts, in pick order', () => {
    const { exerciseIds, picks } = fit({ ...backDay, recent: ['seated-dip-machine', 'overhead-press'], usualPoints: 30 }, { triceps: 'focus', frontDelts: 'focus' });
    expect(picks.map((pick) => pick.exerciseId)).toEqual(['seated-dip-machine', 'overhead-press']);
    expect(exerciseIds).toEqual([...BACK.slice(0, 3), 'seated-dip-machine', 'overhead-press', 'shrug']);
  });

  it('keeps light picks last, whatever comes after them', () => {
    const { exerciseIds, picks } = fit({ ...backDay, recent: ['lateral-raise', 'overhead-press'], usualPoints: 30 }, { sideDelts: 'focus', frontDelts: 'focus' });
    expect(picks.map((pick) => pick.exerciseId)).toEqual(['lateral-raise', 'overhead-press']);
    expect(exerciseIds).toEqual([...BACK.slice(0, 3), 'overhead-press', 'shrug', 'lateral-raise']);
  });

  it('puts a light pick for the day’s own muscle straight after the main lifts', () => {
    const { exerciseIds, picks } = fit({ ...legDay, recent: ['hip-abductor'], usualPoints: 30 }, { glutes: 'focus' });
    expect(picks).toEqual([{ exerciseId: 'hip-abductor', region: 'glutes', fresh: false }]);
    expect(exerciseIds).toEqual([...LEGS.slice(0, 3), 'hip-abductor', ...LEGS.slice(3)]);
  });

  it('puts a heavier pick after it ahead of it', () => {
    const { exerciseIds, picks } = fit({ ...legDay, exerciseIds: LEGS.slice(0, 4), recent: ['seated-leg-curl', 'hack-squat'], usualPoints: 30 }, { hamstrings: 'focus', quads: 'focus' });
    expect(picks.map((pick) => pick.exerciseId)).toEqual(['seated-leg-curl', 'hack-squat']);
    expect(exerciseIds).toEqual([...LEGS.slice(0, 3), 'hack-squat', 'seated-leg-curl', 'leg-extension']);
  });

  it('keeps a small muscle’s light pick last', () => {
    const { exerciseIds } = fit({ ...legDay, recent: ['standing-calf-raise'], usualPoints: 30 }, { calves: 'focus' });
    expect(exerciseIds).toEqual([...LEGS, 'standing-calf-raise']);
  });

  it('places a pick by the same rule when it replaces a filler, not in the filler’s slot', () => {
    const forMuscle = fit({ ...legDay, recent: ['romanian-deadlift'], usualPoints: 9 }, { glutes: 'focus' });
    expect(forMuscle.picks[0]).toMatchObject({ replaced: 'seated-leg-curl', overlap: 'hamstrings' });
    expect(forMuscle.exerciseIds).toEqual([...LEGS.slice(0, 3), 'romanian-deadlift', 'leg-extension']);
    const forRoom = fit({ ...backDay, max: 5, recent: ['overhead-press'], usualPoints: 30 }, { frontDelts: 'focus' });
    expect(forRoom.picks[0]).toMatchObject({ replaced: 'straight-arm-pulldown' });
    expect(forRoom.exerciseIds).toEqual([...BACK.slice(0, 3), 'overhead-press', 'shrug']);
  });

  it('picks nothing when nothing passes the limit', () => {
    const mainLifts = LEGS.slice(0, 3);
    const { exerciseIds, picks, extra } = fit({ ...legDay, exerciseIds: mainLifts, recent: ['hip-abductor', ...mainLifts], usualPoints: 4 }, { glutes: 'focus' });
    expect({ exerciseIds, picks }).toEqual({ exerciseIds: mainLifts, picks: [] });
    // Only the squat trains glutes here: a main lift, and hard, so it takes no set more either.
    expect(extra).toEqual([]);
  });

  it('only gates picks: a plan over the limit stays as it is', () => {
    const mainLifts = LEGS.slice(0, 3);
    expect(fit({ ...legDay, exerciseIds: mainLifts, usualPoints: 3 }, { glutes: 'focus' }).exerciseIds).toEqual(mainLifts);
  });

  it('takes a filler’s place when going on top would cost too much', () => {
    const { exerciseIds, picks } = fit({ ...legDay, recent: ['hip-thrust'] }, { glutes: 'focus' });
    expect(picks).toEqual([{ exerciseId: 'hip-thrust', region: 'glutes', fresh: false, replaced: 'seated-leg-curl' }]);
    expect(exerciseIds).toEqual([...LEGS.slice(0, 3), 'hip-thrust', 'leg-extension']);
  });

  it('passes over an avoided exercise for the next one', () => {
    const { picks } = fit({ ...legDay, recent: ['hip-thrust', 'hip-abductor'], avoid: new Set(['hip-thrust']) }, { glutes: 'focus' });
    expect(picks).toEqual([{ exerciseId: 'hip-abductor', region: 'glutes', fresh: false }]);
  });

  it('still swaps like for like in a plan over the limit', () => {
    const { picks } = fit({ ...backDay, max: 5, recent: ['lateral-raise'], usualPoints: 3 }, { sideDelts: 'focus' });
    expect(picks).toEqual([{ exerciseId: 'lateral-raise', region: 'sideDelts', fresh: false, replaced: 'straight-arm-pulldown' }]);
  });

  it('goes by what the variant’s workouts usually cost, not by today’s shorter plan', () => {
    // Nine points as a rule, and seven today because Maintain left the press out.
    const day = [...LEGS.slice(0, 3), 'leg-extension', 'dumbbell-shoulder-press'];
    const history = [on(70, ['bulgarian-split-squat']), ...alternating(day, CHEST).slice(0, -1), on(3, [...CHEST.slice(0, 4), 'dumbbell-shoulder-press'])];
    const { exerciseIds, focus, leftOut } = plan(history, { frontDelts: 'maintain', glutes: 'focus' });
    expect(leftOut).toEqual(['dumbbell-shoulder-press']);
    expect(focus).toEqual([{ exerciseId: 'bulgarian-split-squat', region: 'glutes', fresh: false, replaced: 'leg-extension', overlap: 'quads' }]);
    expect(exerciseIds).toEqual([...LEGS.slice(0, 3), 'bulgarian-split-squat']);
  });

  it('takes the median, so one big day doesn’t raise the limit', () => {
    const history = [on(70, ['bulgarian-split-squat']), on(20, [...LEGS, 'deadlift', 'overhead-press']), ...alternating(LEGS, CHEST).slice(1)];
    const { exerciseIds, focus } = plan(history, { glutes: 'focus' });
    expect(focus.map((pick) => pick.exerciseId)).toEqual(['hip-abductor']);
    expect(exerciseIds).toEqual([...LEGS.slice(0, 3), 'hip-abductor', ...LEGS.slice(3)]);
  });

  describe('done once after the main lifts', () => {
    // The last leg day had the pick straight after the main lifts, one exercise over the usual five.
    const withPick = [...LEGS.slice(0, 3), 'hip-abductor', ...LEGS.slice(3)];
    const history = [on(70, ['bulgarian-split-squat']), ...alternating(LEGS, CHEST).slice(0, 4), on(12, withPick), on(10, CHEST)];

    it('is what the plan cuts, not the last filler, and Focus brings it back in its place', () => {
      const { exerciseIds, focus } = plan(history, { glutes: 'focus' });
      expect(exerciseIds).toEqual(withPick);
      expect(focus).toEqual([{ exerciseId: 'hip-abductor', region: 'glutes', fresh: false }]);
    });

    it('goes once the goal is off, and the usual workout comes back', () => {
      expect(plan(history).exerciseIds).toEqual(LEGS);
    });
  });
});

describe('a set more for a Focus muscle', () => {
  const PRESSES = ['barbell-bench-press', 'incline-dumbbell-press', 'pec-deck'];
  /** Nothing can join: the day is full, and the presses are its main lifts. */
  const full: FocusPlan = { exerciseIds: PRESSES, anchors: PRESSES.slice(0, 2), groups: ['chest'], partners: [], leftOut: [], max: 3, recent: PRESSES, older: [], usualPoints: 30 };
  const fit = (base: FocusPlan, goals: Goals, sets: RegionSets = new Map()) => applyFocus(base, goals, sets, exercises);

  it('goes on the pec deck, never on the bench or incline press, the main lifts', () => {
    // Chest's Focus range starts at 12, and three exercises plan 9.
    expect(fit(full, { chest: 'focus' }).extra).toEqual([{ exerciseId: 'pec-deck', region: 'chest' }]);
  });

  it('goes on a light exercise first, then a medium one that isn’t a main lift, one set each', () => {
    const day = ['barbell-bench-press', 'machine-chest-press', 'pec-deck'];
    const base = { ...full, exerciseIds: day, anchors: day.slice(0, 1), recent: day };
    expect(fit(base, { chest: 'focus' }).extra.map((e) => e.exerciseId)).toEqual(['pec-deck', 'machine-chest-press']);
    expect(fit(base, { chest: 'focus' }, new Map([['chest', 2]])).extra).toEqual([{ exerciseId: 'pec-deck', region: 'chest' }]);
  });

  it('takes a light main lift, a few easy minutes', () => {
    expect(fit({ ...full, anchors: PRESSES }, { chest: 'focus' }).extra).toEqual([{ exerciseId: 'pec-deck', region: 'chest' }]);
  });

  it('never goes on a hard exercise, even one that isn’t a main lift', () => {
    const day = ['leg-press', 'bulgarian-split-squat', 'leg-extension'];
    const legs: FocusPlan = { ...full, exerciseIds: day, anchors: day.slice(0, 1), groups: ['legs'], recent: day };
    expect(fit(legs, { quads: 'focus' }).extra).toEqual([{ exerciseId: 'leg-extension', region: 'quads' }]);
  });

  it('adds none when only main lifts and hard exercises train the muscle, and the muscle waits', () => {
    const day = ['barbell-squat', 'leg-press', 'bulgarian-split-squat'];
    const legs: FocusPlan = { ...full, exerciseIds: day, anchors: day.slice(0, 2), groups: ['legs'], recent: day };
    expect(fit(legs, { quads: 'focus' })).toEqual({ exerciseIds: day, picks: [], extra: [] });
  });

  it('adds nothing once the week has had enough, or without a Focus', () => {
    expect(fit(full, { chest: 'focus' }, new Map([['chest', 3]])).extra).toEqual([]);
    expect(fit(full, {}).extra).toEqual([]);
    expect(fit(full, { chest: 'maintain' }).extra).toEqual([]);
  });

  it('keeps to a few sets a workout', () => {
    const day = [...PRESSES, 'rope-pushdown', 'lateral-raise', 'cable-lateral-raise', 'dumbbell-curl'];
    const withArms = { ...full, exerciseIds: day, max: day.length, recent: day };
    const { extra } = fit(withArms, { chest: 'focus', triceps: 'focus', sideDelts: 'focus', biceps: 'focus' });
    expect(extra).toHaveLength(4);
    expect(new Set(extra.map((e) => e.exerciseId)).size).toBe(4);
    expect(extra[0]).toEqual({ exerciseId: 'pec-deck', region: 'chest' });
  });

  it('only goes on exercises the user has done', () => {
    // Nothing to copy a set from: the pec deck is new to the user, and the rest are main lifts.
    expect(fit({ ...full, recent: PRESSES.slice(0, 2) }, { chest: 'focus' }).extra).toEqual([]);
  });

  it('gives a pick none on the day it’s first brought in, and one from its second time', () => {
    const two = PRESSES.slice(0, 2);
    const first = fit({ ...full, exerciseIds: two, recent: two }, { chest: 'focus' });
    expect(first.picks).toMatchObject([{ fresh: true }]);
    expect(first.extra).toEqual([]);
    const again = fit({ ...full, exerciseIds: two, recent: [...two, 'cable-crossover'] }, { chest: 'focus' });
    expect(again.picks).toEqual([{ exerciseId: 'cable-crossover', region: 'chest', fresh: false }]);
    expect(again.extra).toEqual([{ exerciseId: 'cable-crossover', region: 'chest' }]);
  });

  it('counts the sets of a new exercise first', () => {
    const roomy = { ...full, max: 4 };
    const { picks, extra } = fit({ ...roomy, recent: [...PRESSES, 'cable-crossover'] }, { chest: 'focus' });
    expect(picks.map((p) => p.exerciseId)).toEqual(['cable-crossover']);
    expect(extra).toEqual([]);
  });

  it('lets a second pick go on top when there is no filler to give up', () => {
    const LEGS_ALL: FocusPlan = { ...full, exerciseIds: LEGS, anchors: LEGS, groups: ['legs'], max: 7 };
    const { picks, exerciseIds } = fit({ ...LEGS_ALL, recent: [...LEGS, 'hip-thrust', 'standing-calf-raise'] }, { glutes: 'focus', calves: 'focus' });
    expect(picks.map((p) => p.exerciseId).sort()).toEqual(['hip-thrust', 'standing-calf-raise']);
    expect(picks.every((p) => p.replaced === undefined)).toBe(true);
    expect(exerciseIds).toHaveLength(7);
  });
});

describe('light work on another day', () => {
  const CHEST4 = CHEST.slice(0, 4);
  /** 7 points, so a usual day has 8 to work with. Its one filler is the pec deck. Legs come after back. */
  const chestDay: FocusPlan = {
    exerciseIds: CHEST4,
    anchors: CHEST4.slice(0, 3),
    groups: ['chest'],
    partners: [],
    leftOut: [],
    max: 6,
    recent: ['lying-leg-curl', 'seated-leg-curl', 'leg-extension'],
    older: [],
    usualPoints: 7,
    today: TODAY,
    lastMain: new Map([
      ['hamstrings', daysBefore(3)],
      ['quads', daysBefore(3)],
    ]),
    nextGroups: ['back'],
    nextPartners: [],
  };
  const fit = (base: FocusPlan, goals: Goals, sets: RegionSets = new Map()) => applyFocus(base, goals, sets, exercises);
  const hamstrings: Goals = { hamstrings: 'focus' };

  it('brings in one light exercise for a short muscle that can’t join, on top and last', () => {
    const { exerciseIds, picks, extra } = fit(chestDay, hamstrings);
    expect(picks).toEqual([{ exerciseId: 'lying-leg-curl', region: 'hamstrings', fresh: false, otherDay: true }]);
    expect(exerciseIds).toEqual([...CHEST4, 'lying-leg-curl']);
    // Light work on another day stays as it is, though the user has done it before.
    expect(extra).toEqual([]);
  });

  it('only takes light exercises', () => {
    const { picks } = fit({ ...chestDay, recent: ['leg-press', 'hack-squat', 'barbell-squat'], usualPoints: 30 }, { quads: 'focus' });
    expect(picks).toHaveLength(1);
    const picked = exercises.get(picks[0].exerciseId)!;
    expect(difficultyOf(picked)).toBe('light');
    expect(regionsOf(picked).main).toContain('quads');
    expect(picks[0]).toMatchObject({ fresh: true, otherDay: true });
    const backDay: FocusPlan = { ...chestDay, exerciseIds: BACK, anchors: BACK.slice(0, 3), groups: ['back'], recent: ['machine-chest-press', 'pec-deck'], usualPoints: 30, nextGroups: ['legs'] };
    expect(fit(backDay, { chest: 'focus' }).picks.map((pick) => pick.exerciseId)).toEqual(['pec-deck']);
  });

  it('waits two days after the muscle’s main work', () => {
    const after = (days: number) => fit({ ...chestDay, lastMain: new Map([['hamstrings', daysBefore(days)]]) }, hamstrings).picks;
    expect(after(0)).toEqual([]);
    expect(after(1)).toEqual([]);
    expect(after(2)).toHaveLength(1);
    expect(fit({ ...chestDay, lastMain: new Map() }, hamstrings).picks).toHaveLength(1);
  });

  it('waits when the muscle’s own day comes next', () => {
    expect(fit({ ...chestDay, nextGroups: ['legs'] }, hamstrings).picks).toEqual([]);
    expect(fit({ ...chestDay, nextPartners: ['legs'] }, hamstrings).picks).toEqual([]);
    // Without a next type, only the rest days count.
    expect(fit({ ...chestDay, nextGroups: undefined }, hamstrings).picks).toHaveLength(1);
  });

  it('brings in at most one a workout, for the muscle furthest short', () => {
    const { picks } = fit({ ...chestDay, usualPoints: 30 }, { quads: 'focus', hamstrings: 'focus' });
    expect(picks).toEqual([{ exerciseId: 'leg-extension', region: 'quads', fresh: false, otherDay: true }]);
  });

  it('comes before the picks for small muscles, which take a filler’s place then', () => {
    const recent = [...chestDay.recent, 'lateral-raise', 'rear-delt-fly'];
    const { exerciseIds, picks } = fit({ ...chestDay, recent }, { sideDelts: 'focus', hamstrings: 'focus' }, new Map([['sideDelts', 6]]));
    expect(picks).toEqual([
      { exerciseId: 'lying-leg-curl', region: 'hamstrings', fresh: false, otherDay: true },
      { exerciseId: 'lateral-raise', region: 'sideDelts', fresh: false, replaced: 'pec-deck' },
    ]);
    expect(exerciseIds).toEqual([...CHEST4.slice(0, 3), 'lying-leg-curl', 'lateral-raise']);
    const two = fit({ ...chestDay, recent }, { sideDelts: 'focus', rearDelts: 'focus', hamstrings: 'focus' });
    expect(two.picks.map((pick) => pick.region)).toEqual(['hamstrings', 'sideDelts']);
  });

  it('keeps to the workout’s usual cost and size, and never touches a main lift', () => {
    expect(fit({ ...chestDay, usualPoints: 6 }, hamstrings)).toMatchObject({
      exerciseIds: [...CHEST4.slice(0, 3), 'lying-leg-curl'],
      picks: [{ exerciseId: 'lying-leg-curl', replaced: 'pec-deck', otherDay: true }],
    });
    expect(fit({ ...chestDay, max: 4 }, hamstrings).picks).toMatchObject([{ replaced: 'pec-deck' }]);
    expect(fit({ ...chestDay, max: 4, anchors: CHEST4 }, hamstrings)).toMatchObject({ exerciseIds: CHEST4, picks: [] });
  });

  it('passes over an avoided exercise, and one the week left out', () => {
    expect(fit({ ...chestDay, avoid: new Set(['lying-leg-curl']) }, hamstrings).picks.map((pick) => pick.exerciseId)).toEqual(['seated-leg-curl']);
    expect(fit({ ...chestDay, leftOut: ['lying-leg-curl'] }, hamstrings).picks.map((pick) => pick.exerciseId)).toEqual(['seated-leg-curl']);
  });

  it('leaves a muscle the plan already trains to a set more', () => {
    const { picks, extra } = fit({ ...chestDay, exerciseIds: [...CHEST4.slice(0, 3), 'seated-leg-curl'] }, hamstrings);
    expect(picks).toEqual([]);
    expect(extra).toEqual([{ exerciseId: 'seated-leg-curl', region: 'hamstrings' }]);
  });

  it('needs today’s date', () => {
    expect(fit({ ...chestDay, today: undefined }, hamstrings).picks).toEqual([]);
  });

  describe('with its own day later in the week', () => {
    /** Back in two days, then legs in four. */
    const upcoming = [
      { groups: ['back'] as MuscleGroup[], partners: [], days: 2 },
      { groups: ['legs'] as MuscleGroup[], partners: [], days: 4 },
    ];
    const share = (budget: number, byDaysAgo: number[] = []): FocusWeek => ({
      budget,
      given: new Map([['hamstrings', byDaysAgo.reduce((sum, sets) => sum + sets, 0)]]),
      earlier: new Map(),
      byDaysAgo,
    });

    it('keeps a new exercise’s sets for the leg day before it spends any here', () => {
      // Five sets in all: three for the leg curl here would leave the leg day two.
      expect(fit({ ...chestDay, upcoming, week: share(5) }, hamstrings)).toMatchObject({ picks: [], held: 'ownDay' });
      expect(fit({ ...chestDay, upcoming, week: share(6) }, hamstrings).picks).toMatchObject([{ exerciseId: 'lying-leg-curl', otherDay: true }]);
      // Further off than the 7 days the share counts, nothing is kept.
      expect(fit({ ...chestDay, upcoming: [{ ...upcoming[1], days: 7 }], week: share(5) }, hamstrings).picks).toHaveLength(1);
    });

    it('counts only what will still count on that day', () => {
      // Three sets from 3 days ago will be a week old on the leg day; from 2 days ago they still count then.
      expect(fit({ ...chestDay, upcoming, week: share(8, [0, 0, 0, 3]) }, hamstrings).picks).toHaveLength(1);
      expect(fit({ ...chestDay, upcoming, week: share(8, [0, 0, 3]) }, hamstrings)).toMatchObject({ picks: [], held: 'ownDay' });
      // Without the days, all of it is taken to count still.
      expect(fit({ ...chestDay, upcoming, week: { ...share(8, [0, 0, 0, 3]), byDaysAgo: undefined } }, hamstrings).picks).toEqual([]);
    });

    it('lets another muscle use what the one first in line won’t need by its own day', () => {
      // Hamstrings waited and are planned already; quads got four sets 3 days ago, which are gone by the leg day.
      const withCurl: FocusPlan = { ...chestDay, exerciseIds: [...CHEST4.slice(0, 3), 'seated-leg-curl'], upcoming };
      const both: Goals = { quads: 'focus', hamstrings: 'focus' };
      const gone: FocusWeek = { budget: 8, given: new Map([['quads', 4], ['hamstrings', 0]]), earlier: new Map(), byDaysAgo: [0, 0, 0, 4] };
      expect(fit({ ...withCurl, week: gone }, both)).toMatchObject({
        picks: [{ exerciseId: 'leg-extension', region: 'quads', otherDay: true }],
        extra: [{ exerciseId: 'seated-leg-curl', region: 'hamstrings' }],
      });
      // From yesterday, they still count on the leg day, so the room stays kept for hamstrings there.
      const kept = fit({ ...withCurl, week: { ...gone, byDaysAgo: [0, 4] } }, both);
      expect(kept).toMatchObject({ picks: [], held: 'turn' });
    });

    it('keeps the leg day’s own hamstring work in a beginner’s rotation', () => {
      const BEG = [
        ['machine-chest-press', 'machine-shoulder-press', 'rope-pushdown'],
        ['lat-pulldown', 'seated-cable-row', 'dumbbell-curl'],
        ['leg-press', 'leg-extension', 'crunch'],
      ];
      // Mondays, Wednesdays and Fridays for three weeks: chest comes up today, and legs on Friday.
      const history = [21, 19, 17, 14, 12, 10, 7, 5, 3].map((daysAgo, i) => on(daysAgo, BEG[i % 3]));
      const chest = plan(history, hamstrings);
      expect(chest.key).toBe('chest');
      expect(chest.focus).toEqual([]);
      expect(chest.focusHeld).toBe('ownDay');
      const legs = plan(history, hamstrings, { type: 'legs' });
      expect(legs.focus).toMatchObject([{ region: 'hamstrings' }]);
      expect(legs.focus[0].otherDay).toBeUndefined();
    });
  });

  describe('in a rotation', () => {
    /** Workouts every two days in `order`, the last `last` days ago. */
    const rotation = (order: string[][], last = 4) => [16, 14, 12, 10, 8, 6, 4, 2, 0].map((daysAgo, i) => on(daysAgo + last, order[i % order.length]));
    const chestBackLegs = rotation([CHEST, BACK, LEGS]);

    it('brings legs into a chest day when back comes next', () => {
      const { key, exerciseIds, focus } = plan(chestBackLegs, hamstrings);
      expect(key).toBe('chest');
      expect(focus).toEqual([{ exerciseId: 'lying-leg-curl', region: 'hamstrings', fresh: false, otherDay: true }]);
      expect(exerciseIds).toEqual([...CHEST, 'lying-leg-curl']);
    });

    it('leaves the rotation as it was', () => {
      const done = [...chestBackLegs, on(0, [...CHEST, 'lying-leg-curl'])];
      const next = plan(done, hamstrings);
      expect(next.key).toBe('back');
      expect(next.partners.chest).toEqual([]);
    });

    it('rests the muscle for two days after its own', () => {
      expect(plan(rotation([CHEST, BACK, LEGS], 1), hamstrings).focus).toEqual([]);
      expect(plan(rotation([CHEST, BACK, LEGS], 2), hamstrings).focus).toHaveLength(1);
    });

    it('waits the day before the muscle’s own', () => {
      const { key, focus } = plan(rotation([CHEST, LEGS, BACK]), hamstrings);
      expect(key).toBe('chest');
      expect(focus).toEqual([]);
    });

    it('never brings in a resting Sometimes exercise', () => {
      const { focus } = planNextType(chestBackLegs, exercises, pace, {}, hamstrings, new Set(), new Set(['lying-leg-curl']))!;
      expect(focus.map((pick) => pick.exerciseId)).toEqual(['seated-leg-curl']);
    });

    it('changes nothing without goals', () => {
      expect(plan(chestBackLegs).exerciseIds).toEqual(CHEST);
      expect(plan(chestBackLegs).focus).toEqual([]);
    });
  });
});

describe('lastMainWork', () => {
  it('takes the last day with work sets on an exercise mainly for the region', () => {
    const last = lastMainWork([on(9, ['lying-leg-curl']), on(5, ['lying-leg-curl'], { 'lying-leg-curl': 0 }), on(3, ['barbell-bench-press'])], exercises);
    expect(last.get('hamstrings')).toBe(daysBefore(9));
    expect(last.get('chest')).toBe(daysBefore(3));
    // A helper isn't main work.
    expect(last.has('triceps')).toBe(false);
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

describe('focusWeek', () => {
  const chestFocus: Goals = { chest: 'focus' };
  const read = (workouts: RotationWorkout[], goals: Goals = chestFocus) => focusWeek(workouts, exercises, goals, TODAY, workoutTypes(workouts, exercises, TODAY));
  const withExtra = (workout: RotationWorkout, extra: Record<string, number>): RotationWorkout => ({
    ...workout,
    workSets: Object.fromEntries(Object.entries(workout.workSets).map(([id, sets]) => [id, sets + (extra[id] ?? 0)])),
    extra,
  });

  it('gives Focus a fifth of the usual week, the median of the weeks with workouts', () => {
    // 30 sets 7-13 days ago, none the week before, 50 three weeks ago: a usual week of 40.
    const tens = Object.fromEntries(CHEST.map((id) => [id, 10]));
    expect(read([on(21, CHEST, tens), on(10, CHEST), on(8, LEGS)]).budget).toBe(8);
  });

  it('starts a new user at a usual week of 40 sets, and never goes under four', () => {
    expect(read([on(2, CHEST)]).budget).toBe(8);
    expect(read([on(10, ['pec-deck']), on(17, ['pec-deck'])]).budget).toBe(4);
  });

  it('counts extra sets as they are, and an exercise new to the type', () => {
    const history = [on(17, CHEST), on(10, CHEST)];
    // Three sets of a new fly, and one extra set on the pec deck.
    const thisWeek = withExtra(on(2, [...CHEST, 'dumbbell-fly']), { 'pec-deck': 1 });
    expect(read([...history, thisWeek]).given.get('chest')).toBe(4);
    // The usual week alone gave nothing.
    expect(read([...history, on(2, CHEST)]).given.get('chest')).toBe(0);
  });

  it('counts nothing for the same type twice in 7 days with nothing added', () => {
    const legs: Goals = { quads: 'focus', hamstrings: 'focus' };
    const twice = read([on(20, LEGS), on(13, LEGS), on(6, LEGS), on(1, LEGS)], legs);
    expect([...twice.given.values()]).toEqual([0, 0]);
    expect([...twice.earlier.values()]).toEqual([0, 0]);
    // Each day had 15 sets for chest: a usual week of 15 is over in two days.
    expect(read([on(17, CHEST), on(10, CHEST), on(5, CHEST), on(2, CHEST)]).given.get('chest')).toBe(0);
  });

  it('counts extra sets exactly, on an exercise that has always been there', () => {
    const history = [on(24, CHEST), on(17, CHEST), on(10, CHEST)];
    const week = read([...history, withExtra(on(5, CHEST), { 'pec-deck': 1 }), withExtra(on(2, CHEST), { 'pec-deck': 1, 'cable-crossover': 1 })]);
    expect(week.given.get('chest')).toBe(3);
  });

  it('counts an exercise new to its type, even one done on other days', () => {
    const history = [on(24, CHEST), on(19, [...LEGS, 'dumbbell-fly']), on(17, CHEST), on(10, CHEST)];
    expect(read([...history, on(2, [...CHEST, 'dumbbell-fly'])]).given.get('chest')).toBe(3);
    // In a filler's place it's new all the same.
    expect(read([...history, on(2, [...CHEST.slice(0, 4), 'dumbbell-fly'])]).given.get('chest')).toBe(3);
  });

  it('stops counting an exercise once the type has had it for a while', () => {
    const fly = [...CHEST, 'dumbbell-fly'];
    expect(read([on(30, CHEST), on(23, fly), on(16, fly), on(9, fly), on(2, fly)]).given.get('chest')).toBe(0);
    // In a filler's place, from its second week.
    const swapped = [...CHEST.slice(0, 4), 'dumbbell-fly'];
    expect(read([on(23, CHEST), on(16, CHEST), on(9, swapped), on(2, swapped)]).given.get('chest')).toBe(0);
  });

  it('keeps counting a pick the plan doesn’t keep yet, which comes back on top each time', () => {
    const fly = [...CHEST, 'dumbbell-fly'];
    // In one of three chest days before, so the plan still has five exercises.
    expect(read([on(23, CHEST), on(16, CHEST), on(9, fly), on(2, fly)]).given.get('chest')).toBe(3);
    // A day of several types is longer anyway.
    const combined = [on(23, CHEST), on(22, LEGS), on(16, CHEST), on(15, LEGS), on(9, fly), on(2, [...fly, ...LEGS])];
    expect(read(combined).given.get('chest')).toBe(0);
  });

  it('always counts light work for chest, back or legs on another of them’s day', () => {
    const chestDay = [...CHEST.slice(0, 4), 'lying-leg-curl'];
    const week = read([on(23, chestDay), on(16, chestDay), on(9, chestDay), on(2, chestDay)], { hamstrings: 'focus' });
    expect(week.given.get('hamstrings')).toBe(3);
    expect(week.earlier.get('hamstrings')).toBe(3);
    // On its own day it's that day's work.
    expect(read([on(16, LEGS), on(9, LEGS), on(2, LEGS)], { hamstrings: 'focus' }).given.get('hamstrings')).toBe(0);
  });

  it('counts only the extra sets with nothing of the type to go by', () => {
    const one = withExtra(on(2, [...CHEST, 'dumbbell-fly']), { 'pec-deck': 1 });
    expect(read([one]).given.get('chest')).toBe(1);
    expect(read([on(9, LEGS), one]).given.get('chest')).toBe(1);
  });

  it('keeps the week before apart, for taking turns', () => {
    const history = [on(24, CHEST), on(17, CHEST), withExtra(on(10, CHEST), { 'pec-deck': 2 })];
    const week = read(history);
    expect(week.given.get('chest')).toBe(0);
    expect(week.earlier.get('chest')).toBe(2);
  });

  it('counts no extra sets on an exercise for small muscles alone', () => {
    const day = [...CHEST, 'lateral-raise'];
    const goals: Goals = { chest: 'focus', sideDelts: 'focus' };
    const thisWeek = withExtra(on(2, day), { 'lateral-raise': 2, 'pec-deck': 1 });
    const week = read([on(24, day), on(17, day), on(10, day), thisWeek], goals);
    expect(week.given.get('chest')).toBe(1);
    expect(week.given.get('sideDelts')).toBe(0);
  });

  it('reads only Focus muscles', () => {
    expect([...read([on(2, CHEST)], { sideDelts: 'focus', chest: 'maintain' }).given.keys()]).toEqual(['sideDelts']);
  });
});

describe('Focus’s share of the week', () => {
  const PRESSES = ['barbell-bench-press', 'machine-chest-press', 'pec-deck'];
  /** Three sets more would bring chest into its range, and two can go on, past the bench press; nothing can join. */
  const full: FocusPlan = { exerciseIds: PRESSES, anchors: PRESSES.slice(0, 1), groups: ['chest'], partners: [], leftOut: [], max: 3, recent: PRESSES, older: [], usualPoints: 30 };
  const share = (budget: number, given: Partial<Record<BodyRegion, number>> = {}, earlier: Partial<Record<BodyRegion, number>> = {}): FocusWeek => ({
    budget,
    given: new Map(Object.entries(given) as [BodyRegion, number][]),
    earlier: new Map(Object.entries(earlier) as [BodyRegion, number][]),
  });
  const fit = (base: FocusPlan, goals: Goals, sets: RegionSets = new Map()) => applyFocus(base, goals, sets, exercises);

  it('stops adding once the week has had Focus’s share, and says so', () => {
    expect(fit({ ...full, week: share(8) }, { chest: 'focus' })).toMatchObject({ extra: [{}, {}] });
    expect(fit({ ...full, week: share(8) }, { chest: 'focus' }).held).toBeUndefined();
    const { extra, held } = fit({ ...full, week: share(8, { chest: 7 }) }, { chest: 'focus' });
    expect(extra).toHaveLength(1);
    expect(held).toBe('week');
    expect(fit({ ...full, week: share(8, { chest: 8 }) }, { chest: 'focus' })).toMatchObject({ extra: [], held: 'week' });
  });

  it('counts a new exercise at its planned sets', () => {
    const roomy = { ...full, max: 4, recent: [...PRESSES, 'cable-crossover'], setsOf: () => 4 };
    expect(fit({ ...roomy, week: share(4) }, { chest: 'focus' }).picks.map((p) => p.exerciseId)).toEqual(['cable-crossover']);
    const { picks, extra, held } = fit({ ...roomy, week: share(3) }, { chest: 'focus' });
    expect(picks).toEqual([]);
    expect(extra).toHaveLength(2);
    expect(held).toBe('week');
  });

  it('says nothing when it held nothing back', () => {
    expect(fit({ ...full, week: share(8, { chest: 8 }) }, { chest: 'focus' }, new Map([['chest', 3]])).held).toBeUndefined();
    expect(fit({ ...full, week: share(0) }, {}).held).toBeUndefined();
  });

  describe('taking turns', () => {
    /** One free slot, two Focus muscles that can use it. */
    const legDay: FocusPlan = {
      exerciseIds: ['barbell-squat', 'leg-press', 'lying-leg-curl'],
      anchors: ['barbell-squat', 'leg-press', 'lying-leg-curl'],
      groups: ['legs'],
      partners: [],
      leftOut: [],
      max: 4,
      recent: ['barbell-squat', 'leg-press', 'lying-leg-curl', 'leg-extension', 'seated-leg-curl'],
      older: [],
      usualPoints: 30,
    };
    const both: Goals = { quads: 'focus', hamstrings: 'focus' };
    const week: RegionSets = new Map([['hamstrings', 3]]);
    const slot = (base: FocusPlan) => fit(base, both, week).picks.map((p) => [p.exerciseId, p.region]);

    it('gives the slot to the muscle furthest short when both got the same', () => {
      expect(slot(legDay)).toEqual([['leg-extension', 'quads']]);
      expect(slot({ ...legDay, week: share(20) })).toEqual([['leg-extension', 'quads']]);
    });

    it('gives it to the one that got nothing from Focus over the last 7 days', () => {
      expect(slot({ ...legDay, week: share(20, { quads: 3 }) })).toEqual([['seated-leg-curl', 'hamstrings']]);
    });

    it('of two that both waited, to the one that got less the week before', () => {
      expect(slot({ ...legDay, week: share(20, {}, { quads: 4 }) })).toEqual([['seated-leg-curl', 'hamstrings']]);
    });

    // Hamstrings waited, but can't join a chest day without today's date for light work.
    it('keeps a new exercise’s sets for the muscle first in line from a small muscle when today can’t serve it', () => {
      const { picks, extra, held } = fit({ ...full, max: 4, recent: [...PRESSES, 'lateral-raise'], week: share(6, { sideDelts: 1 }) }, { sideDelts: 'focus', hamstrings: 'focus' });
      expect(picks).toEqual([]);
      expect(extra).toEqual([]);
      expect(held).toBe('turn');
    });

    it('keeps nothing for it from the day’s own big muscles, which take what they need first', () => {
      // Once, a waiting hamstrings kept chest to two sets more here.
      const { picks, extra, held } = fit({ ...full, max: 4, recent: [...PRESSES, 'cable-crossover'], week: share(6, { chest: 1 }) }, { chest: 'focus', hamstrings: 'focus' });
      expect(picks.map((p) => p.exerciseId)).toEqual(['cable-crossover']);
      expect(extra).toEqual([]);
      expect(held).toBeUndefined();
    });

    it('lets nobody else take the room while the muscle first in line is waiting for it', () => {
      // Two sets left: quads would take them, but hamstrings waited and need three for a new exercise.
      const squats = { ...legDay, exerciseIds: ['barbell-squat', 'leg-press', 'leg-extension'], anchors: ['barbell-squat'], week: share(5, { quads: 3 }) };
      expect(fit(squats, { quads: 'focus' }, week).extra).toHaveLength(2);
      const { picks, extra, held } = fit(squats, both, week);
      expect(picks).toEqual([]);
      expect(extra).toEqual([]);
      expect(held).toBe('week');
    });

    it('keeps nothing for a small muscle that waited', () => {
      const roomy = { ...full, max: 4, recent: [...PRESSES, 'lateral-raise'] };
      const alone = fit({ ...roomy, week: share(8, { chest: 6 }) }, { chest: 'focus' });
      expect(fit({ ...roomy, week: share(8, { chest: 6 }) }, { chest: 'focus', sideDelts: 'focus' })).toEqual(alone);
      expect(alone).toMatchObject({ picks: [], extra: [{}, {}], held: 'week' });
    });
  });
});

describe('which Focus muscle goes first', () => {
  const share = (budget: number, given: Partial<Record<BodyRegion, number>> = {}): FocusWeek => ({
    budget,
    given: new Map(Object.entries(given) as [BodyRegion, number][]),
    earlier: new Map(),
  });
  const fit = (base: FocusPlan, goals: Goals, sets: RegionSets = new Map()) => applyFocus(base, goals, sets, exercises);
  const regions = (fit: { picks: { region: BodyRegion }[] }) => fit.picks.map((pick) => pick.region);
  const LIFTS = ['barbell-squat', 'leg-press', 'lying-leg-curl'];
  /** One free slot and no filler to give up. */
  const legDay: FocusPlan = {
    exerciseIds: LIFTS.slice(0, 2),
    anchors: LIFTS.slice(0, 2),
    groups: ['legs'],
    partners: [],
    leftOut: [],
    max: 3,
    recent: [...LIFTS, 'dumbbell-curl', 'leg-extension'],
    older: [],
    usualPoints: 30,
  };

  it('gives a leg day’s slot to a leg muscle, not to a curl', () => {
    const goals: Goals = { biceps: 'focus', hamstrings: 'focus', quads: 'focus' };
    // Biceps are further short than hamstrings, and hamstrings further than quads.
    const week: RegionSets = new Map([['quads', 3], ['hamstrings', 2]]);
    expect(fit(legDay, goals, week).picks).toEqual([{ exerciseId: 'lying-leg-curl', region: 'hamstrings', fresh: false }]);
    // Biceps got nothing from Focus this week, and the leg muscles did.
    expect(regions(fit({ ...legDay, week: share(20, { hamstrings: 3, quads: 3 }) }, goals, week))).toEqual(['hamstrings']);
  });

  it('still lets a big muscle that waited go first among big muscles', () => {
    const goals: Goals = { hamstrings: 'focus', quads: 'focus' };
    const week: RegionSets = new Map([['quads', 3]]);
    expect(regions(fit({ ...legDay, week: share(20, { hamstrings: 3 }) }, goals, week))).toEqual(['quads']);
  });

  it('gives a big muscle’s light work on another day the slot before a small muscle', () => {
    const CHEST4 = CHEST.slice(0, 4);
    const chestDay: FocusPlan = {
      ...legDay,
      exerciseIds: CHEST4,
      anchors: CHEST4,
      groups: ['chest'],
      max: 5,
      recent: [...CHEST4, 'lying-leg-curl', 'dumbbell-curl'],
      today: TODAY,
      lastMain: new Map([['hamstrings', daysBefore(3)]]),
      nextGroups: ['back'],
      nextPartners: [],
    };
    const goals: Goals = { biceps: 'focus', hamstrings: 'focus' };
    expect(fit(chestDay, goals).picks).toEqual([{ exerciseId: 'lying-leg-curl', region: 'hamstrings', fresh: false, otherDay: true }]);
    expect(regions(fit({ ...chestDay, week: share(20, { hamstrings: 3 }) }, goals))).toEqual(['hamstrings']);
    // Resting, it leaves the slot to the curl.
    expect(regions(fit({ ...chestDay, lastMain: new Map([['hamstrings', daysBefore(1)]]) }, goals))).toEqual(['biceps']);
  });

  describe('among small muscles', () => {
    const PRESSES = ['barbell-bench-press', 'incline-dumbbell-press', 'pec-deck'];
    /** One free slot; side delts are further short than biceps. */
    const chestDay: FocusPlan = { ...legDay, exerciseIds: PRESSES, anchors: PRESSES, groups: ['chest'], max: 4, recent: [...PRESSES, 'lateral-raise', 'dumbbell-curl'] };
    const goals: Goals = { sideDelts: 'focus', biceps: 'focus' };
    const week: RegionSets = new Map([['biceps', 3]]);

    it('goes to the furthest short', () => {
      expect(regions(fit(chestDay, goals, week))).toEqual(['sideDelts']);
    });

    it('doesn’t move one that got nothing from Focus ahead', () => {
      expect(regions(fit({ ...chestDay, week: share(20, { sideDelts: 3 }) }, goals, week))).toEqual(['sideDelts']);
    });

    it('keeps no room for one that waited, and never says so', () => {
      // Two sets left, and biceps waited while side delts didn't: neither new exercise fits.
      const roomy: FocusPlan = { ...chestDay, max: 5, recent: [...PRESSES, 'lateral-raise', 'dumbbell-curl'] };
      const held = fit({ ...roomy, week: share(5, { sideDelts: 3 }) }, goals, week);
      expect(held).toMatchObject({ picks: [], extra: [], held: 'week' });
      expect(fit({ ...roomy, week: share(6, { sideDelts: 3 }) }, goals, week).picks.map((p) => p.region)).toEqual(['sideDelts']);
    });

    describe('a set more', () => {
      const both = [...PRESSES, 'lateral-raise', 'dumbbell-curl'];
      const full: FocusPlan = { ...chestDay, exerciseIds: both, anchors: both, max: 5, recent: both };
      const twoSmall = [
        { exerciseId: 'lateral-raise', region: 'sideDelts' },
        { exerciseId: 'dumbbell-curl', region: 'biceps' },
      ];

      it('uses none of the share, so it goes on once that’s used, and says nothing', () => {
        const used = fit({ ...full, week: share(4, { sideDelts: 4 }) }, goals, week);
        expect(used.extra).toEqual(twoSmall);
        expect(used.held).toBeUndefined();
        expect(fit({ ...full, week: share(0) }, goals, week).extra).toEqual(twoSmall);
      });

      it('still keeps to four a workout, and to the workout’s length', () => {
        const arms = [...PRESSES, 'lateral-raise', 'cable-lateral-raise', 'dumbbell-curl', 'hammer-curl', 'rope-pushdown'];
        const many: FocusPlan = { ...full, exerciseIds: arms, anchors: arms, max: 8, recent: arms, week: share(0) };
        const all = fit(many, { sideDelts: 'focus', biceps: 'focus', triceps: 'focus' });
        expect(all.extra).toHaveLength(4);
        expect(all.held).toBeUndefined();
        // Five exercises at three sets, and room for one set more.
        expect(fit({ ...full, week: share(0), maxSets: 16 }, goals, week)).toMatchObject({ extra: [twoSmall[0]], held: 'time' });
      });

      it('goes after a big muscle’s, which the share still holds back', () => {
        const withChest = { ...full, week: share(1, { chest: 1 }) };
        const fitted = fit(withChest, { ...goals, chest: 'focus' }, week);
        expect(fitted.extra).toEqual(twoSmall);
        expect(fitted.held).toBe('week');
        const roomForOne = fit({ ...withChest, week: share(2, { chest: 1 }) }, { ...goals, chest: 'focus' }, week);
        expect(roomForOne.extra).toEqual([{ exerciseId: 'pec-deck', region: 'chest' }, ...twoSmall]);
      });
    });
  });

  it('gives a set more by the same order', () => {
    const day = ['barbell-squat', 'lying-leg-curl', 'dumbbell-curl'];
    const full: FocusPlan = { ...legDay, exerciseIds: day, anchors: day, max: 3, recent: day };
    const goals: Goals = { biceps: 'focus', hamstrings: 'focus' };
    // Biceps are further short.
    const week: RegionSets = new Map([['hamstrings', 2]]);
    const both = [
      { exerciseId: 'lying-leg-curl', region: 'hamstrings' },
      { exerciseId: 'dumbbell-curl', region: 'biceps' },
    ];
    expect(fit(full, goals, week).extra).toEqual(both);
    expect(fit({ ...full, week: share(1) }, goals, week).extra).toEqual(both);
    // Hamstrings had some from Focus this week, and biceps had none.
    expect(fit({ ...full, week: share(4, { hamstrings: 3 }) }, goals, week).extra).toEqual(both);
    // With the workout's room for one set more, hamstrings get it.
    expect(fit({ ...full, maxSets: 10 }, goals, week).extra).toEqual(both.slice(0, 1));
  });

  it('changes nothing without goals', () => {
    expect(fit({ ...legDay, week: share(20) }, {})).toEqual({ exerciseIds: legDay.exerciseIds, picks: [], extra: [] });
  });
});

describe('a workout’s usual length', () => {
  const PRESSES = ['barbell-bench-press', 'incline-dumbbell-press', 'pec-deck'];
  /** Sets more can go on the incline press and the pec deck. */
  const full: FocusPlan = { exerciseIds: PRESSES, anchors: PRESSES.slice(0, 1), groups: ['chest'], partners: [], leftOut: [], max: 3, recent: PRESSES, older: [], usualPoints: 30 };
  const fit = (base: FocusPlan, goals: Goals) => applyFocus(base, goals, new Map(), exercises);
  const timed = (daysAgo: number, ids: string[], minutes: number, sets?: Record<string, number>): RotationWorkout => ({ ...on(daysAgo, ids, sets), minutes });

  it('stops additions where the workout would run past it', () => {
    expect(fit({ ...full, maxSets: 10 }, { chest: 'focus' })).toMatchObject({ extra: [{ exerciseId: 'pec-deck' }], held: 'time' });
    expect(fit({ ...full, maxSets: 12 }, { chest: 'focus' }).held).toBeUndefined();
  });

  it('still lets a pick take a filler’s place, which keeps the workout as long as it was', () => {
    const LEGS5: FocusPlan = { ...full, exerciseIds: LEGS, anchors: LEGS.slice(0, 3), groups: ['legs'], max: 6, recent: [...LEGS, 'standing-calf-raise'], usualPoints: 8 };
    expect(fit(LEGS5, { calves: 'focus' }).picks).toEqual([{ exerciseId: 'standing-calf-raise', region: 'calves', fresh: false }]);
    const capped = fit({ ...LEGS5, maxSets: 15 }, { calves: 'focus' });
    expect(capped.picks).toEqual([{ exerciseId: 'standing-calf-raise', region: 'calves', fresh: false, replaced: 'seated-leg-curl' }]);
    expect(capped.exerciseIds).toHaveLength(5);
    // The calf raise has been done before, so it would take a set more too, but not past the usual length.
    expect(capped.extra).toEqual([]);
    expect(capped.held).toBe('time');
  });

  it('is the type’s usual minutes and 15 more, at the user’s own minutes a set', () => {
    // 45, 50 and 60 minutes for 15 sets: 50 usual, at 3⅓ minutes a set.
    const ofType = [timed(14, CHEST, 45), timed(7, CHEST, 60), timed(1, CHEST, 50)];
    expect(maxWorkoutSets(ofType, ofType)).toBe(19);
  });

  it('leaves out a workout over 5 hours, which was left open', () => {
    const ofType = [timed(14, CHEST, 45), timed(7, CHEST, 400), timed(1, CHEST, 45)];
    expect(maxWorkoutSets(ofType, ofType)).toBe(20);
  });

  it('takes 3 minutes a set when no timed workout has work sets', () => {
    const empty = [timed(7, CHEST, 45, Object.fromEntries(CHEST.map((id) => [id, 0])))];
    expect(maxWorkoutSets(empty, empty)).toBe(20);
  });

  it('is unknown without timed workouts of the type, and then there’s no limit', () => {
    expect(maxWorkoutSets([timed(7, LEGS, 45), on(2, CHEST)], [on(2, CHEST)])).toBeUndefined();
  });

  describe('in the plan', () => {
    const history = alternating(CHEST, [...LEGS.slice(0, 4), 'lateral-raise']);
    /** A slow 6 minutes a set: 15 more minutes is two sets, too few for a new exercise on top. */
    const slow = history.map((w) => ({ ...w, minutes: 90 }));

    it('swaps a filler instead of going on top', () => {
      expect(plan(history, { sideDelts: 'focus' }).focus).toEqual([{ exerciseId: 'lateral-raise', region: 'sideDelts', fresh: false }]);
      const { exerciseIds, focus } = plan(slow, { sideDelts: 'focus' });
      expect(focus).toEqual([{ exerciseId: 'lateral-raise', region: 'sideDelts', fresh: false, replaced: 'cable-crossover' }]);
      expect(exerciseIds).toHaveLength(5);
    });

    it('changes nothing without goals', () => {
      expect(plan(slow)).toEqual(plan(history));
    });
  });
});

describe('Focus held back in the plan', () => {
  /** Chest days and leg days with a lateral raise; the last leg day was 3 days ago. */
  const days = (lastLegDay: (w: RotationWorkout) => RotationWorkout) =>
    [16, 14, 12, 10, 8, 3].map((daysAgo, i) => {
      const w = on(daysAgo, i % 2 ? [...LEGS.slice(0, 4), 'lateral-raise'] : CHEST);
      return i === 5 ? lastLegDay(w) : w;
    });

  it('says so when the week has had Focus’s share', () => {
    // Seven extra sets for the leg press 3 days ago, of a share of 8.
    const used = days((w) => ({ ...w, workSets: { ...w.workSets, 'leg-press': 10 }, extra: { 'leg-press': 7 } }));
    const next = plan(used, { quads: 'focus', sideDelts: 'focus' });
    expect(next.key).toBe('chest');
    expect(next.focus).toEqual([]);
    expect(next.focusHeld).toBe('week');
  });

  it('leaves the share whole after sets more for small muscles alone', () => {
    const used = days((w) => ({ ...w, workSets: { ...w.workSets, 'lateral-raise': 8 }, extra: { 'lateral-raise': 7 } }));
    const next = plan(used, { sideDelts: 'focus', quads: 'focus' });
    expect(next.focus).toHaveLength(1);
    expect(next.focusHeld).toBeUndefined();
  });

  it('says nothing when it held nothing back, or without goals', () => {
    const next = plan(days((w) => w), { sideDelts: 'focus' });
    expect(next.focus).toHaveLength(1);
    expect(next.focusHeld).toBeUndefined();
    expect(plan(days((w) => w)).focusHeld).toBeUndefined();
  });
});

describe('Focus’s share with a type trained twice in 7 days', () => {
  /** Chest, legs and back every other day with nothing added: legs 6 days ago, back 4, chest 2. */
  const history = [26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2].map((daysAgo, i) => on(daysAgo, [CHEST, LEGS, BACK][i % 3]));
  const five: Goals = { chest: 'focus', quads: 'focus', hamstrings: 'focus', sideDelts: 'focus', biceps: 'focus' };

  it('finds nothing given, so Focus adds and says nothing held', () => {
    const share = focusWeek(history, exercises, five, TODAY, workoutTypes(history, exercises, TODAY));
    expect([...share.given.values()].every((sets) => sets === 0)).toBe(true);
    for (const type of ['legs', 'chest']) {
      const next = plan(history, five, { type });
      expect(next.key).toBe(type);
      expect(next.focus.length + next.extraSets.length, type).toBeGreaterThan(0);
      expect(next.focusHeld, type).toBeUndefined();
    }
  });
});

describe('the Today card', () => {
  afterEach(() => {
    settings.regionGoals = {};
  });

  it('names the day after its type, not after a light exercise brought in for another day', async () => {
    await db.delete();
    await db.open();
    const now = new Date();
    const ago = (days: number) => toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
    const chest = ['barbell-bench-press', 'incline-dumbbell-press', 'lateral-raise', 'rope-pushdown'];
    const order = [chest, BACK, LEGS];
    let n = 0;
    for (const [i, daysAgo] of [20, 18, 16, 14, 12, 10, 8, 6, 4].entries()) {
      const id = `w${i}`;
      const date = ago(daysAgo);
      await db.workouts.add({ id, date, status: 'done', source: 'app', updatedAt: 1 });
      const sets = order[i % 3].flatMap((exerciseId, entry) =>
        [1, 2, 3].map((o): WorkoutSet => ({ id: `s${n++}`, workoutId: id, exerciseId, date, entry: entry + 1, order: o, kind: 'work', weightKg: 40, reps: 8, done: true })),
      );
      await db.sets.bulkAdd(sets);
    }
    settings.regionGoals = { hamstrings: 'focus' };
    const next = (await loadNextWorkout())!;
    expect(next.focus.map((pick) => [pick.exercise.id, pick.otherDay])).toEqual([['lying-leg-curl', true]]);
    // A fifth of the day's work sets, which would have named legs.
    const work = next.exercises.map((e) => e.sets.filter((set) => set.kind === 'work').length);
    expect(work.at(-1)! / work.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(0.2);
    expect(next.groups).toEqual(['chest', 'shoulders']);
    expect(typeTitle(next.groups, next.partners)).toBe(typeTitle(['chest'], ['shoulders', 'triceps']));
  });

  it('reads how long workouts took, and says when that kept Focus out', async () => {
    await db.delete();
    await db.open();
    const now = new Date();
    const ago = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 18);
    const chest = ['barbell-bench-press', 'incline-dumbbell-press', 'lateral-raise', 'rope-pushdown'];
    const order = [chest, BACK, LEGS];
    let n = 0;
    for (const [i, daysAgo] of [20, 18, 16, 14, 12, 10, 8, 6, 4].entries()) {
      const id = `w${i}`;
      const date = toISODate(ago(daysAgo));
      const ids = order[i % 3];
      // A slow 6 minutes a set, rest included: 15 minutes more is two sets.
      const startedAt = ago(daysAgo).getTime();
      await db.workouts.add({ id, date, status: 'done', source: 'app', updatedAt: 1, startedAt, finishedAt: startedAt + ids.length * 3 * 6 * 60000 });
      const sets = ids.flatMap((exerciseId, entry) =>
        [1, 2, 3].map((o): WorkoutSet => ({ id: `s${n++}`, workoutId: id, exerciseId, date, entry: entry + 1, order: o, kind: 'work', weightKg: 40, reps: 8, done: true })),
      );
      await db.sets.bulkAdd(sets);
    }
    settings.regionGoals = { hamstrings: 'focus' };
    const next = (await loadNextWorkout())!;
    expect(next.focus).toEqual([]);
    expect(next.focusHeld).toBe('time');
  });
});
