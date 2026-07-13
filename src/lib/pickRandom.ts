// Fisher–Yates on a copy. Never shuffles in place: the arrays passed in here are
// React props and server-side cached query results, and mutating them would
// reorder the caller's list out from under it.
export function pickRandom<T>(items: readonly T[], count: number): T[] {
  const pool = items.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
