type AssertionRole = 'asserted_by_response' | 'quoted_or_hypothetical' | 'unclear';
type ArithmeticResult = { result: 'passed' | 'failed' | 'unsupported'; left: string | null; right: string | null; detail: string };
export type EquationCheck = ArithmeticResult & {
  id: string; blockId: string; exactQuote: string; assertionRole: AssertionRole; reason: string;
};
type Block = { id: string; text: string; kind?: string };
type Candidate = { id: string; evidence: { blockId: string; exactQuote: string }; assertionRole: AssertionRole; roleExplanation: string };

// Bounds apply before parsing, to every literal, and after every exact operation.
// No JavaScript evaluator or floating-point arithmetic is used for the values.
const LIMITS = { characters: 300, tokens: 100, depth: 20, literalDigits: 36, rationalDigits: 120 };
const SCOPE = '仅核对原文明确写出的数值等式；不验证单位、业务口径、数据来源或因果关系。';
type Fraction = { n: bigint; d: bigint };
const abs = (value: bigint) => value < 0n ? -value : value;
function gcd(a: bigint, b: bigint): bigint {
  while (b) { const remainder = a % b; a = b; b = remainder; }
  return a;
}

function fraction(n: bigint, d = 1n): Fraction {
  if (!d) throw new Error('除数不能为零');
  if (d < 0n) { n = -n; d = -d; }
  const divisor = gcd(abs(n), d);
  n /= divisor; d /= divisor;
  if (abs(n).toString().length > LIMITS.rationalDigits || d.toString().length > LIMITS.rationalDigits)
    throw new Error('计算中间值超出有界数值范围');
  return { n, d };
}

function decimal(raw: string): Fraction {
  const [whole = '', tail = ''] = raw.split('.');
  if (whole.length + tail.length > LIMITS.literalDigits) throw new Error('数字超过 36 位限制');
  return fraction(BigInt((whole || '0') + tail), 10n ** BigInt(tail.length));
}

function format(value: Fraction): string {
  let remaining = value.d;
  let twos = 0; let fives = 0;
  while (remaining % 2n === 0n) { remaining /= 2n; twos++; }
  while (remaining % 5n === 0n) { remaining /= 5n; fives++; }
  if (remaining !== 1n) return `${value.n}/${value.d}`;
  const places = Math.max(twos, fives);
  const scaled = abs(value.n) * 10n ** BigInt(places) / value.d;
  const digits = scaled.toString().padStart(places + 1, '0');
  const unsigned = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.?0+$/, '') : digits;
  return (value.n < 0n ? '-' : '') + unsigned;
}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset]!)) { offset++; continue; }
    const match = /^(?:\d+(?:\.\d+)?|\.\d+|[()+\-*/%])/.exec(source.slice(offset));
    if (!match) throw new Error('包含不支持的单位、变量、函数或字符');
    tokens.push(match[0]); offset += match[0].length;
    if (tokens.length > LIMITS.tokens) throw new Error('表达式超过 100 个词元限制');
  }
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: string[]) {}
  parse(): Fraction {
    const value = this.sum(0);
    if (this.index !== this.tokens.length) throw new Error('表达式不是完整的受支持数值运算');
    return value;
  }
  private take(token: string): boolean {
    if (this.tokens[this.index] !== token) return false;
    this.index++; return true;
  }
  private sum(depth: number): Fraction {
    let value = this.product(depth);
    while (this.tokens[this.index] === '+' || this.tokens[this.index] === '-') {
      const sign = this.tokens[this.index++] === '+' ? 1n : -1n;
      const next = this.product(depth);
      value = fraction(value.n * next.d + sign * next.n * value.d, value.d * next.d);
    }
    return value;
  }
  private product(depth: number): Fraction {
    let value = this.unary(depth);
    while (this.tokens[this.index] === '*' || this.tokens[this.index] === '/') {
      const multiply = this.tokens[this.index++] === '*';
      const next = this.unary(depth);
      value = multiply ? fraction(value.n * next.n, value.d * next.d) : fraction(value.n * next.d, value.d * next.n);
    }
    return value;
  }
  private unary(depth: number): Fraction {
    if (depth > LIMITS.depth) throw new Error('表达式超过 20 层嵌套限制');
    if (this.take('+')) return this.unary(depth + 1);
    if (this.take('-')) { const value = this.unary(depth + 1); return { n: -value.n, d: value.d }; }
    if (this.take('(')) {
      const value = this.sum(depth + 1);
      if (!this.take(')')) throw new Error('括号未配对');
      return value;
    }
    const token = this.tokens[this.index++];
    if (!token || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) throw new Error('缺少合法数值');
    const value = decimal(token);
    return this.take('%') ? fraction(value.n, value.d * 100n) : value;
  }
}

function unsupported(reason: string): ArithmeticResult {
  return { result: 'unsupported', left: null, right: null, detail: `未核对：${reason}。${SCOPE}` };
}

function rounded(value: Fraction, places: number): Fraction {
  const scale = 10n ** BigInt(places);
  const scaled = abs(value.n) * scale;
  const integer = scaled / value.d + (scaled % value.d * 2n >= value.d ? 1n : 0n);
  return fraction(value.n < 0n ? -integer : integer, scale);
}

function evaluate(expression: string, statedPrecision?: number): ArithmeticResult {
  try {
    if (expression.length > LIMITS.characters) throw new Error('表达式超过 300 字符限制');
    const normalized = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    const separators = normalized.match(/[=≈]/g);
    if (separators?.length !== 1) throw new Error('需要一个完整等式，不支持连等式');
    const [leftSource = '', rightSource = ''] = normalized.split(/[=≈]/);
    const leftTokens = tokenize(leftSource); const rightTokens = tokenize(rightSource);
    if (leftTokens.length + rightTokens.length + 1 > LIMITS.tokens) throw new Error('表达式超过 100 个词元限制');
    const left = new Parser(leftTokens).parse(); const right = new Parser(rightTokens).parse();
    let comparedLeft = left;
    let rounding = '';
    if (separators[0] === '≈' || statedPrecision !== undefined) {
      const literal = /^\s*[+-]?\s*(\d+(?:\.(\d+))?|\.(\d+))\s*(%)?\s*$/.exec(rightSource);
      if (!literal) throw new Error('近似或舍入比较的右侧必须是显示精度明确的单个数值');
      const places = (statedPrecision ?? literal[2]?.length ?? literal[3]?.length ?? 0) + (literal[4] ? 2 : 0);
      if (places > LIMITS.literalDigits) throw new Error('舍入精度超出限制');
      comparedLeft = rounded(left, places);
      rounding = `${separators[0] === '≈' ? '按 ≈ 右侧显示精度' : '按原文明示精度'}${literal[4] ? '（百分比换算为数值后）' : ''}保留 ${places} 位小数，四舍五入（中点远离零），左侧舍入为 ${format(comparedLeft)}。`;
    }
    const passed = comparedLeft.n * right.d === right.n * comparedLeft.d;
    return { result: passed ? 'passed' : 'failed', left: format(left), right: format(right),
      detail: `${rounding}${passed ? '数值比较成立' : '数值比较不成立'}；左侧精确值 ${format(left)}，右侧精确值 ${format(right)}。${SCOPE}` };
  } catch (error) { return unsupported(error instanceof Error ? error.message : '不支持的数值表达式'); }
}

/** Check a complete equation only. '=' is exact; '≈' rounds to the RHS display precision. */
export function checkEquation(expression: string): ArithmeticResult { return evaluate(expression); }

type Span = { start: number; end: number };
// Include Unicode horizontal whitespace in the equation itself. Newlines remain
// scope boundaries so a neighboring line cannot be spliced into arithmetic.
const NUMERIC_CHARACTER = /[\d.()+\-*/×÷−%=≈]|[^\S\r\n]/u;
const SENTENCE_BOUNDARY = /[。！？!?\n；;]/;
const CLAUSE_BOUNDARY = /[。！？!?\n；;，,：:]/;

function bounds(text: string, offset: number, boundary: RegExp): Span {
  let start = offset; let end = offset + 1;
  while (start > 0 && !boundary.test(text[start - 1]!)) start--;
  while (end < text.length && !boundary.test(text[end]!)) end++;
  return { start, end };
}

function trimSpan(text: string, span: Span): Span {
  while (span.start < span.end && /\s/.test(text[span.start]!)) span.start++;
  while (span.end > span.start && /\s/.test(text[span.end - 1]!)) span.end--;
  // A final full stop belongs to prose, never to a decimal literal.
  if (text[span.end - 1] === '.' && !/\d/.test(text[span.end] ?? '')) span.end--;
  return span;
}

function equationSpan(text: string, offset: number): { span: Span; unsafe: boolean } {
  let start = offset; let end = offset + 1;
  while (start > 0 && NUMERIC_CHARACTER.test(text[start - 1]!)) start--;
  while (end < text.length && NUMERIC_CHARACTER.test(text[end]!)) end++;
  const span = trimSpan(text, { start, end });
  const expression = text.slice(span.start, span.end);
  const prefix = text.slice(0, span.start);
  const last = prefix.slice(-1);
  const before = prefix.replace(/[^\S\r\n]+$/u, '').slice(-1);
  const after = text[span.end] ?? '';
  const suffix = text.slice(span.end).replace(/^[^\S\r\n]+/u, '');
  const following = suffix[0] ?? '';
  const thousandsBoundary = /\d,[^\S\r\n]*$/u.test(prefix) || /^,[^\S\r\n]*\d/u.test(suffix);
  const unsafe = !/\d/.test(expression.split(/[=≈]/)[0] ?? '')
    || /[\p{L}\p{N}_$€£¥]/u.test(last)
      && (/[A-Za-z0-9_$€£¥]/.test(last) || /^[+\-*/×÷−]/.test(expression))
    || /^[([]/.test(expression) && /[A-Za-z0-9_]/.test(before)
    || /[\p{L}\p{N}_$€£¥]/u.test(after)
    || /^[+\-*/×÷−]/.test(expression) && /[\p{L}_$€£¥]/u.test(before)
    || /[元美欧镑角分支个件吨克米秒时天日月年]/.test(before)
    || /[\^|&\\[\]{}<>!~]/.test(before + following)
    || /[\p{Sm}\p{Sc}\p{No}°℃℉]/u.test(before + following)
    || /^(?:USD|EUR|CNY|RMB|GBP|JPY|HKD|AUD|CAD|CHF|INR|kg|km|cm|mm|ms|m|s|dollars?|euros?|yuan|pounds?)\b/i.test(suffix)
    || /^[元美欧镑角分支个件吨克米秒时天日月年]/.test(suffix)
    || /\b(?:sin|cos|tan|sqrt|log|ln|abs|round|ceil|floor|max|min|sum|exp|[A-Za-z])\s*$/i.test(prefix)
    || /\b(?:USD|EUR|CNY|RMB|GBP|JPY|HKD|AUD|CAD|CHF|INR|dollars?|euros?|yuan|pounds?)\s*$/i.test(prefix)
    || /(?:^|\D)\d{4}[-/](?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])(?:\D|$)/.test(expression)
    || thousandsBoundary;
  return { span: unsafe ? trimSpan(text, bounds(text, offset, thousandsBoundary ? SENTENCE_BOUNDARY : CLAUSE_BOUNDARY)) : span, unsafe };
}

function quotationScope(text: string, span: Span): 'quoted' | 'unclear' | null {
  const pairs: Record<string, string> = { '“': '”', '「': '」', '『': '』', '‘': '’', '"': '"', "'": "'", '`': '`' };
  const stack: Array<{ start: number; closing: string }> = [];
  const complete: Span[] = [];
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    const previous = text[index - 1] ?? ''; const next = text[index + 1] ?? '';
    if ((character === "'" || character === '’') && /[A-Za-z0-9]/.test(previous) && /[A-Za-z0-9]/.test(next)) continue;
    if (character === "'" && /[A-Za-z0-9]/.test(previous) && stack.at(-1)?.closing !== "'") continue;
    let backslashes = 0;
    for (let before = index - 1; before >= 0 && text[before] === '\\'; before--) backslashes++;
    if (backslashes % 2) continue;
    let matching = -1;
    for (let depth = stack.length - 1; depth >= 0; depth--) {
      if (stack[depth]!.closing === character) { matching = depth; break; }
    }
    if (matching >= 0) {
      complete.push({ start: stack[matching]!.start, end: index });
      // Closing an outer quotation ends any inner scopes as well. A different
      // quote type cannot leave an unrelated parity toggle active afterwards.
      stack.length = matching;
    } else if (pairs[character]) stack.push({ start: index, closing: pairs[character]! });
  }
  if (complete.some(range => span.start > range.start && span.end <= range.end)) return 'quoted';
  if (stack.some(range => span.start > range.start)) return 'unclear';
  return null;
}

function roleFor(block: Block, span: Span, context: string): { assertionRole: AssertionRole; reason: string } {
  const prefix = block.text.slice(0, span.start);
  const linePrefix = prefix.slice(prefix.lastIndexOf('\n') + 1);
  const quotation = quotationScope(block.text, span);
  const codeOrQuote = /code|quote|pre/i.test(block.kind ?? '') || /(?:^|\n)\s*(?:```|~~~)/.test(block.text)
    || /^\s*>/.test(linePrefix) || /^\s*>/.test(context) || quotation === 'quoted';
  const contextualQuote = /错误(?:写法|示例|例子|表达|等式)?|错例|反例|不能写|不要写|不成立|并不正确|不应(?:认为|得出)|引用|原文|原回答|有人(?:声称|认为|写|说)|假设|如果|假如|例如|示例|举例|\b(?:if|suppose|example|quoted?|incorrect|wrong|false)\b/i.test(context);
  if (codeOrQuote || contextualQuote) return { assertionRole: 'quoted_or_hypothetical', reason: '本地原文语境属于引用、代码、假设或示例，不能作为回答自身断言的算术错误。' };
  if (quotation === 'unclear') return { assertionRole: 'unclear', reason: '等式附近的引号未闭合或不配对，无法确认是引用还是回答自身断言。' };
  if (/[?？]/.test(context) || /是否|能否|对吗|正确吗|需核实|待(?:核验|核实|确认)|可能|也许|\b(?:whether|maybe|perhaps)\b/i.test(context))
    return { assertionRole: 'unclear', reason: '原文处于提问或不确定语境，未确认这是回答自身的数值断言。' };
  return { assertionRole: 'asserted_by_response', reason: '原文直接陈述完整数值等式，未发现引用、代码、假设或提问标记；仅核对该等式的数值。' };
}

function precisionValues(context: string): number[] {
  if (/(?:不|无|未|不要|无需|不能|不是).{0,3}(?:保留|四舍五入)|\b(?:not|never|without)\s+round/i.test(context)) return [];
  const values: number[] = [];
  for (const match of context.matchAll(/(?:保留|四舍五入(?:到|至)?)\s*(\d{1,2}|一|二|两|三|四|五|六|七|八|九|十)\s*位小数/g)) {
    const value = /^\d+$/.test(match[1]!) ? Number(match[1]) : ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<string, number>)[match[1]!];
    if (value !== undefined) values.push(value);
  }
  for (const match of context.matchAll(/\bround(?:ed|ing)?\s+to\s+(\d{1,2})\s+decimal(?:\s+places|s)?\b/gi)) values.push(Number(match[1]));
  return values;
}

function roundingBounds(text: string, offset: number, clause: boolean): Span {
  const boundary = clause ? /[，,；;。！？!?\n]/ : /[。！？!?\n]/;
  let start = 0; let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (/[（(]/.test(character)) depth++;
    else if (/[）)]/.test(character)) depth = Math.max(0, depth - 1);
    if (depth === 0 && boundary.test(character)) {
      if (index < offset) start = index + 1;
      else return { start, end: index };
    }
  }
  return { start, end: text.length };
}

function localPrecision(text: string, offset: number): { precision?: number; ambiguity?: string } {
  const clause = roundingBounds(text, offset, true);
  const local = text.slice(clause.start, clause.end);
  const values = precisionValues(local);
  if (new Set(values).size > 1) return { ambiguity: '同一等式的局部说明出现冲突精度，无法确定舍入规则' };
  if (values.length && (local.match(/[=≈]/g)?.length ?? 0) > 1)
    return { ambiguity: '一个分句含多条等式，无法确定精度说明属于哪一条' };
  if (values.length) return { precision: values[0] };
  const sentence = roundingBounds(text, offset, false);
  if (text[offset] === '=' && precisionValues(text.slice(sentence.start, sentence.end)).length)
    return { ambiguity: '精度说明位于其他分句，未确认适用于本条等式，不借用其他等式的精度' };
  return {};
}

function anchoredCandidate(candidate: Candidate, block: Block, span: Span): boolean {
  const quote = candidate.evidence.exactQuote;
  if (candidate.evidence.blockId !== block.id || quote.length < span.end - span.start) return false;
  // A candidate may quote a complete sentence, but must contain this entire
  // local equation at its actual occurrence, never only a numeric fragment.
  let start = block.text.indexOf(quote);
  while (start !== -1 && start <= span.start) {
    if (start + quote.length >= span.end) return true;
    start = block.text.indexOf(quote, start + 1);
  }
  return false;
}

function introductionFrom(text: string): string | null {
  const ending = text.trim().split(/[。！？!?\n]/).at(-1)?.trim() ?? '';
  if (/[=≈]/.test(ending) || !/(?:[:：]|如下)\s*$/.test(ending)) return null;
  return /错误|错例|反例|引用|原文|原回答|假设|如果|假如|例如|示例|举例|\b(?:if|suppose|example|quoted?|incorrect|wrong)\b/i.test(ending) ? ending : null;
}

/** Model candidates supply anchors/roles only; expression discovery and execution stay local. */
export function scanEquations(blocks: Block[], candidates: Candidate[] = []): EquationCheck[] {
  const checks: EquationCheck[] = [];
  const usedIds = new Set<string>();
  for (const [blockIndex, block] of blocks.entries()) {
    // Inherit only the immediate predecessor's explicit introduction, never a
    // persistent mode that could taint later ordinary paragraphs.
    const previousBlock = blocks[blockIndex - 1];
    const previousIntroduction = previousBlock ? introductionFrom(previousBlock.text) : null;
    const equalities = /[=≈]/g;
    let match: RegExpExecArray | null;
    while ((match = equalities.exec(block.text))) {
      const { span, unsafe } = equationSpan(block.text, match.index);
      equalities.lastIndex = Math.max(equalities.lastIndex, span.end);
      const exactQuote = block.text.slice(span.start, span.end);
      const sentence = bounds(block.text, match.index, SENTENCE_BOUNDARY);
      let context = block.text.slice(sentence.start, Math.min(sentence.end + 1, block.text.length));
      if (previousIntroduction && !block.text.slice(0, sentence.start).trim())
        context = `${previousIntroduction}\n${context}`;
      if (block.text[sentence.start - 1] === '\n') {
        const preceding = block.text.slice(0, sentence.start).trimEnd().split('\n').at(-1) ?? '';
        if (!/[=≈]/.test(preceding) && /错误|错例|反例|引用|原文|原回答|假设|如果|假如|例如|示例|举例|\b(?:if|suppose|example|quoted?|incorrect|wrong)\b/i.test(preceding))
          context = `${preceding}\n${context}`;
      }
      const localRole = roleFor(block, span, context);
      const candidate = candidates.find(item => anchoredCandidate(item, block, span));
      let assertionRole = localRole.assertionRole; let reason = localRole.reason;
      if (candidate && assertionRole === 'asserted_by_response' && candidate.assertionRole !== 'asserted_by_response') {
        assertionRole = candidate.assertionRole;
        reason = '模型候选将语境标为非断言或不明确，保守保留该限制；不提升为回答自身错误。';
      }
      let id = candidate?.id ?? `eq${String(checks.length + 1).padStart(3, '0')}`;
      let serial = checks.length + 1;
      while (usedIds.has(id)) id = `eq${String(serial++).padStart(3, '0')}`;
      usedIds.add(id);
      const rounding = localPrecision(block.text, match.index);
      const arithmetic = unsafe ? unsupported('等式含日期形态，或紧邻变量、函数、单位及其他语法，不能只截取数值片段')
        : rounding.ambiguity ? unsupported(rounding.ambiguity) : evaluate(exactQuote, rounding.precision);
      checks.push({ id, blockId: block.id, exactQuote, ...arithmetic, assertionRole, reason });
    }
  }
  return checks;
}
