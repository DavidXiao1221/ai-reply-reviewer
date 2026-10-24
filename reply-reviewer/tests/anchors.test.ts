import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { quoteRange, OriginalHighlights } from '../lib/anchors';
const doc = (html: string) => new JSDOM(html).window.document;
describe('原句定位与隔离高亮', () => {
  it('跨内联节点与 NBSP 的空白映射保留原始文本偏移', () => {
    const d=doc('<p>成本 <strong>177.90</strong>&nbsp;− <em>159.95</em> = 17.95。</p>'), p=d.querySelector('p')!;
    expect(quoteRange(p,'成本 177.90 − 159.95 = 17.95。','177.90 − 159.95')?.toString().replace(/\u00a0/g,' ')).toBe('177.90 − 159.95');
    expect(quoteRange(p,p.textContent!,'177.90 − 159.95 = 17.96')).toBeNull();
  });
  it('重复原句、错误数字和大小写不做模糊定位', () => {
    const d=doc('<p>A=1。A=1。</p>'),p=d.querySelector('p')!;
    for(const q of ['A=1','a=1','A=2']) expect(quoteRange(p,p.textContent!,q)).toBeNull();
  });
  it('段落与表格边界能映射，隐藏工具不进入范围', () => {
    const d=doc('<table><tr><th>项目</th><th>金额</th></tr><tr><td>A</td><td>100</td></tr></table><p>文本<button>复制</button><span hidden>秘密</span>末尾</p>');
    expect(quoteRange(d.querySelector('table')!,'项目\t金额\nA\t100','A\t100')?.toString()).toBe('A100');
    expect(quoteRange(d.querySelector('p')!,'文本末尾','文本')?.toString()).toBe('文本');
  });
  it('浏览器不支持 Highlight 时描边降级，关闭恢复原样且不改正文', () => {
    const d=doc('<p style="outline: 1px dotted blue">原文</p>'),p=d.querySelector('p')!,h=new OriginalHighlights(d);
    const text=p.innerHTML; h.show([{element:p,range:quoteRange(p,'原文','原文')}],p);
    expect(p.style.outline).toContain('3px'); expect(p.innerHTML).toBe(text); h.clear(); expect(p.style.outline).toBe('1px dotted blue');
  });
  it('只删除自有高亮，正文编辑时自动清理', async () => {
    const d=doc('<p>原文</p>'),p=d.querySelector('p')!,registry=new Map<string,unknown>([['page-owned',{}]]);
    Object.defineProperty(d.defaultView,'CSS',{value:{highlights:registry}}); Object.defineProperty(d.defaultView,'Highlight',{value:class{constructor(..._ranges:Range[]) {}}});
    const h=new OriginalHighlights(d); expect(h.show([{element:p,range:quoteRange(p,'原文','原文')}],p)).toBe('quote');
    expect(registry.size).toBe(2); p.firstChild!.textContent='改变'; await Promise.resolve(); expect(registry.size).toBe(1); expect(registry.has('page-owned')).toBe(true); expect(d.querySelector('style')).toBeNull();
  });
  it('短暂定位到期清除', () => { vi.useFakeTimers(); const d=doc('<p>原文</p>'),p=d.querySelector('p')!,h=new OriginalHighlights(d);h.show([{element:p,range:null}],p,true);vi.advanceTimersByTime(2300);expect(p.style.outline).toBe('');vi.useRealTimers(); });
});
