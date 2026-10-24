import type { ReviewSnapshot } from './types';
import type { EvidenceRef } from './reviewSchema';

export type ProtectedPassage = { text: string; evidence: EvidenceRef[] };
const length = (s: string) => Array.from(s.replace(/\s/gu, '')).length;
const sentences = (s: string) => s.match(/[^。！？\n]+[。！？]?/gu)?.map(s => s.trim()).filter(Boolean) ?? [];

// Conservative source excerpts, not a semantic completeness detector. Preserve
// complete sentences/paragraphs so negation, alternatives and antecedents survive.
// No fixture ids, expected answers, business numbers or generated text are used.
export function protectedPassages(snapshot: ReviewSnapshot): ProtectedPassage[] {
  if (length(snapshot.blocks.map(b => b.text).join('')) <= 160) return [];
  const passages: ProtectedPassage[] = [];
  for (const block of snapshot.blocks) {
    if (block.kind === 'code' || block.kind === 'table') continue;
    const wholeScope = /只能?提供方向信号|(?:没有|未)(?:实际)?运行代码|(?:没有|未)(?:替[^，。；]{0,12})?(?:实际)?打开[^。]{0,15}网页/u.test(block.text);
    const selected = wholeScope ? [block.text] : sentences(block.text).filter(sentence =>
      /(?:如果|若)[^。]*(?:失败|出错)[^。]*(?:回滚|撤销|恢复)/u.test(sentence) ||
      /提交成功[^。]*才/u.test(sentence) ||
      /(?:不能|不应|不要|不可)[^。]*(?:只|仅)(?:因|因为)|如果(?:只|仅)(?:因|因为)[^。]*(?:会|将)/u.test(sentence) ||
      /(?:提纲|摘要|概述)[^。]*(?:不是|并非|未见|未提供)[^。]*(?:完整|全文|原稿)|(?:仅|只)(?:看到|看见|读到|见)[^。]*(?:提纲|摘要|片段)|未见(?:完整|全文|原稿)/u.test(sentence) ||
      /不(?:声称|宣称)|(?:尚)?未(?:确认|证实)|不能[^。]{0,20}(?:归因|因果)|不能把[^。]*归因/u.test(sentence) ||
      /(?:下一|未来|下个|明年|下月)[^。]*(?:所有|全部|全渠道)[^。]*(?:安排|预期|增长)/u.test(sentence)
    );
    for (const text of selected) {
      if (!passages.some(p => p.text === text)) passages.push({text,evidence:[{blockId:block.id,exactQuote:text}]});
    }
  }
  return passages;
}

// Narrow lexical guard for an explicit unconfirmed positive proposition.
// Only inspect generated claims anchored to that same block. This cannot prove
// arbitrary paraphrases correct; uncertain matches fall back to the full source.
export function strengthensUncertainty(items: Array<{text:string;evidence:EvidenceRef[]}>, snapshot: ReviewSnapshot) {
  const pairs = [
    {positive:'足够',negative:['不足','不够']},
    {positive:'充分',negative:['不充分']},
    {positive:'有效',negative:['无效']},
    {positive:'正确',negative:['错误','不正确']},
    {positive:'安全',negative:['不安全']},
    {positive:'可靠',negative:['不可靠']},
  ];
  for (const block of snapshot.blocks) {
    for (const pair of pairs) {
      const unknown = new RegExp('(?:不(?:声称|宣称)|(?:尚)?未(?:确认|证实))[^。！？；\\n]*'+pair.positive,'u');
      if (!unknown.test(block.text) || block.text.split(pair.positive).length !== 2 || pair.negative.some(n => block.text.includes(n))) continue;
      for (const item of items.filter(i => i.evidence.some(e => e.blockId === block.id))) {
        for (const clause of item.text.split(/[，。！？；\n]/u)) {
          const marker = [...pair.negative,pair.positive].find(p => clause.includes(p));
          if (!marker) continue;
          const before = clause.slice(0,clause.indexOf(marker));
          if (!/未|不(?:声称|宣称|代表|等于)|无法|不能|尚待|待确认|是否|能否|未知/u.test(before)) return true;
        }
      }
    }
  }
  return false;
}
