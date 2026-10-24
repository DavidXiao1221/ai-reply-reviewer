# Reply Review

**自动审阅 AI 长回答，为普通网页生成阅读导图。**

首个 GitHub 正式版本：**v3.5.0**。沿用已完成本地迭代的版本号，不从 v1.0.0 重新编号。

打开 Chrome 侧栏后，Reply Review 自动读取当前页面：在 ChatGPT、Gemini、Perplexity、Grok 上精简最新完整回答，在文章、新闻和长文页面上生成独立的网页导读。使用自己的 DeepSeek API Key。

[下载 v3.5.0](https://github.com/DavidXiao1221/ai-reply-reviewer/releases/tag/v3.5.0) · [发布说明](docs/releases/v3.5.0.md) · [数据与权限](PRIVACY.md)

## 功能

| 场景 | 自动呈现 |
| --- | --- |
| AI 回答 | 短结论、最多 3 条关键要点、必要时的一步建议；最多一条有依据的简评，没有实质发现就隐藏 |
| 普通网页 | 来源、标题、预计阅读时间、主旨、可跳转原文的阅读地图；有依据时展示少量阅读提醒 |
| 手动补充 | 右键审阅选中文字、手动粘贴、补充上下文 |

- 对照原文并定位引句；复制、展开与定位不发起新的模型请求。
- 只处理打开侧栏的窗口中当前页面，不主动扫描后台标签页。
- 可单独关闭网页自动导读，也可暂停整个自动模式。
- 同一内容在当前侧栏会话内复用结果；失败不会自动重试。
- AI 审阅和网页导读使用不同的提示词、输出协议与界面。

## 安装

要求桌面版 Chrome 116 或更高版本。当前通过 GitHub 发布解压安装包，未通过 Chrome Web Store 分发。

1. 在 [Releases](https://github.com/DavidXiao1221/ai-reply-reviewer/releases) 下载 **`reply-reviewer-3.5.0-chrome.zip`**。GitHub 自动生成的 `Source code` 压缩包是源码，不是可直接加载的扩展。
2. 解压到一个固定目录，不要在安装后移动或删除该目录。
3. 打开 `chrome://extensions`，启用右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择解压后直接包含 `manifest.json` 的目录。
5. 允许所需网站访问权限，打开扩展侧栏，在设置中填写自己的 DeepSeek API Key。
6. 刷新需要使用的 AI 或文章页面，保持侧栏打开。

从旧的本地版本升级时，使用新版目录并停用旧实例，避免同时运行两份扩展。更新后刷新相关网页。

## 调用与隐私

- 固定使用 DeepSeek API；默认模型为 `deepseek-flash`，保留用户设置的模型名。需要账户具有对应模型/API 的可用额度；接口计费由供应商决定。
- 每次审阅使用一次非流式请求。主动重新生成、应用补充或重开侧栏可能产生新请求。
- API Key 存在浏览器会话存储中，模型名持久保存；问答、网页正文和生成结果保存在内存中。
- AI 模式发送当前问题、对应回答和主动补充；网页模式发送识别正文及阅读元信息，不把完整页面 URL 作为单独字段发送。正文中原有的链接仍可能随正文一起发送。
- 不自动读取完整聊天历史、图片、附件或引用链接中的内容。

完整范围见 [PRIVACY.md](PRIVACY.md)。

## 能力边界

这是文本压缩与轻量审阅工具，**不进行外部事实核查**。原句匹配只能证明引用存在，不能证明结论完整或事实正确。

网页需能识别出独立正文。短于 300 字符的正文、信息流、复杂应用、尚未展开的长文可能不会触发。输入超过 30,000 个 JavaScript 字符会明确失败，不静默截断。登录、付费或浏览器权限限制仍需正常满足；受保护的浏览器页面无法读取。网站布局更新可能影响提取。

## 本地开发

源码位于 `reply-reviewer/`。已验证环境：Node.js **24.15.0**，依赖版本由 `package-lock.json` 锁定。

```sh
git clone https://github.com/DavidXiao1221/ai-reply-reviewer.git
cd ai-reply-reviewer/reply-reviewer
npm ci
npm run typecheck
npm test
npm run build
```

在 Chrome 中加载 `reply-reviewer/.output/chrome-mv3`。开发模式使用 `npm run dev`；生成 ZIP 使用 `npm run zip`。

```text
reply-reviewer/
  adapters/       网页与 AI 站点内容提取
  components/     结果呈现
  entrypoints/    后台、内容脚本与侧栏入口
  lib/            协议、校验、模型调用及自动审阅
  fixtures/       公开的构造样例与精简 DOM
  tests/          可公开复现的固定测试
  public/         图标与第三方许可声明
```

本地完整回归还包含未公开的原始对话和模型响应回放；这些材料及其依赖测试不在公开仓库中。公开测试不调用真实 API，也不代表模型准确率评测。具体首发验证见[发布说明](docs/releases/v3.5.0.md)。

## 许可证与依赖

当前尚未为本项目选择开源许可证。公开仓库用于查看源码、下载与反馈；第三方组件仍遵循各自许可证。Mozilla Readability 的许可声明保留在源码及扩展安装包中，见 [readability-LICENSE.txt](reply-reviewer/public/readability-LICENSE.txt)。
