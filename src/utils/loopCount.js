export const MAX_LOOP_COUNT = 1000;

export function normalizeLoopCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(1, Math.min(MAX_LOOP_COUNT, Math.floor(count))) : 1;
}
