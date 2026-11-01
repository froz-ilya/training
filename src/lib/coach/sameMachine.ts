/**
 * Exercises where the user said a fall in their numbers wasn't a machine change, so the app stops
 * asking. Only a convenience: if it's lost, the question comes back and nothing else changes.
 */
const KEY = 'coach.sameMachine';

export function getSameMachine(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markSameMachine(exerciseId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...getSameMachine(), exerciseId]));
  } catch {
    // Blocked storage: the question simply comes back.
  }
}
