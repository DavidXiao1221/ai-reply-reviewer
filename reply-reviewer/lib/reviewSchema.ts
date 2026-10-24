import { z } from 'zod';

export const SCHEMA_VERSION = 'review-schema-3.5-partial-1';
export const evidenceSchema = z.strictObject({
  blockId: z.string().trim().min(1).max(80),
  exactQuote: z.string().trim().min(1).max(500),
});
const briefItem = z.strictObject({
  text: z.string().trim().min(1).max(240),
  evidence: z.array(evidenceSchema).min(1).max(6),
});
const fields = {
  brief: z.strictObject({
    conclusion: briefItem,
    points: z.array(briefItem).max(5),
  }),
  assessment: z.array(z.strictObject({
    kind: z.enum(['strength', 'caveat']),
    text: z.string().trim().min(1).max(180),
    evidence: z.array(evidenceSchema).min(1).max(4),
    // Omitting an optional follow-up must not discard an otherwise valid summary.
    followUp: z.string().trim().min(1).max(200).nullable().default(null),
  })).max(2),
};
// Read earlier local results and fixtures; request only the current contract.
const legacySchema = z.strictObject({ schemaVersion: z.literal('3.0'), ...fields });
const v32Schema = z.strictObject({
  schemaVersion: z.literal('3.2'),
  brief: fields.brief,
  assessment: z.array(z.strictObject({
    kind: z.literal('caveat'),
    basis: z.enum(['calculation', 'decision_rule', 'unsupported_number', 'contradiction', 'unmet_requirement']),
    text: z.string().trim().min(1).max(180),
    evidence: z.array(evidenceSchema).min(1).max(4),
    followUp: z.string().trim().min(1).max(200).nullable().default(null),
  })).max(2),
});
// Put source-based judgments before compression in the requested output, and
// constrain grouping structurally. Earlier stored results stay readable.
const v33Schema = z.strictObject({
  schemaVersion: z.literal('3.3'),
  assessment: v32Schema.shape.assessment.describe('先检查重要数字的可见来源，再检查计算阈值与另选规则的区别；确有新增判断才写。不能用空数组代替检查，也不能为填字段制造问题。'),
  brief: z.strictObject({
    conclusion: briefItem.describe('核心判断只写一次。非短原文通常20–40字；不要预写后面所有要点。'),
    points: z.array(z.strictObject({
      text: z.string().trim().min(1).max(240).describe('按同一决定合并原文多段：必要条件、禁止理由、例外、失败触发及回滚落点、材料范围与未验证状态不能省；用短语保留，不展开解释。冲突外推须含时间、对象、数量。'),
      evidence: z.array(evidenceSchema).min(1).max(6),
    })).max(3).describe('最多3组，不是一段原文对应一条。相邻实施阶段并为一组，范围限制并入相关组；不得因分组省掉独立条件。'),
  }),
});
const v34Schema = z.strictObject({
  schemaVersion: z.literal('3.4'),
  assessment: v32Schema.shape.assessment.describe('判断重要数字的可见来源、数学阈值与观察规则的不同依据；只写原文及简写之外的有用判断。'),
  brief: z.strictObject({
    conclusion: briefItem.describe('核心判断一短句。preserved_passages已由程序保留，不重复转述其中的句子。'),
    points: z.array(briefItem).describe('不限制固定组数。按决策合并其余信息，不能为减少条数删条件。preserved_passages会原样进入可复制简写，此处不重复写。'),
  }),
});
// Writing budgets are soft. These generous bounds reject malformed output;
// they never trim a sentence or remove a condition.
const lightweightBriefItem = z.strictObject({
  text: z.string().trim().min(1).max(240),
  evidence: z.array(evidenceSchema).max(6).default([]).describe('尽量附原文定位；无法提供可靠逐字引文时用[]，仍须完成text正文，不能编造引文。'),
});
const currentSchema = z.strictObject({
  schemaVersion: z.literal('3.5'),
  brief: z.strictObject({
    conclusion: lightweightBriefItem.describe('直接回答当前问题，通常1–2句、50字内；保留原文不确定性。'),
    points: z.array(lightweightBriefItem).max(3).describe('只放已写好的非空要点，通常2–3条；没有要点用[]，不要放空占位对象。'),
    nextStep: lightweightBriefItem.nullable().default(null).describe('只有当前问题需要决策或行动才提取一步；定义、原因、客观比较通常null。不能输出空对象。'),
  }),
  assessment: z.array(z.strictObject({
    kind: z.literal('caveat').default('caveat'),
    text: z.string().trim().min(1).max(180).describe('一句针对回答质量的具体增量简评，尽量60字内；无实质发现则整个assessment返回[]。'),
    evidence: z.array(evidenceSchema).min(1).max(4),
    followUp: z.null().default(null),
  })).max(1).default([]),
});
export const reviewSchema = z.union([currentSchema, v34Schema, v33Schema, v32Schema, legacySchema]);
export type LightweightReview = z.infer<typeof currentSchema>;
export type ModelReview = z.infer<typeof reviewSchema>;
export type EvidenceRef = z.infer<typeof evidenceSchema>;
export type Assessment = ModelReview['assessment'][number];
export const reviewJsonSchema = z.toJSONSchema(currentSchema, { target: 'draft-7' });

