import type { ReviewBlock, ReviewSnapshot } from './types';
import { emptyScope } from './types';
import { PROMPT_VERSION } from './reviewPrompt';
import { SCHEMA_VERSION } from './reviewSchema';

export const normalize = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
export function safeUrl(raw: string, base?: string): string | null {
  try { const u = new URL(raw, base); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
}
export async function hash(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
export function assertInput(question: string, context: string, blocks: ReviewBlock[]) {
  if (!blocks.length || !blocks.some(b => b.text.trim())) throw new Error('请提供 AI 回复。');
  if (question.length + context.length + blocks.map(b => b.text).join('\n\n').length > 30000)
    throw new Error('输入超过 30,000 字符，请缩短或选择片段；不会静默截断。');
}
// 保留代码围栏的整体结构，其他文本按段落或行分块；所有原文都保留。
export function manualBlocks(answer: string): ReviewBlock[] {
  const chunks: string[] = []; let current: string[] = []; let fence: string | null = null;
  const flush = () => { const text = current.join('\n').trim(); if (text) chunks.push(text); current = []; };
  for (const line of answer.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = line.trim().match(/^(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) { flush(); fence = marker[1]![0]!; current.push(line); }
      else { current.push(line); if (marker[1]![0] === fence) { fence = null; flush(); } }
    } else if (fence) current.push(line);
    else { flush(); if (line.trim()) current.push(line); }
  }
  flush();
  return chunks.map((text, i) => ({ id: `b${String(i + 1).padStart(3, '0')}`, text, kind: /^(?:```|~~~)/.test(text) ? 'code' : /^>/.test(text) ? 'quote' : /^#{1,6}\s/.test(text) ? 'heading' : 'paragraph', citations: [] }));
}
export const sourceHash = (pageUrl: string | null, question: string, blocks: ReviewBlock[], warnings: string[] = [], targetId: string | null = null) =>
  hash(JSON.stringify([pageUrl, targetId, normalize(question), blocks.map(b => [b.id, normalize(b.text), b.kind || 'paragraph', b.citations]), warnings]));
export async function makeManual(question: string, context: string, answer: string, missing: boolean, source: 'manual' | 'demo' = 'manual'): Promise<ReviewSnapshot> {
  const blocks = manualBlocks(answer); assertInput(question, context, blocks);
  return { snapshotId: crypto.randomUUID(), source, capturedAt: new Date().toISOString(), tabId: null, windowId: null,
    documentSessionId: null, pageUrl: null, sourceHash: await sourceHash(null, question, blocks),
    question, additionalContext: context, blocks, scope: emptyScope(missing) };
}
export const fingerprint = (s: ReviewSnapshot, model: string) => hash(JSON.stringify([
  s.sourceHash, s.additionalContext, s.scope, model, PROMPT_VERSION, SCHEMA_VERSION,
]));
