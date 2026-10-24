import { afterEach, it, expect, vi } from 'vitest';
import { loadSettings, saveSettings, KEY_STORAGE, MODEL_STORAGE } from '../lib/settings';
function storage(sessionValues: Record<string, unknown>, localValues: Record<string, unknown>) {
  const area = (values: Record<string, unknown>) => ({
    get: vi.fn(async (name: string) => ({ [name]: values[name] })),
    set: vi.fn(async (update: Record<string, unknown>) => { Object.assign(values, update); }),
    setAccessLevel: vi.fn(async () => {}),
  });
  const mock = { session: area(sessionValues), local: area(localValues) };
  vi.stubGlobal('chrome', { storage: mock }); return mock;
}
afterEach(() => vi.unstubAllGlobals());
it('升级后不会把旧Gemini密钥或模型作为DeepSeek配置', async () => {
  const mock = storage({ apiKey: 'synthetic-legacy-google-key' }, { model: 'gemini-3.8-flash' });
  expect(await loadSettings()).toEqual({ key: '', model: 'deepseek-flash' });
  expect(mock.session.get).toHaveBeenCalledWith(KEY_STORAGE);
  expect(mock.local.get).toHaveBeenCalledWith(MODEL_STORAGE);
});
it('保存后仅从DeepSeek专用槽读取，密钥不持久化', async () => {
  const session: Record<string, unknown> = {}, local: Record<string, unknown> = {};
  const mock = storage(session, local);
  await saveSettings(' synthetic-deepseek-key ', ' deepseek-flash ');
  expect(await loadSettings()).toEqual({ key: 'synthetic-deepseek-key', model: 'deepseek-flash' });
  expect(local).toEqual({ deepseekModel: 'deepseek-flash' });
  expect(session).toEqual({ deepseekApiKey: 'synthetic-deepseek-key' });
  expect(mock.session.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
});

