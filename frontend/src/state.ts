/** Pure state boundaries, independently testable without a browser or backend. */
export class VersionGate {
  current = 0;
  next() {
    return ++this.current;
  }
  accepts(version: number) {
    return version === this.current;
  }
}

export class SubmissionLatch {
  private pending?: { body: string; key: string };
  constructor(private uuid = () => crypto.randomUUID() as string) {}
  forBody(body: string) {
    if (this.pending?.body !== body) this.pending = { body, key: this.uuid() };
    return this.pending!;
  }
  accepted() {
    this.pending = undefined;
  }
}

export class DraftBuffer<T> {
  value: T;
  revision: number;
  conflict = false;
  private saved: string;
  private inFlight?: Promise<void>;
  constructor(value: T, revision: number) {
    this.value = structuredClone(value);
    this.saved = JSON.stringify(value);
    this.revision = revision;
  }
  get dirty() {
    return JSON.stringify(this.value) !== this.saved;
  }
  get saving() {
    return !!this.inFlight;
  }
  set(value: T) {
    this.value = structuredClone(value);
  }
  async flush(
    writer: (value: T, revision: number) => Promise<{ revision: number }>,
  ): Promise<void> {
    if (this.conflict) throw new Error("draft_conflict");
    if (this.inFlight) {
      await this.inFlight;
      return this.flush(writer);
    }
    if (!this.dirty) return;
    const operation = async () => {
      while (this.dirty) {
        const snapshot = structuredClone(this.value);
        try {
          const saved = await writer(snapshot, this.revision);
          this.revision = saved.revision;
          this.saved = JSON.stringify(snapshot);
        } catch (error) {
          if ((error as { code?: string }).code === "draft_conflict")
            this.conflict = true;
          throw error;
        }
      }
    };
    this.inFlight = operation();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }
}

export const active = (status: string) =>
  status === "queued" || status === "running";
export function pollingDelay(failures: number, hidden = false) {
  return Math.min(30000, Math.max(hidden ? 10000 : 1800, 1800 * 2 ** failures));
}
export function locationOffset(
  source: string,
  location: { offset?: number; line?: number; column?: number },
) {
  if (typeof location.offset === "number")
    return Math.max(0, Math.min(source.length, location.offset));
  const lines = source.split("\n");
  const line = Math.max(
    0,
    Math.min(lines.length - 1, (location.line || 1) - 1),
  );
  return (
    lines.slice(0, line).reduce((n, s) => n + s.length + 1, 0) +
    Math.min(lines[line].length, Math.max(0, (location.column || 1) - 1))
  );
}
