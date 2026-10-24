import { afterEach, expect, it, vi } from 'vitest';
vi.mock('wxt/utils/define-background', () => ({ defineBackground: (fn: unknown) => fn }));
import background from '../entrypoints/background';
import { SELECTION_MENU, TAKE_SELECTION } from '../lib/selection';

afterEach(() => vi.unstubAllGlobals());
function boot() {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const event = (name: string) => ({ addListener: (fn: (...args: any[]) => any) => { handlers[name] = fn; } });
  const order: string[] = [];
  const open = vi.fn(() => { order.push('open'); return Promise.resolve(); });
  const sendMessage = vi.fn(() => { order.push('notify'); return Promise.resolve(); });
  const create = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { id: 'extension', getURL: (p: string) => 'chrome-extension://extension/' + p, onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message'), onConnect: event('connect'), sendMessage },
    contextMenus: { onClicked: event('click'), removeAll: (fn: () => void) => fn(), create },
    sidePanel: { open, setPanelBehavior: vi.fn().mockResolvedValue(undefined) },
    storage: { session: { setAccessLevel: vi.fn().mockResolvedValue(undefined) }, local: { setAccessLevel: vi.fn().mockResolvedValue(undefined) } },
    action: { setBadgeText: vi.fn().mockResolvedValue(undefined), setTitle: vi.fn().mockResolvedValue(undefined) },
    windows: { onRemoved: event('windowRemoved') },
  });
  (background as unknown as () => void)();
  const take = (windowId: number, sender = { id: 'extension', url: 'chrome-extension://extension/sidepanel.html' }) => {
    let result: unknown = 'not-responded'; handlers.message!({ type: TAKE_SELECTION, windowId }, sender, (r: unknown) => { result = r; }); return result;
  };
  return { handlers, order, open, create, take };
}
it('注册仅针对普通网页选区的菜单；先开侧栏，再异步通知', () => {
  const h = boot(); h.handlers.installed!();
  expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ id: SELECTION_MENU, contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] }));
  h.handlers.click!({ menuItemId: SELECTION_MENU, selectionText: '用户选区', pageUrl: 'https://example.com' }, { id: 4, windowId: 8 });
  expect(h.order).toEqual(['open', 'notify']); expect(h.open).toHaveBeenCalledWith({ windowId: 8 });
  expect(h.take(8)).toMatchObject({ text: '用户选区', tabId: 4, windowId: 8 }); expect(h.take(8)).toBeNull();
});
it('跨域 iframe 的选择以实际 frameUrl 为来源，窗口之间不混用', () => {
  const h = boot(); h.handlers.click!({ menuItemId: SELECTION_MENU, selectionText: '框架文字', pageUrl: 'https://host.test/', frameUrl: 'https://frame.test/article' }, { id: 4, windowId: 8 });
  expect(h.take(9)).toBeNull(); expect(h.take(8)).toMatchObject({ pageUrl: 'https://frame.test/article' });
});
it('网页脚本不能领取选区；窗口关闭后清理待投递内容', () => {
  const h = boot(); h.handlers.click!({ menuItemId: SELECTION_MENU, selectionText: '选区', pageUrl: 'https://example.com' }, { id: 4, windowId: 8 });
  expect(h.take(8, { id: 'extension', url: 'https://example.com' })).toBe('not-responded');
  expect(h.take(8, { id: 'other-extension', url: 'chrome-extension://extension/sidepanel.html' })).toBe('not-responded');
  h.handlers.windowRemoved!(8); expect(h.take(8)).toBeNull();
});
