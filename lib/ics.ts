/**
 * Builds a calendar file with a daily practice reminder. Opening it on a phone
 * adds a repeating event with an alert, which works everywhere without push
 * notification infrastructure.
 */
export function dailyReminderIcs(opts: { time: string; title: string; url: string; now?: Date }): string {
  const now = opts.now ?? new Date();
  const [hh, mm] = opts.time.split(":").map((n) => parseInt(n, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new Error(`Invalid time "${opts.time}", expected HH:MM`);
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
  if (start <= now) start.setDate(start.getDate() + 1);

  const pad = (n: number) => String(n).padStart(2, "0");
  // Floating local time (no Z) so the reminder stays at 7pm wherever the user is.
  const local = (d: Date) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(start.getTime() + 15 * 60_000);
  const escape = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Accent Coach//Daily practice//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:daily-practice-${utc(now)}@accent-coach`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${local(start)}`,
    `DTEND:${local(end)}`,
    "RRULE:FREQ=DAILY",
    `SUMMARY:${escape(opts.title)}`,
    `DESCRIPTION:${escape(`Open your practice: ${opts.url}`)}`,
    `URL:${opts.url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escape(opts.title)}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
