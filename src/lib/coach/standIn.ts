import { regionsOf } from '../catalog/regions';
import type { Exercise } from '../types';

/** An exercise planned in place of one the user doesn't want suggested. */
export interface StandIn {
  exerciseId: string;
  /** The avoided exercise it took the place of. */
  instead: string;
  /** Not in the user's history yet, so it came from the catalogue. */
  fresh: boolean;
}

/**
 * The closest exercise to do in place of `avoided`: same muscle, same kind of lift, same load, and it
 * trains the avoided exercise's first main region. What the user has done (`done`, longest ago first)
 * comes before anything new. Among those, the most shared main regions and then the latest. Among new
 * ones, the most shared, then other equipment, since it may be the equipment that's the trouble, then
 * equipment the user has used.
 */
export function findStandIn(
  avoided: Exercise,
  exercises: Map<string, Exercise>,
  avoid: ReadonlySet<string>,
  taken: ReadonlySet<string>,
  done: string[],
): StandIn | undefined {
  const [first] = rankStandIns(avoided, exercises, avoid, taken, done, 'close');
  return first && { exerciseId: first.exercise.id, instead: avoided.id, fresh: first.fresh };
}

/**
 * Exercises to swap in for `exercise` by hand, best first: the stand-ins `findStandIn()` picks from,
 * then anything else for the same muscle that trains its first main region, whatever the kind of lift
 * or load, since the user may want a change from it. Last, the same kind of lift for the same muscle,
 * for an exercise with no main region of its own, like the adductor machine. Avoided exercises and the
 * ones in `taken` stay out.
 */
export function replacementOptions(
  exercise: Exercise,
  exercises: Map<string, Exercise>,
  avoid: ReadonlySet<string>,
  taken: ReadonlySet<string>,
  done: string[],
  limit = 4,
): { exercise: Exercise; fresh: boolean }[] {
  const seen = new Set<string>();
  return (['close', 'region', 'muscle'] as const)
    .flatMap((match) => rankStandIns(exercise, exercises, avoid, taken, done, match))
    .filter((option) => !seen.has(option.exercise.id) && !!seen.add(option.exercise.id))
    .slice(0, limit);
}

function rankStandIns(
  avoided: Exercise,
  exercises: Map<string, Exercise>,
  avoid: ReadonlySet<string>,
  taken: ReadonlySet<string>,
  done: string[],
  match: 'close' | 'region' | 'muscle',
): { exercise: Exercise; fresh: boolean }[] {
  const { main } = regionsOf(avoided);
  const likeness = (exercise: Exercise) => regionsOf(exercise).main.filter((region) => main.includes(region)).length;
  const fits = (e: Exercise) =>
    e.id !== avoided.id &&
    !avoid.has(e.id) &&
    !taken.has(e.id) &&
    e.muscle === avoided.muscle &&
    (match === 'region' || e.compound === avoided.compound) &&
    (match === 'region' || e.load === avoided.load) &&
    // The first region is what it's mostly for, or a hinge passes for a squat on the glutes they share.
    (match === 'muscle' || regionsOf(e).main.includes(main[0]));

  const doneList = done.flatMap((id) => exercises.get(id) ?? []);
  const tried = doneList.filter(fits).reverse().sort((a, b) => likeness(b) - likeness(a));

  const used = new Set(doneList.map((e) => e.equipment));
  const otherGear = (e: Exercise) => Number(e.equipment !== avoided.equipment);
  const usedGear = (e: Exercise) => Number(used.has(e.equipment));
  const untried = [...exercises.values()]
    .filter((e) => fits(e) && !done.includes(e.id))
    .sort((a, b) => likeness(b) - likeness(a) || otherGear(b) - otherGear(a) || usedGear(b) - usedGear(a));
  return [...tried.map((exercise) => ({ exercise, fresh: false })), ...untried.map((exercise) => ({ exercise, fresh: true }))];
}

/** `ids` with each avoided exercise swapped for its stand-in, or gone when it has none. */
export function replaceAvoided(
  ids: string[],
  exercises: Map<string, Exercise>,
  avoid: ReadonlySet<string>,
  done: string[],
): { exerciseIds: string[]; standIns: StandIn[] } {
  const taken = new Set(ids.filter((id) => !avoid.has(id)));
  const standIns: StandIn[] = [];
  const exerciseIds = ids.flatMap((id) => {
    if (!avoid.has(id)) return [id];
    const standIn = findStandIn(exercises.get(id)!, exercises, avoid, taken, done);
    if (!standIn) return [];
    taken.add(standIn.exerciseId);
    standIns.push(standIn);
    return [standIn.exerciseId];
  });
  return { exerciseIds, standIns };
}
