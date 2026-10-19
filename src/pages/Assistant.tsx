import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Calculator, Check, LockKeyhole, MessageCircle, ShieldCheck, Square, Trash2 } from 'lucide-react';
import { Amount, Modal, PageTitle, type ViewProps } from '../components/ui';
import { categoryName, today } from '../lib/finance';
import { categoryTotals } from '../lib/reporting';
import { FinanceChatError, sendFinanceChat, type ChatMessage } from '../lib/ai-chat';
import { applyFinancePlan, buildFinancePlan, type FinancePlan, type PlanPeriod } from '../lib/ai-planner';
import '../assistant.css';

const periods: { value: PlanPeriod; label: string }[] = [
  { value: 'day', label: 'День' }, { value: 'week', label: 'Тиждень' }, { value: 'month', label: 'Місяць' },
];
const prompts = ['Як скоротити необов’язкові витрати?', 'Поясни мій бюджет простими словами', 'Як підготувати фінансову подушку?'];
function boundedHistory(messages: ChatMessage[]): ChatMessage[] {
  const result = messages.slice(-12).map(message => ({ ...message, content: message.content.slice(0, message.role === 'user' ? 1000 : 8000) }));
  while (result.length > 1 && result.reduce((sum, message) => sum + message.content.length, 0) > 16000) result.shift();
  // A retained conversation starts with a user request, never an orphaned answer.
  while (result[0]?.role === 'assistant') result.shift();
  return result;
}
function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

export function Assistant({ state, mutate, hide, busy, navigate, ownerId, demo }: ViewProps & { ownerId: string; demo: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState<PlanPeriod>('month');
  const [preview, setPreview] = useState<FinancePlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [planError, setPlanError] = useState('');
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const request = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const day = today();
  const planResult = useMemo(() => {
    try { return { plan: buildFinancePlan(state, period), error: '' }; }
    catch { return { plan: null, error: 'Не вдалося розрахувати план. Перевір дані в бюджеті.' }; }
  }, [state, period, day]);
  const plan = planResult.plan;
  const previewSpent = preview ? categoryTotals(state, preview.start.slice(0, 7)) : {};

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current++; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (hide) {
      request.current++;
      controller.current?.abort();
      controller.current = null;
      setSending(false);
      setPreview(null);
      setError('');
      setStatus('');
    }
  }, [hide]);
  useEffect(() => { if (!hide) bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages, sending, hide]);

  function cancel() {
    request.current++;
    controller.current?.abort();
    controller.current = null;
    setSending(false);
    setStatus('Запит зупинено. Відповідь не додано.');
  }
  function clearChat() {
    cancel();
    setMessages([]);
    setDraft('');
    setError('');
    setStatus('Локальну історію очищено.');
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (demo || hide || busy || saving || sending || controller.current || !consent || !ownerId || !draft.trim()) return;
    const content = draft.trim();
    if (content.length > 1000) { setError('Скороти повідомлення до 1000 символів.'); return; }
    const history = boundedHistory([...messages, { role: 'user', content }]);
    const abort = new AbortController();
    controller.current = abort;
    const currentRequest = ++request.current;
    setSending(true);
    setError('');
    setStatus('');
    setMessages(history);
    setDraft('');
    try {
      const { reply, model } = await sendFinanceChat(history, ownerId, consent, abort.signal);
      if (!mounted.current || request.current !== currentRequest || abort.signal.aborted) return;
      if (typeof reply !== 'string' || !reply.trim() || reply.length > 8000) throw new Error('INVALID_REPLY');
      setMessages(boundedHistory([...history, { role: 'assistant', content: reply.trim(), ...(model ? { model } : {}) }]));
      if (model === 'nvidia/nemotron-3.5-lightning-30b-a3b') setStatus('Відповідь надав резервний помічник NVIDIA Nemotron, оскільки основний помічник недоступний.');
    } catch (failure) {
      if (!mounted.current || request.current !== currentRequest || abort.signal.aborted) return;
      setError(failure instanceof FinanceChatError ? failure.message : 'Не вдалося отримати відповідь. Перевір з’єднання й спробуй ще раз.');
      setMessages(history.slice(0, -1));
      setDraft(content);
    } finally {
      if (mounted.current && request.current === currentRequest) {
        controller.current = null;
        setSending(false);
      }
    }
  }
  async function confirmPlan() {
    if (!preview || hide || busy || saving || sending) return;
    const snapshot = preview;
    setSaving(true);
    setPlanError('');
    try {
      const saved = await mutate(current => applyFinancePlan(current, snapshot), 'Місячні ліміти оновлено');
      if (!mounted.current) return;
      if (saved) { setPreview(null); setStatus('Місячні ліміти оновлено. Їх можна переглянути в бюджеті.'); }
      else setPlanError('План не збережено. Якщо фінансові дані змінилися, закрий попередній перегляд і розрахуй план знову.');
    } catch {
      if (mounted.current) setPlanError('План застарів або не вдалося зберегти зміни. Закрий попередній перегляд і розрахуй план знову.');
    } finally { if (mounted.current) setSaving(false); }
  }

  return <div className="assistant-page">
    <PageTitle title="Фінансовий помічник" description="Розберися з витратами та склади зрозумілий план." />
    {hide && <div className="assistant-privacy" role="status"><LockKeyhole size={20}/><div><strong>Режим приватності увімкнено</strong><p>Повідомлення, чернетку та суми приховано. Щоб написати помічнику, вимкни приховування сум у налаштуваннях.</p><button className="text-button" onClick={() => navigate('settings')}>Перейти до налаштувань →</button></div></div>}
    {demo && <div className="assistant-demo"><Calculator size={20}/><p><strong>Демонстраційний режим.</strong> Доступний лише локальний розрахунок плану. AI-чат і передавання даних до NVIDIA вимкнені.</p></div>}
    <div className="assistant-layout">
      <section className="panel assistant-chat" aria-labelledby="assistant-chat-title">
        <div className="assistant-section-heading"><div><span className="assistant-eyebrow"><MessageCircle size={15}/> Чат про фінанси</span><h2 id="assistant-chat-title">Запитай про свій бюджет</h2></div><button className="icon-button" aria-label="Очистити локальний чат" title="Очистити локальний чат" disabled={hide || (!messages.length && !draft)} onClick={clearChat}><Trash2 size={18}/></button></div>
        {!demo && <div className="assistant-consent">
          <div className="assistant-provider"><ShieldCheck size={17}/><span>NVIDIA · GLM 5.3 Flash · резерв: Nemotron 3.5 Lightning</span></div>
          <p>Після твоєї згоди помічник передасть NVIDIA повідомлення чату та скорочений фінансовий підсумок: назви категорій і загальні суми. Якщо GLM не відповість вчасно або буде недоступний, запит отримає резервний помічник NVIDIA Nemotron. Назви рахунків, номери карток, ідентифікатори, нотатки та імена людей у боргах не передаються автоматично.</p>
          <p>Не вписуй секретні або особисті дані в повідомлення. Історія зберігається лише в пам’яті цієї сторінки й зникає після виходу з неї. Очищення чату не відкликає вже передані дані.</p>
          <label className="assistant-consent-check"><input type="checkbox" checked={consent} disabled={hide || sending} onChange={event => { setConsent(event.target.checked); setError(''); }}/><span>Дозволяю надсилати ці дані до NVIDIA для відповідей у чаті.</span></label>
        </div>}
        <div className="assistant-messages" role="log" aria-label="Повідомлення помічника" aria-live="polite" aria-relevant="additions text" aria-busy={sending}>
          {hide ? <div className="assistant-chat-empty"><LockKeyhole size={27}/><h3>Чат приховано</h3><p>Текст повідомлень і чернетка знову з’являться після вимкнення режиму приватності.</p></div> : messages.length ? messages.map((message, index) => <article className={`assistant-message ${message.role}`} key={index}><strong>{message.role === 'user' ? 'Ти' : message.model === 'nvidia/nemotron-3.5-lightning-30b-a3b' ? 'Помічник · резерв NVIDIA Nemotron' : message.model === 'z-ai/glm-5.3-flash' ? 'Помічник · NVIDIA GLM' : 'Помічник'}</strong><p>{message.content}</p></article>) : <div className="assistant-chat-empty"><MessageCircle size={29}/><h3>{demo ? 'Почни з локального плану' : 'З чого почнемо?'}</h3><p>{demo ? 'Обери день, тиждень або місяць у блоці планування.' : 'Попроси пояснити витрати, знайти можливості для економії або допомогти з фінансовою звичкою.'}</p></div>}
          {sending && !hide && <p className="assistant-thinking">Помічник готує відповідь…</p>}
          <div ref={bottom}/>
        </div>
        {!demo && <>
          {!messages.length && !hide && <div className="assistant-prompts" aria-label="Приклади запитів">{prompts.map(prompt => <button key={prompt} disabled={busy || sending || saving} onClick={() => setDraft(prompt)}>{prompt}<ArrowUp size={14}/></button>)}</div>}
          <form className="assistant-composer" onSubmit={send}>
            <label htmlFor="assistant-draft">Твоє повідомлення</label>
            <textarea id="assistant-draft" value={hide ? '' : draft} onChange={event => setDraft(event.target.value)} maxLength={1000} rows={3} disabled={hide || sending || busy || saving} placeholder={hide ? 'Чернетку приховано' : 'Наприклад: як краще розподілити залишок на місяць?'} aria-describedby="assistant-input-note"/>
            <div className="assistant-composer-footer"><small id="assistant-input-note">{hide ? 'Текст приховано' : `${draft.length} / 1000`}{!consent && !hide && ' · Для надсилання потрібна згода'}</small>{sending ? <button type="button" className="button secondary" onClick={cancel}><Square size={14}/>Зупинити</button> : <button className="button primary" disabled={hide || busy || saving || !consent || !ownerId || !draft.trim()}><ArrowUp size={17}/>Надіслати</button>}</div>
          </form>
          {!hide && error && <div className="form-error" role="alert">{error}</div>}
          <p className="assistant-disclaimer">Відповіді AI можуть містити помилки. Перевіряй розрахунки перед фінансовими рішеннями. Чат самостійно не змінює бюджет.</p>
        </>}
      </section>
      <section className="panel assistant-plan" aria-labelledby="assistant-plan-title">
        <div className="assistant-section-heading"><div><span className="assistant-eyebrow"><Calculator size={15}/> Локальний розрахунок</span><h2 id="assistant-plan-title">План витрат</h2></div></div>
        <p className="assistant-plan-intro">План на основі внесених даних. Майбутні надходження не припускаються. Розрахунок не потребує AI та не надсилає дані NVIDIA.</p>
        <div className="assistant-periods" aria-label="Період плану">{periods.map(option => <button key={option.value} aria-pressed={period === option.value} disabled={busy || saving} onClick={() => { setPeriod(option.value); setPlanError(''); }}>{option.label}</button>)}</div>
        {plan ? <>
          <p className="assistant-plan-dates">{dateLabel(plan.start)}{plan.start !== plan.end && ` — ${dateLabel(plan.end)}`} · {plan.days} дн.</p>
          <div className="assistant-daily"><span>Орієнтир на день</span><Amount value={plan.daily} hide={hide}/><small>Після врахування зобов’язань</small></div>
          <dl className="assistant-plan-totals"><div><dt>Доступні кошти</dt><dd><Amount value={plan.available} hide={hide}/></dd></div><div><dt>Враховані зобов’язання</dt><dd><Amount value={plan.obligations} hide={hide}/></dd></div><div><dt>Можна розподілити</dt><dd><Amount value={plan.safeToSpend} hide={hide}/></dd></div></dl>
          {plan.deficit > 0 && <p className="assistant-deficit">На зобов’язання бракує <Amount value={plan.deficit} hide={hide}/>. Спочатку переглянь платежі й скороти необов’язкові витрати.</p>}
          <div className="assistant-plan-categories"><h3>Залишок за категоріями</h3><p>Додаткова сума, яку можна витратити за цей період.</p>{plan.items.length ? plan.items.map(item => <div className="assistant-plan-row" key={item.categoryId}><span>{categoryName(state, item.categoryId)}</span><Amount value={item.amount} hide={hide}/></div>) : <p className="assistant-plan-empty">Немає коштів або категорій для розподілу. Перевір рахунки, платежі та категорії витрат.</p>}</div>
          {period === 'month' ? <button className="button secondary full" disabled={hide || busy || saving || sending || !plan.items.length} onClick={() => { setPreview(plan); setPlanError(''); }}><Check size={16}/>Переглянути місячні ліміти</button> : <p className="assistant-plan-note">Ліміти бюджету можна застосувати лише для місячного плану.</p>}
          <button className="text-button" onClick={() => navigate('budget')}>Відкрити бюджет і платежі →</button>
        </> : <p className="form-error" role="alert">{planResult.error}</p>}
      </section>
    </div>
    {!hide && status && <p className="assistant-status" role="status">{status}</p>}
    <Modal open={!!preview && !hide} title="Підтвердити місячні ліміти" onClose={() => { if (!saving) setPreview(null); }}>
      {preview && !hide && <div className="assistant-plan-preview"><p>Новий ліміт кожної категорії дорівнює вже витраченому за місяць плюс запропонований залишок. Наявні ліміти поточного місяця буде замінено цим планом. Категорії з нульовим новим лімітом не матимуть ліміту.</p><p>Це змінить лише ліміти бюджету. Гроші не списуються та не резервуються.</p><div className="assistant-preview-rows">{preview.items.map(item => <div key={item.categoryId}><strong>{categoryName(state, item.categoryId)}</strong><span>Додатково: <Amount value={item.amount} hide={hide}/></span><span>Новий ліміт: <Amount value={(previewSpent[item.categoryId] || 0) + item.amount} hide={hide}/></span></div>)}</div>{planError && <div className="form-error" role="alert">{planError}</div>}<div className="form-footer"><button className="button secondary" disabled={saving} onClick={() => setPreview(null)}>Скасувати</button><button className="button primary" disabled={busy || saving || sending || hide} onClick={confirmPlan}>{saving ? 'Зберігаю…' : 'Підтвердити зміни'}</button></div></div>}
    </Modal>
  </div>;
}
