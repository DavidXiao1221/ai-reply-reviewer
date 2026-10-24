import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import ReviewResult, { ReviewEvidence, briefText, followUpText } from '../components/ReviewResult';
import { demoInput, demoReview } from '../fixtures/demo';
import { makeManual } from '../lib/snapshot';
import { validateReview } from '../lib/validateReview';

const input = () => makeManual(demoInput.question, '', demoInput.answer, false);
async function rendered(m = demoReview, stale = false) {
  const s = await input(), review = validateReview(m,s);
  const html = renderToStaticMarkup(createElement(ReviewResult,{review,snapshot:s,stale,onLocate:()=>{},onCopy:()=>{}}));
  return { html, doc: new JSDOM(html).window.document, review };
}
describe('V3 阅读优先的界面', () => {
  it('首个内容为简写，评价随后；原句与追问默认折叠', async () => {
    const { doc, html } = await rendered();
    expect([...doc.querySelectorAll('h2')].map(x=>x.textContent)).toEqual(['结论', '关键要点', '简评']);
    expect(doc.querySelector('.conclusion')!.textContent).toBe(demoReview.brief.conclusion.text);
    expect(doc.querySelectorAll('.brief-points>li')).toHaveLength(3);
    expect(doc.querySelectorAll('details[open]')).toHaveLength(0);
    for (const removed of ['任务覆盖','高影响','完成标准','需要你决定','审阅范围或结果不完整','已处理事项']) expect(html).not.toContain(removed);
  });
  it('复制简写只包含核心结论与要点，不夹带评价和运行信息', async () => {
    const { review } = await rendered(), text = briefText(review);
    expect(text).toContain(demoReview.brief.conclusion.text);
    expect(text).toContain(demoReview.brief.points.at(-1)!.text);
    expect(text).not.toContain(demoReview.assessment[0]!.text);
    expect(text).not.toContain('schema');
  });
  it('追问包含对应原句和具体动作', () => {
    const a=demoReview.assessment[1]!,text=followUpText(a);
    expect(text).toContain(a.followUp); expect(text).toContain(a.evidence[0]!.exactQuote);
  });
  it('来自模型的HTML仍转义为文本', async () => {
    const m=structuredClone(demoReview); m.brief.conclusion.text='<img src=x onerror=alert(1)>';
    const {html,doc}=await rendered(m); expect(html).toContain('&lt;img'); expect(doc.querySelector('img')).toBeNull();
  });
  it('引用错误的短评不会展示虚构引文，简写保留', async () => {
    const m=structuredClone(demoReview);m.assessment[0]!.evidence[0]!.exactQuote='虚构引文';
    const {html,doc,review}=await rendered(m);expect(html).not.toContain('虚构引文');expect(doc.querySelector('.conclusion')).not.toBeNull();expect(review.omittedAssessments).toBe(1);expect(html).not.toContain('未通过校验');
  });
  it('原文变化后定位禁用，明确结果属于上一条', async () => {
    const {html,review}=await rendered(demoReview,true);
    expect(html).toContain('上一条');
    const doc = new JSDOM(renderToStaticMarkup(createElement(ReviewEvidence,{review,snapshot:await input(),stale:true,onLocate:()=>{},onCopy:()=>{}}))).window.document;
    expect(doc.querySelectorAll('.evidence-item button').length).toBeGreaterThan(0);
    expect([...doc.querySelectorAll('.evidence-item button')].every(el => el.hasAttribute('disabled'))).toBe(true);
  });
  it('没有增量短评时不占据空面板', async () => {
    const m = structuredClone(demoReview); m.assessment = [];
    const { doc, html } = await rendered(m);
    expect(doc.querySelector('.assessment')).toBeNull();
    expect(html).not.toContain('没有足够依据');
  });
  it('短回答展示并复制完整原文，空短评不出现面板', async () => {
    const answer = '只有完成审核且负责人签字才能上线；否则延期。\n\n先放5%流量，异常立即回滚。';
    const s = await makeManual('何时上线？','',answer,false);
    const review = validateReview({schemaVersion:'3.0',brief:{conclusion:{text:'可以上线。',evidence:[{blockId:'b001',exactQuote:s.blocks[0]!.text}]},points:[]},assessment:[]},s);
    const doc = new JSDOM(renderToStaticMarkup(createElement(ReviewResult,{review,snapshot:s,stale:false,onLocate:()=>{},onCopy:()=>{}}))).window.document;
    expect(doc.querySelector('h2')!.textContent).toBe('原文');
    expect(doc.querySelector('.conclusion')!.textContent).toBe(answer);
    expect(doc.querySelector('.assessment')).toBeNull();
    expect(doc.querySelector('.brief-points')).toBeNull();
    expect(briefText(review)).toBe(answer);
  });
});

