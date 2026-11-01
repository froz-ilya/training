import { liveQuery } from 'dexie';

/**
 * Reactive IndexedDB query for components: re-runs whenever the tables it reads change.
 *
 *   const sets = live(() => db.sets.toArray());
 *   {#each sets.value ?? [] as s} …
 *
 * Dexie starts `query` from a timer, outside the effect below, so reactive state read inside it
 * is never tracked. State the query depends on goes in `input`: it's read here, a change re-runs
 * the query, and `query` gets it as its argument. The old value stays until the new one arrives.
 *
 *   const page = live((limit) => finishedWorkouts(limit), () => shown);
 *
 * Must be called during component initialisation. Route components are re-mounted on
 * navigation, so route params read inside `query` can be treated as constants.
 */
export function live<T, I = void>(query: (input: I) => T | Promise<T>, input?: () => I): { readonly value: T | undefined } {
  let value = $state<T | undefined>(undefined);
  $effect(() => {
    const current = input?.() as I;
    // Async on purpose: Dexie only follows an async querier across its awaits.
    const sub = liveQuery(async () => query(current)).subscribe({
      next: (v) => (value = v),
      error: (e) => console.error(e),
    });
    return () => sub.unsubscribe();
  });
  return {
    get value() {
      return value;
    },
  };
}
