import { useEffect, useRef, useState } from 'react';
import type { EvidenceRef } from '../../lib/reviewSchema';
import { SCHEMA_VERSION } from '../../lib/reviewSchema';
import { PROMPT_VERSION } from '../../lib/reviewPrompt';
import { evidenceBlocks } from '../../lib/contextBuilder';
import type { ReviewSnapshot } from '../../lib/types';
import { CaptureError, type PanelMessage } from '../../lib/messages';
import { PageReader } from '../../lib/pageReader';
import { BUILD_VERSION } from '../../lib/readerProtocol';
import { assertInput, fingerprint, makeManual } from '../../lib/snapshot';
import { DEFAULT_MODEL, reviewWithDeepSeek } from '../../lib/deepseek';
import { ReviewController } from '../../lib/reviewController';
import { AutoReview } from '../../lib/autoReview';
import { PanelConnection } from '../../lib/panelConnection';
import { loadSettings, saveSettings, KEY_STORAGE, MODEL_STORAGE } from '../../lib/settings';
import { lightweightDemo as demoReview, lightweightDemoInput as demoInput } from '../../fixtures/lightweight';
import { validateReview, type ValidatedReview } from '../../lib/validateReview';
import { reviewDiagnostic, type ReviewDiagnostic } from '../../lib/parseReview';
import ReviewResult, { ReviewEvidence, briefText, reviewText } from '../../components/ReviewResult';
import { aiSite, isPageSource, siteLabel } from '../../lib/sites';
import { WEB_ENABLED, WEB_ORIGINS, webUrl } from '../../lib/webMode';
import { webGuideWithDeepSeek, webGuideText, type WebGuide } from '../../lib/webGuide';
import WebGuideResult from '../../components/WebGuideResult';
import { makeSelection, selectionSchema, SELECTION_READY, TAKE_SELECTION, type SelectionRequest } from '../../lib/selection';

type Mode = 'manual' | 'chatgpt_dom' | 'selection' | 'demo';
type Status = 'idle' | 'waiting' | 'running' | 'done' | 'error' | 'cancelled' | 'stale';
type WithoutRequest<T> = T extends unknown ? Omit<T, 'requestId'> : never;
type AutoResult = { response: { review?: ValidatedReview; guide?: WebGuide; model?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }; seconds: string };
const errorText = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试。';
const pageKey = (s: ReviewSnapshot) => `${s.tabId}:${s.pageUrl}`;
const meta = (r: AutoResult, model: string) => `${r.response.model || model} · 1 次调用 ${r.seconds} 秒${r.response.usage?.inputTokens !== undefined ? ` · 输入 ${r.response.usage.inputTokens} tokens` : ''}${r.response.usage?.outputTokens !== undefined ? ` · 输出 ${r.response.usage.outputTokens} tokens` : ''}${r.response.usage?.inputTokens === undefined && r.response.usage?.outputTokens === undefined ? ' · 未返回完整用量' : ''}`;

export default function App() {
  const [mode, setMode] = useState<Mode>('chatgpt_dom');
  const [webAccess, setWebAccess] = useState(false), [webEnabled, setWebEnabled] = useState(true), [webReady, setWebReady] = useState(false);
  const [currentWeb, setCurrentWeb] = useState(false), [guide, setGuide] = useState<WebGuide | null>(null);
  const [autoEnabled, setAutoEnabled] = useState(true), [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectionReady, setSelectionReady] = useState(false);
  const [selectionToRun, setSelectionToRun] = useState<SelectionRequest | null>(null);
  const selectionRef = useRef<SelectionRequest | null>(null);
  const [question, setQuestion] = useState(''), [context, setContext] = useState(''), [answer, setAnswer] = useState('');
  const [missing, setMissing] = useState(false), [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [extra, setExtra] = useState<{ page: string; context: string; missing: boolean } | null>(null);
  const [review, setReview] = useState<ValidatedReview | null>(null), [status, setStatus] = useState<Status>('waiting');
  const [message, setMessage] = useState('正在准备自动审阅…'), [settingsOpen, setSettingsOpen] = useState(false);
  const [key, setKey] = useState(''), [model, setModel] = useState(DEFAULT_MODEL);
  const [draftKey, setDraftKey] = useState(''), [draftModel, setDraftModel] = useState(DEFAULT_MODEL), [showKey, setShowKey] = useState(false);
  const [elapsed, setElapsed] = useState(0), [resultMeta, setResultMeta] = useState('');
  const [copyFallback, setCopyFallback] = useState(''), [notice, setNotice] = useState(''), [originalOpen, setOriginalOpen] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [readerVersion, setReaderVersion] = useState('');
  const [diagnostic, setDiagnostic] = useState<ReviewDiagnostic | null>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => { if (menuRef.current) menuRef.current.open = false; };
  const reader = useRef<PageReader | null>(null);
  if (!reader.current) reader.current = new PageReader(setReaderVersion);
  const controller = useRef(new ReviewController()), revision = useRef(0), busyRef = useRef(false);
  const marksRevision = useRef(0);
  const snapshotRef = useRef<ReviewSnapshot | null>(null), modeRef = useRef(mode), enabledRef = useRef(autoEnabled);
  modeRef.current = mode; enabledRef.current = autoEnabled;
  const windowId = useRef<number | null>(null), autoTab = useRef<number | null>(null), connection = useRef<PanelConnection | null>(null);
  const automatic = useRef<AutoReview<AutoResult> | null>(null);
  const setSource = (s: ReviewSnapshot | null) => {
    const previousTab = snapshotRef.current?.tabId;
    if (previousTab != null && previousTab !== s?.tabId) void reader.current!.send(previousTab, { type: 'RELEASE' }).catch(() => {});
    snapshotRef.current = s; setSnapshot(s);
  };
  const stop = () => { revision.current++; controller.current.cancel(); busyRef.current = false; };
  const clearResult = () => { setReview(null); setGuide(null); setResultMeta(''); setCopyFallback(''); setNotice(''); setOriginalOpen(false); setDiagnostic(null); };
  const invalidate = () => { stop(); clearResult(); setStatus('idle'); setMessage(''); };
  const send = <T,>(tabId: number, payload: WithoutRequest<PanelMessage>): Promise<T> => reader.current!.send<T>(tabId, payload);
  const verifySource = async (s: ReviewSnapshot) => {
    if (!isPageSource(s.source) || s.tabId === null) return;
    const [tab] = await chrome.tabs.query({ active: true, windowId: s.windowId! });
    if (tab?.id !== s.tabId) throw new CaptureError('STALE_SNAPSHOT', '来源标签页已切换，正在等待当前对话。');
    await send(s.tabId, { type: 'VALIDATE_SNAPSHOT', snapshotId: s.snapshotId });
  };

  useEffect(() => {
    let mounted = true;
    const permissionsChanged = () => { void chrome.permissions.contains({ origins: WEB_ORIGINS }).then(value => { if (mounted) setWebAccess(value); }); };
    void Promise.all([chrome.permissions.contains({ origins: WEB_ORIGINS }), chrome.storage.local.get(WEB_ENABLED)]).then(([allowed, stored]) => {
      if (mounted) { setWebAccess(allowed); setWebEnabled(stored[WEB_ENABLED] !== false); setWebReady(true); }
    }).catch(() => { if (mounted) setWebReady(true); });
    chrome.permissions.onAdded.addListener(permissionsChanged); chrome.permissions.onRemoved.addListener(permissionsChanged);
    const takeSelection = async () => {
      try {
        const win = await chrome.windows.getCurrent(); windowId.current = win.id ?? null;
        if (!mounted) return;
        const raw = await chrome.runtime.sendMessage({ type: TAKE_SELECTION, windowId: win.id });
        if (!mounted || !raw) return;
        const parsed = selectionSchema.safeParse(raw); if (!parsed.success) return;
        const request = parsed.data;
        automatic.current?.pause(); invalidate();
        selectionRef.current = request; modeRef.current = 'selection'; setMode('selection');
        setSource(null); setQuestion(''); setContext(''); setMissing(false); setAnswer(request.text); setExtra(null);
        setInputOpen(!!request.error); setSelectionToRun(request.error ? null : request);
        if (request.error) { setStatus('error'); setMessage(request.error); }
        else { setStatus('waiting'); setMessage('已读取选中文字，正在准备审阅…'); }
      } catch { if (mounted) { setStatus('error'); setMessage('选区接收未连接，请重新加载扩展后再试。'); } }
      finally { if (mounted) setSelectionReady(true); }
    };
    const selectionMessage = (message: { type?: string; windowId?: number }, sender: chrome.runtime.MessageSender) => {
      if (sender.id === chrome.runtime.id && message?.type === SELECTION_READY && message.windowId === windowId.current) {
        void takeSelection();
      }
    };
    chrome.runtime.onMessage.addListener(selectionMessage);
    void takeSelection();
    void loadSettings().then(s => { if (mounted) { setKey(s.key); setDraftKey(s.key); setModel(s.model); setDraftModel(s.model); setReady(true); } }).catch(() => { if (mounted) { setStatus('error'); setMessage('无法读取扩展设置，请从 Chrome 扩展侧栏打开。'); } });
    void chrome.windows.getCurrent().then(w => { windowId.current = w.id ?? null; });
    const channel = new PanelConnection(); connection.current = channel;
    const sourceChanged = () => {
      if (modeRef.current !== 'chatgpt_dom') return;
      if (enabledRef.current) { automatic.current?.invalidate(); void automatic.current?.tick(); }
      else if (snapshotRef.current) { setStatus('stale'); setMessage('原文已变化。恢复自动审阅后更新结果。'); }
    };
    const active = (info: { windowId: number }) => { if (info.windowId === windowId.current) sourceChanged(); };
    const updated = (id: number, info: { status?: string; url?: string }) => {
      if (info.status === 'loading') { reader.current?.forget(id); if (id === autoTab.current) setReaderVersion(''); }
      if (id === autoTab.current && (info.status === 'loading' || info.url)) sourceChanged();
    };
    const removed = (id: number) => { reader.current?.forget(id); if (autoTab.current === id) sourceChanged(); };
    const storageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[WEB_ENABLED]) setWebEnabled(changes[WEB_ENABLED].newValue !== false);
      const keyChange = area === 'session' ? changes[KEY_STORAGE] : undefined;
      const modelChange = area === 'local' ? changes[MODEL_STORAGE] : undefined;
      if ((keyChange && keyChange.newValue !== keyChange.oldValue) || (modelChange && modelChange.newValue !== modelChange.oldValue)) {
        automatic.current?.pause(); invalidate();
        if (keyChange) { const value = typeof keyChange.newValue === 'string' ? keyChange.newValue : ''; setKey(value); setDraftKey(value); }
        if (modelChange) { const value = typeof modelChange.newValue === 'string' ? modelChange.newValue : DEFAULT_MODEL; setModel(value); setDraftModel(value); }
      }
    };
    chrome.tabs.onActivated.addListener(active); chrome.tabs.onUpdated.addListener(updated); chrome.tabs.onRemoved.addListener(removed); chrome.storage.onChanged.addListener(storageChanged);
    const unload = () => { controller.current.cancel(); automatic.current?.pause(); channel.dispose(); };
    window.addEventListener('pagehide', unload);
    return () => { mounted = false; stop(); automatic.current?.pause(); channel.dispose(); if (connection.current === channel) connection.current = null; window.removeEventListener('pagehide', unload); chrome.runtime.onMessage.removeListener(selectionMessage); chrome.tabs.onActivated.removeListener(active); chrome.tabs.onUpdated.removeListener(updated); chrome.tabs.onRemoved.removeListener(removed); chrome.storage.onChanged.removeListener(storageChanged); chrome.permissions.onAdded.removeListener(permissionsChanged); chrome.permissions.onRemoved.removeListener(permissionsChanged); };
  }, []);

  useEffect(() => {
    if (mode !== 'chatgpt_dom' || !ready || !selectionReady || !webReady || saving) return;
    if (!key) { setStatus('waiting'); setMessage('填写一次 DeepSeek API Key，即可自动读取并审阅当前回答。'); setSource(null); clearResult(); return; }
    const loop = new AutoReview<AutoResult>({
      scan: async () => {
        const win = await chrome.windows.getCurrent(); windowId.current = win.id ?? null;
        const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
        if (!tab?.id) throw new CaptureError('NOT_AI_SITE', '请打开需要阅读的网页。');
        const ai = aiSite(tab.url); setCurrentWeb(!ai);
        if (!ai && (!webAccess || !webEnabled)) throw new CaptureError('WEB_PERMISSION', '开启网页导读后，文章会自动生成阅读地图；也可右键选择“审阅选中文字”。');
        if (!ai && !webUrl(tab.url)) throw new CaptureError('NO_ARTICLE', '请打开文章、新闻或长文。浏览器内置页面无法读取。');
        if (tab.status === 'loading') throw new CaptureError('GENERATING', '正在加载页面，正文稳定后自动处理。');
        autoTab.current = tab.id; connection.current?.track(tab.id);
        const captured = await send<ReviewSnapshot>(tab.id, { type: 'CAPTURE' });
        const s = { ...captured, tabId: tab.id, windowId: win.id! };
        if (extra?.page === pageKey(s)) { s.additionalContext = extra.context; s.scope = { ...s.scope, userReportsMissingContext: extra.missing }; }
        await verifySource(s); assertInput(s.question, s.additionalContext, s.blocks);
        return s;
      },
      identify: async s => `${s.tabId}:${s.documentSessionId}:${await fingerprint(s, model)}`,
      review: async (s, signal) => { const started = Date.now(); const response = await (s.source === 'webpage_dom' ? webGuideWithDeepSeek(s, key, model, signal) : reviewWithDeepSeek(s, key, model, signal)); return { response, seconds: ((Date.now() - started) / 1000).toFixed(1) }; },
      verify: verifySource,
      changed: state => {
        setStatus(state.status); setMessage(state.message); setCopyFallback('');
        const issues = state.result?.response.review?.formatIssues;
        setDiagnostic(state.diagnostic ?? (issues?.length ? { code: 'REVIEW_FORMAT', issues } : null));
        if (state.status === 'running' || !state.snapshot) { setOriginalOpen(false); setNotice(''); }
        if (state.snapshot) {
          const s = state.snapshot;
          if (!snapshotRef.current || pageKey(snapshotRef.current) !== pageKey(s)) { setContext(s.additionalContext); setMissing(s.scope.userReportsMissingContext); }
          setSource(s); setQuestion(s.question); setAnswer(s.blocks.map(b => b.text).join('\n\n'));
        } else { setSource(null); setQuestion(''); setAnswer(''); }
        if (state.result) { setReview(state.result.response.review ?? null); setGuide(state.result.response.guide ?? null); setResultMeta(meta(state.result, model)); }
        else { setReview(null); setGuide(null); setResultMeta(''); }
        if (state.status === 'running') setElapsed(0);
      },
    });
    automatic.current = loop;
    if (enabledRef.current) { loop.resume(); void loop.tick(); }
    const timer = setInterval(() => { void loop.tick(); }, 2000);
    return () => { loop.pause(); clearInterval(timer); if (automatic.current === loop) automatic.current = null; };
  }, [mode, ready, selectionReady, webReady, webAccess, webEnabled, key, model, extra, saving]);

  useEffect(() => {
    if (mode !== 'selection' || !selectionToRun || !ready || saving) return;
    if (!key) { setSettingsOpen(true); setInputOpen(true); setMessage('已保留选中文字，填写 DeepSeek API Key 后开始审阅。'); return; }
    setSelectionToRun(null);
    void start(selectionToRun);
  }, [mode, selectionToRun, ready, key, saving]);

  useEffect(() => {
    if (autoEnabled) { automatic.current?.resume(); void automatic.current?.tick(); }
    else { automatic.current?.pause(); setStatus('cancelled'); setMessage('自动审阅已暂停，不会读取或提交新回答。'); }
  }, [autoEnabled]);
  useEffect(() => {
    if (status !== 'running') return;
    const started = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (!notice || copyFallback) return;
    const timer = setTimeout(() => setNotice(''), 2600);
    return () => clearTimeout(timer);
  }, [notice, copyFallback]);

  const switchMode = (next: Mode) => { automatic.current?.pause(); invalidate(); setSelectionToRun(null); selectionRef.current = null; modeRef.current = next; setSource(null); setMode(next); setInputOpen(next === 'manual'); setContext(''); setMissing(false); };
  const edit = (setter: (s: string) => void, value: string) => { invalidate(); if (mode === 'demo') { setMode('manual'); setSource(null); } setter(value); };
  async function demo() {
    switchMode('demo'); const rev = revision.current;
    const s = await makeManual(demoInput.question, '', demoInput.answer, false, 'demo');
    if (rev !== revision.current) return;
    setQuestion(demoInput.question); setAnswer(demoInput.answer); setSource(s);
    setReview(validateReview(demoReview, s)); setStatus('done'); setResultMeta('固定公开样例 · 未调用模型');
  }
  async function start(incoming?: SelectionRequest) {
    if (busyRef.current || mode === 'chatgpt_dom') return;
    if (!key) { setSettingsOpen(true); setStatus('error'); setMessage('请先填写 DeepSeek API Key，或体验演示样例。'); return; }
    invalidate(); const rev = revision.current; busyRef.current = true; setStatus('running'); setElapsed(0);
    const started = Date.now();
    try {
      if (question.length + context.length + answer.length > 30000) throw new Error('输入超过 30,000 字符，请缩短或选择片段；不会静默截断。');
      const selected = incoming || (mode === 'selection' ? selectionRef.current : null);
      const s = selected ? await makeSelection(selected, question, context, missing) : await makeManual(question, context, answer, missing);
      const fp = await fingerprint(s, model);
      if (rev !== revision.current) return;
      setSource(s); const run = controller.current.begin(fp);
      const response = await reviewWithDeepSeek(s, key, model, run.abort.signal);
      if (!controller.current.isCurrent(run) || rev !== revision.current) return;
      setReview(response.review); setInputOpen(false); setStatus('done');
      setDiagnostic(response.review.formatIssues.length ? { code: 'REVIEW_FORMAT', issues: response.review.formatIssues } : null);
      setResultMeta(meta({ response, seconds: ((Date.now() - started) / 1000).toFixed(1) }, model));
    } catch (e) { if (rev === revision.current) { setStatus('error'); setMessage(errorText(e)); setDiagnostic(reviewDiagnostic(e) ?? null); if (mode === 'selection') setInputOpen(true); } }
    finally { if (rev === revision.current) busyRef.current = false; }
  }
  async function locate(evidence: EvidenceRef) {
    const s = snapshotRef.current; if (!s || status === 'stale') return;
    const token = ++marksRevision.current;
    try {
      if (isPageSource(s.source) && s.tabId !== null && evidence.blockId.startsWith('b')) { await verifySource(s); if (token !== marksRevision.current) return; const located = await send<{precision:string}>(s.tabId, { type: 'LOCATE_BLOCK', snapshotId: s.snapshotId, ...evidence }); if (token === marksRevision.current && located.precision === 'block') setNotice('已定位到段落；无法唯一标记该原句，请结合侧栏引文查看。'); }
      else { setOriginalOpen(true); setTimeout(() => { const el = document.getElementById(`original-${evidence.blockId}`); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); el?.focus(); el?.classList.add('located'); setTimeout(() => el?.classList.remove('located'), 2000); }, 0); }
    } catch (e) { if (token !== marksRevision.current || e instanceof CaptureError && e.code === 'MARKS_CANCELLED') return; if (e instanceof CaptureError && e.code === 'BLOCK_NOT_FOUND') { setNotice('已在侧栏打开对应原文。'); setOriginalOpen(true); setTimeout(() => document.getElementById(`original-${evidence.blockId}`)?.scrollIntoView({ block: 'center' }), 0); } else { setStatus('stale'); setMessage(errorText(e)); if (autoEnabled) automatic.current?.invalidate(); } }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setNotice('已复制。'); setCopyFallback(''); } catch { setCopyFallback(text); setNotice('自动复制失败，请选中下方文字手动复制。'); } }
  async function save() {
    if (!draftModel.trim()) { setNotice('模型名不能为空。'); return; }
    automatic.current?.pause(); invalidate(); setSaving(true);
    try {
      await saveSettings(draftKey, draftModel);
      setKey(draftKey.trim()); setModel(draftModel.trim());
      setSettingsOpen(false); setNotice('设置已保存。自动模式会在回答完成后开始审阅。');
    } catch { setNotice('设置保存失败，请重新加载扩展后重试。'); }
    finally { setSaving(false); }
  }
  async function clearKey() { try { await chrome.storage.session.remove(KEY_STORAGE); setKey(''); setDraftKey(''); setNotice('密钥已清除。'); } catch { setNotice('密钥清除失败，请重新加载扩展后重试。'); } }
  async function enableWeb() {
    // Request directly from the click gesture. All subsequent article visits are automatic.
    try {
      const allowed = await chrome.permissions.request({ origins: WEB_ORIGINS });
      setWebAccess(allowed);
      if (allowed) { await chrome.storage.local.set({ [WEB_ENABLED]: true }); setWebEnabled(true); reader.current = new PageReader(setReaderVersion); }
      else setNotice('未开启网页访问。AI 网站自动审阅仍可使用。');
    } catch { setNotice('网页访问未开启，请在扩展的网站访问权限中检查设置。'); }
  }
  const chars = question.length + context.length + answer.length;
  const auto = mode === 'chatgpt_dom';
  const web = auto && currentWeb;
  return <main className={web ? 'web-mode' : undefined}>
    <header><h1>{web ? '网页导读' : 'Review'}</h1><div className="header-actions">
      <button className="text-button" disabled={!review && !guide} onClick={() => guide && snapshot ? copy(webGuideText(guide, snapshot)) : review && copy(reviewText(review))} aria-label={web ? '复制网页导读' : '复制审阅结果'}>复制</button>
      <details className="more-menu" ref={menuRef}><summary aria-label="更多">···</summary><div className="menu-content">
        <button className="text-button" onClick={() => { setSettingsOpen(!settingsOpen); closeMenu(); }}>设置</button>
        {webAccess && <button className="text-button" onClick={() => { void chrome.storage.local.set({ [WEB_ENABLED]: !webEnabled }); closeMenu(); }}>{webEnabled ? '关闭网页自动导读' : '开启网页自动导读'}</button>}
        {auto ? <><button className="text-button" onClick={() => { if (autoEnabled) automatic.current?.pause(); setAutoEnabled(!autoEnabled); closeMenu(); }}>{autoEnabled ? '暂停' : '恢复'}</button>{key && autoEnabled && snapshot && (status === 'done' || status === 'error') && <button className="text-button" onClick={() => { automatic.current?.retry(); void automatic.current?.tick(); closeMenu(); }}>{status === 'error' ? '重试' : '重新生成'}</button>}</> : <button className="text-button" onClick={() => { switchMode('chatgpt_dom'); closeMenu(); }}>返回自动</button>}
        {review && <button className="text-button" onClick={() => { void copy(briefText(review)); closeMenu(); }}>仅复制简写</button>}
        {(snapshot || !auto) && <button className="text-button" onClick={() => { setInputOpen(!inputOpen); closeMenu(); }}>材料与补充上下文</button>}
        {(mode === 'manual' || mode === 'selection') && review && <button className="text-button" onClick={() => { void start(); closeMenu(); }}>重新生成</button>}
        <button className="text-button" onClick={() => { void demo(); closeMenu(); }}>演示样例</button>
        <button className="text-button" onClick={() => { switchMode('manual'); closeMenu(); }}>手动粘贴</button>
        <details className="result-meta"><summary>运行详情</summary>
          <p>{mode === 'demo' ? '固定模拟样例 · 未调用模型' : mode === 'selection' ? '仅审阅主动选择的网页片段' : !auto ? '手动输入' : !autoEnabled ? '已暂停' : web ? '自动跟随当前网页正文' : `${snapshot ? siteLabel(snapshot.source) + ' · ' : ''}自动跟随最新回答`}</p>
          {resultMeta && <p>{resultMeta}</p>}
          {review && <p>结果状态：{review.integrity === 'partial' ? 'Partial · 部分结果' : 'Complete · 完整结果'}；不代表事实核验。</p>}
          {review && <p>原文 {review.sourceChars} 字 · 简写 {review.briefChars} 字 · 简评 {review.assessmentChars} 字{review.presentation === 'brief' ? ` · 正文压缩 ${Math.round((1 - (review.briefChars + review.assessmentChars) / review.sourceChars) * 100)}%` : ' · 保留原文'}</p>}
          {!!review?.omittedAssessments && <p>简评结构或引用未通过校验，已隐藏；其余可用内容保留。</p>}
          {!!review?.formatRepairs && <p>返回格式差异已在本机兼容处理，未重复调用模型。</p>}
          {diagnostic && <><p>格式检查：{diagnostic.issues.map(i => `${i.field} (${i.rule})`).join('；')}</p><button className="text-button" onClick={() => { void copy(JSON.stringify({version:BUILD_VERSION,prompt:PROMPT_VERSION,schema:SCHEMA_VERSION,...diagnostic},null,2)); closeMenu(); }}>复制错误信息</button><p>仅包含版本、字段位置和错误类别，不含原文、模型正文或密钥。</p></>}
          <p>界面 {BUILD_VERSION} · 扩展 {chrome.runtime.getManifest().version} · 采集 {readerVersion || '等待连接'}</p><p>{web ? 'web-guide/1.0' : PROMPT_VERSION} · {web ? 'web-guide-1' : SCHEMA_VERSION}</p>
          <p>简写转述原回答；简评仅基于文本，未核实外部事实。原句匹配不代表判断正确。</p>
          {snapshot && !snapshot.question.trim() && mode !== 'selection' && !web && <p>未获取原始问题，无法判断回答是否切题。</p>}
          {snapshot?.scope.userReportsMissingContext && <p>你已标记有前文或附件未包含。</p>}{snapshot?.scope.extractionWarnings?.map((warning, i) => <p key={i}>{warning}</p>)}
        </details>
      </div></details>
    </div></header>
    {mode === 'selection' && <div className="selection-source"><span>网页选中文字 · 仅审阅选区</span><button className="text-button" onClick={() => switchMode('chatgpt_dom')}>返回自动</button>{snapshot?.pageUrl && <a href={snapshot.pageUrl} target="_blank" rel="noreferrer noopener">{new URL(snapshot.pageUrl).hostname} ↗</a>}</div>}
    {settingsOpen && <section className="card settings"><h2>模型与密钥</h2><label>DeepSeek API Key<div className="key-row"><input type={showKey ? 'text' : 'password'} value={draftKey} autoComplete="off" spellCheck={false} onChange={e => setDraftKey(e.target.value)} /><button onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button></div></label><label>模型名<input value={draftModel} onChange={e => setDraftModel(e.target.value)} /></label><p className="hint">自动模式将当前问答或识别出的网页正文发送给 DeepSeek；右键审阅仅发送选中文字。每次审阅一次调用，不自动重试，会产生 API 费用。密钥仅在本次浏览器会话中保存。</p><a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer noopener">获取 API Key ↗</a><div className="button-row"><button className="primary" onClick={save} disabled={saving}>保存设置</button><button className="secondary" onClick={clearKey} disabled={saving}>清除密钥</button></div></section>}
    {mode === 'demo' && <p className="demo-banner">模拟演示 · 未调用模型</p>}
    {web && (!webAccess || !webEnabled) && <section className="web-welcome"><h2>打开文章，导读随行。</h2><p>自动识别正文，整理主旨和阅读地图。无需选中文字。</p><button className="primary" onClick={enableWeb}>开启网页导读</button><p className="hint">首次授权网页访问后生效。仅在侧栏打开时，将当前网页正文发送给已配置的 DeepSeek。</p></section>}
    {status === 'running' && <p role="status" className="status">{web ? '正在绘制阅读地图' : '正在简写'} · {elapsed} 秒</p>}
    {auto && !key && ready && <section className="empty-state"><h2>长回答，先看结论。</h2><p className="hint">关键要点、必要的下一步，加一句有依据的简评。</p><button className="primary" onClick={() => setSettingsOpen(true)}>配置 API Key</button></section>}
    {message && status !== 'done' && status !== 'running' && !(auto && ready && !key) && <div role={status === 'error' || status === 'stale' ? 'alert' : 'status'} className={`status ${status}`}>{status === 'error' ? 'Failed · ' : ''}{message}</div>}
    {notice && <div role="status" className="status">{notice}</div>}
    {review && snapshot && <ReviewResult key={review.reviewId} review={review} snapshot={snapshot} stale={status === 'stale'} onLocate={locate} onCopy={copy} />}
    {guide && snapshot?.page && <WebGuideResult guide={guide} snapshot={snapshot} stale={status === 'stale'} onLocate={locate} />}
    {copyFallback && <label className="copy-fallback">手动复制<textarea readOnly value={copyFallback} rows={4} onFocus={e => e.target.select()} /></label>}
    {snapshot && <details className="utility originals" open={originalOpen} onToggle={e => setOriginalOpen(e.currentTarget.open)}><summary>对照原文</summary>
      {review && <ReviewEvidence review={review} snapshot={snapshot} stale={status === 'stale'} onLocate={locate} onCopy={copy} />}
      <h3>{mode === 'selection' ? '所选原文' : web ? '已读取的正文' : '完整原文'}</h3>{evidenceBlocks(snapshot).map(b => <div key={b.id} id={`original-${b.id}`} className="original-block" tabIndex={-1}><span className="eyebrow">{b.id.startsWith('p') ? '原始问题' : b.id.startsWith('x') ? '补充材料' : (mode === 'selection' ? '选区段落 ' : web ? '正文段落 ' : '回答段落 ') + b.id.slice(1)}</span><pre>{b.text}</pre>{b.links.map(c => <a key={c.url} href={c.url} target="_blank" rel="noreferrer noopener">{c.label} ↗</a>)}</div>)}
    </details>}
    {(snapshot || !auto) && inputOpen && <section className="utility input-card">
      <div className="section-heading"><h2>材料与补充上下文</h2><button className="text-button" onClick={() => setInputOpen(false)}>收起材料</button></div>
      <div>
        {!web && <label>原始要求 <span className="optional">可选</span><textarea rows={3} value={question} readOnly={auto} placeholder="你希望 AI 回答什么？" onChange={e => edit(setQuestion, e.target.value)} /></label>}
        <label>补充上下文 <span className="optional">可选</span><textarea id="supplemental-context" rows={2} value={context} placeholder="补充与这条回答相关的前文或附件节选。" onChange={e => auto ? setContext(e.target.value) : edit(setContext, e.target.value)} /></label>
        <label>{mode === 'selection' ? '所选文字' : web ? '网页正文' : 'AI 回复'}<textarea rows={5} value={answer} readOnly={auto || mode === 'selection'} placeholder="粘贴需要简写的回答" onChange={e => edit(setAnswer, e.target.value)} /></label>
        <div className="input-meta"><span className={chars > 30000 ? 'error-text' : ''}>{chars.toLocaleString()} / 30,000 字符</span></div>
        <label className="check"><input type="checkbox" checked={missing} onChange={e => { if (!auto) { invalidate(); if (mode === 'demo') { setMode('manual'); setSource(null); } } setMissing(e.target.checked); }} />有相关前文或附件未包含</label>
        <p className="scope">{mode === 'selection' ? '只审阅右键选中的文字；未读取整页。原句定位在侧栏所选原文中显示。' : web ? '只读取当前页面识别出的正文；评论、编辑内容、附件和引用网页不纳入导读。' : '只读取当前问答；前文、附件、引用网页不会自动读取。'}</p>
        {auto && snapshot && (context !== snapshot.additionalContext || missing !== snapshot.scope.userReportsMissingContext) && <p role="status" className="hint">补充尚未应用。应用后重新生成。</p>}
        {auto && snapshot && <button className="secondary" disabled={!autoEnabled || chars > 30000 || context === snapshot.additionalContext && missing === snapshot.scope.userReportsMissingContext} onClick={() => { automatic.current?.pause(); clearResult(); setExtra({ page: pageKey(snapshot), context, missing }); setInputOpen(false); }}>应用补充</button>}
      </div>
      {!auto && mode !== 'demo' && <div className="button-row"><button className="primary start" onClick={() => void start()} disabled={status === 'running' || !answer.trim()}>{status === 'running' ? `正在简写 · ${elapsed} 秒` : review ? '重新生成' : '生成简写与短评'}</button>{status === 'running' && <button className="secondary" onClick={() => { stop(); setStatus('cancelled'); setMessage('已取消本地等待；服务商仍可能处理或计费。'); }}>取消</button>}</div>}
    </section>}
  </main>;
}



