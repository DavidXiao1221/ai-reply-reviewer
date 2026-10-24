import { describe, expect, it, vi } from 'vitest';
import { lightweightCases } from '../fixtures/lightweight';
import { makeManual } from '../lib/snapshot';
import { parseCompletion, reviewWithDeepSeek } from '../lib/deepseek';
import { reviewSchema } from '../lib/reviewSchema';
import { reviewDiagnostic } from '../lib/parseReview';
import { briefText, reviewText } from '../components/ReviewResult';

const sample = lightweightCases[0]!;
const input = () => makeManual(sample.question, '', sample.answer, false);
const model = (): any => structuredClone(sample.expected);
const envelope = (value: unknown) => ({object:'chat.completion',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});

describe('3.3.1: shape differences must not discard a complete anchored brief', () => {
  it.each([null, '', ' ', [], {}, {text:'',evidence:[]}, {text:null,evidence:null}])('empty optional nextStep %j means absent', async empty => {
    const raw=model();raw.brief.nextStep=empty;
    const result=parseCompletion(envelope(raw),await input()).review;
    expect(result.brief).toEqual({...sample.expected.brief,nextStep:null});
    expect(result.assessment).toEqual(sample.expected.assessment);
  });
  it.each(['points','evidence','assessment','numeric-version','missing-version','extra-metadata'])('lossless compatibility for %s', async variant => {
    const raw=model();
    if(variant==='points')raw.brief.points=raw.brief.points[0];
    if(variant==='evidence')raw.brief.conclusion.evidence=raw.brief.conclusion.evidence[0];
    if(variant==='assessment')raw.assessment=raw.assessment[0];
    if(variant==='numeric-version')raw.schemaVersion=3.5;
    if(variant==='missing-version')delete raw.schemaVersion;
    if(variant==='extra-metadata'){raw.note='unused';raw.brief.conclusion.label='unused';}
    const r=parseCompletion(envelope(raw),await input()).review;
    expect(r.brief.conclusion.text).toBe(sample.expected.brief.conclusion.text);
    expect(r.brief.points).toEqual(variant==='points'?[sample.expected.brief.points[0]]:sample.expected.brief.points);
    expect(r.assessment).toEqual(sample.expected.assessment);
    expect(reviewText(r)).not.toContain('unused');
  });
  it.each(['missing-text','wrong-type','missing-evidence','wrong-kind'])('invalid independent assessment %s leaves complete brief', async variant => {
    const raw=model();
    if(variant==='missing-text')delete raw.assessment[0].text;
    if(variant==='wrong-type')raw.assessment='malformed comment';
    if(variant==='missing-evidence')raw.assessment[0].evidence=[];
    if(variant==='wrong-kind')raw.assessment[0].kind='strength';
    const r=parseCompletion(envelope(raw),await input()).review;
    expect(r.brief).toEqual(sample.expected.brief);expect(r.assessment).toEqual([]);
    expect(r.omittedAssessments).toBe(1);expect(r.integrity).toBe('partial');
  });
  it('extra independent comments do not invalidate the brief or exceed the one-comment UI',async()=>{
    const raw=model();raw.assessment.push({...raw.assessment[0],text:'另一条独立评价。'});
    const r=parseCompletion(envelope(raw),await input()).review;
    expect(r.brief).toEqual(sample.expected.brief);expect(r.assessment).toEqual(sample.expected.assessment);expect(r.omittedAssessments).toBe(1);
  });
  it('legacy followUp metadata cannot invalidate an otherwise usable current comment',async()=>{
    const raw=model();raw.assessment[0].followUp='unused follow-up';
    const r=parseCompletion(envelope(raw),await input()).review;
    expect(r.brief).toEqual(sample.expected.brief);expect(r.assessment).toEqual(sample.expected.assessment);
  });
  it.each([null, '无实质发现'])('no finding %j produces no empty card',async empty=>{
    const raw=model();raw.assessment=empty;
    const r=parseCompletion(envelope(raw),await input()).review;
    expect(r.assessment).toEqual([]);expect(r.omittedAssessments).toBe(0);
  });
  it('writing length limits are not receiving limits: retain all text and anchors',async()=>{
    const answer='只有全部条件成立才执行。'.repeat(80)+'否则延期，不得提前上线。';
    const s=await makeManual('何时上线？','',answer,false), text='条件说明。'.repeat(50)+'否则延期，不得提前上线。';
    const raw={schemaVersion:'3.5',brief:{conclusion:{text,evidence:[{blockId:'b001',exactQuote:answer}]},points:[],nextStep:null},assessment:[]};
    expect(reviewSchema.safeParse(raw).success).toBe(false);
    const r=parseCompletion(envelope(raw),s).review;
    expect(briefText(r)).toBe(text);expect(r.brief.conclusion.evidence[0]!.exactQuote).toBe(answer);
  });
  it.each(['partial-point','string-point','partial-next','extra-next','invented-quote','bad-version','four-points'])('3.3.2 partial recovery keeps type and version boundaries: %s',async kind=>{
    const raw=model();
    if(kind==='partial-point')raw.brief.points={text:'',evidence:[]};
    if(kind==='string-point')raw.brief.points=['只剩一句，没有引用'];
    if(kind==='partial-next')raw.brief.nextStep={text:'必须保留的行动',evidence:[]};
    if(kind==='extra-next')raw.brief.nextStep={action:'必须保留的行动'};
    if(kind==='invented-quote')raw.brief.conclusion.evidence={blockId:'b001',exactQuote:'不在原文的内容'};
    if(kind==='bad-version')raw.schemaVersion='4.0';
    if(kind==='four-points')raw.brief.points.push(raw.brief.points[0],raw.brief.points[0]);
    const s=await input();
    if(['bad-version','four-points'].includes(kind))expect(()=>parseCompletion(envelope(raw),s)).toThrow();
    else {
      const r=parseCompletion(envelope(raw),s).review;
      expect(r.integrity).toBe('partial');
      expect(r.brief.conclusion.text).toBe(sample.expected.brief.conclusion.text);
      expect(reviewText(r)).toContain('Partial');
      expect(r.formatIssues.length).toBeGreaterThan(0);
      if(kind==='partial-next')expect('nextStep' in r.brief&&r.brief.nextStep?.text).toBe('必须保留的行动');
    }
  });
  it('failure diagnostics expose only whitelisted field paths and categories',async()=>{
    const raw=model();raw.brief.points=[{text:{private:'sensitive-credential'},evidence:[]}];raw['secret-field-name']='private';
    const r=parseCompletion(envelope(raw),await input()).review;
    expect(r.integrity).toBe('partial');
    expect(r.formatIssues).toContainEqual({field:'brief.points.0.text',rule:'invalid_type'});
    expect(JSON.stringify(r.formatIssues)).not.toMatch(/sensitive|credential|secret-field-name|private/);
  });
  it('compatibility uses the same single response, without another model request',async()=>{
    const raw=model();raw.brief.nextStep={text:'',evidence:[]};raw.assessment[0].evidence=[];
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(envelope(raw)),{status:200}));
    const result=await reviewWithDeepSeek(await input(),'synthetic-key','deepseek-flash',new AbortController().signal,90000,fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);expect(result.review.brief.points).toEqual(sample.expected.brief.points);
  });
});
