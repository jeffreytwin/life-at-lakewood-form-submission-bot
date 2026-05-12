const ET_OPTS: Intl.DateTimeFormatOptions = { timeZone: "America/New_York" };

export function formatDateTimeET(iso: string): string {
  return `${new Date(iso).toLocaleString("en-US", ET_OPTS)} ET`;
}

export function formatTimeET(iso: string): string {
  return `${new Date(iso).toLocaleTimeString("en-US", ET_OPTS)} ET`;
}

export function formatDateET(iso: string): string {
  return `${new Date(iso).toLocaleDateString("en-US", ET_OPTS)} ET`;
}
