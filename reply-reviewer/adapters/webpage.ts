import { Readability } from '@mozilla/readability';
import { cleanText, excluded, extractBlocks, visible } from './dom';
import { CaptureError } from '../lib/messages';
import { assertInput, normalize, sourceHash } from '../lib/snapshot';
import type { ReviewSnapshot } from '../lib/types';
import { documentUrl, webUrl } from '../lib/webMode';

const OMIT = 'script,style,nav,aside,footer,form,input,textarea,select,button,dialog,[role="dialog"],[role="tooltip"],[role="navigation"],[role="textbox"],[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-nosnippet],.nocontent,.sr-only,.comments,#comments,.related-posts,.related-articles,[data-testid="sidebarColumn"]';
const noArticle = () => new CaptureError('NO_ARTICLE', '当前页面没有可识别的独立正文。打开文章、新闻或长文后，会自动生成导读。');
const textOf = (root: ParentNode, selector: string) => {
  const el = root.querySelector(selector); if (!el || !visible(el)) return '';
  const clone = el.cloneNode(true) as Element, originals = [...el.querySelectorAll('*')], copies = [...clone.querySelectorAll('*')];
  originals.forEach((node, i) => { if (node.matches(OMIT) || excluded(node)) copies[i]?.remove(); });
  return normalize(cleanText(clone));
};

export function extractWebPage(doc: Document) {
  if (!webUrl(doc.location.href)) throw noArticle();
  if ([...doc.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"]')].some(visible)) throw new CaptureError('NO_ARTICLE', '页面弹窗尚未关闭，回到正文后会自动生成导读。');
  if (doc.querySelectorAll('*').length > 25000) throw new CaptureError('UNSUPPORTED_LAYOUT', '这个页面结构过大，暂时无法自动提取正文。可以使用选区审阅。');
  let root: Element = doc.body, kind: 'article' | 'post' = 'article';
  const x = /^(www\.)?(x|twitter)\.com$/.test(doc.location.hostname);
  if (x) {
    // Public X article DOM markers; never combine a timeline or replies into one article.
    const article = [...doc.querySelectorAll('[data-testid="twitterArticleReadView"]')].find(visible);
    if (article) root = article.querySelector('[data-testid="twitterArticleRichTextView"],[data-testid="longformRichTextComponent"]') || article;
    else {
      const status = doc.location.pathname.match(/\/status\/(\d+)/)?.[1];
      if (!status) throw noArticle();
      const tweet = [...doc.querySelectorAll('article[data-testid="tweet"]')].find(el => visible(el) && [...el.querySelectorAll('a[href]')].some(a => a.querySelector('time') && new URL(a.getAttribute('href')!, doc.location.href).pathname.endsWith('/status/' + status)));
      root = tweet?.querySelector('[data-testid="tweetText"]') || doc.body;
      if (root === doc.body) throw noArticle();
      if (tweet?.querySelector('[data-testid="tweet-text-show-more-link"]')) throw new CaptureError('NO_ARTICLE', '这条长文尚未完整展开，展开正文后会自动生成导读。');
      kind = 'post';
    }
  } else {
    const articles = [...doc.querySelectorAll('article,[itemprop="articleBody"]')].filter(el => !excluded(el) && !el.parentElement?.closest('article,[itemprop="articleBody"]'));
    const candidates = articles.map(el => ({ el, length: cleanText(el).length })).filter(c => c.length >= 300).sort((a,b) => b.length - a.length);
    if (candidates.length > 1 && candidates[0]!.length < candidates[1]!.length * 2) throw noArticle();
    if (candidates[0]) root = candidates[0].el;
  }
  if (!visible(root) || root.closest('[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) throw noArticle();
  if (root.matches('[aria-busy="true"]') || root.querySelector('[aria-busy="true"]')) throw new CaptureError('GENERATING', '正文仍在加载，稳定后自动生成导读。');
  const clone = doc.implementation.createHTMLDocument(doc.title);
  const base = clone.createElement('base'); base.href = doc.location.href; clone.head.append(base);
  const copy = root.cloneNode(true) as Element;
  const originals = [root, ...root.querySelectorAll('*')], copies = [copy, ...copy.querySelectorAll('*')];
  const anchors = new Map<string, Element>();
  originals.forEach((el, i) => {
    const target = copies[i]!;
    if (el !== root && (el.matches(OMIT) || excluded(el))) { target.remove(); return; }
    // Attributes exist only on the detached copy. The live page is never rewritten.
    target.setAttribute('data-review-origin', String(i)); anchors.set(String(i), el);
  });
  clone.body.append(copy);
  const readable = new Readability<Element>(clone, { charThreshold: 300, maxElemsToParse: 25000, keepClasses: true, disableJSONLD: true, serializer: node => node as Element }).parse();
  if (!readable?.content) throw noArticle();
  const extracted = extractBlocks(readable.content, { preferMarkdown: false });
  const chars = extracted.blocks.reduce((n, b) => n + b.text.length, 0);
  if (chars < 300) throw noArticle();
  // Reject link directories / search listings rather than presenting them as an article.
  const linkChars = [...readable.content.querySelectorAll('a')].reduce((n, a) => n + cleanText(a).length, 0);
  if (linkChars > chars * 0.45) throw noArticle();
  const elements = new Map<string, Element>();
  for (const [id, el] of extracted.elements) {
    const origin = el.getAttribute('data-review-origin');
    const live = origin ? anchors.get(origin) : undefined;
    const text = extracted.blocks.find(b => b.id === id)!.text;
    if (live && normalize(cleanText(live)).includes(normalize(text))) elements.set(id, live);
  }
  const title = (x ? textOf(doc, '[data-testid="twitter-article-title"]') : textOf(root, 'h1')) || readable.title || doc.title || '当前网页';
  const author = textOf(root, '[rel="author"],[itemprop="author"]') || doc.querySelector('meta[name="author"]')?.getAttribute('content') || undefined;
  const published = root.querySelector('time[datetime]')?.getAttribute('datetime') || doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || undefined;
  const page: NonNullable<ReviewSnapshot['page']> = { title: normalize(title).slice(0,500), site: doc.location.hostname, author: author?.slice(0,160), published: published?.slice(0,80), readingMinutes: Math.max(1, Math.ceil(chars / 600)), kind };
  const warnings = [...extracted.warnings];
  if (elements.size !== extracted.blocks.length) warnings.push('部分段落只能在侧栏原文中定位。');
  assertInput('', '', extracted.blocks);
  return { ...extracted, elements, warnings, root, question: '', targetId: 'web:' + JSON.stringify(page), page };
}

export async function captureWebPage(doc: Document, pause = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  const url = documentUrl(doc.location.href), before = extractWebPage(doc);
  const beforeHash = await sourceHash(url, '', before.blocks, before.warnings, before.targetId);
  await pause(1800);
  const after = extractWebPage(doc), pageUrl = documentUrl(doc.location.href);
  const hash = await sourceHash(pageUrl, '', after.blocks, after.warnings, after.targetId);
  if (url !== pageUrl || beforeHash !== hash) throw new CaptureError('GENERATING', '正文仍在变化，稳定后自动生成导读。');
  return { ...after, sourceHash: hash, pageUrl };
}
