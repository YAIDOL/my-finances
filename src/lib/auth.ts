/** Nicknames are case-insensitive; passwords are never trimmed or transformed. */
export function normalizeNickname(nickname: string): string {
  return nickname.trim().toLowerCase();
}

export function validateNickname(nickname: string): string | null {
  return /^[A-Za-z0-9_]{3,24}$/.test(nickname.trim())
    ? null
    : 'Нікнейм: 3–24 латинські літери, цифри або знак підкреслення.';
}

export function nicknameToEmail(nickname: string): string {
  const error = validateNickname(nickname);
  if (error) throw new Error(error);
  return `${normalizeNickname(nickname)}@users.my-finances.invalid`;
}

export function validatePassword(password: string): string | null {
  if (Array.from(password).length < 6) return 'Пароль має містити щонайменше 6 символів.';
  if (/[\s\p{Cc}\p{Cf}]/u.test(password)) return 'Пароль не може містити пробіли чи приховані керівні символи.';
  if (new TextEncoder().encode(password).length > 72) return 'Пароль має бути не довшим за 72 байти UTF-8 (кирилиця займає більше одного байта).';
  return null;
}

/** An advisory meter, not a guarantee or an additional signup requirement. */
export function passwordStrength(password: string): { score: number; label: string; hints: string[] } {
  const error = validatePassword(password);
  if (error) return { score: 0, label: 'Неприпустимий', hints: [error] };
  const length = Array.from(password).length;
  const variety = [/[\p{Ll}]/u, /[\p{Lu}]/u, /[0-9]/, /[^\p{L}\p{N}]/u].filter((pattern) => pattern.test(password)).length;
  const predictable = /^(?:password|qwerty|admin|пароль)/i.test(password)
    || /^(?:0123456789|1234567890|9876543210|123456)+$/.test(password)
    || new Set(Array.from(password.toLowerCase())).size < 4;
  const score = predictable ? 1 : length >= 16 && variety >= 3 ? 4 : length >= 12 && variety >= 3 ? 3 : length >= 10 ? 2 : 1;
  const hints: string[] = [];
  if (predictable) hints.push('Уникайте поширених слів, повторів і послідовностей.');
  if (length < 16) hints.push('Використайте щонайменше 16 символів або довгу парольну фразу.');
  if (variety < 3) hints.push('Поєднайте великі й малі літери, цифри та символи.');
  return { score, label: ['', 'Слабкий', 'Посередній', 'Надійний', 'Дуже надійний'][score], hints };
}
