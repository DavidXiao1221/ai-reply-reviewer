import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeManual } from '../lib/snapshot';
import { scanEquations } from '../lib/arithmetic';
// Development seeds only. This is deterministic validation, not model evaluation.
const seeds=readFileSync(new URL('../fixtures/review_eval_seeds.jsonl',import.meta.url),'utf8').trim().split('\n').slice(0,16).map(line=>JSON.parse(line));
describe('开发样例的确定性数值部分（不代表语义模型评测）',()=>{
  it.each([['R04','passed'],['R05','failed'],['R06','none'],['R12','passed'],['R16','failed']])('%s 原文数值检查 %s',async(id,status)=>{
    const c=seeds.find(c=>c.id===id),s=await makeManual(c.input.user_prompt,c.input.supplemental_context,c.input.target_response,false),checks=scanEquations(s.blocks);
    if(status==='none')expect(checks).toHaveLength(0);else{expect(checks).toHaveLength(1);expect(checks[0]!.result).toBe(status);if(id==='R05')expect(checks[0]!.left).toBe('17.95');}
  });
});
