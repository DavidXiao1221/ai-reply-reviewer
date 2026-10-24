import { defineBackground } from 'wxt/utils/define-background';
import { READER_CHANNEL } from '../lib/readerProtocol';
import { SelectionInbox, SELECTION_MENU, SELECTION_READY, TAKE_SELECTION } from '../lib/selection';
export default defineBackground(() => {
  const selections = new SelectionInbox();
  const installMenu = () => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: SELECTION_MENU, title: '审阅选中文字', contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
    });
  };
  const configure = async () => {
    await Promise.all([
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }),
      chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
      chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    ]);
  };
  void configure().catch(() => console.warn('扩展初始化未完成，请重新加载扩展。'));
  chrome.runtime.onInstalled.addListener(() => { installMenu(); void configure(); });
  chrome.runtime.onStartup.addListener(() => { void configure(); });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== SELECTION_MENU || tab?.id == null) return;
    selections.put({ text: info.selectionText || '', pageUrl: info.frameUrl || info.pageUrl || tab.url || '', tabId: tab.id, windowId: tab.windowId });
    // Call open directly inside the user gesture, before any asynchronous work.
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
      void chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
      void chrome.action.setTitle({ tabId: tab.id, title: '点击打开侧栏，继续审阅选中文字' });
    });
    void chrome.runtime.sendMessage({ type: SELECTION_READY, windowId: tab.windowId }).catch(() => {});
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.url?.split('?')[0] !== chrome.runtime.getURL('sidepanel.html') || message?.type !== TAKE_SELECTION || !Number.isInteger(message.windowId)) return;
    const selection = selections.take(message.windowId);
    if (selection) {
      void chrome.action.setBadgeText({ tabId: selection.tabId, text: '' }).catch(() => {});
      void chrome.action.setTitle({ tabId: selection.tabId, title: '审阅 AI 回复或网页选中文字' }).catch(() => {});
    }
    respond(selection);
  });
  chrome.windows.onRemoved.addListener(windowId => selections.clear(windowId));
  // 面板断开后释放内容脚本中的快照引用，不保存聊天历史。
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'review-panel') return;
    const sourceTabs = new Set<number>();
    port.onMessage.addListener(m => { if (Number.isInteger(m?.tabId)) sourceTabs.add(m.tabId); });
    port.onDisconnect.addListener(() => {
      for (const tabId of sourceTabs) chrome.tabs.sendMessage(tabId, { type: 'RELEASE', requestId: crypto.randomUUID(), channel: READER_CHANNEL }, { frameId: 0 }).catch(() => {});
    });
  });
});
