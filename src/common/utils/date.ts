export function toDateOnly(date: Date | string): string {
  const d = typeof date === "string" ? date : date.toISOString();
  return d.slice(0, 10);
}
