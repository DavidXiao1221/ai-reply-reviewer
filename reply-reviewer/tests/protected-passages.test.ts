import { describe, expect, it, vi } from 'vitest';
import { makeManual } from '../lib/snapshot';
import { protectedPassages, strengthensUncertainty } from '../lib/protectedPassages';
import { validateReview } from '../lib/validateReview';
import { requestBody, reviewWithDeepSeek } from '../lib/deepseek';
import { visibleLength } from '../lib/readingBudget';
import { briefText } from '../components/ReviewResult';
import type { ReviewSnapshot } from '../lib/types';

const background = '项目背景和沟通安排。'.repeat(24);
const source = (text: string) => makeManual('说明计划。', '', text+'\n\n'+background, false);
const item = (text: string, s: ReviewSnapshot, index = 0) => ({text,evidence:[{blockId:s.blocks[index]!.id,exactQuote:s.blocks[index]!.text}]});
const model = (text: string, s: ReviewSnapshot) => ({schemaVersion:'3.4',brief:{conclusion:item(text,s),points:[] as ReturnType<typeof item>[]},assessment:[] as any[]});

describe('保留条件及结论强度：独立于固定评测案例的回归', () => {
  it('提交与双失败分支逐字进入可复制正文，不能只藏在依据中', async () => {
    const a='仅提交成功后才更新版本号。', b='若文件写入或版本号保存失败，则全部回滚，恢复旧版本。';
    const s=await source(a+b), r=validateReview(model('采用原子发布。',s),s);
    expect(r.presentation).toBe('brief');
    expect(briefText(r)).toContain(a); expect(briefText(r)).toContain(b);
    for(const p of r.brief.points) expect(s.blocks.find(b=>b.id===p.evidence[0]!.blockId)!.text).toContain(p.text);
    expect(r.briefChars).toBe(visibleLength('采用原子发布。'+a+b));
  });
  it('材料范围和执行状态直接保留，不用问题中的额外声明替换原文', async () => {
    const a='这里只看到摘要，并非完整原稿，以下是调查安排。';
    const b='这里没有运行代码，结果仍依赖部署环境。';
    const s=await source(a+'\n\n'+b);
    s.question='若保存失败必须恢复原值。';
    const r=validateReview(model('准备调查。',s),s), copied=briefText(r);
    expect(copied).toContain(a); expect(copied).toContain(b);
    expect(copied).not.toContain(s.question);
    expect(protectedPassages(s).every(p=>p.evidence.every(e=>e.blockId.startsWith('b')))).toBe(true);
  });
  it('原句已完整生成则不再附加；相似但不同的失败条件不会模糊去重', async () => {
    const a='若存储失败则回滚到旧版本。', b='若发布失败则回滚到待审状态。';
    const s=await source(a+b), m=model(a,s), r=validateReview(m,s);
    expect(briefText(r).split(a)).toHaveLength(2);
    expect(briefText(r)).toContain(b);
    expect(r.preservedPassages).toBe(1);
  });
  it('新请求不要求拼接保留句，旧实验结果仍可读取且只调用一次', async () => {
    const s=await source('若写入失败则恢复旧版本。'), m=model('先校验。',s);
    const body=requestBody(s,'test'), data=JSON.parse(body.messages[1]!.content);
    expect(data).not.toHaveProperty('preserved_passages');
    expect(data.output_budget).not.toHaveProperty('preservedChars');
    expect(data.target_response[0].text).toContain('若写入失败则恢复旧版本。');
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({object:'chat.completion',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(m)}}]})));
    const result=await reviewWithDeepSeek(s,'synthetic-key','test',new AbortController().signal,90000,fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(briefText(result.review)).toContain('若写入失败则恢复旧版本。');
  });
  it('可按需要保留六个独立组，超过三组不拒绝也不截断', async () => {
    const s=await source('计划按步骤执行。'), m=model('按步骤落实。',s);
    m.brief.points=Array.from({length:6},(_,i)=>item(`第${i+1}项有独立条件。`,s));
    const r=validateReview(m,s);
    expect(r.brief.points).toHaveLength(6); expect(briefText(r)).toContain('第6项有独立条件。');
  });
  it.each(['条件不充分。','条件充分。'])('未确认不能改成明确结论：%s', async text => {
    const s=await source('本次尚未确认启动条件充分。'), r=validateReview(model(text,s),s);
    expect(r.presentation).toBe('original'); expect(r.originalReason).toBe('fidelity');
    expect(briefText(r)).toBe(s.blocks.map(b=>b.text).join('\n\n'));
  });
  it.each(['暂不能认定条件充分。','是否充分尚待核验。','未确认条件充分，也不能认定不充分。'])('保留未定状态不会触发回退：%s', async text => {
    const s=await source('本次尚未确认启动条件充分。');
    expect(validateReview(model(text,s),s).originalReason).toBeNull();
  });
  it('同一谓词出现在别的依据块，不据此声称发现结论加强', async () => {
    const s=await source('本次尚未确认条件充分。\n\n另一个流程的条件确实充分。');
    expect(strengthensUncertainty([item('另一流程条件充分。',s,1)],s)).toBe(false);
  });
  it('原文已明确否定，不反过来要求它保持未确认', async () => {
    const s=await source('本次测试已经确认条件不充分。');
    expect(validateReview(model('条件不充分。',s),s).presentation).toBe('brief');
  });
  it('加强结论的短评被隐藏，另一个有依据的增量判断仍保留', async () => {
    const s=await source('本次不声称评估结果可靠。\n\n月费相等的点由报价计算；执行上建议先观察两周。');
    const m=model('先完成评估。',s);
    m.assessment=[
      {kind:'caveat',basis:'calculation',...item('评估结果不可靠。',s)},
      {kind:'caveat',basis:'decision_rule',...item('两周是观察规则，不是由费用等式推出的条件。',s,1)},
    ];
    const r=validateReview(m,s);
    expect(r.omittedAssessments).toBe(1); expect(r.assessment).toHaveLength(1);
    expect(r.assessment[0]!.text).toContain('两周是观察规则');
  });
  it('短原文及代码不做片段抽取；短原文在显示和复制中保持完整', async () => {
    const short=await makeManual('','', '尚未确认结果有效。',false);
    expect(protectedPassages(short)).toEqual([]);
    expect(briefText(validateReview(model('结果无效。',short),short))).toBe('尚未确认结果有效。');
    const code=await source('```\n若写入失败则回滚。\n```');
    expect(protectedPassages(code)).toEqual([]);
  });
  it('保护句令简写不再短时回显原文，不裁剪其中的条件', async () => {
    const s=await makeManual('','','这里没有运行代码。'+background,false), m=model('需要接入验证。',s);
    const r=validateReview(m,s);
    expect(r.presentation).toBe('original'); expect(r.originalReason).toBe('not-shorter');
    expect(briefText(r)).toBe(s.blocks[0]!.text);
  });
  it('冲突短评并入后才超过原文时，回显原文且保留冲突判断', async () => {
    const text='前段主张立即发布，末段主张延期。'+ '背景材料。'.repeat(34);
    const s=await makeManual('','',text,false), m=model('需要复核。'+'说明。'.repeat(43),s);
    const note={kind:'caveat',basis:'contradiction',text:'前后冲突：前段要求立即发布，末段要求延期，两种安排不能同时执行。',evidence:[{blockId:'b001',exactQuote:'前段主张立即发布'},{blockId:'b001',exactQuote:'末段主张延期'}]};
    m.assessment=[note];
    // Set the brief a little below source length so the relocated notice is the trigger.
    m.brief.conclusion.text='简写。'.repeat(Math.floor((visibleLength(text)-10)/3));
    const r=validateReview(m,s);
    expect(r.presentation).toBe('original'); expect(r.relocatedAssessments).toBe(0);
    expect(r.assessment[0]!.text).toBe(note.text);
    expect(r.briefChars+r.assessmentChars).toBe(visibleLength(text+note.text));
  });
});
