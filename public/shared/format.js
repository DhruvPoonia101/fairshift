import { currentLocale, t } from './i18n.js';

const IST = 'Asia/Kolkata';
const PAISE_PER_RUPEE = 100;
const MINUTES_PER_HOUR = 60;

/** Integer paise in, localised rupees out. The only place paise are divided, and only for display. */
export function money(paise) {
  const whole = paise % PAISE_PER_RUPEE === 0;
  return new Intl.NumberFormat(currentLocale(), {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(paise / PAISE_PER_RUPEE);
}

export const number = (n) => new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 2 }).format(n);

/** 485 -> "8h 05m" in the current language. */
export function hoursMinutes(totalMinutes) {
  return t('fmt.hm', {
    h: Math.floor(totalMinutes / MINUTES_PER_HOUR),
    m: String(totalMinutes % MINUTES_PER_HOUR).padStart(2, '0'),
  });
}

/** Clock time in IST, whatever the phone's own time zone is. */
export function timeIst(ms) {
  return new Intl.DateTimeFormat(currentLocale(), { timeZone: IST, hour: '2-digit', minute: '2-digit' }).format(ms);
}

/** 'YYYY-MM-DD' (an IST day) to a short label like "Tue, 27 Oct". */
export function dayLabel(key, withWeekday = true) {
  return new Intl.DateTimeFormat(currentLocale(), {
    timeZone: IST,
    weekday: withWeekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${key}T12:00:00+05:30`));
}

export function monthLabel(month) {
  return new Intl.DateTimeFormat(currentLocale(), { timeZone: IST, month: 'long', year: 'numeric' }).format(
    new Date(`${month}-15T12:00:00+05:30`),
  );
}

/** Date only: anonymous reports keep no time of day. */
export function dateIst(ms) {
  return new Intl.DateTimeFormat(currentLocale(), { timeZone: IST, day: 'numeric', month: 'short' }).format(ms);
}

export function dateTimeIst(ms) {
  return new Intl.DateTimeFormat(currentLocale(), {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms);
}

/** Current IST month as 'YYYY-MM', and the one before it. */
export function istMonths() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year').value);
  const month = Number(parts.find((p) => p.type === 'month').value);
  const pad = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  const current = pad(year, month);
  const previous = month === 1 ? pad(year - 1, 12) : pad(year, month - 1);
  return { current, previous };
}
