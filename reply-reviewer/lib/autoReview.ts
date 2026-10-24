import type { ReviewSnapshot } from './types';
import { CaptureError } from './messages';
import { reviewDiagnostic, type ReviewDiagnostic } from './parseReview';

export type AutoState<R> = {
  status: 'waiting' | 'running' | 'done' | 'error';
  message: string;
  snapshot?: ReviewSnapshot;
  result?: R;
  diagnostic?: ReviewDiagnostic;
};
type Attempt<R> = { status: 'done'; result: R } | { status: 'error'; message: string; diagnostic?: ReviewDiagnostic };
type Dependencies<R> = {
  scan: () => Promise<ReviewSnapshot>;
  identify: (snapshot: ReviewSnapshot) => Promise<string>;
  review: (snapshot: ReviewSnapshot, signal: AbortSignal) => Promise<R>;
  verify: (snapshot: ReviewSnapshot) => Promise<void>;
  changed: (state: AutoState<R>) => void;
};

/** Panel-owned coordinator. Scanning continues while a model request is pending. */
export class AutoReview<R> {
  private enabled = false;
  private scanning = false;
  private epoch = 0;
  private currentId: string | null = null;
  private request: AbortController | null = null;
  private attempts = new Map<string, Attempt<R>>();
  constructor(private deps: Dependencies<R>) {}

  resume() { this.enabled = true; }
  pause() { this.enabled = false; this.cancel(); }
  private cancel() {
    this.epoch++;
    this.request?.abort(); this.request = null; this.currentId = null;
  }
  invalidate(message = '正在检查当前页面…') {
    this.cancel();
    if (this.enabled) this.deps.changed({ status: 'waiting', message });
  }
  retry() {
    if (this.currentId) this.attempts.delete(this.currentId);
    this.invalidate('正在重新检查当前回答…');
  }
  private remember(id: string, value: Attempt<R>) {
    this.attempts.set(id, value);
    if (this.attempts.size > 12) this.attempts.delete(this.attempts.keys().next().value!);
  }
  async tick() {
    if (!this.enabled || this.scanning) return;
    this.scanning = true;
    const epoch = this.epoch;
    try {
      const snapshot = await this.deps.scan();
      const id = await this.deps.identify(snapshot);
      if (!this.enabled || epoch !== this.epoch) return;
      if (id === this.currentId) return;
      this.cancel(); this.currentId = id;
      const cached = this.attempts.get(id);
      if (cached) {
        this.deps.changed(cached.status === 'done'
          ? { status: 'done', message: '已审阅，等待下一条完整回答。', snapshot, result: cached.result }
          : { status: 'error', message: cached.message, diagnostic: cached.diagnostic, snapshot });
        return;
      }
      const request = new AbortController(); this.request = request;
      const runEpoch = this.epoch;
      const current = () => this.enabled && !request.signal.aborted && runEpoch === this.epoch && this.currentId === id;
      this.deps.changed({ status: 'running', message: snapshot.source === 'webpage_dom' ? '正文已就绪，正在生成导读…' : '已读取完整回答，正在自动审阅…', snapshot });
      void (async () => {
        try {
          const result = await this.deps.review(snapshot, request.signal);
          if (!current()) return;
          await this.deps.verify(snapshot);
          if (!current()) return;
          this.remember(id, { status: 'done', result });
          this.request = null;
          this.deps.changed({ status: 'done', message: '已审阅，等待下一条完整回答。', snapshot, result });
        } catch (error) {
          if (!current()) return;
          if (error instanceof CaptureError) { this.invalidate('原文正在变化，等待新的完整回答…'); return; }
          const message = `${error instanceof Error ? error.message : '审阅失败。'} 本条不会自动重试。`;
          const diagnostic = reviewDiagnostic(error);
          this.remember(id, { status: 'error', message, diagnostic });
          this.request = null;
          this.deps.changed({ status: 'error', message, diagnostic, snapshot });
        }
      })();
    } catch (error) {
      if (!this.enabled || epoch !== this.epoch) return;
      this.cancel();
      const waiting = error instanceof CaptureError && ['GENERATING', 'NO_REPLY', 'NO_ARTICLE', 'WEB_PERMISSION', 'NOT_CHATGPT', 'NOT_AI_SITE', 'STALE_SNAPSHOT'].includes(error.code);
      this.deps.changed({ status: waiting ? 'waiting' : 'error', message: error instanceof Error ? error.message : '无法读取当前页面，请刷新后重试。' });
    } finally { this.scanning = false; }
  }
}
