import type { ReviewSnapshot } from './types';

// Shared by the prompt, validator and UI.
export const visibleLength = (text: string) => Array.from(text.replace(/\s/gu, '')).length;
export function readingBudget(snapshot: ReviewSnapshot) {
  const sourceChars = visibleLength(snapshot.blocks.map(b => b.text).join(''));
  const preserveOriginal = sourceChars <= 160;
  return {
    sourceChars,
    briefMode: preserveOriginal ? 'preserve' as const : 'compress' as const,
    targetBriefChars: preserveOriginal ? sourceChars : Math.min(220, Math.floor(sourceChars * .65)),
    // A writing target, not a reason to discard a faithful result or slice off conditions.
    preferredMaxBriefChars: preserveOriginal ? sourceChars : Math.min(290, Math.floor(sourceChars * .8)),
    preferredAssessmentChars: 60,
    targetTotalChars: 280,
    preferredMaxTotalChars: 350,
  };
}

