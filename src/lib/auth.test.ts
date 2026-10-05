import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nicknameToEmail, normalizeNickname, passwordStrength, validateNickname, validatePassword } from './auth';

describe('nickname authentication', () => {
  it('maps nickname case and surrounding space to the same login identity', () => {
    expect(normalizeNickname('  Alice_17  ')).toBe('alice_17');
    expect(nicknameToEmail('  Alice_17  ')).toBe('alice_17@users.my-finances.invalid');
  });

  it.each(['abc', 'A_1', 'a'.repeat(24), '  Alice  '])('accepts valid nickname %s', (nickname) => {
    expect(validateNickname(nickname)).toBeNull();
  });

  it.each(['', 'ab', 'a'.repeat(25), 'іван', 'foo-bar', 'foo.bar', 'a b', 'foo@bar', 'A\u200bB'])('rejects invalid nickname %s', (nickname) => {
    expect(validateNickname(nickname)).toEqual(expect.any(String));
    expect(() => nicknameToEmail(nickname)).toThrow();
  });
});

describe('cloud boundary without configuration', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it('refuses to load or save account data instead of returning demo state', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const cloud = await import('./supabase');
    expect(cloud.isSupabaseConfigured).toBe(false);
    expect(cloud.supabase).toBeNull();
    await expect(cloud.loadFinanceState('user-id')).rejects.toThrow(/Supabase/);
    await expect(cloud.saveFinanceState({ accounts: [], transactions: [], goals: [], debts: [], payments: [], budgets: [] }, 0)).rejects.toThrow(/Supabase/);
    await expect(cloud.signInWithNickname('alice', 'abc123')).rejects.toThrow(/Supabase/);
    await expect(cloud.signUpWithNickname('alice', 'abc123')).rejects.toThrow(/Supabase/);
  });
});

describe('cloud request and failure handling', () => {
  const emptyState = { accounts: [], transactions: [], goals: [], debts: [], payments: [], budgets: [] };
  const user = { id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'alice@users.my-finances.invalid', created_at: '2026-10-05T00:00:00Z', app_metadata: {}, user_metadata: { username: 'alice' } };
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://finance-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

  it('sends normalized nickname identity and never changes the password', async () => {
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requestBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ user, session: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const cloud = await import('./supabase');
    expect(cloud.isSupabaseConfigured).toBe(true);
    const result = await cloud.signUpWithNickname(' ALICE ', 'MiXeD9!');
    expect(result.user?.id).toBe('user-1');
    expect(requestBody.email).toBe('alice@users.my-finances.invalid');
    expect(requestBody.password).toBe('MiXeD9!');
    expect(requestBody.data).toEqual({ username: 'alice' });
  });

  it('makes the atomic save request with the expected version and no supplied user id', async () => {
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requestBody = JSON.parse(String(init.body));
      return new Response('8', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const cloud = await import('./supabase');
    expect(await cloud.saveFinanceState(emptyState, 7)).toBe(8);
    expect(requestBody).toEqual({ p_state: emptyState, p_expected_version: 7 });
  });

  it('surfaces a version conflict with an actionable Ukrainian error', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 'P0001', message: 'FINANCE_VERSION_CONFLICT', details: null, hint: null }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
    const cloud = await import('./supabase');
    await expect(cloud.saveFinanceState(emptyState, 0)).rejects.toMatchObject({ code: 'FINANCE_CONFLICT', message: expect.stringMatching(/Оновіть/) });
  });

  it('does not interpret a failed cloud read as an empty account', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('/auth/v1/user')) return new Response(JSON.stringify(user), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ code: '500', message: 'network unavailable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    });
    const cloud = await import('./supabase');
    // Only bypass the external Auth verification call; exercise the real read.
    vi.spyOn(cloud.supabase!.auth, 'getUser').mockResolvedValue({ data: { user }, error: null });
    await expect(cloud.loadFinanceState('user-1')).rejects.toThrow(/завантажити фінансові дані/);
  });
});

describe('password validation', () => {
  it('accepts six characters without requiring a strong password', () => {
    expect(validatePassword('abc123')).toBeNull();
    expect(validatePassword('пароль')).toBeNull();
  });

  it.each(['', 'abc12', 'abc 12', 'abc\t12', 'abc\n12', 'abcdef\u0000', 'abc\u200b12'])('rejects short passwords and whitespace or controls %s', (password) => {
    expect(validatePassword(password)).toEqual(expect.any(String));
  });

  it('limits passwords by UTF-8 bytes to avoid silent bcrypt truncation', () => {
    expect(validatePassword('a'.repeat(72))).toBeNull();
    expect(validatePassword('a'.repeat(73))).toEqual(expect.any(String));
    expect(validatePassword('я'.repeat(36))).toBeNull();
    expect(validatePassword('я'.repeat(37))).toEqual(expect.any(String));
  });
});

describe('password strength guidance', () => {
  it('keeps invalid passwords at zero and provides advice', () => {
    const strength = passwordStrength('aA1!');
    expect(strength.score).toBe(0);
    expect(strength.label).toEqual(expect.any(String));
    expect(strength.hints.length).toBeGreaterThan(0);
  });

  it('recognizes repeated and common passwords as weak', () => {
    expect(passwordStrength('aaaaaa').score).toBe(1);
    expect(passwordStrength('Password123!').score).toBe(1);
    expect(passwordStrength('1234567890').score).toBe(1);
  });

  it('rewards a long varied password and stops suggesting improvements', () => {
    const strength = passwordStrength('River!Cobalt29Moon');
    expect(strength.score).toBe(4);
    expect(strength.hints).toEqual([]);
  });

  it('reports an improvement when a valid password is short', () => {
    expect(passwordStrength('abc123').score).toBe(1);
    expect(passwordStrength('abc123').hints.length).toBeGreaterThan(0);
  });
});
