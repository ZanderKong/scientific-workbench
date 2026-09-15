export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
export interface Saved { contentVersion: number; }

/** Serializes writes and never poisons the queue after a failed request. */
export class SaveQueue {
  private latest: string;
  private acknowledged: string;
  private version: number;
  private revision = 0;
  private acknowledgedRevision = 0;
  private inFlight?: Promise<void>;
  private debounce?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(body: string, version: number, private readonly write: (body: string, version: number) => Promise<Saved>,
    private readonly state: (state: SaveState, error?: Error) => void, private readonly draft: (body: string | null) => void) {
    this.latest = this.acknowledged = body; this.version = version;
  }
  change(body: string) {
    this.latest = body; this.revision++; this.draft(body); this.state('dirty');
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.flush().catch(() => {}); }, 500);
    this.deadline ??= setTimeout(() => { void this.flush().catch(() => {}); }, 2000);
  }
  get currentBody() { return this.latest; }
  get confirmedVersion() { return this.version; }
  get hasUnsavedChanges() { return this.latest !== this.acknowledged || this.revision !== this.acknowledgedRevision; }
  async settle() { if (this.inFlight) await this.inFlight; }
  acceptServer(version: number, body?: string) {
    this.version = version;
    if (body !== undefined && !this.hasUnsavedChanges) { this.latest = this.acknowledged = body; this.draft(null); }
  }
  async flush(): Promise<void> {
    clearTimeout(this.debounce); clearTimeout(this.deadline); this.deadline = undefined;
    if (this.inFlight) { await this.inFlight; return this.flush(); }
    if (!this.hasUnsavedChanges) { this.state('saved'); return; }
    const body = this.latest, revision = this.revision; this.state('saving');
    this.inFlight = this.write(body, this.version).then(result => {
      this.version = result.contentVersion; this.acknowledged = body; this.acknowledgedRevision = revision;
      if (!this.hasUnsavedChanges) { this.draft(null); this.state('saved'); }
      else this.state('dirty');
    }).catch(error => { this.state('error', error); throw error; }).finally(() => { this.inFlight = undefined; });
    await this.inFlight;
    if (!this.disposed && this.hasUnsavedChanges) await this.flush();
  }
  dispose() { this.disposed = true; clearTimeout(this.debounce); clearTimeout(this.deadline); }
}
