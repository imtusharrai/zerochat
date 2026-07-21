const TELEGRAM_API = 'https://api.telegram.org/bot';
const FETCH_TIMEOUT = 5000;

function makeUrl(token: string, method: string): string {
  return `${TELEGRAM_API}${token}/${method}`;
}

// Escape HTML entities to prevent injection attacks in Telegram messages
export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function telegramFetch(
  url: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = (await response.json()) as Record<string, unknown>;

    // Handle rate limiting
    if (response.status === 429) {
      const params = data.parameters as Record<string, unknown> | undefined;
      const retryAfter = (params?.retry_after as number) ?? 5;
      console.warn(`Telegram rate limited. Retrying after ${retryAfter}s`);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      const retryResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return retryResponse.json() as Promise<Record<string, unknown>>;
    }

    if (!response.ok) {
      console.error(`Telegram API error: ${response.status}`, data);
    }

    return data;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error('Telegram API call timed out');
    } else {
      console.error('Telegram API error:', err);
    }
    return { ok: false, error: String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function createForumTopic(
  chatId: string,
  name: string,
  token: string
): Promise<number | null> {
  const url = makeUrl(token, 'createForumTopic');
  const data = await telegramFetch(url, {
    chat_id: chatId,
    name: name.slice(0, 128),
  });

  if (data.ok && data.result) {
    return (data.result as Record<string, unknown>)
      .message_thread_id as number;
  }
  console.error('Failed to create forum topic:', data);
  return null;
}

export async function sendToTopic(
  chatId: string,
  threadId: number,
  text: string,
  token: string
): Promise<number | null> {
  const url = makeUrl(token, 'sendMessage');
  const data = await telegramFetch(url, {
    chat_id: chatId,
    message_thread_id: threadId,
    text,
    parse_mode: 'HTML',
  });

  if (data.ok && data.result) {
    return (data.result as Record<string, unknown>).message_id as number;
  }
  return null;
}

export async function closeForumTopic(
  chatId: string,
  threadId: number,
  token: string
): Promise<boolean> {
  const url = makeUrl(token, 'closeForumTopic');
  const data = await telegramFetch(url, {
    chat_id: chatId,
    message_thread_id: threadId,
  });
  return data.ok === true;
}

export async function setWebhook(
  workerUrl: string,
  secretToken: string,
  botToken: string
): Promise<boolean> {
  const url = makeUrl(botToken, 'setWebhook');
  const data = await telegramFetch(url, {
    url: `${workerUrl}/webhook/telegram`,
    secret_token: secretToken,
    allowed_updates: ['message'],
  });
  return data.ok === true;
}
