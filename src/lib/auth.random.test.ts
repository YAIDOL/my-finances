import { afterEach, describe, expect, it, vi } from 'vitest';
import { displayNickname, nicknameToEmail, normalizeNickname, passwordStrength, validateNickname, validatePassword } from './auth';
import { createEmptyState } from './finance';

function random(seed: number) {
  let value = seed >>> 0;
  return () => { value = Math.imul(value, 1664525) + 1013904223 >>> 0; return value / 4294967296; };
}
describe('seeded authentication boundaries', () => {
  it('checks 3,000 random ASCII and Unicode nicknames against the allowed identity alphabet', () => {
    const rng = random(0xA17CE);
    const alphabet = Array.from('aAZ09_-.@ іЇÉ中🔒\u200b\n\t');
    const identities = new Map<string, string>();
    for (let i = 0; i < 3_000; i++) {
      const nickname = Array.from({ length: Math.floor(rng() * 30) }, () => alphabet[Math.floor(rng() * alphabet.length)]).join('');
      const trimmed = nickname.trim();
      const valid = trimmed.length >= 3 && trimmed.length <= 24 && Array.from(trimmed).every(char => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.includes(char));
      const normalized = normalizeNickname(nickname);
      expect(normalizeNickname(normalized)).toBe(normalized);
      expect(validateNickname(nickname) === null).toBe(valid);
      expect(displayNickname(nickname)).toBe(valid ? normalized : 'Мій облік');
      if (valid) {
        const email = nicknameToEmail(nickname);
        expect(email).toBe(`${normalized}@users.my-finances.invalid`);
        expect(nicknameToEmail(`  ${nickname.toUpperCase()}  `)).toBe(email);
        const existing = identities.get(email);
        if (existing !== undefined) expect(existing).toBe(normalized);
        identities.set(email, normalized);
      } else expect(() => nicknameToEmail(nickname)).toThrow();
    }
  });

  it('checks 3,000 passwords at character, hidden-control and UTF-8 boundaries', () => {
    const rng = random(0xB175);
    const alphabet = Array.from('abcXYZ019_!яЇ中🔒 \t\n\u0000\u200b\u2060');
    const safeAlphabet = Array.from('abcXYZ019_!яЇ中🔒');
    for (let i = 0; i < 3_000; i++) {
      const selected = i % 2 ? alphabet : safeAlphabet;
      const password = Array.from({ length: Math.floor(rng() * 85) }, () => selected[Math.floor(rng() * selected.length)]).join('');
      const points = Array.from(password);
      const hasForbidden = points.some(c => [' ', '\t', '\n', '\u0000', '\u200b', '\u2060'].includes(c));
      const valid = points.length >= 6 && !hasForbidden && new TextEncoder().encode(password).length <= 72;
      expect(validatePassword(password) === null).toBe(valid);
      const meter = passwordStrength(password);
      expect(meter.score).toBeGreaterThanOrEqual(0);
      expect(meter.score).toBeLessThanOrEqual(4);
      expect(meter.label.length).toBeGreaterThan(0);
      expect(Array.isArray(meter.hints)).toBe(true);
      if (!valid) { expect(meter.score).toBe(0); expect(meter.hints.length).toBeGreaterThan(0); }
      else expect(meter.score).toBeGreaterThan(0);
    }
  });

  it('accepts all exact UTF-8 limits and rejects one-codepoint overflow', () => {
    for (const [char, bytes] of [['a', 1], ['я', 2], ['中', 3], ['🔒', 4]] as const) {
      expect(validatePassword(char.repeat(72 / bytes))).toBeNull();
      expect(validatePassword(char.repeat(72 / bytes + 1))).toEqual(expect.any(String));
    }
    for (const control of ['\r', '\n', '\t', '\u0000', '\u001f', '\u007f', '\u0085', '\u00a0', '\u200b', '\u200d', '\u202e', '\u2060', '\ufeff']) expect(validatePassword(`Abc123${control}`)).toEqual(expect.any(String));
  });
});

describe('owner-bound cloud save boundaries', () => {
  const owner = '02dd8aac-209f-479e-a9f4-f1c4b339929d';
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
  function configure() {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://finance-test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
  }
  it('surfaces a server-rejected account switch without altering the supplied snapshot', async () => {
    configure();
    let request: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      request = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ code: '42501', message: 'FINANCE_OWNER_MISMATCH', details: null, hint: null }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    });
    const cloud = await import('./supabase');
    const state = createEmptyState();
    const before = structuredClone(state);
    await expect(cloud.saveFinanceState(state, 0, owner)).rejects.toThrow();
    expect(request).toEqual({ p_state: state, p_expected_version: 0, p_expected_user_id: owner });
    expect(state).toEqual(before);
  });
  it('rejects malformed intended owners before making any network request', async () => {
    configure();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const cloud = await import('./supabase');
    for (const invalid of ['', 'alice', 'missing', owner.slice(1), `${owner}\n`, '00000000-0000-0000-0000-00000000000z', null, 42, {}]) {
      await expect(cloud.saveFinanceState(createEmptyState(), 0, invalid as string)).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires the server to confirm exactly the next safe integer version', async () => {
    configure();
    let response: unknown = 0;
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const cloud = await import('./supabase');
    for (const invalid of [0, 2, '1', null, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      response = invalid;
      await expect(cloud.saveFinanceState(createEmptyState(), 0, owner)).rejects.toThrow(/Сервер не підтвердив/);
    }
    response = 1;
    await expect(cloud.saveFinanceState(createEmptyState(), 0, owner)).resolves.toBe(1);
  });
  it('asks a legacy client to refresh instead of dropping private categories', async () => {
    configure();
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: '22023', message: 'FINANCE_CLIENT_OUTDATED', details: null, hint: null }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    const cloud = await import('./supabase');
    await expect(cloud.saveFinanceState(createEmptyState(), 0, owner)).rejects.toThrow(/Перезавантаж.*категорії/);
  });
});
