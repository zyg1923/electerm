/**
 * Token bucket rate limiter (bytes/sec). 0 = unlimited.
 */
export class TokenBucket {
  constructor (bytesPerSec = 0) {
    this.rate = Math.max(0, bytesPerSec)
    this.tokens = this.rate
    this.last = Date.now()
  }

  async take (n) {
    if (!this.rate || n <= 0) return
    while (true) {
      const now = Date.now()
      const elapsed = (now - this.last) / 1000
      this.last = now
      this.tokens = Math.min(this.rate, this.tokens + elapsed * this.rate)
      if (this.tokens >= n) {
        this.tokens -= n
        return
      }
      const need = n - this.tokens
      const waitMs = Math.ceil((need / this.rate) * 1000)
      await new Promise(r => setTimeout(r, Math.min(Math.max(waitMs, 20), 1000)))
    }
  }
}

/**
 * Global + per-host bandwidth gate used by distribute/relay.
 */
export class BandwidthGate {
  constructor ({ hostLimit = 0, totalLimit = 0 } = {}) {
    this.total = new TokenBucket(totalLimit > 0 ? totalLimit * 1024 : 0)
    this.hostLimit = hostLimit > 0 ? hostLimit * 1024 : 0
    this.hosts = new Map()
  }

  _host (id) {
    if (!this.hosts.has(id)) {
      this.hosts.set(id, new TokenBucket(this.hostLimit))
    }
    return this.hosts.get(id)
  }

  async take (hostId, bytes) {
    await this.total.take(bytes)
    await this._host(hostId).take(bytes)
  }
}
