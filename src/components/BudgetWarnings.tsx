import type { FinanceState } from '../lib/types';
import { ChevronDown, Gauge } from 'lucide-react';
import { categoryColor, categoryName, currentMonth } from '../lib/finance';
import { budgetWarnings } from '../lib/reporting';
import { Amount } from './ui';
import '../reporting.css';

export function BudgetWarnings({state,hide,navigate}:{state:FinanceState;hide:boolean;navigate:(page:string)=>void}) {
 const warnings=budgetWarnings(state,currentMonth());
 if(!warnings.length)return null;
 return <details className="budget-warnings">
  <summary><Gauge size={17}/><span>Увага до місячних лімітів</span><span className="budget-warning-count">{warnings.length}</span><ChevronDown className="budget-warning-chevron" size={15}/></summary>
  <ul className="budget-warning-list">{warnings.map(w=><li key={w.budgetId}>
   <div className="budget-warning-copy"><strong><span className="category-dot" style={{background:categoryColor(state,w.category)}}/>{categoryName(state,w.category)}</strong><small className={w.status==='near'?'':'negative'}>{w.status==='exceeded'?'Ліміт перевищено':w.status==='reached'?'Ліміт використано повністю':'Наближаєшся до ліміту'}{!hide&&<> · {Math.floor(w.percent)}%</>}</small></div>
   <span className="budget-warning-value">{w.remaining<0?'Понад ліміт ':'Залишилось '}<Amount value={Math.abs(w.remaining)} hide={hide}/></span>
  </li>)}</ul>
  <button className="text-button" onClick={()=>navigate('budget')}>Переглянути бюджет →</button>
 </details>;
}
