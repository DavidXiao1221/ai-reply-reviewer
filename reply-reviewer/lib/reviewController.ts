// 即使底层请求忽略 AbortSignal，旧响应也不能写入新的输入状态。
export class ReviewController {
  private sequence = 0;
  private active?: { id: number; fingerprint: string; abort: AbortController };
  begin(fingerprint: string) {
    this.cancel();
    const run = { id: ++this.sequence, fingerprint, abort: new AbortController() };
    this.active = run; return run;
  }
  isCurrent(run: { id: number; fingerprint: string }) {
    return this.active?.id === run.id && this.active.fingerprint === run.fingerprint && !this.active.abort.signal.aborted;
  }
  cancel() { this.active?.abort.abort(); this.active = undefined; this.sequence++; }
}
