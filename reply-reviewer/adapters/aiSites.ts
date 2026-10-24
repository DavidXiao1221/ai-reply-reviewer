import { extractChatGPT, captureStable as captureChatGPT } from './chatgpt';
import { cleanText, excluded, extractBlocks, visible } from './dom';
import { aiSite, type AISite } from '../lib/sites';
import { CaptureError } from '../lib/messages';
import { assertInput, sourceHash } from '../lib/snapshot';

const identities = new WeakMap<Element, string>();
const nodes = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).filter(visible);
const follows = (before: Element, after: Element) => !!(before.compareDocumentPosition(after) & 4);
const stopped = (doc: Document) => nodes(doc, 'button[aria-label],button[title],button[data-testid],button[data-test-id]').some(el => {
  const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
  return /^(stop( generating| response| generating response| model response| generation| answering)?|停止(生成|回答|回应|回覆|回應)?|中止生成)$/i.test(label.trim())
    || /^(stop-button|stop-response-button|stop-generation-button)$/.test(el.getAttribute('data-testid') || el.getAttribute('data-test-id') || '');
});
const busy = (root: Element) => root.matches('[aria-busy="true"],[data-is-streaming="true"]') || nodes(root, '[aria-busy="true"],[data-is-streaming="true"]').length > 0;
function identity(root: Element, site: AISite) {
  const id = root.getAttribute('data-message-id') || root.querySelector('message-content[id]')?.id || root.id;
  if (id) return `${site}:${id}`;
  if (!identities.has(root)) identities.set(root, crypto.randomUUID());
  return `${site}:element:${identities.get(root)}`;
}
function pairQuestion(doc: Document, root: Element, selector: string, textSelector?: string) {
  const users = nodes(doc, selector).filter(el => !excluded(el));
  if (users.some(el => follows(root, el))) throw new CaptureError('GENERATING', '最新提问尚无完整回答，正在等待。');
  const user = users.filter(el => follows(el, root)).at(-1);
  return user ? cleanText(textSelector ? user.querySelector(textSelector) || user : user) : '';
}
function result(root: Element, body: Element, question: string, site: AISite, preferMarkdown = true) {
  const data = extractBlocks(body, { preferMarkdown });
  if (!data.blocks.length) throw new CaptureError('UNSUPPORTED_LAYOUT', '当前回答正文无法读取，可以选中文字后右键审阅。');
  assertInput(question, '', data.blocks);
  return { ...data, root, question, targetId: identity(root, site) };
}

// Selectors observed on Gemini's public conversation page on 2026-10-24.
export function extractGemini(doc: Document) {
  if (stopped(doc)) throw new CaptureError('GENERATING', 'Gemini 仍在生成，完成后将自动审阅。');
  const root = nodes(doc, 'model-response').filter(el => !excluded(el)).at(-1);
  if (!root) throw new CaptureError('NO_REPLY', '没有找到 Gemini 回答，请打开对话，或选中文字后右键审阅。');
  const question = pairQuestion(doc, root, 'user-query', '.query-text');
  if (busy(root) || !nodes(root, 'message-actions copy-button button, message-actions button[data-test-id="copy-button"], message-actions button[aria-label="Copy"], message-actions button[aria-label="复制"]').some(el => !el.hasAttribute('disabled')))
    throw new CaptureError('GENERATING', '正在等待 Gemini 完成回答。若页面布局已变化，可选中文字后右键审阅。');
  const body = root.querySelector('model-response-content') || root.querySelector('message-content');
  if (!body) throw new CaptureError('UNSUPPORTED_LAYOUT', '未识别 Gemini 的回答正文，请选中文字后右键审阅。');
  return result(root, body, question, 'gemini');
}

// The final-text container and its own footer distinguish answers from search/reasoning cards.
// Never fall back to reading the entire document or an unrelated .prose element.
export function extractPerplexity(doc: Document) {
  if (stopped(doc)) throw new CaptureError('GENERATING', 'Perplexity 仍在生成，完成后将自动审阅。');
  const root = nodes(doc, '[data-workflow-final-text]').filter(el => !excluded(el)).at(-1);
  if (!root) throw new CaptureError('NO_REPLY', '没有找到 Perplexity 回答，请打开对话，或选中文字后右键审阅。');
  const question = pairQuestion(doc, root, '[data-message-bubble="right"]', '[data-renderer]');
  const footer = root.querySelector('[data-workflow-text-footer]');
  if (busy(root) || !footer || !nodes(footer, 'button').some(el => !el.hasAttribute('disabled')))
    throw new CaptureError('GENERATING', '正在等待 Perplexity 完成回答。若页面布局已变化，可选中文字后右键审阅。');
  const body = root.querySelector('[data-workflow-items]');
  if (!body) throw new CaptureError('UNSUPPORTED_LAYOUT', '未识别 Perplexity 的回答正文，请选中文字后右键审阅。');
  const captured = result(root, body, question, 'perplexity');
  if (body.querySelector('[data-testid="trusted-citation-check"]')) captured.warnings.push('部分来源以引用卡片显示，未读取卡片中的完整链接或引用网页。');
  return captured;
}

// Grok's response-{id} wrappers own the bubble and action row. Alignment belongs
// to the wrapper, not to arbitrary nested flex containers. See docs/v3.4.1-grok.md.
export function extractGrok(doc: Document) {
  if (stopped(doc)) throw new CaptureError('GENERATING', 'Grok 仍在生成，完成后将自动审阅。');
  const turns = nodes(doc, '[id^="response-"]').filter(el => !excluded(el));
  const root = turns.at(-1);
  if (!root) throw new CaptureError('NO_REPLY', '没有找到 Grok 回答，请打开对话，或选中文字后右键审阅。');
  const userTurn = (el: Element) => el.matches('.items-end') || !!el.querySelector('.message-bubble.user');
  if (userTurn(root)) throw new CaptureError('GENERATING', '最新提问尚无完整回答，正在等待。');
  // Fail closed on an unknown latest turn; never fall back to an earlier answer.
  if (!root.matches('.items-start')) throw new CaptureError('UNSUPPORTED_LAYOUT', '未识别 Grok 的回答布局，请选中文字后右键审阅。');
  const body = nodes(root, '.message-bubble').find(el => el.closest('[id^="response-"]') === root);
  const actions = nodes(root, '.action-buttons').filter(el => el.closest('[id^="response-"]') === root && !body?.contains(el));
  if (busy(root) || !actions.some(row => nodes(row, 'button').some(el => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true')))
    throw new CaptureError('GENERATING', '正在等待 Grok 完成回答。若页面布局已变化，可选中文字后右键审阅。');
  if (!body || !nodes(body, '.response-content-markdown').some(el => !excluded(el)))
    throw new CaptureError('UNSUPPORTED_LAYOUT', '未识别 Grok 的回答正文，请选中文字后右键审阅。');
  const user = turns.slice(0, -1).filter(userTurn).at(-1);
  const questionBody = user?.querySelector('.message-bubble');
  // Grok can put code blocks next to markdown containers. Walk the whole bubble,
  // with thinking, actions and media excluded, to retain code and original anchors.
  return result(root, body, questionBody ? cleanText(questionBody) : '', 'grok', false);
}
export function extractAI(doc: Document) {
  const site = aiSite(doc.location.href);
  if (site === 'chatgpt') return extractChatGPT(doc);
  if (site === 'gemini') return extractGemini(doc);
  if (site === 'perplexity') return extractPerplexity(doc);
  if (site === 'grok') return extractGrok(doc);
  throw new CaptureError('NOT_AI_SITE', '此网页可通过右键“审阅选中文字”使用。');
}
export async function captureAI(doc: Document, pause = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  if (aiSite(doc.location.href) === 'chatgpt') return captureChatGPT(doc, pause);
  const url = doc.location.href;
  const before = extractAI(doc);
  const beforeHash = await sourceHash(url, before.question, before.blocks, before.warnings, before.targetId);
  await pause(1200);
  const after = extractAI(doc);
  const afterHash = await sourceHash(doc.location.href, after.question, after.blocks, after.warnings, after.targetId);
  if (url !== doc.location.href || beforeHash !== afterHash) throw new CaptureError('GENERATING', '回答仍在变化，等待完整回答后自动审阅。');
  return { ...after, sourceHash: afterHash, pageUrl: url };
}
