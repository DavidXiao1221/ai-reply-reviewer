import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it, expect } from 'vitest';
import { captureStable, extractChatGPT } from '../adapters/chatgpt';
import { sourceHash } from '../lib/snapshot';
const html = readFileSync(new URL('../fixtures/chatgpt-basic.html', import.meta.url), 'utf8');
const doc = () => new JSDOM(html, { url: 'https://chatgpt.com/c/sample' }).window.document;
describe('ChatGPT适配器', () => {
  it('相同文字的不同回答绑定不同消息；同一消息重渲染仍稳定', async () => {
    const d=new JSDOM('<div data-message-author-role="user">重复问题</div><div data-message-author-role="assistant" data-message-id="a1"><p>相同回答</p></div>',{url:'https://chatgpt.com/c/same'}).window.document;
    const a=extractChatGPT(d),again=extractChatGPT(d);expect(again.targetId).toBe(a.targetId);
    d.querySelector('[data-message-id]')!.outerHTML='<div data-message-author-role="assistant" data-message-id="a1"><p>相同回答</p></div>';expect(extractChatGPT(d).targetId).toBe(a.targetId);
    d.querySelector('[data-message-id]')!.setAttribute('data-message-id','a2');const b=extractChatGPT(d);expect(b.targetId).not.toBe(a.targetId);expect(await sourceHash(d.location.href,a.question,a.blocks,a.warnings,a.targetId)).not.toBe(await sourceHash(d.location.href,b.question,b.blocks,b.warnings,b.targetId));
  });
  it('无平台消息ID时同节点稳定，新回答节点生成不同标识',()=>{const d=doc(),a=extractChatGPT(d);expect(extractChatGPT(d).targetId).toBe(a.targetId);a.root.replaceWith(a.root.cloneNode(true));expect(extractChatGPT(d).targetId).not.toBe(a.targetId);});
  it('新版实页属性：当前轮次的问答和引用，不混入附件卡片', () => {
    const html = readFileSync(new URL('../fixtures/chatgpt-modern.html', import.meta.url), 'utf8');
    const d = new JSDOM(html, { url: 'https://chatgpt.com/c/sample' }).window.document;
    const r = extractChatGPT(d);
    expect(r.question).toBe('请比较成本。\n保留适用条件。');
    expect(r.blocks.map(b => b.text)).toEqual(['成本100元。示例报告', '只有订单满足条件才执行。', 'example()']);
    expect(r.blocks[0]!.citations).toHaveLength(1);
    d.querySelectorAll('[data-talvt-turn-state]')[1]!.setAttribute('data-talvt-turn-state', 'streaming');
    expect(() => extractChatGPT(d)).toThrow('尚未完成');
  });
  it('配对正确问答，排除草稿按钮思考，列表不重复，重复句子有独立ID', () => {
    const r = extractChatGPT(doc()); expect(r.question).toBe('请比较成本和条件。');
    expect(r.blocks.map(b => b.text)).toEqual(['比较', '成本约100元。报告', '同一句话。', '内层条件', '同一句话。', 'let cost = 100;\ncost += 20;', '方案\t成本\nA\t100', '结论']);
    expect(r.blocks[1]!.citations[0]!.url).toBe('https://example.com/report');
    expect(r.elements.get('b003')).not.toBe(r.elements.get('b005'));
  });
  it('找不到回答时不回退到document.body', () => {
    const d = doc(); d.querySelectorAll('[data-message-author-role="assistant"]').forEach(n => n.remove());
    expect(() => extractChatGPT(d)).toThrow('没有找到');
  });
  it('最新轮生成中不读取上一轮', () => {
    const d = doc(); const b = d.createElement('button'); b.dataset.testid = 'stop-button'; d.body.append(b);
    expect(() => extractChatGPT(d)).toThrow('仍在生成'); b.remove();
    const u = d.createElement('div'); u.setAttribute('data-message-author-role', 'user'); u.textContent = '新问题'; d.body.append(u);
    expect(() => extractChatGPT(d)).toThrow('没有完整回复');
  });
  it('稳定检查发现变化，正文变化更新hash', async () => {
    const d = doc(); const before = extractChatGPT(d);
    await expect(captureStable(d, async () => { d.querySelectorAll('.markdown')[1]!.append('新内容'); })).rejects.toThrow('变化');
    const after = extractChatGPT(d);
    expect(await sourceHash(d.location.href, before.question, before.blocks)).not.toBe(await sourceHash(d.location.href, after.question, after.blocks));
  });
  it('长问题不跳过', () => {
    const d = doc(); d.querySelectorAll('[data-message-author-role="user"]')[1]!.textContent = '要'.repeat(2200);
    expect(extractChatGPT(d).question.length).toBe(2200);
  });
  it('CSS隐藏的段内内容不进入回答', () => {
    const d = doc(); const style = d.createElement('style'); style.textContent = '.invisible-note { display:none }'; d.head.append(style);
    const hidden = d.createElement('span'); hidden.className = 'invisible-note'; hidden.textContent = '隐藏工具信息';
    d.querySelectorAll('.markdown')[1]!.querySelector('p')!.append(hidden);
    expect(extractChatGPT(d).blocks.map(b => b.text).join('')).not.toContain('隐藏工具信息');
  });
});
