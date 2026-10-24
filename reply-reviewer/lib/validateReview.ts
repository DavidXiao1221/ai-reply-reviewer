import { type ModelReview, type EvidenceRef } from './reviewSchema';
import { parseReview, type ReviewDiagnostic } from './parseReview';
import type { ReviewSnapshot } from './types';
import { normalize } from './snapshot';
import { evidenceBlocks } from './contextBuilder';
import { readingBudget, visibleLength } from './readingBudget';
import { checkEquation } from './arithmetic';
import { protectedPassages, strengthensUncertainty } from './protectedPassages';

const contradictionPattern = /矛盾|前后(?:不一致|冲突)|(?:数据|数字|表述|结论)冲突|与.{0,8}(?:结论|表述|前文)(?:相反|不一致)|contradict/i;
const arithmeticAccusation = /算错|(?:计算|算式|等式|[加减乘除]法)(?:的)?(?:结果)?(?:有误|错误|不正确|不成立)|(?:计算|算式|等式|[加减乘除]法).{0,8}(?:算错|有误|错误)|(?:arithmetic|calculation|equation).{0,20}(?:wrong|incorrect)/i;

export type ValidatedReview = ModelReview & {
  reviewId: string;
  snapshotId: string;
  integrity: 'complete' | 'partial';
  omittedAssessments: number;
  sourceChars: number;
  briefChars: number;
  assessmentChars: number;
  presentation: 'brief' | 'original';
  originalText: string;
  originalReason: 'short' | 'not-shorter' | 'fidelity' | null;
  preservedPassages: number;
  suppressedAssessments: number;
  relocatedAssessments: number;
  suppressedArithmeticAssessments: number;
  formatRepairs: number;
  jsonRepairs?: number; // Optional for cached results from earlier releases.
  omittedBriefItems: number;
  unlocatedBriefItems: number;
  formatIssues: ReviewDiagnostic['issues'];
};
export function validateReview(raw: unknown, snapshot: ReviewSnapshot): ValidatedReview {
  const parsed = parseReview(raw);
  const r = parsed.review;
  const lightweight = r.schemaVersion === '3.5';
  const nextStep = 'nextStep' in r.brief ? r.brief.nextStep : null;
  const blocks = new Map(evidenceBlocks(snapshot).map(b => [b.id, b]));
  const matches = (e: EvidenceRef) => {
    const block = blocks.get(e.blockId);
    return !!block && normalize(block.text).includes(normalize(e.exactQuote));
  };
  const items = [...(r.brief.conclusion.text ? [r.brief.conclusion] : []), ...r.brief.points];
  const formatIssues = [...parsed.formatIssues];
  let unlocatedBriefItems = 0;
  if (lightweight) {
    const locatedItems = [
      ...(r.brief.conclusion.text ? [{ item: r.brief.conclusion, field: 'brief.conclusion' }] : []),
      ...r.brief.points.map((item, i) => ({ item, field: `brief.points.${i}` })),
      ...(nextStep ? [{ item: nextStep, field: 'brief.nextStep' }] : []),
    ];
    for (const { item, field } of locatedItems) {
      const valid = item.evidence.filter(e => e.blockId.startsWith('b') && matches(e));
      if (valid.length !== item.evidence.length && formatIssues.length < 8) formatIssues.push({ field: `${field}.evidence`, rule: 'invalid_value' });
      item.evidence = valid;
      if (!valid.length) unlocatedBriefItems++;
    }
  } else if ([...items, ...(nextStep ? [nextStep] : [])].some(item => item.evidence.some(e => !e.blockId.startsWith('b') || !matches(e))))
    throw new Error('简写的原文引用不匹配，未展示可能不完整的概括；可以重试。');
  // Identical items carry no additional condition; keep their union of anchors.
  // Do not fuzzy-deduplicate: similar sentences can differ in a crucial limit.
  const unique = new Map<string, typeof items[number]>();
  for (const item of items) {
    const key = normalize(item.text), previous = unique.get(key);
    if (!previous) unique.set(key, { ...item, evidence: [...item.evidence] });
    else for (const e of item.evidence) {
      if (!previous.evidence.some(p => p.blockId === e.blockId && normalize(p.exactQuote) === normalize(e.exactQuote)))
        previous.evidence.push(e);
    }
  }
  const distinctItems = [...unique.values()];
  let preservedCount = 0;
  if (r.schemaVersion === '3.4') for (const passage of protectedPassages(snapshot)) {
    if (!distinctItems.some(item=>normalize(item.text).includes(normalize(passage.text)))) {
      distinctItems.push(passage);preservedCount++;
    }
  }
  const budget = readingBudget(snapshot);
  // Exact repeats alone are safe to merge; never fuzzy-dedupe away a qualifier.
  const distinctNextStep = nextStep && !distinctItems.some(i => normalize(i.text) === normalize(nextStep.text)) ? nextStep : null;
  const generatedBriefChars = distinctItems.reduce((sum, item) => sum + visibleLength(item.text), 0) + (distinctNextStep ? visibleLength(distinctNextStep.text) : 0);
  const fidelityFallback = r.schemaVersion === '3.4' && strengthensUncertainty(items,snapshot);
  let originalReason: ValidatedReview['originalReason'] = budget.briefMode === 'preserve' ? 'short' : fidelityFallback ? 'fidelity' : generatedBriefChars >= budget.sourceChars ? 'not-shorter' : null;
  let presentation: ValidatedReview['presentation'] = originalReason ? 'original' : 'brief';
  const originalText = snapshot.blocks.map(b => b.text).join('\n\n');
  let briefChars = presentation === 'original' ? budget.sourceChars : generatedBriefChars;
  const hasConclusion = !!r.brief.conclusion.text;
  const brief = { conclusion: hasConclusion ? distinctItems[0]! : r.brief.conclusion,
    points: hasConclusion ? distinctItems.slice(1) : distinctItems, ...(lightweight ? {nextStep: distinctNextStep} : {}) };
  // Only a complete, standalone numerical equality qualifies. This says nothing
  // about business definitions, units, data sources, or correctness of a document.
  const standaloneEquation = snapshot.blocks.length === 1 ? originalText.trim().replace(/[。.]$/, '') : '';
  const provenEquality = standaloneEquation !== '' && checkEquation(standaloneEquation).result === 'passed';
  let omittedAssessments = parsed.omittedAssessments;
  let suppressedAssessments = 0, assessmentChars = 0;
  let relocatedAssessments = 0, suppressedArithmeticAssessments = 0;
  const assessment: Array<ModelReview['assessment'][number]> = [];
  const relocated: Array<ModelReview['assessment'][number]> = [];
  for (const item of r.assessment) {
    const distinct = new Set(item.evidence.map(e => e.blockId + ':' + normalize(e.exactQuote)));
    const basis = 'basis' in item ? item.basis : undefined;
    const contradiction = basis === 'contradiction' || contradictionPattern.test(item.text);
    const unsupportedRequirement = basis === 'unmet_requirement' && !item.evidence.some(e => /^[px]/.test(e.blockId));
    if (lightweight && /^无实质发现[。.!！]?$/.test(item.text)) { suppressedAssessments++; continue; }
    if (!item.evidence.every(matches) || lightweight && !item.evidence.some(e => e.blockId.startsWith('b')) || contradiction && distinct.size < 2 || unsupportedRequirement || r.schemaVersion === '3.4' && strengthensUncertainty([item],snapshot)) {
      omittedAssessments++; continue;
    }
    const chars = visibleLength(item.text);
    // A complete pure equality has no business scope or hidden intermediate
    // steps to check. Other criticisms need evidence from the actual request.
    if (provenEquality && (arithmeticAccusation.test(item.text) || item.evidence.every(e => e.blockId.startsWith('b')))) {
      suppressedAssessments++; suppressedArithmeticAssessments++; continue;
    }
    // Omit verbatim duplicates, but do not treat a character budget as evidence
    // that a grounded judgment is useless. The schema still bounds each comment.
    const verbatimRepeat = normalize(originalText).includes(normalize(item.text)) || [...items, ...(distinctNextStep ? [distinctNextStep] : [])].some(i => normalize(i.text).includes(normalize(item.text)));
    if (verbatimRepeat || [...assessment, ...brief.points].some(a => normalize(a.text) === normalize(item.text))) {
      suppressedAssessments++; continue;
    }
    // Models may detect a contradiction but put it only in the short comment.
    // Preserve that already-produced, anchored notice in the copied summary too.
    if (!lightweight && presentation === 'brief' && contradiction && item.evidence.every(e => e.blockId.startsWith('b'))) {
      brief.points.push({text: item.text, evidence: item.evidence});
      relocated.push(item);
      briefChars += chars; relocatedAssessments++; continue;
    }
    assessment.push(item); assessmentChars += chars;
  }
  // Count relocated notices too. If their addition defeats compression, show
  // the source and keep those useful notices as independent assessments.
  if (r.schemaVersion === '3.4' && presentation === 'brief' && briefChars >= budget.sourceChars) {
    presentation = 'original'; originalReason = 'not-shorter'; briefChars = budget.sourceChars;
    assessment.push(...relocated);
    assessmentChars += relocated.reduce((n,a)=>n+visibleLength(a.text),0);
    relocatedAssessments = 0;
  }
  return { ...r, brief, assessment, reviewId: crypto.randomUUID(), snapshotId: snapshot.snapshotId,
    integrity: omittedAssessments || parsed.omittedBriefItems || unlocatedBriefItems || formatIssues.length ? 'partial' : 'complete', omittedAssessments,
    sourceChars: budget.sourceChars, briefChars, assessmentChars, presentation, originalText, originalReason, suppressedAssessments,
    relocatedAssessments, suppressedArithmeticAssessments, formatRepairs:parsed.formatRepairs,
    omittedBriefItems:parsed.omittedBriefItems, unlocatedBriefItems, formatIssues,
    preservedPassages:presentation === 'brief' ? preservedCount : 0 } as ValidatedReview;
}

