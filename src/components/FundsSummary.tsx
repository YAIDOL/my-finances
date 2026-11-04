import { Amount } from './ui';

interface Funds { available:number;saved:number;reserved:number }
export function FundsSummary({funds,hide,compact=false}:{funds:Funds;hide:boolean;compact?:boolean}){
 const items=compact?[['Відкладено на цілі',funds.saved],['Резерв на платежі',funds.reserved]] as const:[['Бюджет для витрат',funds.available],['Відкладено на цілі',funds.saved],['Резерв на платежі',funds.reserved]] as const;
 return <section className={compact?'funds-summary compact':'panel funds-summary'} aria-label="Поточний розподіл коштів">
  {!compact&&<h2>Кошти зараз</h2>}
  <dl>{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd><Amount value={value} hide={hide}/></dd></div>)}</dl>
  {!compact&&<p>Відкладення й резерви не входять у бюджет для витрат. Ліміти категорій — твій план на обраний місяць, а суми вище — поточні кошти на рахунках.</p>}
 </section>;
}
