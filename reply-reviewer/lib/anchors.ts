import { normalize } from './snapshot';
type Point = { node: Text; offset: number };
const SKIP = 'button,nav,aside,script,style,textarea,input,select,[hidden],[aria-hidden="true"]';
const BOUNDARY = 'p,div,li,h1,h2,h3,h4,h5,h6,pre,blockquote,table,tr,th,td,br';
/** Whitespace-only normalization, retaining a map to original UTF-16 text offsets. */
export function quoteRange(element: Element, blockText: string, exactQuote: string): Range | null {
  const doc = element.ownerDocument; let text = ''; const starts: Array<Point | null> = [], ends: Array<Point | null> = [];
  const append = (value: string, start: Point | null, end: Point | null) => {
    const char = /\s/.test(value) ? ' ' : value;
    if (char === ' ' && (!text || text.endsWith(' '))) { if (end && text.endsWith(' ')) ends[ends.length-1] = end; return; }
    text += char; starts.push(start); ends.push(end);
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const t = node as Text; for (let i=0;i<t.data.length;i++) append(t.data[i]!, { node:t,offset:i }, {node:t,offset:i+1});
    } else if (node.nodeType === 1) {
      const el = node as Element;
      const style = doc.defaultView?.getComputedStyle(el);
      if (el.matches(SKIP) || style?.display === 'none' || style?.visibility === 'hidden') return;
      if (el.matches(BOUNDARY)) append(' ',null,null);
      for (const child of el.childNodes) walk(child);
      if (el.matches(BOUNDARY)) append(' ',null,null);
    }
  };
  walk(element);
  const block = normalize(blockText), quote = normalize(exactQuote);
  if (!block || !quote) return null;
  const blockStart = text.indexOf(block);
  if (blockStart < 0 || text.indexOf(block, blockStart+1) >= 0) return null;
  const inBlock = block.indexOf(quote);
  if (inBlock < 0 || block.indexOf(quote,inBlock+1) >= 0) return null;
  let first = blockStart + inBlock, last = first + quote.length - 1;
  while (first <= last && !starts[first]) first++;
  while (last >= first && !ends[last]) last--;
  const start = starts[first], end = ends[last]; if (!start || !end) return null;
  const range = doc.createRange(); range.setStart(start.node,start.offset); range.setEnd(end.node,end.offset); return range;
}

type HighlightApi = { highlights: Map<string, unknown> };
type HighlightWindow = Window & { CSS?: HighlightApi; Highlight?: new (...ranges: Range[]) => unknown };
export class OriginalHighlights {
  private outlines = new Map<HTMLElement, { outline: string; offset: string }>();
  private style: HTMLStyleElement | null = null;
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private doc: Document, private name = 'reply-review-v2-evidence') {}
  clear() {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.observer?.disconnect(); this.observer = null;
    (this.doc.defaultView as HighlightWindow | null)?.CSS?.highlights?.delete(this.name);
    this.style?.remove(); this.style = null;
    for (const [el, old] of this.outlines) if (el.style.outline === '3px solid rgb(71, 120, 102)' || el.style.outline === '3px solid #477866') { el.style.outline = old.outline; el.style.outlineOffset = old.offset; }
    this.outlines.clear();
  }
  show(targets: Array<{ element: Element; range: Range | null }>, root: Element, temporary = false) {
    this.clear();
    const view = this.doc.defaultView as HighlightWindow | null;
    const ranges = targets.flatMap(t => t.range ? [t.range] : []);
    let precise = false;
    if (view?.CSS?.highlights && view.Highlight && ranges.length) {
      try {
        view.CSS.highlights.set(this.name, new view.Highlight(...ranges));
        this.style = this.doc.createElement('style'); this.style.textContent = `::highlight(${this.name}) { background-color: #ffe1a6; color: inherit; text-decoration: underline #9a5e13; }`;
        (this.doc.head || this.doc.documentElement).append(this.style); precise = true;
      } catch { view.CSS.highlights.delete(this.name); this.style?.remove(); this.style = null; }
    }
    for (const t of targets) if (!precise || !t.range) {
      const el = t.element as HTMLElement;
      if (!this.outlines.has(el)) { this.outlines.set(el, { outline: el.style.outline, offset: el.style.outlineOffset }); el.style.outline = '3px solid #477866'; el.style.outlineOffset = '5px'; }
    }
    if (view) { this.observer = new (view as Window & typeof globalThis).MutationObserver(() => this.clear()); this.observer.observe(root, { subtree: true, childList: true, characterData: true }); }
    if (temporary) this.timer = setTimeout(() => this.clear(), 2200);
    return precise && targets.every(t => t.range) ? 'quote' : 'block';
  }
}
