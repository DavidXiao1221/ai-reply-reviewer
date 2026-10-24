import { expect, it, vi } from 'vitest';
import { demoInput, demoReview } from '../fixtures/demo';
import { makeManual } from '../lib/snapshot';
import { reviewInTwoStages, TWO_STAGE_MODEL } from '../lib/twoStageReview';

const snapshot=()=>makeManual(demoInput.question,'',demoInput.answer,false);
const completion=()=>new Response(JSON.stringify({object:'chat.completion',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(demoReview)}}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}}));

it('实验模式恰好两次请求：第二次同时看到原文、草稿和实际字数，无评测答案或密钥', async()=>{
  const s=await snapshot(), f=vi.fn<typeof fetch>().mockImplementation(async()=>completion());
  const result=await reviewInTwoStages(s,'synthetic-test-key',TWO_STAGE_MODEL,new AbortController().signal,90000,f);
  expect(f).toHaveBeenCalledTimes(2);
  const bodies=f.mock.calls.map(([,options])=>JSON.parse(options!.body as string));
  expect(bodies.every(b=>b.model===TWO_STAGE_MODEL)).toBe(true);
  const input=JSON.parse(bodies[1].messages[1].content);
  expect(input.target_response.map((b:any)=>b.text).join('\n\n')).toBe(demoInput.answer);
  expect(input.draft).toBeDefined(); expect(input.draft_visible_chars.total).toBeGreaterThan(0);
  expect(input).not.toHaveProperty('mustKeep'); expect(JSON.stringify(bodies)).not.toContain('synthetic-test-key');
  expect(result.usage).toEqual({inputTokens:200,outputTokens:60,totalTokens:260});
});

it('第一阶段失败不进入第二阶段，也不自动重试',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('{}',{status:429}));
  await expect(reviewInTwoStages(await snapshot(),'synthetic-test-key',TWO_STAGE_MODEL,new AbortController().signal,90000,f)).rejects.toThrow('请求过多');
  expect(f).toHaveBeenCalledTimes(1);
});

it('第二阶段失败不把未经校对的草稿冒充终稿，不发第三次请求',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValueOnce(completion()).mockResolvedValueOnce(new Response('{}',{status:500}));
  await expect(reviewInTwoStages(await snapshot(),'synthetic-test-key',TWO_STAGE_MODEL,new AbortController().signal,90000,f)).rejects.toThrow('暂时不可用');
  expect(f).toHaveBeenCalledTimes(2);
});

it('已取消时没有任何请求',async()=>{
  const c=new AbortController(); c.abort(); const f=vi.fn<typeof fetch>();
  await expect(reviewInTwoStages(await snapshot(),'synthetic-test-key',TWO_STAGE_MODEL,c.signal,90000,f)).rejects.toThrow('取消');
  expect(f).not.toHaveBeenCalled();
});

