const BASE = 1000;
const MAX = 30000;
export function nextBackoff(attempt: number): number {
  return Math.min(MAX, BASE * 2 ** attempt);
}
