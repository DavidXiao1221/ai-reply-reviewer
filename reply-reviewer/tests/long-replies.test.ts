import { JSDOM } from 'jsdom';
import { describe, it, expect } from 'vitest';
import { extractChatGPT } from '../adapters/chatgpt';
import { assertInput, makeManual, manualBlocks } from '../lib/snapshot';
import { requestBody, parseCompletion } from '../lib/deepseek';
import { panelMessageSchema } from '../lib/messages';
import type { ReviewSnapshot } from '../lib/types';

const lines = (count: number) => Array.from({ length: count }, (_, i) => `第${i + 1}段：条件需要保留。`);
async function extendedSnapshot() {
  const s = await makeManual('检查全部条件', '', '原文', false);
  s.blocks = manualBlocks(lines(1005).join('\n'));
  s.blocks[1004]!.citations = [{ label: '尾段来源', url: 'https://example.com/end' }];
  return s;
}
function completion(s: ReviewSnapshot) {
  const last = s.blocks.at(-1)!;
  return { object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
    schemaVersion: '3.0', brief: { conclusion: { text: '各段列出待保留的条件。', evidence: [{blockId:last.id, exactQuote:last.text}] }, points: [] },
    assessment: [{kind:'caveat',text:'尾段仅提及条件，未展开适用范围。',evidence:[{blockId:last.id,exactQuote:last.text}],followUp:null}],
  }) } }] };
}
describe('长回复不受排版段落数量限制', () => {
  it('不足两千字的180个语义块完整保留，末段引用和定位不丢失', () => {
    const parts = Array.from({ length: 30 }, (_, i) => `<h2>章节${i + 1}</h2><p>说明${i + 1}</p><ul><li>条件A</li><li>条件B</li></ul><pre>代码${i + 1}</pre><table><tr><td>值${i + 1}</td></tr></table>`).join('');
    const d = new JSDOM(`<main><section data-talvt-turn-state="complete"><div data-user-message-bubble="true">检查全文</div><div data-markdown-text-style="assistant-message">${parts}<p id="tail">最后条件<a href="https://example.com/end">尾段来源</a></p></div></section></main>`, { url: 'https://chatgpt.com/c/long' }).window.document;
    const result = extractChatGPT(d);
    expect(result.blocks).toHaveLength(181);
    expect(result.blocks.map(b => b.text).join('\n\n').length).toBeLessThan(2000);
    expect(result.blocks[0]!.text).toBe('章节1');
    expect(result.blocks.at(-1)).toEqual({ id: 'b181', kind: 'paragraph', text: '最后条件尾段来源', citations: [{ label: '尾段来源', url: 'https://example.com/end' }] });
    expect(result.elements.get('b181')).toBe(d.getElementById('tail'));
    expect(result.blocks.filter(b => b.text === '条件A')).toHaveLength(30);
  });
  it('备用输入超过999段也完整保留，而不是换一个段落上限', async () => {
    const text = lines(1500);
    const s = await makeManual('检查全文', '', text.join('\n'), false);
    expect(s.blocks).toHaveLength(1500);
    expect(s.blocks.map(b => b.text)).toEqual(text);
    expect(s.blocks.at(-1)!.id).toBe('b1500');
  });
  it('长回复只构建一个请求，完整携带1005段和最后引用', async () => {
    const s = await extendedSnapshot(), body = requestBody(s, 'deepseek-flash');
    const input = JSON.parse(body.messages[1]!.content);
    expect(input.target_response.map((b: any) => b.text)).toEqual(s.blocks.map(b=>b.text));
    expect(input.target_response.at(-1).id).toBe('b1005');
    expect(input.target_response.at(-1).links[0].url).toBe('https://example.com/end');
  });
  it('四位段落编号通过简写与短评的原文校验', async () => {
    const s = await extendedSnapshot();
    const parsed = parseCompletion(completion(s), s).review;
    expect(parsed.brief.conclusion.evidence[0]!.blockId).toBe('b1005');
    expect(parsed.assessment[0]!.evidence[0]!.blockId).toBe('b1005');
  });
  it('四位编号的定位消息有效，仍拒绝畸形编号', () => {
    const m = { type: 'LOCATE_BLOCK', requestId: crypto.randomUUID(), snapshotId: crypto.randomUUID(), blockId: 'b1005' };
    expect(panelMessageSchema.safeParse(m).success).toBe(true);
    for (const blockId of ['b12', '1005', 'b10xx', 'b1005<script>']) expect(panelMessageSchema.safeParse({ ...m, blockId }).success).toBe(false);
  });
  it('仍拒绝不存在的长编号，不把宽松编号格式当作锚点有效', async () => {
    const s = await extendedSnapshot(), response = completion(s);
    const raw = JSON.parse(response.choices[0]!.message.content); raw.assessment[0].evidence[0].blockId = 'b1006';
    response.choices[0]!.message.content = JSON.stringify(raw);
    expect(parseCompletion(response,s).review.integrity).toBe('partial'); expect(parseCompletion(response,s).review.assessment).toHaveLength(0);
  });
  it('按字符总量控制输入，含问题、补充上下文和段落分隔符', () => {
    expect(() => assertInput('问', '补', manualBlocks('字'.repeat(29998)))).not.toThrow();
    expect(() => assertInput('问', '补', manualBlocks('字'.repeat(29999)))).toThrow('30,000');
    expect(() => assertInput('问', '补', manualBlocks('字'.repeat(14998) + '\n' + '字'.repeat(14998)))).not.toThrow();
    expect(() => assertInput('问', '补', manualBlocks('字'.repeat(14999) + '\n' + '字'.repeat(14998)))).toThrow('30,000');
  });
});
