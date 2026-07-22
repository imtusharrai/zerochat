import {
  Env,
  ClientMessage,
  StoredMessage,
  Sender,
  ConvState,
  VisitorType,
  IntentScore,
  FlowStep,
  BusinessConfig,
} from './types';
import { classifyMessage } from './classifier';
import { createForumTopic, sendToTopic, closeForumTopic, escapeTelegramHtml } from './telegram';

// Constants
const MAX_MESSAGES_PER_MINUTE = 30;
const MAX_MESSAGES_PER_DAY = 200;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_NAME_LENGTH = 32;
const AI_BUDGET_INITIAL = 8;
const AI_BUDGET_HOT = 15;
const HISTORY_LIMIT = 50;
const AI_HISTORY_LIMIT = 6; // Send last 6 messages to AI for better context
const AI_MAX_TOKENS = 250;
const CACHE_TTL_SECONDS = 3600; // 1 hour cache for AI responses
const CLEANUP_DAYS = 30;
const INACTIVE_HOURS = 24;

export class ChatRoom implements DurableObject {
  private ctx: DurableObjectState;
  private env: Env;
  private initialized = false;
  private businessContext: string | null = null;
  private businessConfig: BusinessConfig | null = null;
  private lastTimestamp = 0; // FIX #9: Monotonic timestamps

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  private initDB(): void {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL CHECK(sender IN ('customer', 'ai', 'owner', 'bot')),
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collected_info (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate_limit (
        window TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0
      );
    `);
    this.initialized = true;
  }

  // --- Meta helpers ---
  private getMeta(key: string): string | null {
    const row = this.ctx.storage.sql
      .exec('SELECT value FROM meta WHERE key = ?', key)
      .toArray()[0];
    return row ? (row.value as string) : null;
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      key,
      value
    );
  }

  private getConvState(): ConvState {
    return (this.getMeta('conv_state') as ConvState) ?? 'classifying';
  }

  private getVisitorType(): VisitorType {
    return (this.getMeta('visitor_type') as VisitorType) ?? 'unknown';
  }

  private getIntentScore(): IntentScore {
    return (this.getMeta('intent_score') as IntentScore) ?? 'unscored';
  }

  private getAIBudget(): number {
    return parseInt(this.getMeta('ai_budget') ?? String(AI_BUDGET_INITIAL), 10);
  }

  private getAIRepliesUsed(): number {
    return parseInt(this.getMeta('ai_replies_used') ?? '0', 10);
  }

  private getFlowStep(): FlowStep {
    return (this.getMeta('flow_step') as FlowStep) ?? 'ask_name';
  }

  private getThreadId(): number | null {
    const val = this.getMeta('thread_id');
    return val ? parseInt(val, 10) : null;
  }

  // --- Rate limiting ---
  private checkRateLimit(): { allowed: boolean; message?: string } {
    const now = new Date();
    const minuteWindow = `min:${now.toISOString().slice(0, 16)}`;
    const dayWindow = `day:${now.toISOString().slice(0, 10)}`;

    // Get or initialize minute count
    let minuteRow = this.ctx.storage.sql
      .exec('SELECT count FROM rate_limit WHERE window = ?', minuteWindow)
      .toArray()[0];
    const minuteCount = minuteRow ? (minuteRow.count as number) : 0;

    // Get or initialize day count
    let dayRow = this.ctx.storage.sql
      .exec('SELECT count FROM rate_limit WHERE window = ?', dayWindow)
      .toArray()[0];
    const dayCount = dayRow ? (dayRow.count as number) : 0;

    if (minuteCount >= MAX_MESSAGES_PER_MINUTE) {
      return { allowed: false, message: 'Too many messages. Please slow down.' };
    }
    if (dayCount >= MAX_MESSAGES_PER_DAY) {
      return {
        allowed: false,
        message: 'Daily message limit reached. Please try again tomorrow.',
      };
    }

    // Increment counters
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO rate_limit (window, count) VALUES (?, ?)',
      minuteWindow,
      minuteCount + 1
    );
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO rate_limit (window, count) VALUES (?, ?)',
      dayWindow,
      dayCount + 1
    );

    // Clean up old windows
    this.ctx.storage.sql.exec(
      "DELETE FROM rate_limit WHERE window LIKE 'min:%' AND window < ?",
      minuteWindow
    );

    return { allowed: true };
  }

  // --- Business hours ---
  private async isWithinBusinessHours(): Promise<boolean> {
    if (!this.businessConfig) {
      await this.loadBusinessConfig();
    }
    if (!this.businessConfig?.hours) return true; // No hours configured = always open

    const { start, end, timezone, days } = this.businessConfig.hours;
    const now = new Date();

    // Get current time in business timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(
      parts.find((p) => p.type === 'hour')?.value ?? '0',
      10
    );
    const dayName = parts.find((p) => p.type === 'weekday')?.value ?? '';

    const dayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const dayNum = dayMap[dayName] ?? 0;

    if (days && !days.includes(dayNum)) return false;
    return hour >= start && hour < end;
  }

  // --- Load business context & config from KV ---
  private async loadBusinessContext(): Promise<string> {
    if (!this.businessContext) {
      this.businessContext =
        (await this.env.THREAD_MAP.get('business:context')) ??
        'You are a helpful sales assistant. Answer customer questions politely and accurately.';
    }
    return this.businessContext;
  }

  private async loadBusinessConfig(): Promise<BusinessConfig | null> {
    if (!this.businessConfig) {
      const raw = await this.env.THREAD_MAP.get('business:config');
      if (raw) {
        try {
          this.businessConfig = JSON.parse(raw) as BusinessConfig;
        } catch {
          console.error('Failed to parse business config');
        }
      }
    }
    return this.businessConfig;
  }

  // --- Save message to SQLite ---
  private saveMessage(sender: Sender, content: string): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO messages (sender, content) VALUES (?, ?)',
      sender,
      content
    );
  }

  // --- Get chat history ---
  private getHistory(limit = HISTORY_LIMIT): StoredMessage[] {
    const rows = this.ctx.storage.sql
      .exec(
        'SELECT id, sender, content, created_at FROM messages ORDER BY id DESC LIMIT ?',
        limit
      )
      .toArray();
    return (rows as unknown as StoredMessage[]).reverse();
  }

  // --- Broadcast to all connected WebSockets ---
  private broadcast(data: Record<string, unknown>): void {
    const sockets = this.ctx.getWebSockets();
    const msg = JSON.stringify(data);
    for (const ws of sockets) {
      try {
        ws.send(msg);
      } catch {
        // Socket may have closed
      }
    }
  }

  // --- Send a typing indicator ---
  private sendTyping(): void {
    this.broadcast({ type: 'typing' });
  }

  // --- Ensure Telegram Forum Topic exists ---
  private async ensureForumTopic(customerName: string): Promise<number | null> {
    let threadId = this.getThreadId();
    if (threadId) return threadId;

    const now = new Date();
    const timeStr = now.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const topicName = `${customerName} — ${timeStr}`;

    threadId = await createForumTopic(
      this.env.TELEGRAM_CHAT_ID,
      topicName,
      this.env.TELEGRAM_BOT_TOKEN
    );

    if (threadId) {
      this.setMeta('thread_id', String(threadId));

      // Store mapping in KV for webhook reverse lookup
      await this.env.THREAD_MAP.put(
        `thread:${threadId}`,
        this.ctx.id.toString(),
        { expirationTtl: 86400 * 30 } // 30 days
      );
    } else {
      // Fallback for regular groups without topics enabled
      this.setMeta('thread_id', '0');
      threadId = 0;
    }

    return threadId;
  }

  // --- AI Response with caching ---
  private async getAIResponse(
    customerMessage: string,
    history: StoredMessage[]
  ): Promise<string | null> {
    // Check cache first (scoped by session to prevent cross-contamination)
    const sessionId = this.ctx.id.toString().slice(0, 8);
    const cacheKey = `cache:${sessionId}:${this.simpleHash(customerMessage)}`;
    const cached = await this.env.THREAD_MAP.get(cacheKey);
    if (cached) {
      return cached;
    }

    const context = await this.loadBusinessContext();
    const customerName = this.getMeta('customer_name') ?? 'there';
    const systemPrompt = `You are the AI sales assistant for Traiinc. Your name is "Traiinc AI". You are enthusiastic, confident, and genuinely helpful.

BUSINESS CONTEXT:
${context}

YOUR PERSONALITY & APPROACH:
- Greet the customer warmly by name ("${customerName}") if you know it.
- Be proactive: don't just answer questions — suggest products, highlight benefits, and guide the customer toward a purchase.
- Use a friendly, conversational tone with occasional emojis (but not excessive).
- When discussing products or services, emphasize unique value propositions and create excitement.
- If a customer seems interested, nudge them toward trying or buying with confidence (e.g., "You'll love this!" or "This is perfect for what you need!").
- Build trust by being knowledgeable and honest. If you don't know something, say: "Great question! Let me connect you with our product specialist who can give you the exact details."

OBJECTION HANDLING:
- When the customer says "No" or pushes back, NEVER treat it as a hard rejection. Acknowledge it gracefully and redirect to their core need. Example: "Got it, no worries! So what's the main thing you're looking for?"
- If a customer expresses frustration with process (forms, waiting, calls), immediately offer a low-friction alternative (e.g., quick info, self-serve options).
- If a customer compares you to competitors, focus on YOUR strengths — don't bash the competition.

FRUSTRATED / ANGRY USERS:
- Lead with empathy FIRST. Example: "I completely understand your frustration, and I'm sorry you're dealing with this."
- Never get defensive or argue. Stay calm and solution-focused.
- For refund requests or serious complaints, acknowledge the issue and immediately escalate: "I want to make sure this gets resolved properly. Let me connect you with our support team right away."
- Use the PIVOT technique: Acknowledge the problem → Offer a clear solution → Show them what's possible once it's fixed. This shifts their mindset from frustrated to interested.
- Don't force positivity. Be genuine and focused on solving their problem fast.

STAY IN CHARACTER:
- If the customer asks "what are you?" or "what type of agent are you?", answer in ONE short sentence and immediately redirect: "I'm your Traiinc AI assistant! Now, what can I help you find today?"
- NEVER break character to explain your own architecture, training, or how you work internally.
- Stay focused on the CUSTOMER's needs at all times. Every response should move the conversation forward.

RULES:
- Keep replies concise (2-3 sentences max). Be punchy and impactful. Never write a wall of text.
- Never invent product details, pricing, or features not provided in the context above.
- Never ask for personal information (name, email, phone) yourself. The system handles that separately.
- End every response with a question to keep the conversation going.
- At the VERY END of your response, on a new line, append exactly one of these hidden tags (the customer will NOT see it):
[INTENT:HOT] — Customer asked about specific products, pricing, quantities, or wants to buy.
[INTENT:WARM] — Customer is browsing or asking general questions.
[INTENT:COLD] — Customer seems off-topic (jobs, selling services, general info).`;

    // Build message history (last 3 only to save tokens)
    const aiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    const recentHistory = history.slice(-AI_HISTORY_LIMIT);
    for (const msg of recentHistory) {
      if (msg.sender === 'customer') {
        aiMessages.push({ role: 'user', content: msg.content });
      } else if (msg.sender === 'ai' || msg.sender === 'owner') {
        aiMessages.push({ role: 'assistant', content: msg.content });
      }
    }
    aiMessages.push({ role: 'user', content: customerMessage });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await (this.env.AI as any).run(
        '@cf/meta/llama-3.1-8b-instruct-fp8',
        {
          messages: aiMessages,
          max_tokens: AI_MAX_TOKENS,
        },
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      let text = '';
      if (typeof response === 'string') {
        text = response;
      } else if (response && typeof response.response === 'string') {
        text = response.response;
      }

      if (!text) return null;

      // Cache the response (without intent tag)
      const cleanText = text.replace(/\[INTENT:(HOT|WARM|COLD)\]/g, '').trim();
      await this.env.THREAD_MAP.put(cacheKey, cleanText, {
        expirationTtl: CACHE_TTL_SECONDS,
      });

      return text; // Return with intent tag for processing
    } catch (err) {
      console.error('AI call failed:', err);
      return null;
    }
  }

  private simpleHash(str: string): string {
    const normalized = str.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  // --- Extract intent tag from AI response ---
  private extractIntent(response: string): { text: string; intent: IntentScore } {
    const match = response.match(/\[INTENT:(HOT|WARM|COLD)\]/);
    const intent = match
      ? (match[1].toLowerCase() as IntentScore)
      : 'unscored';
    const text = response.replace(/\n?\[INTENT:(HOT|WARM|COLD)\]/g, '').trim();
    return { text, intent };
  }

  // --- Info collection flows ---
  // Returns the NEXT prompt to show and what key to save the user's CURRENT input under.
  private getInfoCollectionResponse(
    visitorType: VisitorType,
    step: FlowStep,
    _userInput: string
  ): { response: string; nextStep: FlowStep; saveKey?: string } {
    if (visitorType === 'job_seeker') {
      return this.jobSeekerFlow(step, _userInput);
    } else if (visitorType === 'vendor') {
      return this.vendorFlow(step, _userInput);
    } else if (visitorType === 'complaint') {
      return this.complaintFlow(step, _userInput);
    }

    // Default: generic info collection
    return this.genericInfoFlow(step, _userInput);
  }

  private jobSeekerFlow(
    step: FlowStep,
    _input: string
  ): { response: string; nextStep: FlowStep; saveKey?: string } {
    switch (step) {
      case 'ask_name':
        return {
          response:
            "Thanks for your interest in working with us! 😊\nLet me collect a few details so our team can review.\n\nWhat's your full name?",
          nextStep: 'ask_position',
        };
      case 'ask_position':
        return {
          response: `Hi ${this.getCollectedInfo('name') || 'there'}! What position are you interested in?`,
          nextStep: 'ask_email',
          saveKey: 'name',
        };
      case 'ask_email':
        return {
          response: "Got it! What's your email address?",
          nextStep: 'ask_phone',
          saveKey: 'position',
        };
      case 'ask_phone':
        return {
          response: 'And a phone number where we can reach you?',
          nextStep: 'done',
          saveKey: 'email',
        };
      case 'done':
        return {
          response: `Thanks ${this.getCollectedInfo('name') || ''}! 🙏 Your details have been shared with our team. If there's a suitable opening, we'll reach out within 3-5 days. Good luck!`,
          nextStep: 'done',
          saveKey: 'phone',
        };
      default:
        return { response: '', nextStep: 'done' };
    }
  }

  private vendorFlow(
    step: FlowStep,
    _input: string
  ): { response: string; nextStep: FlowStep; saveKey?: string } {
    switch (step) {
      case 'ask_name':
        return {
          response:
            "Thanks for reaching out! To connect you with the right person, could you share a few details?\n\nWhat's your company name?",
          nextStep: 'ask_product',
        };
      case 'ask_product':
        return {
          response: 'And what products or services do you offer?',
          nextStep: 'ask_email',
          saveKey: 'company',
        };
      case 'ask_email':
        return {
          response: "Great! What's your business email?",
          nextStep: 'done',
          saveKey: 'product',
        };
      case 'done':
        return {
          response:
            "Thanks! Our procurement team will review and reach out if there's a fit. Have a great day! 🙏",
          nextStep: 'done',
          saveKey: 'email',
        };
      default:
        return { response: '', nextStep: 'done' };
    }
  }

  private complaintFlow(
    step: FlowStep,
    _input: string
  ): { response: string; nextStep: FlowStep; saveKey?: string } {
    switch (step) {
      case 'ask_name':
        return {
          response:
            "I'm sorry to hear you're having an issue. Let me help!\n\nWhat's your order number or reference?",
          nextStep: 'ask_issue',
        };
      case 'ask_issue':
        return {
          response: 'Could you briefly describe the problem?',
          nextStep: 'ask_phone',
          saveKey: 'order_number',
        };
      case 'ask_phone':
        return {
          response:
            "I understand, that's frustrating. What's the best phone number to reach you for a quick resolution?",
          nextStep: 'done',
          saveKey: 'issue',
        };
      case 'done':
        return {
          response:
            "Thank you. I've flagged this as URGENT and our team will call you within the hour. We're sorry for the inconvenience! 🙏",
          nextStep: 'done',
          saveKey: 'phone',
        };
      default:
        return { response: '', nextStep: 'done' };
    }
  }

  private genericInfoFlow(
    step: FlowStep,
    _input: string
  ): { response: string; nextStep: FlowStep; saveKey?: string } {
    switch (step) {
      case 'ask_name':
        return {
          response:
            "I'd love to connect you with one of our specialists! 😊 Could you share your name?",
          nextStep: 'ask_email',
          saveKey: 'name',
        };
      case 'ask_email':
        return {
          response: `Great to meet you, ${this.getCollectedInfo('name') || 'there'}! 🎉 What's the best email to reach you at?`,
          nextStep: 'ask_phone',
          saveKey: 'email',
        };
      case 'ask_phone':
        return {
          response: 'Almost there! What\'s your phone number so our team can give you a quick call?',
          nextStep: 'done',
          saveKey: 'phone',
        };
      case 'done':
        return {
          response:
            "You're all set! 🎉 Our team will reach out to you very soon. We're excited to help you!",
          nextStep: 'done',
        };
      default:
        return { response: '', nextStep: 'done' };
    }
  }

  private getCollectedInfo(key: string): string | null {
    const row = this.ctx.storage.sql
      .exec('SELECT value FROM collected_info WHERE key = ?', key)
      .one();
    return row ? (row.value as string) : null;
  }

  private saveCollectedInfo(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO collected_info (key, value) VALUES (?, ?)',
      key,
      value
    );
  }

  private formatCollectedInfoForTelegram(): string {
    const info = this.ctx.storage.sql
      .exec('SELECT key, value FROM collected_info')
      .toArray() as Array<{ key: string; value: string }>;

    const visitorType = this.getVisitorType();
    const emoji: Record<string, string> = {
      job_seeker: '📋 Job Application',
      vendor: '📦 Vendor Inquiry',
      complaint: '🚨 URGENT Complaint',
      unknown: '📝 Contact Request',
    };

    let summary = `<b>${emoji[visitorType] || '📝 Info Collected'}</b>\n\n`;
    for (const { key, value } of info) {
      summary += `<b>${key.charAt(0).toUpperCase() + key.slice(1).replace('_', ' ')}:</b> ${escapeTelegramHtml(value)}\n`;
    }

    return summary;
  }

  // --- WebSocket Hibernation API handlers ---

  async fetch(request: Request): Promise<Response> {
    this.initDB();

    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const sessionId = url.searchParams.get('sessionId') ?? 'unknown';
      const customerName = (url.searchParams.get('name') ?? 'Guest').slice(0, MAX_NAME_LENGTH);

      // FIX #8: Close existing WebSocket connections for this session
      const existingSockets = this.ctx.getWebSockets();
      for (const existing of existingSockets) {
        try {
          const attachment = existing.deserializeAttachment() as Record<string, string> | null;
          if (attachment?.sessionId === sessionId) {
            existing.close(1000, 'New connection opened');
          }
        } catch {
          // Socket may already be closed
        }
      }

      // Accept with hibernation
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ sessionId, customerName });

      // FIX #10: Send connection confirmation immediately, but DEFER history
      // until after init message (queued in webSocketMessage)
      server.send(JSON.stringify({ type: 'connected', sessionId }));

      return new Response(null, { status: 101, webSocket: client });
    }

    // Handle owner reply (called by Worker on Telegram webhook)
    if (url.pathname === '/owner-reply' && request.method === 'POST') {
      // FIX V12: Verify internal auth — only the Worker can call this
      if (request.headers.get('X-Internal-Secret') !== this.env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }
      const body = (await request.json()) as { text: string };
      // FIX V17: Length limit on owner reply
      const text = (body.text || '').slice(0, MAX_MESSAGE_LENGTH);
      if (!text.trim()) return new Response('Empty', { status: 400 });
      await this.handleOwnerReply(text);
      return new Response('OK');
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // FIX #7: Wrap entire handler in try-catch to prevent DO crashes
    try {
      this.initDB();

      if (typeof message !== 'string') return;

      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(message) as ClientMessage;
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        return;
      }

      if (parsed.type === 'init') {
        // Store customer name (FIX #6: enforce length limit)
        if (parsed.customerName) {
          this.setMeta('customer_name', parsed.customerName.slice(0, MAX_NAME_LENGTH));
        }
        // FIX #10: Send history AFTER init (not on connect)
        const history = this.getHistory();
        if (history.length > 0) {
          ws.send(JSON.stringify({ type: 'history', messages: history }));
        }
        return;
      }

      if (parsed.type !== 'message' || !parsed.text?.trim()) return;

      const text = parsed.text.trim();

      // FIX #5: Message length validation
      if (text.length > MAX_MESSAGE_LENGTH) {
        ws.send(JSON.stringify({ type: 'error', message: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.` }));
        return;
      }

      // Rate limiting (per-session, supplementary to IP-based DO limiter)
      const rateCheck = this.checkRateLimit();
      if (!rateCheck.allowed) {
        ws.send(
          JSON.stringify({ type: 'rate_limited', message: rateCheck.message })
        );
        return;
      }

      const state = this.getConvState();

      // Save customer message with FIX #9: monotonic timestamp
      const now = Math.max(Date.now(), this.lastTimestamp + 1);
      this.lastTimestamp = now;
      this.saveMessage('customer', text);
      const nowIso = new Date(now).toISOString();

      // Echo customer message to all sockets
      this.broadcast({
        type: 'message',
        sender: 'customer',
        content: text,
        created_at: nowIso,
      });

      // Route based on conversation state
      // FIX #3: escapeTelegramHtml on user content sent to Telegram
      switch (state) {
        case 'classifying':
          await this.handleClassification(text);
          break;
        case 'ai_active':
          await this.handleAIConversation(text);
          break;
        case 'collecting_info':
          await this.handleInfoCollection(text);
          break;
        case 'handed_off':
          // Forward to Telegram with HTML-escaped user content
          await this.forwardToTelegram(`💬 Customer: ${escapeTelegramHtml(text)}`);
          break;
        case 'closed':
          this.sendBotMessage(
            'This conversation has ended. Please refresh to start a new one.'
          );
          // Also send error type so widget can auto-reset the session
          this.broadcast({ type: 'error', message: 'This conversation has ended.' });
          break;
      }

      // Update last activity time
      this.setMeta('last_activity', new Date().toISOString());

      // Set alarm for cleanup (24 hours)
      await this.ctx.storage.setAlarm(Date.now() + INACTIVE_HOURS * 60 * 60 * 1000);

    } catch (err) {
      // FIX #7: Catch all errors, send generic error to client, never expose stack
      console.error('webSocketMessage error:', err);
      try {
        ws.send(JSON.stringify({ type: 'error', message: 'Something went wrong. Please try again.' }));
      } catch {
        // WebSocket might be closed already
      }
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    // Nothing special needed — hibernation handles cleanup
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);
  }

  // --- Core routing logic ---

  private async handleClassification(text: string): Promise<void> {
    const visitorType = classifyMessage(text);
    this.setMeta('visitor_type', visitorType);

    const customerName = this.getMeta('customer_name') ?? 'Guest';

    switch (visitorType) {
      case 'spam':
        this.sendBotMessage(
          "Thanks for your message. We're not able to assist with this request. Have a good day!"
        );
        this.setMeta('conv_state', 'closed');
        break;

      case 'job_seeker':
      case 'vendor':
      case 'complaint': {
        this.setMeta('conv_state', 'collecting_info');
        this.setMeta('flow_step', 'ask_name');
        const { response } = this.getInfoCollectionResponse(
          visitorType,
          'ask_name',
          text
        );
        this.sendBotMessage(response);

        // Create Telegram topic for non-spam
        await this.ensureForumTopic(customerName);

        const emoji: Record<string, string> = {
          job_seeker: '📋',
          vendor: '📦',
          complaint: '🚨',
        };
        await this.forwardToTelegram(
          `${emoji[visitorType] || '📝'} <b>New ${visitorType.replace('_', ' ')}</b>\n\n💬 "${escapeTelegramHtml(text)}"`
        );
        break;
      }

      case 'sales':
      case 'unknown':
      default: {
        this.setMeta('conv_state', 'ai_active');
        this.setMeta('ai_budget', String(AI_BUDGET_INITIAL));
        this.setMeta('ai_replies_used', '0');

        // Create topic and start AI conversation
        await this.ensureForumTopic(customerName);
        await this.forwardToTelegram(`💬 Customer: ${escapeTelegramHtml(text)}`);
        await this.handleAIConversation(text);
        break;
      }
    }
  }

  private async handleAIConversation(text: string): Promise<void> {
    const budget = this.getAIBudget();
    const used = this.getAIRepliesUsed();

    // Check if within business hours
    const withinHours = await this.isWithinBusinessHours();

    // If budget exhausted, collect info and hand off
    if (used >= budget) {
      this.setMeta('conv_state', 'collecting_info');
      this.setMeta('flow_step', 'ask_name');

      const handoffMsg = withinHours
        ? "This has been a great chat! 🙌 I'd love to have one of our product specialists follow up with you personally. Could you share your name so I can connect you?"
        : "This has been a great chat! 🙌 Our team will be back online during business hours. Could you share your name so we can reach out to you?";

      this.sendBotMessage(handoffMsg);
      await this.forwardToTelegram(`💬 Customer: ${escapeTelegramHtml(text)}\n\n⚠️ AI budget exhausted — collecting info for handoff`);
      return;
    }

    // Send typing indicator
    this.sendTyping();

    // Forward customer message to Telegram
    if (used > 0) {
      // First message was already forwarded in handleClassification
      await this.forwardToTelegram(`💬 Customer: ${escapeTelegramHtml(text)}`);
    }

    // Get AI response
    const history = this.getHistory();
    const rawResponse = await this.getAIResponse(text, history);

    if (!rawResponse) {
      // AI failed — send auto-ack and rely on Telegram
      const ackMsg = withinHours
        ? "Thanks for your message! Our team will reply shortly. 😊"
        : "Thanks for your message! Our team will get back to you during business hours. 🙏";
      this.sendBotMessage(ackMsg);
      await this.forwardToTelegram('⚠️ AI failed to respond — needs human reply');
      return;
    }

    // Extract intent and clean response
    const { text: cleanResponse, intent } = this.extractIntent(rawResponse);

    // Save and broadcast AI response
    this.saveMessage('ai', cleanResponse);
    this.broadcast({
      type: 'message',
      sender: 'ai',
      content: cleanResponse,
      created_at: new Date().toISOString(),
    });

    // Forward AI response to Telegram so owner can monitor
    await this.forwardToTelegram(`🤖 AI replied: ${cleanResponse}`);

    // Update AI usage counter
    const newUsed = used + 1;
    this.setMeta('ai_replies_used', String(newUsed));

    // Update intent score and adjust budget
    if (intent !== 'unscored') {
      this.setMeta('intent_score', intent);

      if (intent === 'hot' && budget === AI_BUDGET_INITIAL) {
        this.setMeta('ai_budget', String(AI_BUDGET_HOT));
        await this.forwardToTelegram('🔥 HOT lead detected — expanded AI budget');
      } else if (intent === 'cold' && newUsed >= AI_BUDGET_INITIAL) {
        // Cold lead after initial budget — start collecting info
        this.setMeta('conv_state', 'collecting_info');
        this.setMeta('flow_step', 'ask_name');
        this.sendBotMessage(
          "I appreciate you chatting with me! 😊 Let me connect you with someone from our team who can help you further. What's your name?"
        );
      }
    }
  }

  private async handleInfoCollection(text: string): Promise<void> {
    const visitorType = this.getVisitorType();
    const currentStep = this.getFlowStep();

    // Forward every user message to Telegram immediately (Bug 2 fix)
    await this.forwardToTelegram(`💬 Customer: ${escapeTelegramHtml(text)}`);

    // Get the response config for the CURRENT step
    const { response, nextStep, saveKey } = this.getInfoCollectionResponse(
      visitorType,
      currentStep,
      text
    );

    // Save the user's input under the key for the CURRENT step (Bug 1 fix)
    if (saveKey) {
      this.saveCollectedInfo(saveKey, text);
    }

    if (currentStep === 'done') {
      // All info collected — send final message and summary to Telegram
      this.sendBotMessage(response);

      const summary = this.formatCollectedInfoForTelegram();
      await this.forwardToTelegram(summary);

      this.setMeta('conv_state', 'handed_off');
      return;
    }

    // Advance to the next step and send the next prompt
    this.setMeta('flow_step', nextStep);
    this.sendBotMessage(response);
  }

  // --- Handle owner reply from Telegram ---
  async handleOwnerReply(text: string): Promise<void> {
    this.initDB();

    // Switch to human-handled state
    this.setMeta('conv_state', 'handed_off');

    this.saveMessage('owner', text);
    this.broadcast({
      type: 'message',
      sender: 'owner',
      content: text,
      created_at: new Date().toISOString(),
    });

    this.setMeta('last_activity', new Date().toISOString());
  }

  // --- Helper: send bot message ---
  private sendBotMessage(text: string): void {
    this.saveMessage('bot', text);
    this.broadcast({
      type: 'message',
      sender: 'bot',
      content: text,
      created_at: new Date().toISOString(),
    });
  }

  // --- Helper: forward to Telegram ---
  private async forwardToTelegram(text: string): Promise<void> {
    const threadId = this.getThreadId();
    if (threadId === null) return;

    await sendToTopic(
      this.env.TELEGRAM_CHAT_ID,
      threadId,
      text,
      this.env.TELEGRAM_BOT_TOKEN
    );
  }

  // --- Alarm handler: cleanup and topic management ---
  async alarm(): Promise<void> {
    this.initDB();

    // Delete old messages (30 days)
    this.ctx.storage.sql.exec(
      "DELETE FROM messages WHERE created_at < datetime('now', ?)",
      `-${CLEANUP_DAYS} days`
    );

    // Clean old rate limit windows
    this.ctx.storage.sql.exec("DELETE FROM rate_limit WHERE window LIKE 'day:%' AND window < ?",
      `day:${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}`
    );

    // Check for inactivity and close topic
    const lastActivity = this.getMeta('last_activity');
    if (lastActivity) {
      const lastTime = new Date(lastActivity).getTime();
      const hoursAgo = (Date.now() - lastTime) / (1000 * 60 * 60);

      if (hoursAgo >= INACTIVE_HOURS) {
        const threadId = this.getThreadId();
        if (threadId) {
          await closeForumTopic(
            this.env.TELEGRAM_CHAT_ID,
            threadId,
            this.env.TELEGRAM_BOT_TOKEN
          );
        }
      } else {
        // Re-set alarm for remaining time
        const remainingMs = (INACTIVE_HOURS * 60 * 60 * 1000) - (hoursAgo * 60 * 60 * 1000);
        await this.ctx.storage.setAlarm(Date.now() + remainingMs);
      }
    }
  }
}
