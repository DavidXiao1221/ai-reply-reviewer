import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { makeManual } from '../lib/snapshot';
import { validateWebGuide, webGuideBody, webGuideText, webGuideWithDeepSeek } from '../lib/webGuide';
import WebGuideResult from '../components/WebGuideResult';

const snapshot = async () => ({ ...await makeManual('', '', '作者首先区分可控的行动与不可控的结果，再解释如何在日常生活中练习。\n单个事例只是解释方法，不足以证明对每个人都有效。', false),
  source: 'webpage_dom' as const, pageUrl: 'https://example.com/article?private-token=hidden', page: { title: '如何阅读与练习', site: 'example.com', readingMinutes: 2, kind: 'article' as const } });
const result = () => ({ schemaVersion: 'web-guide-1', overview: { text: '文章介绍区分行动与结果的练习，并用事例说明。', evidence: [] },
  sections: [{ title: '先理解基本区分', text: '这一部分交代练习的核心。', evidence: [{ blockId: 'b001', exactQuote: '区分可控的行动与不可控的结果' }] }],
  cautions: [{ text: '事例不能直接代表普遍效果。', evidence: [{ blockId: 'b002', exactQuote: '单个事例只是解释方法' }] }] });
it('网页使用独立提示词和输出协议，不发送页面私有 URL、标签页或虚构提问', async () => {
  const s = await snapshot(), body = webGuideBody(s, 'saved-model'), text = JSON.stringify(body);
  expect(body.model).toBe('saved-model'); expect(body.stream).toBe(false);
  expect(text).toContain('阅读路标'); expect(text).toContain('web-guide-1');
  expect(text).not.toContain('private-token'); expect(text).not.toContain('user_prompt');
  expect(JSON.parse(body.messages[1]!.content).article).toEqual(s.blocks);
});
it('引用验证后保留真实跳转', async () => {
  const guide = validateWebGuide(result(), await snapshot()); expect(guide.partial).toBe(false); expect(guide.sections[0]!.evidence).toHaveLength(1);
});
it('无效地图引用不提供跳转；没有有效证据的评价直接移除', async () => {
  const raw = result(); raw.sections[0]!.evidence[0]!.blockId = 'b999'; raw.cautions[0]!.evidence[0]!.exactQuote = '编造的证据';
  const guide = validateWebGuide(raw, await snapshot()); expect(guide.partial).toBe(true); expect(guide.sections[0]!.evidence).toEqual([]); expect(guide.cautions).toEqual([]);
});
it('拒绝空主旨和缺失阅读地图', async () => {
  const raw = result(); raw.overview.text = ' '; expect(() => validateWebGuide(raw, {} as any)).toThrow('格式');
  expect(() => validateWebGuide({ ...result(), sections: [] }, {} as any)).toThrow('格式');
});
it('网页展示文章信息与阅读地图，不复用 AI 回复布局，文本按纯文字处理', async () => {
  const s = await snapshot(), raw = result(); raw.sections[0]!.title = '<script>alert(1)</script>';
  const guide = validateWebGuide(raw, s);
  const html = renderToStaticMarkup(createElement(WebGuideResult, { guide, snapshot: s, stale: false, onLocate: () => {} }));
  expect(html).toContain('阅读地图'); expect(html).toContain('example.com'); expect(html).toContain('约 2 分钟');
  expect(html).toContain('阅读原文：'); expect(html).not.toContain('class="conclusion"'); expect(html).not.toContain('下一步'); expect(html).not.toContain('<script>');
  const text = webGuideText(guide, s); expect(text).toContain('如何阅读与练习'); expect(text).toContain(raw.cautions[0]!.text);
});
it('无实质评价时整个提醒区域隐藏', async () => {
  const s = await snapshot(), guide = validateWebGuide({ ...result(), cautions: [] }, s);
  const html = renderToStaticMarkup(createElement(WebGuideResult, { guide, snapshot: s, stale: false, onLocate: () => {} }));
  expect(html).not.toContain('带着这些提醒读');
});
it('一次模型请求返回导读并保持既有网络错误处理', async () => {
  const s = await snapshot();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(result()) } }] })));
  const response = await webGuideWithDeepSeek(s, 'synthetic', 'saved-model', new AbortController().signal, 1000, fetcher);
  expect(response.guide.sections).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockClear().mockResolvedValue(new Response('private-provider-body', { status: 503 }));
  await expect(webGuideWithDeepSeek(s, 'synthetic', 'saved-model', new AbortController().signal, 1000, fetcher)).rejects.toThrow('服务暂时不可用');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
