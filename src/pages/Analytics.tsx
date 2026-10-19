import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Scale } from 'lucide-react';
import { Amount, Empty, PageTitle, Progress, type ViewProps } from '../components/ui';
import { categoryName, today } from '../lib/finance';
import { periodCategoryTotals, periodSummary, previousAnalyticsRange, resolveAnalyticsRange, type AnalyticsPeriod, type DateRange, type PeriodSummary } from '../lib/analytics-period';
import '../reporting.css';
import { validDate } from '../lib/dates';
export function Analytics({state,hide}:ViewProps){
 const [period,setPeriod]=useState<AnalyticsPeriod>('month'),[anchor,setAnchor]=useState(today),[customStart,setCustomStart]=useState(()=>today().slice(0,7)+'-01'),[customEnd,setCustomEnd]=useState(today);
 const result=useMemo(()=>{try{const range=resolveAnalyticsRange(period,anchor,customStart,customEnd),previous=previousAnalyticsRange(period,range);return {range,previous,total:periodSummary(state,range,previous),error:''};}catch(error){return {range:null,previous:null,total:null,error:error instanceof Error?error.message:'Обери коректний період.'};}},[state,period,anchor,customStart,customEnd]);
 const {range,total,previous}=result;
 const groups=(kind:'expense'|'income')=>{const amounts=periodCategoryTotals(state,range!,kind);return state.categories.filter(c=>c.kind===kind).map(category=>({...category,amount:amounts[category.id]||0})).filter(g=>g.amount>0).sort((a,b)=>b.amount-a.amount);};
 function choosePeriod(value:AnalyticsPeriod){if(value==='custom'&&range){setCustomStart(range.start);setCustomEnd(range.end);}setPeriod(value);}
 return <><PageTitle title="Аналітика" description="Зрозумій свої звички та рух грошей за вибраний період."/>
  <section className="panel analytics-period-filter" aria-label="Період аналітики">
   <div className="analytics-period-tabs" role="group" aria-label="Вибір періоду">{([{id:'day',label:'День'},{id:'week',label:'Тиждень'},{id:'month',label:'Місяць'},{id:'custom',label:'Власний період'}] as const).map(option=><button key={option.id} aria-pressed={period===option.id} onClick={()=>choosePeriod(option.id)}>{option.label}</button>)}</div>
   <div className="analytics-date-controls">{period==='custom'?<>
    <label><span>Від</span><input type="date" aria-label="Початок періоду аналітики" min="0001-01-01" max="9999-12-31" value={customStart} onChange={e=>setCustomStart(e.target.value)} aria-invalid={!!result.error} aria-describedby={result.error?'analytics-period-error':undefined}/></label>
    <label><span>До</span><input type="date" aria-label="Кінець періоду аналітики" min="0001-01-01" max="9999-12-31" value={customEnd} onChange={e=>setCustomEnd(e.target.value)} aria-invalid={!!result.error} aria-describedby={result.error?'analytics-period-error':undefined}/></label>
   </>:<label><span>{period==='month'?'Місяць':period==='week'?'Дата в потрібному тижні':'День'}</span><input type={period==='month'?'month':'date'} min={period==='month'?'0001-01':'0001-01-01'} max={period==='month'?'9999-12':'9999-12-31'} aria-label={period==='month'?'Місяць аналітики':period==='week'?'Дата тижня аналітики':'День аналітики'} value={period==='month'?anchor.slice(0,7):anchor} onChange={e=>{const value=period==='month'?e.target.value+'-01':e.target.value;if(validDate(value))setAnchor(value);}}/></label>}</div>
   {result.error?<p id="analytics-period-error" className="form-error" role="alert">{result.error}</p>:range&&<p className="analytics-range-label" aria-live="polite">{rangeLabel(range)} · обидві дати включно{period==='week'&&' · понеділок–неділя'}</p>}
  </section>
  {range&&total&&<><div className="analytics-stats">{[{label:'Надходження',value:total.income,Icon:ArrowDownLeft,color:'positive'},{label:'Витрати',value:total.expense,Icon:ArrowUpRight,color:'negative'},{label:'Різниця',value:total.net,Icon:Scale,color:''}].map(x=><div className="panel stat" key={x.label}><x.Icon size={23} className={x.color}/><span>{x.label}</span><Amount value={x.value} hide={hide} className={x.color}/></div>)}</div>
  <PeriodStory state={state} hide={hide} summary={total} period={period} previous={previous}/>
  <div className="budget-layout">{[{title:'Категорії витрат',groups:groups('expense'),total:total.expense},{title:'Джерела доходу',groups:groups('income'),total:total.income}].map(x=><section className="panel" key={x.title}><div className="panel-heading"><h2>{x.title}</h2></div>{x.groups.length?x.groups.map(g=><div className="analysis-row" key={g.id}><div className="flex-between"><span className="category-label"><span className="category-dot" style={{background:g.color}}/>{g.name}</span><Amount value={g.amount} hide={hide}/></div><Progress value={g.amount/x.total*100} color={g.color}/><small>{Math.round(g.amount/x.total*100)}% від загальної суми</small></div>):<Empty title="Ще немає даних" description="Додай операції або обери інший період."/>}</section>)}</div></>}
  <p className="analysis-note">Перекази між власними рахунками, борги, звіряння залишків і відкладення обліковуються окремо від доходів і витрат.</p></>;
}

function rangeLabel(range:DateRange){const format=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('uk-UA',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});return range.start===range.end?format(range.start):`${format(range.start)} — ${format(range.end)}`;}

function PeriodStory({state,hide,summary,period,previous}:{state:ViewProps['state'];hide:boolean;summary:PeriodSummary;period:AnalyticsPeriod;previous:DateRange|null}) {
 const growth=summary.categoryGrowth;
 return <section className="panel monthly-story" aria-labelledby="monthly-story-title">
  <div className="panel-heading"><h2 id="monthly-story-title">{period==='month'?'Підсумок місяця':period==='week'?'Підсумок тижня':period==='day'?'Підсумок дня':'Підсумок періоду'}</h2></div>
  <p className="monthly-story-intro">{summary.income===0&&summary.expense===0?'За цей період ще немає доходів і витрат.':summary.net===0?'Надходження та витрати зрівнялися.':<>{summary.net>0?'Надходження перевищили витрати на ':'Витрати перевищили надходження на '}<Amount value={Math.abs(summary.net)} hide={hide}/>.</>}</p>
  <div className="monthly-story-grid">
   <div className="monthly-story-section">
    <h3>Відкладено на цілі</h3>
    <dl className="report-flows"><div><dt>Відкладено</dt><dd><Amount value={summary.goals.saved} hide={hide}/></dd></div><div><dt>Вивільнено</dt><dd><Amount value={summary.goals.released} hide={hide}/></dd></div><div><dt>Чиста зміна</dt><dd><Amount value={summary.goals.net} hide={hide}/></dd></div></dl>
    <small>{summary.goals.hasTrackedHistory?'Враховані лише відкладення та вивільнення із записаною датою.':'Історію відкладень за датами ще не записано.'} Старі відкладення без дати не входять у підсумок періоду.</small>
   </div>
   <div className="monthly-story-section">
    <h3>Зміна боргів</h3>
    <dl className="report-flows">{([{key:'payable',label:'Я винен'},{key:'receivable',label:'Мені винні'}] as const).map(({key,label})=><div className="principal-flow" key={key}><dt>{label}<small>Додано <Amount value={summary.debts[key].added} hide={hide}/> · Повернуто <Amount value={summary.debts[key].repaid} hide={hide}/></small></dt><dd><Amount value={summary.debts[key].net} hide={hide}/></dd></div>)}</dl>
    <small>Зміна основної суми за датою боргу та повернень. Раніше взятий борг враховується за вказаною датою, навіть якщо його записали пізніше.</small>
   </div>
   <div className="monthly-story-section monthly-growth">
    <h3>Найбільше зростання витрат</h3>
    {growth?<><p><span className="monthly-growth-category">{categoryName(state,growth.category)}</span> +<Amount value={growth.change} hide={hide}/>{!hide&&growth.percent!==null&&<span className="muted"> (+{Math.round(growth.percent)}%)</span>}</p><small>{growth.previous===0?'У попередньому періоді витрат у цій категорії не було.':'Порівняно з попереднім періодом.'}</small></>:<p className="muted">{previous?'Жодна категорія не зросла порівняно з попереднім періодом.':'Попередній період поза доступним календарем для порівняння.'}</p>}
    {previous&&<small>Період порівняння: {rangeLabel(previous)}. {period==='month'?'Попередній календарний місяць.':'Попередні дні тієї ж тривалості.'}</small>}
   </div>
  </div>
 </section>;
}
