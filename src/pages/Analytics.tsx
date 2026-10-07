import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Scale } from 'lucide-react';
import { Amount, Empty, PageTitle, Progress, type ViewProps } from '../components/ui';
import { categoryName, currentMonth } from '../lib/finance';
import { categoryTotals, monthlySummary, type MonthlySummary } from '../lib/reporting';
import '../reporting.css';
import { validDate } from '../lib/dates';
export function Analytics({state,hide}:ViewProps){
 const [month,setMonth]=useState(currentMonth()),total=monthlySummary(state,month);
 const groups=(kind:'expense'|'income')=>{const amounts=categoryTotals(state,month,kind);return state.categories.filter(c=>c.kind===kind).map(category=>({...category,amount:amounts[category.id]||0})).filter(g=>g.amount>0).sort((a,b)=>b.amount-a.amount);};
 return <><PageTitle title="Аналітика" description="Зрозумій свої звички та рух грошей за вибраний місяць." action={<input type="month" min="0001-01" max="9999-12" aria-label="Місяць аналітики" value={month} onChange={e=>{if(validDate(e.target.value+'-01'))setMonth(e.target.value);}}/>}/><div className="analytics-stats">{[{label:'Надходження',value:total.income,Icon:ArrowDownLeft,color:'positive'},{label:'Витрати',value:total.expense,Icon:ArrowUpRight,color:'negative'},{label:'Різниця',value:total.income-total.expense,Icon:Scale,color:''}].map(x=><div className="panel stat" key={x.label}><x.Icon size={23} className={x.color}/><span>{x.label}</span><Amount value={x.value} hide={hide} className={x.color}/></div>)}</div><MonthlyStory state={state} hide={hide} summary={total}/><div className="budget-layout">{[{title:'Категорії витрат',groups:groups('expense'),total:total.expense},{title:'Джерела доходу',groups:groups('income'),total:total.income}].map(x=><section className="panel" key={x.title}><div className="panel-heading"><h2>{x.title}</h2></div>{x.groups.length?x.groups.map(g=><div className="analysis-row" key={g.id}><div className="flex-between"><span className="category-label"><span className="category-dot" style={{background:g.color}}/>{g.name}</span><Amount value={g.amount} hide={hide}/></div><Progress value={g.amount/x.total*100} color={g.color}/><small>{Math.round(g.amount/x.total*100)}% від загальної суми</small></div>):<Empty title="Ще немає даних" description="Додай операції або обери інший місяць."/>}</section>)}</div><p className="analysis-note">Перекази між власними рахунками, борги, звіряння залишків і відкладення обліковуються окремо від доходів і витрат.</p></>;
}

function MonthlyStory({state,hide,summary}:{state:ViewProps['state'];hide:boolean;summary:MonthlySummary}) {
 const growth=summary.categoryGrowth;
 return <section className="panel monthly-story" aria-labelledby="monthly-story-title">
  <div className="panel-heading"><h2 id="monthly-story-title">Підсумок місяця</h2></div>
  <p className="monthly-story-intro">{summary.income===0&&summary.expense===0?'За цей місяць ще немає доходів і витрат.':summary.net===0?'Надходження та витрати зрівнялися.':<>{summary.net>0?'Надходження перевищили витрати на ':'Витрати перевищили надходження на '}<Amount value={Math.abs(summary.net)} hide={hide}/>.</>}</p>
  <div className="monthly-story-grid">
   <div className="monthly-story-section">
    <h3>Відкладено на цілі</h3>
    <dl className="report-flows"><div><dt>Відкладено</dt><dd><Amount value={summary.goals.saved} hide={hide}/></dd></div><div><dt>Вивільнено</dt><dd><Amount value={summary.goals.released} hide={hide}/></dd></div><div><dt>Чиста зміна</dt><dd><Amount value={summary.goals.net} hide={hide}/></dd></div></dl>
    <small>{summary.goals.hasTrackedHistory?'Враховані лише відкладення та вивільнення із записаною датою.':'Історію відкладень за датами ще не записано.'} Старі відкладення без дати не входять у місячний підсумок.</small>
   </div>
   <div className="monthly-story-section">
    <h3>Зміна боргів</h3>
    <dl className="report-flows">{([{key:'payable',label:'Я винен'},{key:'receivable',label:'Мені винні'}] as const).map(({key,label})=><div className="principal-flow" key={key}><dt>{label}<small>Додано <Amount value={summary.debts[key].added} hide={hide}/> · Повернуто <Amount value={summary.debts[key].repaid} hide={hide}/></small></dt><dd><Amount value={summary.debts[key].net} hide={hide}/></dd></div>)}</dl>
    <small>Зміна основної суми за датою боргу та повернень. Раніше взятий борг враховується за вказаною датою, навіть якщо його записали пізніше.</small>
   </div>
   <div className="monthly-story-section monthly-growth">
    <h3>Найбільше зростання витрат</h3>
    {growth?<><p><span className="monthly-growth-category">{categoryName(state,growth.category)}</span> +<Amount value={growth.change} hide={hide}/>{!hide&&growth.percent!==null&&<span className="muted"> (+{Math.round(growth.percent)}%)</span>}</p><small>{growth.previous===0?'У попередньому місяці витрат у цій категорії не було.':'Порівняно з попереднім календарним місяцем.'}</small></>:<p className="muted">{summary.previousMonth?'Жодна категорія не зросла порівняно з попереднім місяцем.':'Попередній місяць поза доступним календарем для порівняння.'}</p>}
   </div>
  </div>
 </section>;
}
