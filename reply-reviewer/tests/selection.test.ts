import { expect, it } from 'vitest';
import { makeSelection, SelectionInbox } from '../lib/selection';
import { requestBody } from '../lib/deepseek';

const input = (text = '所选第一段。\n\n所选第二段。', windowId = 1) => ({ text, pageUrl: 'https://example.com/article', tabId: 7, windowId });
it('按窗口投递，取出即消费，重复通知不重复调用', () => {
  const inbox = new SelectionInbox();
  const a = inbox.put(input()); const b = inbox.put(input('另一个窗口', 2));
  expect(inbox.take(3)).toBeNull(); expect(inbox.take(1)).toEqual(a); expect(inbox.take(1)).toBeNull();
  expect(inbox.take(2)).toEqual(b);
});
it('同一窗口只保留最后一次选择，过期或关闭窗口会丢弃', () => {
  let now = 0; const inbox = new SelectionInbox(() => now);
  inbox.put(input('旧选区')); inbox.put(input('新选区'));
  expect(inbox.take(1)!.text).toBe('新选区');
  inbox.put(input()); now = 120001; expect(inbox.take(1)).toBeNull();
  inbox.put(input()); inbox.clear(1); expect(inbox.take(1)).toBeNull();
});
it('选区保留来源、全部正文和选区范围，不携带整页、标题或猜测问题', async () => {
  const request = new SelectionInbox().put(input()); const s = await makeSelection(request);
  expect(s.source).toBe('selection'); expect(s.question).toBe(''); expect(s.tabId).toBe(7);
  expect(s.pageUrl).toBe('https://example.com/article');
  expect(s.blocks.map(b => b.text)).toEqual(['所选第一段。', '所选第二段。']);
  const body = requestBody(s, 'test'); const payload = JSON.parse(body.messages[1]!.content);
  expect(payload.scope.selectedExcerptOnly).toBe(true); expect(payload.user_prompt).toEqual([]);
  expect(payload).not.toHaveProperty('pageUrl'); expect(body.messages[0]!.content).toContain('不推断全文结论');
});
it('超限明确失败，不静默截断、不创建可调用模型的快照', async () => {
  const request = new SelectionInbox().put(input('字'.repeat(30001)));
  expect(request.text).toBe(''); await expect(makeSelection(request)).rejects.toThrow('30,000');
  const max = new SelectionInbox().put(input('字'.repeat(30000)));
  expect((await makeSelection(max)).blocks[0]!.text).toHaveLength(30000);
});
it('空选区明确失败，来源链接只接受网页协议', async () => {
  await expect(makeSelection(new SelectionInbox().put(input('  ')))).rejects.toThrow('没有取得');
  const s = await makeSelection(new SelectionInbox().put({ ...input(), pageUrl: 'javascript:alert(1)' }));
  expect(s.pageUrl).toBeNull();
});
