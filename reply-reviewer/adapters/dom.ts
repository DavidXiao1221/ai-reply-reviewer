import type { ReviewBlock } from '../lib/types';
import { safeUrl } from '../lib/snapshot';
import { CaptureError } from '../lib/messages';

const SKIP = 'button,nav,aside,script,style,textarea,input,select,[hidden],[aria-hidden="true"],.cdk-visually-hidden,.sr-only,[data-testid*="thinking"],[data-testid*="reasoning"],[data-message-author-role="tool"],model-thoughts,model-thoughts-panel,[data-workflow-text-footer],.thinking-container,.action-buttons,.inline-media-container,.auto-notification';
const ATOMIC = 'p,h1,h2,h3,h4,h5,h6,pre,table,blockquote';
export function excluded(el: Element): boolean {
  if (el.closest(SKIP)) return true;
  return !visible(el);
}
export function visible(el: Element): boolean {
  if (el.closest('[hidden],[aria-hidden="true"]')) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const style = n.ownerDocument.defaultView?.getComputedStyle(n);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return true;
}
export function cleanText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  // 用原节点的计算样式排除隐藏后代，克隆节点离开文档后无法可靠判断可见性。
  const originals = Array.from(el.querySelectorAll('*'));
  const copies = Array.from(clone.querySelectorAll('*'));
  originals.forEach((node, i) => { if (excluded(node)) copies[i]?.remove(); });
  clone.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
  if (el.tagName !== 'PRE') clone.querySelectorAll('p,div,li').forEach(n => n.append('\n'));
  if (el.tagName === 'TABLE') return [clone.querySelector('caption')?.textContent?.trim(), ...Array.from(clone.querySelectorAll('tr')).map(tr => Array.from(tr.children).filter(c => c.matches('th,td')).map(c => c.textContent?.trim() || '').join('\t'))].filter(Boolean).join('\n');
  return (clone.textContent || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
}

export function extractBlocks(root: Element, { preferMarkdown = true } = {}) {
  const doc = root.ownerDocument;
  const blocks: ReviewBlock[] = []; const elements = new Map<string, Element>(); const warnings: string[] = [];
  const add = (element: Element, text: string, citationRoot?: Element) => {
    if (!text.trim()) return;
    const id = `b${String(blocks.length + 1).padStart(3, '0')}`;
    const citations: ReviewBlock['citations'] = []; const seen = new Set<string>();
    if (citationRoot) for (const a of citationRoot.querySelectorAll('a[href],[data-url],[data-href]')) {
      if (excluded(a)) continue;
      const url = safeUrl(a.getAttribute('href') || a.getAttribute('data-url') || a.getAttribute('data-href') || '', doc.location?.href);
      if (url && !seen.has(url)) { seen.add(url); citations.push({ url, label: cleanText(a) || new URL(url).hostname }); }
    }
    const kind: ReviewBlock['kind'] = element.matches('pre') ? 'code' : element.matches('table') ? 'table' : element.matches('blockquote') ? 'quote' : element.matches('h1,h2,h3,h4,h5,h6') ? 'heading' : element.closest('li') ? 'list' : 'paragraph';
    if (kind === 'table' && (element.querySelector('[colspan]:not([colspan="1"]),[rowspan]:not([rowspan="1"])') || !element.querySelector('th'))) warnings.push(`${id} 表格存在合并单元格或缺少表头，保留原始行序；列对应关系需人工确认。`);
    blocks.push({ id, kind, text: text.trim(), citations }); elements.set(id, element);
  };
  const walk = (el: Element) => {
    if (excluded(el)) return;
    if (el.matches(ATOMIC)) { add(el, cleanText(el), el); return; }
    // 没有语义子块时将整段保留；有时正文直接放在 div 中。
    if (!el.querySelector(`${ATOMIC},li,div,section,article,ul,ol`)) { add(el, cleanText(el), el); return; }
    let inline = ''; let inlineLinks: Element[] = [];
    const flush = () => {
      if (inline.trim()) {
        const temp = doc.createElement('div'); inlineLinks.forEach(n => temp.append(n.cloneNode(true)));
        add(el, inline, temp);
      }
      inline = ''; inlineLinks = [];
    };
    for (const child of el.childNodes) {
      if (child.nodeType === 3) inline += child.textContent || '';
      else if (child.nodeType === 1) {
        const c = child as Element; if (excluded(c)) continue;
        if (c.matches(`${ATOMIC},li,div,section,article,ul,ol`)) { flush(); walk(c); }
        else { inline += c.tagName === 'BR' ? '\n' : cleanText(c); inlineLinks.push(c); }
      }
    }
    flush();
  };
  const markdown = Array.from(root.querySelectorAll('.markdown')).filter(n => !n.parentElement?.closest('.markdown') && !excluded(n));
  if (preferMarkdown && markdown.length) markdown.forEach(walk); else walk(root);
  if (!blocks.length) throw new CaptureError('UNSUPPORTED_LAYOUT', '当前回答结构无法读取，请使用手动粘贴。');
  return { blocks, elements, warnings };
}
