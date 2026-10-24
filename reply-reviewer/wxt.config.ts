import { defineConfig } from 'wxt';
import { WEB_ORIGINS } from './lib/webMode';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Reply Review',
    description: '自动审阅 AI 回答，并为文章、新闻和长文生成网页导读与阅读地图。',
    minimum_chrome_version: '116',
    permissions: ['storage', 'sidePanel', 'scripting', 'contextMenus'],
    host_permissions: WEB_ORIGINS,
    action: { default_title: '自动审阅 AI 回复与网页导读' },
    icons: { 16: 'icon-16.png', 48: 'icon-48.png', 128: 'icon-128.png' },
  },
});

