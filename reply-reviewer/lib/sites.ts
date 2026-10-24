export type AISite = 'chatgpt' | 'gemini' | 'perplexity' | 'grok';
export const AI_MATCHES = ['https://chatgpt.com/*', 'https://gemini.google.com/*', 'https://www.perplexity.ai/*', 'https://perplexity.ai/*', 'https://grok.com/*'];
export function aiSite(raw?: string): AISite | null {
  try {
    const url = new URL(raw || '');
    if (url.protocol !== 'https:') return null;
    return ({ 'chatgpt.com': 'chatgpt', 'gemini.google.com': 'gemini', 'www.perplexity.ai': 'perplexity', 'perplexity.ai': 'perplexity', 'grok.com': 'grok' } as Record<string, AISite>)[url.hostname] || null;
  } catch { return null; }
}
export const siteLabel = (source: string) => ({ chatgpt_dom: 'ChatGPT', gemini_dom: 'Gemini', perplexity_dom: 'Perplexity', grok_dom: 'Grok', selection: '网页选中文字' } as Record<string, string>)[source] || '手动输入';
export const isAutoSource = (source: string) => ['chatgpt_dom', 'gemini_dom', 'perplexity_dom', 'grok_dom'].includes(source);
export const isPageSource = (source: string) => isAutoSource(source) || source === 'webpage_dom';
