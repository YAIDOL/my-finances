import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Calculator, Check, LockKeyhole, MessageCircle, Plus, RefreshCw, ShieldCheck, Square, Trash2 } from 'lucide-react';
import { Amount, Modal, PageTitle, type ViewProps } from '../components/ui';
import { categoryName, today } from '../lib/finance';
import { categoryTotals } from '../lib/reporting';
import { FinanceChatError, sendFinanceChat, type ChatMessage } from '../lib/ai-chat';
import { ChatHistoryError, deleteChatThread, listChatThreads, loadChatThread, saveChatThread, type ChatThread } from '../lib/chat-history';
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
type PendingSave = { id: string; version: number; messages: ChatMessage[] };
function historyFailure(failure: unknown, fallback: string) {
  return failure instanceof ChatHistoryError ? failure.message : fallback;
}
function threadDate(value: string) {
  return new Date(value).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
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
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selected, setSelected] = useState<{ id: string; version: number } | null>(null);
  const [historyReady, setHistoryReady] = useState(demo);
  const [historyLoading, setHistoryLoading] = useState(!demo);
  const [historyError, setHistoryError] = useState('');
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [historySaving, setHistorySaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [discardTarget, setDiscardTarget] = useState<{ id: string | null } | null>(null);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const persistenceController = useRef<AbortController | null>(null);
  const pendingInput = useRef<{ messages: ChatMessage[]; draft: string } | null>(null);
  const request = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const day = today();
  const planResult = useMemo(() => {
    try { return { plan: buildFinancePlan(state, period), error: '' }; }
    catch { return { plan: null, error: 'Не вдалося розрахувати план. Перевір дані в бюджеті.' }; }
  }, [state, period, day]);
  const plan = planResult.plan;
  const previewSpent = preview ? categoryTotals(state, preview.start.slice(0, 7)) : {};
  const unsaved = !!pendingSave || !!draft.trim() || sending;

  useEffect(() => {
    mounted.current = true;
    if (!demo) void initializeHistory();
    return () => { mounted.current = false; request.current++; controller.current?.abort(); historyController.current?.abort(); persistenceController.current?.abort(); };
  }, []);
  useEffect(() => {
    if (hide) {
      if (pendingInput.current) cancel(false);
      setPreview(null);
      setDeleteOpen(false);
      setDiscardTarget(null);
      setError('');
      setStatus('');
    }
  }, [hide]);
  useEffect(() => { if (!hide) bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages, sending, hide]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('finance-chat-unsaved', { detail: { ownerId, unsaved } }));
    return () => { window.dispatchEvent(new CustomEvent('finance-chat-unsaved', { detail: { ownerId, unsaved: false } })); };
  }, [ownerId, unsaved]);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  function cancel(announce = true) {
    request.current++;
    controller.current?.abort();
    controller.current = null;
    if (pendingInput.current) {
      setMessages(pendingInput.current.messages);
      setDraft(pendingInput.current.draft);
      pendingInput.current = null;
    }
    setSending(false);
    setThreadLoading(false);
    if (announce) setStatus('Запит зупинено. Відповідь не додано.');
  }
  async function initializeHistory() {
    historyController.current?.abort();
    const abort = new AbortController();
    historyController.current = abort;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const list = await listChatThreads(ownerId, abort.signal);
      if (!mounted.current || abort.signal.aborted) return;
      setThreads(list);
      setHistoryReady(true);
      setHistoryLoading(false);
      if (list[0]) await openThread(list[0].id);
    } catch (failure) {
      if (mounted.current && !abort.signal.aborted) setHistoryError(historyFailure(failure, 'Не вдалося завантажити історію. Спробуй ще раз.'));
    } finally {
      if (mounted.current && !abort.signal.aborted) setHistoryLoading(false);
    }
  }
  async function openThread(id: string | null) {
    cancel(false);
    const epoch = request.current;
    setMessages([]);
    setDraft('');
    setPendingSave(null);
    setSaveError('');
    setSelected(id ? { id, version: threads.find(thread => thread.id === id)?.version ?? 0 } : null);
    setError('');
    setThreadError('');
    setStatus('');
    if (!id) return;
    const abort = new AbortController();
    controller.current = abort;
    setThreadLoading(true);
    try {
      const saved = await loadChatThread(id, ownerId, abort.signal);
      if (!mounted.current || request.current !== epoch || abort.signal.aborted) return;
      setMessages(saved.messages);
      setSelected({ id: saved.id, version: saved.version });
      setThreads(current => current.map(thread => thread.id === saved.id ? saved : thread));
    } catch (failure) {
      if (mounted.current && request.current === epoch && !abort.signal.aborted) setThreadError(historyFailure(failure, 'Не вдалося відкрити чат. Спробуй ще раз.'));
    } finally {
      if (mounted.current && request.current === epoch) { controller.current = null; setThreadLoading(false); }
    }
  }
  function chooseThread(id: string | null) {
    if (hide || demo || historyLoading || historySaving || deleting || (id && id === selected?.id)) return;
    if (pendingSave || draft.trim() || sending) { setDiscardTarget({ id }); return; }
    void openThread(id);
  }
  async function persistChat(snapshot: PendingSave, epoch: number) {
    const abort = new AbortController();
    persistenceController.current = abort;
    setHistorySaving(true);
    setSaveError('');
    try {
      const saved = await saveChatThread(snapshot, ownerId, abort.signal);
      if (!mounted.current || request.current !== epoch || abort.signal.aborted) return;
      setSelected({ id: saved.id, version: saved.version });
      setPendingSave(null);
      setThreads(current => [saved, ...current.filter(thread => thread.id !== saved.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch (failure) {
      if (mounted.current && request.current === epoch && !abort.signal.aborted) setSaveError(historyFailure(failure, 'Відповідь отримано, але історію не збережено. Повтори збереження.'));
    } finally {
      if (mounted.current && request.current === epoch) { persistenceController.current = null; setHistorySaving(false); }
    }
  }
  async function confirmDelete() {
    if (!selected || hide || deleting || historySaving || sending) return;
    const snapshot = selected;
    const epoch = ++request.current;
    const abort = new AbortController();
    persistenceController.current = abort;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteChatThread(snapshot, ownerId, abort.signal);
      if (!mounted.current || request.current !== epoch || abort.signal.aborted) return;
      const remaining = threads.filter(thread => thread.id !== snapshot.id);
      setThreads(remaining);
      setDeleteOpen(false);
      await openThread(remaining[0]?.id ?? null);
      if (mounted.current) setStatus('Вибраний чат видалено.');
    } catch (failure) {
      if (mounted.current && request.current === epoch && !abort.signal.aborted) setDeleteError(historyFailure(failure, 'Не вдалося видалити чат. Спробуй ще раз.'));
    } finally {
      if (mounted.current) { persistenceController.current = null; setDeleting(false); }
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (demo || hide || busy || saving || sending || historySaving || deleting || pendingSave || !historyReady || historyLoading || threadLoading || threadError || controller.current || !consent || !ownerId || !draft.trim()) return;
    if (messages.length >= 200) { setError('У цьому чаті вже 200 повідомлень. Почни новий чат.'); return; }
    if (!selected && threads.length >= 100) { setError('Збережено 100 чатів. Видали один із них, щоб почати новий.'); return; }
    const content = draft.trim();
    if (content.length > 1000) { setError('Скороти повідомлення до 1000 символів.'); return; }
    // Keep the complete conversation; bound only the context sent to NVIDIA.
    const history: ChatMessage[] = [...messages, { role: 'user', content }];
    if (new TextEncoder().encode(JSON.stringify(history)).length + 32100 > 500000) { setError('Цей чат досяг ліміту обсягу. Почни новий чат.'); return; }
    const abort = new AbortController();
    controller.current = abort;
    const currentRequest = ++request.current;
    setSending(true);
    setError('');
    setStatus('');
    pendingInput.current = { messages, draft: content };
    setMessages(history);
    setDraft('');
    try {
      const { reply, model } = await sendFinanceChat(boundedHistory(history), ownerId, consent, abort.signal);
      if (!mounted.current || request.current !== currentRequest || abort.signal.aborted) return;
      if (typeof reply !== 'string' || !reply.trim() || reply.length > 8000) throw new Error('INVALID_REPLY');
      const completed: ChatMessage[] = [...history, { role: 'assistant', content: reply.trim(), ...(model ? { model } : {}) }];
      pendingInput.current = null;
      controller.current = null;
      setMessages(completed);
      setSending(false);
      const snapshot: PendingSave = { id: selected?.id ?? crypto.randomUUID(), version: selected?.version ?? 0, messages: completed };
      setPendingSave(snapshot);
      if (model === 'nvidia/nemotron-3.5-lightning-30b-a3b') setStatus('Відповідь надав резервний помічник NVIDIA Nemotron, оскільки основний помічник недоступний.');
      await persistChat(snapshot, currentRequest);
    } catch (failure) {
      if (!mounted.current || request.current !== currentRequest || abort.signal.aborted) return;
      setError(failure instanceof FinanceChatError ? failure.message : 'Не вдалося отримати відповідь. Перевір з’єднання й спробуй ще раз.');
      setMessages(history.slice(0, -1));
      setDraft(content);
      pendingInput.current = null;
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
      <div className={`assistant-chat-workspace${demo ? ' demo' : ''}`}>
      {!demo && <aside className="panel assistant-history" aria-labelledby="assistant-history-title">
        <div className="assistant-history-heading"><div><span className="assistant-eyebrow"><LockKeyhole size={14}/> Особиста історія</span><h2 id="assistant-history-title">Мої чати</h2></div><span className="assistant-history-count">{threads.length} / 100</span></div>
        <button className="button secondary full assistant-new-chat" disabled={hide || historyLoading || historySaving || deleting || !historyReady} onClick={() => chooseThread(null)}><Plus size={16}/>Новий чат</button>
        <p className="assistant-history-note">Збережені розмови доступні у твоєму обліковому записі на інших пристроях.</p>
        {threads.length >= 100 && <p className="assistant-history-state">Досягнуто ліміту 100 чатів. Видали одну розмову, щоб зберегти нову.</p>}
        {historyLoading && <p className="assistant-history-state" role="status">Завантажую історію…</p>}
        {historyError && <div className="assistant-history-error" role="alert"><p>{historyError}</p><button className="text-button" onClick={() => void initializeHistory()}><RefreshCw size={13}/>Повторити</button></div>}
        {!historyLoading && !historyError && !threads.length && <p className="assistant-history-state">Тут з’явиться перший чат після відповіді помічника.</p>}
        <nav className="assistant-thread-list" aria-label="Збережені чати">{threads.map((thread, index) => <button key={thread.id} className={`assistant-thread${selected?.id === thread.id ? ' selected' : ''}`} aria-current={selected?.id === thread.id ? 'page' : undefined} disabled={hide || historyLoading || historySaving || deleting} onClick={() => chooseThread(thread.id)}><MessageCircle size={15}/><span><strong>{hide ? `Чат ${index + 1}` : thread.title}</strong><time dateTime={thread.updatedAt}>{threadDate(thread.updatedAt)} · {thread.messageCount / 2} відповідей</time></span></button>)}</nav>
      </aside>}
      <section className="panel assistant-chat" aria-labelledby="assistant-chat-title">
        <div className="assistant-section-heading"><div><span className="assistant-eyebrow"><MessageCircle size={15}/> {selected ? 'Збережена розмова' : 'Новий чат'}</span><h2 id="assistant-chat-title">Запитай про свій бюджет</h2></div>{!demo && <button className="icon-button" aria-label={selected ? 'Видалити цей чат' : 'Очистити чернетку'} title={selected ? 'Видалити цей чат' : 'Очистити чернетку'} disabled={hide || historyLoading || threadLoading || historySaving || deleting || sending || (!selected && !messages.length && !draft)} onClick={() => { if (selected) { setDeleteError(''); setDeleteOpen(true); } else chooseThread(null); }}><Trash2 size={18}/></button>}</div>
        {!demo && <div className="assistant-consent">
          <div className="assistant-provider"><ShieldCheck size={17}/><span>NVIDIA · GLM 5.3 Flash · резерв: Nemotron 3.5 Lightning</span></div>
          <p>Після твоєї згоди помічник передасть NVIDIA повідомлення чату та скорочений фінансовий підсумок: назви категорій і загальні суми. Якщо GLM не відповість вчасно або буде недоступний, запит отримає резервний помічник NVIDIA Nemotron. Назви рахунків, номери карток, ідентифікатори, нотатки та імена людей у боргах не передаються автоматично.</p>
          <p>Не вписуй секретні або особисті дані в повідомлення. Завершені розмови приватно зберігаються в Supabase у твоєму обліковому записі та доступні між сеансами й пристроями. Видалити окрему розмову можна кнопкою кошика. Це не відкликає вже передані NVIDIA дані. Старі чати, які були лише в пам’яті сторінки, відновити неможливо.</p>
          <label className="assistant-consent-check"><input type="checkbox" checked={consent} disabled={hide || sending} onChange={event => { setConsent(event.target.checked); setError(''); }}/><span>Дозволяю надсилати ці дані до NVIDIA для відповідей у чаті.</span></label>
        </div>}
        <div className="assistant-messages" role="log" aria-label="Повідомлення помічника" aria-live="polite" aria-relevant="additions text" aria-busy={sending}>
          {hide ? <div className="assistant-chat-empty"><LockKeyhole size={27}/><h3>Чат приховано</h3><p>Текст повідомлень і чернетка знову з’являться після вимкнення режиму приватності.</p></div> : threadLoading || historyLoading ? <div className="assistant-chat-empty"><RefreshCw size={25}/><h3>Завантажую розмови…</h3></div> : threadError ? <div className="assistant-history-error" role="alert"><p>{threadError}</p><button className="button secondary" onClick={() => void openThread(selected?.id ?? null)}>Повторити завантаження</button></div> : messages.length ? messages.map((message, index) => <article className={`assistant-message ${message.role}`} key={index}><strong>{message.role === 'user' ? 'Ти' : message.model === 'nvidia/nemotron-3.5-lightning-30b-a3b' ? 'Помічник · резерв NVIDIA Nemotron' : message.model === 'z-ai/glm-5.3-flash' ? 'Помічник · NVIDIA GLM' : 'Помічник'}</strong><p>{message.content}</p></article>) : <div className="assistant-chat-empty"><MessageCircle size={29}/><h3>{demo ? 'Почни з локального плану' : 'З чого почнемо?'}</h3><p>{demo ? 'Обери день, тиждень або місяць у блоці планування.' : 'Попроси пояснити витрати, знайти можливості для економії або допомогти з фінансовою звичкою.'}</p></div>}
          {sending && !hide && <p className="assistant-thinking">Помічник готує відповідь…</p>}
          <div ref={bottom}/>
        </div>
        {!demo && <>
          {!hide && pendingSave && <div className="assistant-save-notice" role={saveError ? 'alert' : 'status'}><LockKeyhole size={17}/><div><strong>{historySaving ? 'Зберігаю розмову…' : 'Відповідь ще не збережена'}</strong><p>{saveError || 'Дочекайся збереження перед наступним повідомленням.'}</p>{!historySaving && <button className="button secondary" onClick={() => void persistChat(pendingSave, request.current)}><RefreshCw size={14}/>Повторити збереження</button>}{!historySaving && saveError && selected && <button className="text-button" onClick={() => setDiscardTarget({ id: selected.id })}>Завантажити збережений чат</button>}</div></div>}
          {!hide && messages.length >= 200 && <p className="assistant-history-state">Ліміт цього чату — 200 повідомлень. Продовж у новому чаті.</p>}
          {!messages.length && !hide && !threadLoading && !threadError && <div className="assistant-prompts" aria-label="Приклади запитів">{prompts.map(prompt => <button key={prompt} disabled={busy || sending || saving || historyLoading || !historyReady} onClick={() => setDraft(prompt)}>{prompt}<ArrowUp size={14}/></button>)}</div>}
          <form className="assistant-composer" onSubmit={send}>
            <label htmlFor="assistant-draft">Твоє повідомлення</label>
            <textarea id="assistant-draft" value={hide ? '' : draft} onChange={event => setDraft(event.target.value)} maxLength={1000} rows={3} disabled={hide || sending || busy || saving || historySaving || deleting || !!pendingSave || !historyReady || historyLoading || threadLoading || !!threadError || messages.length >= 200 || (!selected && threads.length >= 100)} placeholder={hide ? 'Чернетку приховано' : 'Наприклад: як краще розподілити залишок на місяць?'} aria-describedby="assistant-input-note"/>
            <div className="assistant-composer-footer"><small id="assistant-input-note">{hide ? 'Текст приховано' : `${draft.length} / 1000`}{!consent && !hide && ' · Для надсилання потрібна згода'}</small>{sending ? <button type="button" className="button secondary" onClick={() => cancel()}><Square size={14}/>Зупинити</button> : <button className="button primary" disabled={hide || busy || saving || historySaving || deleting || !!pendingSave || !historyReady || historyLoading || threadLoading || !!threadError || messages.length >= 200 || (!selected && threads.length >= 100) || !consent || !ownerId || !draft.trim()}><ArrowUp size={17}/>Надіслати</button>}</div>
          </form>
          {!hide && error && <div className="form-error" role="alert">{error}</div>}
          <p className="assistant-disclaimer">Відповіді AI можуть містити помилки. Перевіряй розрахунки перед фінансовими рішеннями. Чат самостійно не змінює бюджет.</p>
        </>}
      </section>
      </div>
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
    <Modal open={!!discardTarget && !hide} title="Залишити поточний чат?" onClose={() => setDiscardTarget(null)}>
      <div className="assistant-history-dialog"><p>{pendingSave ? 'Останню відповідь ще не збережено. Якщо продовжити, незбережений текст буде втрачено. Можеш скасувати й повторити збереження.' : sending ? 'Помічник ще готує відповідь. Якщо продовжити, запит зупиниться, а чернетку буде очищено.' : 'Чернетку цього повідомлення не збережено. Якщо продовжити, її буде очищено.'}</p><div className="form-footer"><button className="button secondary" onClick={() => setDiscardTarget(null)}>Залишитися</button><button className="button primary" disabled={historySaving || deleting} onClick={() => { const target = discardTarget; setDiscardTarget(null); if (target) void openThread(target.id); }}>Продовжити без збереження</button></div></div>
    </Modal>
    <Modal open={deleteOpen && !hide} title="Видалити цей чат?" onClose={() => { if (!deleting) setDeleteOpen(false); }}>
      <div className="assistant-history-dialog"><p>Усі повідомлення вибраної розмови буде остаточно видалено з твого облікового запису. Інші чати залишаться. Відновити видалений чат неможливо.</p>{pendingSave && <p>Незбережена відповідь у цій розмові теж буде втрачена.</p>}{deleteError && <div className="form-error" role="alert">{deleteError}</div>}<div className="form-footer"><button className="button secondary" disabled={deleting} onClick={() => setDeleteOpen(false)}>Скасувати</button><button className="button assistant-delete-confirm" disabled={deleting || historySaving} onClick={() => void confirmDelete()}><Trash2 size={15}/>{deleting ? 'Видаляю…' : 'Видалити чат'}</button></div></div>
    </Modal>
    <Modal open={!!preview && !hide} title="Підтвердити місячні ліміти" onClose={() => { if (!saving) setPreview(null); }}>
      {preview && !hide && <div className="assistant-plan-preview"><p>Новий ліміт кожної категорії дорівнює вже витраченому за місяць плюс запропонований залишок. Наявні ліміти поточного місяця буде замінено цим планом. Категорії з нульовим новим лімітом не матимуть ліміту.</p><p>Це змінить лише ліміти бюджету. Гроші не списуються та не резервуються.</p><div className="assistant-preview-rows">{preview.items.map(item => <div key={item.categoryId}><strong>{categoryName(state, item.categoryId)}</strong><span>Додатково: <Amount value={item.amount} hide={hide}/></span><span>Новий ліміт: <Amount value={(previewSpent[item.categoryId] || 0) + item.amount} hide={hide}/></span></div>)}</div>{planError && <div className="form-error" role="alert">{planError}</div>}<div className="form-footer"><button className="button secondary" disabled={saving} onClick={() => setPreview(null)}>Скасувати</button><button className="button primary" disabled={busy || saving || sending || hide} onClick={confirmPlan}>{saving ? 'Зберігаю…' : 'Підтвердити зміни'}</button></div></div>}
    </Modal>
  </div>;
}
