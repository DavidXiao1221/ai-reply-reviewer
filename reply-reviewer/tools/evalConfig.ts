// Parse one physical line at a time: \s* on a multiline regex can consume the
// newline after an empty KEY= and mistake the MODEL= line for a credential.
export function parseEvaluationEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^[ \t]*(?:export[ \t]+)?(DEEPSEEK_API_KEY|DEEPSEEK_MODEL)[ \t]*=[ \t]*(.*)$/);
    if (!match) continue;
    const value = match[2]!.trim();
    const quoted = value.match(/^(["'])(.*?)\1(?:[ \t]+#.*)?$/);
    result[match[1]!] = quoted ? quoted[2]! : value.replace(/[ \t]+#.*$/, '').replace(/^#.*$/, '').trim();
  }
  return result;
}

export function resolveEvaluationConfig(supplied: {key?: string; model?: string}, environment: Record<string, string | undefined>, file: Record<string, string>, defaultModel: string) {
  const suppliedKey = supplied.key?.trim(), environmentKey = environment.DEEPSEEK_API_KEY?.trim();
  const key = suppliedKey || environmentKey || file.DEEPSEEK_API_KEY?.trim() || '';
  const model = supplied.model?.trim() || environment.DEEPSEEK_MODEL?.trim() || file.DEEPSEEK_MODEL?.trim() || defaultModel;
  return { key, model, credentialSource: suppliedKey ? 'local password input' : environmentKey ? 'environment' : '.env.local' };
}
