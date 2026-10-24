import { describe, expect, it } from 'vitest';
import { checkEquation, scanEquations } from '../lib/arithmetic';

const block = (text: string, kind?: string) => ({ id: 'b001', text, kind });
const candidate = (exactQuote: string, assertionRole: 'asserted_by_response' | 'quoted_or_hypothetical' | 'unclear' = 'asserted_by_response') => ({
  id: 'model001', evidence: { blockId: 'b001', exactQuote }, assertionRole, roleExplanation: '模型提供的角色解释',
});

describe('bounded exact arithmetic', () => {
  it.each([
    ['177.90 - 159.95 = 17.95', '17.95', '17.95'],
    ['0.1 + 0.2 = 0.3', '0.3', '0.3'],
    ['25% × 200 = 50', '50', '50'],
    ['-(2 + 3) × -2 = 10', '10', '10'],
    ['8 ÷ 4 − 3 = -1', '-1', '-1'],
    ['.5 * 2 = +1', '1', '1'],
    ['1 / 3 = 2 / 6', '1/3', '1/3'],
  ])('evaluates %s exactly', (expression, left, right) => {
    expect(checkEquation(expression)).toMatchObject({ result: 'passed', left, right });
  });

  it('gives the actual subtraction when the displayed result is wrong', () => {
    expect(checkEquation('177.90-159.95=18.95')).toMatchObject({ result: 'failed', left: '17.95', right: '18.95' });
  });

  it('never silently gives equality a tolerance', () => {
    expect(checkEquation('1/3=0.33').result).toBe('failed');
    expect(checkEquation('0.1+0.2=0.300000000000000001').result).toBe('failed');
  });

  it.each([
    ['1/3≈0.33', 'passed'], ['2/3≈0.67', 'passed'], ['1/3≈0.34', 'failed'],
    ['-1.235≈-1.24', 'passed'], ['1/3≈33.3%', 'passed'],
  ])('uses RHS display precision and explicit rounding for %s', (expression, result) => {
    expect(checkEquation(expression).result).toBe(result);
    expect(checkEquation(expression).detail).toMatch(/四舍五入/);
  });

  it.each([
    '1/0=0', '0/0=0', 'sin(0)=0', 'Math.round(2.2)=2', 'x+1=2', '1e3+2=1002',
    '1+1=2=2', '10美元+10欧元=20美元', '$10+€10=$20', '2**3=8', '1/3≈1/3',
    'globalThis.pwned=1', '(()=>{throw Error("executed")})()=1', '1 2=12',
    '('.repeat(21) + '1' + ')'.repeat(21) + '=1',
    '1+'.repeat(50) + '1=51', '1'.repeat(37) + '=1', '1+'.repeat(151) + '1=152',
    '999999999999999999999999999999999999*999999999999999999999999999999999999*999999999999999999999999999999999999*999999999999999999999999999999999999=1',
  ])('abstains on unsupported or excessive input: %s', expression => {
    expect(checkEquation(expression)).toMatchObject({ result: 'unsupported', left: null, right: null });
  });

  it('accepts the documented parenthesis depth boundary', () => {
    expect(checkEquation('('.repeat(20) + '1' + ')'.repeat(20) + '=1').result).toBe('passed');
  });
});

describe('original-text equation scanning', () => {
  it('keeps the exact original expression and a numerical-only scope', () => {
    const result = scanEquations([block('计算结果：177.90 - 159.95 = 18.95。后续使用该差值。')]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ blockId: 'b001', exactQuote: '177.90 - 159.95 = 18.95', result: 'failed', left: '17.95', assertionRole: 'asserted_by_response' });
    expect(result[0]!.detail).toMatch(/业务|口径/);
  });

  it('retains non-breaking spaces inside a complete numeric expression', () => {
    expect(scanEquations([block('0.1\u00a0+0.2=0.3')])[0]).toMatchObject({ exactQuote: '0.1\u00a0+0.2=0.3', result: 'passed' });
  });

  it('does not invent formulas from a table', () => {
    expect(scanEquations([block('2026Q1 177.90 159.95 17.95\n没有表头、单位与指标定义。')], [candidate('177.90-159.95=17.95')])).toEqual([]);
  });

  it.each(['sin(0)=0', '2*sin(0)=0', '1e3+2=1002', 'x=2+2=4', '10美元+10欧元=20美元', '2+2=4美元', '$2+$2=$4', 'USD 10 + EUR 10 = 20', 'RMB 10 + GBP 10 = 20'])('does not certify an extracted fragment of %s', text => {
    const results = scanEquations([block(text)]);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(result => result.result === 'unsupported')).toBe(true);
  });

  it.each(['2^2+2=4', '2+2=4^2', '2|2=4', '2+2=4>3', '1,000+1=1,001', '4=1,000', '10元10+10=20', '√4=2', '₹4=4', '2+2=4°', 'sin 2+2=4'])('rejects unrecognized operators and separators without partial evaluation: %s', text => {
    const results = scanEquations([block(text)]);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(result => result.result === 'unsupported')).toBe(true);
  });

  it.each(['2+2=4 ^2', '2 ^ 2+2=4', '2+2=4\u00a0^2', '2+2=4 USD', '2026-10-22 - 2026-10-21 = 1 天', '日期差：2026-10-22 - 2026-10-21 = 1。'])('does not evaluate whitespace-separated suffixes or date-shaped operands: %s', text => {
    const results = scanEquations([block(text)]);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(result => result.result === 'unsupported')).toBe(true);
  });

  it.each([
    ['错误写法：2+2=5，应改成4。', undefined],
    ['“2+2=5”是一段引用。', undefined],
    ['> 2+2=5', undefined],
    ['如果2+2=5，那么会出现矛盾。', undefined],
    ['示例：2+2=5。', undefined],
    ["'2+2=5'", undefined],
    ['等式2+2=5不成立。', undefined],
    ['2+2=5 is false.', undefined],
    ['有人说2+2=5。', undefined],
    ['原回答写的是2+2=5。', undefined],
    ['错误示例如下：\n2+2=5', undefined],
    ['```js\n2+2=5\n```', undefined],
    ['`2+2=5`', undefined],
    ['2+2=5', 'code'],
    ['2+2=5', 'blockquote'],
  ])('does not promote quoted, hypothetical or code text: %s', (text, kind) => {
    const result = scanEquations([block(text, kind)], [candidate('2+2=5')]);
    expect(result).toHaveLength(1);
    expect(result[0]!.assertionRole).toBe('quoted_or_hypothetical');
  });

  it('abstains on questions even if the model calls them assertions', () => {
    expect(scanEquations([block('2+2=5 是否正确？')], [candidate('2+2=5')])[0]!.assertionRole).toBe('unclear');
  });

  it.each(["Let's calculate: 2 + 2 = 5.", "It's clear: 2+2=5.", 'Let’s calculate: 2+2=5.', "The students' result: 2+2=5."])("does not treat word apostrophes as quotations: %s", text => {
    const result = scanEquations([block(text)])[0];
    expect(result).toMatchObject({ result: 'failed', assertionRole: 'asserted_by_response' });
  });

  it.each(['“2+2=5”', '「2+2=5」', '『2+2=5』', '‘2+2=5’', '"2+2=5"', "'2+2=5'"])("recognizes a genuinely paired quotation: %s", text => {
    expect(scanEquations([block(text)])[0]?.assertionRole).toBe('quoted_or_hypothetical');
  });

  it.each(['“2+2=5', '"2+2=5', "'2+2=5", '“2+2=5"'])('abstains on unclosed or mismatched quotation boundaries: %s', text => {
    expect(scanEquations([block(text)], [candidate('2+2=5')])[0]?.assertionRole).toBe('unclear');
  });

  it('keeps quote types separate and closes their scope before later assertions', () => {
    const results = scanEquations([block('“She said \'hello\'”。2+2=5。')]);
    expect(results[0]?.assertionRole).toBe('asserted_by_response');
  });

  it.each(['错误示例如下：', '引用如下：', '假设以下等式成立：'])('inherits an immediately preceding explicit introduction block: %s', introduction => {
    const results = scanEquations([{ id: 'b000', text: introduction, kind: 'paragraph' }, block('2+2=5', 'paragraph')], [candidate('2+2=5')]);
    expect(results[0]?.assertionRole).toBe('quoted_or_hypothetical');
  });

  it('does not carry an introduction through a new normal paragraph', () => {
    const results = scanEquations([
      { id: 'b000', text: '错误示例如下：' },
      { id: 'b002', text: '例子到此结束。现在重新计算。' },
      block('2+2=5'),
    ]);
    expect(results[0]?.assertionRole).toBe('asserted_by_response');
  });

  it('limits an introduction to the adjacent block rather than all subsequent equations', () => {
    const results = scanEquations([
      { id: 'b000', text: '错误示例如下：' },
      block('2+2=5'),
      { id: 'b002', text: '计算结果：2+2=5。' },
    ]);
    expect(results.map(item => item.assertionRole)).toEqual(['quoted_or_hypothetical', 'asserted_by_response']);
  });

  it('uses a model candidate only when its whole equation is anchored exactly', () => {
    const results = scanEquations([block('2+2=4。')], [candidate('2=4'), candidate('7+2=9')]);
    expect(results).toHaveLength(1);
    expect(results[0]!.exactQuote).toBe('2+2=4');
    expect(results[0]!.id).not.toBe('model001');
  });

  it('keeps a valid candidate ID and honors conservative role classification', () => {
    const results = scanEquations([block('2+2=4。')], [candidate('2+2=4', 'unclear')]);
    expect(results[0]).toMatchObject({ id: 'model001', assertionRole: 'unclear' });
  });

  it('honors a conservative candidate that exactly anchors a complete sentence containing the whole equation', () => {
    const results = scanEquations([block('计算关系：2+2=5。')], [candidate('计算关系：2+2=5。', 'unclear')]);
    expect(results[0]).toMatchObject({ id: 'model001', exactQuote: '2+2=5', assertionRole: 'unclear' });
  });

  it('does not use a full-sentence asserted candidate to promote locally unclear or quoted text', () => {
    expect(scanEquations([block('错误示例如下：\n2+2=5')], [candidate('错误示例如下：\n2+2=5')])[0]?.assertionRole).toBe('quoted_or_hypothetical');
    expect(scanEquations([block('2+2=5 是否正确？')], [candidate('2+2=5 是否正确？')])[0]?.assertionRole).toBe('unclear');
  });

  it('assigns unique IDs when repeated equations reuse a model candidate ID', () => {
    const repeated = { ...candidate('2+2=4'), id: 'eq003' };
    const results = scanEquations([block('2+2=4。2+2=4。')], [repeated]);
    expect(results).toHaveLength(2);
    expect(new Set(results.map(item => item.id)).size).toBe(2);
  });

  it('supports equality rounding only when the original wording states the precision', () => {
    const rounded = scanEquations([block('保留两位小数：1/3=0.33。')])[0]!;
    expect(rounded.result).toBe('passed');
    expect(rounded.exactQuote).toBe('1/3=0.33');
    expect(rounded.detail).toMatch(/两位小数|2 位小数/);
    expect(scanEquations([block('1/3=0.33。')])[0]!.result).toBe('failed');
  });

  it('does not treat a negated precision instruction as permission to round', () => {
    expect(scanEquations([block('无需保留两位小数：1/3=0.33。')])[0]?.result).not.toBe('passed');
  });

  it('converts expressly stated percentage display precision to a numeric scale', () => {
    const result = scanEquations([block('保留两位小数：1/3=33.33%。')])[0]!;
    expect(result.result).toBe('passed');
    expect(result.detail).toContain('百分比换算');
  });

  it('does not apply another sentence’s rounding or example scope', () => {
    const results = scanEquations([block('示例保留两位小数：1/3=0.33。计算结果：1/3=0.33。')]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ result: 'passed', assertionRole: 'quoted_or_hypothetical' });
    expect(results[1]).toMatchObject({ result: 'failed', assertionRole: 'asserted_by_response' });
  });

  it('binds different stated precisions to their own equations in the same sentence', () => {
    const results = scanEquations([block('1 / 3 = 0.33（保留两位小数），1 / 7 = 0.1（保留一位小数）。')]);
    expect(results.map(item => item.result)).toEqual(['passed', 'passed']);
    expect(results[0]?.detail).toContain('2 位小数');
    expect(results[1]?.detail).toContain('1 位小数');
  });

  it('abstains when one local equation has conflicting precision instructions', () => {
    expect(scanEquations([block('1/3=0.33（保留两位小数；保留一位小数）。')])[0]?.result).toBe('unsupported');
  });

  it('does not borrow another equation’s stated precision', () => {
    const results = scanEquations([block('1/3=0.33（保留两位小数），1/7=0.1。')]);
    expect(results.map(item => item.result)).toEqual(['passed', 'unsupported']);
  });

  it('abstains when a shared clause does not identify which equation a precision qualifies', () => {
    const results = scanEquations([block('1/3=0.33 与 1/7=0.1（保留两位小数）。')]);
    expect(results.every(item => item.result === 'unsupported')).toBe(true);
  });
});
