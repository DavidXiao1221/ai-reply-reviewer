import { z } from 'zod';
import { emptyScope, type ReviewSnapshot } from './types';
import { assertInput, manualBlocks, safeUrl, sourceHash } from './snapshot';

export const SELECTION_MENU = 'review-selected-text';
export const SELECTION_READY = 'reply-review-selection-ready';
export const TAKE_SELECTION = 'reply-review-take-selection';
export const selectionSchema = z.object({
  id: z.string().uuid(), windowId: z.number().int(), tabId: z.number().int(),
  text: z.string().max(30000), pageUrl: z.string().max(20000),
  capturedAt: z.number(), error: z.string().optional(),
});
export type SelectionRequest = z.infer<typeof selectionSchema>;

/** One pending user gesture per window; memory only, consumed exactly once. */
export class SelectionInbox {
  private pending = new Map<number, SelectionRequest>();
  constructor(private now = Date.now) {}
  put(input: { text: string; pageUrl: string; tabId: number; windowId: number }) {
    const error = input.text.length > 30000 ? '选中文字超过 30,000 字符，请缩小选区后重试；不会截断原文。'
      : !input.text.trim() ? '没有取得选中文字，请重新选择后重试。' : undefined;
    const request: SelectionRequest = { ...input, text: error ? '' : input.text, pageUrl: safeUrl(input.pageUrl) || '', id: crypto.randomUUID(), capturedAt: this.now(), ...(error ? { error } : {}) };
    this.pending.set(input.windowId, request);
    return request;
  }
  take(windowId: number) {
    const request = this.pending.get(windowId);
    this.pending.delete(windowId);
    return request && this.now() - request.capturedAt < 120000 ? request : null;
  }
  clear(windowId: number) { this.pending.delete(windowId); }
}
export async function makeSelection(request: SelectionRequest, question = '', context = '', missing = false): Promise<ReviewSnapshot> {
  if (request.error) throw new Error(request.error);
  const blocks = manualBlocks(request.text); assertInput(question, context, blocks);
  return {
    snapshotId: request.id, source: 'selection', capturedAt: new Date(request.capturedAt).toISOString(),
    tabId: request.tabId, windowId: request.windowId, documentSessionId: null,
    pageUrl: safeUrl(request.pageUrl), sourceHash: await sourceHash(safeUrl(request.pageUrl), question, blocks),
    question, additionalContext: context, blocks,
    scope: { ...emptyScope(missing), selectedExcerptOnly: true },
  };
}
