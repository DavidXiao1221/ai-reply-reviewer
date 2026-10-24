import type { ReviewSnapshot } from './types';
import { checkEquation } from './arithmetic';

const count = (s: string) => /^\d+$/.test(s) ? Number(s) : '一二三四五六七八九十'.indexOf(s) + 1;
// Deliberately narrow: a total-attempt declaration and an explicit ordered list
// of delays in the same sentence. This is arithmetic, not a reliability review.
export function sourceChecks(snapshot: ReviewSnapshot) {
  const checks: Array<object> = [];
  if (snapshot.blocks.length === 1) {
    const block = snapshot.blocks[0]!, expression = block.text.trim().replace(/[。.]$/, '');
    if (expression && checkEquation(expression).result === 'passed')
      checks.push({kind:'exact_equality', evidence:{blockId:block.id,exactQuote:block.text}, equalityHolds:true,
        scope:'仅证明此完整纯数字等式成立；不证明它满足问题的单位、口径、格式或过程要求。'});
  }
  for (const block of snapshot.blocks) {
    for (const sentence of block.text.match(/[^。！？\n]+[。！？]?/gu) ?? []) {
      const totals = [...sentence.matchAll(/(?<![\d零〇一二三四五六七八九十百千万])([1-9]\d*|[一二三四五六七八九十])\s*次总尝试/gu)];
      const delays = sentence.match(/间隔(?:时间)?(?:依次|分别)(?:为)?\s*(\d+(?:\.\d+)?\s*秒(?:\s*(?:、|，|,|和|及)\s*\d+(?:\.\d+)?\s*秒)*)/u);
      if (totals.length !== 1 || !delays) continue;
      const totalAttempts = count(totals[0]![1]!);
      const delaySeconds = [...delays[1]!.matchAll(/(\d+(?:\.\d+)?)\s*秒/gu)].map(m => Number(m[1]));
      if (totalAttempts < 2 || totalAttempts > 100 || delaySeconds.some(n => !Number.isFinite(n))) continue;
      checks.push({
        kind: 'retry_count' as const,
        evidence: { blockId: block.id, exactQuote: sentence.trim() },
        totalAttempts, retries: totalAttempts - 1, delaySeconds,
        intervalCountMatches: delaySeconds.length === totalAttempts - 1,
      });
    }
  }
  return checks;
}
