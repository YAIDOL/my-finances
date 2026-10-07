import { describe, expect, it } from 'vitest';
import * as daily from './daily';
import * as undo from './undo';
import { addAccount, addDebt, addGoal, addPayment, addTransaction, allocateGoal, accountBalance, createEmptyState, repayDebt, restoreFinanceState } from './finance';
import type { FinanceState, QuickTemplate, RecurringPayment } from './types';

// UUIDs do not influence action selection: seed and step reproduce every scenario.
function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let n = Math.imul(value ^ value >>> 15, 1 | value);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
const now = '2028-01-31';
function base(balance = 5_000_000) {
  let s = createEmptyState();
  for (const type of ['cash', 'card', 'savings'] as const) s = addAccount(s, { name: type, type, initialBalance: balance, lastFour: '', color: 'navy' });
  return s;
}
function template(s: FinanceState): Omit<QuickTemplate, 'id'> {
  return { name: 'Кава ☕ <script>', kind: 'expense', accountId: s.accounts[0].id, category: 'expense-0', amount: 100, note: 'Дві кави & чай' };
}
function recurring(s: FinanceState): Omit<RecurringPayment, 'id'> {
  return { name: 'Підписка', amount: 100, accountId: s.accounts[0].id, category: 'expense-0', frequency: 'monthly', startDate: now, nextDate: now, paused: false };
}
function ledger(s: FinanceState) {
  return s.accounts.reduce((sum, a) => sum + a.initialBalance, 0) + s.transactions.reduce((sum, t) => sum + (t.kind === 'transfer' ? 0 : ['income', 'borrow', 'repay-receivable'].includes(t.kind) ? t.amount : -t.amount), 0);
}
function assertLinks(s: FinanceState) {
  expect(restoreFinanceState(s)).toEqual(s);
  for (const p of s.payments) {
    const linked = s.transactions.filter(t => t.paymentId === p.id);
    expect(linked).toHaveLength(p.status === 'paid' ? 1 : 0);
    if (linked[0]) {
      expect(linked[0]).toMatchObject({ amount: p.amount, accountId: p.accountId });
      expect(linked[0].debtId).toBe(p.debtId);
    }
  }
  for (const a of s.accounts) {
    const movement = s.transactions.reduce((n, t) => n + (t.accountId === a.id ? (['income', 'borrow', 'repay-receivable'].includes(t.kind) ? t.amount : -t.amount) : 0) + (t.kind === 'transfer' && t.toAccountId === a.id ? t.amount : 0), 0);
    expect(accountBalance(s, a.id)).toBe(a.initialBalance + movement);
    expect(a.initialBalance + movement).toBeGreaterThanOrEqual(0);
  }
}

describe('randomized daily assistance transitions', () => {
  const actions = ['save-template', 'edit-template', 'remove-template', 'use-template', 'save-recurring', 'edit-recurring', 'toggle-recurring', 'remove-recurring', 'confirm-recurring', 'set-income', 'set-reminder', 'read'] as const;
  it.each(Array.from({ length: 12 }, (_, i) => 0xDA11_0000 + i * 3571))('preserves source states, money and undo over 160 actions (seed %i)', seed => {
    const rng = random(seed);
    const pick = <T,>(values: readonly T[]) => values[Math.floor(rng() * values.length)];
    let s = base();
    s = addDebt(s, { person: 'Друг', direction: 'payable', principal: 20_000, date: '2028-01-01', dueDate: now, note: '' }, '', false);
    const attempted = new Set<string>();
    const accepted = new Map<string, number>();
    const history: string[] = [];
    for (let step = 0; step < 160; step++) {
      const action = step < actions.length ? actions[step] : pick(actions);
      attempted.add(action);
      const before = structuredClone(s), balance = ledger(s);
      const t = pick(s.assistance!.templates), r = pick(s.assistance!.recurring);
      const amount = pick([1, 99, 1_001, 50_000, 0, -1, 0.5, NaN, Infinity]);
      const activeAccount = pick(s.accounts);
      const ti = { ...template(s), accountId: activeAccount.id, kind: pick(['income', 'expense'] as const), amount, name: `Шаблон ${step} ☕` };
      ti.category = ti.kind === 'income' ? 'income-0' : 'expense-0';
      const ri = { ...recurring(s), accountId: activeAccount.id, amount, name: `Правило ${step}`, frequency: pick(['weekly', 'monthly', 'yearly'] as const) };
      history.push(`${step}:${action}(${amount})`);
      let next: FinanceState | undefined, rejection: unknown;
      let expectedDelta = 0;
      try {
        switch (action) {
          case 'save-template': next = daily.saveTemplate(s, ti); break;
          case 'edit-template': next = daily.saveTemplate(s, ti, t?.id ?? 'missing'); break;
          case 'remove-template': next = daily.removeTemplate(s, t?.id ?? 'missing'); break;
          case 'use-template': {
            const input = daily.templateTransaction(s, t?.id ?? 'missing');
            next = addTransaction(s, input);
            expectedDelta = input.kind === 'income' ? input.amount : -input.amount;
            break;
          }
          case 'save-recurring': next = daily.saveRecurring(s, ri); break;
          case 'edit-recurring': next = daily.saveRecurring(s, ri, r?.id ?? 'missing'); break;
          case 'toggle-recurring': next = daily.toggleRecurring(s, r?.id ?? 'missing'); break;
          case 'remove-recurring': next = daily.removeRecurring(s, r?.id ?? 'missing'); break;
          case 'confirm-recurring': next = daily.confirmRecurring(s, r?.id ?? 'missing', now); expectedDelta = -(r?.amount ?? 0); break;
          case 'set-income': next = daily.setNextIncome(s, pick(['2028-02-01', '2028-02-29', '2028-01-01', '', '2028-02-30']), now); break;
          case 'set-reminder': next = daily.setDebtReminder(s, s.debts[0].id, pick([now, '', '2028-02-29', 'bad']), pick(['', now, '2028-02-04', '2028-02-30'])); break;
          case 'read': daily.paydayForecast(s, now); daily.reminders(s, now); break;
        }
      } catch (error) { rejection = error; }
      try {
        expect(s).toEqual(before);
        if (rejection) expect(rejection).toBeInstanceOf(Error);
        if (next) {
          accepted.set(action, (accepted.get(action) ?? 0) + 1);
          expect(ledger(next)).toBe(balance + expectedDelta);
          assertLinks(next);
          const entry = undo.captureUndo(s, next, 'synthetic-owner-a');
          expect(undo.undoState(next, entry, 'synthetic-owner-a')).toEqual(before);
          expect(() => undo.undoState(next!, entry, 'synthetic-owner-b')).toThrow();
          if (action === 'confirm-recurring') {
            expect(next.transactions).toHaveLength(s.transactions.length + 1);
            expect(next.payments).toHaveLength(s.payments.length + 1);
          }
          s = next;
        }
      } catch (error) { throw new Error(`seed=${seed}; step=${step}; recent=${history.slice(-10).join(' -> ')}`, { cause: error }); }
    }
    expect(attempted.size).toBe(actions.length);
    expect(accepted.size, `seed=${seed}; rejected every meaningful action`).toBeGreaterThanOrEqual(6);
    expect([...accepted.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(30);
  });
});

describe('calendar, forecast and reminder adversarial boundaries', () => {
  it.each([
    ['weekly', '2027-12-28', '2027-12-28', '2028-01-04'],
    ['weekly', '2028-02-25', '2028-02-25', '2028-03-03'],
    ['monthly', '2027-01-31', '2027-01-31', '2027-02-28'],
    ['monthly', '2027-01-31', '2027-02-28', '2027-03-31'],
    ['monthly', '2028-01-30', '2028-02-29', '2028-03-30'],
    ['monthly', '2028-03-31', '2028-03-31', '2028-04-30'],
    ['monthly', '2028-03-31', '2028-04-30', '2028-05-31'],
    ['yearly', '2028-02-29', '2028-02-29', '2029-02-28'],
    ['yearly', '2028-02-29', '2031-02-28', '2032-02-29'],
    ['yearly', '2096-02-29', '2099-02-28', '2100-02-28'],
    ['yearly', '2396-02-29', '2399-02-28', '2400-02-29'],
  ] as const)('advances %s anchored at %s from %s to %s', (frequency, startDate, nextDate, expected) => {
    expect(daily.nextRecurringDate({ ...recurring(base()), frequency, startDate, nextDate })).toBe(expected);
  });

  it('retains the original month-day anchor over 240 randomly chosen monthly schedules (seed 0xCA1E)', () => {
    const rng = random(0xCA1E);
    for (let i = 0; i < 240; i++) {
      const year = 2020 + Math.floor(rng() * 80), day = 28 + Math.floor(rng() * 4);
      const anchor = `${year}-01-${day}`;
      let rule = { ...recurring(base()), startDate: anchor, nextDate: anchor };
      for (let month = 2; month <= 12; month++) {
        const days = [0, 31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
        const expected = `${year}-${String(month).padStart(2, '0')}-${Math.min(day, days)}`;
        const next = daily.nextRecurringDate(rule);
        expect(next, `seed=0xCA1E; case=${i}; month=${month}`).toBe(expected);
        rule = { ...rule, nextDate: next };
      }
    }
  });

  it('subtracts reserved obligations and linked debt installments exactly once over 300 forecasts (seed 0xF0AEC)', () => {
    const rng = random(0xF0AEC);
    for (let i = 0; i < 300; i++) {
      const amount = () => 1 + Math.floor(rng() * 10_000);
      const goal = amount(), reserved = amount(), ordinary = amount(), debt = 40_000 + amount(), linkedReserved = amount(), linkedOrdinary = amount(), weekly = amount();
      let s = base(1_000_000);
      s.accounts = [s.accounts[0]];
      const accountId = s.accounts[0].id;
      s = addGoal(s, { name: 'Резерв', target: goal, dueDate: '' });
      s = allocateGoal(s, s.goals[0].id, accountId, goal);
      s = addDebt(s, { person: 'Payable', direction: 'payable', principal: debt, date: '2027-01-01', dueDate: '2028-01-06', note: '' }, '', false);
      s = addDebt(s, { person: 'Receivable', direction: 'receivable', principal: 999_999, date: '2027-01-01', dueDate: '2028-01-06', note: '' }, '', false);
      for (const [value, reserve, debtId] of [[reserved, true, undefined], [ordinary, false, undefined], [linkedReserved, true, s.debts[0].id], [linkedOrdinary, false, s.debts[0].id]] as const) {
        s = addPayment(s, { name: 'Оплата', amount: value, reserved: reserve, debtId, accountId, category: 'expense-0', date: '2028-01-05', status: 'planned' });
      }
      // Payments on payday and later must not reduce the days before payday.
      s = addPayment(s, { name: 'На зарплату', amount: 500_000, reserved: false, accountId, category: 'expense-0', date: '2028-01-15', status: 'planned' });
      s = daily.saveRecurring(s, { ...recurring(s), amount: weekly, frequency: 'weekly', startDate: '2028-01-01', nextDate: '2028-01-01' });
      s = daily.setNextIncome(s, '2028-01-15', '2028-01-01');
      const before = structuredClone(s), result = daily.paydayForecast(s, '2028-01-01');
      expect(result, `seed=0xF0AEC; case=${i}`).toMatchObject({ configured: true, days: 14, available: 1_000_000 - goal - reserved - linkedReserved, planned: ordinary + linkedOrdinary, recurring: weekly * 2, debts: debt - linkedReserved - linkedOrdinary, remaining: 1_000_000 - goal - reserved - ordinary - debt - weekly * 2, shortfall: 0 });
      expect(result.daily).toBe(Math.floor(result.remaining / 14));
      expect(s).toEqual(before);
    }
  });

  it('reports a shortfall without allowing a negative daily allowance', () => {
    let s = base(100);
    s = addPayment(s, { name: 'Платіж', amount: 150, accountId: s.accounts[0].id, category: 'expense-0', date: now, status: 'planned', reserved: false });
    s = daily.setNextIncome(s, '2028-02-01', now);
    // Three accounts contribute 300 cents, so the payment is affordable globally.
    expect(daily.paydayForecast(s, now)).toMatchObject({ remaining: 150, shortfall: 0, daily: 150 });
    s = addPayment(s, { name: 'Ще платіж', amount: 200, accountId: s.accounts[0].id, category: 'expense-0', date: now, status: 'planned', reserved: false });
    expect(daily.paydayForecast(s, now)).toMatchObject({ remaining: -50, shortfall: 50, daily: 0 });
  });

  it('does not treat an incoming receivable repayment as a future expense or guaranteed income', () => {
    let s = base(100_000);
    s.accounts = [s.accounts[0]];
    s = addDebt(s, { person: 'Боржник', direction: 'receivable', principal: 20_000, date: '2028-01-01', dueDate: now, note: '' }, '', false);
    s = addPayment(s, { name: 'Мені повернуть', amount: 10_000, accountId: s.accounts[0].id, category: 'Повернення боргу', date: now, status: 'planned', reserved: false, debtId: s.debts[0].id });
    s = daily.setNextIncome(s, '2028-02-01', now);
    expect(daily.paydayForecast(s, now)).toMatchObject({ available: 100_000, planned: 0, debts: 0, remaining: 100_000, daily: 100_000 });
  });

  it('snoozes payable and receivable reminders independently and removes fully repaid debts', () => {
    let s = base();
    for (const direction of ['payable', 'receivable'] as const) s = addDebt(s, { person: direction, direction, principal: 1_000, date: '2028-01-01', dueDate: '2028-01-30', note: '' }, '', false);
    const [payable, receivable] = s.debts;
    const before = structuredClone(s);
    s = daily.setDebtReminder(s, payable.id, payable.dueDate, '2028-02-03');
    expect(before.debts[0].remindOn).toBeUndefined();
    expect(daily.reminders(s, now).filter(r => r.kind === 'debt')).toEqual([expect.objectContaining({ id: receivable.id, amount: 1_000, direction: 'receivable' })]);
    s = repayDebt(s, receivable.id, s.accounts[0].id, 500, now);
    expect(daily.reminders(s, now).find(r => r.id === receivable.id)?.amount).toBe(500);
    s = repayDebt(s, receivable.id, s.accounts[0].id, 500, now);
    expect(daily.reminders(s, now)).toHaveLength(0);
    expect(daily.reminders(s, '2028-02-03')).toEqual([expect.objectContaining({ id: payable.id, amount: 1_000 })]);
    expect(s.debts[0].dueDate).toBe('2028-01-30');
  });

  it('does not confirm a paused, future or unaffordable recurring installment and preserves the schedule', () => {
    for (const input of [{ paused: true }, { nextDate: '2028-02-29' }, { amount: 5_000_001 }]) {
      const initial = base();
      const s = daily.saveRecurring(initial, { ...recurring(initial), ...input });
      const before = structuredClone(s);
      expect(() => daily.confirmRecurring(s, s.assistance!.recurring[0].id, now)).toThrow();
      expect(s).toEqual(before);
    }
  });

  it('advances one overdue installment per confirmation and rejects a repeat after catching up', () => {
    const initial = base();
    let s = daily.saveRecurring(initial, { ...recurring(initial), frequency: 'weekly', startDate: '2028-01-01', nextDate: '2028-01-01' });
    const id = s.assistance!.recurring[0].id;
    for (const expected of ['2028-01-08', '2028-01-15', '2028-01-22']) {
      const before = structuredClone(s);
      s = daily.confirmRecurring(s, id, '2028-01-15');
      expect(s.assistance!.recurring[0].nextDate).toBe(expected);
      expect(s.transactions).toHaveLength(before.transactions.length + 1);
      expect(s.payments).toHaveLength(before.payments.length + 1);
      expect(ledger(s)).toBe(ledger(before) - 100);
    }
    const before = structuredClone(s);
    expect(() => daily.confirmRecurring(s, id, '2028-01-15')).toThrow();
    expect(s).toEqual(before);
  });

  it('does not spend when the next recurring date would exceed the supported calendar', () => {
    const initial = base();
    const s = daily.saveRecurring(initial, { ...recurring(initial), frequency: 'yearly', startDate: '9999-12-31', nextDate: '9999-12-31' });
    const before = structuredClone(s);
    expect(() => daily.confirmRecurring(s, s.assistance!.recurring[0].id, '9999-12-31')).toThrow();
    expect(s).toEqual(before);
  });
});

describe('hostile assistance input and owner-bound undo', () => {
  it('updates and removes saved tools without duplicating ids or altering existing linked payments', () => {
    const initial = base();
    let s = daily.saveTemplate(initial, template(initial));
    const templateId = s.assistance!.templates[0].id;
    const beforeEdit = structuredClone(s);
    s = daily.saveTemplate(s, { ...template(s), name: 'Чай', amount: 0 }, templateId);
    expect(s.assistance!.templates).toHaveLength(1);
    expect(s.assistance!.templates[0]).toMatchObject({ id: templateId, name: 'Чай', amount: 0 });
    expect(beforeEdit.assistance!.templates[0].name).toBe('Кава ☕ <script>');
    s = daily.saveRecurring(s, recurring(s));
    const ruleId = s.assistance!.recurring[0].id;
    s = daily.confirmRecurring(s, ruleId, now);
    const paidSnapshot = structuredClone(s.payments), transactionSnapshot = structuredClone(s.transactions);
    s = daily.saveRecurring(s, { ...recurring(s), name: 'Новий тариф', amount: 500, nextDate: '2028-02-29' }, ruleId);
    expect(s.assistance!.recurring).toHaveLength(1);
    expect(s.assistance!.recurring[0]).toMatchObject({ id: ruleId, name: 'Новий тариф', amount: 500 });
    s = daily.toggleRecurring(s, ruleId);
    expect(s.assistance!.recurring[0].paused).toBe(true);
    s = daily.toggleRecurring(s, ruleId);
    expect(s.assistance!.recurring[0].paused).toBe(false);
    s = daily.removeRecurring(s, ruleId);
    s = daily.removeTemplate(s, templateId);
    expect(s.assistance!.templates).toHaveLength(0);
    expect(s.assistance!.recurring).toHaveLength(0);
    expect(s.payments).toEqual(paidSnapshot);
    expect(s.transactions).toEqual(transactionSnapshot);
    expect(ledger(s)).toBe(ledger(initial) - 100);
    assertLinks(s);
  });

  it('rejects 360 independently corrupted tool backups without mutating them (seed 0xBADDA7A)', () => {
    let valid = base();
    valid = daily.saveTemplate(valid, template(valid));
    valid = daily.saveRecurring(valid, recurring(valid));
    valid = addDebt(valid, { person: 'Друг', direction: 'payable', principal: 100, date: now, dueDate: now, note: '' }, '', false);
    const corruptions: Array<(s: FinanceState) => void> = [
      s => { s.assistance!.templates[0].amount = -1; },
      s => { s.assistance!.templates[0].amount = 0.5; },
      s => { s.assistance!.templates[0].amount = NaN; },
      s => { s.assistance!.templates[0].amount = Infinity; },
      s => { s.assistance!.templates[0].amount = 100_000_000_001; },
      s => { s.assistance!.templates[0].name = '\u0000'; },
      s => { s.assistance!.templates[0].name = ' '; },
      s => { s.assistance!.templates[0].name = 'a'.repeat(61); },
      s => { s.assistance!.templates[0].accountId = 'missing'; },
      s => { s.assistance!.templates[0].category = 'income-0'; },
      s => { s.assistance!.templates[0].kind = 'transfer' as QuickTemplate['kind']; },
      s => { s.assistance!.templates.push({ ...s.assistance!.templates[0] }); },
      s => { s.assistance!.recurring[0].amount = 0; },
      s => { s.assistance!.recurring[0].frequency = 'daily' as RecurringPayment['frequency']; },
      s => { s.assistance!.recurring[0].startDate = '2028-02-30'; },
      s => { s.assistance!.recurring[0].nextDate = '2027-12-31'; },
      s => { s.assistance!.recurring[0].nextDate = '2028-04-31'; },
      s => { s.assistance!.recurring[0].paused = 'false' as unknown as boolean; },
      s => { s.assistance!.recurring[0].accountId = 'missing'; },
      s => { s.assistance!.recurring[0].category = 'income-0'; },
      s => { s.assistance!.recurring.push({ ...s.assistance!.recurring[0] }); },
      s => { s.assistance!.nextIncomeDate = '2027-02-29'; },
      s => { s.debts[0].remindOn = '2028-02-30'; },
      s => { s.assistance = null as unknown as FinanceState['assistance']; },
      s => { s.assistance!.templates = {} as QuickTemplate[]; },
      s => { s.assistance!.recurring = 'bad' as unknown as RecurringPayment[]; },
      s => { s.assistance!.templates[0].note = {} as unknown as string; },
      s => { s.assistance!.templates[0].name = 123 as unknown as string; },
      s => { s.assistance!.templates[0].id = [] as unknown as string; },
      s => { s.assistance!.templates[0].amount = '100' as unknown as number; },
      s => { s.assistance!.templates[0].category = null as unknown as string; },
      s => { s.assistance!.recurring[0].amount = '100' as unknown as number; },
      s => { s.assistance!.recurring[0].startDate = {} as unknown as string; },
      s => { s.assistance!.recurring[0].nextDate = [] as unknown as string; },
      s => { s.assistance!.recurring[0].name = null as unknown as string; },
      s => { s.assistance!.nextIncomeDate = true as unknown as string; },
      s => { s.debts[0].remindOn = {} as unknown as string; },
      s => { Object.assign(s.assistance!, { unexpected: 'private data' }); },
      s => { s.assistance!.templates = Array.from({ length: 51 }, (_, i) => ({ ...s.assistance!.templates[0], id: `template-${i}` })); },
      s => { s.assistance!.recurring = Array.from({ length: 101 }, (_, i) => ({ ...s.assistance!.recurring[0], id: `rule-${i}` })); },
    ];
    const rng = random(0xBADDA7A);
    for (let i = 0; i < 360; i++) {
      const corrupted = structuredClone(valid);
      const index = i < corruptions.length ? i : Math.floor(rng() * corruptions.length);
      corruptions[index](corrupted);
      const before = structuredClone(corrupted);
      expect(() => restoreFinanceState(corrupted), `seed=0xBADDA7A; case=${i}; corruption=${index}`).toThrow();
      expect(corrupted).toEqual(before);
    }
  });

  it('rejects invalid dates, hidden names and wrong categories at mutation boundaries', () => {
    const s = base(), before = structuredClone(s);
    for (const name of ['', ' ', 'a'.repeat(61), '\u0000bad', '\u200bhidden']) {
      expect(() => daily.saveTemplate(s, { ...template(s), name })).toThrow();
      expect(() => daily.saveRecurring(s, { ...recurring(s), name })).toThrow();
    }
    for (const date of ['2028-02-30', '2027-02-29', '2100-02-29', '2028-13-01', '0000-01-01', '2028-1-1', 'bad']) {
      expect(() => daily.saveRecurring(s, { ...recurring(s), startDate: date, nextDate: date })).toThrow();
      expect(() => daily.setNextIncome(s, date, now)).toThrow();
    }
    expect(() => daily.saveTemplate(s, { ...template(s), category: 'income-0' })).toThrow();
    expect(() => daily.saveRecurring(s, { ...recurring(s), category: 'income-0' })).toThrow();
    expect(s).toEqual(before);
  });

  it('blocks using tools tied to archived accounts', () => {
    let s = base(0);
    s = daily.saveTemplate(s, { ...template(s), kind: 'income', category: 'income-0' });
    s = daily.saveRecurring(s, recurring(s));
    s.accounts[0].archived = true;
    const before = structuredClone(s);
    expect(() => daily.templateTransaction(s, s.assistance!.templates[0].id)).toThrow();
    expect(() => daily.confirmRecurring(s, s.assistance!.recurring[0].id, now)).toThrow();
    expect(() => daily.saveTemplate(s, template(s))).toThrow();
    expect(() => daily.saveRecurring(s, recurring(s))).toThrow();
    expect(s).toEqual(before);
  });

  it('undo clones full linked states and rejects cross-owner or newer assistance states over 100 cases (seed 0xA11D0)', () => {
    const rng = random(0xA11D0);
    for (let i = 0; i < 100; i++) {
      const original = base(), amount = 1 + Math.floor(rng() * 10_000);
      const before = daily.saveRecurring(original, { ...recurring(original), amount });
      const after = daily.confirmRecurring(before, before.assistance!.recurring[0].id, now);
      const savedBefore = structuredClone(before), savedAfter = structuredClone(after);
      const entry = undo.captureUndo(before, after, `owner-${i}`);
      before.accounts[0].name = 'Changed caller snapshot';
      after.assistance!.recurring[0].name = 'Changed caller snapshot';
      const restored = undo.undoState(savedAfter, entry, `owner-${i}`);
      expect(restored).toEqual(savedBefore);
      restored.accounts[0].name = 'Changed undo result';
      expect(undo.undoState(savedAfter, entry, `owner-${i}`)).toEqual(savedBefore);
      expect(() => undo.undoState(savedAfter, entry, `owner-${i + 1}`)).toThrow();
      expect(() => undo.undoState(after, entry, `owner-${i}`)).toThrow();
      expect(savedAfter.payments[0].status).toBe('paid');
      expect(savedBefore.payments).toHaveLength(0);
      expect(savedBefore.transactions).toHaveLength(0);
    }
  });
});
