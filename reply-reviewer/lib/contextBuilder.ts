import type { ReviewSnapshot } from './types';
export type TextBlock = { id: string; kind: 'paragraph'|'heading'|'list'|'quote'|'code'|'table'; text: string; links: Array<{label:string;url:string}> };
const plain = (text: string, prefix: string): TextBlock[] => text.trim() ? [{ id: `${prefix}001`, kind: 'paragraph', text: text.trim(), links: [] }] : [];
export function buildContext(s: ReviewSnapshot) {
  return {
    user_prompt: plain(s.question, 'p'), supplemental_context: plain(s.additionalContext, 'x'),
    target_response: s.blocks.map(b => ({ id: b.id, kind: b.kind || 'paragraph', text: b.text, links: b.citations })) as TextBlock[],
    scope: { ...s.scope, selectedExcerptOnly: s.source === 'selection' || s.scope.selectedExcerptOnly === true },
  };
}
export function evidenceBlocks(s: ReviewSnapshot) { const input = buildContext(s); return [...input.user_prompt, ...input.supplemental_context, ...input.target_response]; }
