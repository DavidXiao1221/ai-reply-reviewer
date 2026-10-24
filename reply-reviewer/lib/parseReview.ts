import { z } from 'zod';
import { reviewSchema, type ModelReview } from './reviewSchema';

export type ReviewDiagnostic = { code: 'REVIEW_FORMAT'; issues: Array<{ field: string; rule: string }> };
const knownFields = new Set(['schemaVersion', 'brief', 'conclusion', 'points', 'nextStep', 'assessment', 'text', 'evidence', 'blockId', 'exactQuote', 'kind', 'followUp']);
const knownRules = new Set(['invalid_type', 'too_small', 'too_big', 'invalid_value', 'invalid_union', 'unrecognized_keys']);
export class ReviewFormatError extends Error {
  readonly diagnostic: ReviewDiagnostic;
  constructor(issues: Array<{ path: readonly PropertyKey[]; code: string }>, noContent = false) {
    const safeIssues = issues.slice(0, 8).map(i => ({
      field: i.path.map(p => typeof p === 'number' ? String(p) : knownFields.has(String(p)) ? String(p) : '?').join('.') || 'result',
      rule: knownRules.has(i.code) ? i.code : 'invalid',
    }));
    const first = safeIssues[0]?.field || '';
    const label = first.startsWith('brief.conclusion') ? '结论' : first.startsWith('brief.points') ? '关键要点' : first.startsWith('brief.nextStep') ? '下一步' : '正文';
    super(noContent ? '结果没有有效简写内容，未展示本次结果；可以重试。' : `结果格式不正确：${label}字段不完整或类型不符，未展示本次简写；可以重试。`);
    this.name = 'ReviewFormatError';
    // Never include Zod messages, unknown property names, received values or model text.
    this.diagnostic = { code: 'REVIEW_FORMAT', issues: safeIssues };
  }
}
export const reviewDiagnostic = (error: unknown) => error instanceof ReviewFormatError ? error.diagnostic : undefined;

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
// Output writing limits belong to the request schema. A long but otherwise
// complete response must not lose a condition merely to satisfy those targets.
// These receiving limits are resource bounds, not text-shortening rules.
const receivedEvidence = z.object({ blockId: z.string().trim().min(1).max(80), exactQuote: z.string().trim().min(1).max(30000) });
const receivedText = z.string().trim().min(1).max(30000);
const receivedAssessment = z.object({
  kind: z.literal('caveat').default('caveat'), text: z.string().trim().min(1).max(30000),
  evidence: z.array(receivedEvidence).min(1).max(128), followUp: z.null().default(null),
});
const emptyText = (v: unknown) => v == null || typeof v === 'string' && !v.trim();
const emptyEvidence = (v: unknown) => v == null || Array.isArray(v) && !v.length;
const emptyOptional = (v: unknown) => v == null || v === '' || typeof v === 'string' && !v.trim() ||
  Array.isArray(v) && !v.length || object(v) && Object.keys(v).every(k => k === 'text' || k === 'evidence') && emptyText(v.text) && emptyEvidence(v.evidence);

type ShapeIssue = { path: readonly PropertyKey[]; code: string };
type BriefItem = { text: string; evidence: z.infer<typeof receivedEvidence>[] };
type ParsedReview = { review: ModelReview; omittedAssessments: number; formatRepairs: number; omittedBriefItems: number; formatIssues: ReviewDiagnostic['issues'] };

/** Preserve usable text independently; never invent text or promote a point to a conclusion. */
export function parseReview(raw: unknown): ParsedReview {
  const version = object(raw) ? raw.schemaVersion : undefined;
  const current = object(raw) && (version === '3.5' || version === 3.5 || version === undefined && object(raw.brief));
  if (!current) {
    const parsed = reviewSchema.safeParse(raw);
    if (!parsed.success) throw new ReviewFormatError(parsed.error.issues);
    return { review: parsed.data, omittedAssessments: 0, formatRepairs: 0, omittedBriefItems: 0, formatIssues: [] };
  }
  let repairs = version === '3.5' ? 0 : 1;
  const list = (v: unknown) => { if (object(v)) { repairs++; return [v]; } return v; };
  const b = raw.brief;
  if (!object(b)) throw new ReviewFormatError([{ path: ['brief'], code: 'invalid_type' }]);
  const issues: ShapeIssue[] = [];
  let omittedBriefItems = 0;
  const item = (value: unknown, path: PropertyKey[]): BriefItem | null => {
    if (!object(value)) { issues.push({ path, code: 'invalid_type' }); omittedBriefItems++; return null; }
    const text = receivedText.safeParse(value.text);
    if (!text.success) issues.push(...text.error.issues.map(i => ({ path: [...path, 'text', ...i.path], code: i.code })));
    const refs = list(value.evidence);
    const evidence: BriefItem['evidence'] = [];
    if (!Array.isArray(refs)) issues.push({ path: [...path, 'evidence'], code: 'invalid_type' });
    else if (!refs.length || refs.length > 128) issues.push({ path: [...path, 'evidence'], code: refs.length ? 'too_big' : 'too_small' });
    else refs.forEach((ref, index) => {
      const parsed = receivedEvidence.safeParse(ref);
      if (parsed.success) evidence.push(parsed.data);
      else issues.push(...parsed.error.issues.map(i => ({ path: [...path, 'evidence', index, ...i.path], code: i.code })));
    });
    if (!text.success) { omittedBriefItems++; return null; }
    return { text: text.data, evidence };
  };
  const conclusion = item(b.conclusion, ['brief', 'conclusion']);
  const rawPoints = list(b.points);
  // Bound malformed arrays, then apply the three-point contract to usable items.
  // An extra empty placeholder must not discard three otherwise valid points.
  if (Array.isArray(rawPoints) && rawPoints.length > 128) throw new ReviewFormatError([{ path: ['brief', 'points'], code: 'too_big' }]);
  const points = Array.isArray(rawPoints)
    ? rawPoints.map((p, i) => item(p, ['brief', 'points', i])).filter((p): p is BriefItem => p !== null)
    : (issues.push({ path: ['brief', 'points'], code: 'invalid_type' }), omittedBriefItems++, []);
  if (points.length > 3) throw new ReviewFormatError([{ path: ['brief', 'points'], code: 'too_big' }]);
  let nextStep: BriefItem | null = null;
  if (emptyOptional(b.nextStep)) { if (b.nextStep != null) repairs++; }
  else nextStep = item(b.nextStep, ['brief', 'nextStep']);
  // An independent comment alone is not a usable summary.
  if (!conclusion && !points.length && !nextStep) throw new ReviewFormatError(issues, true);
  // Empty conclusion is an internal absence sentinel, never rendered or copied.
  // Keeping roles prevents a surviving point from being mislabeled as a conclusion.
  const brief = { conclusion: conclusion ?? { text: '', evidence: [] }, points, nextStep };
  let omittedAssessments = 0;
  const assessments: z.infer<typeof receivedAssessment>[] = [];
  const rawAssessments = raw.assessment == null ? [] : list(raw.assessment);
  const candidates = Array.isArray(rawAssessments) ? rawAssessments : [rawAssessments];
  for (const value of candidates) {
    if (typeof value === 'string' && /^无实质发现[。.!！]?$/.test(value.trim())) { repairs++; continue; }
    // An optional, independent assessment cannot invalidate a complete brief.
    // Legacy followUp metadata is not part of the current reader output.
    const candidate = object(value) ? { ...value, evidence: list(value.evidence), followUp: null } : value;
    const assessment = receivedAssessment.safeParse(candidate);
    if (!assessment.success || assessments.length >= 1) { omittedAssessments++; continue; }
    if (object(value) && value.followUp != null) repairs++;
    assessments.push(assessment.data);
  }
  return { review: { schemaVersion: '3.5', brief, assessment: assessments }, omittedAssessments, formatRepairs: repairs,
    omittedBriefItems, formatIssues: issues.length ? new ReviewFormatError(issues).diagnostic.issues : [] };
}
