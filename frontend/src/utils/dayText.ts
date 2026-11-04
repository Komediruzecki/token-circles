/**
 * A day as setup writes one: "15 Oct" in this year, "28 Dec 2025" in another; ISO dates in. The
 * spaces do not break, so a narrow row wraps around a day, never inside one.
 */
const FORMATS = {
  plain: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  year: new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }),
}

export function dayText(
  iso: string,
  withYear = Number(iso.slice(0, 4)) !== new Date().getFullYear()
): string {
  return (withYear ? FORMATS.year : FORMATS.plain)
    .format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))
    .replace(/ /g, ' ')
}
