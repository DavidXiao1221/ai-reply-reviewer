import { describe, it, expect, vi } from 'vitest';
import { AutoReview, type AutoState } from '../lib/autoReview';
import { CaptureError } from '../lib/messages';
import { ReviewFormatError } from '../lib/parseReview';
import { makeManual } from '../lib/snapshot';
import type { ReviewSnapshot } from '../lib/types';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function setup() {
  const s = { ...await makeManual('测试', '', '回答A', false), source: 'chatgpt_dom' as const, tabId: 1, documentSessionId: 'docA' };
  const states: AutoState<string>[] = [];
  const scan = vi.fn(async () => s);
  const review = vi.fn(async (_s: ReviewSnapshot, _signal: AbortSignal) => '审阅A');
  const verify = vi.fn(async () => {});
  const loop = new AutoReview({ scan, review, verify, identify: async s => `${s.tabId}:${s.documentSessionId}:${s.sourceHash}`, changed: s => states.push(s) });
  return { s, states, scan, review, verify, loop };
}
describe('自动审阅协调器', () => {
  it('启用后自动审阅，持续扫描同一回答只提交一次', async () => {
    const t = await setup(); await t.loop.tick(); expect(t.scan).not.toHaveBeenCalled();
    t.loop.resume(); await t.loop.tick(); await flush(); await t.loop.tick(); await t.loop.tick();
    expect(t.review).toHaveBeenCalledTimes(1); expect(t.states.at(-1)?.result).toBe('审阅A');
  });
  it('生成中不提交，完成后自动开始', async () => {
    const t = await setup(); t.scan.mockRejectedValueOnce(new CaptureError('GENERATING', '等待生成完成'));
    t.loop.resume(); await t.loop.tick(); expect(t.states.at(-1)?.status).toBe('waiting'); expect(t.review).not.toHaveBeenCalled();
    await t.loop.tick(); await flush(); expect(t.review).toHaveBeenCalledTimes(1);
  });
  it('重叠的定时扫描不会创建两个请求', async () => {
    const t = await setup(), pending = deferred<typeof t.s>(); t.scan.mockReturnValueOnce(pending.promise);
    t.loop.resume(); const first = t.loop.tick(); await t.loop.tick(); expect(t.scan).toHaveBeenCalledTimes(1);
    pending.resolve(t.s); await first; await flush(); expect(t.review).toHaveBeenCalledTimes(1);
  });
  it('模型请求期间持续扫描，新回答取消旧等待，迟到结果不能覆盖', async () => {
    const t = await setup(), pending = deferred<string>(); t.review.mockReturnValueOnce(pending.promise);
    t.loop.resume(); await t.loop.tick(); const oldSignal = t.review.mock.calls[0]![1];
    t.scan.mockResolvedValue({ ...t.s, sourceHash: 'B' }); t.review.mockResolvedValue('审阅B');
    await t.loop.tick(); await flush(); expect(oldSignal.aborted).toBe(true);
    pending.resolve('旧审阅'); await flush(); expect(t.states.at(-1)?.result).toBe('审阅B');
  });
  it('下一条正在生成时清除旧等待，不审阅旧回答', async () => {
    const t = await setup(), pending = deferred<string>(); t.review.mockReturnValueOnce(pending.promise);
    t.loop.resume(); await t.loop.tick(); t.scan.mockRejectedValueOnce(new CaptureError('GENERATING', '等待'));
    await t.loop.tick(); pending.resolve('旧结果'); await flush();
    expect(t.states.at(-1)?.status).toBe('waiting'); expect(t.states.at(-1)?.result).toBeUndefined();
  });
  it('错误不会被轮询重试，只有明确重试才再次提交', async () => {
    const t = await setup(); t.review.mockRejectedValue(new Error('配额用尽'));
    t.loop.resume(); await t.loop.tick(); await flush(); await t.loop.tick(); await t.loop.tick();
    expect(t.review).toHaveBeenCalledTimes(1); expect(t.states.at(-1)?.message).toContain('本条不会自动重试');
    t.loop.retry(); await t.loop.tick(); await flush(); expect(t.review).toHaveBeenCalledTimes(2);
  });
  it('格式诊断随失败缓存保留，成功重试后清除且不自行补发请求', async () => {
    const t = await setup();
    const error = new ReviewFormatError([{ path: ['brief', 'points'], code: 'invalid_type' }]);
    t.review.mockRejectedValueOnce(error);
    t.loop.resume(); await t.loop.tick(); await flush();
    expect(t.states.at(-1)?.diagnostic).toEqual(error.diagnostic);
    t.loop.pause(); t.loop.resume(); await t.loop.tick(); await flush();
    expect(t.review).toHaveBeenCalledTimes(1);
    expect(t.states.at(-1)?.diagnostic).toEqual(error.diagnostic);
    t.loop.retry(); await t.loop.tick(); await flush();
    expect(t.review).toHaveBeenCalledTimes(2);
    expect(t.states.at(-1)?.status).toBe('done');
    expect(t.states.at(-1)?.diagnostic).toBeUndefined();
  });
  it('暂停后不扫描、不接受迟到结果；恢复能处理当前回答', async () => {
    const t = await setup(), pending = deferred<string>(); t.review.mockReturnValueOnce(pending.promise);
    t.loop.resume(); await t.loop.tick(); t.loop.pause(); await t.loop.tick(); pending.resolve('迟到'); await flush();
    expect(t.scan).toHaveBeenCalledTimes(1); expect(t.states.some(s => s.status === 'done')).toBe(false);
    t.loop.resume(); await t.loop.tick(); await flush(); expect(t.states.at(-1)?.status).toBe('done');
  });
  it('暂停恢复和切回已完成内容使用当前会话缓存', async () => {
    const t = await setup(); t.loop.resume(); await t.loop.tick(); await flush(); t.loop.pause(); t.loop.resume();
    await t.loop.tick(); expect(t.review).toHaveBeenCalledTimes(1);
    t.loop.invalidate(); t.scan.mockResolvedValue({ ...t.s, tabId: 2 }); await t.loop.tick(); await flush();
    t.scan.mockResolvedValue(t.s); await t.loop.tick(); expect(t.review).toHaveBeenCalledTimes(2); expect(t.states.at(-1)?.snapshot?.tabId).toBe(1);
  });
  it('扫描尚未完成就切换标签页时，旧扫描不触发模型', async () => {
    const t = await setup(), pending = deferred<typeof t.s>(); t.scan.mockReturnValueOnce(pending.promise);
    t.loop.resume(); const first = t.loop.tick(); t.loop.invalidate(); pending.resolve(t.s); await first;
    expect(t.review).not.toHaveBeenCalled();
  });
  it('模型完成后必须再次验证原文，验证失败不显示结果', async () => {
    const t = await setup(); t.verify.mockRejectedValue(new CaptureError('STALE_SNAPSHOT', '原文变化'));
    t.loop.resume(); await t.loop.tick(); await flush(); expect(t.states.at(-1)?.status).toBe('waiting');
    expect(t.states.some(s => s.status === 'done')).toBe(false);
  });
});
