// Computes the [from, to] date range (inclusive, 'YYYY-MM-DD' strings) covered by a report period.

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export const REPORT_PERIODS: ReportPeriod[] = ['daily', 'weekly', 'monthly', 'yearly'];

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function reportRange(period: ReportPeriod, date: string): { from: string; to: string; label: string } {
  const [y, m, d] = date.split('-').map(Number);
  const anchor = new Date(y, (m || 1) - 1, d || 1);

  if (period === 'daily') {
    return { from: date, to: date, label: date };
  }

  if (period === 'weekly') {
    const dow = anchor.getDay(); // 0=Sun..6=Sat
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(anchor);
    monday.setDate(anchor.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: fmt(monday), to: fmt(sunday), label: `${fmt(monday)} to ${fmt(sunday)}` };
  }

  if (period === 'monthly') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { from: fmt(first), to: fmt(last), label: fmt(first).slice(0, 7) };
  }

  // yearly
  const first = new Date(anchor.getFullYear(), 0, 1);
  const last = new Date(anchor.getFullYear(), 11, 31);
  return { from: fmt(first), to: fmt(last), label: String(anchor.getFullYear()) };
}
