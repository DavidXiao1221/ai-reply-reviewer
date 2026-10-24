import { describe, it, expect } from 'vitest';
import { assertInput, fingerprint, makeManual, manualBlocks, normalize, safeUrl, sourceHash } from '../lib/snapshot';
describe('快照与范围', () => {
  it('保留代码、大小写、数字与标点', () => {
    const blocks = manualBlocks('第一段\n\n```js\nlet N = 12;\nN++;\n```\n末段');
    expect(blocks.map(b => b.text)).toEqual(['第一段', '```js\nlet N = 12;\nN++;\n```', '末段']);
    expect(normalize('A\r\n\u00a0 1！')).toBe('A 1！');
  });
  it('总字符超长或空回复拒绝，不截断', () => {
    expect(() => assertInput('', '', manualBlocks('a'.repeat(30001)))).toThrow('30,000');
    expect(() => assertInput('', '', [])).toThrow('AI 回复');
  });
  it('输入、模型、范围、来源变化均使绑定失效', async () => {
    const s = await makeManual('要求', '', '答案', false); const f = await fingerprint(s, 'm1');
    expect(await fingerprint({ ...s, additionalContext: '预算' }, 'm1')).not.toBe(f);
    expect(await fingerprint({ ...s, scope: { ...s.scope, userReportsMissingContext: true } }, 'm1')).not.toBe(f);
    expect(await fingerprint(s, 'm2')).not.toBe(f);
    expect(await sourceHash('https://chatgpt.com/c/1', '要求', s.blocks)).not.toBe(s.sourceHash);
  });
  it('拒绝非http来源', () => { expect(safeUrl('javascript:alert(1)')).toBe(null); expect(safeUrl('data:text/plain,x')).toBe(null); expect(safeUrl('https://example.com/a')).toBe('https://example.com/a'); });
});
