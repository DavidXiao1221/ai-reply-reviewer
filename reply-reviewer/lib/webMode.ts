export const WEB_ORIGINS = ['http://*/*', 'https://*/*'];
export const WEB_ENABLED = 'webGuideEnabled';
export function webUrl(raw?: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(raw || '').protocol); } catch { return false; }
}
export function documentUrl(raw: string): string {
  const url = new URL(raw); url.hash = ''; return url.href;
}
