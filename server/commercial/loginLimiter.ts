/** Per transport peer, not per untrusted Forwarded/X-Forwarded-For header.
 * Clients behind the same proxy/NAT share a bucket until trusted proxy handling is configured.
 */
export class PeerLoginLimiter {
  private readonly peers = new Map<string, { count: number; expires: number }>();
  private nextSweep = 0;

  constructor(private readonly limit: number, private readonly windowMs = 60_000,
    private readonly maxPeers = 1024, private readonly now: () => number = Date.now) {
    if (![limit, windowMs, maxPeers].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Invalid login limit.');
    }
  }

  private bucket(address?: string) {
    const time = this.now();
    const sweep = () => {
      for (const [key, value] of this.peers) if (value.expires <= time) this.peers.delete(key);
    };
    if (time >= this.nextSweep) { sweep(); this.nextSweep = time + this.windowMs; }
    const key = address?.toLowerCase().replace(/^::ffff:/, '') || '<unknown>';
    let bucket = this.peers.get(key);
    if (bucket && bucket.expires <= time) { this.peers.delete(key); bucket = undefined; }
    if (!bucket) {
      if (this.peers.size >= this.maxPeers) sweep();
      // Never evict a live bucket: that would let new peers reset an existing limit.
      if (this.peers.size >= this.maxPeers) return undefined;
      bucket = { count: 0, expires: time + this.windowMs };
      this.peers.set(key, bucket);
    }
    return bucket;
  }

  isBlocked(address?: string) {
    const bucket = this.bucket(address);
    return !bucket || bucket.count >= this.limit;
  }

  recordFailure(address?: string) {
    const bucket = this.bucket(address);
    if (bucket) bucket.count = Math.min(this.limit, bucket.count + 1);
  }

  take(address?: string) {
    const bucket = this.bucket(address);
    if (!bucket || bucket.count >= this.limit) return false;
    bucket.count++;
    return true;
  }
}
