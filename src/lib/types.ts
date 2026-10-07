export type TransactionKind = 'income' | 'expense' | 'transfer' | 'borrow' | 'lend' | 'repay-payable' | 'repay-receivable' | 'adjustment-increase' | 'adjustment-decrease';
export type Theme = 'dark' | 'light' | 'system';
export interface Account { id: string; name: string; type: 'card' | 'cash' | 'savings'; initialBalance: number; lastFour: string; color: string; archived?: boolean }
export type PaymentMethod = Account['type'];
export interface Category { id: string; name: string; kind: 'expense' | 'income'; color: string }
export interface ExpensePart { category: string; amount: number }
export interface IncomeDistribution { date: string; sourceAmount: number; items: {kind:'goal'|'payment'|'debt';name:string;amount:number}[]; daily: number }
export interface Transaction { id: string; kind: TransactionKind; amount: number; accountId: string; toAccountId?: string; paymentMethod?: PaymentMethod; category: string; note: string; date: string; debtId?: string; paymentId?: string; splits?: ExpensePart[]; distribution?: IncomeDistribution }
export interface Allocation { accountId: string; amount: number }
export interface GoalMovement { id:string; accountId:string; amount:number; date:string; direction:'save'|'release' }
export interface Goal { id: string; name: string; target: number; dueDate: string; allocations: Allocation[]; featured?: boolean; history?: GoalMovement[] }
export interface Debt { id: string; person: string; direction: 'payable' | 'receivable'; principal: number; date: string; dueDate: string; note: string; remindOn?: string }
export interface Payment { id: string; name: string; amount: number; accountId: string; category: string; date: string; status: 'planned' | 'paid'; reserved: boolean; debtId?: string }
export interface Budget { id: string; category: string; month: string; limit: number }
export interface QuickTemplate { id: string; name: string; kind: 'expense' | 'income'; accountId: string; category: string; amount: number; note: string }
export interface RecurringPayment { id: string; name: string; amount: number; accountId: string; category: string; frequency: 'weekly' | 'monthly' | 'yearly'; startDate: string; nextDate: string; paused: boolean }
export interface Assistance { templates: QuickTemplate[]; recurring: RecurringPayment[]; nextIncomeDate: string }
export interface FinanceState { accounts: Account[]; transactions: Transaction[]; goals: Goal[]; debts: Debt[]; payments: Payment[]; budgets: Budget[]; categories: Category[]; assistance?: Assistance; formatVersion?: 2 }
export interface Preferences { theme: Theme; reducedMotion: boolean; hideAmounts: boolean }
export type Page = 'home' | 'accounts' | 'transactions' | 'goals' | 'debts' | 'budget' | 'analytics' | 'categories' | 'settings' | 'tools';
