import { DEFAULT_MODEL } from './deepseek';
// Provider-specific slots deliberately ignore v1.0/v1.1 Gemini credentials.
export const KEY_STORAGE = 'deepseekApiKey';
export const MODEL_STORAGE = 'deepseekModel';
export async function loadSettings() {
  const [session, local] = await Promise.all([chrome.storage.session.get(KEY_STORAGE), chrome.storage.local.get(MODEL_STORAGE)]);
  return { key: typeof session[KEY_STORAGE] === 'string' ? session[KEY_STORAGE] : '', model: typeof local[MODEL_STORAGE] === 'string' ? local[MODEL_STORAGE] : DEFAULT_MODEL };
}
export async function saveSettings(key: string, model: string) {
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.set({ [KEY_STORAGE]: key.trim() });
  await chrome.storage.local.set({ [MODEL_STORAGE]: model.trim() });
}
