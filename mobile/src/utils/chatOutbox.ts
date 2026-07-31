import AsyncStorage from "@react-native-async-storage/async-storage";

export type EncryptedEnvelope = {
  recipientUserId: number;
  recipientDeviceId: string;
  senderPublicKey: string;
  nonce: string;
  ciphertext: string;
};

export type EncryptedOutboxItem = {
  version: 1;
  userId: number;
  conversationId: string;
  clientMessageId: string;
  localMessageId: number;
  createdAt: string;
  envelopes: EncryptedEnvelope[];
  attempts: number;
  lastAttemptAt: string;
};

const outboxKey = (userId: number) => `fairfares.fchat.encrypted-outbox.${userId}`;

export function createOutboxClientMessageId(deviceId: string) {
  return `offline-${deviceId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`.slice(0, 120);
}

export function isRetryableChatNetworkError(error: unknown) {
  const status = Number((error as Error & { fairFaresHttpStatus?: number })?.fairFaresHttpStatus || 0);
  if (status) return status >= 500;
  const message = error instanceof Error ? error.message : String(error || "");
  return /network|failed to fetch|could not connect|temporarily unavailable|aborted|abort|timeout|internet connection|server at .* non-json/i.test(message);
}

export async function readEncryptedOutbox(userId: number): Promise<EncryptedOutboxItem[]> {
  if (!userId) return [];
  try {
    const stored = await AsyncStorage.getItem(outboxKey(userId));
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is EncryptedOutboxItem => Boolean(
      item && item.version === 1 && item.userId === userId && item.conversationId &&
      item.clientMessageId && Array.isArray(item.envelopes)
    ));
  } catch {
    return [];
  }
}

async function writeEncryptedOutbox(userId: number, items: EncryptedOutboxItem[]) {
  if (!items.length) {
    await AsyncStorage.removeItem(outboxKey(userId));
    return;
  }
  await AsyncStorage.setItem(outboxKey(userId), JSON.stringify(items));
}

export async function enqueueEncryptedMessage(item: EncryptedOutboxItem) {
  const items = await readEncryptedOutbox(item.userId);
  if (!items.some((current) => current.clientMessageId === item.clientMessageId)) items.push(item);
  await writeEncryptedOutbox(item.userId, items);
}

export async function updateEncryptedOutboxItem(userId: number, clientMessageId: string, update: Partial<EncryptedOutboxItem>) {
  const items = await readEncryptedOutbox(userId);
  await writeEncryptedOutbox(userId, items.map((item) => item.clientMessageId === clientMessageId ? { ...item, ...update } : item));
}

export async function removeEncryptedOutboxItem(userId: number, clientMessageId: string) {
  const items = await readEncryptedOutbox(userId);
  await writeEncryptedOutbox(userId, items.filter((item) => item.clientMessageId !== clientMessageId));
}
