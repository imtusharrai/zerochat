// Environment bindings
export interface Env {
  CHAT_ROOM: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  THREAD_MAP: KVNamespace;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_CHAT_ID: string;
}

// WebSocket message types (client -> server)
export type ClientMessage =
  | { type: 'init'; sessionId: string; customerName?: string }
  | { type: 'message'; text: string };

// WebSocket message types (server -> client)
export type ServerMessage =
  | { type: 'connected'; sessionId: string }
  | { type: 'history'; messages: StoredMessage[] }
  | { type: 'message'; sender: Sender; content: string; created_at: string }
  | { type: 'typing' }
  | { type: 'error'; message: string }
  | { type: 'rate_limited'; message: string };

export type Sender = 'customer' | 'ai' | 'owner' | 'bot';

export interface StoredMessage {
  id: number;
  sender: Sender;
  content: string;
  created_at: string;
}

export type ConvState = 'classifying' | 'ai_active' | 'collecting_info' | 'handed_off' | 'closed';
export type VisitorType = 'sales' | 'job_seeker' | 'vendor' | 'complaint' | 'spam' | 'unknown';
export type IntentScore = 'hot' | 'warm' | 'cold' | 'unscored';

export type FlowStep =
  | 'ask_name' | 'ask_email' | 'ask_phone' | 'ask_position'
  | 'ask_company' | 'ask_product' | 'ask_order_number' | 'ask_issue'
  | 'done';

export interface BusinessConfig {
  name: string;
  hours: {
    start: number;
    end: number;
    timezone: string;
    days: number[];
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; is_bot: boolean };
    chat: { id: number; type: string };
    text?: string;
    message_thread_id?: number;
    reply_to_message?: { message_id: number };
  };
}
