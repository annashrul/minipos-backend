type TimeZoneDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export const APP_TIME_ZONE = process.env.APP_TIMEZONE ?? "Asia/Jakarta";

function getTimeZoneDateParts(
  date: Date,
  timeZone = APP_TIME_ZONE,
): TimeZoneDateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone = APP_TIME_ZONE): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  const zoneToken = formatter
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;

  const match = zoneToken?.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? "0");
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes) * 60_000;
}

export function zonedDateToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
  timeZone = APP_TIME_ZONE,
): Date {
  const utcGuess = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond),
  );
  const offsetMs = getTimeZoneOffsetMs(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMs);
}

/** Tanggal kalender (YYYY-MM-DD) sesuai timezone — mis. "hari ini" versi WIB. */
export function dateStringInTimeZone(
  date: Date,
  timeZone = APP_TIME_ZONE,
): string {
  const p = getTimeZoneDateParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function startOfDayInTimeZone(
  date: Date,
  timeZone = APP_TIME_ZONE,
): Date {
  const p = getTimeZoneDateParts(date, timeZone);
  return zonedDateToUtc(p.year, p.month, p.day, 0, 0, 0, 0, timeZone);
}

export function addDaysInTimeZone(
  date: Date,
  days: number,
  timeZone = APP_TIME_ZONE,
): Date {
  const p = getTimeZoneDateParts(date, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedDateToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
    0,
    0,
    timeZone,
  );
}

export function addMonthsInTimeZone(
  date: Date,
  months: number,
  timeZone = APP_TIME_ZONE,
): Date {
  const p = getTimeZoneDateParts(date, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1 + months, 1));
  return zonedDateToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    1,
    0,
    0,
    0,
    0,
    timeZone,
  );
}

export function addYearsInTimeZone(
  date: Date,
  years: number,
  timeZone = APP_TIME_ZONE,
): Date {
  const p = getTimeZoneDateParts(date, timeZone);
  return zonedDateToUtc(p.year + years, 1, 1, 0, 0, 0, 0, timeZone);
}

export function startOfMonthInTimeZone(
  date: Date,
  timeZone = APP_TIME_ZONE,
): Date {
  const p = getTimeZoneDateParts(date, timeZone);
  return zonedDateToUtc(p.year, p.month, 1, 0, 0, 0, 0, timeZone);
}

export function startOfYearInTimeZone(
  date: Date,
  timeZone = APP_TIME_ZONE,
): Date {
  const p = getTimeZoneDateParts(date, timeZone);
  return zonedDateToUtc(p.year, 1, 1, 0, 0, 0, 0, timeZone);
}

export function startOfDateStringInTimeZone(
  dateString: string,
  timeZone = APP_TIME_ZONE,
): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return startOfDayInTimeZone(new Date(), timeZone);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return zonedDateToUtc(year, month, day, 0, 0, 0, 0, timeZone);
}

export function getHourInTimeZone(
  date: Date,
  timeZone = APP_TIME_ZONE,
): number {
  return getTimeZoneDateParts(date, timeZone).hour;
}

export function getWeekdayInTimeZone(
  date: Date,
  timeZone = APP_TIME_ZONE,
): number {
  const p = getTimeZoneDateParts(date, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}
