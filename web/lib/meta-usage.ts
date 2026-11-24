export type UsageSample = {
  measuredAt: string;
  calls: number | null;
  cpu: number | null;
  time: number | null;
};

export type UsageReport = {
  receivedAt: string;
  latestHasUsage: boolean;
  limited: boolean;
  sample: UsageSample | null;
};

export function readAppUsage(header: string | null, measuredAt: string): UsageSample | null {
  if (!header) return null;
  try {
    const data = JSON.parse(header);
    const percent = (key: string) => {
      const n = data?.[key];
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
    };
    const calls = percent('call_count'), cpu = percent('total_cputime'), time = percent('total_time');
    if (calls === null && cpu === null && time === null) return null;
    return {measuredAt, calls, cpu, time};
  } catch { return null; }
}

export function mergeUsage(previous: UsageReport | null, next: UsageReport): UsageReport {
  if (!previous) return next;
  const latest = previous.receivedAt > next.receivedAt ? previous : next;
  const older = previous.sample, newer = next.sample;
  const sample = older && (!newer || older.measuredAt > newer.measuredAt) ? older : newer;
  return {...latest, sample};
}
