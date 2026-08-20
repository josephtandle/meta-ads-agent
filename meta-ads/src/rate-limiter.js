const STALE_THRESHOLD_MS = 5 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RateLimiter {
  constructor(minDelayMs = 200, throttleThreshold = 75) {
    this.state = new Map();
    this.minDelay = minDelayMs;
    this.throttleThreshold = throttleThreshold;
    this.lastCallTime = 0;
    this.queue = Promise.resolve();
  }

  parseBucHeader(header) {
    if (!header) return;

    try {
      const parsed = JSON.parse(header);
      for (const [accountId, entries] of Object.entries(parsed)) {
        for (const entry of entries) {
          this.state.set(accountId, {
            callCount: entry.call_count,
            totalCputime: entry.total_cputime,
            totalTime: entry.total_time,
            estimatedRecovery: entry.estimated_time_to_regain_access,
            lastUpdated: Date.now(),
          });
        }
      }
    } catch {
      // Ignore malformed headers.
    }
  }

  waitIfNeeded() {
    const next = this.queue.then(() => this.doWait());
    this.queue = next.catch(() => {});
    return next;
  }

  async doWait() {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < this.minDelay) await sleep(this.minDelay - elapsed);

    for (const [accountId, state] of this.state) {
      if (now - state.lastUpdated > STALE_THRESHOLD_MS) {
        this.state.delete(accountId);
        continue;
      }
      const maxUsage = Math.max(state.callCount, state.totalCputime, state.totalTime);
      if (maxUsage >= this.throttleThreshold) {
        const waitTime = Math.max(state.estimatedRecovery * 1000, 1000);
        await sleep(Math.min(waitTime, 30000));
      }
    }

    this.lastCallTime = Date.now();
  }

  isThrottled() {
    const now = Date.now();
    for (const state of this.state.values()) {
      if (now - state.lastUpdated > STALE_THRESHOLD_MS) continue;
      if (Math.max(state.callCount, state.totalCputime, state.totalTime) >= this.throttleThreshold) return true;
    }
    return false;
  }

  getStatus() {
    return Object.fromEntries(this.state);
  }
}

module.exports = { RateLimiter };
