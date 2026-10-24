import { describe, expect, it } from 'vitest';
import { parseEvaluationEnv, resolveEvaluationConfig } from '../tools/evalConfig';

describe('评测凭据解析不能将下一行当成Key', () => {
  it.each(['\n','\r\n'])('空Key与下一行模型保持独立（%j）', newline => {
    const parsed=parseEvaluationEnv('DEEPSEEK_API_KEY='+newline+'DEEPSEEK_MODEL=deepseek-flash'+newline);
    expect(parsed).toEqual({DEEPSEEK_API_KEY:'',DEEPSEEK_MODEL:'deepseek-flash'});
    expect(resolveEvaluationConfig({}, {}, parsed, 'fallback').key).toBe('');
  });
  it.each(['   ',"''",'""','# enter locally','"" # enter locally'])('空凭据形式 %s 仍为空', value => {
    const parsed=parseEvaluationEnv('DEEPSEEK_API_KEY='+value+'\nDEEPSEEK_MODEL=deepseek-flash');
    expect(parsed.DEEPSEEK_API_KEY).toBe('');
  });
  it('忽略注释，支持BOM、引号和等号旁空白，不读取无关配置', () => {
    expect(parseEvaluationEnv('\uFEFF# comment\n export DEEPSEEK_API_KEY = "synthetic-credential" # comment\nDEEPSEEK_MODEL= deepseek-flash\nUNRELATED=private')).toEqual({DEEPSEEK_API_KEY:'synthetic-credential',DEEPSEEK_MODEL:'deepseek-flash'});
  });
  it('本机输入优先，其次环境变量和文件；只保存来源标签', () => {
    const file={DEEPSEEK_API_KEY:'synthetic-file',DEEPSEEK_MODEL:'file-model'};
    expect(resolveEvaluationConfig({key:' synthetic-session ',model:' saved-model '},{DEEPSEEK_API_KEY:'synthetic-env'},file,'default')).toEqual({key:'synthetic-session',model:'saved-model',credentialSource:'local password input'});
    expect(resolveEvaluationConfig({},{DEEPSEEK_API_KEY:' synthetic-env '},file,'default').credentialSource).toBe('environment');
    expect(resolveEvaluationConfig({},{DEEPSEEK_API_KEY:' '},file,'default').key).toBe('synthetic-file');
  });
});
