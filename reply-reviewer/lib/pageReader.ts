import { CaptureError, type ContentReply, type PanelMessage } from './messages';
import { BUILD_VERSION, READER_CHANNEL, READER_FILE } from './readerProtocol';
import { aiSite } from './sites';
import { webUrl } from './webMode';

type Payload = PanelMessage extends infer M ? M extends PanelMessage ? Omit<M, 'requestId'> : never : never;
type Dependencies = {
  loadedVersion: () => string;
  send: (tabId: number, message: unknown) => Promise<unknown>;
  install: (tabId: number) => Promise<unknown>;
};
class ReaderUnavailable extends Error {}
const browserDependencies: Dependencies = {
  loadedVersion: () => chrome.runtime.getManifest().version,
  send: (tabId, message) => chrome.tabs.sendMessage(tabId, message, { frameId: 0 }),
  install: async tabId => {
    const tab = await chrome.tabs.get(tabId);
    if (!aiSite(tab.url) && (!webUrl(tab.url) || !await chrome.permissions.contains({ origins: [new URL(tab.url!).origin + '/*'] }))) throw new Error('Page access unavailable');
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [READER_FILE], world: 'ISOLATED' });
  },
};

/** Recover only the DOM reader, never retry a model request. */
export class PageReader {
  private failedRepairs = new Set<number>();
  constructor(private onVersion: (version: string) => void = () => {}, private deps: Dependencies = browserDependencies) {}
  forget(tabId: number) { this.failedRepairs.delete(tabId); }
  private async exchange<T>(tabId: number, payload: Payload): Promise<T> {
    const requestId = crypto.randomUUID(); let raw: unknown;
    try { raw = await this.deps.send(tabId, { ...payload, requestId, channel: READER_CHANNEL }); }
    catch { throw new ReaderUnavailable(); }
    const response = raw as (ContentReply<T> & { channel: string; readerVersion: string }) | undefined;
    if (!response || response.requestId !== requestId || response.channel !== READER_CHANNEL || response.readerVersion !== BUILD_VERSION || typeof response.ok !== 'boolean') throw new ReaderUnavailable();
    this.failedRepairs.delete(tabId); this.onVersion(response.readerVersion);
    if (!response.ok) throw new CaptureError(response.code, response.message);
    return response.data;
  }
  async send<T>(tabId: number, payload: Payload): Promise<T> {
    const loaded = this.deps.loadedVersion();
    if (loaded !== BUILD_VERSION) throw new CaptureError('RELOAD_EXTENSION', `扩展尚未完整更新：界面 ${BUILD_VERSION}，已加载扩展 ${loaded}。请重新加载 ID 为 ${chrome.runtime.id} 的 Reply Review，再打开侧栏。`);
    try { return await this.exchange<T>(tabId, payload); }
    catch (error) {
      if (!(error instanceof ReaderUnavailable)) throw error;
      this.onVersion('');
      if (payload.type === 'CAPTURE' && !this.failedRepairs.has(tabId)) {
        this.failedRepairs.add(tabId);
        try { await this.deps.install(tabId); return await this.exchange<T>(tabId, payload); }
        catch (recoveryError) { if (recoveryError instanceof CaptureError) throw recoveryError; }
      }
      throw new CaptureError('READER_UPDATE', '当前网页暂时无法读取。请确认网站访问权限、重新加载扩展并刷新网页；浏览器内置页与商店页面无法读取。');
    }
  }
}
