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
  const { main } = regionsOf(avoided);
  const likeness = (exercise: Exercise) => regionsOf(exercise).main.filter((region) => main.includes(region)).length;
  const fits = (e: Exercise) =>
    e.id !== avoided.id &&
    !avoid.has(e.id) &&
    !taken.has(e.id) &&
    e.muscle === avoided.muscle &&
    e.compound === avoided.compound &&
    e.load === avoided.load &&
    // The first region is what it's mostly for, or a hinge passes for a squat on the glutes they share.
    regionsOf(e).main.includes(main[0]);
  const standIn = (exercise: Exercise | undefined, fresh: boolean) => exercise && { exerciseId: exercise.id, instead: avoided.id, fresh };

  const doneList = done.flatMap((id) => exercises.get(id) ?? []);
  const tried = doneList.filter(fits).reverse().sort((a, b) => likeness(b) - likeness(a));
  if (tried.length) return standIn(tried[0], false);

  const used = new Set(doneList.map((e) => e.equipment));
  const otherGear = (e: Exercise) => Number(e.equipment !== avoided.equipment);
  const usedGear = (e: Exercise) => Number(used.has(e.equipment));
  const untried = [...exercises.values()]
    .filter((e) => fits(e) && !done.includes(e.id))
    .sort((a, b) => likeness(b) - likeness(a) || otherGear(b) - otherGear(a) || usedGear(b) - usedGear(a));
  return standIn(untried[0], true);
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
