export interface ReviewBlock {
  id: string;
  text: string;
  kind?: 'paragraph' | 'heading' | 'list' | 'quote' | 'code' | 'table';
  citations: Array<{ label: string; url: string }>;
}
export interface ReviewSnapshot {
  snapshotId: string;
  source: 'chatgpt_dom' | 'gemini_dom' | 'perplexity_dom' | 'grok_dom' | 'webpage_dom' | 'selection' | 'manual' | 'demo';
  capturedAt: string;
  tabId: number | null;
  windowId: number | null;
  documentSessionId: string | null;
  pageUrl: string | null;
  sourceHash: string;
  targetId?: string;
  page?: { title: string; site: string; author?: string; published?: string; readingMinutes: number; kind: 'article' | 'post' };
  question: string;
  additionalContext: string;
  blocks: ReviewBlock[];
  scope: {
    priorTurnsAutoRead: false;
    attachmentsAutoRead: false;
    externalSourcesChecked: false;
    userReportsMissingContext: boolean;
    extractionWarnings?: string[];
    selectedExcerptOnly?: boolean;
  };
}
export const emptyScope = (missing = false): ReviewSnapshot['scope'] => ({
  priorTurnsAutoRead: false, attachmentsAutoRead: false, externalSourcesChecked: false,
  userReportsMissingContext: missing,
});
