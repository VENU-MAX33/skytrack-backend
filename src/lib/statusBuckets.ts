// Trip statuses and their dashboard buckets.
// Mirrored on the frontend in frontend-vite/src/lib/tripStatus.ts — keep in sync.

export const TRIP_STATUSES = [
  'Not Started Yet',
  'Driver Accepted',
  'Driver Rejected',
  'Trip Started',
  'Pickup Started',
  'Drop Started',
  'Completed',
  'Completed Late',
  'No Show Completed',
  'Auto Cancelled',
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

export const STATUS_BUCKETS: Record<string, TripStatus[]> = {
  'in-progress': ['Trip Started', 'Pickup Started', 'Drop Started'],
  'not-started': ['Not Started Yet', 'Driver Accepted'],
  completed: ['Completed', 'Completed Late', 'No Show Completed'],
  delayed: ['Completed Late'],
  cancelled: ['Auto Cancelled', 'Driver Rejected'],
};

// Tailwind text-color classes matching the existing LiveTripMonitor palette.
export const STATUS_COLORS: Record<TripStatus, string> = {
  'Not Started Yet': 'text-[#777777]',
  'Driver Accepted': 'text-[#18751C]',
  'Driver Rejected': 'text-[#D22630]',
  'Trip Started': 'text-[#0047B2]',
  'Pickup Started': 'text-[#E65100]',
  'Drop Started': 'text-[#00695C]',
  Completed: 'text-[#18751C]',
  'Completed Late': 'text-[#E65100]',
  'No Show Completed': 'text-[#D22630]',
  'Auto Cancelled': 'text-[#D22630]',
};

export function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
