import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { lightweightCases } from '../fixtures/lightweight';
import { makeManual } from '../lib/snapshot';
import { validateReview } from '../lib/validateReview';
import { requestBody, parseCompletion } from '../lib/deepseek';
import ReviewResult, { ReviewEvidence, briefText, reviewText } from '../components/ReviewResult';
import { extractChatGPT } from '../adapters/chatgpt';

const input = async (i = 0) => { const c = lightweightCases[i]!; return makeManual(c.question, '', c.answer, false); };
const model = () => structuredClone(lightweightCases[0]!.expected);
const completion = (value: unknown) => ({object:'chat.completion',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});

describe('轻量契约：模拟材料的解析、展示和复制（非真实模型质量测试）', () => {
  it.each(lightweightCases)('$name 的手写期望结果不丢字段，首屏正文完整显示', async c => {
    expect(c.origin).toBe('synthetic-from-screenshot-topics');
    const s = await makeManual(c.question, '', c.answer, false), r = parseCompletion(completion(c.expected), s).review;
    expect(r.integrity).toBe('complete');
    expect(r.brief.points.length).toBeLessThanOrEqual(3);
    expect(r.assessment.length).toBeLessThanOrEqual(1);
    expect(r.briefChars + r.assessmentChars).toBeLessThanOrEqual(350);
    expect(r.preservedPassages).toBe(0);
    const props = {review:r,snapshot:s,stale:false,onLocate:()=>{},onCopy:()=>{}};
    const doc = new JSDOM(renderToStaticMarkup(createElement(ReviewResult,props))).window.document;
    expect(doc.querySelector('h2')!.textContent).toBe('结论');
    expect(doc.querySelectorAll('button,details,blockquote')).toHaveLength(0);
    expect(doc.querySelector('.reading-size')).toBeNull();
    for (const p of c.expected.brief.points) expect(doc.querySelector('.brief-points')!.textContent).toContain(p.text);
    expect(!!doc.querySelector('.next-step')).toBe(!!c.expected.brief.nextStep);
    if (c.expected.brief.nextStep) expect(briefText(r)).toContain(c.expected.brief.nextStep.text);
    expect(!!doc.querySelector('.assessment')).toBe(c.expected.assessment.length > 0);
    for (const a of c.expected.assessment) {
      expect(doc.querySelector('.assessment')!.textContent).toContain(a.text);
      expect(reviewText(r)).toContain('简评：' + a.text);
      expect(briefText(r)).not.toContain(a.text);
    }
    const evidence = new JSDOM(renderToStaticMarkup(createElement(ReviewEvidence,props))).window.document;
    expect(evidence.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(reviewText(r)).not.toContain('schemaVersion');
  });
  it('请求只发匹配问答、补充和软预算，不发手写结果或截图推测', async () => {
    const s = await input(), data = JSON.parse(requestBody(s,'saved-custom-model').messages[1]!.content);
    expect(data.user_prompt[0].text).toBe(s.question);
    expect(data.target_response.map((b:any)=>b.text)).toEqual(s.blocks.map(b=>b.text));
    expect(data.output_budget.preferredMaxTotalChars).toBe(350);
    for (const key of ['expected','mustKeep','preserved_passages','source_checks']) expect(data).not.toHaveProperty(key);
    const noQuestion = await makeManual('', '', s.blocks.map(b=>b.text).join('\n\n'), false);
    expect(JSON.parse(requestBody(noQuestion,'saved-custom-model').messages[1]!.content).user_prompt).toEqual([]);
  });
  it.each(['four-points','empty-conclusion','wrong-next-step','invented-next-evidence','wrong-points','object-points','bad-version'])('异常 %s 按3.3.2区分部分可用与整体失败', async kind => {
    const s = await input(), m:any = model();
    if (kind === 'four-points') m.brief.points = Array(4).fill(m.brief.points[0]);
    if (kind === 'empty-conclusion') m.brief.conclusion.text = ' ';
    if (kind === 'wrong-next-step') m.brief.nextStep = '行动';
    if (kind === 'invented-next-evidence') m.brief.nextStep.evidence[0].exactQuote = '不在原文中';
    if (kind === 'wrong-points') m.brief.points = '要点';
    if (kind === 'object-points') m.brief.points = {text:'',evidence:[]};
    if (kind === 'bad-version') m.schemaVersion = '9.0';
    if(['four-points','bad-version'].includes(kind))expect(()=>parseCompletion(completion(m),s)).toThrow();
    else {
      const r=parseCompletion(completion(m),s).review;
      expect(r.integrity).toBe('partial');
      expect(reviewText(r)).toContain('Partial');
      if(kind==='empty-conclusion')expect(r.brief.conclusion.text).toBe('');
      else expect(r.brief.conclusion.text).toBe(m.brief.conclusion.text);
    }
  });
  it('没有下一步和简评时接受省略，不显示空白区域', async () => {
    const s = await input(), m:any = model(); delete m.brief.nextStep; delete m.assessment;
    const r = validateReview(m,s); expect(r.assessment).toEqual([]);
    expect('nextStep' in r.brief && r.brief.nextStep).toBeNull();
  });
  it('简评引用无效或无实质发现时只隐藏简评，不显示占位卡', async () => {
    const s = await input();
    for (const text of ['无实质发现', '有具体问题']) {
      const m = model(); m.assessment[0]!.text = text;
      if (text !== '无实质发现') m.assessment[0]!.evidence[0]!.exactQuote = '虚构引文';
      const r = validateReview(m,s);
      expect(r.assessment).toEqual([]); expect(r.brief.conclusion.text).toBe(m.brief.conclusion.text);
      const html = renderToStaticMarkup(createElement(ReviewResult,{review:r,snapshot:s,stale:false,onLocate:()=>{},onCopy:()=>{}}));
      expect(html).not.toContain('assessment-title'); expect(html).not.toContain('未通过');
    }
  });
  it('不把简评移入第四条要点；复制完整结果仍包含它', async () => {
    const s = await input(), m = model();
    m.brief.points.push({...m.brief.points[0]!,text:'额外独立限制。'});
    m.assessment[0]!.text = '原回答前后矛盾，需要区分结论的适用范围。';
    m.assessment[0]!.evidence.push(m.brief.conclusion.evidence[0]!);
    const r = validateReview(m,s);
    expect(r.brief.points).toHaveLength(3); expect(r.assessment).toHaveLength(1);
    expect(r.relocatedAssessments).toBe(0); expect(reviewText(r)).toContain(m.assessment[0]!.text);
  });
  it('超过350软目标的合法内容完整显示及复制，不切掉末尾限定', async () => {
    const s = await input(), m = model();
    m.brief.points = [0,1,2].map(i=>({...m.brief.points[0]!,text:'独立条件'+i+'。仅在满足条件时执行。'.repeat(13)+'否则延期。'}));
    const r=validateReview(m,s);
    expect(r.briefChars + r.assessmentChars).toBeGreaterThan(350);
    expect(r.presentation).toBe('brief');
    for (const point of m.brief.points) expect(briefText(r)).toContain(point.text);
  });
  it('空回答在调用前拒绝；短回答保留完整原文与限制', async () => {
    await expect(makeManual('','','  ',false)).rejects.toThrow();
    const s = await makeManual('何时上线？','','仅审核通过且负责人签字才上线；否则延期。',false);
    const m = {schemaVersion:'3.5',brief:{conclusion:{text:'可上线。',evidence:[{blockId:'b001',exactQuote:s.blocks[0]!.text}]},points:[]},assessment:[]};
    const r=validateReview(m,s);expect(r.presentation).toBe('original');expect(briefText(r)).toBe(s.blocks[0]!.text);
  });
});

describe('连续追问严格匹配当前轮次', () => {
  it.each(['modern','classic'])('%s：追问不能拿上一轮问题评判当前回答', async layout => {
    const html = layout === 'modern'
      ? '<article data-talvt-turn-state="complete"><div data-user-message-bubble="true">Pi是什么？</div><div data-markdown-text-style="assistant-message"><p>旧解释。</p></div></article><article data-talvt-turn-state="complete"><div data-user-message-bubble="true">那我已有Codex还值得试吗？</div><div data-markdown-text-style="assistant-message"><p>只为学习试一次。</p></div></article>'
      : '<div data-message-author-role="user">Pi是什么？</div><div data-message-author-role="assistant"><p>旧解释。</p></div><div data-message-author-role="user">那我已有Codex还值得试吗？</div><div data-message-author-role="assistant"><p>只为学习试一次。</p></div>';
    const d = new JSDOM(html,{url:'https://chatgpt.com/c/regression'}).window.document;
    const r=extractChatGPT(d);
    expect(r.question).toBe('那我已有Codex还值得试吗？');expect(r.blocks.map(b=>b.text)).toEqual(['只为学习试一次。']);
    const s=await makeManual(r.question,'',r.blocks[0]!.text,false), data=JSON.parse(requestBody(s,'test').messages[1]!.content);
    expect(data.user_prompt[0].text).toBe(r.question);expect(data.target_response[0].text).toBe('只为学习试一次。');
  });
  it('最新轮缺失问题时保持为空，不能借用上一轮问题', () => {
    const d=new JSDOM('<article data-talvt-turn-state="complete"><div data-user-message-bubble="true">旧问题</div><div data-markdown-text-style="assistant-message">旧答案</div></article><article data-talvt-turn-state="complete"><div data-markdown-text-style="assistant-message"><p>新答案。</p></div></article>').window.document;
    expect(extractChatGPT(d).question).toBe('');
  });
});
