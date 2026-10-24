import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { captureAI, extractAI, extractGrok } from '../adapters/aiSites';
import { aiSite, AI_MATCHES, isAutoSource, siteLabel } from '../lib/sites';

// Reduced structural fixtures, not a claim of live grok.com verification.
// Provenance and limitations: docs/v3.4.1-grok.md.
const user = (id = 'u1', text = '当前问题') => `<div id="response-${id}" class="items-end"><div class="message-bubble user"><div class="response-content-markdown"><p>${text}</p></div><section class="inline-media-container">附件文件名</section></div><div class="action-buttons"><button title="Edit">编辑</button></div></div>`;
const reply = (id = 'a1', text = '回答正文。') => `<div id="response-${id}" class="items-start"><div class="message-bubble"><div class="relative"><div class="thinking-container"><div class="response-content-markdown markdown"><p>不读取思考</p></div></div><div class="response-content-markdown markdown"><h2>标题</h2><p>${text}<a href="https://example.com/report">来源</a><span hidden>隐藏内容</span></p><ul><li>条件一</li></ul></div><div><pre><code>let x = 1;\nx++;</code><button>复制代码</button></pre></div><div class="response-content-markdown markdown"><table><tr><th>类型</th><th>值</th></tr><tr><td>A</td><td>2</td></tr></table></div><section class="inline-media-container">图片说明</section><section class="auto-notification">系统通知</section></div></div><div class="action-buttons"><button title="Copy">复制</button><button title="Share">分享</button></div></div>`;
const makeDoc = (html = user() + reply()) => new JSDOM(`<nav>导航历史</nav><main>${html}</main><textarea>草稿</textarea>`, { url: 'https://grok.com/c/test' }).window.document;

describe('Grok 自动采集', () => {
  it('读取最新一轮、保留段落代码表格和链接，并排除思考、附件、按钮及隐藏文字', () => {
    const doc = makeDoc(user('old-u', '旧问题') + reply('old-a', '旧回答') + user() + reply());
    const result = extractAI(doc);
    expect(result.question).toBe('当前问题');
    expect(result.targetId).toBe('grok:response-a1');
    expect(result.blocks.map(b => b.kind)).toEqual(['heading', 'paragraph', 'list', 'code', 'table']);
    expect(result.blocks.map(b => b.text)).toEqual(['标题', '回答正文。来源', '条件一', 'let x = 1;\nx++;', '类型\t值\nA\t2']);
    expect(result.blocks[1]!.citations).toEqual([{ label: '来源', url: 'https://example.com/report' }]);
    expect(result.elements.get('b002')).toBe(doc.querySelector('#response-a1 .markdown > p:has(a)'));
    expect(extractGrok(doc).targetId).toBe(result.targetId);
  });
  it('用户 bubble 没有 user 类时，仍依据其消息容器区分角色', () => {
    const doc = makeDoc(); doc.querySelector('.message-bubble.user')!.classList.remove('user');
    expect(extractGrok(doc).question).toBe('当前问题');
  });
  it('回答内的右对齐内容不会误判为用户消息', () => {
    const doc = makeDoc(); doc.querySelector('#response-a1 p')!.classList.add('items-end');
    expect(extractGrok(doc).targetId).toBe('grok:response-a1');
  });
  it('缺少提问时留空', () => expect(extractGrok(makeDoc(reply())).question).toBe(''));
  it('最新提问没有可读正文时不借用上一轮问题', () => {
    const doc = makeDoc(user('old-u', '旧问题') + reply('old-a') + user() + reply());
    doc.querySelector('#response-u1 .message-bubble')!.remove();
    expect(extractGrok(doc).question).toBe('');
  });
  it('新问题尚无回答时不回退到旧答案', () => {
    expect(() => extractGrok(makeDoc(user() + reply() + user('u2', '新问题')))).toThrow('最新提问');
  });
  it('隐藏的其他分支不影响当前问答', () => {
    const doc = makeDoc(); doc.querySelector('main')!.insertAdjacentHTML('beforeend', `<div hidden>${user('u2') + reply('a2')}</div>`);
    expect(extractGrok(doc).targetId).toBe('grok:response-a1');
  });
  it('未知最新消息布局不会回退到旧答案', () => {
    const doc = makeDoc(user() + reply() + reply('a2')); doc.querySelector('#response-a2')!.className = 'unknown';
    expect(() => extractGrok(doc)).toThrow('布局');
  });
  it.each(['Stop', 'Stop generating', 'Stop model response', '停止生成', '停止回答'])('存在生成控件 %s 时不采集', label => {
    const doc = makeDoc(); doc.body.insertAdjacentHTML('beforeend', `<button aria-label="${label}"></button>`);
    expect(() => extractGrok(doc)).toThrow('仍在生成');
  });
  it('title 中的停止控件也阻止读取，隐藏控件不阻止', () => {
    const doc = makeDoc(); doc.body.insertAdjacentHTML('beforeend', '<button title="Stop"></button>');
    expect(() => extractGrok(doc)).toThrow('仍在生成');
    doc.querySelector('[title="Stop"]')!.setAttribute('hidden', '');
    expect(extractGrok(doc).blocks.length).toBe(5);
  });
  it.each(['aria-busy', 'data-is-streaming'])('%s 状态阻止读取', attr => {
    const doc = makeDoc(); doc.querySelector('#response-a1 .message-bubble')!.setAttribute(attr, 'true');
    expect(() => extractGrok(doc)).toThrow('等待');
  });
  it.each(['missing', 'disabled', 'aria-disabled', 'hidden'])('操作栏 %s 时等待，不借用上一条或用户的操作栏', condition => {
    const doc = makeDoc(user('old-u') + reply('old-a') + user() + reply());
    const actions = doc.querySelector('#response-a1 .action-buttons')!;
    if (condition === 'missing') actions.remove();
    else if (condition === 'hidden') actions.setAttribute('hidden', '');
    else actions.querySelectorAll('button').forEach(el => el.setAttribute(condition, 'true'));
    expect(() => extractGrok(doc)).toThrow('等待');
  });
  it('正文内的代码复制按钮不能作为回答完成依据', () => {
    const doc = makeDoc(); doc.querySelector('#response-a1 .action-buttons')!.remove();
    doc.querySelector('#response-a1 pre')!.classList.add('action-buttons');
    expect(() => extractGrok(doc)).toThrow('等待');
  });
  it('只有思考区时不把思考当作回答', () => {
    const doc = makeDoc(); doc.querySelectorAll('#response-a1 .response-content-markdown').forEach(el => { if (!el.closest('.thinking-container')) el.remove(); });
    expect(() => extractGrok(doc)).toThrow('正文');
  });
  it('缺少消息容器时不读整页或任意 markdown', () => {
    expect(() => extractGrok(makeDoc('<div class="response-content-markdown">任意文字</div>'))).toThrow('没有找到');
  });
  it('完成的稳定回答通过两次检查', async () => {
    const doc = makeDoc(); let elapsed = 0;
    const result = await captureAI(doc, async ms => { elapsed = ms; });
    expect(elapsed).toBe(1200);
    expect(result.targetId).toBe('grok:response-a1');
    expect(result.sourceHash).toBeTruthy();
  });
  it.each(['content', 'identity', 'navigation', 'new-question', 'streaming'])('稳定期内 %s 变化时不审阅', async change => {
    const doc = makeDoc();
    await expect(captureAI(doc, async () => {
      if (change === 'content') doc.querySelector('#response-a1 pre')!.append('更新');
      if (change === 'identity') doc.querySelector('#response-a1')!.id = 'response-a2';
      if (change === 'navigation') doc.defaultView!.history.pushState({}, '', '/c/other');
      if (change === 'new-question') doc.querySelector('main')!.insertAdjacentHTML('beforeend', user('u2'));
      if (change === 'streaming') doc.querySelector('#response-a1')!.setAttribute('aria-busy', 'true');
    })).rejects.toThrow();
  });
});

it('仅 grok.com 的 HTTPS 页面进入 Grok 自动模式并正确显示来源', () => {
  expect(aiSite('https://grok.com/c/test')).toBe('grok');
  expect(AI_MATCHES).toContain('https://grok.com/*');
  expect(siteLabel('grok_dom')).toBe('Grok');
  expect(isAutoSource('grok_dom')).toBe(true);
  for (const url of ['http://grok.com/', 'https://grok.com.evil.test/', 'https://x.com/i/grok', 'https://www.grok.com/']) expect(aiSite(url)).toBeNull();
});
