// Bounded JSON reader. Only observed, unambiguous v3.5 mistakes are
// recoverable; strings, values and source references are never invented.
export function parseModelJson(text: string): { value: unknown; repairs: number } {
  let pos = 0, repairs = 0, numberedRoot = false;
  const fail = (): never => { throw new Error('Invalid model JSON'); };
  const space = () => { while (/[\x20\t\r\n]/.test(text[pos] ?? '\0')) pos++; };
  const string = (): string => {
    if (text[pos] !== '"') return fail();
    const start = pos++;
    while (pos < text.length) {
      const char = text[pos++];
      if (char === '\\') pos++;
      else if (char === '"') return JSON.parse(text.slice(start, pos));
    }
    return fail();
  };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const emptyPoint = (v: unknown) => record(v) && Object.keys(v).length === 2 &&
    typeof v.text === 'string' && !v.text.trim() && Array.isArray(v.evidence) && !v.evidence.length;
  const points = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= 128 && v.every(record);
  const completedItem = (v: unknown) => record(v) && typeof v.text === 'string' && !!v.text.trim() &&
    Object.keys(v).every(k => k === 'text' || k === 'evidence') && Array.isArray(v.evidence);
  // Second recorded response: three numbered items, a root-level null
  // nextStep, and one premature root brace before assessment. Match the whole
  // known shape; do not guess how arbitrary objects or extra fields relate.
  const numberedShape = (v: Record<string, unknown>) => Object.keys(v).length === 3 &&
    Object.hasOwn(v, 'schemaVersion') && v.nextStep === null && record(v.brief) &&
    Object.keys(v.brief).length === 4 && ['conclusion', 'points', 'points2', 'points3'].every(k => completedItem((v.brief as Record<string, unknown>)[k]));
  const repair = () => { if (++repairs > 3) fail(); };
  const read = (path: string[], depth: number): unknown => {
    if (depth > 32) return fail();
    space();
    if (text[pos] === '"') return string();
    if (text[pos] === '{') {
      pos++; space();
      const result: Record<string, unknown> = Object.create(null);
      const duplicates = new Set<string>();
      if (text[pos] === '}') { pos++; return result; }
      while (pos < text.length) {
        const key = string(); space();
        if (text[pos++] !== ':') return fail();
        const value = read([...path, key], depth + 1);
        if (Object.hasOwn(result, key)) {
          // Never silently apply JSON.parse's last-key-wins behavior. Only an
          // exact empty placeholder alongside a completed points array is safe.
          if (path.length !== 1 || path[0] !== 'brief' || key !== 'points' || duplicates.has(key)) return fail();
          const previous = result[key];
          if (emptyPoint(previous) && points(value)) result[key] = value;
          else if (!(points(previous) && emptyPoint(value))) return fail();
          duplicates.add(key); repair();
        } else result[key] = value;
        space();
        if (text[pos] === '}') {
          pos++; space();
          if (!path.length && !numberedRoot && numberedShape(result) && text[pos] === ',') {
            const separator = pos++; space();
            const key = text[pos] === '"' ? string() : ''; space();
            if (key !== 'assessment' || text[pos] !== ':') return fail();
            pos = separator; numberedRoot = true; repair();
          } else return result;
        }
        if (text[pos++] !== ',') return fail();
        space();
      }
      return fail();
    }
    if (text[pos] === '[') {
      pos++; space();
      const result: unknown[] = [];
      if (text[pos] === ']') { pos++; return result; }
      while (pos < text.length) {
        result.push(read([...path, String(result.length)], depth + 1)); space();
        if (text[pos] === ']') { pos++; return result; }
        if (text[pos] !== ',') return fail();
        const comma = pos++;
        space();
        if (path.length === 2 && path[0] === 'brief' && path[1] === 'points' && points(result) && text[pos] === '"') {
          const start = pos, key = string(); space();
          // A property cannot be an array element. Leave its separator for the
          // containing brief object; all remaining syntax must still parse.
          if (key === 'nextStep' && text[pos] === ':') { pos = comma; repair(); return result; }
          pos = start;
        }
      }
      return fail();
    }
    const token = text.slice(pos).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!token) return fail();
    pos += token.length;
    return JSON.parse(token);
  };
  if (text.length > 200000) return fail();
  const value = read([], 0); space();
  if (pos !== text.length) return fail();
  if (numberedRoot) {
    if (!record(value) || !record(value.brief) || !Array.isArray(value.assessment) || Object.keys(value).length !== 4) return fail();
    const brief = value.brief;
    brief.points = [brief.points, brief.points2, brief.points3];
    delete brief.points2; delete brief.points3; repair();
    brief.nextStep = value.nextStep; delete value.nextStep; repair();
  }
  if (repairs && (!record(value) || ![undefined, '3.5', 3.5].includes(value.schemaVersion as undefined | string | number))) return fail();
  return { value, repairs };
}
