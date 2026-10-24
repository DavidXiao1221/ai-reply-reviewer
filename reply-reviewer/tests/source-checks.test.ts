import { expect, it } from 'vitest';
import { makeManual } from '../lib/snapshot';
import { sourceChecks } from '../lib/sourceChecks';
import { requestBody } from '../lib/deepseek';

it.each([
  ['最多五次总尝试，间隔依次1秒、2秒、4秒和8秒。', 5, [1, 2, 4, 8], true],
  ['最多三次总尝试，间隔依次1秒和2秒并加随机延迟。', 3, [1, 2], true],
  ['共4次总尝试，间隔分别为0.5秒和2秒。', 4, [.5, 2], false],
  ['最多两次重试，间隔依次1秒和2秒。', null, [], null],
  ['最多十三次总尝试，间隔依次1秒和2秒。', null, [], null],
  ['最多3次总尝试。下一组间隔依次1秒和2秒。', null, [], null],
])('只核算同一句的明确总次数和等待列表：%s', async (answer, total, delays, matches) => {
  const s = await makeManual('', '', answer, false), checks = sourceChecks(s);
  if (total === null) expect(checks).toEqual([]);
  else expect(checks).toEqual([{kind:'retry_count', evidence:{blockId:'b001',exactQuote:answer}, totalAttempts:total, retries:total-1,delaySeconds:delays,intervalCountMatches:matches}]);
});

it('轻量请求不携带旧实验核算面板或评测预期', async () => {
  const s = await makeManual('', '', '最多4次总尝试，间隔依次1秒、3秒和9秒。', false);
  const input = JSON.parse(requestBody(s, 'test').messages[1]!.content);
  expect(input).not.toHaveProperty('source_checks');
  expect(input.target_response[0].text).toBe(s.blocks[0]!.text);
  expect(input).not.toHaveProperty('mustKeep');
});
it('只证明独立纯数字等式，不给商业叙述或错误等式背书', async () => {
  expect(sourceChecks(await makeManual('', '', '0.1+0.2=0.3。', false))).toEqual([expect.objectContaining({kind:'exact_equality',equalityHolds:true})]);
  for (const answer of ['0.1+0.2=0.4。', '收入：0.1+0.2=0.3。'])
    expect(sourceChecks(await makeManual('', '', answer, false))).toEqual([]);
});
