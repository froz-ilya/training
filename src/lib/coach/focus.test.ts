import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { difficultyOf } from '../catalog/difficulty';
import { CATALOG } from '../catalog/exercises';
import { regionsOf } from '../catalog/regions';
import { toISODate } from '../dates';
import { db } from '../db/schema';
import { settings } from '../settings.svelte';
import type { BodyRegion, Exercise, RegionGoal, WorkoutSet } from '../types';
import { typeTitle } from '../workout/title';
import { loadNextWorkout } from './data';
import { fitWeek, type MuscleBudget, type WeekPlan } from './budget';
import { applyFocus, heldEnough, lastMainWork, trainsShortFocus, weekSets, type FocusPlan, type RegionSets } from './focus';
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
    expect(exerciseIds).toEqual([...BACK, 'hip-abductor']);
  });

  it('leaves a hard lift out of a leg day at its usual cost, even in a filler’s place', () => {
    const history = [on(70, ['bulgarian-split-squat']), ...alternating(LEGS, [...CHEST.slice(0, 4), 'hip-abductor'])];
    const { exerciseIds, focus } = plan(history, { glutes: 'focus' });
    expect(exerciseIds).toEqual([...LEGS, 'hip-abductor']);
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
    // A set more isn't held to the limit: it's what's left when no exercise fits.
    expect(extra).toEqual([{ exerciseId: 'barbell-squat', region: 'glutes' }]);
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
    expect(exerciseIds).toEqual([...LEGS, 'hip-abductor']);
  });
});

describe('a set more for a Focus muscle', () => {
  const PRESSES = ['barbell-bench-press', 'incline-dumbbell-press', 'pec-deck'];
  /** Nothing can join: the day is full and every exercise is a main lift. */
  const full: FocusPlan = { exerciseIds: PRESSES, anchors: PRESSES, groups: ['chest'], partners: [], leftOut: [], max: 3, recent: PRESSES, older: [], usualPoints: 30 };
  const fit = (base: FocusPlan, goals: Goals, sets: RegionSets = new Map()) => applyFocus(base, goals, sets, exercises);

  it('goes on the lightest exercise first, one set each, until the range is met', () => {
    // Chest's Focus range starts at 12, and three exercises plan 9.
    expect(fit(full, { chest: 'focus' }).extra.map((e) => e.exerciseId)).toEqual(['pec-deck', 'barbell-bench-press', 'incline-dumbbell-press']);
    expect(fit(full, { chest: 'focus' }, new Map([['chest', 2]])).extra).toEqual([{ exerciseId: 'pec-deck', region: 'chest' }]);
  });

  it('adds nothing once the week has had enough, or without a Focus', () => {
    expect(fit(full, { chest: 'focus' }, new Map([['chest', 3]])).extra).toEqual([]);
    expect(fit(full, {}).extra).toEqual([]);
    expect(fit(full, { chest: 'maintain' }).extra).toEqual([]);
  });

  it('keeps to a few sets a workout', () => {
    const withArms = { ...full, exerciseIds: [...PRESSES, 'rope-pushdown'], anchors: [...PRESSES, 'rope-pushdown'], max: 4, recent: [...PRESSES, 'rope-pushdown'] };
    const { extra } = fit(withArms, { chest: 'focus', triceps: 'focus' });
    expect(extra).toHaveLength(4);
    expect(new Set(extra.map((e) => e.exerciseId)).size).toBe(4);
    expect(extra.map((e) => e.region)).toEqual(expect.arrayContaining(['chest', 'triceps']));
  });

  it('only goes on exercises the user has done, and not on one just brought in', () => {
    // Nothing to copy a set from: the user has done only the bench press.
    expect(fit({ ...full, recent: ['barbell-bench-press'] }, { chest: 'focus' }).extra).toEqual([{ exerciseId: 'barbell-bench-press', region: 'chest' }]);
    const two = PRESSES.slice(0, 2);
    const { picks, extra } = fit({ ...full, exerciseIds: two, anchors: two, recent: [...two, 'cable-crossover'] }, { chest: 'focus' });
    expect(picks.map((p) => p.exerciseId)).toEqual(['cable-crossover']);
    expect(extra.map((e) => e.exerciseId)).toEqual(two);
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
    // It came in today, so it gets no set more.
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

  it('comes after the picks for muscles that can join, and takes a filler’s place then', () => {
    const recent = [...chestDay.recent, 'lateral-raise', 'rear-delt-fly'];
    const { exerciseIds, picks } = fit({ ...chestDay, recent }, { sideDelts: 'focus', hamstrings: 'focus' }, new Map([['sideDelts', 6]]));
    expect(picks).toEqual([
      { exerciseId: 'lateral-raise', region: 'sideDelts', fresh: false },
      { exerciseId: 'lying-leg-curl', region: 'hamstrings', fresh: false, replaced: 'pec-deck', otherDay: true },
    ]);
    expect(exerciseIds).toEqual([...CHEST4.slice(0, 3), 'lateral-raise', 'lying-leg-curl']);
    const two = fit({ ...chestDay, recent }, { sideDelts: 'focus', rearDelts: 'focus', hamstrings: 'focus' });
    expect(two.picks.map((pick) => pick.region)).toEqual(['sideDelts', 'rearDelts']);
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
});
