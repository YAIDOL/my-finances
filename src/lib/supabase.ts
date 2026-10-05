import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nicknameToEmail, normalizeNickname, validateNickname, validatePassword } from './auth';
import type { FinanceState } from './types';

const url = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const isSupabaseConfigured = Boolean(url && key);
export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
}) : null;

function client(): SupabaseClient {
  if (!supabase) throw new Error('Supabase ще не налаштовано. Потрібні адреса проєкту та публічний ключ.');
  return supabase;
}

export class FinanceConflictError extends Error {
  readonly code = 'FINANCE_CONFLICT';
  constructor() {
    super('Дані змінилися в іншій вкладці або на іншому пристрої. Оновіть сторінку й повторіть дію. Незбережені зміни не надіслано.');
    this.name = 'FinanceConflictError';
  }
}

function requestError(error: { message?: string; code?: string; status?: number }, action: string): Error {
  if (error.message?.includes('FINANCE_VERSION_CONFLICT')) return new FinanceConflictError();
  if (error.code === 'invalid_credentials') return new Error('Неправильний нікнейм або пароль.');
  if (error.code === 'user_already_exists' || error.code === 'email_exists') return new Error('Цей нікнейм уже зайнято. Виберіть інший.');
  if (error.code === 'email_not_confirmed') return new Error('Вхід недоступний: адміністратор має вимкнути підтвердження електронної пошти в Supabase.');
  if (error.code === 'over_request_rate_limit' || error.code === 'over_email_send_rate_limit' || error.status === 429) return new Error('Забагато спроб. Зачекайте трохи й повторіть.');
  if (error.code === 'weak_password') return new Error('Supabase відхилив пароль. Перевірте вимоги до пароля або налаштування проєкту.');
  return new Error(`Не вдалося ${action}. Перевірте підключення й повторіть спробу. Якщо помилка повториться, зверніться до адміністратора.`);
}

function validateCredentials(nickname: string, password: string): void {
  const error = validateNickname(nickname) || validatePassword(password);
  if (error) throw new Error(error);
}

export async function signUpWithNickname(nickname: string, password: string) {
  validateCredentials(nickname, password);
  const { data, error } = await client().auth.signUp({
    email: nicknameToEmail(nickname), password, options: { data: { username: normalizeNickname(nickname) } },
  });
  if (error) throw requestError(error, 'створити обліковий запис');
  return data;
}

export async function signInWithNickname(nickname: string, password: string) {
  validateCredentials(nickname, password);
  const { data, error } = await client().auth.signInWithPassword({ email: nicknameToEmail(nickname), password });
  if (error) throw requestError(error, 'увійти');
  return data;
}

export async function signOut(): Promise<void> {
  const { error } = await client().auth.signOut();
  if (error) throw requestError(error, 'вийти');
}

const stateKeys = ['accounts', 'transactions', 'goals', 'debts', 'payments', 'budgets'] as const;
function isFinanceState(value: unknown): value is FinanceState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === stateKeys.length && stateKeys.every((name) => Array.isArray(record[name]));
}

function emptyState(): FinanceState {
  return { accounts: [], transactions: [], goals: [], debts: [], payments: [], budgets: [] };
}

export async function loadFinanceState(userId: string): Promise<{ state: FinanceState; version: number }> {
  const db = client();
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError) throw requestError(authError, 'перевірити сеанс');
  if (!auth.user || auth.user.id !== userId) throw new Error('Сеанс змінився. Увійдіть знову, щоб завантажити власні дані.');
  const { data, error } = await db.from('finance_state').select('state, version').eq('user_id', userId).maybeSingle();
  if (error) throw requestError(error, 'завантажити фінансові дані');
  // Only a successful response with no row means a new, empty account.
  if (data === null) return { state: emptyState(), version: 0 };
  if (!isFinanceState(data.state) || !Number.isSafeInteger(data.version) || data.version < 0) {
    throw new Error('Хмарні дані мають невідомий формат. Зверніться до адміністратора; дані не перезаписано.');
  }
  return { state: data.state, version: data.version };
}

export async function saveFinanceState(state: FinanceState, expectedVersion: number): Promise<number> {
  const db = client();
  if (!isFinanceState(state) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new Error('Не вдалося зберегти дані: неприпустимий формат або версія.');
  }
  const { data, error } = await db.rpc('save_finance_state', { p_state: state, p_expected_version: expectedVersion });
  if (error) throw requestError(error, 'зберегти фінансові дані');
  if (!Number.isSafeInteger(data) || data !== expectedVersion + 1) throw new Error('Сервер не підтвердив нову версію. Оновіть сторінку перед наступною зміною.');
  return data;
}
