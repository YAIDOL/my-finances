import { describe, expect, it, vi } from 'vitest';
import * as f from './finance';
import { normalizedCategoryName } from './categories';
import type { FinanceState, Transaction } from './types';

// UUIDs are deliberately not used to choose actions. A reported seed/step is replayable.
function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let n = Math.imul(value ^ value >>> 15, 1 | value);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
const date = '2026-10-06';
function setup() {
  let state = f.createEmptyState();
  for (const type of ['card', 'cash', 'savings'] as const) {
    state = f.addAccount(state, { name: type, type, initialBalance: 500_000, lastFour: '', color: 'navy' });
  }
  return state;
}
function assertInvariants(state: FinanceState) {
  const balance = new Map(state.accounts.map(a => [a.id, a.initialBalance]));
  for (const tx of state.transactions) {
    expect(Number.isSafeInteger(tx.amount)).toBe(true);
    expect(tx.amount).toBeGreaterThan(0);
    const sign = ['income', 'borrow', 'repay-receivable'].includes(tx.kind) ? 1 : -1;
    balance.set(tx.accountId, balance.get(tx.accountId)! + sign * tx.amount);
    if (tx.kind === 'transfer') balance.set(tx.toAccountId!, balance.get(tx.toAccountId!)! + tx.amount);
  }
  let totalReserved = 0;
  for (const account of state.accounts) {
    const goals = state.goals.flatMap(g => g.allocations).filter(a => a.accountId === account.id).reduce((sum, a) => sum + a.amount, 0);
    const planned = state.payments.filter(p => p.accountId === account.id && p.reserved && p.status === 'planned').reduce((sum, p) => sum + p.amount, 0);
    const expected = balance.get(account.id)!;
    expect(f.accountBalance(state, account.id)).toBe(expected);
    expect(f.accountReserved(state, account.id)).toBe(goals + planned);
    expect(f.accountAvailable(state, account.id)).toBe(expected - goals - planned);
    expect(Number.isSafeInteger(expected)).toBe(true);
    expect(expected).toBeGreaterThanOrEqual(0);
    expect(expected - goals - planned).toBeGreaterThanOrEqual(0);
    if (account.archived) expect(expected).toBe(0);
    totalReserved += goals + planned;
  }
  for (const goal of state.goals) {
    const saved = goal.allocations.reduce((sum, a) => sum + a.amount, 0);
    expect(f.goalSaved(goal)).toBe(saved);
    expect(saved).toBeLessThanOrEqual(goal.target);
    expect(new Set(goal.allocations.map(a => a.accountId)).size).toBe(goal.allocations.length);
    for (const allocation of goal.allocations) {
      expect(Number.isSafeInteger(allocation.amount)).toBe(true);
      expect(allocation.amount).toBeGreaterThanOrEqual(0);
    }
  }
  for (const debt of state.debts) {
    const repaid = state.transactions.filter(tx => tx.debtId === debt.id && tx.kind.startsWith('repay-')).reduce((sum, tx) => sum + tx.amount, 0);
    expect(f.debtRemaining(state, debt.id)).toBe(debt.principal - repaid);
    expect(debt.principal - repaid).toBeGreaterThanOrEqual(0);
  }
  for (const payment of state.payments) {
    const movements = state.transactions.filter(tx => tx.paymentId === payment.id);
    expect(movements).toHaveLength(payment.status === 'paid' ? 1 : 0);
    for (const tx of movements) {
      expect(tx.amount).toBe(payment.amount);
      expect(tx.accountId).toBe(payment.accountId);
      expect(tx.debtId).toBe(payment.debtId);
    }
  }
  const expectedBalance = [...balance.values()].reduce((sum, a) => sum + a, 0);
  for (const month of ['2026-10', '1990-01']) {
    const total = f.totals(state, month);
    expect(total.balance).toBe(expectedBalance);
    expect(total.available).toBe(expectedBalance - totalReserved);
    expect(total.saved + total.reserved).toBe(totalReserved);
    for (const kind of ['income', 'expense'] as const) {
      expect(total[kind]).toBe(state.transactions.filter(tx => tx.kind === kind && tx.date.startsWith(month)).reduce((sum, tx) => sum + tx.amount, 0));
    }
  }
  expect(f.restoreFinanceState(state)).toEqual(state);
}

describe('seeded finance transitions', () => {
  const operationNames = ['income', 'expense', 'transfer', 'edit', 'delete', 'addGoal', 'allocate', 'release', 'addDebt', 'repay', 'addPayment', 'pay', 'cancel', 'archive', 'reactivate', 'addAccount', 'addCategory', 'editCategory'] as const;
  it.each(Array.from({ length: 20 }, (_, i) => 0xBADC0DE + i * 7919))('preserves money, links and source state over 200 actions (seed %i)', seed => {
    const rng = random(seed);
    const pick = <T,>(values: readonly T[]): T | undefined => values[Math.floor(rng() * values.length)];
    let state = setup();
    const history: string[] = [];
    const attempts = new Set<string>();
    for (let step = 0; step < 200; step++) {
      const operation = operationNames[(step + Math.floor(rng() * operationNames.length)) % operationNames.length];
      attempts.add(operation);
      const acct = pick(state.accounts)?.id ?? 'missing';
      const goal = pick(state.goals);
      const debt = pick(state.debts);
      const payment = pick(state.payments);
      const tx = pick(state.transactions);
      const value = pick([1, 100, 999, 10_000, 90_001, 800_000, 0, -1, 0.5, NaN, Infinity])!;
      const snapshot = structuredClone(state);
      const beforeTotal = f.totals(state, '2026-10').balance;
      const destination = pick(state.accounts)?.id;
      const input = { kind: operation === 'income' ? 'income' : operation === 'transfer' ? 'transfer' : 'expense', amount: value, accountId: acct, toAccountId: operation === 'transfer' ? destination : undefined, paymentMethod: rng() < 0.5 ? pick(['cash', 'card', 'savings'] as const) : undefined, category: pick(f.categoryOptions(state, operation === 'income' ? 'income' : 'expense'))?.value ?? '', note: '', date } as Omit<Transaction, 'id'>;
      history.push(`${step}:${operation}(${value})`);
      let next: FinanceState | undefined;
      let rejection: unknown;
      try {
        switch (operation) {
          case 'income': case 'expense': case 'transfer': next = f.addTransaction(state, input); break;
          case 'edit': next = f.updateTransaction(state, tx?.id ?? 'missing', input); break;
          case 'delete': next = f.removeTransaction(state, tx?.id ?? 'missing'); break;
          case 'addGoal': next = f.addGoal(state, { name: `Goal ${step}`, target: value, dueDate: '' }); break;
          case 'allocate': next = f.allocateGoal(state, goal?.id ?? 'missing', acct, value); break;
          case 'release': next = f.releaseGoal(state, goal?.id ?? 'missing', acct, value); break;
          case 'addDebt': next = f.addDebt(state, { person: `Person ${step}`, direction: rng() < 0.5 ? 'payable' : 'receivable', principal: value, date, dueDate: '', note: '' }, acct, rng() < 0.5); break;
          case 'repay': next = f.repayDebt(state, debt?.id ?? 'missing', acct, value, date); break;
          case 'addPayment': next = f.addPayment(state, { name: `Payment ${step}`, amount: value, accountId: acct, category: 'Продукти', date, status: 'planned', reserved: rng() < 0.5, debtId: rng() < 0.3 ? debt?.id : undefined }); break;
          case 'pay': next = f.payPayment(state, payment?.id ?? 'missing'); break;
          case 'cancel': next = f.cancelPayment(state, payment?.id ?? 'missing'); break;
          case 'archive': next = f.archiveAccount(state, acct); break;
          case 'reactivate': next = f.reactivateAccount(state, acct); break;
          case 'addAccount': next = f.addAccount(state, { name: `Account ${step}`, type: 'card', initialBalance: rng() < 0.5 ? 0 : value, lastFour: '', color: 'steel' }); break;
          case 'addCategory': next = f.addCategory(state, { name: rng() < 0.25 ? 'Продукти' : `Category ${step}`, kind: rng() < 0.5 ? 'expense' : 'income', color: pick(['#123456', '#AABBCC', 'navy', '#fff'])! }); break;
          case 'editCategory': next = f.updateCategory(state, pick(state.categories)?.id ?? 'missing', { name: `Renamed ${step}`, color: pick(['#123456', '#AABBCC', 'navy', '#fff'])! }); break;
        }
      } catch (error) { rejection = error; }
      try {
        expect(state).toEqual(snapshot);
        if (rejection) expect(rejection).toBeInstanceOf(Error);
        if (next) {
          if (operation === 'transfer' || ['addGoal', 'allocate', 'release', 'addPayment', 'cancel', 'archive', 'reactivate', 'addCategory', 'editCategory'].includes(operation)) expect(f.totals(next, '2026-10').balance).toBe(beforeTotal);
          if (operation === 'edit') expect(next.transactions.find(t => t.id === tx?.id)?.id).toBe(tx?.id);
          state = next;
          assertInvariants(state);
        }
      } catch (error) {
        throw new Error(`seed=${seed}; step=${step}; recent=${history.slice(-12).join(' -> ')}`, { cause: error });
      }
    }
    expect(attempts.size).toBe(operationNames.length);
  });

  it('round-trips 2,000 randomized amounts without floating point rounding', () => {
    const rng = random(0xC0FFEE);
    for (let i = 0; i < 2_000; i++) {
      const cents = Math.floor(rng() * 100_000_000_000) + 1;
      const whole = Math.floor(cents / 100);
      const fraction = String(cents % 100).padStart(2, '0');
      for (const input of [`${whole}.${fraction}`, ` ${whole.toLocaleString('uk-UA')},${fraction} `]) expect(f.parseMoney(input)).toBe(cents);
      expect(f.money(cents)).toEqual(expect.any(String));
    }
  });

  it('uses Kyiv dates across UTC month and year boundaries and creates unique ids', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-12-31T22:15:00Z'));
      expect(f.today()).toBe('2027-01-01');
      expect(f.currentMonth()).toBe('2027-01');
      vi.setSystemTime(new Date('2026-06-30T21:15:00Z'));
      expect(f.today()).toBe('2026-07-01');
    } finally { vi.useRealTimers(); }
    const ids = Array.from({ length: 1_000 }, () => f.uid());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))).toBe(true);
  });

  it('enforces real calendar dates at mutation and backup boundaries', () => {
    const state = setup();
    for (const invalid of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-00-10', '2026-13-01', '2026-01-00', '2026-99-99', '2026-1-1', 'not-a-date']) {
      const before = structuredClone(state);
      expect(() => f.addTransaction(state, { kind: 'income', amount: 1, accountId: state.accounts[0].id, category: 'Зарплата', note: '', date: invalid })).toThrow();
      expect(() => f.addGoal(state, { name: 'Goal', target: 1, dueDate: invalid })).toThrow();
      expect(() => f.addDebt(state, { person: 'Person', direction: 'payable', principal: 1, date: invalid, dueDate: '', note: '' }, '', false)).toThrow();
      expect(() => f.addPayment(state, { name: 'Payment', amount: 1, accountId: state.accounts[0].id, category: 'Продукти', date: invalid, reserved: false, status: 'planned' })).toThrow();
      const backup = structuredClone(state);
      backup.transactions.push({ id: 'date-invalid', kind: 'income', amount: 1, accountId: state.accounts[0].id, category: 'Зарплата', note: '', date: invalid });
      expect(() => f.restoreFinanceState(backup)).toThrow();
      expect(state).toEqual(before);
    }
    expect(() => f.addTransaction(state, { kind: 'income', amount: 1, accountId: state.accounts[0].id, category: 'Зарплата', note: '', date: '2028-02-29' })).not.toThrow();
  });

  it('rejects every payment method/account mismatch without moving funds', () => {
    const state = setup();
    for (const account of state.accounts) for (const method of ['cash', 'card', 'savings'] as const) {
      const input = { kind: 'expense' as const, amount: 100, accountId: account.id, paymentMethod: method, category: 'Продукти', note: '', date };
      const before = structuredClone(state);
      if (account.type === method) expect(f.accountBalance(f.addTransaction(state, input), account.id)).toBe(499_900);
      else expect(() => f.addTransaction(state, input)).toThrow();
      expect(state).toEqual(before);
    }
  });

  it('provides independent default categories and isolated custom category references', () => {
    const first = f.createEmptyState();
    const second = f.createEmptyState();
    first.categories[0].name = 'Changed locally';
    expect(second.categories[0].name).toBe('Продукти');
    expect(f.defaultCategories()).toEqual(second.categories);
    let state = f.addCategory(setup(), { name: '  Project   food  ', kind: 'expense', color: '#AbCdEf' });
    const category = state.categories.at(-1)!;
    expect(category.name).toBe('Project food');
    expect(category.color).toBe('#abcdef');
    expect(f.findCategory(state, category.id, 'expense')).toEqual(category);
    expect(f.findCategory(state, category.id, 'income')).toBeUndefined();
    expect(f.categoryOptions(state, 'expense')).toContainEqual({ value: category.id, label: category.name });
    expect(f.categoryOptions(state, 'income').some(c => c.value === category.id)).toBe(false);
    expect(second.categories.some(c => c.id === category.id)).toBe(false);
    state = f.addTransaction(state, { kind: 'expense', amount: 100, accountId: state.accounts[0].id, category: category.id, note: '', date });
    state = f.updateCategory(state, category.id, { name: 'Project meals', color: '#123456' });
    expect(state.transactions[0].category).toBe(category.id);
    expect(f.categoryName(state, category.id)).toBe('Project meals');
    expect(f.categoryColor(state, category.id)).toBe('#123456');
    expect(f.categoryName(state, 'missing')).toBe('missing');
    expect(f.categoryColor(state, 'missing')).toBe('#8d96a7');
    expect(() => f.addTransaction(state, { kind: 'income', amount: 100, accountId: state.accounts[0].id, category: category.id, note: '', date })).toThrow();
    const otherUser = setup();
    expect(() => f.addTransaction(otherUser, { kind: 'expense', amount: 100, accountId: otherUser.accounts[0].id, category: category.id, note: '', date })).toThrow();
    assertInvariants(state);
  });

  it('rejects normalized duplicate category names and malformed category metadata', () => {
    const state = setup();
    const before = structuredClone(state);
    for (const name of ['Продукти', '  ПРОДУКТИ  ', 'продукти']) expect(() => f.addCategory(state, { name, kind: 'expense', color: '#123456' })).toThrow();
    for (const name of ['', ' ', 'a'.repeat(61), 'Bad\u0000', 'Hidden\u200b']) expect(() => f.addCategory(state, { name, kind: 'expense', color: '#123456' })).toThrow();
    for (const color of ['red', '#fff', '#12345g', '#12345678', '', 'url(test)']) expect(() => f.addCategory(state, { name: 'New', kind: 'expense', color })).toThrow();
    expect(() => f.updateCategory(state, 'missing', { name: 'New', color: '#123456' })).toThrow();
    const sameNameAcrossKinds = f.addCategory(state, { name: 'Продукти', kind: 'income', color: '#123456' });
    expect(f.categoryOptions(sameNameAcrossKinds, 'income')).toContainEqual({ value: sameNameAcrossKinds.categories.at(-1)!.id, label: 'Продукти' });
    expect(state).toEqual(before);
    expect(normalizedCategoryName('  ＦＯＯ   Bar  ')).toBe('foo bar');
    expect(normalizedCategoryName('  ПРОДУКТИ  ')).toBe('продукти');
    expect(normalizedCategoryName(normalizedCategoryName(' Mixed   Case '))).toBe('mixed case');
  });

  it('migrates legacy category names once and keeps their references stable', () => {
    const state = setup();
    const { categories: _categories, ...legacy } = state;
    legacy.transactions.push({ id: 'legacy-expense', kind: 'expense', amount: 100, accountId: state.accounts[0].id, category: 'Продукти', note: '', date });
    legacy.transactions.push({ id: 'legacy-income', kind: 'income', amount: 100, accountId: state.accounts[0].id, category: 'Зарплата', note: '', date });
    legacy.budgets.push({ id: 'legacy-budget', category: 'Продукти', month: '2026-10', limit: 100 });
    legacy.payments.push({ id: 'legacy-payment', name: 'Planned', amount: 100, accountId: state.accounts[0].id, category: 'Продукти', date, status: 'planned', reserved: false });
    const before = structuredClone(legacy);
    const migrated = f.restoreFinanceState(legacy);
    for (const tx of migrated.transactions) expect(f.findCategory(migrated, tx.category, tx.kind as 'income' | 'expense')?.id).toBe(tx.category);
    expect(migrated.budgets[0].category).toBe(f.findCategory(migrated, 'Продукти', 'expense')?.id);
    expect(migrated.payments[0].category).toBe(migrated.budgets[0].category);
    expect(f.restoreFinanceState(migrated)).toEqual(migrated);
    expect(legacy).toEqual(before);
  });

  it('deduplicates equivalent legacy custom category names during migration', () => {
    const { categories: _categories, ...legacy } = setup();
    for (const [i, category] of ['Future trips', '  FUTURE   trips  ', 'Future trips'].entries()) {
      legacy.transactions.push({ id: `legacy-custom-${i}`, kind: 'expense', amount: 1, accountId: legacy.accounts[0].id, category, note: '', date });
    }
    const migrated = f.restoreFinanceState(legacy);
    expect(new Set(migrated.transactions.map(tx => tx.category)).size).toBe(1);
    expect(f.restoreFinanceState(migrated)).toEqual(migrated);
  });

  it('enforces the 200-category cap without affecting another user state', () => {
    let state = f.createEmptyState();
    const other = f.createEmptyState();
    while (state.categories.length < 200) state = f.addCategory(state, { name: `Custom ${state.categories.length}`, kind: 'expense', color: '#123456' });
    const before = structuredClone(state);
    expect(() => f.addCategory(state, { name: 'Overflow', kind: 'expense', color: '#123456' })).toThrow();
    expect(state).toEqual(before);
    expect(other.categories).toEqual(f.defaultCategories());
    expect(f.restoreFinanceState(state)).toEqual(state);
  });

  it('rejects inconsistent debt, payment and category references in hostile backups', () => {
    let state = setup();
    state = f.addDebt(state, { person: 'Person', direction: 'payable', principal: 100, date, dueDate: '', note: '' }, state.accounts[0].id, true);
    state = f.addPayment(state, { name: 'Repayment', amount: 50, accountId: state.accounts[0].id, category: 'Повернення боргу', date, status: 'planned', reserved: true, debtId: state.debts[0].id });
    state = f.payPayment(state, state.payments[0].id);
    const corruptions: ((s: FinanceState) => void)[] = [
      s => { s.payments[0].amount++; },
      s => { s.payments[0].accountId = s.accounts[1].id; },
      s => { s.payments[0].status = 'planned'; },
      s => { s.transactions[0].paymentId = 'missing'; },
      s => { s.transactions[0].debtId = 'missing'; },
      s => { s.transactions[0].amount = 101; },
      s => { s.debts[0].direction = 'receivable'; },
      s => { s.transactions.push({ ...s.transactions[0], id: 'duplicate-repayment' }); s.transactions.at(-1)!.amount = 100; },
      s => { s.categories.push({ ...s.categories[0] }); },
      s => { s.categories.push({ ...s.categories[0], id: 'duplicate-name', name: '  ПРОДУКТИ  ' }); },
      s => { s.categories[0].color = 'red'; },
      s => { s.transactions[0].paymentMethod = 'cash'; },
      s => { s.accounts[0].archived = true; },
      s => { s.transactions.push({ ...s.transactions[1], id: 'duplicate-loan' }); },
    ];
    for (const corrupt of corruptions) {
      const backup = structuredClone(state);
      corrupt(backup);
      const before = structuredClone(backup);
      expect(() => f.restoreFinanceState(backup)).toThrow();
      expect(backup).toEqual(before);
    }
  });

  it('rejects a paid expense whose category differs from its linked planned payment', () => {
    let state = setup();
    state = f.addPayment(state, { name: 'Groceries', amount: 100, accountId: state.accounts[0].id, category: 'Продукти', date, status: 'planned', reserved: false });
    state = f.payPayment(state, state.payments[0].id);
    const corrupt = structuredClone(state);
    corrupt.payments[0].category = f.findCategory(corrupt, 'Житло', 'expense')!.id;
    const before = structuredClone(corrupt);
    expect(() => f.restoreFinanceState(corrupt)).toThrow();
    expect(corrupt).toEqual(before);
  });

  it('rejects malformed money and accepts zero only when explicitly allowed', () => {
    for (const input of ['', ' ', '-1', '+1', '1e3', 'NaN', 'Infinity', '1.001', '.99', '1.', '1,2,3', '1000000000.01', '9007199254740991']) expect(() => f.parseMoney(input)).toThrow();
    expect(() => f.parseMoney('0')).toThrow();
    expect(f.parseMoney('0,00', true)).toBe(0);
    expect(f.money(123456).replace(/\s/g, '')).toBe('1234,56₴');
    expect(f.money(100).replace(/\s/g, '')).toBe('1₴');
    expect(f.money(1).replace(/\s/g, '')).toBe('0,01₴');
  });

  it('keeps payable and receivable debt repayments outside income/expense totals', () => {
    for (const direction of ['payable', 'receivable'] as const) {
      let state = setup();
      const accountId = state.accounts[0].id;
      state = f.addDebt(state, { person: 'Person', direction, principal: 100_000, date, dueDate: '', note: '' }, accountId, true);
      const debtId = state.debts[0].id;
      expect(f.accountBalance(state, accountId)).toBe(direction === 'payable' ? 600_000 : 400_000);
      state = f.repayDebt(state, debtId, accountId, 30_001, date);
      expect(f.debtRemaining(state, debtId)).toBe(69_999);
      const before = structuredClone(state);
      expect(() => f.repayDebt(state, debtId, accountId, 70_000, date)).toThrow();
      expect(state).toEqual(before);
      state = f.repayDebt(state, debtId, accountId, 69_999, date);
      expect(f.debtRemaining(state, debtId)).toBe(0);
      expect(f.accountBalance(state, accountId)).toBe(500_000);
      expect(f.totals(state, '2026-10').income).toBe(0);
      expect(f.totals(state, '2026-10').expense).toBe(0);
      expect(() => f.repayDebt(state, debtId, accountId, 1, date)).toThrow();
      state = f.removeTransaction(state, state.transactions[0].id);
      expect(f.debtRemaining(state, debtId)).toBe(69_999);
      assertInvariants(state);
    }
  });

  it('settles, reverses and cancels reserved payments without double spending', () => {
    for (const reserved of [true, false]) {
      let state = setup();
      const accountId = state.accounts[0].id;
      state = f.addPayment(state, { name: 'Rent', amount: 100_000, accountId, category: 'Житло', date, reserved, status: 'planned' });
      const id = state.payments[0].id;
      expect(f.accountAvailable(state, accountId)).toBe(reserved ? 400_000 : 500_000);
      state = f.payPayment(state, id);
      expect(f.accountAvailable(state, accountId)).toBe(400_000);
      expect(f.accountReserved(state, accountId)).toBe(0);
      const before = structuredClone(state);
      expect(() => f.payPayment(state, id)).toThrow();
      expect(() => f.cancelPayment(state, id)).toThrow();
      expect(() => f.updateTransaction(state, state.transactions[0].id, { ...state.transactions[0], amount: 1 })).toThrow();
      expect(state).toEqual(before);
      state = f.removeTransaction(state, state.transactions[0].id);
      expect(state.payments[0].status).toBe('planned');
      expect(f.accountAvailable(state, accountId)).toBe(reserved ? 400_000 : 500_000);
      state = f.cancelPayment(state, id);
      expect(f.accountAvailable(state, accountId)).toBe(500_000);
      assertInvariants(state);
    }
  });

  it('restores a demo state and treats unknown financial references as zero', () => {
    const state = f.restoreFinanceState(f.createDemoState());
    assertInvariants(state);
    expect(f.accountBalance(state, 'missing')).toBe(0);
    expect(f.accountReserved(state, 'missing')).toBe(0);
    expect(f.accountAvailable(state, 'missing')).toBe(0);
    expect(f.debtRemaining(state, 'missing')).toBe(0);
  });

  it('keeps cash, transfers and archive/reversal transitions consistent', () => {
    let state = setup();
    const [source, destination] = state.accounts;
    const input = { kind: 'transfer' as const, amount: 500_000, accountId: source.id, toAccountId: destination.id, category: '', note: '', date };
    const before = structuredClone(state);
    state = f.addTransaction(state, input);
    state = f.archiveAccount(state, source.id);
    expect(() => f.removeTransaction(state, state.transactions[0].id)).toThrow();
    state = f.reactivateAccount(state, source.id);
    state = f.removeTransaction(state, state.transactions[0].id);
    expect(state.accounts).toEqual(before.accounts.map(a => a.id === source.id ? { ...a, archived: false } : a));
    assertInvariants(state);
  });

  it('keeps a planned debt payment valid when its original loan is deleted', () => {
    let state = setup();
    state = f.addDebt(state, { person: 'Person', direction: 'payable', principal: 100, date, dueDate: '', note: '' }, state.accounts[0].id, true);
    state = f.addPayment(state, { name: 'Repayment', amount: 100, accountId: state.accounts[0].id, category: 'Повернення боргу', date, status: 'planned', reserved: false, debtId: state.debts[0].id });
    const before = structuredClone(state);
    let next: FinanceState | undefined;
    try { next = f.removeTransaction(state, state.transactions[0].id); } catch { /* A domain rejection is safe. */ }
    expect(state).toEqual(before);
    if (next) assertInvariants(next);
  });

  it('rejects 500 corrupt backups without changing the supplied object', () => {
    const rng = random(0xFACE);
    for (let i = 0; i < 500; i++) {
      const state = setup();
      switch (Math.floor(rng() * 5)) {
        case 0: state.accounts[0].initialBalance = pickInvalid(rng); break;
        case 1: state.accounts.push({ ...state.accounts[0] }); break;
        case 2: state.transactions.push({ id: 'invalid', kind: 'expense', amount: 1, accountId: 'missing', category: 'Продукти', note: '', date }); break;
        case 3: state.goals.push({ id: 'invalid', name: 'Goal', target: 1, dueDate: '', allocations: [{ accountId: state.accounts[0].id, amount: 2 }] }); break;
        case 4: state.payments.push({ id: 'invalid', name: 'Payment', amount: 900_000, accountId: state.accounts[0].id, category: 'Продукти', date, reserved: true, status: 'planned' }); break;
      }
      const before = structuredClone(state);
      expect(() => f.restoreFinanceState(state)).toThrow();
      expect(state).toEqual(before);
    }
  });
});
function pickInvalid(rng: () => number) { return [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER][Math.floor(rng() * 5)]; }
