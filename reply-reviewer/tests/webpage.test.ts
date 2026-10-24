import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { captureWebPage, extractWebPage } from '../adapters/webpage';
import { documentUrl, webUrl } from '../lib/webMode';

const paragraph = '理解一个观点之前，需要先区分作者提出的主张和支持它的证据。一个例子能够说明某种可能性，却不能直接证明所有情况都如此。阅读时应保留前提，比较不同段落之间的联系，再决定是否接受作者的推论。';
const article = `<article><h1>如何理解一篇长文章</h1><p rel="author">作者甲</p><time datetime="2026-10-24">发布日期</time><h2>首先明确问题</h2><p>${paragraph.repeat(3)}<a href="/report">原始报告</a></p><h2>再比较论证</h2><p>${paragraph.repeat(3)}</p><pre>const count = 1;\ncount++;</pre><table><tr><th>类别</th><th>数量</th></tr><tr><td>A</td><td>2</td></tr></table><section class="comments"><p>评论干扰${paragraph.repeat(4)}</p></section><aside>${paragraph.repeat(3)}推荐干扰</aside><div hidden>隐藏秘密</div><form><p>表单秘密</p><input value="private" /></form><div contenteditable="true">编辑草稿秘密</div></article>`;
const makeDoc = (html = article, url = 'https://example.com/story') => new JSDOM(`<title>如何理解一篇长文章</title><nav>导航干扰</nav><main>${html}</main><footer>页脚干扰</footer>`, { url }).window.document;

describe('自动网页正文', () => {
  it('提取文章并映射真实段落，排除导航、评论、推荐、表单、隐藏和编辑内容', () => {
    const doc = makeDoc(), before = doc.body.innerHTML, result = extractWebPage(doc);
    expect(result.page.title).toBe('如何理解一篇长文章');
    expect(result.page.author).toBe('作者甲');
    expect(result.page.published).toBe('2026-10-24');
    expect(result.page.readingMinutes).toBeGreaterThan(0);
    expect(result.blocks.map(b => b.text).join('')).not.toMatch(/干扰|秘密|private/);
    const body = result.blocks.find(b => b.text.includes('原始报告'))!;
    expect(body.citations).toContainEqual({ label: '原始报告', url: 'https://example.com/report' });
    expect(result.elements.get(body.id)).toBe(doc.querySelector('h2+p'));
    expect(result.blocks.find(b => b.kind === 'code')?.text).toBe('const count = 1;\ncount++;');
    expect(result.blocks.find(b => b.kind === 'table')?.text).toContain('类别\t数量');
    expect(doc.body.innerHTML).toBe(before);
  });
  it('正文没有 article 标签时仍可识别', () => {
    const doc = makeDoc(`<div class="post-content"><h1>正文标题</h1><p>${paragraph.repeat(4)}</p><p>${paragraph.repeat(3)}</p></div>`);
    expect(extractWebPage(doc).blocks.map(b => b.text).join('')).toContain(paragraph);
  });
  it('标题中的收藏工具栏与网页界面提示不会进入文章', () => {
    const doc = makeDoc(); doc.querySelector('h1')!.insertAdjacentHTML('beforeend','<devsite-actions data-nosnippet><span>收藏提示</span><span>根据您的偏好保存内容</span></devsite-actions>');
    doc.querySelector('article')!.insertAdjacentHTML('beforeend','<div data-nosnippet>工具栏内容</div>');
    const result = extractWebPage(doc); expect(result.page.title).toBe('如何理解一篇长文章');
    expect(result.blocks.map(b=>b.text).join('')).not.toMatch(/收藏提示|工具栏内容/);
  });
  it('页面被模态弹窗遮挡时等待，不自动处理后面的正文', () => {
    const doc = makeDoc(); doc.body.insertAdjacentHTML('beforeend','<dialog open>登录后继续</dialog>');
    expect(()=>extractWebPage(doc)).toThrow('弹窗');
  });
  it('列表页不将多篇独立文章合并', () => expect(() => extractWebPage(makeDoc(article + article))).toThrow('独立正文'));
  it('链接目录和短页面不自动提交', () => {
    expect(() => extractWebPage(makeDoc('<p>欢迎使用</p>'))).toThrow();
    expect(() => extractWebPage(makeDoc(`<article><p>${Array.from({length:20},()=>`<a href="/link">${paragraph}</a>`).join('')}</p></article>`))).toThrow('独立正文');
  });
  it('只有编辑器内容时不读取', () => expect(() => extractWebPage(makeDoc(`<div contenteditable="true"><p>${paragraph.repeat(10)}</p></div>`))).toThrow());
  it('超过输入上限不会静默截断', () => expect(() => extractWebPage(makeDoc(`<article><p>${paragraph.repeat(400)}</p></article>`))).toThrow('30,000'));
  it('X 文章只提取阅读区正文，不包含其他推文', () => {
    const doc = makeDoc(`<div data-testid="twitterArticleReadView"><h1 data-testid="twitter-article-title">X 长文章</h1><div data-testid="twitterArticleRichTextView"><div><p>${paragraph.repeat(5)}</p></div></div></div><article data-testid="tweet"><p>旁边的评论${paragraph.repeat(4)}</p></article>`, 'https://x.com/author/status/1234');
    const result = extractWebPage(doc);
    expect(result.page.title).toBe('X 长文章');
    expect(result.blocks.map(b => b.text).join('')).not.toContain('旁边的评论');
  });
  it('X 普通长帖按详情 URL 对应原帖，不混入回复', () => {
    const tweet=(id:string,text:string)=>`<article data-testid="tweet"><a href="/author/status/${id}"><time>日期</time></a><div data-testid="tweetText"><p>${text}</p></div></article>`;
    const doc = makeDoc(tweet('12',paragraph.repeat(5)) + tweet('13','回复干扰'+paragraph.repeat(5)), 'https://x.com/author/status/12');
    const result = extractWebPage(doc); expect(result.page.kind).toBe('post'); expect(result.blocks.map(b=>b.text).join('')).not.toContain('回复干扰');
    doc.querySelector('[data-testid="tweet"]')!.insertAdjacentHTML('beforeend','<button data-testid="tweet-text-show-more-link">Show more</button>');
    expect(()=>extractWebPage(doc)).toThrow('展开正文');
  });
  it('X 信息流不自动选择一条帖子', () => expect(() => extractWebPage(makeDoc(article,'https://x.com/home'))).toThrow('独立正文'));
  it('稳定检查拒绝正文变动和路由变化，但页内锚点不重复采集', async () => {
    const doc = makeDoc();
    await expect(captureWebPage(doc,async()=>{doc.querySelector('h2+p')!.append('新正文');})).rejects.toThrow('变化');
    await expect(captureWebPage(doc,async()=>{doc.defaultView!.history.pushState({},'','/other');})).rejects.toThrow('变化');
    const before = await captureWebPage(doc,async()=>{});
    const after = await captureWebPage(doc,async()=>{doc.defaultView!.history.replaceState({},'','#section');});
    expect(before.sourceHash).toBe(after.sourceHash);
  });
  it('标题变化也使旧结果失效', async () => {
    const doc = makeDoc(); await expect(captureWebPage(doc,async()=>{doc.querySelector('h1')!.textContent='另一篇文章';})).rejects.toThrow('变化');
  });
  it('只识别 http/https 页面', () => {
    expect(webUrl('https://example.com/')).toBe(true);
    for (const url of ['chrome://settings','file:///private.txt','about:blank','javascript:alert(1)']) expect(webUrl(url)).toBe(false);
    expect(documentUrl('https://example.com/article?edition=2#part')).toBe('https://example.com/article?edition=2');
  });
});
