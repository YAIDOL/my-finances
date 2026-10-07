export function validDate(value: unknown, optional = false): value is string {
  if (optional && value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function daysBetween(from: string, to: string) {
  if (!validDate(from) || !validDate(to)) throw new Error('Обери коректну дату.');
  return Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);
}
export function addDays(date: string, days: number) {
  if (!validDate(date) || !Number.isSafeInteger(days)) throw new Error('Некоректний строк.');
  const result = new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  if (!validDate(result)) throw new Error('Дата виходить за доступний календар.');
  return result;
}
