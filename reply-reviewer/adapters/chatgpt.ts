import type { ReviewBlock } from '../lib/types';
import { cleanText, visible, excluded, extractBlocks } from './dom';
import { sourceHash, assertInput, normalize } from '../lib/snapshot';
import { CaptureError } from '../lib/messages';

// 借鉴采集插件的 role 选择器与块内引用关系；不接入页面网络钩子。
const ROLE = '[data-message-author-role]';
const targetIds = new WeakMap<Element, string>();
function targetIdentity(root: Element, turn?: Element): string {
  const message = root.closest('[data-message-id]')?.getAttribute('data-message-id');
  if (message) return `message:${message}`;
  const turnName = (turn || root.closest('[data-testid^="conversation-turn-"]'))?.getAttribute('data-testid');
  if (turnName?.startsWith('conversation-turn-')) return `turn:${turnName}`;
  if (!targetIds.has(root)) targetIds.set(root, crypto.randomUUID());
  return `element:${targetIds.get(root)!}`;
}
export function isGenerating(doc: Document) {
  return Array.from(doc.querySelectorAll('[data-testid="stop-button"],button[aria-label*="Stop generating"],button[aria-label*="停止生成"],[data-is-streaming="true"]')).some(visible);
}
export function extractChatGPT(doc: Document) {
  if (isGenerating(doc)) throw new CaptureError('GENERATING', '最新回复仍在生成，完成后将自动审阅。');
  // 2026-10 实页出现新的 turn / markdown 属性；以观察到的语义属性适配，不依赖随机样式类名。
  const turns = Array.from(doc.querySelectorAll('[data-talvt-turn-state]')).filter(n => !excluded(n));
  const latestTurn = turns.at(-1);
  let root: Element | undefined;
  let user: Element | undefined;
  if (latestTurn) {
    if (latestTurn.getAttribute('data-talvt-turn-state') !== 'complete')
      throw new CaptureError('GENERATING', '最新回复仍在生成或尚未完成，正在等待完整回答。');
    root = Array.from(latestTurn.querySelectorAll('[data-markdown-text-style="assistant-message"]')).filter(n => !excluded(n)).at(-1);
    const bubble = latestTurn.querySelector('[data-user-message-bubble="true"]');
    user = bubble?.querySelector('[data-markdown-text-tone="user-message"]') || bubble || undefined;
    if (!root) throw new CaptureError('UNSUPPORTED_LAYOUT', '当前轮次没有可读取的完整回答，请稍后重试或手动粘贴。');
  } else {
  const messages = Array.from(doc.querySelectorAll(ROLE)).filter(n => !excluded(n));
  const answerIndex = messages.findLastIndex(n => n.getAttribute('data-message-author-role') === 'assistant');
  if (answerIndex < 0) throw new CaptureError('NO_REPLY', '没有找到可读取的 ChatGPT 回复，请确认已登录并打开对话。');
  if (messages.slice(answerIndex + 1).some(n => n.getAttribute('data-message-author-role') === 'user'))
    throw new CaptureError('GENERATING', '最新提问还没有完整回复，正在等待生成完成。');
  root = messages[answerIndex];
  if (!root) throw new CaptureError('NO_REPLY', '没有找到可读取的回复。');
  user = messages.slice(0, answerIndex).findLast(n => n.getAttribute('data-message-author-role') === 'user');
  }
  if (!root) throw new CaptureError('NO_REPLY', '没有找到可读取的回复。');
  const question = user ? cleanText(user) : '';
  const { blocks, elements, warnings } = extractBlocks(root);
  assertInput(question, '', blocks);
  return { question, blocks, elements, warnings, root, targetId: targetIdentity(root,latestTurn) };
}
export async function captureStable(doc: Document, pause = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  const beforeUrl = doc.location.href;
  const before = extractChatGPT(doc);
  const beforeHash = await sourceHash(beforeUrl, before.question, before.blocks, before.warnings, before.targetId);
  await pause(700);
  const after = extractChatGPT(doc);
  const afterHash = await sourceHash(doc.location.href, after.question, after.blocks, after.warnings, after.targetId);
  if (beforeUrl !== doc.location.href || beforeHash !== afterHash) throw new CaptureError('GENERATING', '回答正在变化，等待生成完成后自动审阅。');
  return { ...after, sourceHash: afterHash, pageUrl: beforeUrl };
}
export function sameBlock(a: ReviewBlock, b: ReviewBlock) { return a.id === b.id && normalize(a.text) === normalize(b.text); }
