// IP-based Rate Limiter Durable Object
// Modeled after the official Cloudflare workers-chat-demo pattern.
// One instance per IP address — rate limits are GLOBAL across all sessions.

export class RateLimiter implements DurableObject {
  private nextAllowedTime: number;
  private ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: unknown) {
    this.ctx = ctx;
    // Start in the distant past — the IP can act immediately.
    this.nextAllowedTime = 0;
  }

  async fetch(request: Request): Promise<Response> {
    const now = Date.now() / 1000;

    this.nextAllowedTime = Math.max(now, this.nextAllowedTime);

    if (request.method === 'POST') {
      // POST = the IP performed an action.
      // We allow one action per 2 seconds (30 msgs/min).
      this.nextAllowedTime += 2;
    }

    // Grace period of 20 seconds = burst of ~10 messages before limiting.
    const cooldown = Math.max(0, this.nextAllowedTime - now - 20);
    return new Response(String(cooldown));
  }
}

// Client-side helper for Workers to call the RateLimiter DO
export class RateLimiterClient {
  private getLimiterStub: () => DurableObjectStub;
  private inCooldown: boolean;

  constructor(getLimiterStub: () => DurableObjectStub) {
    this.getLimiterStub = getLimiterStub;
    this.inCooldown = false;
  }

  async checkLimit(): Promise<boolean> {
    if (this.inCooldown) return false;

    try {
      const stub = this.getLimiterStub();
      const response = await stub.fetch('https://dummy-url', { method: 'POST' });
      const cooldown = parseFloat(await response.text());

      if (cooldown > 0) {
        this.inCooldown = true;
        // Auto-reset after cooldown expires
        setTimeout(() => {
          this.inCooldown = false;
        }, cooldown * 1000);
        return false;
      }

      return true;
    } catch {
      // If rate limiter is unavailable, allow the request (fail open)
      return true;
    }
  }
}
