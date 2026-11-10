import type { Page } from './types';

/**
 * Safety net for a server-backed store: a page whose save failed (offline, expired session) is kept on this
 * device until it can be sent. Replaying is safe because the server merges rather than overwrites.
 * The outbox is per user and only holds pages that have NOT been saved yet; it empties as saves succeed.
 */
export interface OutboxEntry {
  nb: string;
  page: Page;
}

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class Outbox {
  constructor(
    private storage: KeyValue,
    private key: string,
  ) {}

  list(): OutboxEntry[] {
    try {
      const v = JSON.parse(this.storage.getItem(this.key) ?? '[]');
      return Array.isArray(v) ? v.filter((e) => e && typeof e.nb === 'string' && e.page?.id) : [];
    } catch {
      return [];
    }
  }

  private write(entries: OutboxEntry[]) {
    try {
      if (entries.length) this.storage.setItem(this.key, JSON.stringify(entries));
      else this.storage.removeItem(this.key);
    } catch {
      /* storage full or blocked: the in-memory copy is still retried while the app is open */
    }
  }

  /** Remember an unsent page (replacing an older unsent copy of the same page). */
  put(nb: string, page: Page) {
    this.write([...this.list().filter((e) => e.page.id !== page.id), { nb, page }]);
  }

  remove(pageId: string) {
    this.write(this.list().filter((e) => e.page.id !== pageId));
  }

  clear() {
    this.write([]);
  }
}
