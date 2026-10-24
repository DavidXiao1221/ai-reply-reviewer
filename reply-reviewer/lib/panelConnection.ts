/** Best-effort snapshot cleanup channel. Capture and model requests do not depend on it. */
export class PanelConnection {
  private current: { port: chrome.runtime.Port; disconnected: () => void } | null = null;
  private closed = false;
  constructor(private connect = () => chrome.runtime.connect({ name: 'review-panel' })) {}

  track(tabId: number): boolean {
    if (this.closed) return false;
    // A disconnect can arrive between checking the port and posting. Retry only
    // this metadata message, never the paid review request.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!this.current) {
          const port = this.connect();
          const connection = { port, disconnected: () => {
            void chrome.runtime.lastError;
            this.drop(connection);
          } };
          this.current = connection;
          port.onDisconnect.addListener(connection.disconnected);
        }
        this.current.port.postMessage({ tabId });
        return true;
      } catch {
        if (this.current) this.drop(this.current);
      }
    }
    // The next existing scan will try again; there is no background retry timer.
    return false;
  }

  private drop(connection: NonNullable<PanelConnection['current']>) {
    if (this.current === connection) this.current = null;
    connection.port.onDisconnect.removeListener(connection.disconnected);
    try { connection.port.disconnect(); } catch { /* Already disconnected. */ }
  }

  dispose() {
    this.closed = true;
    if (this.current) this.drop(this.current);
  }
}
