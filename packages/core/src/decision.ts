import { intersectLocal, subtractLocal } from "./algebra";
import { DateTime as LuxonDateTime } from "luxon";

export type Zone = string;
export type Iso = string;

export interface LocalInterval {
  zone: Zone;
  start: string;
  end: string;
}

export interface IsoSlot {
  start: string;
  end: string;
  reason?: string;
}

export type DecisionResult =
  | { ok: true; slots: IsoSlot[] }
  | { ok: false; error: "no_overlap" | "blackout" | "invalid_interval" };

export function localToIso(
  zone: Zone,
  date: string,
  interval: LocalInterval
): { start: string; end: string } {
  const [year, month, day] = date.split("-").map(Number);
  const [startHour, startMin] = interval.start.split(":").map(Number);
  const [endHour, endMin] = interval.end.split(":").map(Number);

  const dtFrom = LuxonDateTime.fromObject(
    { year, month, day, hour: startHour, minute: startMin, second: 0 },
    { zone }
  );

  const dtTo = LuxonDateTime.fromObject(
    { year, month, day, hour: endHour, minute: endMin, second: 0 },
    { zone }
  );

  return {
    start: dtFrom.toISO() ?? "",
    end: dtTo.toISO() ?? "",
  };
}

export function decide(request: {
  date: string;
  start: string;
  end: string;
  requesterTimeZone: Zone;
  partyA: { zone: string; weeklyRules?: Record<string, { start: string; end: string }[]>; availability?: { start: string; end: string }[]; minimumNoticeMinutes?: number };
  partyB: { zone: string; weeklyRules?: Record<string, { start: string; end: string }[]>; availability?: { start: string; end: string }[]; minimumNoticeMinutes?: number };
  now: string;
  blackoutDates?: string[];
}): DecisionResult {
  if (request.start >= request.end) {
    return { ok: false, error: "invalid_interval" };
  }

const buildPartyIntervals = (rules: {
    zone: string;
    weeklyRules?: Record<string, { start: string; end: string }[]>;
    availability?: { start: string; end: string }[];
    minimumNoticeMinutes?: number;
  }): LocalInterval[] => {
    const dt = LuxonDateTime.fromFormat(request.date, "yyyy-LL-dd");
    if (!dt.isValid) return [];
    
    let intervals: { start: string; end: string }[] = [];
    if (rules.weeklyRules) {
      const weekday = dt.weekdayLong.toLowerCase() as string;
      intervals = rules.weeklyRules[weekday] ?? [];
    } else if (rules.availability) {
      intervals = rules.availability;
    }

    return intervals
      .map((i) => ({
        zone: rules.zone,
        start: i.start,
        end: i.end,
      }))
      .filter((i) => i.start < i.end);
  };

  const aIntervals = buildPartyIntervals(request.partyA);
  const bIntervals = buildPartyIntervals(request.partyB);

  if (aIntervals.length === 0 || bIntervals.length === 0) {
    return { ok: false, error: "no_overlap" };
  }

  const intersected: LocalInterval[] = [];
  for (const a of aIntervals) {
    for (const b of bIntervals) {
      const inter = intersectLocal(a, b);
      if (inter) intersected.push(inter);
    }
  }

  if (intersected.length === 0) {
    return { ok: false, error: "no_overlap" };
  }

  intersected.sort((x, y) =>
    x.start.localeCompare(y.start, "en", { numeric: true })
  );

  const requestInterval: LocalInterval = {
    zone: request.requesterTimeZone,
    start: request.start,
    end: request.end,
  };

  for (const inter of intersected) {
    if (inter.start <= request.start && request.end <= inter.end) {
      const iso = localToIso(
        request.requesterTimeZone,
        request.date,
        requestInterval
      );
      return {
        ok: true,
        slots: [{ start: iso.start, end: iso.end, reason: "inside_both_parties" }],
      };
    }
  }

  const isBlackedOut = (d: string) => {
    if (!request.blackoutDates) return false;
    return request.blackoutDates.includes(d);
  };

  const nonBlackoutIntersected: LocalInterval[] = [];
  for (const inter of intersected) {
    if (!isBlackedOut(request.date)) {
      nonBlackoutIntersected.push(inter);
    }
  }

  if (nonBlackoutIntersected.length === 0) {
    return { ok: false, error: "blackout" };
  }

  const minNotice = Math.max(
    request.partyA.minimumNoticeMinutes ?? 0,
    request.partyB.minimumNoticeMinutes ?? 0
  );

  const counters: IsoSlot[] = [];
  let cursor = "00:00";

  const getMinutes = (timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number);
    return h * 60 + m;
  };

  for (const inter of nonBlackoutIntersected) {
    if (cursor < inter.start) {
      const gap: LocalInterval = {
        zone: inter.zone,
        start: cursor,
        end: inter.start,
      };
      if (gap.end > gap.start) {
        const gapMinutes = getMinutes(gap.end) - getMinutes(gap.start);
        if (gapMinutes >= minNotice) {
          const iso = localToIso(inter.zone, request.date, gap);
          counters.push({
            start: iso.start,
            end: iso.end,
            reason: "counter_offer",
          });
        }
      }
    }
    cursor = inter.end;
  }

  if (cursor < "23:59") {
    const gap: LocalInterval = {
      zone: nonBlackoutIntersected[nonBlackoutIntersected.length - 1]?.zone ?? request.requesterTimeZone,
      start: cursor,
      end: "23:59",
    };
    if (gap.end > gap.start) {
      const gapMinutes = getMinutes(gap.end) - getMinutes(gap.start);
      if (gapMinutes >= minNotice) {
        const iso = localToIso(gap.zone, request.date, gap);
        counters.push({
          start: iso.start,
          end: iso.end,
          reason: "counter_offer",
        });
      }
    }
  }

  return { ok: true, slots: counters.slice(0, 3) };
}