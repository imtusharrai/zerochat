import { Env, TelegramUpdate } from './types';
import { ChatRoom } from './chatroom';
import { RateLimiter } from './ratelimiter';

export { ChatRoom, RateLimiter };

// CORS headers for cross-origin widget embedding
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Bot-Api-Secret-Token',
};

const SESSION_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function corsResponse(body: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// --- FIX #1: Global error handler (from official demo pattern) ---
async function handleErrors(request: Request, handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (err) {
    const errorMessage = 'Internal server error';
    console.error('Unhandled error:', err);

    if (request.headers.get('Upgrade') === 'websocket') {
      // For WebSocket requests, return a WebSocket with an error frame
      // so the client can see the error in devtools
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.send(JSON.stringify({ type: 'error', message: errorMessage }));
      server.close(1011, 'Uncaught exception during session setup');
      return new Response(null, { status: 101, webSocket: client });
    } else {
      // NEVER expose err.stack in production
      return corsResponse(JSON.stringify({ error: errorMessage }), 500);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // --- FIX #1: Wrap everything in global error handler ---
    return handleErrors(request, async () => {
      const url = new URL(request.url);

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // --- WebSocket upgrade: /ws ---
      if (url.pathname === '/ws') {
        if (request.headers.get('Upgrade') !== 'websocket') {
          return corsResponse('{"error":"Expected WebSocket"}', 426);
        }

        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId) {
          return corsResponse('{"error":"Missing sessionId"}', 400);
        }

        // --- FIX #4: Validate session ID format ---
        if (!SESSION_ID_REGEX.test(sessionId)) {
          return corsResponse('{"error":"Invalid sessionId format"}', 400);
        }

        // --- FIX #2: IP-based rate limiting (before reaching the DO) ---
        const clientIP = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
        const rateLimiterId = env.RATE_LIMITER.idFromName(clientIP);
        const rateLimiterStub = env.RATE_LIMITER.get(rateLimiterId);

        const rateLimitResponse = await rateLimiterStub.fetch('https://dummy', { method: 'POST' });
        const cooldown = parseFloat(await rateLimitResponse.text());

        if (cooldown > 0) {
          // Return a WebSocket that immediately sends a rate limit error and closes
          const pair = new WebSocketPair();
          const [client, server] = Object.values(pair);
          server.accept();
          server.send(JSON.stringify({
            type: 'rate_limited',
            message: `Too many connections. Please wait ${Math.ceil(cooldown)} seconds.`,
          }));
          server.close(1008, 'Rate limited');
          return new Response(null, { status: 101, webSocket: client });
        }

        // Route to Durable Object by session ID
        const id = env.CHAT_ROOM.idFromName(sessionId);
        const stub = env.CHAT_ROOM.get(id);

        // Forward the request to the Durable Object, passing IP for per-message rate limiting
        const doUrl = new URL(request.url);
        doUrl.searchParams.set('sessionId', sessionId);
        const name = url.searchParams.get('name') ?? 'Guest';
        doUrl.searchParams.set('name', name.slice(0, 32)); // FIX #6: Name length limit
        doUrl.searchParams.set('clientIP', clientIP);

        return stub.fetch(doUrl.toString(), request);
      }

      // --- Telegram Webhook: /webhook/telegram ---
      if (url.pathname === '/webhook/telegram') {
        if (request.method === 'GET') {
          return corsResponse('{"ok":true,"description":"Webhook is active"}');
        }
        if (request.method === 'POST') {
          return handleTelegramWebhook(request, env);
        }
      }

      // --- Health check ---
      if (url.pathname === '/api/health') {
        return corsResponse('{"status":"ok","service":"traiinc-chatbot"}');
      }

      // --- Setup webhook helper ---
      if (url.pathname === '/api/setup-webhook' && request.method === 'POST') {
        const auth = request.headers.get('Authorization');
        if (auth !== `Bearer ${env.TELEGRAM_WEBHOOK_SECRET}`) {
          return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
        }
        return handleSetupWebhook(request, env, url);
      }

      // All other routes: let Cloudflare Assets handle static files
      return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    });
  },
} satisfies ExportedHandler<Env>;

// --- Telegram Webhook Handler ---
async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  // Validate the secret token
  const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!secretHeader || secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
    console.error('Telegram webhook: invalid secret token');
    return corsResponse('{"error":"Unauthorized"}', 401);
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return corsResponse('{"error":"Invalid JSON"}', 400);
  }

  const message = update.message;
  if (!message?.text || !message.message_thread_id) {
    return corsResponse('{"ok":true}');
  }

  // Ignore messages from bots (including our own)
  if (message.from?.is_bot) {
    return corsResponse('{"ok":true}');
  }

  const threadId = message.message_thread_id;
  const replyText = message.text;

  // Look up which Durable Object session this thread belongs to
  let sessionId = await env.THREAD_MAP.get(`thread:${threadId}`);

  // --- FIX #11: Reduced retry delay (500ms instead of 2000ms) ---
  if (!sessionId) {
    for (let retry = 0; retry < 3; retry++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      sessionId = await env.THREAD_MAP.get(`thread:${threadId}`);
      if (sessionId) break;
    }
  }

  if (!sessionId) {
    console.error(`No session found for thread ${threadId} after retries`);
    return corsResponse('{"ok":true}');
  }

  // Forward the owner's reply to the Durable Object
  const id = env.CHAT_ROOM.idFromString(sessionId);
  const stub = env.CHAT_ROOM.get(id);

  try {
    await stub.fetch('https://internal/owner-reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.TELEGRAM_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ text: replyText }),
    });
  } catch (err) {
    console.error('Failed to forward owner reply to DO:', err);
  }

  return corsResponse('{"ok":true}');
}

// --- Setup Webhook Helper ---
async function handleSetupWebhook(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const body = (await request.json()) as { bot_token?: string };
  if (!body.bot_token || body.bot_token !== env.TELEGRAM_BOT_TOKEN) {
    return corsResponse('{"error":"Unauthorized"}', 401);
  }

  const workerUrl = `${url.protocol}//${url.host}`;
  const webhookUrl = `${workerUrl}/webhook/telegram`;

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message'],
      }),
    }
  );

  const data = await response.json();
  return corsResponse(JSON.stringify(data));
}
