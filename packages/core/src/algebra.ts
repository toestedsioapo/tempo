/**
 * @tempo/core - Interval algebra for time zone–aware meeting scheduling.
 */
export function intersectLocal(
  a: { zone: string; start: string; end: string },
  b: { zone: string; start: string; end: string }
): { zone: string; start: string; end: string } | null {
  const latestStart = a.start > b.start ? a.start : b.start;
  const earliestEnd = a.end < b.end ? a.end : b.end;
  if (latestStart >= earliestEnd) return null;
  return { zone: a.zone, start: latestStart, end: earliestEnd };
}

export function subtractLocal(
  a: { zone: string; start: string; end: string },
  b: { zone: string; start: string; end: string }
): { zone: string; start: string; end: string }[] {
  const result: { zone: string; start: string; end: string }[] = [];
  if (a.start < b.start) {
    result.push({ zone: a.zone, start: a.start, end: b.start });
  }
  if (b.end < a.end) {
    result.push({ zone: a.zone, start: b.end, end: a.end });
  }
  return result;
}