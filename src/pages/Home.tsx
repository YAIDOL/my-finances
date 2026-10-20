import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { motion } from 'motion/react';
import { BudgetWarnings } from '../components/BudgetWarnings';
import { DailySummary } from '../components/DailyWidgets';
import { CashAccount } from '../components/CashAccount';
import { WalletScene } from '../components/WalletScene';
import { Amount, Empty, LinkButton, Progress, Shield, TransactionRow, Modal, type ViewProps } from '../components/ui';
import { accountBalance, currentMonth, goalSaved, totals } from '../lib/finance';

export function Home(props: ViewProps) {
  const { state, hide, navigate } = props;
  const [index, setIndex] = useState(0), [details, setDetails] = useState(false);
  const accounts = state.accounts.filter(account => !account.archived);
  const account = accounts[index % Math.max(1, accounts.length)];
  const total = totals(state, currentMonth());
  const goal = state.goals.find(item => item.featured) || state.goals[0];
  const month = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric', timeZone: 'Europe/Kyiv' }).format(new Date());

  return <>
    <section className="hero finance-overview">
      <div className="hero-copy">
        <div className="eyebrow"><span className="tiny-line"/>Огляд · {month}</div>
        <h1>Твої фінанси у балансі.</h1>
        <button className="balance-button" onClick={() => setDetails(true)}>
          <span>Загальний баланс</span><Amount value={total.balance} hide={hide}/>
          <small>Переглянути розподіл <ChevronRight size={14}/></small>
        </button>
        <div className="hero-stats">
          <div><span><ArrowDownLeft size={15}/>Надійшло за місяць</span><Amount value={total.income} hide={hide} className="positive"/></div>
          <div><span><ArrowUpRight size={15}/>Витрачено за місяць</span><Amount value={total.expense} hide={hide} className="negative"/></div>
        </div>
        <button className="button secondary" onClick={() => navigate('transactions')}>Переглянути операції <ChevronRight size={17}/></button>
      </div>
      <WalletScene/>
    </section>

    <section className="home-grid" aria-label="Рахунки, останні записи та ціль">
      <div className="panel account-panel">
        <div className="panel-heading"><h2>Мої рахунки</h2><div className="carousel-controls">
          <button className="icon-button" aria-label="Попередній рахунок" disabled={accounts.length < 2} onClick={() => setIndex((index + accounts.length - 1) % accounts.length)}><ChevronLeft size={18}/></button>
          <button className="icon-button" aria-label="Наступний рахунок" disabled={accounts.length < 2} onClick={() => setIndex((index + 1) % accounts.length)}><ChevronRight size={18}/></button>
        </div></div>
        {account ? <>
          <div className={account.type === 'cash' ? 'cash-preview' : 'card-stack'}>
            {account.type !== 'cash' && <div className="card-shadow"/>}
            <motion.button key={account.id} className={account.type === 'cash' ? 'cash-account-button' : 'bank-card ' + account.color}
              initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .2, ease: 'easeOut' }} onClick={() => navigate('accounts')}>
              {account.type === 'cash' ? <CashAccount name={account.name} balance={accountBalance(state, account.id)} hide={hide} color={account.color}/> : <>
                <span>{account.name}</span><div className="card-middle"><Amount value={accountBalance(state, account.id)} hide={hide}/>{account.type === 'card' && <div className="chip"/>}</div>
                <small>{account.lastFour ? '•••• ' + account.lastFour : account.type === 'card' ? 'Банківська картка' : 'Ощадний рахунок'}</small><span className="card-currency">UAH</span>
              </>}
            </motion.button>
          </div>
          <div className="account-chips">{accounts.filter(item => item.id !== account.id).slice(0, 2).map(item => <button key={item.id} onClick={() => setIndex(accounts.indexOf(item))}>
            <span title={item.name}>{item.name}</span><Amount value={accountBalance(state, item.id)} hide={hide}/>
          </button>)}</div>
        </> : <Empty title="Створи перший рахунок" description="Вкажи, скільки грошей уже є на картці чи готівкою." action={<button className="button secondary" onClick={() => navigate('accounts')}><Plus size={16}/>Створити рахунок</button>}/>}
      </div>
      <div className="panel recent-panel">
        <div className="panel-heading"><h2>Останні записи</h2><LinkButton onClick={() => navigate('transactions')}>Усі записи</LinkButton></div>
        {state.transactions.length ? state.transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2).map(transaction => <TransactionRow key={transaction.id} tx={transaction} state={state} hide={hide}/>) : <Empty title="Почни з першого запису" description="Додавай витрати й надходження кнопкою «+»."/>}
      </div>
      <div className="panel goal-panel">
        <div className="panel-heading"><h2>Моя ціль</h2><LinkButton onClick={() => navigate('goals')}>Усі цілі</LinkButton></div>
        {goal ? <>
          <div className="goal-home-title"><h3>{goal.name}</h3><Shield/></div>
          <Progress value={goalSaved(goal) / goal.target * 100}/>
          <div className="progress-caption">{Math.round(goalSaved(goal) / goal.target * 100)}% накопичено</div>
          <button className="button secondary full" onClick={() => navigate('goals')}><Plus size={18}/>Поповнити ціль</button>
        </> : <Empty title="На що хочеш відкласти?" description="Створи ціль і рухайся до неї." action={<button className="button secondary" onClick={() => navigate('goals')}>Створити ціль</button>}/>}
      </div>
    </section>
    <div className="home-support"><DailySummary {...props}/><BudgetWarnings state={state} hide={hide} navigate={navigate}/></div>
    <Modal open={details} onClose={() => setDetails(false)} title="Розподіл грошей">
      <div className="balance-breakdown">{[['Загальний баланс', total.balance], ['Відкладено на цілі', total.saved], ['Резерв на платежі', total.reserved], ['Доступно для витрат', total.available]].map(([label, value]) => <div key={label as string}><span>{label}</span><Amount value={value as number} hide={hide}/></div>)}</div>
      <p className="form-description">Відкладені кошти залишаються частиною балансу, але не доступні для звичайних витрат.</p>
    </Modal>
  </>;
}
