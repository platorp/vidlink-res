'use strict';

class UpstreamError extends Error {
  constructor(code, message) { super(message); this.name = 'UpstreamError'; this.code = code; }
}

async function getJson(url, { fetchImpl = fetch, timeoutMs = 25000, headers = {} } = {}) {
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamError('UPSTREAM_HTTP', `Upstream returned HTTP ${response.status} (${new URL(url).hostname}).`);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new UpstreamError('UPSTREAM_SIZE', 'Upstream JSON exceeds 2 MiB.'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new UpstreamError('UPSTREAM_FORMAT', 'Upstream did not return valid JSON.'); }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new UpstreamError('UPSTREAM_TIMEOUT', `Upstream request timed out after ${timeoutMs} ms.`);
    throw new UpstreamError('UPSTREAM_NETWORK', `Cannot reach ${new URL(url).hostname}: ${error.cause?.code || error.message}`);
  }
}

class Cache {
  constructor(limit = 200, now = Date.now) { this.entries = new Map(); this.pending = new Map(); this.limit = limit; this.now = now; }
  async get(key, loader) {
    const cached = this.entries.get(key);
    if (cached && cached.expires > this.now()) return cached.value;
    this.entries.delete(key);
    if (this.pending.has(key)) return this.pending.get(key);
    const pending = Promise.resolve().then(loader).then(({ value, ttlSeconds }) => {
      if (ttlSeconds > 0) {
        while (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value);
        this.entries.set(key, { value, expires: this.now() + ttlSeconds * 1000 });
      }
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, pending);
    return pending;
  }
}

module.exports = { getJson, UpstreamError, Cache };
