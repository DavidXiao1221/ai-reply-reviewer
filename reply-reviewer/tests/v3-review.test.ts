import { describe, expect, it } from 'vitest';
import { demoInput, demoReview } from '../fixtures/demo';
import { makeManual } from '../lib/snapshot';
import { validateReview } from '../lib/validateReview';
import { readingBudget, visibleLength } from '../lib/readingBudget';
import { requestBody, parseCompletion } from '../lib/deepseek';
import cases from '../fixtures/v3-real-eval-cases.json';
import { briefText } from '../components/ReviewResult';

const input = () => makeManual(demoInput.question, '', demoInput.answer, false);
describe('V3 简写与短评', () => {
  it('演示内容通过真实校验，首屏文字显著短于原回答', async () => {
    const s = await input(), r = validateReview(demoReview, s);
    expect(r.brief).toEqual(demoReview.brief);
    expect(r.assessment).toHaveLength(2);
    expect(r.integrity).toBe('complete');
    expect(r.briefChars / r.sourceChars).toBeLessThan(.35);
    expect((r.briefChars + r.assessmentChars) / r.sourceChars).toBeLessThan(.5);
    expect(r).not.toHaveProperty('findings'); expect(r).not.toHaveProperty('topStatus');
  });
  it.each(['missing-block', 'missing-quote', 'question-only', 'lost-condition'])('简写 %s 拒绝整体，避免丢失关键条件', async kind => {
    const m = structuredClone(demoReview);
    const ref = kind === 'lost-condition' ? m.brief.points.at(-1)!.evidence[0]! : m.brief.conclusion.evidence[0]!;
    if (kind === 'missing-block') ref.blockId = 'b9999';
    if (kind === 'missing-quote' || kind === 'lost-condition') ref.exactQuote = '不存在的引文';
    if (kind === 'question-only') { ref.blockId = 'p001'; ref.exactQuote = demoInput.question; }
    const s = await input(); expect(() => validateReview(m, s)).toThrow('引用不匹配');
  });
  it('错误的短评引用只影响该条，不损失简写或另一条评价', async () => {
    const m = structuredClone(demoReview); m.assessment[1]!.evidence[0]!.blockId = 'b999';
    const r = validateReview(m, await input());
    expect(r.brief).toEqual(m.brief); expect(r.assessment).toHaveLength(1);
    expect(r.omittedAssessments).toBe(1); expect(r.integrity).toBe('partial');
  });
  it('矛盾判断需两处不同引用', async () => {
    const m = structuredClone(demoReview); m.assessment[0]!.text = '前后矛盾。';
    expect(validateReview(m, await input()).omittedAssessments).toBe(1);
    m.assessment[0]!.evidence.push(m.assessment[1]!.evidence[0]!);
    expect(validateReview(m, await input()).omittedAssessments).toBe(0);
  });
  it('允许空短评、单条评价与只有优点，不凑问题', async () => {
    const s = await input();
    for (const assessment of [[], [demoReview.assessment[0]!]]) {
      const r = validateReview({ ...demoReview, assessment }, s);
      expect(r.assessment).toEqual(assessment); expect(r.integrity).toBe('complete');
    }
  });
  it('未提供追问视为 null；追问类型错误仍拒绝，不能借默认值修复正文', async () => {
    const s = await input(), m: any = structuredClone(demoReview);
    delete m.assessment[0].followUp;
    expect(validateReview(m, s).assessment[0]!.followUp).toBeNull();
    m.assessment[0].followUp = 12;
    expect(() => validateReview(m, s)).toThrow('格式');
  });
  it('允许精确引用明确要求支持短评，但不能用于简写', async () => {
    const s = await input(), m = structuredClone(demoReview);
    m.assessment[1]!.evidence = [{ blockId: 'p001', exactQuote: '怎么判断是否值得继续' }];
    expect(validateReview(m,s).assessment).toHaveLength(2);
  });
  it('补充缺失范围不再制造任务卡或阻断可读简写', async () => {
    const s = await input(); s.scope.userReportsMissingContext = true;
    s.scope.extractionWarnings = ['合并单元格按文本读取'];
    expect(validateReview(demoReview, s).brief).toEqual(demoReview.brief);
  });
  it('完全相同的要点和短评只保留一次；不同限定不做模糊去重', async () => {
    const s = await input(), m = structuredClone(demoReview);
    m.brief.points.push(m.brief.conclusion);
    expect(validateReview(m, s).brief).toEqual(demoReview.brief);
    m.brief.points.pop(); m.assessment = [m.assessment[0]!, m.assessment[0]!];
    expect(validateReview(m,s).assessment).toHaveLength(1);
    m.brief.points.push({ ...m.brief.conclusion, text: m.brief.conclusion.text + '仅限试点。' });
    expect(validateReview(m,s).brief.points).toHaveLength(m.brief.points.length);
  });
  it.each(['v2', 'score', 'third-review', 'six-points', 'empty-quote', 'unknown-kind'])('拒绝旧格式或越界 %s', async kind => {
    const m: any = structuredClone(demoReview);
    if (kind === 'v2') m.schemaVersion = '2.0';
    if (kind === 'score') m.confidence = 99;
    if (kind === 'third-review') m.assessment.push(m.assessment[0]);
    if (kind === 'six-points') m.brief.points = Array(6).fill(m.brief.points[0]);
    if (kind === 'empty-quote') m.brief.conclusion.evidence[0].exactQuote = ' ';
    if (kind === 'unknown-kind') m.assessment[0].kind = 'verified';
    const s = await input(); expect(() => validateReview(m,s)).toThrow('格式');
  });
  it('生成内容比原文长时保留原文，不截断条件或整份报错', async () => {
    const s = await input(), m = structuredClone(demoReview);
    m.brief.points = Array.from({length: 5}, (_, i) => ({ text: String(i) + '字'.repeat(230), evidence: m.brief.conclusion.evidence }));
    const r = validateReview(m,s);
    expect(r.presentation).toBe('original');
    expect(r.originalReason).toBe('not-shorter');
    expect(briefText(r)).toBe(demoInput.answer);
    expect(r.briefChars).toBe(r.sourceChars);
  });
  it('有引用的短评超过软预算也完整保留，不因篇幅丢掉判断', async () => {
    const s = await input(), m = structuredClone(demoReview);
    m.assessment.forEach((a, i) => { a.text = String(i) + '评'.repeat(170); });
    const r = validateReview(m,s);
    expect(r.brief).toEqual(m.brief);
    expect(r.assessment).toEqual(m.assessment);
    expect(r.assessmentChars).toBeGreaterThan(readingBudget(s).preferredAssessmentChars);
    expect(r.suppressedAssessments).toBe(0);
    expect(r.omittedAssessments).toBe(0);
  });
  it.each([20, 80, 160, 400, 2000, 10000])('长度 %s 的请求明确区分原文保留和压缩目标', async n => {
    const s = await makeManual('', '', '字'.repeat(n), false), b = readingBudget(s);
    expect(b.briefMode).toBe(n <= 160 ? 'preserve' : 'compress');
    expect(b.targetBriefChars).toBeLessThanOrEqual(b.preferredMaxBriefChars);
    if (n <= 160) expect(b.targetBriefChars).toBe(n);
    const sent = JSON.parse(requestBody(s, 'test').messages[1]!.content);
    expect(sent.output_budget).toMatchObject(b);
  });
  it('略超压缩参考仍保留完整条件，不退回错误也不直接裁切', async () => {
    const s = await input(), m = structuredClone(demoReview);
    m.brief.points = [{ text: '范围'.repeat(100), evidence: m.brief.conclusion.evidence },
      { text: '条件'.repeat(100), evidence: m.brief.points[0]!.evidence }];
    const r = validateReview(m,s);
    expect(r.briefChars).toBeGreaterThan(readingBudget(s).preferredMaxBriefChars);
    expect(r.presentation).toBe('brief');
    expect(r.brief).toEqual(m.brief);
  });
  it.each(['T06','T07'])('%s 即使模型压掉条件或等式，展示和复制仍完整保留短原文', async id => {
    const c = cases.find(c => c.id === id)!;
    const s = await makeManual(c.question!, '', c.answer!, false);
    const m = { schemaVersion: '3.0', brief: { conclusion: { text: '仅保留一个结论。', evidence: [{ blockId:'b001', exactQuote: s.blocks[0]!.text }] }, points: [] }, assessment: [] };
    const r = validateReview(m,s);
    expect(r.presentation).toBe('original');
    expect(briefText(r)).toBe(c.answer);
    expect(r.briefChars).toBe(visibleLength(c.answer!));
    expect(r.assessment).toEqual([]);
  });
  it('原封不动复述简写的短评被省略', async () => {
    const m = structuredClone(demoReview);
    m.assessment = [{kind:'strength',text:m.brief.conclusion.text,evidence:m.brief.conclusion.evidence,followUp:null}];
    const r=validateReview(m,await input());
    expect(r.assessment).toEqual([]); expect(r.suppressedAssessments).toBe(1);
  });
  it('模型只在短评指出前后冲突时，简写正文与复制也保留双侧主张', async () => {
    const c = cases.find(c=>c.id==='T03')!, s = await makeManual(c.question!,c.context!,c.answer!,false);
    const notice = '原文先说不能因果归因，末尾却称已经证实提升30%并外推全渠道订单，前后冲突。';
    const m = {schemaVersion:'3.0',brief:{conclusion:{text:'不能直接归因于新版页面。',evidence:[{blockId:'b001',exactQuote:'现在不能把它直接解释为新版页面的因果效果'}]},points:[]},assessment:[{kind:'caveat',text:notice,evidence:[{blockId:'b001',exactQuote:'现在不能把它直接解释为新版页面的因果效果'},{blockId:'b005',exactQuote:'我们已经证实新版页面使转化率提升30%'}],followUp:null}]};
    const r = validateReview(m,s);
    expect(briefText(r)).toContain(notice);
    expect(r.assessment).toEqual([]);
    expect(r.relocatedAssessments).toBe(1);
    expect(r.briefChars).toBe(visibleLength(m.brief.conclusion.text+notice));
    m.assessment[0]!.evidence.pop();
    expect(validateReview(m,s).relocatedAssessments).toBe(0);
    expect(validateReview(m,s).omittedAssessments).toBe(1);
  });
  it.each([['0.1+0.2=0.3。',true],['177.90-159.95=17.95。',true],['177.90-159.95=18.95。',false],['收入增长：0.1+0.2=0.3。',false]])('仅纯数值且精确成立时阻止算术误报：%s', async (answer, suppress) => {
    const s = await makeManual('核对计算。','',answer,false);
    const m = {schemaVersion:'3.0',brief:{conclusion:{text:answer,evidence:[{blockId:'b001',exactQuote:answer}]},points:[]},assessment:[{kind:'caveat',text:'计算结果有误。',evidence:[{blockId:'b001',exactQuote:answer}],followUp:null}]};
    const r = validateReview(m,s);
    expect(r.assessment).toHaveLength(suppress ? 0 : 1);
    expect(r.suppressedArithmeticAssessments).toBe(suppress ? 1 : 0);
    expect(briefText(r)).toBe(answer);
  });
  it('按可见 Unicode 字符计数，空白不膨胀预算', () => {
    expect(visibleLength('你 好\n🙂')).toBe(3);
  });
  it('新版短评必须声明依据类型；遗漏要求不能只拿回答当依据', async () => {
    const s = await input(), m: any = structuredClone(demoReview);
    m.schemaVersion = '3.2';
    m.assessment = [{kind:'caveat',basis:'unmet_requirement',text:'未满足问题中的必要要求。',evidence:structuredClone(m.brief.conclusion.evidence),followUp:null}];
    const missing = validateReview(m,s);
    expect(missing.assessment).toEqual([]); expect(missing.omittedAssessments).toBe(1);
    m.assessment[0].evidence.push({blockId:'p001',exactQuote:'怎么判断是否值得继续'});
    expect(validateReview(m,s).assessment).toHaveLength(1);
    m.assessment[0].basis = 'hypothetical_risk';
    expect(()=>validateReview(m,s)).toThrow('格式');
  });
  it('3.3分组超限整份拒绝而不截掉条件，旧3.2结果仍可完整读取', async () => {
    const s=await input(), m:any=structuredClone(demoReview);
    m.assessment=[];
    m.brief.points=Array.from({length:4},(_,i)=>({text:'独立条件'+i,evidence:structuredClone(m.brief.conclusion.evidence)}));
    m.schemaVersion='3.3';
    expect(()=>validateReview(m,s)).toThrow('格式');
    m.schemaVersion='3.2';
    expect(validateReview(m,s).brief.points).toHaveLength(4);
    m.schemaVersion='3.3';m.brief.points.pop();
    expect(validateReview(m,s).brief.points).toHaveLength(3);
  });
  it('精确等式阻止仅据等式声称无法核对，但不吞掉问题明确要求的过程缺失', async () => {
    const s = await makeManual('请给出每一步计算过程。', '', '14-6=8。', false);
    const m: any = {schemaVersion:'3.2',brief:{conclusion:{text:'14-6=8。',evidence:[{blockId:'b001',exactQuote:'14-6=8。'}]},points:[]},assessment:[{kind:'caveat',basis:'calculation',text:'未给过程，无法核对。',evidence:[{blockId:'b001',exactQuote:'14-6=8。'}],followUp:null}]};
    expect(validateReview(m,s).assessment).toEqual([]);
    m.assessment[0].basis='unmet_requirement';
    m.assessment[0].evidence.push({blockId:'p001',exactQuote:'请给出每一步计算过程。'});
    expect(validateReview(m,s).assessment).toHaveLength(1);
  });
  it('BOM和单个JSON围栏可读取，拒绝旁白和猜测修复', async () => {
    const s=await input(),json=JSON.stringify(demoReview);
    const response=(content:string)=>({object:'chat.completion',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content}}]});
    for (const content of ['\uFEFF'+json,'```json\n'+json+'\n```']) expect(parseCompletion(response(content),s).review.integrity).toBe('complete');
    for (const content of ['说明：'+json, '```json\n'+json+'\n```\n尾注']) expect(()=>parseCompletion(response(content),s)).toThrow();
  });
});

