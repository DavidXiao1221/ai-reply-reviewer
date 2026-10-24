import { z } from 'zod';
import { reviewJsonSchema } from './reviewSchema';
import { REVIEW_PROMPT } from './reviewPrompt';
import { validateReview } from './validateReview';
import { assertInput } from './snapshot';
import type { ReviewSnapshot } from './types';
import { buildContext } from './contextBuilder';
import { readingBudget } from './readingBudget';
import { parseModelJson } from './parseModelJson';

export const DEFAULT_MODEL = 'deepseek-flash';
export const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const completionSchema = z.object({
  object: z.literal('chat.completion'), model: z.string().optional(),
  choices: z.array(z.object({
    index: z.literal(0), finish_reason: z.string().nullable(),
    message: z.object({ role: z.literal('assistant'), content: z.string().nullable(),
      refusal: z.string().nullable().optional(), tool_calls: z.array(z.unknown()).optional() }),
  })).length(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional(), total_tokens: z.number().int().nonnegative().optional() }).optional(),
});
// Chat Completions JSON mode constrains JSON syntax; the schema and all anchors
// are independently checked locally. Do not send unsupported json_schema fields.
export const DEEPSEEK_SYSTEM_PROMPT = `${REVIEW_PROMPT}\n\n输出一个 JSON 对象，并满足以下 JSON Schema：\n${JSON.stringify(reviewJsonSchema)}\n\n输出前检查：每个字段只输出一次，直接写最终值，不先输出空模板再补写；数组须正确闭合后再写相邻字段。points是数组，只包含text非空的已完成要点；没有要点用[]。无下一步用null，无简评用[]。简写正文优先于定位字段；无法可靠引用时evidence用[]，不可填空正文或虚构引文。`;
export function requestBody(snapshot: ReviewSnapshot, model: string) {
  assertInput(snapshot.question, snapshot.additionalContext, snapshot.blocks);
  return {
    model,
    messages: [
      { role: 'system', content: DEEPSEEK_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ ...buildContext(snapshot), output_budget: readingBudget(snapshot) }) },
    ],
    stream: false, thinking: { type: 'disabled' }, max_tokens: 8192,
    temperature: 0.1, response_format: { type: 'json_object' },
  };
}
export function parseCompletionContent(data: unknown) {
  const parsed = completionSchema.safeParse(data);
  if (!parsed.success) throw new Error('DeepSeek 接口响应格式不正确，未获得审阅结果。');
  const r = parsed.data, choice = r.choices[0]!;
  if (choice.finish_reason === 'length') throw new Error('审阅输出被截断，请缩短材料后重试；不会展示不完整结果。');
  if (choice.finish_reason !== 'stop' || choice.message.refusal || choice.message.tool_calls?.length)
    throw new Error('模型未完成本次审阅或拒绝了请求，未获得可用结果。');
  const text = choice.message.content;
  if (!text?.trim()) throw new Error('DeepSeek 返回了空内容，请稍后重试。');
  if (text.length > 200000) throw new Error('模型输出异常过大，未展示本次结果；可以重试。');
  let json: ReturnType<typeof parseModelJson>;
  let clean = text.replace(/^\uFEFF/, '').trim();
  const fence = clean.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) clean = fence[1]!;
  try { json = parseModelJson(clean); } catch { throw new Error('模型返回了无效 JSON，请重试。'); }
  return { value: json.value, repairs: json.repairs, model: r.model,
    usage: r.usage ? { inputTokens: r.usage.prompt_tokens, outputTokens: r.usage.completion_tokens, totalTokens: r.usage.total_tokens } : undefined };
}
export function parseCompletion(data: unknown, snapshot: ReviewSnapshot) {
  const json = parseCompletionContent(data);
  const review = validateReview(json.value, snapshot);
  review.jsonRepairs = json.repairs;
  if (json.repairs) { review.integrity = 'partial'; review.formatRepairs += json.repairs; }
  return { review, model: json.model, usage: json.usage };
}
export function httpError(status: number): string {
  // Never display provider error bodies, which can echo private input or keys.
  if (status === 401) return 'DeepSeek 密钥无效或认证失败，请检查配置。';
  if (status === 402) return 'DeepSeek API 余额不足，请在开放平台检查余额并充值后重试。';
  if (status === 403) return 'DeepSeek 接口权限不足，请检查账户及模型权限。';
  if (status === 404) return '模型或接口不存在或不可用，请检查模型名。';
  if (status === 429) return '请求过多或达到配额限制，请稍后手动重试。';
  if (status === 400 || status === 422) return '请求参数不被接受，请检查模型名及其 JSON 输出支持。';
  if (status >= 500) return 'DeepSeek 服务暂时不可用，请稍后手动重试。';
  return `API 请求失败（HTTP ${status}），请检查配置后重试。`;
}
export async function reviewWithDeepSeek(snapshot: ReviewSnapshot, key: string, model: string, signal: AbortSignal, timeoutMs = 90000, fetcher: typeof fetch = fetch) {
  return requestCompletion(m => requestBody(snapshot, m), key, model, signal, data => parseCompletion(data, snapshot), timeoutMs, fetcher);
}
export async function requestCompletion<T>(makeBody: (model: string) => object, key: string, model: string, signal: AbortSignal, parse: (data: unknown) => T, timeoutMs = 90000, fetcher: typeof fetch = fetch) {
  if (!key.trim()) throw new Error('请先填写 DeepSeek API Key，或体验演示样例。');
  if (!model.trim() || model.length > 150) throw new Error('请填写有效的模型名。');
  const body = makeBody(model.trim());
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    if (controller.signal.aborted) throw new Error('aborted');
    const response = await fetcher(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` }, body: JSON.stringify(body), signal: controller.signal });
    if (controller.signal.aborted) throw new Error('aborted');
    if (!response.ok) throw new Error(httpError(response.status));
    let data: unknown; try { data = await response.json(); } catch { throw new Error('接口返回了无效 JSON，未获得审阅结果。'); }
    if (controller.signal.aborted) throw new Error('aborted');
    return parse(data);
  } catch (e) {
    if (timedOut) throw new Error('等待超过 90 秒，已停止本地等待；服务商仍可能处理或计费。');
    if (signal.aborted) throw new Error('已取消本地等待；服务商仍可能处理或计费。');
    if (e instanceof TypeError) throw new Error('网络请求失败，请检查网络连接及 DeepSeek 服务可达性。');
    throw e;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
