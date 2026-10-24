import { describe, it, expect, vi } from 'vitest';
import { demoInput, demoReview } from '../fixtures/demo';
import { makeManual } from '../lib/snapshot';
import { DEFAULT_MODEL, httpError, parseCompletion, requestBody, reviewWithDeepSeek } from '../lib/deepseek';
const input = () => makeManual(demoInput.question, '', demoInput.answer, false);
const response = () => ({ object: 'chat.completion', model: 'deepseek-flash', choices: [{ index: 0, finish_reason: 'stop' as string | null, message: { role: 'assistant', content: JSON.stringify(demoReview) as string | null, reasoning_content: 'private reasoning must not be parsed' } }], usage: { prompt_tokens: 130, completion_tokens: 40, total_tokens: 170 } });
describe('DeepSeek Chat Completions', () => {
  it('读取完整assistant正文并转换用量，不混入reasoning_content', async () => {
    const r = parseCompletion(response(), await input());
    expect(r.review.brief).toEqual(demoReview.brief); expect(r.review.integrity).toBe('complete');
    expect(r.usage).toEqual({ inputTokens: 130, outputTokens: 40, totalTokens: 170 });
    expect(DEFAULT_MODEL).toBe('deepseek-flash');
  });
  it.each(['length', 'content_filter', 'tool_calls', 'insufficient_system_resource', 'no-choices', 'empty', 'null', 'bad-json', 'bad-schema', 'stream-chunk', 'wrong-role', 'missing-finish'])('拒绝 %s', async kind => {
    const r = response(), c = r.choices[0]!;
    if (['length', 'content_filter', 'tool_calls', 'insufficient_system_resource'].includes(kind)) c.finish_reason = kind;
    if (kind === 'no-choices') r.choices = [];
    if (kind === 'empty') c.message.content = '  ';
    if (kind === 'null') c.message.content = null;
    if (kind === 'bad-json') c.message.content = '{';
    if (kind === 'bad-schema') c.message.content = '{}';
    if (kind === 'stream-chunk') r.object = 'chat.completion.chunk';
    if (kind === 'wrong-role') c.message.role = 'user';
    if (kind === 'missing-finish') c.finish_reason = null;
    const s = await input(); expect(() => parseCompletion(r, s)).toThrow();
  });
  it('即使finish_reason=stop，也拒绝工具调用与拒绝消息', async () => {
    const s = await input(), r = response();
    Object.assign(r.choices[0]!.message, { tool_calls: [{ name: 'unexpected' }] });
    expect(() => parseCompletion(r, s)).toThrow('未完成');
    Object.assign(r.choices[0]!.message, { tool_calls: [], refusal: 'private refusal' });
    expect(() => parseCompletion(r, s)).toThrow('未完成');
  });
  it('固定DeepSeek端点、Bearer密钥、JSON及非思考模式，不发送定位元数据', async () => {
    const s = await input(); s.pageUrl = 'https://chatgpt.com/c/private'; s.tabId = 900;
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response()), { status: 200 }));
    await reviewWithDeepSeek(s, 'synthetic-test-key', DEFAULT_MODEL, new AbortController().signal, 90000, f);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, options] = f.mock.calls[0]!; const body = JSON.parse(options!.body as string);
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(options!.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-test-key' });
    expect(body.response_format).toEqual({ type: 'json_object' }); expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.temperature).toBe(0.1); expect(body).not.toHaveProperty('reasoning_effort');
    expect(body.max_tokens).toBe(8192); expect(body.stream).toBe(false);
    expect(body.messages[0].content).toContain('JSON Schema'); expect(body.messages[0].content).toContain('exactQuote');
    const data = JSON.parse(body.messages[1].content);
    expect(Object.keys(data).sort()).toEqual(['output_budget', 'scope', 'supplemental_context', 'target_response', 'user_prompt']);
    expect(body.messages[1].content).not.toContain('private'); expect(body.messages[1].content).not.toContain('synthetic-test-key');
    for (const field of ['tools', 'store', 'background', 'generation_config', 'system_instruction']) expect(requestBody(s, DEFAULT_MODEL)).not.toHaveProperty(field);
  });
  it.each([400, 401, 402, 403, 404, 422, 429, 500, 503])('HTTP %s 不回显敏感错误正文、不自动重试或回退演示', async status => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'sensitive input' } }), { status }));
    await expect(reviewWithDeepSeek(await input(), 'test', DEFAULT_MODEL, new AbortController().signal, 100, f)).rejects.toThrow(httpError(status));
    expect(f).toHaveBeenCalledTimes(1); expect(httpError(status)).not.toContain('sensitive');
    if (status === 402) expect(httpError(status)).toContain('余额不足');
  });
  it('取消与超时保留不同失败状态', async () => {
    const f: typeof fetch = (_url, opts) => new Promise((_resolve, reject) => {
      if (opts?.signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
      opts?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const s = await input(), c = new AbortController();
    const cancelled = reviewWithDeepSeek(s, 'test', DEFAULT_MODEL, c.signal, 1000, f); c.abort();
    await expect(cancelled).rejects.toThrow('取消本地');
    await expect(reviewWithDeepSeek(s, 'test', DEFAULT_MODEL, new AbortController().signal, 5, f)).rejects.toThrow('停止本地等待');
  });
  it('已取消的任务不会发起网络请求', async () => {
    const s = await input(), c = new AbortController(), f = vi.fn<typeof fetch>(); c.abort();
    await expect(reviewWithDeepSeek(s, 'test', DEFAULT_MODEL, c.signal, 100, f)).rejects.toThrow('取消本地');
    expect(f).not.toHaveBeenCalled();
  });
});

