export type TransactionKind = 'income' | 'expense' | 'transfer' | 'borrow' | 'lend' | 'repay-payable' | 'repay-receivable';
export type Theme = 'dark' | 'light' | 'system';
export interface Account { id: string; name: string; type: 'card' | 'cash' | 'savings'; initialBalance: number; lastFour: string; color: string; archived?: boolean }
export interface Transaction { id: string; kind: TransactionKind; amount: number; accountId: string; toAccountId?: string; category: string; note: string; date: string; debtId?: string; paymentId?: string }
export interface Allocation { accountId: string; amount: number }
export interface Goal { id: string; name: string; target: number; dueDate: string; allocations: Allocation[]; featured?: boolean }
export interface Debt { id: string; person: string; direction: 'payable' | 'receivable'; principal: number; date: string; dueDate: string; note: string }
export interface Payment { id: string; name: string; amount: number; accountId: string; category: string; date: string; status: 'planned' | 'paid'; reserved: boolean; debtId?: string }
export interface Budget { id: string; category: string; month: string; limit: number }
export interface FinanceState { accounts: Account[]; transactions: Transaction[]; goals: Goal[]; debts: Debt[]; payments: Payment[]; budgets: Budget[] }
export interface Preferences { theme: Theme; reducedMotion: boolean; hideAmounts: boolean }
export type Page = 'home' | 'accounts' | 'transactions' | 'goals' | 'debts' | 'budget' | 'analytics' | 'settings';
