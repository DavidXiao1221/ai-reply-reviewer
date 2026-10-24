import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { captureAI, extractAI, extractGemini, extractPerplexity } from '../adapters/aiSites';
import { aiSite } from '../lib/sites';

// Reduced fixtures using attributes observed on public pages on 2026-10-24.
const gemini = (text = '首段内容。') => `<user-query><div class="query-text"><p>当前问题</p></div><button>复制提示</button></user-query><model-response><model-thoughts><div class="markdown">不采集思考</div></model-thoughts><model-response-content><message-content id="r_1"><div class="markdown" aria-busy="false"><p>${text}<a href="https://example.com/report">报告</a></p><ul><li>必要条件</li></ul><pre>let a = 1;\na++;</pre><table><tr><th>类别</th><th>值</th></tr><tr><td>A</td><td>2</td></tr></table></div></message-content></model-response-content><message-actions><copy-button><button aria-label="复制">复制</button></copy-button></message-actions></model-response>`;
const perplexity = (text = '首段内容。') => `<div data-message-bubble="right"><div data-renderer="lm"><p>当前问题</p></div></div><div data-workflow-final-text><div data-workflow-items="populated"><div class="prose" data-renderer="lm"><p>${text}<a href="https://example.com/report">报告</a></p><ul><li>必要条件</li></ul></div></div><div data-workflow-text-footer><button aria-label="复制">复制</button><button>相关来源</button></div></div>`;
const makeDoc = (html: string, site: string) => new JSDOM(html, { url: `https://${site}/app/test` }).window.document;

describe.each([
  ['Gemini', 'gemini.google.com', gemini, extractGemini, 'user-query', 'message-actions'],
  ['Perplexity', 'www.perplexity.ai', perplexity, extractPerplexity, '[data-message-bubble="right"]', '[data-workflow-text-footer]'],
] as const)('%s 网页读取', (_name, host, fixture, extract, user, footer) => {
  it('读取最新完整问答、块结构和链接，排除按钮、隐藏内容和思考', () => {
    const doc = makeDoc(fixture('旧回答') + fixture(), host);
    doc.querySelectorAll('p').item(3)?.insertAdjacentHTML('beforeend', '<span hidden>隐藏文字</span>');
    const r = extract(doc);
    expect(r.question).toBe('当前问题');
    expect(r.blocks[0]!.text).toBe('首段内容。报告');
    expect(r.blocks[0]!.citations).toEqual([{ label: '报告', url: 'https://example.com/report' }]);
    expect(r.blocks.map(b => b.text).join('')).not.toMatch(/复制|思考|相关来源|隐藏文字|旧回答/);
    expect(extract(doc).targetId).toBe(r.targetId);
  });
  it('缺少当前问题时保持为空，不编造问题', () => {
    const doc = makeDoc(fixture(), host); doc.querySelector(user)!.remove();
    expect(extract(doc).question).toBe('');
  });
  it('新问题没有回答时，不回退到上一条', () => {
    const doc = makeDoc(fixture(), host);
    doc.body.append(doc.querySelector(user)!.cloneNode(true));
    expect(() => extract(doc)).toThrow('最新提问');
  });
  it('没有完成控件，不提前发起审阅', () => {
    const doc = makeDoc(fixture(), host); doc.querySelector(footer)!.remove();
    expect(() => extract(doc)).toThrow('等待');
  });
  it.each(['停止生成', 'Stop generating'])('生成控件 %s 阻止读取半篇回答', label => {
    const doc = makeDoc(fixture() + `<button aria-label="${label}"></button>`, host);
    expect(() => extract(doc)).toThrow('仍在生成');
  });
  it('正文标记忙碌时等待', () => {
    const doc = makeDoc(fixture(), host); doc.querySelector('.markdown,.prose')!.setAttribute('aria-busy', 'true');
    expect(() => extract(doc)).toThrow('等待');
  });
  it('稳定检查拒绝内容变化和页面跳转', async () => {
    const doc = makeDoc(fixture(), host);
    await expect(captureAI(doc, async () => { doc.querySelectorAll('p').item(1).append('新内容'); })).rejects.toThrow('变化');
    await expect(captureAI(doc, async () => { doc.defaultView!.history.pushState({}, '', '/app/another'); })).rejects.toThrow('变化');
    expect((await captureAI(doc, async () => {})).blocks.length).toBeGreaterThan(0);
  });
  it('不识别的页面不会读取整页', () => {
    const doc = makeDoc('<main><div class="prose">其他正文</div></main>', host);
    expect(() => extract(doc)).toThrow('没有找到');
  });
});
it('仅允许精确的 HTTPS AI 域名，普通网页仅走选区入口', () => {
  expect(aiSite('https://gemini.google.com/app')).toBe('gemini');
  expect(aiSite('https://perplexity.ai/search/test')).toBe('perplexity');
  for (const url of ['http://chatgpt.com/', 'https://chatgpt.com.evil.test/', 'https://example.com/', 'chrome://settings']) expect(aiSite(url)).toBeNull();
  expect(() => extractAI(makeDoc('<p>正文</p>', 'example.com'))).toThrow('右键');
});
it('Gemini 保留代码和表格', () => {
  const r = extractGemini(makeDoc(gemini(), 'gemini.google.com'));
  expect(r.blocks.find(b => b.kind === 'code')!.text).toBe('let a = 1;\na++;');
  expect(r.blocks.find(b => b.kind === 'table')!.text).toBe('类别\t值\nA\t2');
});
it('Gemini 不重复采集供屏幕阅读器使用的提问副本', () => {
  const doc = makeDoc(gemini(), 'gemini.google.com');
  doc.querySelector('.query-text')!.insertAdjacentHTML('afterbegin', '<h5 class="cdk-visually-hidden">你说 当前问题</h5>');
  expect(extractGemini(doc).question).toBe('当前问题');
});
