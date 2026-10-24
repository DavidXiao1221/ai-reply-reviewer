import { defineContentScript } from 'wxt/utils/define-content-script';
import { captureAI, extractAI } from '../adapters/aiSites';
import { captureWebPage, extractWebPage } from '../adapters/webpage';
import { documentUrl } from '../lib/webMode';
import { aiSite, AI_MATCHES } from '../lib/sites';
import { CaptureError, panelMessageSchema } from '../lib/messages';
import { sourceHash, normalize } from '../lib/snapshot';
import { quoteRange, OriginalHighlights } from '../lib/anchors';
import type { ReviewSnapshot } from '../lib/types';
import { emptyScope } from '../lib/types';
import { BUILD_VERSION, READER_CHANNEL } from '../lib/readerProtocol';

export default defineContentScript({
  matches: AI_MATCHES, runAt: 'document_idle', allFrames: false,
  main(ctx) {
    const pageUrl = () => aiSite(location.href) ? location.href : documentUrl(location.href);
    const extractCurrent = () => aiSite(location.href) ? extractAI(document) : extractWebPage(document);
    const documentSessionId = crypto.randomUUID();
    let snapshot: ReviewSnapshot | null = null;
    let elements = new Map<string, Element>(); let generation = 0;
    let root: Element | null = null, markGeneration = 0;
    let sourceObserver: MutationObserver | null = null;
    const highlights = new OriginalHighlights(document);
    const locateHighlights = new OriginalHighlights(document, 'reply-review-v2-locate');
    const clearMarks = () => { markGeneration++; highlights.clear(); locateHighlights.clear(); };
    const watchRoot = (next: Element) => {
      if (root === next && sourceObserver) return;
      sourceObserver?.disconnect(); root = next;
      sourceObserver = new MutationObserver(clearMarks);
      sourceObserver.observe(next, { subtree: true, childList: true, characterData: true });
    };
    const validate = async (id: string) => {
      if (!snapshot || snapshot.snapshotId !== id || snapshot.documentSessionId !== documentSessionId || snapshot.pageUrl !== pageUrl())
        throw new CaptureError('STALE_SNAPSHOT', '原文已变化或页面已刷新，请重新读取。');
      const bound = snapshot;
      const current = extractCurrent();
      const hash = await sourceHash(pageUrl(), current.question, current.blocks, current.warnings, current.targetId);
      if (snapshot !== bound || hash !== bound.sourceHash) throw new CaptureError('STALE_SNAPSHOT', '原文已变化，请重新读取。');
      elements = current.elements; watchRoot(current.root);
    };
    const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (raw, sender, respond) => {
      if (ctx.isInvalid || sender.id !== chrome.runtime.id || raw?.channel !== READER_CHANNEL) return;
      const { channel: _channel, ...payload } = raw;
      const parsed = panelMessageSchema.safeParse(payload); if (!parsed.success) return;
      const msg = parsed.data;
      const markToken = msg.type === 'SET_HIGHLIGHTS' || msg.type === 'LOCATE_BLOCK' ? ++markGeneration : markGeneration;
      const reply = (value: object) => { if (!ctx.isInvalid) respond({ ...value, channel: READER_CHANNEL, readerVersion: BUILD_VERSION }); };
      void (async () => {
        try {
          let data: unknown = null;
          if (msg.type === 'RELEASE') { generation++; clearMarks(); snapshot = null; elements.clear(); sourceObserver?.disconnect(); sourceObserver = null; root = null; }
          else if (msg.type === 'CLEAR_HIGHLIGHTS') { if (snapshot?.snapshotId === msg.snapshotId) clearMarks(); }
          else if (msg.type === 'CAPTURE') {
            const gen = ++generation;
            // Repeated scans must preserve the ID used by an in-flight review and its anchors.
            const current = extractCurrent();
            const currentHash = await sourceHash(pageUrl(), current.question, current.blocks, current.warnings, current.targetId);
            if (gen !== generation) throw new CaptureError('STALE_SNAPSHOT', '页面正在变化，稍后自动重新检查。');
            if (snapshot?.sourceHash === currentHash && snapshot.pageUrl === pageUrl()) {
              elements = current.elements; watchRoot(current.root);
              reply({ ok: true, requestId: msg.requestId, data: snapshot });
              return;
            }
            const captured = await (aiSite(location.href) ? captureAI(document) : captureWebPage(document));
            if (gen !== generation) throw new CaptureError('STALE_SNAPSHOT', '本次读取已失效，请重新读取。');
            clearMarks();
            snapshot = { snapshotId: crypto.randomUUID(), source: aiSite(location.href) ? `${aiSite(location.href)}_dom` as ReviewSnapshot['source'] : 'webpage_dom', capturedAt: new Date().toISOString(),
              tabId: null, windowId: null, documentSessionId, pageUrl: captured.pageUrl, sourceHash: captured.sourceHash, targetId: captured.targetId,
              question: captured.question, additionalContext: '', blocks: captured.blocks, page: 'page' in captured ? captured.page as ReviewSnapshot['page'] : undefined, scope: { ...emptyScope(), extractionWarnings: captured.warnings } };
            elements = captured.elements; watchRoot(captured.root); data = snapshot;
          } else {
            await validate(msg.snapshotId);
            if ((msg.type === 'SET_HIGHLIGHTS' || msg.type === 'LOCATE_BLOCK') && markToken !== markGeneration) throw new CaptureError('MARKS_CANCELLED', '原文提示操作已取消。');
            const target = (blockId: string, exactQuote?: string) => {
              const el = elements.get(blockId), block = snapshot!.blocks.find(b => b.id === blockId);
              if (!el?.isConnected || !block || (exactQuote && !normalize(block.text).includes(normalize(exactQuote)))) throw new CaptureError('BLOCK_NOT_FOUND', '当前原文无法匹配该引文；请查看侧栏证据。');
              return { element: el, range: exactQuote ? quoteRange(el,block.text,exactQuote) : null };
            };
            if (msg.type === 'LOCATE_BLOCK') {
              const t = target(msg.blockId,msg.exactQuote);
              data = { precision: locateHighlights.show([t],root!,true) };
              t.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
            } else if (msg.type === 'SET_HIGHLIGHTS') data = { precision: highlights.show(msg.evidence.map(e => target(e.blockId,e.exactQuote)),root!) };
          }
          reply({ ok: true, requestId: msg.requestId, data });
        } catch (e) {
          if (!(e instanceof CaptureError && e.code === 'MARKS_CANCELLED')) clearMarks();
          reply({ ok: false, requestId: msg.requestId, code: e instanceof CaptureError ? e.code : 'UNSUPPORTED_LAYOUT', message: e instanceof Error ? e.message : '读取失败，请使用手动粘贴。' });
        }
      })();
      return true;
    };
    chrome.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => { generation++; clearMarks(); snapshot = null; elements.clear(); sourceObserver?.disconnect(); sourceObserver = null; chrome.runtime.onMessage.removeListener(listener); });
  },
});
