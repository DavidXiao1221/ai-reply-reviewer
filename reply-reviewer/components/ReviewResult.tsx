import type { Assessment, EvidenceRef } from '../lib/reviewSchema';
import type { ValidatedReview } from '../lib/validateReview';
import type { ReviewSnapshot } from '../lib/types';
import { evidenceBlocks } from '../lib/contextBuilder';
import { safeUrl } from '../lib/snapshot';

const nextStepOf = (r: ValidatedReview) => 'nextStep' in r.brief ? r.brief.nextStep : null;
export const partialNotice = (r: ValidatedReview) => {
  if (r.schemaVersion !== '3.5' || r.integrity !== 'partial') return '';
  const reasons = [
    ...(r.jsonRepairs ? ['已修复模型响应结构'] : []),
    ...(r.omittedBriefItems ? [`已跳过${r.omittedBriefItems}项空白或无效内容`] : []),
    ...(r.unlocatedBriefItems ? [`${r.unlocatedBriefItems}项缺少可用原文定位`] : r.formatIssues.length && !r.omittedBriefItems ? ['部分原文定位不可用'] : []),
    ...(r.omittedAssessments ? ['简评未完整保留'] : []),
  ];
  return `Partial · 部分结果：${reasons.join('；')}。请对照原文。`;
};
const bodyText = (r: ValidatedReview) => r.presentation === 'original' ? r.originalText : [
  ...(r.brief.conclusion.text ? [r.brief.conclusion.text] : []), ...r.brief.points.map(p => '• ' + p.text),
  ...(nextStepOf(r) ? ['下一步：' + nextStepOf(r)!.text] : []),
].join('\n\n');
export const briefText = (r: ValidatedReview) => [partialNotice(r), bodyText(r)].filter(Boolean).join('\n\n');
// Copy the complete visible result, keeping the reviewer's judgment distinct
// from the source summary. A summary-only option remains in More.
export const reviewText = (r: ValidatedReview) => [briefText(r),
  ...r.assessment.map(a => '简评：' + a.text),
].join('\n\n');
export const followUpText = (a: Assessment) => [
  '原回答：' + a.evidence.map(e => '“' + e.exactQuote + '”').join('；'), a.followUp,
].join('\n');

type Props = {
  review: ValidatedReview; snapshot: ReviewSnapshot; stale: boolean;
  onLocate: (evidence: EvidenceRef) => void; onCopy: (text: string) => void;
};

// All anchors live under the single collapsed source entry in App, so nothing
// competes with the reading content. Buttons remain keyboard accessible.
export function ReviewEvidence({ review, snapshot, stale, onLocate, onCopy }: Props) {
  const blocks = new Map(evidenceBlocks(snapshot).map(b => [b.id, b]));
  const nextStep = nextStepOf(review);
  const groups = [
    ...(review.presentation === 'brief' ? [
      { label: '结论', item: review.brief.conclusion },
      ...review.brief.points.map((item, i) => ({ label: '要点 ' + (i + 1), item })),
      ...(nextStep ? [{ label: '下一步', item: nextStep }] : []),
    ] : []),
    ...review.assessment.map((item, i) => ({ label: '简评' + (i ? ' ' + (i + 1) : ''), item })),
  ];
  return <div className="review-evidence">{groups.filter(({item}) => item.evidence.length > 0).map(({label, item}) => <div className="evidence-group" key={label}>
    <h3>{label}依据</h3>
    {item.evidence.map((ref, i) => <div className="evidence-item" key={ref.blockId + ':' + i}>
      <blockquote>{ref.exactQuote}</blockquote>
      <button className="text-button" disabled={stale} onClick={() => onLocate(ref)} aria-label={label + '定位原句 ' + (i + 1)}>定位原句</button>
      {blocks.get(ref.blockId)?.links.map(link => safeUrl(link.url) && <a key={link.url} href={safeUrl(link.url)!} target="_blank" rel="noreferrer noopener">{link.label} ↗</a>)}
    </div>)}
    {'followUp' in item && typeof item.followUp === 'string' && item.followUp && <button className="text-button" onClick={() => onCopy(followUpText(item as Assessment))}>复制追问</button>}
  </div>)}</div>;
}

export default function ReviewResult({ review, stale }: Props) {
  const nextStep = nextStepOf(review);
  return <div className={'results' + (stale ? ' outdated' : '')}>
    {stale && <p className="inline-warning" role="status">原文已变化，以下是上一条回答的结果。</p>}
    {partialNotice(review) && <p className="inline-warning partial-notice" role="status">{partialNotice(review)}</p>}
    <section className="brief" aria-label="简写">
      {(review.presentation === 'original' || review.brief.conclusion.text) && <><h2 id="brief-title">{review.presentation === 'original' ? '原文' : '结论'}</h2>
      <p className={'conclusion' + (review.presentation === 'original' ? ' original-text' : '')}>{review.presentation === 'original' ? review.originalText : review.brief.conclusion.text}</p></>}
      {review.presentation !== 'original' && review.brief.points.length > 0 && <section className="key-points" aria-labelledby="points-title">
        <h2 id="points-title">关键要点</h2>
        <ul className="brief-points">{review.brief.points.map((point, i) => <li key={i}>{point.text}</li>)}</ul>
      </section>}
      {review.presentation !== 'original' && nextStep && <section className="next-step" aria-labelledby="next-step-title"><h2 id="next-step-title">下一步</h2><p>{nextStep.text}</p></section>}
    </section>
    {review.assessment.length > 0 && <section className="assessment" aria-labelledby="assessment-title">
      <h2 id="assessment-title">简评</h2>
      {review.assessment.map((item, i) => <p className="assessment-item" key={i}>{item.text}</p>)}
    </section>}
  </div>;
}
