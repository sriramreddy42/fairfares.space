import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Contacts from "expo-contacts";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import { BlurView } from "expo-blur";
import { useVideoPlayer, VideoView } from "expo-video";
import { Alert, Animated, FlatList, Image, Keyboard, Linking, Modal, PanResponder, Platform, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mapCoordinatesUrl, nativeMapProviderName } from "../utils/maps";
import {
  absoluteAssetUrl,
  addChatGroupMember,
  blockChatUser,
  createChatCommunity,
  createChatGroupInvite,
  confirmChatAttachmentDownloaded,
  getEncryptedChatAttachmentDownloadUrl,
  deleteChatMessage,
  editChatMessage,
  findChatPersonByPhone,
  findChatPeopleByContactHashes,
  getChatCommunities,
  getChatDeviceKeys,
  getChatEncryptedEnvelopes,
  getChatEncryptedPreviewEnvelopes,
  getChatGroupMembers,
  getChatLinkPreview,
  getChatConversations,
  getChatMessages,
  getAuthenticatedAssetDataUrl,
  downloadAuthenticatedAssetToFile,
  getAuthenticatedImagePreviewUri,
  joinChatCommunity,
  joinChatGroupInvite,
  previewChatGroupInvite,
  leaveChatGroup,
  muteChatConversation,
  openChatForRide,
  openChatForPost,
  openCommunityChat,
  openChatWithPerson,
  openIssuesAndSuggestionsChat,
  pollChatEvents,
  reportChatMessage,
  registerChatDeviceKey,
  reactToChatMessage,
  removeChatGroupMember,
  sendEncryptedChatMessage,
  sendDirectEncryptedChatAttachment,
  sendChatRichMessage,
  transferChatGroupOwnership,
  updateChatGroupPhoto,
  updateChatGroupMemberRole,
  updateChatTyping,
  voteChatPoll
} from "../api/client";
import type { ChatLinkPreview } from "../api/client";
import { appAssets } from "../assets";
import { DateTimeField, todayLocalIso } from "../components/DateTimeField";
import { theme } from "../theme";
import { BootstrapPayload, ChatConversation, ChatGroupMember, ChatMessage, Community, HousingPost, RidePost } from "../types";
import { pickChatMedia, pickCompressedImages, takeChatPhoto } from "../utils/imageUpload";
import { pickChatFile } from "../utils/fileUpload";
import { contactDiscoveryHash, contactDiscoveryVariants, decryptAttachmentBase64, decryptEnvelope, DeviceIdentity, encryptAttachmentForDevices, encryptForDevices, getOrCreateDeviceIdentity } from "../utils/chatCrypto";
import { createOutboxClientMessageId, EncryptedOutboxItem, enqueueEncryptedMessage, isRetryableChatNetworkError, readEncryptedOutbox, removeEncryptedOutboxItem, updateEncryptedOutboxItem } from "../utils/chatOutbox";
import { useNearbyRelay } from "../providers/NearbyRelayProvider";
import { AdaptiveGlassView } from "../components/AdaptiveGlassView";
import { cleanupPersistentChitthiMedia, copyPersistentChitthiMedia, persistentChitthiMediaExists, persistentChitthiMediaUri, writePersistentChitthiMedia } from "../utils/chitthiMediaStorage";
import { decryptChunkedAttachmentFile, deleteChunkedTemporaryFile, encryptAttachmentFileForDevices, parseChunkedAttachmentDescriptor } from "../utils/chitthiChunkedCrypto";

type Props = {
  data: BootstrapPayload | null;
  preferredSuggestionCity?: string;
  pendingPost: HousingPost | null;
  pendingRide: RidePost | null;
  pendingGroupInvite?: string;
  notificationConversationId?: string;
  onRequireLogin: () => void;
  onClearPendingPost?: () => void;
  onClearPendingRide?: () => void;
  onClearPendingGroupInvite?: () => void;
  onClearNotificationConversation?: () => void;
  onThreadModeChange?: (active: boolean) => void;
  onUnreadCountChange?: (count: number) => void;
  onCardMessageSent?: () => void;
};

type MessengerTab = "All" | "Unread" | "Groups" | "Communities" | "Contacts";

const blankGroup = { name: "" };
type PendingChatAttachment = { kind: "IMAGE" | "VIDEO" | "FILE"; uri: string; blob?: Blob; name: string; mimeType: string; size: number };
type ThreadMessageItem = {
  message: ChatMessage;
  index: number;
  skipForMediaGroup: boolean;
  mediaGroup: ChatMessage[];
  discoveredUrl: string;
  isPhotoMessage: boolean;
  messageRunEnds: boolean;
  replyTarget: ChatMessage | null;
  showDateDivider: boolean;
};
const CHAT_MESSAGE_CACHE_LIMIT = 50;
const WEB_CHAT_MESSAGE_CACHE_LIMIT = 20;
const CHAT_IMAGE_PREFETCH_LIMIT = 8;
const CHAT_IMAGE_MEMORY_CACHE_LIMIT = 80;
const unavailableEncryptedMessageText = "Encrypted message unavailable on this device. This was likely sent before this account or device had a Chitthi encryption key.";
const conversationKeyCacheName = (userId: number, conversationId: string) => `fairfares.chitthi.public-keys.${userId}.${conversationId}`;
const legacyConversationKeyCacheName = (userId: number, conversationId: string) => `fairfares.fchat.public-keys.${userId}.${conversationId}`;
const chatConversationCacheName = (userId: number) => `fairfares.chitthi.conversations.v1.${userId}`;
const legacyChatConversationCacheName = (userId: number) => `fairfares.fchat.conversations.v1.${userId}`;
const chatMessageCacheName = (userId: number, conversationId: string) => `fairfares.chitthi.messages.v1.${userId}.${conversationId}`;
const legacyChatMessageCacheName = (userId: number, conversationId: string) => `fairfares.fchat.messages.v1.${userId}.${conversationId}`;
const chatImagePreviewCache = new Map<string, string>();
const chatImagePreviewInflight = new Map<string, Promise<string>>();
const encryptedChatImagePreviewCache = new Map<string, string>();
const wallpaperChoices = [
  { id: "midnight", label: "Midnight", color: "#061713", accent: "#176B4A" },
  { id: "ocean", label: "Ocean", color: "#071E24", accent: "#147D78" },
  { id: "forest", label: "Forest", color: "#082019", accent: "#23815B" },
  { id: "plum", label: "Plum", color: "#211723", accent: "#7B546F" },
  { id: "sand", label: "Sand", color: "#17231E", accent: "#B78B4B" },
] as const;

const emojiGroups = [
  { id: "recent", label: "Recent", icon: "◷", emojis: ["❤️", "👍", "😂", "😊", "🙏", "🎉", "🔥", "😍"] },
  { id: "people", label: "Smileys", icon: "☺", emojis: ["😀", "😃", "😄", "😁", "😆", "🥹", "😅", "😂", "🙂", "😉", "😊", "😇", "🥰", "😍", "😘", "😋", "😜", "🤓", "😎", "🥳", "😏", "😔", "😢", "😭", "😤", "😡", "🤯", "😱", "🤔", "🫡", "🤫", "🫠"] },
  { id: "gestures", label: "Gestures", icon: "☝", emojis: ["👍", "👎", "👏", "🙌", "🫶", "🙏", "🤝", "💪", "👊", "✌️", "🤞", "👌", "👋", "🤟", "🫵", "✍️"] },
  { id: "animals", label: "Animals", icon: "♞", emojis: ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🦄"] },
  { id: "food", label: "Food", icon: "♨", emojis: ["🍎", "🍊", "🍋", "🍉", "🍇", "🍓", "🍒", "🥑", "🍕", "🍔", "🌮", "🍜", "🍩", "🍪", "☕", "🥤"] },
  { id: "travel", label: "Travel", icon: "◆", emojis: ["🚗", "🚕", "🚌", "🚆", "✈️", "🚀", "🚲", "🛵", "🏠", "🏙️", "🏖️", "🏔️", "🗺️", "📍", "🧳", "⛽"] },
  { id: "objects", label: "Objects", icon: "✦", emojis: ["💡", "📱", "💻", "⌚", "📷", "🎁", "🔑", "🛏️", "🛋️", "🚪", "💵", "💳", "📅", "✅", "❌", "🔒"] },
  { id: "symbols", label: "Symbols", icon: "#", emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💯", "✨", "🔥", "🎉", "⚠️", "❓", "❗", "♻️"] }
] as const;

const emojiSearchTerms: Record<string, string> = {
  "❤️": "heart love", "👍": "thumbs up yes", "👎": "thumbs down no", "😂": "laugh tears", "😊": "smile happy",
  "🙏": "please thanks prayer", "🎉": "party celebrate", "🔥": "fire", "😍": "love eyes", "📍": "location pin",
  "🚗": "car ride", "🏠": "home house", "🔑": "key rent", "📅": "calendar date", "✅": "check done yes"
};

function recentChatMessages(messages: ChatMessage[]) {
  const byId = new Map<number, ChatMessage>();
  messages.forEach((message) => {
    const id = Number(message.id);
    if (Number.isFinite(id)) byId.set(id, message);
  });
  return [...byId.values()]
    .sort((left, right) => chatDate(left.createdAt).getTime() - chatDate(right.createdAt).getTime() || Number(left.id) - Number(right.id))
    .slice(-(Platform.OS === "web" ? WEB_CHAT_MESSAGE_CACHE_LIMIT : CHAT_MESSAGE_CACHE_LIMIT));
}

function mergeChatMessages(existingMessages: ChatMessage[], incomingMessages: ChatMessage[]) {
  const byId = new Map<number, ChatMessage>();
  existingMessages.forEach((message) => {
    const id = Number(message.id);
    if (Number.isFinite(id)) byId.set(id, message);
  });
  incomingMessages.forEach((message) => {
    const id = Number(message.id);
    if (Number.isFinite(id)) byId.set(id, message);
  });
  return recentChatMessages([...byId.values()]);
}

function chatSortTimestamp(value: string) {
  if (!value) return 0;
  const normalized = value && !value.includes("T") ? value.replace(" ", "T") + "Z" : value;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : 0;
}

function recentChatConversations(conversations: ChatConversation[]) {
  const byId = new Map<string, ChatConversation>();
  conversations.forEach((conversation) => {
    if (conversation.id) byId.set(conversation.id, conversation);
  });
  return [...byId.values()]
    .sort((left, right) => chatSortTimestamp(right.lastMessageAt) - chatSortTimestamp(left.lastMessageAt))
    .slice(0, 50);
}

function mergeChatConversations(existingConversations: ChatConversation[], incomingConversations: ChatConversation[]) {
  const byId = new Map<string, ChatConversation>();
  existingConversations.forEach((conversation) => {
    if (conversation.id) byId.set(conversation.id, conversation);
  });
  incomingConversations.forEach((conversation) => {
    if (!conversation.id) return;
    byId.set(conversation.id, {
      ...byId.get(conversation.id),
      ...conversation
    });
  });
  return recentChatConversations([...byId.values()]);
}

async function readCachedChatConversations(userId: number) {
  if (!userId) return [];
  try {
    const stored = await AsyncStorage.getItem(chatConversationCacheName(userId)) || await AsyncStorage.getItem(legacyChatConversationCacheName(userId));
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    const conversations = Array.isArray(parsed?.conversations) ? parsed.conversations : Array.isArray(parsed) ? parsed : [];
    return recentChatConversations(conversations as ChatConversation[]);
  } catch {
    return [];
  }
}

async function writeCachedChatConversations(userId: number, conversations: ChatConversation[]) {
  if (!userId || !conversations.length) return;
  const recent = recentChatConversations(conversations);
  if (!recent.length) return;
  try {
    await AsyncStorage.setItem(chatConversationCacheName(userId), JSON.stringify({
      cachedAt: new Date().toISOString(),
      conversations: recent
    }));
  } catch {
    // Cache writes must never break the inbox.
  }
}

async function readCachedChatMessages(userId: number, conversationId: string) {
  if (!userId || !conversationId) return [];
  try {
    const stored = await AsyncStorage.getItem(chatMessageCacheName(userId, conversationId)) || await AsyncStorage.getItem(legacyChatMessageCacheName(userId, conversationId));
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : Array.isArray(parsed) ? parsed : [];
    return recentChatMessages(messages as ChatMessage[]);
  } catch {
    return [];
  }
}

async function writeCachedChatMessages(userId: number, conversationId: string, messages: ChatMessage[]) {
  if (!userId || !conversationId || !messages.length) return;
  const recent = recentChatMessages(messages).map(safeCachedChatMessage);
  if (!recent.length) return;
  try {
    await AsyncStorage.setItem(chatMessageCacheName(userId, conversationId), JSON.stringify({
      cachedAt: new Date().toISOString(),
      messages: recent
    }));
  } catch {
    // Web localStorage is small; cache failure should not affect chat rendering.
  }
}

function safeCachedChatMessage(message: ChatMessage): ChatMessage {
  const metadata = message.metadata ? { ...message.metadata } : undefined;
  if (metadata) {
    delete metadata.decryptedDataUrl;
    if (Platform.OS === "web") {
      delete metadata.encryptedKeyPayload;
    }
  }
  const cached: ChatMessage = {
    ...message,
    metadata
  };
  return cached;
}

function cacheableChatImageUrls(messages: ChatMessage[]) {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const message of [...messages].reverse()) {
    if (urls.length >= CHAT_IMAGE_PREFETCH_LIMIT) break;
    if (message.type !== "IMAGE" || !message.attachmentUrl || message.metadata?.encryptedKeyPayload) continue;
    if (seen.has(message.attachmentUrl)) continue;
    seen.add(message.attachmentUrl);
    urls.push(message.attachmentUrl);
  }
  return urls;
}

function rememberChatImagePreview(url: string, localUri: string) {
  chatImagePreviewCache.delete(url);
  chatImagePreviewCache.set(url, localUri);
  while (chatImagePreviewCache.size > CHAT_IMAGE_MEMORY_CACHE_LIMIT) {
    const oldestKey = chatImagePreviewCache.keys().next().value;
    if (!oldestKey) break;
    chatImagePreviewCache.delete(oldestKey);
  }
}

function stablePreviewHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function loadChatImagePreview(url: string) {
  const cached = chatImagePreviewCache.get(url);
  if (cached) return Promise.resolve(cached);
  const inflight = chatImagePreviewInflight.get(url);
  if (inflight) return inflight;
  const request = getAuthenticatedImagePreviewUri(url)
    .then((localUri) => {
      if (localUri) rememberChatImagePreview(url, localUri);
      return localUri;
    })
    .finally(() => {
      chatImagePreviewInflight.delete(url);
    });
  chatImagePreviewInflight.set(url, request);
  return request;
}

function encryptedPreviewExtension(keyPayload: string) {
  try {
    const payload = JSON.parse(keyPayload) as { mimeType?: string };
    if (payload.mimeType === "image/png") return "png";
    if (payload.mimeType === "image/webp") return "webp";
  } catch {
    // The decrypt step will surface invalid payloads if the preview is not cached.
  }
  return "jpg";
}

function encryptedPreviewCacheKey(attachmentUrl: string, keyPayload: string) {
  return `${attachmentUrl}:${stablePreviewHash(keyPayload)}`;
}

function encryptedPreviewLocalUri(attachmentUrl: string, keyPayload: string) {
  const cacheRoot = FileSystem.cacheDirectory;
  if (!cacheRoot) return "";
  const safeUrl = attachmentUrl.replace(/[^A-Za-z0-9]+/g, "-").slice(-64);
  return `${cacheRoot}chitthi-decrypted-${safeUrl}-${stablePreviewHash(keyPayload)}.${encryptedPreviewExtension(keyPayload)}`;
}

function encryptedAttachmentMetadata(keyPayload: string) {
  try {
    return JSON.parse(keyPayload) as { fileName?: string; mimeType?: string; kind?: "IMAGE" | "VIDEO" | "FILE" };
  } catch {
    return {};
  }
}

function attachmentFileExtension(fileName: string, mimeType: string) {
  const namedExtension = fileName.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase();
  if (namedExtension) return namedExtension;
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType.startsWith("video/")) return "mp4";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType.startsWith("image/")) return "jpg";
  if (mimeType === "application/pdf") return "pdf";
  return "bin";
}

function encryptedAttachmentLocalUri(userId: number, messageId: number, fileName: string, mimeType: string) {
  const extension = attachmentFileExtension(fileName, mimeType);
  return persistentChitthiMediaUri(userId, messageId, extension);
}

async function warmChatImagePreviewCache(messages: ChatMessage[]) {
  if (Platform.OS === "web") return;
  const urls = cacheableChatImageUrls(messages);
  await Promise.all(urls.map(async (url) => {
    if (chatImagePreviewCache.has(url)) return;
    try {
      await loadChatImagePreview(url);
    } catch {
      // Rendering still uses the authenticated native source; prefetch is best-effort only.
    }
  }));
}

function initials(label: string) {
  const clean = label.trim();
  if (!clean) return "F";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("") || "F";
}

function relativeTime(value: string) {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMinutes = Math.max(1, Math.round((Date.now() - then) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return `${Math.round(diffDays / 7)}w`;
}

function chatDate(value: string) {
  const normalized = value && !value.includes("T") ? value.replace(" ", "T") + "Z" : value;
  const date = new Date(normalized || Date.now());
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function chatDayKey(value: string) {
  const date = chatDate(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function chatDayLabel(value: string) {
  const date = chatDate(value);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (chatDayKey(value) === `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`) return "TODAY";
  if (chatDayKey(value) === `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`) return "YESTERDAY";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).toUpperCase();
}

function chatClock(value: string) {
  return chatDate(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function endsMessageRun(messages: ChatMessage[], index: number) {
  const message = messages[index];
  const next = messages[index + 1];
  if (!next || chatDayKey(message.createdAt) !== chatDayKey(next.createdAt)) return true;
  return message.mine !== next.mine || (!message.mine && message.senderId !== next.senderId);
}

function messageReceipt(status: ChatMessage["status"]) {
  if (status === "seen" || status === "delivered") return "✓✓";
  if (status === "sent") return "✓";
  if (status === "relayed") return "↗";
  if (status === "failed") return "!";
  if (status === "pending") return "◷";
  return "";
}

function messageReceiptLabel(status: ChatMessage["status"]) {
  if (status === "seen") return "Seen";
  if (status === "delivered") return "Delivered";
  if (status === "sent") return "Sent";
  if (status === "relayed") return "Passed to a nearby device";
  if (status === "failed") return "Not sent";
  if (status === "pending") return "Waiting for internet";
  return "";
}

function messageSelectionKey(message: ChatMessage) {
  return message.localClientMessageId || String(message.id);
}

function shareableMessageText(message: ChatMessage) {
  const prefix = message.senderName ? `${message.senderName}: ` : "";
  if (message.type === "IMAGE") return `${prefix}📷 ${message.text || "Photo"}`;
  if (message.type === "VIDEO") return `${prefix}🎥 ${message.text || "Video"}`;
  if (message.type === "FILE") return `${prefix}📎 ${message.metadata?.fileName || "File"}${message.text ? ` — ${message.text}` : ""}`;
  if (message.type === "POLL") return `${prefix}Poll: ${message.metadata?.question || message.text}`;
  if (message.type === "EVENT") return `${prefix}Event: ${message.metadata?.title || ""} ${message.metadata?.date || ""}`.trim();
  if (message.type === "CONTACT") return `${prefix}Contact: ${message.metadata?.name || ""} ${message.metadata?.phone || message.metadata?.email || ""}`.trim();
  return `${prefix}${message.text}`.trim();
}

function isEncryptedPlaceholder(value: string) {
  return /end-to-end encrypted message|sent you a secure message|new (?:chitthi|fchat) message/i.test(value || "");
}

function encryptedOverviewPreview(clearText: string) {
  if (!clearText) return "New message";
  if (clearText.startsWith("FFRICH:")) {
    try {
      const rich = JSON.parse(clearText.slice(7)) as { type?: string; metadata?: Record<string, unknown> };
      if (rich.type === "POLL") return `Poll: ${String(rich.metadata?.question || "New poll")}`;
      if (rich.type === "EVENT") return `Event: ${String(rich.metadata?.title || "New event")}`;
      if (rich.type === "CONTACT") return `Contact: ${String(rich.metadata?.name || "Shared contact")}`;
      if (rich.type === "LOCATION") return "Shared a location";
      return "New message";
    } catch {
      return "New message";
    }
  }
  if (clearText.startsWith("{")) {
    try {
      const attachment = JSON.parse(clearText) as { kind?: string; caption?: string; fileName?: string };
      if (attachment.kind === "IMAGE") return attachment.caption || "📷 Photo";
      if (attachment.kind === "VIDEO") return attachment.caption || "🎥 Video";
      if (attachment.kind === "FILE") return `📎 ${attachment.fileName || "File"}`;
    } catch {
      // A normal text message may begin with a brace.
    }
  }
  return clearText;
}

function safeConversationPreview(conversation: ChatConversation) {
  return isEncryptedPlaceholder(conversation.lastMessage)
    ? "📨 New Letter"
    : conversation.lastMessage || conversation.rideRoute || conversation.subject || "No messages yet.";
}

function discoveredMessageParts(value: string) {
  return value.split(/((?:(?:https?|fairfares):\/\/|www\.)[^\s<>]+)/gi).filter(Boolean).map((part) => {
    if (!/^(?:(?:https?|fairfares):\/\/|www\.)/i.test(part)) return { text: part, url: "", trailing: "" };
    const trailing = part.match(/[),.!?;:]+$/)?.[0] || "";
    const text = trailing ? part.slice(0, -trailing.length) : part;
    return { text, url: /^www\./i.test(text) ? `https://${text}` : text, trailing };
  });
}

function firstDiscoveredUrl(value: string) {
  return discoveredMessageParts(value).find((part) => part.url)?.url || "";
}

function websiteCardDetails(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "fairfares:") {
      return { host: "FairFares", label: "Private Chitthi group invitation", detail: "Open securely in the FairFares app" };
    }
    const host = parsed.hostname.replace(/^www\./i, "");
    if (/fairfare\.space$/i.test(host) && /^\/(?:chitthi|fchat)\/(?:invite|group)/i.test(parsed.pathname)) {
      return { host: "FairFares", label: "Chitthi group invitation", detail: "Open and confirm inside the app" };
    }
    const path = decodeURIComponent(parsed.pathname).replace(/\/$/, "");
    return {
      host: host || "Website",
      label: host || "Open website",
      detail: path && path !== "/" ? path : "Tap to visit this website"
    };
  } catch {
    return { host: "Website", label: "Open website", detail: value };
  }
}

function SwipeToReply({ children, onReply }: { children: React.ReactNode; onReply: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const displayedTranslateX = translateX.interpolate({ inputRange: [-1, 0, 70], outputRange: [0, 0, 58], extrapolate: "clamp" });
  const shouldClaimReplySwipe = (_event: unknown, gesture: { dx: number; dy: number }) =>
    gesture.dx > (Platform.OS === "web" ? 14 : 12) && Math.abs(gesture.dx) > Math.abs(gesture.dy) * (Platform.OS === "web" ? 1.8 : 1.7);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: shouldClaimReplySwipe,
    onPanResponderMove: Animated.event([null, { dx: translateX }], { useNativeDriver: false }),
    onPanResponderRelease: (_event, gesture) => {
      const shouldReply = gesture.dx >= 54 || (gesture.dx >= 30 && gesture.vx > 0.62);
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 280, mass: 0.65 }).start(({ finished }) => {
        if (finished && shouldReply) onReplyRef.current();
      });
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderTerminate: () => Animated.spring(translateX, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 280, mass: 0.65 }).start()
  }), [translateX]);
  return <View style={styles.swipeReplyWrap}><Animated.View style={[styles.swipeReplyBody, { transform: [{ translateX: displayedTranslateX }] }]} {...panResponder.panHandlers}>{children}</Animated.View></View>;
}

function WebsitePreviewCard({ url, mine, onOpen }: { url: string; mine: boolean; onOpen: () => void }) {
  const details = websiteCardDetails(url);
  const [preview, setPreview] = useState<ChatLinkPreview | null>(null);
  const isFairFaresInvitation = url.startsWith("fairfares:") || /fairfare\.space\/(?:(?:chitthi|fchat)\/)?(?:invite|group)/i.test(url);
  useEffect(() => {
    let cancelled = false;
    if (isFairFaresInvitation) return () => { cancelled = true; };
    void getChatLinkPreview(url)
      .then((payload) => { if (!cancelled) setPreview(payload.preview || null); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [url, isFairFaresInvitation]);
  const cardTitle = preview?.title || details.label;
  const cardHost = preview?.siteName || preview?.host || details.host;
  const cardDetail = preview?.description || details.detail;
  return (
    <TouchableOpacity
      style={[styles.websitePreviewCard, mine ? styles.myWebsitePreviewCard : styles.theirWebsitePreviewCard]}
      onPress={onOpen}
      accessibilityRole="link"
      accessibilityLabel={`Open ${cardTitle}`}
    >
      {preview?.imageUrl ? <Image source={{ uri: preview.imageUrl }} style={styles.websitePreviewImage} resizeMode="cover" /> : null}
      <View style={styles.websitePreviewContent}>
        <Text style={[styles.websitePreviewTitle, mine && styles.myWebsitePreviewText]} numberOfLines={2}>{cardTitle}</Text>
        {cardDetail ? <Text style={[styles.websitePreviewDetail, mine && styles.myWebsitePreviewDetail]} numberOfLines={2}>{cardDetail}</Text> : null}
        <View style={styles.websitePreviewSource}>
          {preview?.faviconUrl ? <Image source={{ uri: preview.faviconUrl }} style={styles.websitePreviewFavicon} resizeMode="contain" /> : <View style={styles.websitePreviewIcon}><Text style={styles.websitePreviewIconText}>↗</Text></View>}
          <Text style={[styles.websitePreviewHost, mine && styles.myWebsitePreviewText]} numberOfLines={1}>{cardHost}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function DiscoveredMessageText({ message, mine }: { message: string; mine: boolean }) {
  const textStyle = [styles.bubbleText, mine ? styles.myBubbleText : styles.theirBubbleText];
  return (
    <Text style={textStyle}>
      {discoveredMessageParts(message).map((part, index) => part.url ? (
        <React.Fragment key={`${part.url}-${index}`}>
          <Text
            style={[styles.discoveredLink, mine ? styles.myDiscoveredLink : styles.theirDiscoveredLink]}
            onPress={() => void Linking.openURL(part.url)}
            accessibilityRole="link"
            accessibilityLabel={`Open link ${part.text}`}
          >
            {part.text}
          </Text>
          {part.trailing || ""}
        </React.Fragment>
      ) : <React.Fragment key={`text-${index}`}>{part.text}</React.Fragment>)}
    </Text>
  );
}

function presenceLabel(conversation: ChatConversation | null) {
  if (!conversation) return "New conversation";
  if (conversation.communityId) return "Group chat";
  if (conversation.otherOnline) return "Active now";
  const lastSeen = relativeTime(conversation.otherLastSeenAt || "");
  return lastSeen ? `Active ${lastSeen} ago` : "Offline";
}

function listingPosterName(post: HousingPost | null) {
  return post?.posterName?.trim() || "Listing poster";
}

function rideContextLabel(ride: RidePost | null) {
  if (!ride) return "";
  return ride.title || [ride.origin, ride.destination].filter(Boolean).join(" -> ") || "FairFares ride";
}

function rideOwnerName(ride: RidePost | null) {
  return ride?.ownerName?.trim() || "Resolving member...";
}

function collapseLocationUpdates(messages: ChatMessage[]) {
  const seenSenders = new Set<number>();
  return [...messages].reverse().filter((message) => {
    if (message.type !== "LOCATION") return true;
    if (seenSenders.has(message.senderId)) return false;
    seenSenders.add(message.senderId);
    return true;
  }).reverse();
}

function chatPhotoUrl(value?: string) {
  return value ? absoluteAssetUrl(value) : "";
}

function chatFileBadge(name?: string, mimeType?: string) {
  const extension = String(name || "").split(".").pop()?.trim().toUpperCase() || "";
  if (extension && extension.length <= 4) return extension;
  if (String(mimeType || "").includes("pdf")) return "PDF";
  return "FILE";
}

function AuthenticatedChatImage({ attachmentUrl, compact = false }: { attachmentUrl: string; compact?: boolean }) {
  if (Platform.OS !== "web") {
    return <NativeAuthenticatedChatImage attachmentUrl={attachmentUrl} compact={compact} />;
  }
  return <WebAuthenticatedChatImage attachmentUrl={attachmentUrl} compact={compact} />;
}

function NativeAuthenticatedChatImage({ attachmentUrl, compact = false }: { attachmentUrl: string; compact?: boolean }) {
  const [cachedPreviewUri, setCachedPreviewUri] = useState(() => chatImagePreviewCache.get(attachmentUrl) || "");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(() => !chatImagePreviewCache.has(attachmentUrl));

  useEffect(() => {
    let cancelled = false;
    const cached = chatImagePreviewCache.get(attachmentUrl) || "";
    setPreviewFailed(false);
    setCachedPreviewUri(cached);
    setPreviewLoading(!cached);
    if (cached) return () => { cancelled = true; };
    void loadChatImagePreview(attachmentUrl)
      .then((localUri) => {
        if (!cancelled) setCachedPreviewUri(localUri);
      })
      .catch(() => {
        if (!cancelled) setPreviewFailed(true);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [attachmentUrl]);

  if (previewFailed) {
    return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Photo preview unavailable</Text></View>;
  }
  if (cachedPreviewUri) {
    return <AdaptiveChatImage uri={cachedPreviewUri} compact={compact} onError={() => setPreviewFailed(true)} />;
  }
  if (previewLoading) {
    return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Loading photo…</Text></View>;
  }
  return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Photo preview unavailable</Text></View>;
}

function WebAuthenticatedChatImage({ attachmentUrl, compact = false }: { attachmentUrl: string; compact?: boolean }) {
  const [previewSource, setPreviewSource] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreviewSource("");
    setPreviewFailed(false);
    getAuthenticatedImagePreviewUri(attachmentUrl)
      .then((uri) => {
        if (!cancelled) setPreviewSource(uri);
      })
      .catch(() => {
        if (!cancelled) setPreviewFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentUrl]);

  if (previewFailed) {
    return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Photo preview unavailable</Text></View>;
  }
  if (!previewSource) {
    return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Loading photo…</Text></View>;
  }
  return <AdaptiveChatImage uri={previewSource} compact={compact} onError={() => setPreviewFailed(true)} />;
}

function AdaptiveChatImage({ uri, source, compact = false, onError }: { uri?: string; source?: { uri: string; headers?: Record<string, string> }; compact?: boolean; onError?: () => void }) {
  return <Image source={source || { uri: uri || "" }} style={[styles.messageImage, compact && styles.collageImage]} resizeMode="cover" onError={onError} />;
}

function EncryptedChatImage({ attachmentUrl, keyPayload, compact = false }: { attachmentUrl: string; keyPayload: string; compact?: boolean }) {
  const previewCacheKey = encryptedPreviewCacheKey(attachmentUrl, keyPayload);
  const [uri, setUri] = useState(() => encryptedChatImagePreviewCache.get(previewCacheKey) || "");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const cachedUri = encryptedChatImagePreviewCache.get(previewCacheKey);
    if (cachedUri) {
      setUri(cachedUri);
      return () => { cancelled = true; };
    }

    void (async () => {
      try {
        if (Platform.OS !== "web") {
          const localUri = encryptedPreviewLocalUri(attachmentUrl, keyPayload);
          if (!localUri) throw new Error("Photo preview storage is unavailable.");
          const existing = await FileSystem.getInfoAsync(localUri);
          if (existing.exists && Number(existing.size || 0) > 0) {
            encryptedChatImagePreviewCache.set(previewCacheKey, localUri);
            if (!cancelled) setUri(localUri);
            return;
          }
        } else {
          setUri("");
        }

        const encryptedDataUrl = await getAuthenticatedAssetDataUrl(attachmentUrl);
        const decrypted = decryptAttachmentBase64(encryptedDataUrl.split(",", 2)[1] || "", keyPayload);
        let previewUri = `data:${decrypted.mimeType};base64,${decrypted.base64}`;
        if (Platform.OS !== "web") {
          previewUri = encryptedPreviewLocalUri(attachmentUrl, keyPayload);
          if (!previewUri) throw new Error("Photo preview storage is unavailable.");
          const existing = await FileSystem.getInfoAsync(previewUri);
          if (!existing.exists || Number(existing.size || 0) === 0) {
            await FileSystem.writeAsStringAsync(previewUri, decrypted.base64, { encoding: FileSystem.EncodingType.Base64 });
          }
        }
        encryptedChatImagePreviewCache.set(previewCacheKey, previewUri);
        if (!cancelled) setUri(previewUri);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [attachmentUrl, keyPayload, previewCacheKey]);
  if (failed) return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Encrypted preview unavailable</Text></View>;
  if (!uri) return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Decrypting photo…</Text></View>;
  return <AdaptiveChatImage uri={uri} compact={compact} />;
}

function PendingPhotoPreview({ uri, compact = false, full = false }: { uri: string; compact?: boolean; full?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <View style={[styles.pendingAttachmentImage, compact && styles.pendingCollageImage, full && styles.pendingFullPreviewImage, styles.pendingPreviewFallback]}><Text style={styles.pendingPreviewFallbackText}>No preview</Text></View>;
  return <Image source={{ uri }} style={[styles.pendingAttachmentImage, compact && styles.pendingCollageImage, full && styles.pendingFullPreviewImage]} resizeMode={full ? "contain" : "cover"} onError={() => setFailed(true)} />;
}

function ChatMessagePhoto({ message, compact = false }: { message: ChatMessage; compact?: boolean }) {
  if (message.metadata?.mediaExpired || !message.attachmentUrl) {
    return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Media expired</Text></View>;
  }
  if (message.metadata?.decryptedDataUrl) {
    return <AdaptiveChatImage uri={message.metadata.decryptedDataUrl} compact={compact} />;
  }
  if (message.metadata?.encryptedKeyPayload) {
    return <EncryptedChatImage attachmentUrl={message.attachmentUrl} keyPayload={message.metadata.encryptedKeyPayload} compact={compact} />;
  }
  return <AuthenticatedChatImage attachmentUrl={message.attachmentUrl} compact={compact} />;
}

function ChitthiVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => { instance.loop = false; instance.play(); });
  return <VideoView player={player} style={styles.attachmentPreviewVideo} nativeControls contentFit="contain" allowsFullscreen />;
}

function CircularDownloadProgress({ progress }: { progress: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress)));
  const segments = 24;
  const activeSegments = Math.ceil((percent / 100) * segments);
  return (
    <View style={styles.downloadProgressCircle} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
      {Array.from({ length: segments }, (_, index) => (
        <View
          key={index}
          style={[
            styles.downloadProgressSegment,
            index < activeSegments && styles.downloadProgressSegmentActive,
            { transform: [{ rotate: `${index * (360 / segments)}deg` }, { translateY: -25 }] }
          ]}
        />
      ))}
      <View style={styles.downloadProgressCenter}><Text style={styles.downloadProgressText}>{percent}%</Text></View>
    </View>
  );
}

export function MessengerScreen({ data, preferredSuggestionCity, pendingPost, pendingRide, pendingGroupInvite, notificationConversationId, onRequireLogin, onClearPendingPost, onClearPendingRide, onClearPendingGroupInvite, onClearNotificationConversation, onThreadModeChange, onUnreadCountChange, onCardMessageSent }: Props) {
  const safeAreaInsets = useSafeAreaInsets();
  const { enabled: nearbyRelayEnabled, status: nearbyRelayStatus, custodyVersion: nearbyCustodyVersion, toggle: toggleNearbyRelay } = useNearbyRelay();
  const signedIn = Boolean(data?.user);
  const currentUserId = Number(data?.user?.id || 0);
  const messagesScrollRef = useRef<FlatList<ThreadMessageItem>>(null);
  const composerRef = useRef<TextInput>(null);
  const activeConversationIdRef = useRef("");
  const messagesContentHeightRef = useRef(0);
  const messagesViewportHeightRef = useRef(0);
  const messagesScrollOffsetRef = useRef(0);
  const prependScrollAnchorRef = useRef<{ height: number; offset: number } | null>(null);
  const prependScrollSettleRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const latestScrollFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const loadingOlderMessagesRef = useRef(false);
  const messagesUserDraggingRef = useRef(false);
  const userTouchedThreadRef = useRef(false);
  const shouldAutoScrollToEndRef = useRef(true);
  const lastAutoScrolledMessageKeyRef = useRef("");
  const openingThreadToLatestRef = useRef(false);
  const openingThreadQuietUntilRef = useRef(0);
  const openingThreadSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpToLatestVisibleRef = useRef(false);
  const messagesConversationIdRef = useRef("");
  const outboxFlushRunning = useRef(false);
  const deviceRegistration = useRef<{ key: string; registeredAt: number } | null>(null);
  const deviceRegistrationPromise = useRef<Promise<void> | null>(null);
  const messengerRefreshVersion = useRef(0);
  const messengerLoaderVersion = useRef(0);
  const messengerUserIdRef = useRef(currentUserId);
  const messageCache = useRef(new Map<string, ChatMessage[]>());
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingLastSentAt = useRef(0);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const locationExpiresAt = useRef(0);
  const locationLastSentAt = useRef(0);
  const [tab, setTab] = useState<MessengerTab>("All");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<ChatConversation[]>(data?.chat.conversations || []);
  const [hasMoreConversations, setHasMoreConversations] = useState((data?.chat.conversations || []).length >= 30);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [communities, setCommunities] = useState<Community[]>(data?.communities || []);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [activeSubject, setActiveSubject] = useState(pendingPost?.title || rideContextLabel(pendingRide) || "");
  const [activeConversation, setActiveConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [jumpToLatestVisible, setJumpToLatestVisible] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [nextBeforeMessageId, setNextBeforeMessageId] = useState(0);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [typingPeople, setTypingPeople] = useState<Array<{ userId: number; name: string }>>([]);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [emojiGroup, setEmojiGroup] = useState("recent");
  const [recentEmojis, setRecentEmojis] = useState<string[]>(["❤️", "👍", "😂", "😊", "🙏", "🎉", "🔥", "😍"]);
  const [richComposer, setRichComposer] = useState<"POLL" | "EVENT" | "CONTACT" | "">("");
  const [richDraft, setRichDraft] = useState({ primary: "", secondary: "", tertiary: "", fourth: "" });
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollClosesInHours, setPollClosesInHours] = useState(24);
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [localMediaMessageIds, setLocalMediaMessageIds] = useState<number[]>([]);
  const [downloadingMediaMessageIds, setDownloadingMediaMessageIds] = useState<number[]>([]);
  const [mediaDownloadProgress, setMediaDownloadProgress] = useState<Record<number, number>>({});
  const [pendingAttachment, setPendingAttachment] = useState<PendingChatAttachment | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingChatAttachment[]>([]);
  const [pendingPhotoPreviewOpen, setPendingPhotoPreviewOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [attachmentPreview, setAttachmentPreview] = useState<{ uri: string; name: string; mimeType: string; messageId: number; type: "IMAGE" | "VIDEO"; createdAt: string } | null>(null);
  const [attachmentPreviewGroup, setAttachmentPreviewGroup] = useState<Array<{ uri: string; name: string; mimeType: string; createdAt: string }>>([]);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const [forwardPickerOpen, setForwardPickerOpen] = useState(false);
  const [selectedForwardConversationIds, setSelectedForwardConversationIds] = useState<string[]>([]);
  const [forwardingMessages, setForwardingMessages] = useState(false);
  const [wallpaperPanelOpen, setWallpaperPanelOpen] = useState(false);
  const [chatOptionsOpen, setChatOptionsOpen] = useState(false);
  const [groupMembersOpen, setGroupMembersOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState<ChatGroupMember[]>([]);
  const [groupMemberSearch, setGroupMemberSearch] = useState("");
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [wallpaper, setWallpaper] = useState("midnight");
  const [customWallpaper, setCustomWallpaper] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [contactMatches, setContactMatches] = useState<Array<{ id: number; name: string; localName: string; photoUrl: string }>>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [shareContactPickerOpen, setShareContactPickerOpen] = useState(false);
  const [shareableContacts, setShareableContacts] = useState<Array<{ id: string; name: string; phone: string; email: string }>>([]);
  const [contactPickerMode, setContactPickerMode] = useState<"chat" | "create" | "add">("chat");
  const [selectedGroupPeople, setSelectedGroupPeople] = useState<number[]>([]);
  const [addPeopleCommunityId, setAddPeopleCommunityId] = useState("");
  const [groupDraft, setGroupDraft] = useState(blankGroup);
  const [groupPhoto, setGroupPhoto] = useState("");
  const [feedbackCardDismissed, setFeedbackCardDismissed] = useState(false);
  const [groupSuggestionsDismissed, setGroupSuggestionsDismissed] = useState(false);
  const [suggestionCity, setSuggestionCity] = useState(data?.location.city || "");
  const suggestionRequestId = useRef(0);
  const inThread = signedIn && (Boolean(activeConversationId) || Boolean(pendingPost) || Boolean(pendingRide));
  const pendingChatContext = Boolean(pendingPost || pendingRide);
  const visibleMessages = useMemo(() => collapseLocationUpdates(messages), [messages]);
  const threadMessageItems = useMemo<ThreadMessageItem[]>(() => {
    const messageById = new Map<number, ChatMessage>();
    const mediaGroups = new Map<string, ChatMessage[]>();
    messages.forEach((message) => {
      messageById.set(Number(message.id), message);
    });
    visibleMessages.forEach((message) => {
      const mediaGroupId = String(message.metadata?.mediaGroupId || "");
      if (!mediaGroupId || message.type !== "IMAGE") return;
      const group = mediaGroups.get(mediaGroupId) || [];
      group.push(message);
      mediaGroups.set(mediaGroupId, group);
    });
    mediaGroups.forEach((group, key) => {
      mediaGroups.set(key, group.sort((a, b) => Number(a.metadata?.mediaGroupIndex || 0) - Number(b.metadata?.mediaGroupIndex || 0)));
    });
    return visibleMessages.map((message, index) => {
      const mediaGroupId = String(message.metadata?.mediaGroupId || "");
      const mediaGroup = mediaGroupId ? mediaGroups.get(mediaGroupId) || [] : [];
      return {
        message,
        index,
        skipForMediaGroup: Boolean(mediaGroupId && String(visibleMessages[index - 1]?.metadata?.mediaGroupId || "") === mediaGroupId),
        mediaGroup,
        discoveredUrl: message.text ? firstDiscoveredUrl(message.text) : "",
        isPhotoMessage: message.type === "IMAGE" && Boolean(message.attachmentUrl),
        messageRunEnds: mediaGroup.length > 1 || endsMessageRun(visibleMessages, index),
        replyTarget: message.replyToMessageId ? messageById.get(Number(message.replyToMessageId)) || null : null,
        showDateDivider: index === 0 || chatDayKey(visibleMessages[index - 1].createdAt) !== chatDayKey(message.createdAt)
      };
    }).reverse();
  }, [messages, visibleMessages]);
  const activeGroup = useMemo(
    () => communities.find((item) => item.id === activeConversation?.communityId) || null,
    [communities, activeConversation?.communityId]
  );
  const filteredGroupMembers = useMemo(() => {
    const query = groupMemberSearch.trim().toLowerCase();
    const roleRank: Record<ChatGroupMember["role"], number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
    return [...groupMembers]
      .sort((left, right) => Number(right.isCurrentUser) - Number(left.isCurrentUser) || roleRank[left.role] - roleRank[right.role] || left.name.localeCompare(right.name))
      .filter((member) => !query || member.name.toLowerCase().includes(query));
  }, [groupMembers, groupMemberSearch]);

  function scrollThreadToLatest(animated = false) {
    shouldAutoScrollToEndRef.current = true;
    userTouchedThreadRef.current = false;
    jumpToLatestVisibleRef.current = false;
    setJumpToLatestVisible(false);
    if (latestScrollFrameRef.current) cancelAnimationFrame(latestScrollFrameRef.current);
    latestScrollFrameRef.current = requestAnimationFrame(() => {
      messagesScrollRef.current?.scrollToOffset({ offset: 0, animated });
      latestScrollFrameRef.current = null;
    });
  }

  function updateJumpToLatestVisibility(offset: number) {
    const nextVisible = offset > 260;
    if (jumpToLatestVisibleRef.current === nextVisible) return;
    jumpToLatestVisibleRef.current = nextVisible;
    setJumpToLatestVisible(nextVisible);
  }

  function markThreadTouched() {
    userTouchedThreadRef.current = true;
    shouldAutoScrollToEndRef.current = false;
    cancelThreadLatestSettle();
  }

  function cancelThreadLatestSettle() {
    openingThreadToLatestRef.current = false;
    if (openingThreadSettleTimer.current) {
      clearTimeout(openingThreadSettleTimer.current);
      openingThreadSettleTimer.current = null;
    }
  }

  function finishThreadLatestLayout(delay = 60) {
    if (openingThreadSettleTimer.current) clearTimeout(openingThreadSettleTimer.current);
    openingThreadSettleTimer.current = setTimeout(() => {
      openingThreadToLatestRef.current = false;
      openingThreadSettleTimer.current = null;
    }, delay);
  }

  function prepareThreadForLatestLayout() {
    if (userTouchedThreadRef.current) return;
    openingThreadToLatestRef.current = true;
    openingThreadQuietUntilRef.current = Date.now() + 900;
    if (openingThreadSettleTimer.current) clearTimeout(openingThreadSettleTimer.current);
    shouldAutoScrollToEndRef.current = true;
    finishThreadLatestLayout(120);
  }

  async function loadCachedThreadMessages(conversationId: string) {
    const memoryMessages = messageCache.current.get(conversationId);
    if (memoryMessages?.length) return recentChatMessages(memoryMessages);
    const diskMessages = await readCachedChatMessages(currentUserId, conversationId);
    if (diskMessages.length) messageCache.current.set(conversationId, diskMessages);
    return diskMessages;
  }

  function showCachedThreadMessages(conversationId: string, cachedMessages: ChatMessage[]) {
    if (!cachedMessages.length) return false;
    prepareThreadForLatestLayout();
    replaceThreadMessages(conversationId, cachedMessages);
    setThreadLoading(false);
    return true;
  }

  function activateThreadConversation(conversationId: string) {
    activeConversationIdRef.current = conversationId;
    setActiveConversationId(conversationId);
  }

  function replaceThreadMessages(conversationId: string, nextMessages: ChatMessage[]) {
    if (activeConversationIdRef.current && activeConversationIdRef.current !== conversationId) return;
    messagesConversationIdRef.current = conversationId;
    setMessages(nextMessages);
  }

  function mergeThreadMessages(conversationId: string, incomingMessages: ChatMessage[]) {
    if (activeConversationIdRef.current && activeConversationIdRef.current !== conversationId) return;
    const sameConversation = messagesConversationIdRef.current === conversationId;
    messagesConversationIdRef.current = conversationId;
    setMessages((current) => {
      const baseMessages = sameConversation ? current : [];
      const merged = mergeChatMessages(baseMessages, incomingMessages);
      messageCache.current.set(conversationId, merged);
      return merged;
    });
  }

  function clearThreadMessages() {
    messagesConversationIdRef.current = "";
    setMessages([]);
  }

  function settlePrependedScroll(anchor: { height: number; offset: number }, nextHeight: number) {
    const targetY = Math.max(0, nextHeight - anchor.height + anchor.offset);
    messagesScrollRef.current?.scrollToOffset({ offset: targetY, animated: false });
    if (prependScrollSettleRef.current) cancelAnimationFrame(prependScrollSettleRef.current);
    prependScrollSettleRef.current = requestAnimationFrame(() => {
      messagesScrollRef.current?.scrollToOffset({ offset: targetY, animated: false });
      prependScrollSettleRef.current = null;
    });
  }

  useEffect(() => {
    if (!activeConversationId || messagesConversationIdRef.current !== activeConversationId) return;
    const recent = recentChatMessages(messages);
    messageCache.current.set(activeConversationId, recent);
    if (currentUserId && recent.length) void writeCachedChatMessages(currentUserId, activeConversationId, recent);
  }, [activeConversationId, currentUserId, messages]);

  useEffect(() => {
    if (!activeConversationId || messagesConversationIdRef.current !== activeConversationId || Platform.OS === "web") return;
    const recent = recentChatMessages(messages);
    if (!recent.length) return;
    void warmChatImagePreviewCache(recent);
  }, [activeConversationId, messages]);

  useEffect(() => {
    if (!currentUserId || !conversations.length) return;
    void writeCachedChatConversations(currentUserId, conversations);
  }, [conversations, currentUserId]);

  useEffect(() => {
    if (!currentUserId || Platform.OS === "web") return;
    void cleanupPersistentChitthiMedia().catch(() => undefined);
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId || Platform.OS === "web") {
      setLocalMediaMessageIds([]);
      return;
    }
    let cancelled = false;
    const mediaMessages = recentChatMessages(messages).filter((message) => ["IMAGE", "VIDEO", "FILE"].includes(message.type));
    void Promise.all(mediaMessages.map(async (message) => {
      let mimeType = message.metadata?.mimeType || "application/octet-stream";
      const encryptedMetadata = message.metadata?.encryptedKeyPayload ? encryptedAttachmentMetadata(message.metadata.encryptedKeyPayload) : {};
      if (encryptedMetadata.mimeType) mimeType = encryptedMetadata.mimeType;
      const fileName = safeAttachmentName({ ...message, metadata: { ...message.metadata, fileName: encryptedMetadata.fileName || message.metadata?.fileName } }, mimeType);
      const uri = encryptedAttachmentLocalUri(currentUserId, message.id, fileName, mimeType);
      return await persistentChitthiMediaExists(uri) ? message.id : 0;
    })).then((ids) => {
      if (!cancelled) setLocalMediaMessageIds(ids.filter((id) => id > 0));
    }).catch(() => {
      if (!cancelled) setLocalMediaMessageIds([]);
    });
    return () => { cancelled = true; };
  }, [currentUserId, messages]);

  useEffect(() => {
    let cancelled = false;
    const bootstrapConversations = data?.chat.conversations || [];
    const userChanged = messengerUserIdRef.current !== currentUserId;
    if (userChanged) {
      messengerUserIdRef.current = currentUserId;
      messageCache.current.clear();
      activeConversationIdRef.current = "";
      messagesConversationIdRef.current = "";
      userTouchedThreadRef.current = false;
      shouldAutoScrollToEndRef.current = true;
      setActiveConversationId("");
      setActiveConversation(null);
      setActiveSubject("");
      setMessages([]);
      setSelectedMessageIds([]);
      setActionMessage(null);
      setReplyingTo(null);
      deviceRegistration.current = null;
      deviceRegistrationPromise.current = null;
      setDeviceIdentity(null);
      setEncryptionReady(false);
      setConversations(bootstrapConversations);
    } else if (bootstrapConversations.length) {
      setConversations((current) => mergeChatConversations(current, bootstrapConversations));
    } else if (currentUserId) {
      void readCachedChatConversations(currentUserId).then((cachedConversations) => {
        if (!cancelled && cachedConversations.length) setConversations((current) => mergeChatConversations(current, cachedConversations));
      });
    }
    if (userChanged && !bootstrapConversations.length && currentUserId) {
      void readCachedChatConversations(currentUserId).then((cachedConversations) => {
        if (!cancelled) setConversations(cachedConversations);
      });
    }
    setHasMoreConversations(bootstrapConversations.length >= 30);
    // A later bootstrap refresh may contain the default/current-city groups.
    // Do not let that stale payload replace an explicit searched-city result.
    if (!String(preferredSuggestionCity || "").trim()) setCommunities(data?.communities || []);
    return () => { cancelled = true; };
  }, [currentUserId, data?.chat.conversations, data?.communities, preferredSuggestionCity]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardVisible(true);
      setKeyboardHeight(Math.max(0, event.endCoordinates?.height || 0));
      if (shouldAutoScrollToEndRef.current) scrollThreadToLatest(false);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    AsyncStorage.getItem("fairfares.chitthi.recent-emojis").then((stored) => stored || AsyncStorage.getItem("fairfares.fchat.recent-emojis"))
      .then((value) => { if (value) setRecentEmojis(JSON.parse(value).slice(0, 16)); })
      .catch(() => undefined);
    return () => {
      if (openingThreadSettleTimer.current) clearTimeout(openingThreadSettleTimer.current);
      if (prependScrollSettleRef.current) cancelAnimationFrame(prependScrollSettleRef.current);
      if (latestScrollFrameRef.current) cancelAnimationFrame(latestScrollFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const storageKey = `fairfares.chitthi.feedback-card-dismissed.${data?.user?.id || "guest"}`;
    AsyncStorage.getItem(storageKey)
      .then((value) => setFeedbackCardDismissed(value === "1"))
      .catch(() => setFeedbackCardDismissed(false));
  }, [data?.user?.id]);

  useEffect(() => {
    // Dismissal is intentionally session-only. A new account or detected city
    // should always get a fresh chance to discover its local public groups.
    setGroupSuggestionsDismissed(false);
  }, [data?.user?.id, suggestionCity]);

  useEffect(() => {
    let cancelled = false;
    const requestId = suggestionRequestId.current + 1;
    suggestionRequestId.current = requestId;
    const isCurrentRequest = () => !cancelled && suggestionRequestId.current === requestId;
    const searchedCity = String(preferredSuggestionCity || "").trim();
    const fallbackCity = searchedCity || data?.location.city || "";
    setSuggestionCity(fallbackCity);
    if (searchedCity) {
      // Keep joined/private groups available, but never display unjoined
      // suggestions from the previous city while the searched city loads.
      setCommunities((current) => current.filter((community) => community.joined || community.visibility === "PRIVATE"));
      void getChatCommunities(searchedCity)
        .then((nextCommunities) => { if (isCurrentRequest()) setCommunities(nextCommunities); })
        .catch(() => undefined);
      return () => { cancelled = true; };
    }
    if (Platform.OS === "web") return () => { cancelled = true; };
    void (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted || !isCurrentRequest()) return;
        const position = await Location.getLastKnownPositionAsync() || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!position || !isCurrentRequest()) return;
        const [address] = await Location.reverseGeocodeAsync(position.coords);
        const localCity = String(address?.city || address?.district || address?.subregion || "").trim();
        if (!localCity || !isCurrentRequest()) return;
        const nextCommunities = await getChatCommunities(localCity);
        if (!isCurrentRequest()) return;
        setSuggestionCity(localCity);
        setCommunities(nextCommunities);
      } catch {
        // The selected FairFares city remains the privacy-friendly fallback.
      }
    })();
    return () => { cancelled = true; };
  }, [data?.location.city, preferredSuggestionCity]);

  const visibleEmojis = useMemo(() => {
    const query = emojiSearch.trim().toLowerCase();
    const source = query
      ? Array.from(new Set(emojiGroups.flatMap((group) => [...group.emojis])))
      : emojiGroup === "recent"
        ? recentEmojis
        : [...(emojiGroups.find((group) => group.id === emojiGroup)?.emojis || [])];
    return query ? source.filter((emoji) => `${emoji} ${emojiSearchTerms[emoji] || ""}`.toLowerCase().includes(query)) : source;
  }, [emojiGroup, emojiSearch, recentEmojis]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
    if (activeConversationId) {
      userTouchedThreadRef.current = false;
      shouldAutoScrollToEndRef.current = true;
      lastAutoScrolledMessageKeyRef.current = "";
    }
  }, [activeConversationId]);

  useEffect(() => {
    if (!inThread || threadLoading || openingThreadToLatestRef.current || Date.now() < openingThreadQuietUntilRef.current || loadingOlderMessagesRef.current || messagesUserDraggingRef.current || userTouchedThreadRef.current) return;
    const lastMessage = visibleMessages[visibleMessages.length - 1];
    const messageKey = `${activeConversationId}:${lastMessage?.id || "empty"}:${visibleMessages.length}`;
    if (!lastMessage || messageKey === lastAutoScrolledMessageKeyRef.current || !shouldAutoScrollToEndRef.current) return;
    lastAutoScrolledMessageKeyRef.current = messageKey;
    scrollThreadToLatest(false);
  }, [activeConversationId, inThread, threadLoading, visibleMessages]);

  useEffect(() => {
    const userId = Number(data?.user?.id || 0);
    if (!userId) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const initialize = async () => {
      try {
        const identity = await getOrCreateDeviceIdentity(userId);
        if (cancelled) return;
        // Preserve the device key even if the network registration must retry.
        setDeviceIdentity(identity);
        await ensureDeviceRegistration(identity);
        if (activeConversationId) {
          const keyPayload = await getChatDeviceKeys(activeConversationId);
          if (!cancelled) setEncryptionReady(Boolean(keyPayload.ready));
        }
      } catch {
        if (!cancelled) retryTimer = setTimeout(() => void initialize(), 3000);
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [data?.user?.id]);

  async function ensureDeviceRegistration(identity: DeviceIdentity) {
    const registrationKey = `${Number(data?.user?.id || 0)}:${identity.deviceId}:${identity.publicKey}:${identity.signingPublicKey}`;
    const cached = deviceRegistration.current;
    if (cached?.key === registrationKey && Date.now() - cached.registeredAt < 5 * 60_000) return;
    if (deviceRegistrationPromise.current) {
      await deviceRegistrationPromise.current;
      const completed = deviceRegistration.current;
      if (completed?.key === registrationKey && Date.now() - completed.registeredAt < 5 * 60_000) return;
    }
    const pending = registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey)
      .then(() => {
        deviceRegistration.current = { key: registrationKey, registeredAt: Date.now() };
      })
      .finally(() => {
        if (deviceRegistrationPromise.current === pending) deviceRegistrationPromise.current = null;
      });
    deviceRegistrationPromise.current = pending;
    await pending;
  }

  async function ensureChatDeviceIdentity() {
    const userId = Number(data?.user?.id || 0);
    if (!userId) throw new Error("Sign in to use encrypted Chitthi.");
    const identity = deviceIdentity || await getOrCreateDeviceIdentity(userId);
    setDeviceIdentity(identity);
    try {
      await ensureDeviceRegistration(identity);
    } catch (error) {
      if (!isRetryableChatNetworkError(error)) throw error;
    }
    return identity;
  }

  async function getEncryptionKeysForSend(conversationId: string) {
    const userId = Number(data?.user?.id || 0);
    try {
      const payload = await getChatDeviceKeys(conversationId);
      if (payload.ready && payload.keys.length) {
        await AsyncStorage.setItem(conversationKeyCacheName(userId, conversationId), JSON.stringify(payload));
      }
      return payload;
    } catch (error) {
      if (!isRetryableChatNetworkError(error)) throw error;
      const cached = await AsyncStorage.getItem(conversationKeyCacheName(userId, conversationId)) || await AsyncStorage.getItem(legacyConversationKeyCacheName(userId, conversationId));
      if (!cached) throw error;
      return JSON.parse(cached) as Awaited<ReturnType<typeof getChatDeviceKeys>>;
    }
  }

  function queuedMessage(item: EncryptedOutboxItem, identity: DeviceIdentity): ChatMessage {
    const ownEnvelope = item.envelopes.find((envelope) => envelope.recipientDeviceId === identity.deviceId);
    const text = ownEnvelope ? decryptEnvelope(ownEnvelope, identity) : "Encrypted message waiting to send";
    return {
      id: item.localMessageId,
      senderId: Number(data?.user?.id || 0),
      senderName: data?.user?.name || "You",
      mine: true,
      type: "TEXT",
      text: text || "Encrypted message waiting to send",
      attachmentUrl: "",
      metadata: { encrypted: true },
      createdAt: item.createdAt,
      deliveredAt: "",
      readAt: "",
      editedAt: "",
      deletedAt: "",
      canEdit: false,
      status: item.relayedAt ? "relayed" : "pending",
      localClientMessageId: item.clientMessageId,
      replyToMessageId: item.replyToMessageId || 0
    };
  }

  async function flushEncryptedOutbox() {
    const userId = Number(data?.user?.id || 0);
    if (!userId || outboxFlushRunning.current) return;
    outboxFlushRunning.current = true;
    try {
      const identity = deviceIdentity || await getOrCreateDeviceIdentity(userId);
      await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
      const items = await readEncryptedOutbox(userId);
      for (const item of items) {
        const lastAttempt = Date.parse(item.lastAttemptAt || "") || 0;
        const retryDelay = Math.min(60_000, Math.max(3_000, 2 ** Math.min(item.attempts, 5) * 1_000));
        if (lastAttempt && Date.now() - lastAttempt < retryDelay) continue;
        try {
          const ownEnvelope = item.envelopes.find((envelope) => envelope.recipientDeviceId === identity.deviceId);
          const clearText = ownEnvelope ? decryptEnvelope(ownEnvelope, identity) : "";
          if (!clearText) throw new Error("This device cannot recover the queued encrypted message.");
          const keyPayload = await getChatDeviceKeys(item.conversationId);
          if (!keyPayload.ready) throw new Error(keyPayload.warning || "Encryption keys are not ready.");
          await AsyncStorage.setItem(conversationKeyCacheName(userId, item.conversationId), JSON.stringify(keyPayload));
          const refreshedEnvelopes = encryptForDevices(clearText, identity, keyPayload.keys);
          await updateEncryptedOutboxItem(userId, item.clientMessageId, { envelopes: refreshedEnvelopes, attempts: item.attempts + 1, lastAttemptAt: new Date().toISOString() });
          const response = await sendEncryptedChatMessage(item.conversationId, refreshedEnvelopes, item.clientMessageId, false, item.replyToMessageId || 0);
          await removeEncryptedOutboxItem(userId, item.clientMessageId);
          if (activeConversationId === item.conversationId) {
            setMessages((current) => {
              const withoutServerDuplicate = current.filter((message) => message.id !== response.message.id || message.localClientMessageId === item.clientMessageId);
              const hasLocal = withoutServerDuplicate.some((message) => message.localClientMessageId === item.clientMessageId);
              const sentMessage = { ...response.message, text: clearText, canEdit: response.message.canEdit, metadata: { ...response.message.metadata, encrypted: true } };
              return hasLocal
                ? withoutServerDuplicate.map((message) => message.localClientMessageId === item.clientMessageId ? sentMessage : message)
                : [...withoutServerDuplicate, sentMessage];
            });
          }
        } catch (error) {
          await updateEncryptedOutboxItem(userId, item.clientMessageId, { attempts: item.attempts + 1, lastAttemptAt: new Date().toISOString() });
          if (!isRetryableChatNetworkError(error)) {
            setMessages((current) => current.map((message) => message.localClientMessageId === item.clientMessageId ? { ...message, status: "failed" } : message));
          }
          if (isRetryableChatNetworkError(error)) break;
        }
      }
    } catch {
      // The timer retries when connectivity or device-key registration returns.
    } finally {
      outboxFlushRunning.current = false;
    }
  }

  async function prepareMessageDecryption(conversationId: string) {
    const identity = await ensureChatDeviceIdentity();
    const [envelopePayload, keyPayload] = await Promise.all([
      getChatEncryptedEnvelopes(conversationId, identity.deviceId), getChatDeviceKeys(conversationId)
    ]);
    return { identity, envelopePayload, keyPayload };
  }

  async function decryptMessages(
    conversationId: string,
    nextMessages: ChatMessage[],
    preparedContext?: ReturnType<typeof prepareMessageDecryption>
  ) {
    try {
      const { identity, envelopePayload, keyPayload } = await (preparedContext || prepareMessageDecryption(conversationId));
      setEncryptionReady(Boolean(keyPayload.ready));
      const byMessage = new Map(envelopePayload.envelopes.map((item) => [item.messageId, item]));
      return await Promise.all(nextMessages.map(async (message) => {
        const envelope = byMessage.get(message.id);
        if (!envelope) return message.text.includes("End-to-end encrypted message")
          ? { ...message, text: unavailableEncryptedMessageText, canEdit: false }
          : message;
        const clearText = decryptEnvelope(envelope, identity);
        if (message.type === "ENCRYPTED_ATTACHMENT" && (message.attachmentUrl || message.metadata?.mediaExpired) && clearText) {
          const attachmentInfo = JSON.parse(clearText) as { kind: "IMAGE" | "VIDEO" | "FILE"; caption?: string; fileName?: string; mimeType?: string; mediaGroupId?: string; mediaGroupIndex?: number; mediaGroupCount?: number };
          return {
            ...message,
            type: attachmentInfo.kind,
            text: attachmentInfo.caption || "",
            metadata: { ...message.metadata, encrypted: true, kind: attachmentInfo.kind, fileName: attachmentInfo.fileName, mimeType: attachmentInfo.mimeType, encryptedKeyPayload: clearText, caption: attachmentInfo.caption, mediaGroupId: attachmentInfo.mediaGroupId, mediaGroupIndex: attachmentInfo.mediaGroupIndex, mediaGroupCount: attachmentInfo.mediaGroupCount }
          };
        }
        if (clearText.startsWith("FFRICH:")) {
          const rich = JSON.parse(clearText.slice(7)) as { type: string; metadata: ChatMessage["metadata"] };
          return { ...message, type: rich.type, text: "", canEdit: false, metadata: { ...rich.metadata, encrypted: true } };
        }
        return { ...message, text: clearText || "Unable to decrypt this message on this device.", canEdit: Boolean(message.mine && message.canEdit), metadata: { ...message.metadata, encrypted: true } };
      }));
    } catch {
      setEncryptionReady(false);
      return nextMessages;
    }
  }

  async function decryptConversationPreviews(nextConversations: ChatConversation[]) {
    const encrypted = nextConversations.filter((conversation) => isEncryptedPlaceholder(conversation.lastMessage) && Number(conversation.lastMessageId || 0) > 0);
    if (!encrypted.length) return nextConversations;
    try {
      const identity = await ensureChatDeviceIdentity();
      const payload = await getChatEncryptedPreviewEnvelopes(
        encrypted.map((conversation) => Number(conversation.lastMessageId)),
        identity.deviceId
      );
      const envelopesByMessage = new Map(payload.envelopes.map((envelope) => [Number(envelope.messageId), envelope]));
      const resolved = encrypted.map((conversation) => {
        try {
          const envelope = envelopesByMessage.get(Number(conversation.lastMessageId));
          if (!envelope) return [conversation.id, "New encrypted message"] as const;
          return [conversation.id, encryptedOverviewPreview(decryptEnvelope(envelope, identity))] as const;
        } catch {
          return [conversation.id, "New encrypted message"] as const;
        }
      });
      const previewByConversation = new Map(resolved);
      return nextConversations.map((conversation) => ({
        ...conversation,
        lastMessage: previewByConversation.get(conversation.id) || safeConversationPreview(conversation)
      }));
    } catch {
      return nextConversations.map((conversation) => ({ ...conversation, lastMessage: safeConversationPreview(conversation) }));
    }
  }

  function updateMessagePagination(payload: { hasMore?: boolean; nextBefore?: number }) {
    const nextBefore = Math.max(0, Number(payload.nextBefore || 0));
    setHasMoreMessages(Boolean(payload.hasMore) && nextBefore > 0);
    setNextBeforeMessageId(nextBefore);
  }

  async function loadOlderMessages() {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId || !hasMoreMessages || !nextBeforeMessageId || loadingOlderMessagesRef.current) return;
    loadingOlderMessagesRef.current = true;
    setLoadingOlderMessages(true);
    try {
      const [payload, preparedDecryption] = await Promise.all([
        getChatMessages(conversationId, nextBeforeMessageId),
        prepareMessageDecryption(conversationId)
          .then((context) => ({ context }))
          .catch(() => ({ context: null }))
      ]);
      if (activeConversationIdRef.current !== conversationId) return;
      const olderMessages = preparedDecryption.context
        ? await decryptMessages(conversationId, payload.messages || [], Promise.resolve(preparedDecryption.context))
        : payload.messages || [];
      if (activeConversationIdRef.current !== conversationId) return;
      prependScrollAnchorRef.current = null;
      shouldAutoScrollToEndRef.current = false;
      setMessages((current) => {
        const byId = new Map<number, ChatMessage>();
        [...olderMessages, ...current].forEach((message) => byId.set(Number(message.id), message));
        const merged = [...byId.values()].sort((left, right) => Number(left.id) - Number(right.id));
        messageCache.current.set(conversationId, merged);
        return merged;
      });
      updateMessagePagination(payload);
    } catch (error) {
      Alert.alert("Could not load earlier messages", error instanceof Error ? error.message : "Please try again.");
    } finally {
      loadingOlderMessagesRef.current = false;
      setLoadingOlderMessages(false);
    }
  }

  useEffect(() => {
    const userId = Number(data?.user?.id || 0);
    if (!userId || !activeConversationId || !deviceIdentity) return;
    let cancelled = false;
    void readEncryptedOutbox(userId).then((items) => {
      if (cancelled) return;
      const queued = items.filter((item) => item.conversationId === activeConversationId).map((item) => queuedMessage(item, deviceIdentity));
      if (!queued.length) return;
      setMessages((current) => {
        const existing = new Set(current.map((message) => message.localClientMessageId).filter(Boolean));
        return [...current, ...queued.filter((message) => !existing.has(message.localClientMessageId))]
          .sort((a, b) => chatDate(a.createdAt).getTime() - chatDate(b.createdAt).getTime());
      });
    });
    return () => { cancelled = true; };
  }, [activeConversationId, deviceIdentity?.deviceId, data?.user?.id, messages.length, nearbyCustodyVersion]);

  useEffect(() => {
    if (!signedIn || !deviceIdentity) return;
    void flushEncryptedOutbox();
    const timer = setInterval(() => void flushEncryptedOutbox(), 5000);
    return () => clearInterval(timer);
  }, [signedIn, deviceIdentity?.deviceId, activeConversationId]);

  useEffect(() => {
    if (!pendingGroupInvite) return;
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    void confirmGroupInvitation(pendingGroupInvite);
  }, [pendingGroupInvite, signedIn]);

  useEffect(() => {
    if (!notificationConversationId || !signedIn) return;
    let cancelled = false;
    onThreadModeChange?.(true);
    setThreadLoading(true);
    void readCachedChatMessages(currentUserId, notificationConversationId).then((cachedMessages) => {
      if (cancelled || !cachedMessages.length) return;
      messageCache.current.set(notificationConversationId, cachedMessages);
      activateThreadConversation(notificationConversationId);
      showCachedThreadMessages(notificationConversationId, cachedMessages);
    });
    void getChatMessages(notificationConversationId)
      .then(async (payload) => {
        if (cancelled) return;
        if (activeConversationIdRef.current && activeConversationIdRef.current !== notificationConversationId) return;
        const conversation = payload.conversation;
        activateThreadConversation(notificationConversationId);
        setActiveConversation(conversation);
        setActiveSubject(conversation.subject || "Chitthi");
        const decryptedMessages = await decryptMessages(notificationConversationId, payload.messages || []);
        prepareThreadForLatestLayout();
        mergeThreadMessages(notificationConversationId, decryptedMessages);
        updateMessagePagination(payload);
        setConversations((current) => current.map((item) => item.id === notificationConversationId ? { ...item, unread: 0 } : item));
        onClearNotificationConversation?.();
      })
      .catch((error) => {
        if (!cancelled) Alert.alert("Could not open Chitthi", error instanceof Error ? error.message : "Please try again.");
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentUserId, notificationConversationId, signedIn]);

  useEffect(() => {
    if (pendingPost) {
      activateThreadConversation("");
      setActiveConversation(null);
      setActiveSubject(pendingPost.title);
      clearThreadMessages();
      setHasMoreMessages(false);
      setNextBeforeMessageId(0);
      setMessageText(`Hi, I am interested in ${pendingPost.title}. Is it still available?`);
      let cancelled = false;
      setThreadLoading(false);
      void openChatForPost(pendingPost.id)
        .then(async (response) => {
          if (cancelled) return;
          const conversation = response.conversation;
          activateThreadConversation(conversation.id);
          setActiveConversation(conversation);
          setActiveSubject(conversation.subject || pendingPost.title);
          const cachedMessages = await loadCachedThreadMessages(conversation.id);
          if (!cancelled) showCachedThreadMessages(conversation.id, cachedMessages);
          const payload = await getChatMessages(conversation.id, 0, 20);
          if (cancelled) return;
          if (activeConversationIdRef.current && activeConversationIdRef.current !== conversation.id) return;
          setActiveConversation(payload.conversation || conversation);
          const decryptedMessages = await decryptMessages(conversation.id, payload.messages || []);
          prepareThreadForLatestLayout();
          mergeThreadMessages(conversation.id, decryptedMessages);
          updateMessagePagination(payload);
        })
        .catch((error) => {
          if (!cancelled) Alert.alert("Chitthi unavailable", error instanceof Error ? error.message : "Could not verify this listing owner.");
        })
        .finally(() => {
          if (!cancelled) setThreadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [pendingPost?.id]);

  useEffect(() => {
    if (pendingRide) {
      activateThreadConversation("");
      setActiveConversation(null);
      setActiveSubject(rideContextLabel(pendingRide));
      clearThreadMessages();
      setHasMoreMessages(false);
      setNextBeforeMessageId(0);
      setMessageText(`Hi, I am interested in this ride from ${pendingRide.origin} to ${pendingRide.destination}. Is it still available?`);
      let cancelled = false;
      setThreadLoading(false);
      void openChatForRide(pendingRide.id)
        .then(async (response) => {
          if (cancelled) return;
          const conversation = response.conversation;
          activateThreadConversation(conversation.id);
          setActiveConversation(conversation);
          setActiveSubject(conversation.subject || rideContextLabel(pendingRide));
          const cachedMessages = await loadCachedThreadMessages(conversation.id);
          if (!cancelled) showCachedThreadMessages(conversation.id, cachedMessages);
          const payload = await getChatMessages(conversation.id, 0, 20);
          if (cancelled) return;
          if (activeConversationIdRef.current && activeConversationIdRef.current !== conversation.id) return;
          setActiveConversation(payload.conversation || conversation);
          const decryptedMessages = await decryptMessages(conversation.id, payload.messages || []);
          prepareThreadForLatestLayout();
          mergeThreadMessages(conversation.id, decryptedMessages);
          updateMessagePagination(payload);
        })
        .catch((error) => {
          if (!cancelled) {
            Alert.alert("Chitthi unavailable", error instanceof Error ? error.message : "Could not verify this listing owner.");
          }
        })
        .finally(() => {
          if (!cancelled) setThreadLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [pendingRide?.id]);

  useEffect(() => {
    if (signedIn) {
      refreshMessenger();
    }
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn || !activeConversationId) return;
    let cancelled = false;
    let cursor = messages.reduce((highest, message) => Math.max(highest, Number(message.id) || 0), 0);
    const run = async () => {
      while (!cancelled) {
        try {
          const payload = await pollChatEvents(activeConversationId, cursor);
          if (cancelled) return;
          setTypingPeople(payload.typing || []);
          cursor = Math.max(cursor, Number(payload.cursor || 0));
          const incomingMessages = await decryptMessages(activeConversationId, payload.messages || []);
          const receiptById = new Map((payload.receipts || []).map((receipt) => [Number(receipt.id), receipt]));
          const reactionsById = new Map((payload.reactionUpdates || []).map((update) => [Number(update.messageId), update.reactions || []]));
          setMessages((current) => {
            const byId = new Map<number, ChatMessage>();
            current.forEach((message) => {
              const receipt = receiptById.get(Number(message.id));
              const reactions = reactionsById.get(Number(message.id));
              byId.set(Number(message.id), { ...message, ...(receipt || {}), ...(reactions ? { reactions } : {}) });
            });
            incomingMessages.forEach((message) => byId.set(Number(message.id), message));
            return [...byId.values()].sort((left, right) => Number(left.id) - Number(right.id));
          });
          if ((payload.messages || []).some((message) => !message.mine)) {
            const nextConversations = await decryptConversationPreviews(await getChatConversations());
            if (cancelled) return;
            setConversations(nextConversations);
            onUnreadCountChange?.(nextConversations.reduce((total, conversation) => total + Math.max(0, Number(conversation.unread) || 0), 0));
          }
          if (!(payload.messages || []).length && (payload.typing || []).length) {
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          if (!cancelled && activeConversation?.communityId && (message.includes("conversation not found") || message.includes("join this group"))) {
            cancelled = true;
            clearThreadMessages();
            setConversations((current) => current.filter((conversation) => conversation.id !== activeConversationId));
            closeThread();
            Alert.alert("Group access ended", "You are no longer a member of this group, so its messages are no longer available.");
            return;
          }
          // A long-poll can be closed by a mobile network or upstream gateway.
          // Reconnect quietly with a small backoff; message history remains the
          // source of truth, so the cursor cannot lose messages between polls.
          if (!cancelled) await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      setTypingPeople([]);
    };
  }, [signedIn, activeConversationId, activeConversation?.communityId]);

  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    locationSubscription.current?.remove();
  }, []);

  function handleMessageTextChange(value: string) {
    setMessageText(value);
    if (!activeConversationId || editingMessageId) return;
    const now = Date.now();
    if (value.trim() && now - typingLastSentAt.current > 1800) {
      typingLastSentAt.current = now;
      void updateChatTyping(activeConversationId, true).catch(() => undefined);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      void updateChatTyping(activeConversationId, false).catch(() => undefined);
    }, 2500);
    if (!value.trim()) void updateChatTyping(activeConversationId, false).catch(() => undefined);
  }

  useEffect(() => {
    if (!activeConversationId) return;
    let cancelled = false;
    AsyncStorage.getItem(`fairfares.chat.wallpaper.${activeConversationId}`).then((stored) => {
      if (cancelled || !stored) return;
      try {
        const parsed = JSON.parse(stored) as { id?: string; image?: string };
        setWallpaper(parsed.id || "midnight");
        setCustomWallpaper(parsed.image || "");
      } catch {
        setWallpaper("midnight");
        setCustomWallpaper("");
      }
    });
    return () => { cancelled = true; };
  }, [activeConversationId]);

  async function applyWallpaper(id: string, image = "") {
    setWallpaper(id);
    setCustomWallpaper(image);
    setWallpaperPanelOpen(false);
    if (activeConversationId) await AsyncStorage.setItem(`fairfares.chat.wallpaper.${activeConversationId}`, JSON.stringify({ id, image }));
  }

  async function chooseCustomWallpaper() {
    try {
      const images = await pickCompressedImages(1, 1080, 0.55);
      if (images[0]) await applyWallpaper("custom", images[0]);
    } catch (error) {
      Alert.alert("Wallpaper failed", error instanceof Error ? error.message : "Could not use this photo.");
    }
  }

  useEffect(() => {
    onThreadModeChange?.(inThread);
    return () => onThreadModeChange?.(false);
  }, [inThread, onThreadModeChange]);

  const personConversations = useMemo(() => {
    const rows: ChatConversation[] = [];
    const rowByPerson = new Map<number, ChatConversation>();
    conversations.forEach((conversation) => {
      const personId = Number(conversation.otherUserId || 0);
      if (!personId || conversation.communityId || conversation.kind === "GROUP") {
        rows.push(conversation);
        return;
      }
      const existing = rowByPerson.get(personId);
      if (!existing) {
        const personRow = { ...conversation };
        rowByPerson.set(personId, personRow);
        rows.push(personRow);
        return;
      }
      existing.unread += conversation.unread || 0;
    });
    return rows;
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return personConversations.filter((conversation) => {
      const matchesSearch = !query || `${conversation.subject} ${conversation.otherName} ${conversation.lastMessage}`.toLowerCase().includes(query);
      const matchesTab =
        tab === "All" ||
        (tab === "Unread" && conversation.unread > 0) ||
        (tab === "Groups" && (conversation.kind === "GROUP" || Boolean(conversation.communityId)));
      return matchesSearch && matchesTab;
    });
  }, [personConversations, search, tab]);

  const filteredCommunities = useMemo(() => {
    const query = search.trim().toLowerCase();
    const activeCommunityIds = new Set(personConversations.map((conversation) => conversation.communityId).filter(Boolean));
    return communities.filter((community) => {
      const matchesSearch = !query || `${community.name} ${community.description} ${community.area}`.toLowerCase().includes(query);
      if (!matchesSearch) return false;
      if (tab === "Communities") return community.kind === "COMMUNITY";
      if (tab !== "All" && tab !== "Groups") return false;
      if (!community.joined) return false;
      if (tab === "Groups" && community.kind !== "GROUP") return false;
      return !activeCommunityIds.has(community.id);
    });
  }, [communities, personConversations, search, tab]);

  const suggestedCommunities = useMemo(() => {
    const query = search.trim().toLowerCase();
    const targetCity = suggestionCity.split(",", 1)[0].trim().toLowerCase();
    if (groupSuggestionsDismissed || (tab !== "All" && tab !== "Groups" && tab !== "Communities")) return [];
    return communities.filter((community) => {
      if (community.joined || community.visibility !== "PUBLIC") return false;
      const communityCity = String(community.suggestionCity || community.area || "").split(",", 1)[0].trim().toLowerCase();
      if (!targetCity || communityCity !== targetCity) return false;
      if (tab === "Groups" && community.kind !== "GROUP") return false;
      if (tab === "Communities" && community.kind !== "COMMUNITY") return false;
      return !query || `${community.name} ${community.description} ${community.area}`.toLowerCase().includes(query);
    });
  }, [communities, groupSuggestionsDismissed, search, suggestionCity, tab]);

  function communityGlyph(name: string) {
    const value = name.toLowerCase();
    if (value.includes("ride") || value.includes("carpool")) return "🚗";
    if (value.includes("roommate")) return "👥";
    if (value.includes("housing") || value.includes("room") || value.includes("home")) return "🏠";
    return "✉️";
  }

  async function refreshMessenger(options: { showLoader?: boolean; showError?: boolean } = {}) {
    if (!signedIn) return;
    const { showLoader = true, showError = true } = options;
    const refreshVersion = messengerRefreshVersion.current + 1;
    const loaderVersion = showLoader ? messengerLoaderVersion.current + 1 : messengerLoaderVersion.current;
    messengerRefreshVersion.current = refreshVersion;
    if (showLoader) {
      messengerLoaderVersion.current = loaderVersion;
      setLoading(true);
    }
    try {
      const [conversationPayload, nextCommunities] = await Promise.all([getChatConversations(), getChatCommunities(suggestionCity || data?.location.city || "")]);
      const immediateConversations = conversationPayload.map((conversation) => ({
        ...conversation,
        lastMessage: safeConversationPreview(conversation)
      }));
      setConversations(immediateConversations);
      setHasMoreConversations(conversationPayload.length >= 30);
      setCommunities(nextCommunities);
      onUnreadCountChange?.(immediateConversations.reduce((total, conversation) => total + Math.max(0, Number(conversation.unread) || 0), 0));
      // Encrypted preview decryption can require one envelope request per thread.
      // Do that after the list is visible so a large inbox never blocks Chitthi opening.
      void decryptConversationPreviews(conversationPayload).then((decrypted) => {
        if (messengerRefreshVersion.current !== refreshVersion) return;
        const previewById = new Map(decrypted.map((conversation) => [conversation.id, conversation.lastMessage]));
        setConversations((current) => {
          const next = current.map((conversation) => ({
            ...conversation,
            lastMessage: previewById.get(conversation.id) || conversation.lastMessage
          }));
          return next;
        });
      });
    } catch (error) {
      if (showError) Alert.alert("Messenger failed", error instanceof Error ? error.message : "Could not load chats.");
    } finally {
      if (showLoader && messengerLoaderVersion.current === loaderVersion) setLoading(false);
    }
  }

  async function loadMoreConversations() {
    if (!signedIn || loadingMoreConversations || !hasMoreConversations) return;
    setLoadingMoreConversations(true);
    try {
      const page = await getChatConversations(conversations.length);
      const immediatePage = page.map((conversation) => ({
        ...conversation,
        lastMessage: safeConversationPreview(conversation)
      }));
      setConversations((current) => mergeChatConversations(current, immediatePage));
      setHasMoreConversations(page.length >= 30);
      void decryptConversationPreviews(page).then((decrypted) => {
        const previewById = new Map(decrypted.map((conversation) => [conversation.id, conversation.lastMessage]));
        setConversations((current) => current.map((conversation) => ({
          ...conversation,
          lastMessage: previewById.get(conversation.id) || conversation.lastMessage
        })));
      });
    } catch (error) {
      Alert.alert("Could not load more letters", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setLoadingMoreConversations(false);
    }
  }

  async function openConversation(conversation: ChatConversation) {
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    onThreadModeChange?.(true);
    userTouchedThreadRef.current = false;
    shouldAutoScrollToEndRef.current = true;
    activateThreadConversation(conversation.id);
    setActiveSubject(conversation.subject);
    setActiveConversation(conversation);
    const cachedMessages = await loadCachedThreadMessages(conversation.id);
    showCachedThreadMessages(conversation.id, cachedMessages);
    if (!cachedMessages.length) clearThreadMessages();
    setHasMoreMessages(false);
    setNextBeforeMessageId(0);
    setThreadLoading(!cachedMessages.length);
    try {
      // Message metadata and encrypted envelopes are independent requests. Running
      // them together removes a full network round trip from normal thread opens.
      const [payload, preparedDecryption] = await Promise.all([
        getChatMessages(conversation.id, 0, 20),
        prepareMessageDecryption(conversation.id)
          .then((context) => ({ context }))
          .catch(() => ({ context: null }))
      ]);
      if (activeConversationIdRef.current && activeConversationIdRef.current !== conversation.id) return;
      setActiveSubject(payload.conversation.subject || conversation.subject);
      setActiveConversation({
        ...conversation,
        ...payload.conversation,
        kind: (payload.conversation.kind as ChatConversation["kind"]) || conversation.kind,
        status: payload.conversation.status || conversation.status,
        communityId: payload.conversation.communityId || conversation.communityId,
        otherName: payload.conversation.otherName || conversation.otherName,
        otherPhotoUrl: payload.conversation.otherPhotoUrl || conversation.otherPhotoUrl,
        otherOnline: payload.conversation.otherOnline ?? conversation.otherOnline,
        otherLastSeenAt: payload.conversation.otherLastSeenAt || conversation.otherLastSeenAt,
        mutedAt: payload.conversation.mutedAt || conversation.mutedAt,
        blockedAt: payload.conversation.blockedAt || conversation.blockedAt
      });
      const decryptedMessages = preparedDecryption.context
        ? await decryptMessages(conversation.id, payload.messages || [], Promise.resolve(preparedDecryption.context))
        : payload.messages || [];
      if (!preparedDecryption.context) setEncryptionReady(false);
      prepareThreadForLatestLayout();
      mergeThreadMessages(conversation.id, decryptedMessages);
      updateMessagePagination(payload);
      const lastMessage = payload.messages[payload.messages.length - 1];
      if (lastMessage) {
        setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, unread: 0 } : item));
        void refreshMessenger({ showLoader: false, showError: false });
      } else {
        void refreshMessenger({ showLoader: false, showError: false });
      }
    } catch (error) {
      Alert.alert("Chat failed", error instanceof Error ? error.message : "Could not open this chat.");
    } finally {
      setThreadLoading(false);
    }
  }

  async function sendMessage() {
    const cleanMessage = messageText.trim();
    const startedFromCardContext = Boolean(pendingPost || pendingRide);
    userTouchedThreadRef.current = false;
    shouldAutoScrollToEndRef.current = true;
    if (activeConversationId) void updateChatTyping(activeConversationId, false).catch(() => undefined);
    let queuedOffline = false;
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    const attachments = pendingImages.length ? pendingImages : pendingAttachment ? [pendingAttachment] : [];
    if (attachments.length) {
      if (!activeConversationId) {
        Alert.alert("Opening Chitthi", "Wait a moment while FairFares verifies the conversation.");
        return;
      }
      setThreadLoading(true);
      setAttachmentStatus(attachments.length > 1 ? `Sending ${attachments.length} photos…` : attachments[0].kind === "IMAGE" ? "Sending photo…" : `Sending ${attachments[0].name}…`);
      try {
        const identity = await ensureChatDeviceIdentity();
        const keyPayload = await getChatDeviceKeys(activeConversationId);
        if (!keyPayload.ready) throw new Error(keyPayload.warning || "Encryption keys are not ready.");
        setEncryptionReady(true);
        const mediaGroupId = attachments.length > 1 ? `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : "";
        const sentMessages: ChatMessage[] = [];
        for (let index = 0; index < attachments.length; index += 1) {
          const attachment = attachments[index];
          const mediaMetadata = mediaGroupId ? { mediaGroupId, mediaGroupIndex: index, mediaGroupCount: attachments.length } : {};
          const caption = index === 0 ? cleanMessage : "";
          let fileBase64 = "";
          let encryptedTemporaryUri = "";
          const encrypted = Platform.OS === "web"
            ? (() => undefined)()
            : encryptAttachmentFileForDevices(
                attachment.uri,
                { fileName: attachment.name, mimeType: attachment.mimeType, caption, kind: attachment.kind, ...mediaMetadata },
                identity,
                keyPayload.keys
              );
          if (Platform.OS === "web") {
            fileBase64 = await new Promise<string>(async (resolve, reject) => {
                try {
                  let blob = attachment.blob;
                  if (!blob) blob = await fetch(attachment.uri).then((item) => item.blob());
                  const reader = new FileReader();
                  reader.onerror = () => reject(new Error("Could not read this attachment."));
                  reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
                  reader.readAsDataURL(blob as Blob);
                } catch (error) { reject(error); }
              });
          }
          const encryptedPayload = encrypted || encryptAttachmentForDevices(fileBase64, { fileName: attachment.name, mimeType: attachment.mimeType, caption, kind: attachment.kind, ...mediaMetadata }, identity, keyPayload.keys);
          encryptedTemporaryUri = "encryptedUri" in encryptedPayload ? String(encryptedPayload.encryptedUri || "") : "";
          let response;
          try {
            response = await sendDirectEncryptedChatAttachment(activeConversationId, encryptedPayload, attachment.mimeType, index + 1 < attachments.length);
          } finally {
            if (encryptedTemporaryUri) deleteChunkedTemporaryFile(encryptedTemporaryUri);
          }
          let senderLocalUri = "";
          if (Platform.OS !== "web") {
            const localUri = encryptedAttachmentLocalUri(currentUserId, response.message.id, attachment.name, attachment.mimeType);
            if (localUri) {
              // The server has already accepted the message. A local-storage
              // failure must not present it as unsent or encourage duplicates.
              await copyPersistentChitthiMedia(localUri, attachment.uri)
                .then(() => {
                  senderLocalUri = localUri;
                  setLocalMediaMessageIds((current) => current.includes(response.message.id) ? current : [...current, response.message.id]);
                  return cleanupPersistentChitthiMedia(localUri);
                })
                .catch(() => undefined);
            }
          }
          sentMessages.push({ ...response.message, type: attachment.kind, text: caption, metadata: { ...response.message.metadata, encrypted: true, kind: attachment.kind, fileName: attachment.name, mimeType: attachment.mimeType, decryptedDataUrl: Platform.OS === "web" ? `data:${attachment.mimeType};base64,${fileBase64}` : attachment.kind === "IMAGE" ? senderLocalUri : undefined, ...mediaMetadata } });
          setAttachmentStatus(attachments.length > 1 ? `Sending photo ${index + 1} of ${attachments.length}…` : attachment.kind === "IMAGE" ? "Sending photo…" : `Sending ${attachment.name}…`);
        }
        setMessages((current) => [...current.filter((item) => !sentMessages.some((sent) => sent.id === item.id)), ...sentMessages].sort((a, b) => a.id - b.id));
        scrollThreadToLatest(false);
        const sentKind = attachments[0].kind;
        setPendingAttachment(null);
        setPendingImages([]);
        setPendingPhotoPreviewOpen(false);
        setMessageText("");
        setAttachmentStatus(attachments.length > 1 ? `${attachments.length} photos sent` : sentKind === "IMAGE" ? "Photo sent" : sentKind === "VIDEO" ? "Video sent" : "File sent");
        setTimeout(() => setAttachmentStatus(""), 1600);
        if (startedFromCardContext) onCardMessageSent?.();
        onClearPendingPost?.();
        onClearPendingRide?.();
        void refreshMessenger({ showLoader: false, showError: false });
      } catch (error) {
        setAttachmentStatus("");
        Alert.alert(attachments[0].kind === "IMAGE" ? "Image failed" : attachments[0].kind === "VIDEO" ? "Video failed" : "File failed", error instanceof Error ? error.message : "Could not send this attachment.");
      } finally {
        setThreadLoading(false);
      }
      return;
    }
    if (!cleanMessage) {
      Alert.alert("Message required", "Type a message or select an attachment before sending.");
      return;
    }
    if ((pendingPost || pendingRide) && !activeConversationId) {
      Alert.alert("Securing Chitthi", "Wait a moment while FairFares prepares the encrypted conversation.");
      return;
    }
    setThreadLoading(true);
    try {
      if (activeConversationId && editingMessageId) {
        const identity = await ensureChatDeviceIdentity();
        const keyPayload = await getEncryptionKeysForSend(activeConversationId);
        if (!keyPayload.ready) throw new Error(keyPayload.warning || "Encryption keys are not ready.");
        const envelopes = encryptForDevices(cleanMessage, identity, keyPayload.keys);
        const response = await editChatMessage(activeConversationId, editingMessageId, envelopes);
        setMessages((current) => current.map((item) => (item.id === editingMessageId
          ? { ...response.message, text: cleanMessage, canEdit: response.message.canEdit, metadata: { ...response.message.metadata, encrypted: true } }
          : item)));
        setEditingMessageId(null);
      } else if (activeConversationId) {
        const identity = await ensureChatDeviceIdentity();
        const keyPayload = await getEncryptionKeysForSend(activeConversationId);
        if (!keyPayload.ready) throw new Error(keyPayload.warning || "Encryption keys are not ready.");
        setEncryptionReady(true);
        const envelopes = encryptForDevices(cleanMessage, identity, keyPayload.keys);
        const clientMessageId = createOutboxClientMessageId(identity.deviceId);
        try {
          const response = await sendEncryptedChatMessage(activeConversationId, envelopes, clientMessageId, false, replyingTo?.id || 0);
          setMessages((current) => [...current, { ...response.message, text: cleanMessage, canEdit: response.message.canEdit, metadata: { ...response.message.metadata, encrypted: true } }]);
          scrollThreadToLatest(false);
          setReplyingTo(null);
        } catch (error) {
          if (!isRetryableChatNetworkError(error)) throw error;
          const createdAt = new Date().toISOString();
          const outboxItem: EncryptedOutboxItem = {
            version: 1,
            userId: Number(data?.user?.id || 0),
            conversationId: activeConversationId,
            clientMessageId,
            localMessageId: -Date.now(),
            createdAt,
            envelopes,
            replyToMessageId: replyingTo?.id || 0,
            attempts: 0,
            lastAttemptAt: ""
          };
          await enqueueEncryptedMessage(outboxItem);
          setMessages((current) => [...current, queuedMessage(outboxItem, identity)]);
          scrollThreadToLatest(false);
          setReplyingTo(null);
          queuedOffline = true;
        }
        if (startedFromCardContext) onCardMessageSent?.();
        onClearPendingPost?.();
        onClearPendingRide?.();
      } else {
        Alert.alert("Choose a chat", "Open a listing or conversation first.");
        return;
      }
      setMessageText("");
      if (!queuedOffline) {
        try {
          void refreshMessenger({ showLoader: false, showError: false });
        } catch {
          // Sending succeeded; the conversation list can refresh on the next poll.
        }
      }
    } catch (error) {
      Alert.alert("Message failed", error instanceof Error ? error.message : "Could not send this message.");
    } finally {
      setThreadLoading(false);
    }
  }

  async function createGroup() {
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    const name = groupDraft.name.trim();
    if (!name) {
      Alert.alert("Group name required", "Add a name so people know what they are joining.");
      return;
    }
    if (!selectedGroupPeople.length) {
      await findPeopleFromContacts("create");
      return;
    }
    setLoading(true);
    try {
      const response = await createChatCommunity(name, "GROUP", "", "", groupPhoto);
      await Promise.all(selectedGroupPeople.map((personId) => addChatGroupMember(response.community.id, personId)));
      setCommunities((current) => [response.community, ...current.filter((community) => community.id !== response.community.id)]);
      setGroupDraft(blankGroup);
      setGroupPhoto("");
      setSelectedGroupPeople([]);
      setCreatingGroup(false);
      await openCommunityThread({ ...response.community, joined: true });
    } catch (error) {
      Alert.alert("Group failed", error instanceof Error ? error.message : "Could not create this group.");
    } finally {
      setLoading(false);
    }
  }

  async function chooseGroupPhoto() {
    try {
      const images = await pickCompressedImages(1, 720, 0.7);
      if (images[0]) setGroupPhoto(images[0]);
    } catch (error) {
      Alert.alert("Group image not added", error instanceof Error ? error.message : "Could not use this image.");
    }
  }

  async function changeActiveGroupPhoto() {
    const communityId = activeConversation?.communityId || "";
    if (!communityId) return;
    setChatOptionsOpen(false);
    try {
      const images = await pickCompressedImages(1, 720, 0.7);
      if (!images[0]) return;
      const response = await updateChatGroupPhoto(communityId, images[0]);
      setCommunities((current) => current.map((item) => item.id === communityId ? response.community : item));
      setActiveConversation((current) => current ? { ...current, otherPhotoUrl: response.community.photoUrl || "" } : current);
      setConversations((current) => current.map((item) => item.communityId === communityId ? { ...item, otherPhotoUrl: response.community.photoUrl || "" } : item));
      Alert.alert("Group image updated", "Everyone in the group will now see this image.");
    } catch (error) {
      Alert.alert("Group image not updated", error instanceof Error ? error.message : "Try again.");
    }
  }

  async function confirmGroupInvitation(invitation: string) {
    if (invitation.startsWith("community:")) {
      const communityId = invitation.slice("community:".length).trim();
      const community = communities.find((item) => item.id === communityId);
      onClearPendingGroupInvite?.();
      if (!community) {
        Alert.alert("Group unavailable", "Refresh Chitthi and try this group link again.");
        return;
      }
      Alert.alert(community.name, community.joined ? "Open this FairFares group?" : "Would you like to join this FairFares group?", [
        { text: "Not now", style: "cancel" },
        { text: community.joined ? "Open group" : "Join group", onPress: () => void openCommunityThread(community) }
      ]);
      return;
    }
    setLoading(true);
    try {
      const preview = await previewChatGroupInvite(invitation);
      onClearPendingGroupInvite?.();
      Alert.alert(
        preview.group.name,
        `${preview.group.memberCount} member${preview.group.memberCount === 1 ? "" : "s"}${preview.group.area ? ` · ${preview.group.area}` : ""}\n\n${preview.group.alreadyMember ? "You are already a member. Open this group?" : "Would you like to join this private group?"}`,
        [
          { text: "Not now", style: "cancel" },
          {
            text: preview.group.alreadyMember ? "Open group" : "Join group",
            onPress: () => void (async () => {
              setLoading(true);
              try {
                const response = await joinChatGroupInvite(invitation);
                setCommunities((current) => [response.community, ...current.filter((item) => item.id !== response.community.id)]);
                await openCommunityThread(response.community);
              } catch (error) {
                Alert.alert("Could not join group", error instanceof Error ? error.message : "Check the invitation and try again.");
              } finally {
                setLoading(false);
              }
            })()
          }
        ]
      );
    } catch (error) {
      onClearPendingGroupInvite?.();
      Alert.alert("Invitation unavailable", error instanceof Error ? error.message : "This invitation is not valid.");
    } finally {
      setLoading(false);
    }
  }

  async function startPhoneChat(value = search) {
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    if (value.replace(/\D/g, "").length < 10) {
      Alert.alert("Complete number required", "Enter the full phone number, including country code.");
      return;
    }
    setLoading(true);
    try {
      const found = await findChatPersonByPhone(value);
      const response = await openChatWithPerson(found.person.id);
      activateThreadConversation(response.conversation.id);
      setActiveConversation(response.conversation);
      setActiveSubject(found.person.name);
      setSearch("");
      setCreatingGroup(false);
      onThreadModeChange?.(true);
      const payload = await getChatMessages(response.conversation.id);
      if (activeConversationIdRef.current && activeConversationIdRef.current !== response.conversation.id) return;
      const decryptedMessages = await decryptMessages(response.conversation.id, payload.messages || []);
      prepareThreadForLatestLayout();
      mergeThreadMessages(response.conversation.id, decryptedMessages);
      updateMessagePagination(payload);
      await refreshMessenger();
    } catch (error) {
      Alert.alert("Contact not found", error instanceof Error ? error.message : "Could not find this FairFares member.");
    } finally {
      setLoading(false);
    }
  }

  async function openContactChat(person: { id: number; name: string }) {
    setContactPickerOpen(false);
    setLoading(true);
    try {
      const response = await openChatWithPerson(person.id);
      activateThreadConversation(response.conversation.id);
      setActiveConversation(response.conversation);
      setActiveSubject(person.name);
      onThreadModeChange?.(true);
      const payload = await getChatMessages(response.conversation.id);
      if (activeConversationIdRef.current && activeConversationIdRef.current !== response.conversation.id) return;
      const decryptedMessages = await decryptMessages(response.conversation.id, payload.messages || []);
      prepareThreadForLatestLayout();
      mergeThreadMessages(response.conversation.id, decryptedMessages);
      updateMessagePagination(payload);
      await refreshMessenger();
    } catch (error) {
      Alert.alert("Could not open chat", error instanceof Error ? error.message : "Try again shortly.");
    } finally {
      setLoading(false);
    }
  }

  async function openFeedbackChat() {
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    const existingConversation = conversations.find((conversation) => {
      if (conversation.communityId || conversation.kind === "GROUP") return false;
      const name = (conversation.otherName || conversation.subject || "").trim().toLowerCase();
      return name === "sriram reddy bandari" || (name.includes("sriram") && name.includes("bandari"));
    });
    if (existingConversation) {
      await openConversation(existingConversation);
      return;
    }
    setLoading(true);
    try {
      const response = await openIssuesAndSuggestionsChat();
      activateThreadConversation(response.conversation.id);
      setActiveConversation(response.conversation);
      setActiveSubject(response.conversation.otherName || "Sriram Reddy Bandari");
      onThreadModeChange?.(true);
      const payload = await getChatMessages(response.conversation.id);
      if (activeConversationIdRef.current && activeConversationIdRef.current !== response.conversation.id) return;
      const decryptedMessages = await decryptMessages(response.conversation.id, payload.messages || []);
      prepareThreadForLatestLayout();
      mergeThreadMessages(response.conversation.id, decryptedMessages);
      updateMessagePagination(payload);
      await refreshMessenger();
    } catch (error) {
      Alert.alert("Could not open this Chitthi", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function findPeopleFromContacts(mode: "chat" | "create" | "add" = "chat", communityId = "") {
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    if (Platform.OS === "web" || !(await Contacts.isAvailableAsync())) {
      Alert.alert("Contacts unavailable", "Contact discovery is available in the FairFares Android and iOS apps.");
      return;
    }
    setContactsLoading(true);
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Contacts permission not enabled", "You can still find a member by entering their full phone number in Chitthi search.");
        return;
      }
      const response = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      const localNames = new Map<string, string>();
      for (const contact of response.data) {
        const label = contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Your contact";
        for (const entry of contact.phoneNumbers || []) {
          contactDiscoveryVariants(String(entry.number || ""))
            .forEach((value) => localNames.set(contactDiscoveryHash(value), label));
        }
      }
      const hashes = Array.from(localNames.keys()).slice(0, 1000);
      if (!hashes.length) {
        setContactMatches([]);
        Alert.alert("No phone contacts found", "Add a phone number to a device contact and try again.");
        return;
      }
      const found = await findChatPeopleByContactHashes(hashes);
      setContactMatches(found.people.map((person) => ({ ...person, localName: localNames.get(person.phoneHash) || person.name })));
      if (found.people.length) {
        setContactPickerMode(mode);
        setAddPeopleCommunityId(communityId);
        setContactPickerOpen(true);
      }
      else Alert.alert("No FairFares contacts yet", "None of your accessible contacts currently allow phone discovery on FairFares.");
    } catch (error) {
      Alert.alert("Contact search failed", error instanceof Error ? error.message : "Could not check your contacts.");
    } finally {
      setContactsLoading(false);
    }
  }

  function toggleGroupPerson(personId: number) {
    setSelectedGroupPeople((current) => current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId]);
  }

  async function addSelectedPeopleToExistingGroup() {
    if (!addPeopleCommunityId || !selectedGroupPeople.length) return;
    setContactsLoading(true);
    try {
      await Promise.all(selectedGroupPeople.map((personId) => addChatGroupMember(addPeopleCommunityId, personId)));
      setContactPickerOpen(false);
      setSelectedGroupPeople([]);
      setAddPeopleCommunityId("");
      await refreshMessenger();
      if (activeConversation?.communityId === addPeopleCommunityId) {
        const response = await getChatGroupMembers(addPeopleCommunityId);
        setGroupMembers(response.members || []);
      }
      Alert.alert("People added", "Selected FairFares members were added to the group.");
    } catch (error) {
      Alert.alert("Could not add people", error instanceof Error ? error.message : "Try again.");
    } finally {
      setContactsLoading(false);
    }
  }

  function handleMessengerSearchSubmit() {
    const value = search.trim();
    if (!value) return;
    if (value.includes("group_invite=") || value.includes("community_id=")) {
      if (value.includes("community_id=")) {
        try { void confirmGroupInvitation(`community:${new URL(value).searchParams.get("community_id") || ""}`); } catch { void confirmGroupInvitation(value); }
      } else void confirmGroupInvitation(value);
      return;
    }
    if (value.replace(/\D/g, "").length >= 10) void startPhoneChat(value);
  }

  async function openCommunityThread(community: Community) {
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    onThreadModeChange?.(true);
    setLoading(true);
    try {
      const joinedCommunity = community.joined ? community : (await joinChatCommunity(community.id, community.suggestionCity, community.suggestionPurpose)).community;
      setCommunities((current) => current.map((item) => (item.id === joinedCommunity.id ? joinedCommunity : item)));
      const response = await openCommunityChat(joinedCommunity.id);
      activateThreadConversation(response.conversation.id);
      setActiveSubject(response.conversation.subject || joinedCommunity.name);
      setActiveConversation({
        id: response.conversation.id,
        communityId: joinedCommunity.id,
        kind: "GROUP",
        subject: response.conversation.subject || joinedCommunity.name,
        otherName: joinedCommunity.name,
        otherPhotoUrl: joinedCommunity.photoUrl || "",
        lastMessage: "",
        lastMessageAt: "",
        unread: 0
      });
      setTab("All");
      setThreadLoading(true);
      const payload = await getChatMessages(response.conversation.id);
      if (activeConversationIdRef.current && activeConversationIdRef.current !== response.conversation.id) return;
      const decryptedMessages = await decryptMessages(response.conversation.id, payload.messages || []);
      prepareThreadForLatestLayout();
      mergeThreadMessages(response.conversation.id, decryptedMessages);
      updateMessagePagination(payload);
      const lastMessage = payload.messages[payload.messages.length - 1];
      if (lastMessage) {
        void refreshMessenger({ showLoader: false, showError: false });
      } else {
        void refreshMessenger({ showLoader: false, showError: false });
      }
    } catch (error) {
      Alert.alert("Group chat failed", error instanceof Error ? error.message : "Could not open this group chat.");
    } finally {
      setThreadLoading(false);
      setLoading(false);
    }
  }

  async function shareCommunity(community: Community) {
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    try {
      const inviteUrl = community.visibility === "PRIVATE"
        ? (await createChatGroupInvite(community.id)).inviteUrl
        : community.joinUrl;
      if (!inviteUrl) throw new Error("An invitation link could not be created.");
      const message = `Join ${community.name} on FairFares: ${inviteUrl}`;
      Alert.alert(
        `Invite to ${community.name}`,
        community.visibility === "PRIVATE" ? "This secure invitation link expires in 7 days." : "Anyone with this link can open the group.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Copy link", onPress: () => void Clipboard.setStringAsync(inviteUrl).then(() => Alert.alert("Link copied", "The group invitation is ready to paste.")) },
          { text: "Share", onPress: () => void Share.share({ message }) }
        ]
      );
    } catch (error) {
      Alert.alert("Invite unavailable", error instanceof Error ? error.message : "Only group owners and admins can invite members.");
    }
  }

  async function inviteToActiveGroup() {
    const community = communities.find((item) => item.id === activeConversation?.communityId);
    if (!community) {
      Alert.alert("Group unavailable", "Refresh Chitthi and open the group again.");
      return;
    }
    setChatOptionsOpen(false);
    await shareCommunity(community);
  }

  async function showGroupMembers() {
    const communityId = activeConversation?.communityId || "";
    if (!communityId) return;
    setChatOptionsOpen(false);
    setThreadLoading(true);
    try {
      const response = await getChatGroupMembers(communityId);
      setGroupMembers(response.members || []);
      setGroupMemberSearch("");
      setGroupMembersOpen(true);
    } catch (error) {
      Alert.alert("Members unavailable", error instanceof Error ? error.message : "Could not load group members.");
    } finally {
      setThreadLoading(false);
    }
  }

  async function changeGroupMember(member: ChatGroupMember, action: "REMOVE" | "ROLE") {
    const communityId = activeConversation?.communityId || "";
    if (!communityId) return;
    try {
      if (action === "REMOVE") await removeChatGroupMember(communityId, member.id);
      else await updateChatGroupMemberRole(communityId, member.id, member.role === "ADMIN" ? "MEMBER" : "ADMIN");
      const response = await getChatGroupMembers(communityId);
      setGroupMembers(response.members || []);
      await refreshMessenger();
    } catch (error) {
      Alert.alert("Group update failed", error instanceof Error ? error.message : "Could not update this member.");
    }
  }

  async function transferGroupTo(member: ChatGroupMember) {
    const communityId = activeConversation?.communityId || "";
    if (!communityId) return;
    try {
      await transferChatGroupOwnership(communityId, member.id);
      const response = await getChatGroupMembers(communityId);
      setGroupMembers(response.members || []);
      await refreshMessenger();
    } catch (error) {
      Alert.alert("Transfer failed", error instanceof Error ? error.message : "Could not transfer ownership.");
    }
  }

  function showGroupMemberActions(member: ChatGroupMember) {
    const currentRole = groupMembers.find((item) => item.isCurrentUser)?.role || "MEMBER";
    const canChangeRole = currentRole === "OWNER" && !member.isCurrentUser && member.role !== "OWNER";
    const canRemove = !member.isCurrentUser && member.role !== "OWNER" && (currentRole === "OWNER" || (currentRole === "ADMIN" && member.role === "MEMBER"));
    if (!canChangeRole && !canRemove) return;
    Alert.alert(member.name, member.role === "MEMBER" ? "Group member" : member.role === "ADMIN" ? "Group admin" : "Group owner", [
      ...(canChangeRole ? [
        { text: "Make owner", onPress: () => void transferGroupTo(member) },
        { text: member.role === "ADMIN" ? "Remove as admin" : "Make admin", onPress: () => void changeGroupMember(member, "ROLE") }
      ] : []),
      ...(canRemove ? [{ text: "Remove from group", style: "destructive" as const, onPress: () => void changeGroupMember(member, "REMOVE") }] : []),
      { text: "Cancel", style: "cancel" }
    ]);
  }

  async function messageGroupMember(member: ChatGroupMember) {
    if (member.isCurrentUser) return;
    setGroupMembersOpen(false);
    setGroupMemberSearch("");
    await openContactChat({ id: member.id, name: member.name });
  }

  async function leaveActiveGroup() {
    const communityId = activeConversation?.communityId || "";
    if (!communityId) return;
    const departedConversationId = activeConversationId;
    try {
      await leaveChatGroup(communityId);
      setConversations((current) => current.filter((conversation) => conversation.id !== departedConversationId && conversation.communityId !== communityId));
      if (data?.user?.id && departedConversationId) await AsyncStorage.removeItem(conversationKeyCacheName(data.user.id, departedConversationId));
      setGroupMembersOpen(false);
      closeThread();
      await refreshMessenger();
    } catch (error) {
      Alert.alert("Could not leave group", error instanceof Error ? error.message : "Try again.");
    }
  }

  async function toggleMute() {
    if (!activeConversationId) return;
    const nextMuted = !activeConversation?.mutedAt;
    try {
      await muteChatConversation(activeConversationId, nextMuted);
      setActiveConversation((current) => current ? { ...current, mutedAt: nextMuted ? new Date().toISOString() : "" } : current);
      await refreshMessenger();
    } catch (error) {
      Alert.alert("Mute failed", error instanceof Error ? error.message : "Could not update this chat.");
    }
  }

  async function toggleBlock() {
    if (!activeConversationId || activeConversation?.communityId) return;
    const targetUserId = activeConversation?.otherUserId || 0;
    const nextBlocked = !activeConversation?.blockedAt;
    try {
      await blockChatUser(activeConversationId, targetUserId, nextBlocked);
      setActiveConversation((current) => current ? { ...current, blockedAt: nextBlocked ? new Date().toISOString() : "" } : current);
      await refreshMessenger();
    } catch (error) {
      Alert.alert("Block failed", error instanceof Error ? error.message : "Could not update this member.");
    }
  }

  async function chooseAndSendImage() {
    setAttachmentMenuOpen(false);
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    if (!activeConversationId) {
      Alert.alert("Opening Chitthi", "Wait a moment while FairFares verifies the conversation.");
      return;
    }
    try {
      const media = await pickChatMedia(4);
      if (!media.length) return;
      if (media[0].kind === "VIDEO") {
        setPendingImages([]);
        setPendingAttachment(media[0]);
      } else {
        setPendingAttachment(null);
        setPendingImages(media);
      }
    } catch (error) {
      setAttachmentStatus("");
      Alert.alert("Image failed", error instanceof Error ? error.message : "Could not send this image.");
    }
  }

  async function takeAndSendPhoto() {
    setAttachmentMenuOpen(false);
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    if (!activeConversationId) {
      Alert.alert("Opening Chitthi", "Wait a moment while FairFares verifies the conversation.");
      return;
    }
    try {
      const photo = await takeChatPhoto();
      if (!photo) return;
      setPendingImages([]);
      setPendingAttachment({ ...photo, kind: "IMAGE" });
    } catch (error) {
      Alert.alert("Camera unavailable", error instanceof Error ? error.message : "Could not take this photo.");
    }
  }

  async function choosePhoneContact() {
    setAttachmentMenuOpen(false);
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Contacts permission needed", "Allow contact access to select a contact to share.");
        return;
      }
      const response = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails], sort: Contacts.SortTypes.FirstName });
      const rows = response.data.map((contact) => ({
        id: contact.id,
        name: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Contact",
        phone: String(contact.phoneNumbers?.[0]?.number || ""),
        email: String(contact.emails?.[0]?.email || "")
      })).filter((contact) => contact.phone || contact.email);
      setShareableContacts(rows);
      if (rows.length) setShareContactPickerOpen(true);
      else Alert.alert("No contacts found", "No contacts with a phone number or email address are available.");
    } catch (error) {
      Alert.alert("Contacts unavailable", error instanceof Error ? error.message : "Could not open your contacts.");
    }
  }

  function usePhoneContact(contact: { name: string; phone: string; email: string }) {
    setShareContactPickerOpen(false);
    setRichDraft({ primary: contact.name, secondary: contact.phone, tertiary: contact.email, fourth: "" });
    setRichComposer("CONTACT");
  }

  async function chooseAndSendFile() {
    setAttachmentMenuOpen(false);
    if (!activeConversationId) {
      Alert.alert("Opening Chitthi", "Wait a moment while FairFares verifies the conversation.");
      return;
    }
    try {
      const file = await pickChatFile();
      if (!file) return;
      setPendingImages([]);
      setPendingAttachment({ kind: "FILE", ...file });
    } catch (error) {
      setAttachmentStatus("");
      Alert.alert("File failed", error instanceof Error ? error.message : "Could not send this file.");
    }
  }

  function openRichComposer(type: "POLL" | "EVENT" | "CONTACT") {
    Keyboard.dismiss();
    setComposerFocused(false);
    setAttachmentMenuOpen(false);
    setEmojiPickerOpen(false);
    setRichDraft({ primary: "", secondary: "", tertiary: "", fourth: "" });
    if (type === "POLL") { setPollMultiple(false); setPollClosesInHours(24); setPollOptions(["", ""]); }
    setRichComposer(type);
  }

  async function sendEncryptedRichMessage(type: string, metadata: Record<string, unknown>, silent = false) {
    if (!activeConversationId) throw new Error("Open a conversation first.");
    const identity = await ensureChatDeviceIdentity();
    const keyPayload = await getEncryptionKeysForSend(activeConversationId);
    if (!keyPayload.ready) throw new Error(keyPayload.warning || "Encryption keys are not ready.");
    setEncryptionReady(true);
    const richPreview = type === "CONTACT" ? "Shared a contact" : type === "LOCATION" ? "Shared a location" : type === "POLL" ? "Shared a poll" : type === "EVENT" ? "Shared an event" : "New Chitthi message";
    const envelopes = encryptForDevices(`FFRICH:${JSON.stringify({ type, metadata })}`, identity, keyPayload.keys, richPreview);
    const response = await sendEncryptedChatMessage(activeConversationId, envelopes, `${Date.now()}-${Math.random().toString(36).slice(2)}`, silent);
    const message = { ...response.message, type, text: "", canEdit: false, metadata: { ...metadata, encrypted: true } } as ChatMessage;
    setMessages((current) => [...current.filter((item) => item.id !== message.id), message].sort((a, b) => a.id - b.id));
    return message;
  }

  async function submitRichMessage() {
    if (!activeConversationId || !richComposer) return;
    let metadata: Record<string, unknown>;
    if (richComposer === "POLL") {
      metadata = { question: richDraft.primary.trim(), options: pollOptions.map((value) => value.trim()).filter(Boolean) };
    } else if (richComposer === "EVENT") {
      metadata = { title: richDraft.primary.trim(), date: richDraft.secondary.trim(), time: richDraft.tertiary.trim(), location: richDraft.fourth.trim() };
    } else {
      metadata = { name: richDraft.primary.trim(), phone: richDraft.secondary.trim(), email: richDraft.tertiary.trim() };
    }
    try {
      setThreadLoading(true);
      if (richComposer === "POLL") {
        const response = await sendChatRichMessage(activeConversationId, "POLL", { ...metadata, allowMultiple: pollMultiple, anonymous: true, closesInHours: pollClosesInHours });
        setMessages((current) => [...current.filter((item) => item.id !== response.message.id), response.message].sort((a, b) => a.id - b.id));
      } else {
        await sendEncryptedRichMessage(richComposer, metadata);
      }
      setRichComposer("");
      await refreshMessenger();
    } catch (error) {
      Alert.alert(`${richComposer.toLowerCase()} failed`, error instanceof Error ? error.message : "Could not send this item.");
    } finally {
      setThreadLoading(false);
    }
  }

  function stopLiveLocation(notifyConversation = true) {
    locationSubscription.current?.remove();
    locationSubscription.current = null;
    locationExpiresAt.current = 0;
    locationLastSentAt.current = 0;
    setSharingLocation(false);
    if (notifyConversation && activeConversationId) {
      void sendEncryptedRichMessage("LOCATION", { live: false, stopped: true, expiresAt: new Date().toISOString() })
        .catch(() => undefined);
    }
  }

  async function startLiveLocation(minutes: number) {
    setAttachmentMenuOpen(false);
    if (!activeConversationId) return;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Location permission needed", "Enable location access to share your live position in Chitthi.");
        return;
      }
      stopLiveLocation(false);
      const expiresAt = Date.now() + minutes * 60_000;
      locationExpiresAt.current = expiresAt;
      setSharingLocation(true);
      const publish = async (position: Location.LocationObject) => {
        if (Date.now() >= locationExpiresAt.current) {
          stopLiveLocation(true);
          return;
        }
        if (Date.now() - locationLastSentAt.current < 15_000) return;
        const isUpdate = locationLastSentAt.current > 0;
        locationLastSentAt.current = Date.now();
        await sendEncryptedRichMessage("LOCATION", {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy || 0),
          live: true,
          expiresAt: new Date(expiresAt).toISOString()
        }, isUpdate);
      };
      await publish(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      locationSubscription.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 25 },
        (position) => void publish(position).catch(() => undefined)
      );
    } catch (error) {
      stopLiveLocation(false);
      Alert.alert("Live location unavailable", error instanceof Error ? error.message : "Could not start location sharing.");
    }
  }

  function chooseLiveLocationDuration() {
    setAttachmentMenuOpen(false);
    Alert.alert("Share live location", "Your coordinates are end-to-end encrypted. Updates continue while FairFares is open.", [
      { text: "Cancel", style: "cancel" },
      { text: "15 minutes", onPress: () => void startLiveLocation(15) },
      { text: "1 hour", onPress: () => void startLiveLocation(60) }
    ]);
  }

  async function voteOnPoll(message: ChatMessage, optionIndex: number) {
    if (message.metadata?.closed) { Alert.alert("Poll ended", "Voting has closed for this poll."); return; }
    try {
      const response = await voteChatPoll(message.id, optionIndex);
      setMessages((current) => current.map((item) => item.id === message.id ? response.message : item));
    } catch (error) {
      Alert.alert("Vote failed", error instanceof Error ? error.message : "Could not save your vote.");
    }
  }

  function safeAttachmentName(message: ChatMessage, mimeType: string) {
    const fallbackExtension = mimeType.startsWith("image/") ? ".jpg" : mimeType.startsWith("video/") ? ".mp4" : ".bin";
    const raw = String(message.metadata?.fileName || `chitthi-${message.id}${fallbackExtension}`);
    const clean = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-120);
    return clean || `chitthi-${message.id}${fallbackExtension}`;
  }

  async function materializeAttachment(message: ChatMessage, onProgress?: (progress: number) => void) {
    let mimeType = message.metadata?.mimeType || "application/octet-stream";
    if (message.type === "IMAGE" && !mimeType.startsWith("image/")) mimeType = "image/jpeg";
    if (message.type === "VIDEO" && !mimeType.startsWith("video/")) mimeType = "video/mp4";
    let fileName = safeAttachmentName(message, mimeType);
    const encryptedKeyPayload = message.metadata?.encryptedKeyPayload;
    const encryptedMetadata = encryptedKeyPayload ? encryptedAttachmentMetadata(encryptedKeyPayload) : {};
    if (encryptedMetadata.mimeType) mimeType = encryptedMetadata.mimeType;
    if (encryptedMetadata.fileName) {
      fileName = safeAttachmentName({ ...message, metadata: { ...message.metadata, fileName: encryptedMetadata.fileName } }, mimeType);
    }
    const confirmLocalDownload = async () => {
      // Browser data URLs are memory-only, so they must not trigger permanent
      // cloud deletion. Native receipts are sent only after a durable file exists.
      if (Platform.OS !== "web" && !message.mine && message.id > 0) {
        const identity = await ensureChatDeviceIdentity();
        await confirmChatAttachmentDownloaded(message.id, identity.deviceId).catch(() => undefined);
      }
    };
    if (Platform.OS !== "web") {
      const localUri = encryptedAttachmentLocalUri(currentUserId, message.id, fileName, mimeType);
      if (localUri) {
        if (await persistentChitthiMediaExists(localUri)) {
          onProgress?.(100);
          await confirmLocalDownload();
          return { uri: localUri, name: fileName, mimeType };
        }
      }
    }
    if (!message.attachmentUrl && !message.metadata?.decryptedDataUrl) {
      throw new Error("This media is no longer available.");
    }
    if (Platform.OS !== "web" && message.type === "IMAGE" && message.attachmentUrl && !encryptedKeyPayload && !message.metadata?.decryptedDataUrl) {
      const localPreviewUri = await loadChatImagePreview(message.attachmentUrl);
      return { uri: localPreviewUri, name: fileName, mimeType: mimeType.startsWith("image/") ? mimeType : "image/jpeg" };
    }
    if (Platform.OS !== "web" && encryptedKeyPayload && message.attachmentUrl) {
      const cacheRoot = FileSystem.cacheDirectory;
      if (!cacheRoot) throw new Error("Attachment storage is unavailable on this device.");
      const encryptedUri = `${cacheRoot}chitthi-download-${message.id}-${stablePreviewHash(encryptedKeyPayload)}.ffenc`;
      const localUri = encryptedAttachmentLocalUri(currentUserId, message.id, fileName, mimeType);
      if (!localUri) throw new Error("Attachment storage is unavailable on this device.");
      try {
        const identity = await ensureChatDeviceIdentity();
        const downloadAuthorization = await getEncryptedChatAttachmentDownloadUrl(message.id, identity.deviceId);
        await downloadAuthenticatedAssetToFile(downloadAuthorization.downloadUrl, encryptedUri, (progress) => onProgress?.(Math.round(progress * 88)), false);
        onProgress?.(90);
        const chunkedDescriptor = parseChunkedAttachmentDescriptor(encryptedKeyPayload);
        if (chunkedDescriptor) {
          mimeType = chunkedDescriptor.mimeType || mimeType;
          fileName = safeAttachmentName({ ...message, metadata: { ...message.metadata, fileName: chunkedDescriptor.fileName } }, mimeType);
          const finalUri = encryptedAttachmentLocalUri(currentUserId, message.id, fileName, mimeType) || localUri;
          decryptChunkedAttachmentFile(encryptedUri, finalUri, encryptedKeyPayload);
          onProgress?.(99);
          await cleanupPersistentChitthiMedia(finalUri).catch(() => undefined);
          setLocalMediaMessageIds((current) => current.includes(message.id) ? current : [...current, message.id]);
          await confirmLocalDownload();
          onProgress?.(100);
          return { uri: finalUri, name: fileName, mimeType };
        }
        const ciphertextBase64 = await FileSystem.readAsStringAsync(encryptedUri, { encoding: FileSystem.EncodingType.Base64 });
        const decrypted = decryptAttachmentBase64(ciphertextBase64, encryptedKeyPayload);
        onProgress?.(94);
        mimeType = decrypted.mimeType || mimeType;
        fileName = safeAttachmentName({ ...message, metadata: { ...message.metadata, fileName: decrypted.fileName } }, mimeType);
        const finalUri = encryptedAttachmentLocalUri(currentUserId, message.id, fileName, mimeType) || localUri;
        await writePersistentChitthiMedia(finalUri, decrypted.base64);
        onProgress?.(99);
        await cleanupPersistentChitthiMedia(finalUri).catch(() => undefined);
        setLocalMediaMessageIds((current) => current.includes(message.id) ? current : [...current, message.id]);
        await confirmLocalDownload();
        onProgress?.(100);
        return { uri: finalUri, name: fileName, mimeType };
      } finally {
        await FileSystem.deleteAsync(encryptedUri, { idempotent: true }).catch(() => undefined);
      }
    }
    let dataUrl = message.metadata?.decryptedDataUrl || await getAuthenticatedAssetDataUrl(message.attachmentUrl);
    if (encryptedKeyPayload && !message.metadata?.decryptedDataUrl) {
      const decrypted = decryptAttachmentBase64(dataUrl.split(",", 2)[1] || "", encryptedKeyPayload);
      mimeType = decrypted.mimeType || mimeType;
      fileName = safeAttachmentName({ ...message, metadata: { ...message.metadata, fileName: decrypted.fileName } }, mimeType);
      dataUrl = `data:${mimeType};base64,${decrypted.base64}`;
    }
    if (Platform.OS === "web") return { uri: dataUrl, name: fileName, mimeType };
    const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
    if (!base64) throw new Error("The downloaded attachment is empty.");
    const localUri = encryptedAttachmentLocalUri(currentUserId, message.id, fileName, mimeType);
    if (!localUri) throw new Error("Attachment storage is unavailable on this device.");
    await writePersistentChitthiMedia(localUri, base64);
    onProgress?.(99);
    await cleanupPersistentChitthiMedia(localUri).catch(() => undefined);
    setLocalMediaMessageIds((current) => current.includes(message.id) ? current : [...current, message.id]);
    if (encryptedKeyPayload) await confirmLocalDownload();
    onProgress?.(100);
    return { uri: localUri, name: fileName, mimeType };
  }

  async function downloadAttachment(item: { uri: string; name: string; mimeType: string }) {
    if (Platform.OS === "web") {
      const anchor = document.createElement("a");
      anchor.href = item.uri;
      anchor.download = item.name;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
    if (!await Sharing.isAvailableAsync()) throw new Error("Saving and sharing are unavailable on this device.");
    await Sharing.shareAsync(item.uri, { mimeType: item.mimeType, dialogTitle: `Save or open ${item.name}`, UTI: item.mimeType });
  }

  async function openAttachment(message: ChatMessage) {
    if (downloadingMediaMessageIds.includes(message.id)) return;
    const alreadyOnDevice = localMediaMessageIds.includes(message.id);
    try {
      if (!alreadyOnDevice && Platform.OS !== "web") {
        setDownloadingMediaMessageIds((current) => current.includes(message.id) ? current : [...current, message.id]);
        setMediaDownloadProgress((current) => ({ ...current, [message.id]: 0 }));
      }
      const item = await materializeAttachment(message, (progress) => {
        if (!alreadyOnDevice && Platform.OS !== "web") {
          setMediaDownloadProgress((current) => ({ ...current, [message.id]: Math.max(current[message.id] || 0, progress) }));
        }
      });
      if (!item) return;
      if (message.type === "IMAGE" || message.type === "VIDEO") setAttachmentPreview({ ...item, messageId: message.id, type: message.type, createdAt: message.createdAt });
      else await downloadAttachment(item);
    } catch (error) {
      Alert.alert("Attachment unavailable", error instanceof Error ? error.message : "Could not open this attachment.");
    } finally {
      setDownloadingMediaMessageIds((current) => current.filter((id) => id !== message.id));
      setMediaDownloadProgress((current) => {
        const next = { ...current };
        delete next[message.id];
        return next;
      });
      setTimeout(() => setAttachmentStatus(""), 1200);
    }
  }

  async function openPhotoGroup(group: ChatMessage[]) {
    try {
      setAttachmentStatus(`Preparing ${group.length} photos…`);
      const items = await Promise.all(group.map(async (message) => {
        const item = await materializeAttachment(message);
        return item ? { ...item, createdAt: message.createdAt } : null;
      }));
      const available = items.filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (!available.length) throw new Error("These photos are unavailable.");
      setAttachmentPreview(null);
      setAttachmentPreviewGroup(available);
    } catch (error) {
      Alert.alert("Photos unavailable", error instanceof Error ? error.message : "Could not open this photo set.");
    } finally {
      setAttachmentStatus("");
    }
  }

  async function savePreviewAttachment() {
    if (!attachmentPreview) return;
    try {
      await downloadAttachment(attachmentPreview);
    } catch (error) {
      Alert.alert("Could not save attachment", error instanceof Error ? error.message : "Saving is unavailable on this device.");
    }
  }

  function showComposerOptions() {
    const willOpen = !attachmentMenuOpen;
    Keyboard.dismiss();
    setComposerFocused(false);
    setEmojiPickerOpen(false);
    setRichComposer("");
    setAttachmentMenuOpen(willOpen);
  }

  function toggleEmojiPicker() {
    const willOpen = !emojiPickerOpen;
    Keyboard.dismiss();
    setComposerFocused(false);
    setAttachmentMenuOpen(false);
    setRichComposer("");
    setEmojiPickerOpen(willOpen);
  }

  function chooseEmoji(emoji: string) {
    setMessageText((current) => `${current}${emoji}`);
    const next = [emoji, ...recentEmojis.filter((item) => item !== emoji)].slice(0, 16);
    setRecentEmojis(next);
    void AsyncStorage.setItem("fairfares.chitthi.recent-emojis", JSON.stringify(next));
  }

  function showChatOptions() {
    setChatOptionsOpen((current) => !current);
  }

  function editMessage(message: ChatMessage) {
    if (!message.canEdit) return;
    setSelectedMessageIds([]);
    setEditingMessageId(message.id);
    setMessageText(message.text);
  }

  async function deleteMessage(message: ChatMessage) {
    if (!activeConversationId || !message.canEdit) return;
    try {
      await deleteChatMessage(activeConversationId, message.id);
      setMessages((current) => current.filter((item) => item.id !== message.id));
      await refreshMessenger();
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : "Could not delete this message.");
    }
  }

  async function reportMessage(message: ChatMessage) {
    if (!activeConversationId) return;
    try {
      await reportChatMessage(activeConversationId, message.id, "Reported from mobile Messenger");
      Alert.alert("Reported", "Thanks. FairFares will review this message.");
    } catch (error) {
      Alert.alert("Report failed", error instanceof Error ? error.message : "Could not report this message.");
    }
  }

  function showMessageActions(message: ChatMessage) {
    if (attachmentPreview) {
      setAttachmentPreview(null);
      setTimeout(() => setActionMessage(message), 180);
      return;
    }
    setActionMessage(message);
  }

  function beginReply(message: ChatMessage) {
    if (["pending", "relayed", "failed"].includes(message.status)) return;
    setReplyingTo(message);
    setActionMessage(null);
  }

  async function reactToMessage(message: ChatMessage, emoji: string) {
    if (!activeConversationId || message.id <= 0) return;
    setActionMessage(null);
    try {
      const response = await reactToChatMessage(activeConversationId, message.id, emoji);
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, reactions: response.message.reactions || [] } : item));
    } catch (error) {
      Alert.alert("Reaction failed", error instanceof Error ? error.message : "Could not react to this message.");
    }
  }

  function toggleMessageSelection(message: ChatMessage) {
    const key = messageSelectionKey(message);
    setSelectedMessageIds((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function selectedMessages() {
    const selected = new Set(selectedMessageIds);
    return messages.filter((message) => selected.has(messageSelectionKey(message)));
  }

  async function shareSelectedMessages() {
    const selected = selectedMessages();
    if (!selected.length) return;
    try {
      if (selected.length === 1 && selected[0].attachmentUrl && ["IMAGE", "VIDEO", "FILE"].includes(selected[0].type)) {
        const attachment = await materializeAttachment(selected[0]);
        if (attachment) {
          await downloadAttachment(attachment);
          return;
        }
      }
      const transcript = selected.map(shareableMessageText).filter(Boolean).join("\n\n");
      if (!transcript) {
        Alert.alert("Nothing to share", "The selected messages do not contain shareable text.");
        return;
      }
      await Share.share({ title: "Chitthi messages", message: transcript });
    } catch (error) {
      Alert.alert("Share failed", error instanceof Error ? error.message : "Could not share these messages.");
    }
  }

  function openForwardPicker() {
    if (!selectedMessageIds.length) return;
    setSelectedForwardConversationIds([]);
    setForwardPickerOpen(true);
  }

  function forwardMediaFromPreview() {
    const source = visibleMessages.find((item) => item.id === attachmentPreview?.messageId);
    if (!source) return;
    setAttachmentPreview(null);
    setSelectedMessageIds([messageSelectionKey(source)]);
    setTimeout(() => {
      setSelectedForwardConversationIds([]);
      setForwardPickerOpen(true);
    }, 180);
  }

  function toggleForwardConversation(conversationId: string) {
    setSelectedForwardConversationIds((current) => current.includes(conversationId) ? current.filter((id) => id !== conversationId) : [...current, conversationId]);
  }

  async function forwardSelectedMessages() {
    const chosenMessages = selectedMessages();
    if (!chosenMessages.length || !selectedForwardConversationIds.length) return;
    setForwardingMessages(true);
    try {
      const identity = await ensureChatDeviceIdentity();
      for (const conversationId of selectedForwardConversationIds) {
        const keyPayload = await getChatDeviceKeys(conversationId);
        if (!keyPayload.ready) throw new Error(keyPayload.warning || "A selected chat is not ready for encrypted forwarding.");
        for (const message of chosenMessages) {
          if (["IMAGE", "VIDEO", "FILE"].includes(message.type) && message.attachmentUrl) {
            const attachment = await materializeAttachment(message);
            if (!attachment) continue;
            const kind = message.type as "IMAGE" | "VIDEO" | "FILE";
            if (Platform.OS === "web") {
              const fileBase64 = attachment.uri.slice(attachment.uri.indexOf(",") + 1);
              const encrypted = encryptAttachmentForDevices(fileBase64, { fileName: attachment.name, mimeType: attachment.mimeType, caption: message.text || "", kind }, identity, keyPayload.keys);
              await sendDirectEncryptedChatAttachment(conversationId, encrypted, attachment.mimeType);
            } else {
              const encrypted = encryptAttachmentFileForDevices(attachment.uri, { fileName: attachment.name, mimeType: attachment.mimeType, caption: message.text || "", kind }, identity, keyPayload.keys);
              try {
                await sendDirectEncryptedChatAttachment(conversationId, encrypted, attachment.mimeType);
              } finally {
                deleteChunkedTemporaryFile(encrypted.encryptedUri);
              }
            }
          } else {
            const text = shareableMessageText({ ...message, senderName: "" });
            if (!text) continue;
            const envelopes = encryptForDevices(text, identity, keyPayload.keys);
            await sendEncryptedChatMessage(conversationId, envelopes);
          }
        }
      }
      setForwardPickerOpen(false);
      setSelectedMessageIds([]);
      setSelectedForwardConversationIds([]);
      await refreshMessenger();
      Alert.alert("Forwarded", `${chosenMessages.length} message${chosenMessages.length === 1 ? "" : "s"} forwarded securely.`);
    } catch (error) {
      Alert.alert("Forward failed", error instanceof Error ? error.message : "Could not forward the selected messages.");
    } finally {
      setForwardingMessages(false);
    }
  }

  function closeThread() {
    if (activeConversationId) void updateChatTyping(activeConversationId, false).catch(() => undefined);
    stopLiveLocation(false);
    activateThreadConversation("");
    setActiveConversation(null);
    setActiveSubject("");
    clearThreadMessages();
    setHasMoreMessages(false);
    setNextBeforeMessageId(0);
    setLoadingOlderMessages(false);
    loadingOlderMessagesRef.current = false;
    prependScrollAnchorRef.current = null;
    messagesContentHeightRef.current = 0;
    messagesViewportHeightRef.current = 0;
    messagesScrollOffsetRef.current = 0;
    shouldAutoScrollToEndRef.current = true;
    setMessageText("");
    setTypingPeople([]);
    setEditingMessageId(null);
    setAttachmentMenuOpen(false);
    setEmojiPickerOpen(false);
    setEmojiSearch("");
    setWallpaperPanelOpen(false);
    setChatOptionsOpen(false);
    setGroupMembersOpen(false);
    setGroupMembers([]);
    setGroupMemberSearch("");
    setAttachmentStatus("");
    setPendingAttachment(null);
    setPendingImages([]);
    setAttachmentPreview(null);
    setShareContactPickerOpen(false);
    setShareableContacts([]);
    setSelectedMessageIds([]);
    setForwardPickerOpen(false);
    onClearPendingPost?.();
    onClearPendingRide?.();
    onThreadModeChange?.(false);
  }

  if (inThread) {
    return (
      <View
        style={[
          styles.threadScreen,
          Platform.OS === "android" && styles.threadScreenAndroid,
          Platform.OS === "ios" && keyboardHeight > 0
            ? { paddingBottom: Math.max(0, keyboardHeight - safeAreaInsets.bottom) }
            : null
        ]}
      >
        <View pointerEvents="none" style={[styles.wallpaperBase, { backgroundColor: wallpaperChoices.find((choice) => choice.id === wallpaper)?.color || "#080d18" }]}>
          {customWallpaper ? <Image source={{ uri: customWallpaper }} style={styles.wallpaperImage} resizeMode="cover" /> : null}
          {!customWallpaper ? <><View style={[styles.wallpaperGlow, styles.wallpaperGlowOne, { backgroundColor: wallpaperChoices.find((choice) => choice.id === wallpaper)?.accent || "#164d30" }]} /><View style={[styles.wallpaperGlow, styles.wallpaperGlowTwo, { backgroundColor: wallpaperChoices.find((choice) => choice.id === wallpaper)?.accent || "#164d30" }]} /><Text style={styles.wallpaperPattern}>⌖  ·  చి  ·  ◇  ·  ♥  ·  చి  ·  ◇</Text></> : null}
          <View style={styles.wallpaperShade} />
        </View>
        <AdaptiveGlassView
          intensity={48}
          tintColor="#08291D"
          fallbackColor="rgba(4,25,19,0.96)"
          style={styles.threadHeader}
        >
          <TouchableOpacity style={styles.backButton} onPress={closeThread} accessibilityRole="button" accessibilityLabel="Back to conversations">
            <BackIcon />
          </TouchableOpacity>
          <TouchableOpacity style={styles.threadAvatar} disabled={!activeConversation?.communityId} onPress={() => void showGroupMembers()} accessibilityLabel={activeConversation?.communityId ? "Open group info" : undefined}>
            {chatPhotoUrl(activeConversation?.otherPhotoUrl) ? (
              <Image source={{ uri: chatPhotoUrl(activeConversation?.otherPhotoUrl) }} style={styles.threadAvatarImage} />
            ) : (
              <Text style={styles.threadAvatarText}>
                {initials(activeConversation?.otherName || (pendingPost ? listingPosterName(pendingPost) : "") || (pendingRide ? rideOwnerName(pendingRide) : "") || activeSubject || "Chat")}
              </Text>
            )}
            {activeConversation?.otherOnline && !activeConversation?.communityId ? <View style={styles.activeDot} /> : null}
          </TouchableOpacity>
          <TouchableOpacity style={styles.threadHeaderCopy} disabled={!activeConversation?.communityId} onPress={() => void showGroupMembers()} accessibilityLabel={activeConversation?.communityId ? "Open group info" : undefined}>
            <Text style={styles.threadHeaderTitle} numberOfLines={1}>
              {activeConversation?.otherName || (pendingPost ? listingPosterName(pendingPost) : "") || (pendingRide ? rideOwnerName(pendingRide) : "") || "Chitthi"}
            </Text>
            <Text style={styles.threadHeaderMeta} numberOfLines={1}>
              {`${presenceLabel(activeConversation)} · ${encryptionReady ? "🔒 End-to-end encrypted" : "Encryption setup pending"}`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerAction} onPress={showChatOptions} accessibilityLabel="Chat options"><DotsIcon /></TouchableOpacity>
        </AdaptiveGlassView>

        {selectedMessageIds.length ? (
          <View style={styles.messageSelectionBar}>
            <TouchableOpacity style={styles.messageSelectionCancel} onPress={() => setSelectedMessageIds([])} accessibilityLabel="Cancel message selection"><Text style={styles.messageSelectionCancelText}>×</Text></TouchableOpacity>
            <Text style={styles.messageSelectionTitle}>{selectedMessageIds.length} selected</Text>
            {selectedMessages().length === 1 && selectedMessages()[0].mine && selectedMessages()[0].canEdit ? (
              <TouchableOpacity style={styles.messageSelectionAction} onPress={() => editMessage(selectedMessages()[0])} accessibilityRole="button" accessibilityLabel="Edit selected message"><Text style={styles.messageSelectionActionIcon}>✎</Text><Text style={styles.messageSelectionActionText}>Edit</Text></TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.messageSelectionAction} onPress={openForwardPicker} accessibilityRole="button" accessibilityLabel="Forward selected messages"><Text style={styles.messageSelectionActionIcon}>↗</Text><Text style={styles.messageSelectionActionText}>Forward</Text></TouchableOpacity>
            <TouchableOpacity style={styles.messageSelectionAction} onPress={() => void shareSelectedMessages()} accessibilityRole="button" accessibilityLabel="Share selected messages"><Text style={styles.messageSelectionActionIcon}>⇧</Text><Text style={styles.messageSelectionActionText}>Share</Text></TouchableOpacity>
          </View>
        ) : null}

        {chatOptionsOpen ? (
          <>
          <TouchableOpacity
            activeOpacity={1}
            style={styles.chatOptionsBackdrop}
            onPress={() => setChatOptionsOpen(false)}
            accessibilityLabel="Close chat options"
          />
          <View style={styles.chatOptionsPanel}>
            <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); void toggleMute(); }}><Text style={styles.chatOptionIcon}>◉</Text><Text style={styles.chatOptionText}>{activeConversation?.mutedAt ? "Unmute notifications" : "Mute notifications"}</Text></TouchableOpacity>
            {!activeConversation?.communityId ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); void toggleBlock(); }}><Text style={styles.chatOptionIcon}>⊘</Text><Text style={styles.chatOptionText}>{activeConversation?.blockedAt ? "Unblock member" : "Block member"}</Text></TouchableOpacity> : null}
            {activeConversation?.communityId ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => void showGroupMembers()}><Text style={styles.chatOptionIcon}>ⓘ</Text><Text style={styles.chatOptionText}>Group info</Text></TouchableOpacity> : null}
            {activeConversation?.communityId && (() => { const group = communities.find((item) => item.id === activeConversation.communityId); return Boolean(group?.canManageMembers); })() ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); setSelectedGroupPeople([]); void findPeopleFromContacts("add", activeConversation.communityId || ""); }}><Text style={styles.chatOptionIcon}>＋</Text><Text style={styles.chatOptionText}>Add people</Text></TouchableOpacity> : null}
            {activeConversation?.communityId && (() => { const group = communities.find((item) => item.id === activeConversation.communityId); return Boolean(group?.canManageMembers); })() ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => void changeActiveGroupPhoto()}><Text style={styles.chatOptionIcon}>▣</Text><Text style={styles.chatOptionText}>Change group image</Text></TouchableOpacity> : null}
            {activeConversation?.communityId && (() => { const group = communities.find((item) => item.id === activeConversation.communityId); return Boolean(group && (group.visibility === "PUBLIC" || group.canManageMembers)); })() ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => void inviteToActiveGroup()}><Text style={styles.chatOptionIcon}>↗</Text><Text style={styles.chatOptionText}>Invite with group link</Text></TouchableOpacity> : null}
            <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); setWallpaperPanelOpen(true); }}><Text style={styles.chatOptionIcon}>▧</Text><Text style={styles.chatOptionText}>Chat wallpaper</Text></TouchableOpacity>
            {Platform.OS === "android" ? <View style={styles.nearbyOptionRow}><View style={styles.nearbyOptionCopy}><Text style={styles.nearbyOptionTitle}>Nearby offline relay</Text><Text style={styles.nearbyOptionMeta}>{nearbyRelayStatus.state === "error" ? nearbyRelayStatus.detail : nearbyRelayEnabled ? `${nearbyRelayStatus.peers} nearby device${nearbyRelayStatus.peers === 1 ? "" : "s"}` : "Off · encrypted text only"}</Text></View><Switch value={nearbyRelayEnabled} onValueChange={(value) => void toggleNearbyRelay(value)} trackColor={{ false: "#aaa", true: "#5a83f3" }} /></View> : null}
          </View>
          </>
        ) : null}

        {groupMembersOpen ? (
          <View style={styles.groupInfoPanel}>
            <View style={styles.groupInfoHeader}>
              <TouchableOpacity style={styles.groupInfoHeaderButton} onPress={() => setGroupMembersOpen(false)} accessibilityLabel="Close group info"><Text style={styles.groupInfoHeaderButtonText}>‹</Text></TouchableOpacity>
              <Text style={styles.groupInfoHeaderTitle}>Group info</Text>
              <TouchableOpacity style={styles.groupInfoDoneButton} onPress={() => setGroupMembersOpen(false)}><Text style={styles.groupInfoDoneText}>Done</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.groupInfoScroll} contentContainerStyle={styles.groupInfoContent}>
              <View style={styles.groupInfoHero}>
                <TouchableOpacity style={styles.groupInfoAvatar} disabled={!activeGroup?.canManageMembers} onPress={() => void changeActiveGroupPhoto()} accessibilityLabel={activeGroup?.canManageMembers ? "Change group image" : "Group image"}>
                  {chatPhotoUrl(activeGroup?.photoUrl || activeConversation?.otherPhotoUrl) ? <Image source={{ uri: chatPhotoUrl(activeGroup?.photoUrl || activeConversation?.otherPhotoUrl) }} style={styles.groupInfoAvatarImage} /> : <Text style={styles.groupInfoAvatarText}>{initials(activeGroup?.name || activeConversation?.otherName || "Group")}</Text>}
                  {activeGroup?.canManageMembers ? <View style={styles.groupInfoEditBadge}><Text style={styles.groupInfoEditBadgeText}>✎</Text></View> : null}
                </TouchableOpacity>
                <Text style={styles.groupInfoTitle}>{activeGroup?.name || activeConversation?.otherName || "Chitthi group"}</Text>
                <Text style={styles.groupInfoMeta}>{activeGroup?.visibility === "PRIVATE" ? "Private group" : "Community"} · {groupMembers.length || activeGroup?.memberCount || 0} members</Text>
              </View>

              <View style={styles.groupInfoActions}>
                <TouchableOpacity style={styles.groupInfoAction} onPress={() => void toggleMute()}><Text style={styles.groupInfoActionIcon}>♩</Text><Text style={styles.groupInfoActionLabel}>{activeConversation?.mutedAt ? "Unmute" : "Mute"}</Text></TouchableOpacity>
                {activeGroup?.canManageMembers ? <TouchableOpacity style={styles.groupInfoAction} onPress={() => { setGroupMembersOpen(false); setSelectedGroupPeople([]); void findPeopleFromContacts("add", activeConversation?.communityId || ""); }}><Text style={styles.groupInfoActionIcon}>＋</Text><Text style={styles.groupInfoActionLabel}>Add</Text></TouchableOpacity> : null}
                {activeGroup && (activeGroup.visibility === "PUBLIC" || activeGroup.canManageMembers) ? <TouchableOpacity style={styles.groupInfoAction} onPress={() => void inviteToActiveGroup()}><Text style={styles.groupInfoActionIcon}>↗</Text><Text style={styles.groupInfoActionLabel}>Invite</Text></TouchableOpacity> : null}
              </View>

              <View style={styles.groupInfoCard}>
                <Text style={styles.groupInfoDescription}>{activeGroup?.description || "A Chitthi group for members to connect, share updates, and help each other."}</Text>
                {activeGroup?.area ? <Text style={styles.groupInfoDescriptionMeta}>⌖ {activeGroup.area}</Text> : null}
              </View>

              <View style={styles.groupInfoCard}>
                <TouchableOpacity style={styles.groupInfoSettingRow} onPress={() => void toggleMute()}><Text style={styles.groupInfoSettingIcon}>♩</Text><View style={styles.groupInfoSettingCopy}><Text style={styles.groupInfoSettingTitle}>Notifications</Text><Text style={styles.groupInfoSettingMeta}>{activeConversation?.mutedAt ? "Muted" : "On"}</Text></View><Text style={styles.groupInfoChevron}>›</Text></TouchableOpacity>
                <TouchableOpacity style={styles.groupInfoSettingRow} onPress={() => { setGroupMembersOpen(false); setWallpaperPanelOpen(true); }}><Text style={styles.groupInfoSettingIcon}>◉</Text><View style={styles.groupInfoSettingCopy}><Text style={styles.groupInfoSettingTitle}>Chat theme</Text><Text style={styles.groupInfoSettingMeta}>Choose a Chitthi wallpaper</Text></View><Text style={styles.groupInfoChevron}>›</Text></TouchableOpacity>
                <View style={[styles.groupInfoSettingRow, styles.groupInfoSettingRowLast]}><Text style={styles.groupInfoSettingIcon}>▢</Text><View style={styles.groupInfoSettingCopy}><Text style={styles.groupInfoSettingTitle}>Encryption</Text><Text style={styles.groupInfoSettingMeta}>Messages are end-to-end encrypted</Text></View></View>
              </View>

              <View style={styles.groupMembersSection}>
                <Text style={styles.groupMembersHeading}>{groupMembers.length} members</Text>
                <View style={styles.groupMembersSearch}><Text style={styles.groupMembersSearchIcon}>⌕</Text><TextInput value={groupMemberSearch} onChangeText={setGroupMemberSearch} placeholder="Search members" placeholderTextColor="#7B817D" style={styles.groupMembersSearchInput} autoCapitalize="none" /></View>
                {activeGroup?.canManageMembers ? <TouchableOpacity style={styles.groupMemberRow} onPress={() => { setGroupMembersOpen(false); setSelectedGroupPeople([]); void findPeopleFromContacts("add", activeConversation?.communityId || ""); }}><View style={[styles.groupMemberAvatar, styles.groupMemberAddAvatar]}><Text style={styles.groupMemberAddIcon}>＋</Text></View><View style={styles.groupMemberCopy}><Text style={styles.groupMemberAddText}>Add members</Text><Text style={styles.groupMemberSubtext}>Invite people to this group</Text></View><Text style={styles.groupMemberChevron}>›</Text></TouchableOpacity> : null}
                {filteredGroupMembers.map((member) => {
                  const currentRole = groupMembers.find((item) => item.isCurrentUser)?.role || "MEMBER";
                  const canManage = !member.isCurrentUser && member.role !== "OWNER" && (currentRole === "OWNER" || (currentRole === "ADMIN" && member.role === "MEMBER"));
                  return <TouchableOpacity key={member.id} style={styles.groupMemberRow} disabled={member.isCurrentUser} activeOpacity={0.65} onPress={() => void messageGroupMember(member)} onLongPress={canManage ? () => showGroupMemberActions(member) : undefined} accessibilityLabel={member.isCurrentUser ? `${member.name}, you` : `Message ${member.name} privately`}>
                    <View style={styles.groupMemberAvatar}>{chatPhotoUrl(member.photoUrl) ? <Image source={{ uri: chatPhotoUrl(member.photoUrl) }} style={styles.groupMemberAvatarImage} /> : <Text style={styles.groupMemberAvatarText}>{initials(member.name)}</Text>}</View>
                    <View style={styles.groupMemberCopy}><View style={styles.groupMemberNameLine}><Text style={styles.groupMemberName}>{member.name}</Text>{member.isCurrentUser ? <Text style={styles.groupMemberCurrentTag}>You</Text> : null}</View><Text style={styles.groupMemberSubtext}>{member.isCurrentUser ? "Add a member tag" : "Tap to message privately"}</Text></View>
                    {member.role !== "MEMBER" ? <Text style={styles.groupMemberRole}>{member.role === "OWNER" ? "Owner" : "Admin"}</Text> : null}
                    {canManage ? <TouchableOpacity style={styles.groupMemberManageButton} onPress={() => showGroupMemberActions(member)} accessibilityLabel={`Manage ${member.name}`}><Text style={styles.groupMemberManageIcon}>•••</Text></TouchableOpacity> : !member.isCurrentUser ? <Text style={styles.groupMemberChevron}>›</Text> : null}
                  </TouchableOpacity>;
                })}
                {!filteredGroupMembers.length ? <Text style={styles.groupMembersEmpty}>No members match your search.</Text> : null}
              </View>
              <TouchableOpacity style={styles.leaveGroupButton} onPress={() => Alert.alert("Leave this group?", "You will stop receiving messages from this group.", [{ text: "Cancel", style: "cancel" }, { text: "Leave group", style: "destructive", onPress: () => void leaveActiveGroup() }])}><Text style={styles.leaveGroupText}>Leave group</Text></TouchableOpacity>
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.threadMessages}>
          <FlatList
            ref={messagesScrollRef}
            style={styles.threadMessagesList}
            data={threadMessageItems}
            inverted
            keyExtractor={(item) => String(item.message.id)}
            contentContainerStyle={styles.threadMessagesContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            scrollEventThrottle={32}
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={32}
            windowSize={7}
            removeClippedSubviews={Platform.OS !== "web"}
            onLayout={(event) => { messagesViewportHeightRef.current = event.nativeEvent.layout.height; }}
            onScrollBeginDrag={(event) => {
              markThreadTouched();
              messagesUserDraggingRef.current = true;
              const offset = Math.max(0, event.nativeEvent.contentOffset.y);
              messagesScrollOffsetRef.current = offset;
              updateJumpToLatestVisibility(offset);
              const distanceFromOlderEdge = Math.max(0, event.nativeEvent.contentSize.height - (offset + event.nativeEvent.layoutMeasurement.height));
              if (!loadingOlderMessagesRef.current && distanceFromOlderEdge <= 140) void loadOlderMessages();
            }}
            onScrollEndDrag={(event) => {
              const offset = Math.max(0, event.nativeEvent.contentOffset.y);
              messagesScrollOffsetRef.current = offset;
              updateJumpToLatestVisibility(offset);
              const distanceFromOlderEdge = Math.max(0, event.nativeEvent.contentSize.height - (offset + event.nativeEvent.layoutMeasurement.height));
              if (!loadingOlderMessagesRef.current && distanceFromOlderEdge <= 140) void loadOlderMessages();
            }}
            onMomentumScrollEnd={(event) => {
              const offset = Math.max(0, event.nativeEvent.contentOffset.y);
              messagesScrollOffsetRef.current = offset;
              updateJumpToLatestVisibility(offset);
              const distanceFromOlderEdge = Math.max(0, event.nativeEvent.contentSize.height - (offset + event.nativeEvent.layoutMeasurement.height));
              if (messagesUserDraggingRef.current && !loadingOlderMessagesRef.current && distanceFromOlderEdge <= 140) void loadOlderMessages();
              messagesUserDraggingRef.current = false;
            }}
            onScroll={(event) => {
              const offset = Math.max(0, event.nativeEvent.contentOffset.y);
              messagesScrollOffsetRef.current = offset;
              updateJumpToLatestVisibility(offset);
              messagesContentHeightRef.current = Math.max(messagesContentHeightRef.current, event.nativeEvent.contentSize.height);
              messagesViewportHeightRef.current = event.nativeEvent.layoutMeasurement.height;
              shouldAutoScrollToEndRef.current = offset <= 120;
              if (!shouldAutoScrollToEndRef.current) markThreadTouched();
              const distanceFromOlderEdge = Math.max(0, event.nativeEvent.contentSize.height - (offset + event.nativeEvent.layoutMeasurement.height));
              if (messagesUserDraggingRef.current && !loadingOlderMessagesRef.current && distanceFromOlderEdge <= 140) void loadOlderMessages();
            }}
            onContentSizeChange={(_width, height) => {
              const anchor = prependScrollAnchorRef.current;
              messagesContentHeightRef.current = height;
              if (anchor) {
                prependScrollAnchorRef.current = null;
                settlePrependedScroll(anchor, height);
                return;
              }
              if (openingThreadToLatestRef.current && shouldAutoScrollToEndRef.current && !messagesUserDraggingRef.current) {
                const lastMessage = visibleMessages[visibleMessages.length - 1];
                lastAutoScrolledMessageKeyRef.current = `${activeConversationId}:${lastMessage?.id || "empty"}:${visibleMessages.length}`;
                openingThreadToLatestRef.current = false;
                if (openingThreadSettleTimer.current) {
                  clearTimeout(openingThreadSettleTimer.current);
                  openingThreadSettleTimer.current = null;
                }
              }
            }}
            ListFooterComponent={
              <View style={styles.threadListFooter}>
                {loadingOlderMessages ? <View pointerEvents="none" style={[styles.olderMessagesStatusWrap, styles.invertedListChrome]}><Text style={styles.olderMessagesStatus}>Loading earlier messages…</Text></View> : null}
                {!loadingOlderMessages && hasMoreMessages ? (
                  <TouchableOpacity style={[styles.olderMessagesButton, styles.invertedListChrome]} onPress={() => void loadOlderMessages()}>
                    <Text style={styles.olderMessagesButtonText}>Load earlier messages</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <View style={[styles.threadListEmpty, styles.invertedListChrome]}>
                {threadLoading && !messages.length && !pendingChatContext ? <View style={styles.loadingThreadShell}><Text style={styles.emptyText}>Loading messages…</Text></View> : null}
                {!threadLoading && !messages.length && !pendingChatContext ? (
                  <View style={styles.emptyThread}>
                    <Text style={styles.emptyThreadTitle}>No messages yet.</Text>
                    <Text style={styles.emptyThreadCopy}>Send a message to start the conversation.</Text>
                  </View>
                ) : null}
              </View>
            }
            renderItem={({ item }) => {
            const { message, skipForMediaGroup, mediaGroup, discoveredUrl, isPhotoMessage, messageRunEnds, replyTarget, showDateDivider } = item;
            if (skipForMediaGroup) return null;
            const mediaDownloading = downloadingMediaMessageIds.includes(message.id);
            const mediaProgress = mediaDownloadProgress[message.id] || 0;
            return (
            <View key={message.id} style={styles.threadMessageCell}>
            <SwipeToReply onReply={() => beginReply(message)}><View style={[styles.threadMessageRow, message.mine && styles.threadMessageRowMine, messageRunEnds && styles.threadMessageRunEnd]}>
              {!message.mine && Boolean(activeConversation?.communityId) && messageRunEnds ? (
                <View style={styles.smallAvatar}>
                  {chatPhotoUrl(message.senderPhotoUrl) ? <Image source={{ uri: chatPhotoUrl(message.senderPhotoUrl) }} style={styles.smallAvatarImage} /> : <Text style={styles.smallAvatarText}>{initials(message.senderName || "F")}</Text>}
                </View>
              ) : !message.mine && Boolean(activeConversation?.communityId) ? <View style={styles.smallAvatarSpacer} /> : null}
              <TouchableOpacity
                activeOpacity={selectedMessageIds.length ? 0.78 : 1}
                delayLongPress={350}
                onLongPress={() => showMessageActions(message)}
                onPress={() => { if (selectedMessageIds.length) toggleMessageSelection(message); }}
                style={[styles.bubble, isPhotoMessage && styles.photoBubble, message.mine ? styles.myBubble : styles.theirBubble, isPhotoMessage && (message.mine ? styles.myPhotoBubble : styles.theirPhotoBubble), selectedMessageIds.includes(messageSelectionKey(message)) && styles.selectedMessageBubble]}
              >
                {selectedMessageIds.includes(messageSelectionKey(message)) ? <View style={styles.messageSelectionCheck}><Text style={styles.messageSelectionCheckText}>✓</Text></View> : null}
                {messageRunEnds ? <View style={[styles.bubbleTail, message.mine ? styles.myBubbleTail : styles.theirBubbleTail]} /> : null}
                {!message.mine && Boolean(activeConversation?.communityId) ? <View style={[styles.senderLine, isPhotoMessage && styles.photoSenderLine]}><Text style={[styles.senderName, isPhotoMessage && styles.photoSenderName]} numberOfLines={1}>{message.senderName || activeConversation?.otherName}</Text></View> : null}
                {message.replyToMessageId ? <View style={[styles.quotedReply, message.mine ? styles.myQuotedReply : styles.theirQuotedReply]}><Text style={styles.quotedReplyName}>{replyTarget ? (replyTarget.mine ? "You" : replyTarget.senderName) : "Original message"}</Text><Text style={styles.quotedReplyText} numberOfLines={2}>{replyTarget ? (shareableMessageText({ ...replyTarget, senderName: "" }) || "Attachment") : "Message unavailable"}</Text></View> : null}
                {message.contextTitle ? (
                  <View style={[styles.messageContext, message.mine ? styles.myMessageContext : styles.theirMessageContext]}>
                    <Text style={[styles.messageContextType, message.mine ? styles.myMessageContextType : styles.theirMessageContextType]}>
                      {message.contextType === "CARPOOL" ? "Carpool listing" : "Housing listing"}
                      {message.contextOwnerName ? ` · ${message.contextOwnerName}` : ""}
                    </Text>
                    <Text style={[styles.messageContextTitle, message.mine ? styles.myMessageContextTitle : styles.theirMessageContextTitle]} numberOfLines={2}>
                      {message.contextTitle}
                    </Text>
                    {message.contextSubtitle ? (
                      <Text style={[styles.messageContextSubtitle, message.mine ? styles.myMessageContextSubtitle : styles.theirMessageContextSubtitle]} numberOfLines={2}>
                        {message.contextSubtitle}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {message.attachmentUrl ? (
                  message.type === "IMAGE" ? <View style={styles.photoMediaWrap}>{mediaGroup.length > 1 ? <View style={styles.messageCollage}>{mediaGroup.slice(0, 4).map((photo, photoIndex) => <TouchableOpacity key={photo.id} style={styles.collageCell} onPress={() => void openPhotoGroup(mediaGroup)} accessibilityLabel={`Open all ${mediaGroup.length} photos`}><ChatMessagePhoto message={photo} compact /><View style={styles.collageTimeOverlay}><Text style={styles.collageTimeText}>{chatClock(photo.createdAt)}</Text></View>{photoIndex === 3 && mediaGroup.length > 4 ? <View style={styles.collageMore}><Text style={styles.collageMoreText}>+{mediaGroup.length - 3}</Text></View> : null}</TouchableOpacity>)}</View> : <TouchableOpacity onPress={() => void openAttachment(message)} accessibilityLabel="Preview photo"><ChatMessagePhoto message={message} /></TouchableOpacity>}{mediaGroup.length <= 1 ? <View style={styles.photoTimeOverlay}><Text style={styles.photoTimeText}>{chatClock(message.createdAt)}</Text>{message.mine && messageReceipt(message.status) ? <Text style={[styles.photoReceipt, message.status === "seen" && styles.receiptSeen]}>{messageReceipt(message.status)}</Text> : null}</View> : null}</View> : message.type === "VIDEO" ? (
                    <TouchableOpacity
                      style={styles.videoMessageCard}
                      delayLongPress={350}
                      onLongPress={() => showMessageActions(message)}
                      onPress={() => void openAttachment(message)}
                      accessibilityLabel="Play video"
                    >
                      {mediaDownloading ? (
                        <View style={styles.videoDownloadOverlay} pointerEvents="none">
                          {Platform.OS === "web" ? <View style={styles.videoDownloadBlurFallback} /> : <BlurView intensity={24} tint="dark" style={styles.videoDownloadBlurFallback} />}
                          <CircularDownloadProgress progress={mediaProgress} />
                        </View>
                      ) : null}
                      <View style={styles.videoMessagePlay}><Text style={styles.videoMessagePlayText}>▶</Text></View>
                      <Text style={styles.videoMessageTitle}>Video</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.fileCard} onPress={() => void openAttachment(message)} accessibilityRole="button" accessibilityLabel={`Open or save ${String(message.metadata?.fileName || "Chitthi file")}`}>
                      <View style={[styles.attachmentIcon, styles.fileIcon, styles.fileCardIcon]}><Text style={styles.fileCardBadge}>{chatFileBadge(String(message.metadata?.fileName || ""), String(message.metadata?.mimeType || ""))}</Text></View>
                      <View style={styles.fileCardCopy}><Text style={styles.fileCardName} numberOfLines={2}>{message.metadata?.fileName || "Chitthi file"}</Text><Text style={styles.fileCardMeta}>{Math.max(1, Math.round(Number(message.metadata?.size || 0) / 1024))} KB</Text></View>
                    </TouchableOpacity>
                  )
                ) : null}
                {!message.attachmentUrl && message.metadata?.mediaExpired ? (
                  <TouchableOpacity style={styles.expiredMediaCard} onPress={() => void openAttachment(message)} accessibilityRole="button" accessibilityLabel="Open downloaded media on this device">
                    <Text style={styles.expiredMediaIcon}>{message.type === "VIDEO" ? "🎥" : message.type === "FILE" ? "📎" : "📷"}</Text>
                    <View style={styles.expiredMediaCopy}>
                      <Text style={styles.expiredMediaTitle}>{localMediaMessageIds.includes(message.id) ? (message.type === "VIDEO" ? "Video" : message.type === "FILE" ? "File" : "Photo") : "Media unavailable"}</Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
                {message.type === "POLL" ? (
                  <View style={styles.richCard}>
                    <Text style={styles.richEyebrow}>CHITTHI POLL</Text><Text style={styles.richTitle}>{message.metadata?.question || message.text}</Text>
                    <Text style={styles.pollMeta}>{message.metadata?.allowMultiple ? "Select one or more" : "Select one"} · {message.metadata?.anonymous !== false ? "Names hidden" : "Names visible"}{message.metadata?.closed ? " · Poll ended" : message.metadata?.expiresAt ? ` · Ends ${new Date(message.metadata.expiresAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</Text>
                    {(message.metadata?.options || []).map((option, index) => {
                      const count = message.metadata?.voteCounts?.[index] || 0;
                      const selected = message.metadata?.selectedOptions?.includes(index) || message.metadata?.selectedOption === index;
                      const percent = Math.min(100, Math.round((count / Math.max(1, message.metadata?.totalVotes || 0)) * 100));
                      return <TouchableOpacity key={`${message.id}-${index}`} style={[styles.pollOption, selected && styles.pollOptionSelected, message.metadata?.closed && styles.pollOptionClosed]} disabled={message.metadata?.closed} onPress={() => void voteOnPoll(message, index)} accessibilityRole="button" accessibilityLabel={`Vote for ${option}. ${count} vote${count === 1 ? "" : "s"}`}><View style={[styles.pollProgress, { width: `${percent}%` }]} /><View style={[styles.pollChoiceMark, selected && styles.pollChoiceMarkSelected]}>{selected ? <Text style={styles.pollChoiceCheck}>✓</Text> : null}</View><View style={styles.pollOptionCopy}><View style={styles.pollOptionLine}><Text style={[styles.pollOptionText, selected && styles.pollOptionTextSelected]}>{option}</Text><Text style={[styles.pollCount, selected && styles.pollOptionTextSelected]}>{count}</Text></View><Text style={styles.pollPercent}>{percent}%</Text></View></TouchableOpacity>;
                    })}
                    <Text style={styles.pollFooter}>{message.metadata?.totalVotes || 0} participant{message.metadata?.totalVotes === 1 ? "" : "s"} · Results update live</Text>
                  </View>
                ) : null}
                {message.type === "EVENT" ? <View style={styles.richCard}><Text style={styles.richEyebrow}>EVENT</Text><Text style={styles.richTitle}>{message.metadata?.title}</Text><Text style={styles.richDetail}>▦ {message.metadata?.date}{message.metadata?.time ? ` · ${message.metadata.time}` : ""}</Text>{message.metadata?.location ? <Text style={styles.richDetail}>⌖ {message.metadata.location}</Text> : null}</View> : null}
                {message.type === "CONTACT" ? <View style={styles.richCard}><Text style={styles.richEyebrow}>CONTACT</Text><Text style={styles.richTitle}>{message.metadata?.name}</Text>{message.metadata?.phone ? <TouchableOpacity onPress={() => Linking.openURL(`tel:${message.metadata?.phone}`)}><Text style={styles.richLink}>☎ {message.metadata.phone}</Text></TouchableOpacity> : null}{message.metadata?.email ? <TouchableOpacity onPress={() => Linking.openURL(`mailto:${message.metadata?.email}`)}><Text style={styles.richLink}>✉ {message.metadata.email}</Text></TouchableOpacity> : null}</View> : null}
                {message.type === "LOCATION" ? (
                  <View style={styles.locationCard}>
                    <Text style={styles.locationIcon}>⌖</Text>
                    <View style={styles.locationCopy}>
                      <Text style={styles.locationTitle}>{message.metadata?.stopped ? "Live location ended" : "Live location"}</Text>
                      <Text style={styles.locationMeta}>{message.metadata?.stopped ? "Sharing was stopped" : message.metadata?.expiresAt ? `Shared until ${chatClock(message.metadata.expiresAt)}` : "Encrypted location"}</Text>
                      {typeof message.metadata?.latitude === "number" && typeof message.metadata?.longitude === "number" ? <TouchableOpacity onPress={() => Linking.openURL(mapCoordinatesUrl(message.metadata!.latitude as number, message.metadata!.longitude as number))} accessibilityRole="link" accessibilityLabel={`Open shared location in ${nativeMapProviderName}`}><Text style={styles.richLink}>Open in {nativeMapProviderName}</Text></TouchableOpacity> : null}
                    </View>
                  </View>
                ) : null}
                {message.text && !["POLL", "EVENT", "CONTACT", "LOCATION"].includes(message.type) ? <DiscoveredMessageText message={message.text} mine={message.mine} /> : null}
                {discoveredUrl ? (
                  <WebsitePreviewCard
                    url={discoveredUrl}
                    mine={message.mine}
                    onOpen={() => {
                      if (/community_id=|\/(?:chitthi|fchat)\/group/i.test(discoveredUrl)) {
                        try { void confirmGroupInvitation(`community:${new URL(discoveredUrl).searchParams.get("community_id") || ""}`); } catch { void Linking.openURL(discoveredUrl); }
                      } else if (/group_invite=|\/(?:chitthi|fchat)\/invite\//i.test(discoveredUrl) || discoveredUrl.startsWith("fairfares://")) {
                        void confirmGroupInvitation(discoveredUrl);
                      } else {
                        void Linking.openURL(discoveredUrl);
                      }
                    }}
                  />
                ) : null}
                {!isPhotoMessage ? <View style={styles.bubbleMetaRow} accessibilityLabel={`${chatClock(message.createdAt)}${message.mine ? `, ${messageReceiptLabel(message.status)}` : ""}`}>
                  {message.editedAt ? <Text style={[styles.bubbleMeta, message.mine ? styles.myBubbleMeta : styles.theirBubbleMeta]}>Edited · </Text> : null}
                  <Text style={[styles.bubbleMeta, message.mine ? styles.myBubbleMeta : styles.theirBubbleMeta]}>{chatClock(message.createdAt)}</Text>
                  {message.mine && messageReceipt(message.status) ? <Text style={[styles.receiptMark, message.status === "seen" && styles.receiptSeen, message.status === "failed" && styles.receiptFailed]}>{messageReceipt(message.status)}</Text> : null}
                </View> : null}
                {(message.reactions || []).length ? <View style={styles.messageReactions}>{message.reactions!.map((reaction) => <TouchableOpacity key={reaction.emoji} style={[styles.messageReactionChip, reaction.mine && styles.messageReactionChipMine]} onPress={() => void reactToMessage(message, reaction.emoji)}><Text style={styles.messageReactionEmoji}>{reaction.emoji}</Text>{reaction.count > 1 ? <Text style={styles.messageReactionCount}>{reaction.count}</Text> : null}</TouchableOpacity>)}</View> : null}
              </TouchableOpacity>
            </View></SwipeToReply>
            {showDateDivider ? <View style={styles.dateDivider}><View style={styles.dateDividerLine} /><Text style={styles.dateDividerText}>{chatDayLabel(message.createdAt)}</Text><View style={styles.dateDividerLine} /></View> : null}
            </View>
            );
            }}
          />
          {jumpToLatestVisible ? (
            <TouchableOpacity
              style={styles.jumpToLatestButton}
              activeOpacity={0.86}
              onPress={() => scrollThreadToLatest(true)}
              accessibilityRole="button"
              accessibilityLabel="Jump to latest messages"
            >
              <Text style={styles.jumpToLatestButtonText}>⌄</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Modal visible={Boolean(actionMessage)} transparent animationType="fade" statusBarTranslucent hardwareAccelerated onRequestClose={() => setActionMessage(null)}>
          <View style={styles.messageActionBackdrop}>
            {Platform.OS === "web" || actionMessage?.type === "VIDEO" ? <View style={styles.messageActionBlurFallback} /> : <BlurView intensity={34} tint="dark" style={styles.messageActionBlurFallback} />}
            <TouchableOpacity activeOpacity={1} style={styles.messageActionDismissLayer} onPress={() => setActionMessage(null)} accessibilityLabel="Close message actions" />
            {actionMessage ? (
              <View style={[styles.messageActionStack, actionMessage.mine && styles.messageActionStackMine]}>
                <View style={[styles.messageReactionTray, actionMessage.mine && styles.messageReactionTrayMine]}>
                  {["👍", "❤️", "😂", "😮", "😢", "🙏", "👏"].map((emoji) => (
                    <TouchableOpacity key={emoji} style={styles.messageReactionChoice} onPress={() => void reactToMessage(actionMessage, emoji)} accessibilityRole="button" accessibilityLabel={`React ${emoji}`}>
                      <Text style={styles.messageReactionChoiceText}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={styles.messageReactionMore} onPress={() => Alert.alert("More reactions", "Use one of these quick reactions for now.")} accessibilityRole="button" accessibilityLabel="More reactions">
                    <Text style={styles.messageReactionMoreText}>＋</Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.messageActionPreviewRow, actionMessage.mine && styles.messageActionPreviewRowMine]}>
                  <View style={[styles.bubble, actionMessage.type === "IMAGE" && actionMessage.attachmentUrl && styles.photoBubble, actionMessage.mine ? styles.myBubble : styles.theirBubble, actionMessage.type === "IMAGE" && actionMessage.attachmentUrl && (actionMessage.mine ? styles.myPhotoBubble : styles.theirPhotoBubble), styles.messageActionPreviewBubble]}>
                    {actionMessage.attachmentUrl && actionMessage.type === "IMAGE" ? <ChatMessagePhoto message={actionMessage} /> : null}
                    {actionMessage.text && !["POLL", "EVENT", "CONTACT", "LOCATION"].includes(actionMessage.type) ? <DiscoveredMessageText message={actionMessage.text} mine={actionMessage.mine} /> : null}
                    {!actionMessage.text && actionMessage.type !== "IMAGE" ? <Text style={[styles.bubbleText, actionMessage.mine ? styles.myBubbleText : styles.theirBubbleText]}>{shareableMessageText(actionMessage) || "Message"}</Text> : null}
                    <View style={styles.bubbleMetaRow}><Text style={[styles.bubbleMeta, actionMessage.mine ? styles.myBubbleMeta : styles.theirBubbleMeta]}>{chatClock(actionMessage.createdAt)}</Text>{actionMessage.mine && messageReceipt(actionMessage.status) ? <Text style={[styles.receiptMark, actionMessage.status === "seen" && styles.receiptSeen, actionMessage.status === "failed" && styles.receiptFailed]}>{messageReceipt(actionMessage.status)}</Text> : null}</View>
                    {(actionMessage.reactions || []).length ? <View style={styles.messagePreviewReactions}>{actionMessage.reactions!.map((reaction) => <TouchableOpacity key={reaction.emoji} style={[styles.messageReactionChip, reaction.mine && styles.messageReactionChipMine]} onPress={() => void reactToMessage(actionMessage, reaction.emoji)}><Text style={styles.messageReactionEmoji}>{reaction.emoji}</Text>{reaction.count > 1 ? <Text style={styles.messageReactionCount}>{reaction.count}</Text> : null}</TouchableOpacity>)}</View> : null}
                  </View>
                </View>
                <View style={[styles.messageActionSheet, actionMessage.mine && styles.messageActionSheetMine]}>
                  <TouchableOpacity style={styles.messageActionRow} onPress={() => beginReply(actionMessage)}><Text style={styles.messageActionGlyph}>↩</Text><Text style={styles.messageActionLabel}>Reply</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.messageActionRow} onPress={() => { setSelectedMessageIds([messageSelectionKey(actionMessage)]); setActionMessage(null); setTimeout(openForwardPicker, 0); }}><Text style={styles.messageActionGlyph}>↗</Text><Text style={styles.messageActionLabel}>Forward</Text></TouchableOpacity>
                  {actionMessage.text ? <TouchableOpacity style={styles.messageActionRow} onPress={() => { void Clipboard.setStringAsync(actionMessage.text); setActionMessage(null); }}><Text style={styles.messageActionGlyph}>▣</Text><Text style={styles.messageActionLabel}>Copy</Text></TouchableOpacity> : null}
                  <TouchableOpacity style={styles.messageActionRow} onPress={() => { void Share.share({ message: shareableMessageText(actionMessage) || "Chitthi message" }); setActionMessage(null); }}><Text style={styles.messageActionGlyph}>⇧</Text><Text style={styles.messageActionLabel}>Share</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.messageActionRow} onPress={() => { setSelectedMessageIds([messageSelectionKey(actionMessage)]); setActionMessage(null); }}><Text style={styles.messageActionGlyph}>✓</Text><Text style={styles.messageActionLabel}>Select</Text></TouchableOpacity>
                  {actionMessage.mine && actionMessage.canEdit ? <TouchableOpacity style={styles.messageActionRow} onPress={() => { const target = actionMessage; setActionMessage(null); editMessage(target); }}><Text style={styles.messageActionGlyph}>✎</Text><Text style={styles.messageActionLabel}>Edit</Text></TouchableOpacity> : null}
                  {actionMessage.mine && actionMessage.canEdit ? <TouchableOpacity style={styles.messageActionRow} onPress={() => { const target = actionMessage; setActionMessage(null); void deleteMessage(target); }}><Text style={[styles.messageActionGlyph, styles.messageActionDanger]}>⌫</Text><Text style={[styles.messageActionLabel, styles.messageActionDanger]}>Delete</Text></TouchableOpacity> : null}
                  {!actionMessage.mine ? <TouchableOpacity style={styles.messageActionRow} onPress={() => { const target = actionMessage; setActionMessage(null); void reportMessage(target); }}><Text style={[styles.messageActionGlyph, styles.messageActionDanger]}>!</Text><Text style={[styles.messageActionLabel, styles.messageActionDanger]}>Report</Text></TouchableOpacity> : null}
                </View>
              </View>
            ) : null}
          </View>
        </Modal>

        <Modal visible={Boolean(attachmentPreview)} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setAttachmentPreview(null)}>
          <View style={styles.mediaViewerBackdrop}>
            <View style={styles.mediaViewerHeader}>
              <TouchableOpacity style={styles.mediaViewerRoundButton} onPress={() => setAttachmentPreview(null)} accessibilityLabel="Back to conversation"><Text style={styles.mediaViewerBackText}>‹</Text></TouchableOpacity>
              <View style={styles.mediaViewerPerson}>
                <View style={styles.mediaViewerAvatar}>{chatPhotoUrl(activeConversation?.otherPhotoUrl) ? <Image source={{ uri: chatPhotoUrl(activeConversation?.otherPhotoUrl) }} style={styles.mediaViewerAvatarImage} /> : <Text style={styles.mediaViewerAvatarText}>{initials(activeConversation?.otherName || "F")}</Text>}</View>
                <Text style={styles.mediaViewerName} numberOfLines={1}>{activeConversation?.otherName || "Chitthi"}</Text>
                <Text style={styles.mediaViewerDate}>{attachmentPreview ? chatDayLabel(attachmentPreview.createdAt) : ""}</Text>
              </View>
              <TouchableOpacity style={styles.mediaViewerRoundButton} onPress={() => void savePreviewAttachment()} accessibilityLabel="Share or save media"><Text style={styles.mediaViewerMenuText}>•••</Text></TouchableOpacity>
            </View>
            <View style={styles.mediaViewerStage}>
              {attachmentPreview?.type === "VIDEO" ? <ChitthiVideoPlayer uri={attachmentPreview.uri} /> : attachmentPreview ? <Image source={{ uri: attachmentPreview.uri }} style={styles.mediaViewerImage} resizeMode="contain" /> : null}
            </View>
            <View style={styles.mediaViewerBottom}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaViewerThumbnails}>
                {visibleMessages.filter((item) => (item.type === "IMAGE" || item.type === "VIDEO") && Boolean(item.attachmentUrl) && !item.metadata?.mediaExpired).slice(-20).map((item) => <TouchableOpacity key={item.id} style={[styles.mediaViewerThumbnail, attachmentPreview?.messageId === item.id && styles.mediaViewerThumbnailActive]} onPress={() => void openAttachment(item)} accessibilityLabel={`Open ${item.type === "VIDEO" ? "video" : "photo"} from ${chatClock(item.createdAt)}`}>{item.type === "IMAGE" ? <ChatMessagePhoto message={item} compact /> : <View style={styles.mediaViewerVideoThumb}><Text style={styles.mediaViewerVideoThumbText}>▶</Text></View>}</TouchableOpacity>)}
              </ScrollView>
              <View style={styles.mediaViewerActions}>
                <TouchableOpacity style={styles.mediaViewerAction} onPress={() => void savePreviewAttachment()}><Text style={styles.mediaViewerActionGlyph}>↗</Text><Text style={styles.mediaViewerActionText}>Share or save</Text></TouchableOpacity>
                <TouchableOpacity style={styles.mediaViewerAction} onPress={forwardMediaFromPreview}><Text style={styles.mediaViewerActionGlyph}>→</Text><Text style={styles.mediaViewerActionText}>Forward</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={pendingPhotoPreviewOpen && pendingImages.length > 0} animationType="slide" statusBarTranslucent onRequestClose={() => setPendingPhotoPreviewOpen(false)}>
          <View style={styles.pendingFullPreview}>
            <View style={styles.pendingFullPreviewHeader}>
              <TouchableOpacity style={styles.pendingFullPreviewClose} onPress={() => setPendingPhotoPreviewOpen(false)} accessibilityLabel="Close selected photo preview"><Text style={styles.pendingFullPreviewCloseText}>‹</Text></TouchableOpacity>
              <View style={styles.pendingFullPreviewTitleWrap}><Text style={styles.pendingFullPreviewTitle}>{pendingImages.length} photo{pendingImages.length === 1 ? "" : "s"} selected</Text><Text style={styles.pendingFullPreviewSubtitle}>Review before sending</Text></View>
              <TouchableOpacity style={styles.pendingFullPreviewSendTop} disabled={threadLoading} onPress={() => { setPendingPhotoPreviewOpen(false); void sendMessage(); }} accessibilityLabel="Send selected photos"><Text style={styles.pendingFullPreviewSendTopText}>{threadLoading ? "…" : "Send"}</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.pendingFullPreviewScroll} contentContainerStyle={styles.pendingFullPreviewContent} showsVerticalScrollIndicator={false}>
              {pendingImages.map((photo, index) => <View key={`${photo.uri}-${index}`} style={styles.pendingFullPreviewPhotoCard}>
                <PendingPhotoPreview uri={photo.uri} full />
                <View style={styles.pendingFullPreviewNumber}><Text style={styles.pendingFullPreviewNumberText}>{index + 1}</Text></View>
                <TouchableOpacity
                  style={styles.pendingFullPreviewRemove}
                  onPress={() => setPendingImages((current) => {
                    const next = current.filter((_, photoIndex) => photoIndex !== index);
                    if (!next.length) setPendingPhotoPreviewOpen(false);
                    return next;
                  })}
                  accessibilityLabel={`Remove photo ${index + 1}`}
                ><Text style={styles.pendingFullPreviewRemoveText}>×</Text></TouchableOpacity>
              </View>)}
            </ScrollView>
            <View style={styles.pendingFullPreviewFooter}>
              <Text style={styles.pendingFullPreviewFooterText}>{messageText.trim() ? "Your caption will be attached to the first photo." : "Add an optional caption from the message box."}</Text>
              <TouchableOpacity style={styles.pendingFullPreviewSend} disabled={threadLoading || !pendingImages.length} onPress={() => { setPendingPhotoPreviewOpen(false); void sendMessage(); }}><Text style={styles.pendingFullPreviewSendText}>{threadLoading ? "Sending…" : `Send ${pendingImages.length} photo${pendingImages.length === 1 ? "" : "s"}`}</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={attachmentPreviewGroup.length > 0} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setAttachmentPreviewGroup([])}>
          <View style={styles.attachmentPreviewBackdrop}>
            <View style={styles.attachmentPreviewHeader}>
              <View style={styles.groupPreviewHeaderCopy}><Text style={styles.attachmentPreviewName}>{activeConversation?.otherName || "Chitthi photos"}</Text><Text style={styles.groupPreviewCount}>{attachmentPreviewGroup.length} photos</Text></View>
              <TouchableOpacity style={styles.attachmentPreviewClose} onPress={() => setAttachmentPreviewGroup([])} accessibilityLabel="Close photo collection"><Text style={styles.attachmentPreviewCloseText}>×</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.groupPreviewScroll} contentContainerStyle={styles.groupPreviewContent} showsVerticalScrollIndicator={false}>
              {attachmentPreviewGroup.map((item, index) => <View key={`${item.name}-${index}`} style={styles.groupPreviewPhotoWrap}><Image source={{ uri: item.uri }} style={styles.groupPreviewPhoto} resizeMode="contain" /><View style={styles.photoTimeOverlay}><Text style={styles.photoTimeText}>{chatClock(item.createdAt)}</Text></View></View>)}
            </ScrollView>
          </View>
        </Modal>

        <Modal visible={forwardPickerOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setForwardPickerOpen(false)}>
          <View style={styles.forwardPickerBackdrop}>
            <View style={styles.forwardPickerCard}>
              <View style={styles.forwardPickerHeader}>
                <View><Text style={styles.forwardPickerTitle}>Forward messages</Text><Text style={styles.forwardPickerSubtitle}>Choose one or more Chitthi conversations</Text></View>
                <TouchableOpacity style={styles.attachmentPreviewClose} onPress={() => setForwardPickerOpen(false)}><Text style={styles.attachmentPreviewCloseText}>×</Text></TouchableOpacity>
              </View>
              <ScrollView style={styles.forwardPickerList}>
                {personConversations.filter((conversation) => conversation.id !== activeConversationId).map((conversation) => {
                  const selected = selectedForwardConversationIds.includes(conversation.id);
                  return <TouchableOpacity key={conversation.id} style={[styles.forwardPickerRow, selected && styles.forwardPickerRowSelected]} onPress={() => toggleForwardConversation(conversation.id)}>
                    <View style={styles.forwardPickerAvatar}>{chatPhotoUrl(conversation.otherPhotoUrl) ? <Image source={{ uri: chatPhotoUrl(conversation.otherPhotoUrl) }} style={styles.forwardPickerAvatarImage} /> : <Text style={styles.forwardPickerAvatarText}>{initials(conversation.otherName || conversation.subject)}</Text>}</View>
                    <View style={styles.forwardPickerCopy}><Text style={styles.forwardPickerName} numberOfLines={1}>{conversation.otherName || conversation.subject}</Text><Text style={styles.forwardPickerMeta} numberOfLines={1}>{conversation.communityId ? "Group" : conversation.lastMessage || "Chitthi conversation"}</Text></View>
                    <View style={[styles.forwardPickerCheck, selected && styles.forwardPickerCheckSelected]}><Text style={styles.forwardPickerCheckText}>{selected ? "✓" : ""}</Text></View>
                  </TouchableOpacity>;
                })}
                {!personConversations.filter((conversation) => conversation.id !== activeConversationId).length ? <Text style={styles.forwardPickerEmpty}>No other conversations yet.</Text> : null}
              </ScrollView>
              <TouchableOpacity style={[styles.forwardPickerSubmit, (!selectedForwardConversationIds.length || forwardingMessages) && styles.forwardPickerSubmitDisabled]} disabled={!selectedForwardConversationIds.length || forwardingMessages} onPress={() => void forwardSelectedMessages()}>
                <Text style={styles.forwardPickerSubmitText}>{forwardingMessages ? "Forwarding securely…" : `Forward to ${selectedForwardConversationIds.length || "chat"}`}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={shareContactPickerOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShareContactPickerOpen(false)}>
          <View style={styles.forwardPickerBackdrop}>
            <View style={styles.forwardPickerCard}>
              <View style={styles.forwardPickerHeader}>
                <View><Text style={styles.forwardPickerTitle}>Share a contact</Text><Text style={styles.forwardPickerSubtitle}>Choose from contacts saved on this phone</Text></View>
                <TouchableOpacity style={styles.attachmentPreviewClose} onPress={() => setShareContactPickerOpen(false)}><Text style={styles.attachmentPreviewCloseText}>×</Text></TouchableOpacity>
              </View>
              <ScrollView style={styles.forwardPickerList} keyboardShouldPersistTaps="handled">
                {shareableContacts.map((contact) => <TouchableOpacity key={contact.id} style={styles.forwardPickerRow} onPress={() => usePhoneContact(contact)}>
                  <View style={styles.forwardPickerAvatar}><Text style={styles.forwardPickerAvatarText}>{initials(contact.name)}</Text></View>
                  <View style={styles.forwardPickerCopy}><Text style={styles.forwardPickerName} numberOfLines={1}>{contact.name}</Text><Text style={styles.forwardPickerMeta} numberOfLines={1}>{contact.phone || contact.email}</Text></View>
                  <Text style={styles.contactShareArrow}>›</Text>
                </TouchableOpacity>)}
              </ScrollView>
              <Text style={styles.contactSharePrivacy}>Only the selected contact details are encrypted and sent to this conversation.</Text>
            </View>
          </View>
        </Modal>

        {attachmentMenuOpen ? (
          <View style={styles.attachmentPanel}>
            <View style={styles.attachmentPanelHeader}>
              <Text style={styles.attachmentPanelTitle}>Add to Chitthi</Text>
              <TouchableOpacity style={styles.attachmentClose} onPress={() => setAttachmentMenuOpen(false)} accessibilityLabel="Close attachments">
                <Text style={styles.attachmentCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.attachmentGrid}>
              <TouchableOpacity style={styles.attachmentTile} onPress={() => void chooseAndSendFile()} accessibilityRole="button" accessibilityLabel="Choose a file">
                <View style={[styles.attachmentIcon, styles.fileIcon]}><Text style={styles.attachmentIconText}>▰</Text></View>
                <Text style={styles.attachmentLabel}>File</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachmentTile} onPress={() => void chooseAndSendImage()} accessibilityRole="button" accessibilityLabel="Choose photos or videos">
                <View style={[styles.attachmentIcon, styles.photoIcon]}><Text style={styles.attachmentIconText}>▧</Text></View>
              <Text style={styles.attachmentLabel}>Photos</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachmentTile} onPress={() => void takeAndSendPhoto()} accessibilityRole="button" accessibilityLabel="Take a photo">
                <View style={[styles.attachmentIcon, styles.cameraIcon]}><Text style={styles.attachmentIconText}>◉</Text></View>
                <Text style={styles.attachmentLabel}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachmentTile} onPress={() => openRichComposer("POLL")} accessibilityRole="button" accessibilityLabel="Create a poll">
                <View style={[styles.attachmentIcon, styles.pollIcon]}><Text style={styles.attachmentIconText}>≡</Text></View>
                <Text style={styles.attachmentLabel}>Poll</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachmentTile} onPress={() => openRichComposer("EVENT")} accessibilityRole="button" accessibilityLabel="Create an event">
                <View style={[styles.attachmentIcon, styles.eventIcon]}><Text style={styles.attachmentIconText}>▦</Text></View>
                <Text style={styles.attachmentLabel}>Event</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachmentTile} onPress={() => void choosePhoneContact()} accessibilityRole="button" accessibilityLabel="Share a phone contact">
                <View style={[styles.attachmentIcon, styles.contactIcon]}><Text style={styles.attachmentIconText}>●</Text></View>
                <Text style={styles.attachmentLabel}>Contact</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachmentTile} onPress={sharingLocation ? () => stopLiveLocation(true) : chooseLiveLocationDuration} accessibilityRole="button" accessibilityLabel={sharingLocation ? "Stop sharing live location" : "Share live location"}>
                <View style={[styles.attachmentIcon, styles.locationAttachmentIcon]}><Text style={styles.attachmentIconText}>⌖</Text></View>
                <Text style={styles.attachmentLabel}>{sharingLocation ? "Stop location" : "Live location"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {richComposer ? (
          <View style={styles.richComposerPanel}>
            {richComposer === "POLL" ? <>
              <View style={styles.pollSheetHeader}><TouchableOpacity onPress={() => setRichComposer("")}><Text style={styles.pollSheetCancel}>Cancel</Text></TouchableOpacity><Text style={styles.pollSheetTitle}>Create poll</Text><TouchableOpacity disabled={threadLoading || !richDraft.primary.trim() || pollOptions.filter((value) => value.trim()).length < 2} onPress={() => void submitRichMessage()}><Text style={[styles.pollSheetSend, (threadLoading || !richDraft.primary.trim() || pollOptions.filter((value) => value.trim()).length < 2) && styles.pollSheetSendDisabled]}>{threadLoading ? "Sending…" : "Send"}</Text></TouchableOpacity></View>
              <ScrollView style={styles.pollSheetScroll} contentContainerStyle={styles.pollSheetContent} keyboardShouldPersistTaps="handled">
                <Text style={styles.pollComposerLabel}>Question</Text><TextInput style={styles.pollQuestionInput} placeholder="Ask a question" placeholderTextColor="#9A9E9B" value={richDraft.primary} onChangeText={(primary) => setRichDraft((current) => ({ ...current, primary }))} maxLength={240} />
                <Text style={styles.pollComposerLabel}>Options</Text><View style={styles.pollOptionsCard}>{pollOptions.map((option, index) => <View key={index} style={[styles.pollOptionInputRow, index === pollOptions.length - 1 && styles.pollOptionInputRowLast]}><TextInput style={styles.pollOptionInput} placeholder={`Option ${index + 1}`} placeholderTextColor="#9A9E9B" value={option} onChangeText={(value) => setPollOptions((current) => current.map((item, optionIndex) => optionIndex === index ? value : item))} maxLength={100} />{pollOptions.length > 2 ? <TouchableOpacity style={styles.pollRemoveOption} onPress={() => setPollOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))}><Text style={styles.pollRemoveOptionText}>×</Text></TouchableOpacity> : null}</View>)}</View>
                {pollOptions.length < 6 ? <TouchableOpacity style={styles.pollAddOption} onPress={() => setPollOptions((current) => [...current, ""])}><Text style={styles.pollAddOptionText}>＋ Add option</Text></TouchableOpacity> : null}
                <View style={styles.pollSettingsCard}><View style={styles.pollComposerSetting}><View style={styles.pollSettingCopy}><Text style={styles.pollComposerSettingTitle}>Allow multiple answers</Text><Text style={styles.pollComposerSettingMeta}>{pollMultiple ? "Members can choose several" : "Members choose one"}</Text></View><Switch value={pollMultiple} onValueChange={setPollMultiple} trackColor={{ false: "#C5C9C6", true: "#1AA866" }} /></View><View style={[styles.pollComposerSetting, styles.pollComposerSettingLast]}><View style={styles.pollSettingCopy}><Text style={styles.pollComposerSettingTitle}>Hide voter names</Text><Text style={styles.pollComposerSettingMeta}>Always on for member privacy</Text></View><Switch value disabled trackColor={{ false: "#C5C9C6", true: "#1AA866" }} /></View></View>
                <Text style={styles.pollComposerLabel}>End time</Text><View style={styles.pollDurationRow}>{[{ value: 1, label: "1 hour" }, { value: 24, label: "24 hours" }, { value: 168, label: "7 days" }, { value: 0, label: "No end" }].map((choice) => <TouchableOpacity key={choice.value} style={[styles.pollDurationChoice, pollClosesInHours === choice.value && styles.pollDurationChoiceActive]} onPress={() => setPollClosesInHours(choice.value)}><Text style={[styles.pollDurationChoiceText, pollClosesInHours === choice.value && styles.pollDurationChoiceTextActive]}>{choice.label}</Text></TouchableOpacity>)}</View>
                <Text style={styles.pollPrivacyNote}>Results sync through Chitthi's secure poll service.</Text>
              </ScrollView>
            </> : <>
              <View style={styles.attachmentPanelHeader}><Text style={styles.attachmentPanelTitle}>{richComposer === "EVENT" ? "Create event" : "Share contact"}</Text><TouchableOpacity style={styles.attachmentClose} onPress={() => setRichComposer("")}><Text style={styles.attachmentCloseText}>×</Text></TouchableOpacity></View>
              <TextInput style={styles.richInput} placeholder={richComposer === "EVENT" ? "Event title" : "Contact name"} placeholderTextColor="#777" value={richDraft.primary} onChangeText={(primary) => setRichDraft((current) => ({ ...current, primary }))} />
              {richComposer === "EVENT" ? <DateTimeField label="Event date" mode="date" minimumDate={todayLocalIso()} value={richDraft.secondary} onChange={(secondary) => setRichDraft((current) => ({ ...current, secondary }))} /> : <TextInput style={styles.richInput} placeholder="Phone number" placeholderTextColor="#777" value={richDraft.secondary} onChangeText={(secondary) => setRichDraft((current) => ({ ...current, secondary }))} />}
              {richComposer === "EVENT" ? <DateTimeField label="Event time" mode="time" value={richDraft.tertiary} onChange={(tertiary) => setRichDraft((current) => ({ ...current, tertiary }))} /> : <TextInput style={styles.richInput} placeholder="Email address" placeholderTextColor="#777" value={richDraft.tertiary} onChangeText={(tertiary) => setRichDraft((current) => ({ ...current, tertiary }))} />}
              {richComposer === "EVENT" ? <TextInput style={styles.richInput} placeholder="Location" placeholderTextColor="#777" value={richDraft.fourth} onChangeText={(fourth) => setRichDraft((current) => ({ ...current, fourth }))} /> : null}
              <TouchableOpacity style={styles.richSubmit} onPress={() => void submitRichMessage()} disabled={threadLoading}><Text style={styles.richSubmitText}>{threadLoading ? "Sending…" : "Send"}</Text></TouchableOpacity>
            </>}
          </View>
        ) : null}

        {wallpaperPanelOpen ? (
          <View style={styles.wallpaperPanel}>
            <View style={styles.attachmentPanelHeader}><Text style={styles.attachmentPanelTitle}>Chat wallpaper</Text><TouchableOpacity style={styles.attachmentClose} onPress={() => setWallpaperPanelOpen(false)}><Text style={styles.attachmentCloseText}>×</Text></TouchableOpacity></View>
            <Text style={styles.wallpaperHelp}>Only you will see this wallpaper.</Text>
            <View style={styles.wallpaperGrid}>
              {wallpaperChoices.map((choice) => <TouchableOpacity key={choice.id} style={[styles.wallpaperChoice, { backgroundColor: choice.color }, wallpaper === choice.id && styles.wallpaperChoiceSelected]} onPress={() => void applyWallpaper(choice.id)}><View style={[styles.wallpaperChoiceGlow, { backgroundColor: choice.accent }]} /><Text style={styles.wallpaperChoiceLabel}>{choice.label}</Text></TouchableOpacity>)}
              <TouchableOpacity style={[styles.wallpaperChoice, styles.customWallpaperChoice, wallpaper === "custom" && styles.wallpaperChoiceSelected]} onPress={() => void chooseCustomWallpaper()}>{customWallpaper ? <Image source={{ uri: customWallpaper }} style={styles.customWallpaperPreview} /> : <Text style={styles.customWallpaperPlus}>＋</Text>}<Text style={styles.wallpaperChoiceLabel}>Your photo</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.wallpaperReset} onPress={() => void applyWallpaper("midnight")}><Text style={styles.wallpaperResetText}>Reset to default</Text></TouchableOpacity>
          </View>
        ) : null}

        {attachmentStatus ? <View style={styles.attachmentStatus}><Text style={styles.attachmentStatusText}>{attachmentStatus}</Text></View> : null}

        {pendingImages.length ? (
          <TouchableOpacity style={styles.pendingAttachmentCard} onPress={() => setPendingPhotoPreviewOpen(true)} activeOpacity={0.84} accessibilityLabel={`Preview ${pendingImages.length} selected photos`}>
            <View style={styles.pendingCollagePreview}>
              {pendingImages.slice(0, 4).map((image, index) => <View key={`${image.uri}-${index}`} style={styles.pendingCollageCell}><PendingPhotoPreview uri={image.uri} compact />{index === 3 && pendingImages.length > 4 ? <View style={styles.pendingCollageMore}><Text style={styles.pendingCollageMoreText}>+{pendingImages.length - 3}</Text></View> : null}</View>)}
            </View>
            <View style={styles.pendingAttachmentCopy}><Text style={styles.pendingAttachmentName}>{pendingImages.length} photos selected</Text><Text style={styles.pendingAttachmentMeta}>Collage ready to send</Text></View>
            <TouchableOpacity style={styles.pendingAttachmentRemove} onPress={() => setPendingImages([])} accessibilityLabel="Remove selected photos"><Text style={styles.pendingAttachmentRemoveText}>×</Text></TouchableOpacity>
          </TouchableOpacity>
        ) : pendingAttachment ? (
          <View style={styles.pendingAttachmentCard}>
            {pendingAttachment.kind === "IMAGE" ? <PendingPhotoPreview uri={pendingAttachment.uri} /> : pendingAttachment.kind === "VIDEO" ? <View style={styles.pendingVideoPreview}><Text style={styles.pendingVideoPreviewText}>▶</Text></View> : <View style={[styles.attachmentIcon, styles.fileIcon, styles.pendingAttachmentFileIcon]}><Text style={styles.attachmentIconText}>▰</Text></View>}
            <View style={styles.pendingAttachmentCopy}><Text style={styles.pendingAttachmentName} numberOfLines={1}>{pendingAttachment.kind === "IMAGE" ? "Photo selected" : pendingAttachment.kind === "VIDEO" ? "Video selected" : pendingAttachment.name}</Text><Text style={styles.pendingAttachmentMeta}>{pendingAttachment.kind === "IMAGE" || pendingAttachment.kind === "VIDEO" ? "Ready to send" : `${Math.max(1, Math.round(pendingAttachment.size / 1024))} KB · Ready to send`}</Text></View>
            <TouchableOpacity style={styles.pendingAttachmentRemove} onPress={() => setPendingAttachment(null)} accessibilityLabel="Remove selected attachment"><Text style={styles.pendingAttachmentRemoveText}>×</Text></TouchableOpacity>
          </View>
        ) : null}

        {typingPeople.length ? (
          <View style={styles.chittiTypingIndicator} accessibilityLiveRegion="polite">
            <View style={styles.chittiTypingMascotWrap}>
              <Image source={appAssets.chittiMascot} style={styles.chittiTypingMascot} resizeMode="contain" />
            </View>
            <Text style={styles.chittiTypingText} numberOfLines={1}>
              {typingPeople.map((person) => person.name.split(" ")[0]).join(", ")} {typingPeople.length === 1 ? "is" : "are"} typing
              <Text style={styles.chittiTypingDots}> …</Text>
            </Text>
          </View>
        ) : null}

        {emojiPickerOpen ? (
          <View style={styles.emojiPanel}>
            <View style={styles.emojiSearchRow}>
              <Text style={styles.emojiSearchIcon}>⌕</Text>
              <TextInput value={emojiSearch} onChangeText={setEmojiSearch} style={styles.emojiSearchInput} placeholder="Search emoji" placeholderTextColor="#9298a3" autoCapitalize="none" autoCorrect={false} />
              <TouchableOpacity onPress={() => setEmojiPickerOpen(false)} accessibilityLabel="Close emoji picker"><Text style={styles.emojiClose}>×</Text></TouchableOpacity>
            </View>
            {!emojiSearch ? <Text style={styles.emojiSectionTitle}>{emojiGroups.find((group) => group.id === emojiGroup)?.label || "Emoji"}</Text> : <Text style={styles.emojiSectionTitle}>Search results</Text>}
            <ScrollView style={styles.emojiGridScroll} contentContainerStyle={styles.emojiGrid} keyboardShouldPersistTaps="always">
              {visibleEmojis.map((emoji, index) => <TouchableOpacity key={`${emoji}-${index}`} style={styles.emojiCell} onPress={() => chooseEmoji(emoji)}><Text style={styles.emojiValue}>{emoji}</Text></TouchableOpacity>)}
              {!visibleEmojis.length ? <Text style={styles.emojiEmpty}>No matching emoji</Text> : null}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.emojiCategories} contentContainerStyle={styles.emojiCategoriesContent}>
              {emojiGroups.map((group) => <TouchableOpacity key={group.id} style={[styles.emojiCategory, emojiGroup === group.id && styles.emojiCategoryActive]} onPress={() => { setEmojiGroup(group.id); setEmojiSearch(""); }} accessibilityLabel={group.label}><Text style={[styles.emojiCategoryText, emojiGroup === group.id && styles.emojiCategoryTextActive]}>{group.icon}</Text></TouchableOpacity>)}
            </ScrollView>
          </View>
        ) : null}

        {!messageText.trim() && !typingPeople.length && !pendingAttachment && !pendingImages.length && !editingMessageId && !emojiPickerOpen && !composerFocused && !keyboardVisible ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickReplies} contentContainerStyle={styles.quickRepliesContent}>
            {[`Hi, ${(activeConversation?.otherName || "there").split(" ")[0]}`, `Hello, ${(activeConversation?.otherName || "there").split(" ")[0]}`, "👍"].map((reply) => <TouchableOpacity key={reply} style={styles.quickReply} onPress={() => setMessageText(reply)}><Text style={styles.quickReplyText}>{reply}</Text></TouchableOpacity>)}
          </ScrollView>
        ) : null}

        {replyingTo ? <View style={styles.replyComposerPreview}><View style={styles.replyComposerBar} /><View style={styles.replyComposerCopy}><Text style={styles.replyComposerName}>{replyingTo.mine ? "You" : replyingTo.senderName}</Text><Text style={styles.replyComposerText} numberOfLines={1}>{shareableMessageText({ ...replyingTo, senderName: "" }) || "Message"}</Text></View><TouchableOpacity onPress={() => setReplyingTo(null)} accessibilityLabel="Cancel reply"><Text style={styles.replyComposerClose}>×</Text></TouchableOpacity></View> : null}
        <View style={styles.composer}>
          <TouchableOpacity style={styles.composerIcon} onPress={showComposerOptions} accessibilityLabel="Add attachment"><Text style={styles.paperclipIcon}>📎</Text></TouchableOpacity>
          <TouchableOpacity style={styles.composerEmoji} onPress={toggleEmojiPicker} accessibilityLabel="Choose emoji"><Text style={styles.composerEmojiText}>☺</Text></TouchableOpacity>
          <TextInput
            ref={composerRef}
            placeholder={editingMessageId ? "Edit message" : "Write a message…"}
            placeholderTextColor="#a7a08d"
            style={styles.composerInput}
            value={messageText}
            onChangeText={handleMessageTextChange}
            onFocus={() => { setComposerFocused(true); setTimeout(() => messagesScrollRef.current?.scrollToEnd({ animated: true }), 120); }}
            onBlur={() => setComposerFocused(false)}
            multiline
          />
          <TouchableOpacity accessibilityLabel={pendingAttachment || pendingImages.length ? "Send attachment" : "Send message"} style={[styles.composerSend, threadLoading && styles.sendDisabled]} onPress={sendMessage} disabled={threadLoading}>
            {editingMessageId ? <Text style={styles.composerSendText}>✓</Text> : <SendIcon />}
          </TouchableOpacity>
        </View>
        {editingMessageId ? (
          <TouchableOpacity style={styles.cancelEdit} onPress={() => { setEditingMessageId(null); setMessageText(""); }}>
            <Text style={styles.cancelEditText}>Cancel edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.screen, Platform.OS === "android" && styles.screenAndroid]}>
      <View pointerEvents="none" style={styles.chittiBackdrop}>
        <View style={styles.chittiGlowTop} />
        <View style={styles.chittiGlowBottom} />
      </View>
      <View style={styles.header}>
        <View style={styles.chittiHeaderMascotWrap}>
          <Image source={appAssets.chittiMascot} style={styles.chittiHeaderMascot} resizeMode="contain" />
          {(data?.chat.unreadCount || 0) > 0 ? <Text style={styles.chittiHeaderBadge}>{data?.chat.unreadCount}</Text> : null}
        </View>
        <View style={styles.chatBrandWrap}>
          <Image source={appAssets.chittiLettersGold} style={styles.chittiBrandPaper} resizeMode="contain" />
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity style={styles.headerIcon} accessibilityLabel="Chitthi options"><Text style={styles.headerIconText}>•••</Text></TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => (signedIn ? setCreatingGroup((value) => !value) : onRequireLogin())}
          accessibilityLabel="Create a Chitthi group"
        >
          <Text style={styles.iconButtonText}>✐</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          placeholder="Search people & groups"
          placeholderTextColor={theme.colors.muted}
          style={[styles.search, styles.searchInput]}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={handleMessengerSearchSubmit}
          returnKeyType="search"
          autoCapitalize="none"
        />
      </View>

      {/(?:group_invite|community_id)=/.test(search.trim()) ? <TouchableOpacity style={styles.searchAction} onPress={handleMessengerSearchSubmit}><Text style={styles.searchActionText}>Open group invitation</Text></TouchableOpacity> : null}
      {search.replace(/\D/g, "").length >= 10 && !/(?:group_invite|community_id)=/.test(search) ? <TouchableOpacity style={styles.searchAction} onPress={handleMessengerSearchSubmit}><Text style={styles.searchActionText}>Message this FairFares member</Text></TouchableOpacity> : null}

      <View style={styles.tabs}>
        {(["All", "Unread", "Groups", "Communities", "Contacts"] as MessengerTab[]).map((item) => (
          <TouchableOpacity key={item} onPress={() => { setTab(item); if (item === "Contacts") void findPeopleFromContacts(); }} style={[styles.tab, tab === item && styles.activeTab]}>
            <Text style={[styles.tabText, tab === item && styles.activeTabText]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Modal visible={contactPickerOpen} transparent animationType="fade" onRequestClose={() => setContactPickerOpen(false)}>
        <View style={styles.contactPickerBackdrop}>
          <View style={styles.contactPickerCard}>
            <View style={styles.contactPickerHeader}>
              <View style={styles.contactPickerHeadingCopy}>
                <Text style={styles.contactPickerTitle}>Contacts on FairFares</Text>
                <Text style={styles.contactPickerSubtitle}>{contactPickerMode === "chat" ? "Select a member to open Chitthi" : "Select FairFares members to add"}</Text>
              </View>
              <TouchableOpacity style={styles.contactPickerClose} onPress={() => setContactPickerOpen(false)} accessibilityLabel="Close contacts">
                <Text style={styles.contactPickerCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.contactPickerList} contentContainerStyle={styles.contactPickerListContent} showsVerticalScrollIndicator={false}>
              {contactMatches.map((person) => (
                <TouchableOpacity key={`contact-picker-${person.id}`} style={[styles.contactPickerRow, contactPickerMode !== "chat" && selectedGroupPeople.includes(person.id) && styles.contactPickerRowSelected]} onPress={() => contactPickerMode === "chat" ? void openContactChat(person) : toggleGroupPerson(person.id)}>
                  <View style={styles.avatar}>
                    {chatPhotoUrl(person.photoUrl) ? <Image source={{ uri: chatPhotoUrl(person.photoUrl) }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{initials(person.localName)}</Text>}
                  </View>
                  <View style={styles.chatCopy}>
                    <Text style={styles.chatName}>{person.localName}</Text>
                    <Text style={styles.chatLast}>{person.name !== person.localName ? `${person.name} · FairFares member` : "FairFares member"}</Text>
                  </View>
                  <View style={styles.contactPickerMessageButton}><Text style={styles.contactPickerMessageText}>{contactPickerMode === "chat" ? "Message" : selectedGroupPeople.includes(person.id) ? "Selected" : "Add"}</Text></View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {contactPickerMode !== "chat" ? (
              <TouchableOpacity
                style={[styles.primaryButton, !selectedGroupPeople.length && styles.disabledButton]}
                disabled={!selectedGroupPeople.length || contactsLoading}
                onPress={() => {
                  if (contactPickerMode === "create") setContactPickerOpen(false);
                  else void addSelectedPeopleToExistingGroup();
                }}
              >
                <Text style={styles.primaryButtonText}>{contactsLoading ? "Adding..." : contactPickerMode === "create" ? `Use ${selectedGroupPeople.length} selected` : `Add ${selectedGroupPeople.length} people`}</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={styles.contactPickerPrivacy}>Phone numbers stay private and are never displayed.</Text>
          </View>
        </View>
      </Modal>

      {!signedIn ? (
        <View style={styles.loginGate}>
          <Text style={styles.loginTitle}>Login required to message</Text>
          <Text style={styles.loginCopy}>People can browse listings, but messages and group joins require a FairFares account.</Text>
          <TouchableOpacity style={styles.loginButton} onPress={onRequireLogin}>
            <Text style={styles.loginButtonText}>Login / Sign up</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {creatingGroup ? (
        <View style={styles.groupComposer}>
          <Text style={styles.sectionTitle}>Create a group</Text>
          <TouchableOpacity style={styles.groupPhotoPicker} onPress={() => void chooseGroupPhoto()} accessibilityLabel="Choose group image">
            {groupPhoto ? <Image source={{ uri: groupPhoto }} style={styles.groupPhotoImage} /> : <View style={styles.groupPhotoPlaceholder}><Text style={styles.groupPhotoPlaceholderText}>#</Text></View>}
            <View style={styles.groupPhotoCopy}><Text style={styles.groupPeoplePickerTitle}>{groupPhoto ? "Group image selected" : "Add group image"}</Text><Text style={styles.groupPeoplePickerMeta}>Choose a photo that members will recognize</Text></View>
            <Text style={styles.groupPeoplePickerArrow}>›</Text>
          </TouchableOpacity>
          <TextInput
            placeholder="Group name, e.g. Denver roommates"
            placeholderTextColor={theme.colors.muted}
            value={groupDraft.name}
            onChangeText={(name) => setGroupDraft((current) => ({ ...current, name }))}
            style={styles.input}
          />
          <TouchableOpacity style={styles.groupPeoplePicker} onPress={() => void findPeopleFromContacts("create")} disabled={contactsLoading}>
            <Text style={styles.groupPeoplePickerIcon}>＋</Text>
            <View style={styles.groupPeoplePickerCopy}>
              <Text style={styles.groupPeoplePickerTitle}>{selectedGroupPeople.length ? `${selectedGroupPeople.length} people selected` : "Add people"}</Text>
              <Text style={styles.groupPeoplePickerMeta}>Choose FairFares members from your contacts</Text>
            </View>
            <Text style={styles.groupPeoplePickerArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={createGroup} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? "Creating..." : "Create group and add people"}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} tintColor={theme.colors.text} onRefresh={refreshMessenger} />}
      >
        {tab === "All" && !feedbackCardDismissed ? (
          <TouchableOpacity style={styles.feedbackChatCard} onPress={() => void openFeedbackChat()} disabled={loading}>
            <View style={styles.feedbackChatAvatar}><Text style={styles.feedbackChatAvatarText}>SR</Text></View>
            <View style={styles.chatCopy}>
              <Text style={styles.feedbackChatEyebrow}>ISSUES &amp; SUGGESTIONS</Text>
              <Text style={styles.feedbackChatName}>Sriram Reddy Bandari</Text>
              <Text style={styles.feedbackChatCopy} numberOfLines={1}>Share an issue or suggestion with FairFares.</Text>
            </View>
            <Text style={styles.feedbackChatArrow}>›</Text>
            <TouchableOpacity
              style={styles.feedbackChatDismiss}
              accessibilityLabel="Dismiss issues and suggestions"
              onPress={(event) => {
                event.stopPropagation();
                setFeedbackCardDismissed(true);
                void AsyncStorage.setItem(`fairfares.chitthi.feedback-card-dismissed.${data?.user?.id || "guest"}`, "1");
              }}
            >
              <Text style={styles.feedbackChatDismissText}>×</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        ) : null}
        {tab === "Contacts" ? (
          <TouchableOpacity style={styles.letterEmptyCard} onPress={() => void findPeopleFromContacts()} disabled={contactsLoading}>
            <Text style={styles.letterEmptyIcon}>📇</Text>
            <Text style={styles.letterEmptyTitle}>{contactsLoading ? "Checking your contacts…" : "Find your FairFares people"}</Text>
            <Text style={styles.letterEmptyCopy}>Phone numbers stay private. Tap to find contacts who already use Chitthi.</Text>
          </TouchableOpacity>
        ) : null}
        {(tab === "All" || tab === "Unread" || tab === "Groups") && filteredConversations.map((chat) => (
          <TouchableOpacity key={chat.id} style={[styles.chatRow, chat.unread > 0 && styles.chatRowUnread]} onPress={() => openConversation(chat)}>
            <View style={styles.avatarWrap}>
            <View style={[styles.avatar, chat.unread > 0 && styles.avatarUnread]}>
              {chatPhotoUrl(chat.otherPhotoUrl) ? (
                <Image source={{ uri: chatPhotoUrl(chat.otherPhotoUrl) }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{initials(chat.otherName || chat.subject || "Chat")}</Text>
              )}
            </View>
            {chat.otherOnline ? <View style={styles.inboxOnlineDot} /> : null}
            </View>
            <View style={styles.chatCopy}>
              <Text style={styles.chatKind}>{chat.communityId || chat.kind === "GROUP" ? "GROUP LETTER" : "DIRECT LETTER"}</Text>
              <Text style={styles.chatName}>{chat.otherName || chat.subject}</Text>
              <Text style={[styles.chatLast, chat.unread > 0 && styles.chatLastUnread]} numberOfLines={1}>{safeConversationPreview(chat)}</Text>
            </View>
            <View style={styles.chatMeta}>
              <Text style={[styles.chatTime, chat.unread > 0 && styles.chatTimeUnread]}>{relativeTime(chat.lastMessageAt)}</Text>
              {chat.unread ? <Text style={styles.unread}>{chat.unread}</Text> : null}
            </View>
          </TouchableOpacity>
        ))}

        {(tab === "All" || tab === "Groups" || tab === "Communities") && filteredCommunities.map((community) => (
          <TouchableOpacity key={community.id} style={[styles.chatRow, styles.communityRow]} onPress={() => openCommunityThread(community)}>
            <View style={[styles.avatar, styles.groupAvatar]}>{community.photoUrl ? <Image source={{ uri: chatPhotoUrl(community.photoUrl) }} style={styles.avatarImage} /> : <Text style={styles.communityGlyph}>{communityGlyph(community.name)}</Text>}</View>
            <View style={styles.chatCopy}>
              <Text style={styles.chatKind}>{community.kind === "GROUP" ? "PUBLIC GROUP" : "COMMUNITY"}</Text>
              <Text style={styles.chatName}>{community.name}</Text>
              <Text style={styles.chatLast}>{community.description || community.area || "FairFares community"}</Text>
            </View>
            <TouchableOpacity
              style={styles.rowAction}
              onPress={(event) => {
                event.stopPropagation();
                community.joined ? shareCommunity(community) : openCommunityThread(community);
              }}
            >
              <Text style={[styles.memberCount, !community.joined && styles.joinCommunityText]}>{community.joined ? "Joined" : "Join"} · {community.memberCount}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        ))}

        {(tab === "All" || tab === "Unread" || tab === "Groups") && hasMoreConversations ? (
          <TouchableOpacity style={styles.loadMoreLetters} onPress={() => void loadMoreConversations()} disabled={loadingMoreConversations}>
            <Text style={styles.loadMoreLettersText}>{loadingMoreConversations ? "Opening more letters…" : "Load more letters"}</Text>
          </TouchableOpacity>
        ) : null}

        {signedIn && tab !== "Contacts" && !filteredConversations.length && !filteredCommunities.length ? (
          <View style={styles.letterEmptyCard}>
            <Text style={styles.letterEmptyIcon}>📬</Text>
            <Text style={styles.letterEmptyTitle}>{tab === "Unread" ? "No new letters today" : "No letters found"}</Text>
            <Text style={styles.letterEmptyCopy}>{tab === "Unread" ? "You are all caught up." : "Message a listing poster or create a community group."}</Text>
          </View>
        ) : null}

        {suggestedCommunities.length ? (
          <View style={styles.groupSuggestionsSection}>
            <View style={styles.groupSuggestionsHeader}>
              <View style={styles.groupSuggestionsCopy}>
                <Text style={styles.groupSuggestionsTitle}>Suggested groups</Text>
                <Text style={styles.groupSuggestionsSubtitle}>Public groups near {suggestionCity.split(",", 1)[0] || "your location"}</Text>
              </View>
              <TouchableOpacity
                style={styles.groupSuggestionsDismiss}
                accessibilityLabel="Dismiss suggested groups"
                onPress={() => setGroupSuggestionsDismissed(true)}
              >
                <Text style={styles.groupSuggestionsDismissText}>×</Text>
              </TouchableOpacity>
            </View>
            {suggestedCommunities.map((community) => (
              <View key={`suggested-${community.id}`} style={styles.suggestedGroupRow}>
                <View style={[styles.avatar, styles.groupAvatar]}>{community.photoUrl ? <Image source={{ uri: chatPhotoUrl(community.photoUrl) }} style={styles.avatarImage} /> : <Text style={styles.communityGlyph}>{communityGlyph(community.name)}</Text>}</View>
                <View style={styles.chatCopy}>
                  <Text style={styles.chatName}>{community.name}</Text>
                  <Text style={styles.chatLast} numberOfLines={1}>{community.description || community.area || "Public FairFares group"}</Text>
                </View>
                <TouchableOpacity style={styles.suggestedJoinButton} onPress={() => void openCommunityThread(community)} accessibilityLabel={`Join ${community.name}`}><Text style={styles.suggestedJoinText}>Join</Text></TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function BackIcon() {
  return (
    <View style={styles.backIcon}>
      <View style={[styles.backLine, styles.backLineTop]} />
      <View style={[styles.backLine, styles.backLineBottom]} />
    </View>
  );
}

function DotsIcon() {
  return (
    <View style={styles.dotsIcon}>
      <View style={styles.dotIcon} />
      <View style={styles.dotIcon} />
      <View style={styles.dotIcon} />
    </View>
  );
}

function PlusIcon() {
  return (
    <View style={styles.plusIcon}>
      <View style={styles.plusHorizontal} />
      <View style={styles.plusVertical} />
    </View>
  );
}

function SendIcon() {
  return (
    <View style={styles.sendIcon}>
      <View style={styles.sendWingTop} />
      <View style={styles.sendWingBottom} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#03100f", paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md, position: "relative", overflow: "hidden" },
  screenAndroid: { paddingTop: 10 },
  chittiBackdrop: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  chittiGlowTop: { position: "absolute", width: 270, height: 270, borderRadius: 135, top: -120, right: -100, backgroundColor: "rgba(19,102,70,0.20)" },
  chittiGlowBottom: { position: "absolute", width: 240, height: 240, borderRadius: 120, bottom: 20, left: -140, backgroundColor: "rgba(3,76,55,0.13)" },
  threadScreen: { flex: 1, backgroundColor: "#03100f", paddingTop: 0, paddingBottom: 0, position: "relative", overflow: "hidden" },
  threadScreenAndroid: { paddingBottom: 0 },
  wallpaperBase: { ...StyleSheet.absoluteFillObject },
  wallpaperImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  wallpaperShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,16,12,0.30)" },
  wallpaperGlow: { position: "absolute", width: 280, height: 280, borderRadius: 140, opacity: 0.18 },
  wallpaperGlowOne: { top: -90, right: -100 },
  wallpaperGlowTwo: { bottom: 90, left: -130 },
  wallpaperPattern: { position: "absolute", top: "47%", left: -20, color: "rgba(231,211,167,0.055)", fontSize: 25, letterSpacing: 13, transform: [{ rotate: "-12deg" }] },
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  title: { color: theme.colors.text, ...theme.typography.screenTitle },
  chatBrandWrap: { flex: 1, minWidth: 0, height: 62, alignItems: "flex-start", justifyContent: "center", overflow: "hidden" },
  chatBrand: { width: 132, height: 42 },
  chittiHeaderMascotWrap: { width: 48, height: 54, alignItems: "center", justifyContent: "center" },
  chittiHeaderMascot: { width: 44, height: 52 },
  chittiHeaderBadge: { position: "absolute", top: 0, right: -2, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, overflow: "hidden", backgroundColor: "#3cad50", color: "#fff", textAlign: "center", lineHeight: 22, fontSize: 11, fontWeight: "700" },
  chittiBrandPaper: { width: "100%", height: 58 },
  headerIcons: { flexDirection: "row", gap: 6, marginLeft: "auto" },
  headerIcon: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: "rgba(239,189,104,0.65)", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(14,32,29,0.92)" },
  headerIconText: { color: "#efbd68", fontSize: 16, fontWeight: "700", letterSpacing: 1 },
  iconButton: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: "rgba(239,189,104,0.65)", backgroundColor: "rgba(14,32,29,0.92)", alignItems: "center", justifyContent: "center" },
  iconButtonText: { color: "#efbd68", fontSize: 20, fontWeight: "600", marginTop: -2 },
  search: { backgroundColor: "rgba(15,29,28,0.94)", color: theme.colors.text, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: "rgba(226,181,101,0.18)", paddingHorizontal: 13, minHeight: 41, fontSize: 13 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, minWidth: 0 },
  contactsButton: { minHeight: 48, paddingHorizontal: 10, borderRadius: 22, borderWidth: 1, borderColor: "rgba(57,143,77,0.20)", backgroundColor: "rgba(18,71,40,0.70)", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  contactsButtonIcon: { color: "#e9d7ad", fontSize: 17 },
  contactsButtonText: { color: "#f3ead6", fontSize: 12, fontWeight: "600" },
  searchAction: { alignSelf: "flex-start", marginTop: 7, marginLeft: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: "#132849" },
  searchActionText: { color: "#8fc2ff", fontSize: 13, fontWeight: "600" },
  contactPickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", padding: 18, justifyContent: "center" },
  contactPickerCard: { width: "100%", maxWidth: 520, maxHeight: "72%", alignSelf: "center", ...theme.depth.card, overflow: "hidden" },
  contactPickerHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  contactPickerHeadingCopy: { flex: 1, minWidth: 0 },
  contactPickerTitle: { color: theme.colors.text, ...theme.typography.sectionTitle },
  contactPickerSubtitle: { color: theme.colors.muted, ...theme.typography.caption, marginTop: 3 },
  contactPickerClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center", marginLeft: 10 },
  contactPickerCloseText: { color: theme.colors.soft, fontSize: 25, lineHeight: 27 },
  contactPickerList: { flexGrow: 0 },
  contactPickerListContent: { paddingVertical: 4 },
  contactPickerRow: { minHeight: 72, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  contactPickerRowSelected: { backgroundColor: "rgba(79,124,255,0.16)" },
  contactPickerMessageButton: { backgroundColor: theme.colors.blue, borderRadius: 17, paddingHorizontal: 12, paddingVertical: 8, marginLeft: 8 },
  contactPickerMessageText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  contactPickerPrivacy: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 16, paddingVertical: 12 },
  tabs: { flexDirection: "row", gap: 4, marginVertical: 8, width: "100%" },
  tab: { flex: 1, minWidth: 0, minHeight: 31, borderWidth: 1, borderColor: "rgba(226,181,101,0.22)", borderRadius: theme.radius.pill, paddingHorizontal: 2, paddingVertical: 6, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,18,17,0.50)" },
  activeTab: { backgroundColor: "rgba(31,101,52,0.72)", borderColor: "rgba(68,153,78,0.44)" },
  tabText: { color: "#e9e2d4", fontSize: 9.25, fontWeight: "500" },
  activeTabText: { color: "#fff" },
  loginGate: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, gap: 10 },
  loginTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  loginCopy: { color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
  loginButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10 },
  loginButtonText: { color: theme.colors.text, fontWeight: "900" },
  groupComposer: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, gap: 10, marginBottom: theme.spacing.md },
  groupPhotoPicker: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, padding: 10 },
  groupPhotoImage: { width: 56, height: 56, borderRadius: 28 },
  groupPhotoPlaceholder: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: "#17386c", borderWidth: 1, borderColor: theme.colors.blue },
  groupPhotoPlaceholderText: { color: theme.colors.text, fontSize: 24, fontWeight: "600" },
  groupPhotoCopy: { flex: 1, gap: 2 },
  groupPeoplePicker: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 14, paddingVertical: 10 },
  groupPeoplePickerIcon: { color: theme.colors.blue, fontSize: 26, fontWeight: "600" },
  groupPeoplePickerCopy: { flex: 1, gap: 2 },
  groupPeoplePickerTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  groupPeoplePickerMeta: { color: theme.colors.muted, fontSize: 12, lineHeight: 16 },
  groupPeoplePickerArrow: { color: theme.colors.muted, fontSize: 28 },
  composerDivider: { height: 1, backgroundColor: theme.colors.line, marginVertical: 4 },
  sectionTitle: { color: theme.colors.text, ...theme.typography.sectionTitle },
  input: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.md, paddingHorizontal: 13, minHeight: 45, fontSize: 14 },
  multiline: { minHeight: 82, paddingTop: 13, textAlignVertical: "top" },
  primaryButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingVertical: 13, alignItems: "center" },
  disabledButton: { opacity: 0.45 },
  primaryButtonText: { color: theme.colors.text, ...theme.typography.button },
  threadHeader: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, paddingTop: 7, paddingBottom: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(214,169,95,0.38)", backgroundColor: "rgba(5,31,25,0.96)", overflow: "hidden" },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 24, height: 24, justifyContent: "center" },
  backLine: { position: "absolute", width: 18, height: 4, borderRadius: 3, backgroundColor: "#D6A95F", left: 2 },
  backLineTop: { transform: [{ rotate: "-45deg" }], top: 6 },
  backLineBottom: { transform: [{ rotate: "45deg" }], bottom: 5 },
  threadAvatar: { width: 43, height: 43, borderRadius: 22, backgroundColor: "#173E2E", borderWidth: 1, borderColor: "rgba(214,169,95,0.62)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  threadAvatarImage: { width: "100%", height: "100%" },
  threadAvatarText: { color: "#f6e0ae", fontWeight: "700", fontSize: 15 },
  activeDot: { position: "absolute", right: 0, bottom: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: "#43c866", borderWidth: 2, borderColor: "#021c16" },
  threadHeaderCopy: { flex: 1 },
  threadHeaderTitle: { color: "#fff8e8", fontSize: 16.5, fontWeight: "600" },
  threadHeaderMeta: { color: "#C9C3AE", fontSize: 11.5, fontWeight: "400", marginTop: 2 },
  headerAction: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  messageSelectionBar: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.line, backgroundColor: "rgba(9,18,33,0.98)", zIndex: 12 },
  messageSelectionCancel: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.panel2 },
  messageSelectionCancelText: { color: theme.colors.text, fontSize: 25, lineHeight: 27, marginTop: -2 },
  messageSelectionTitle: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  messageSelectionAction: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, borderRadius: 18, borderWidth: 1, borderColor: "#315d98" },
  messageSelectionActionIcon: { color: "#8fb5ff", fontSize: 17 },
  messageSelectionActionText: { color: "#dce8ff", fontSize: 12, fontWeight: "600" },
  chatOptionsBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 39 },
  chatOptionsPanel: { position: "absolute", top: 58, right: 14, width: 258, backgroundColor: "#f7f3ed", borderRadius: 16, padding: 7, borderWidth: 1, borderColor: "#cbc7c0", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 15, shadowOffset: { width: 0, height: 7 }, elevation: 15, zIndex: 40 },
  chatOptionRow: { minHeight: 46, borderRadius: 11, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 11 },
  chatOptionIcon: { color: "#2864d7", width: 22, textAlign: "center", fontSize: 18, fontWeight: "900" },
  nearbyOptionRow: { minHeight: 58, borderTopWidth: 1, borderTopColor: "#ddd8d0", marginTop: 4, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  nearbyOptionCopy: { flex: 1, minWidth: 0 },
  nearbyOptionTitle: { color: "#1f2937", fontSize: 13, fontWeight: "700" },
  nearbyOptionMeta: { color: "#6b7280", fontSize: 10, lineHeight: 14, marginTop: 2 },
  chatOptionText: { color: "#242424", fontSize: 14, fontWeight: "600" },
  dotsIcon: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  dotIcon: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#D6A95F" },
  threadMessages: { flex: 1 },
  threadMessagesList: { flex: 1 },
  threadMessagesContent: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 10, gap: 2 },
  jumpToLatestButton: { position: "absolute", right: 16, bottom: 18, width: 43, height: 43, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7,35,29,0.94)", borderWidth: 1, borderColor: "rgba(214,169,95,0.55)", shadowColor: "#000", shadowOpacity: 0.26, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  jumpToLatestButtonText: { color: "#F4D99E", fontSize: 30, lineHeight: 32, fontWeight: "900", marginTop: -6 },
  threadListFooter: { overflow: "visible" },
  threadListEmpty: { minHeight: 360, flexGrow: 1, alignItems: "center", justifyContent: "center" },
  olderMessagesStatusWrap: { alignItems: "center", marginBottom: 8 },
  olderMessagesStatus: { color: theme.colors.muted, textAlign: "center", fontSize: 12, fontWeight: "800", paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: "rgba(3,16,15,0.82)", overflow: "hidden" },
  olderMessagesButton: { alignSelf: "center", minHeight: 38, justifyContent: "center", paddingHorizontal: 16, marginBottom: 8, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.06)" },
  olderMessagesButtonText: { color: theme.colors.soft, fontSize: 12, fontWeight: "900" },
  invertedListChrome: { transform: [{ scaleY: -1 }] },
  threadMessageCell: { overflow: "visible" },
  threadMessageRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-start", gap: 5, position: "relative", overflow: "visible" },
  threadMessageRowMine: { justifyContent: "flex-end" },
  threadMessageRunEnd: { marginBottom: 7 },
  swipeReplyWrap: { position: "relative", overflow: "visible" },
  swipeReplyBody: { overflow: "visible" },
  dateDivider: { alignSelf: "center", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5, marginVertical: 10, backgroundColor: "rgba(7,45,35,0.94)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(214,169,95,0.42)" },
  dateDividerLine: { display: "none" },
  dateDividerText: { color: "#E7D3A7", fontSize: 10, fontWeight: "600", letterSpacing: 0.8 },
  smallAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  smallAvatarImage: { width: "100%", height: "100%" },
  smallAvatarText: { color: "#0f172a", fontWeight: "900", fontSize: 10 },
  smallAvatarSpacer: { width: 26 },
  emptyThread: { alignItems: "center", gap: 6 },
  emptyThreadTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  emptyThreadCopy: { color: theme.colors.muted, fontSize: 14, fontWeight: "500" },
  loadingThreadShell: { flex: 1, minHeight: 260, alignItems: "center", justifyContent: "center" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 5, paddingHorizontal: 8, paddingTop: 7, paddingBottom: Platform.OS === "ios" ? 8 : 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(214,169,95,0.30)", backgroundColor: "rgba(5,31,25,0.97)", overflow: "hidden" },
  composerIcon: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  paperclipIcon: { color: "#D6A95F", fontSize: 24 },
  composerEmoji: { width: 32, height: 40, alignItems: "center", justifyContent: "center" },
  composerEmojiText: { color: "#D6A95F", fontSize: 25, lineHeight: 28 },
  replyComposerPreview: { position: "absolute", left: 8, right: 8, bottom: Platform.OS === "ios" ? 63 : 55, minHeight: 54, zIndex: 34, elevation: 18, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(214,169,95,0.42)", borderRadius: 14, backgroundColor: "rgba(7,38,30,0.98)", shadowColor: "#000", shadowOpacity: 0.24, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } },
  replyComposerBar: { width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: "#D6A95F" },
  replyComposerCopy: { flex: 1, minWidth: 0 },
  replyComposerName: { color: "#F4D99E", fontSize: 12, fontWeight: "900", marginBottom: 2 },
  replyComposerText: { color: "#E7E1D2", fontSize: 13, fontWeight: "600" },
  replyComposerClose: { width: 32, height: 32, color: "#D8DDDC", fontSize: 26, lineHeight: 31, textAlign: "center" },
  emojiPanel: { maxHeight: 330, borderRadius: 18, backgroundColor: "#f7f5f1", borderWidth: 1, borderColor: "#c8c5bf", paddingTop: 10, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 12 },
  emojiSearchRow: { minHeight: 42, marginHorizontal: 10, borderWidth: 2, borderColor: "#78b88c", borderRadius: 12, backgroundColor: "#fff", paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  emojiSearchIcon: { color: "#62676e", fontSize: 24 },
  emojiSearchInput: { flex: 1, color: "#20242a", fontSize: 15, paddingVertical: 7 },
  emojiClose: { color: "#666", fontSize: 25, paddingHorizontal: 4 },
  emojiSectionTitle: { color: "#666", fontSize: 14, fontWeight: "700", paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  emojiGridScroll: { maxHeight: 205 },
  emojiGrid: { paddingHorizontal: 9, paddingBottom: 10, flexDirection: "row", flexWrap: "wrap" },
  emojiCell: { width: "12.5%", minHeight: 43, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  emojiValue: { fontSize: 28 },
  emojiEmpty: { color: "#777", width: "100%", textAlign: "center", paddingVertical: 24 },
  emojiCategories: { flexGrow: 0, borderTopWidth: 1, borderTopColor: "#d7d4cf", backgroundColor: "#fff" },
  emojiCategoriesContent: { minWidth: "100%", justifyContent: "space-around", paddingHorizontal: 5, paddingVertical: 5 },
  emojiCategory: { width: 39, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  emojiCategoryActive: { backgroundColor: "#e5e5e5" },
  emojiCategoryText: { color: "#777", fontSize: 20 },
  emojiCategoryTextActive: { color: "#222" },
  quickReplies: { flexGrow: 0, marginTop: 5 },
  quickRepliesContent: { gap: 8, paddingHorizontal: 46, paddingVertical: 3 },
  quickReply: { borderWidth: 1, borderColor: "rgba(214,169,95,0.70)", backgroundColor: "rgba(8,43,34,0.94)", borderRadius: 20, paddingHorizontal: 15, minHeight: 36, alignItems: "center", justifyContent: "center" },
  quickReplyText: { color: "#E8D3A6", fontSize: 14, fontWeight: "600" },
  chittiTypingIndicator: { height: 28, marginLeft: 13, marginTop: 1, marginBottom: -2, alignSelf: "flex-start", maxWidth: "76%", flexDirection: "row", alignItems: "center", gap: 5, zIndex: 3 },
  chittiTypingMascotWrap: { width: 31, height: 34, marginTop: 5, overflow: "hidden" },
  chittiTypingMascot: { width: "100%", height: "100%" },
  chittiTypingText: { flexShrink: 1, color: "#f8e8be", fontSize: 12, fontWeight: "500" },
  chittiTypingDots: { color: "#efbd68", letterSpacing: 2 },
  plusIcon: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  plusHorizontal: { position: "absolute", width: 24, height: 5, borderRadius: 3, backgroundColor: theme.colors.blue },
  plusVertical: { position: "absolute", width: 5, height: 24, borderRadius: 3, backgroundColor: theme.colors.blue },
  attachmentPanel: { position: "absolute", left: 8, bottom: 62, width: 340, maxWidth: "92%", backgroundColor: "#f7f3ed", borderRadius: 22, padding: 14, borderWidth: 1, borderColor: "#cbc7c0", shadowColor: "#000", shadowOpacity: 0.24, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 14, zIndex: 20 },
  attachmentPanelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingHorizontal: 4 },
  attachmentPanelTitle: { color: "#242424", fontSize: 15, fontWeight: "700" },
  attachmentClose: { width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.06)", alignItems: "center", justifyContent: "center" },
  attachmentCloseText: { color: "#333", fontSize: 22, lineHeight: 24, marginTop: -2 },
  attachmentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  attachmentTile: { width: 94, minHeight: 116, alignItems: "center", justifyContent: "flex-start" },
  attachmentIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 7 },
  attachmentIconText: { color: "#fff", fontSize: 27, fontWeight: "900" },
  fileIcon: { backgroundColor: "#0aa3dc" },
  photoIcon: { backgroundColor: "#1479f5" },
  cameraIcon: { backgroundColor: "#3767d6" },
  pollIcon: { backgroundColor: "#ffad32" },
  eventIcon: { backgroundColor: "#f23d63" },
  contactIcon: { backgroundColor: "#e45d2a" },
  locationAttachmentIcon: { backgroundColor: "#16a36a" },
  attachmentLabel: { color: "#242424", fontSize: 13, lineHeight: 17, fontWeight: "700", textAlign: "center" },
  wallpaperPanel: { position: "absolute", left: 8, bottom: 62, width: 350, maxWidth: "94%", backgroundColor: "#f7f3ed", borderRadius: 22, padding: 15, borderWidth: 1, borderColor: "#cbc7c0", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 15, zIndex: 25 },
  wallpaperHelp: { color: "#716b63", fontSize: 12, marginHorizontal: 4, marginBottom: 12 },
  wallpaperGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  wallpaperChoice: { width: 96, height: 78, borderRadius: 14, overflow: "hidden", justifyContent: "flex-end", padding: 8, borderWidth: 2, borderColor: "transparent" },
  wallpaperChoiceSelected: { borderColor: theme.colors.blue },
  wallpaperChoiceGlow: { position: "absolute", width: 72, height: 72, borderRadius: 36, top: -28, right: -18, opacity: 0.65 },
  wallpaperChoiceLabel: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
    ...(Platform.OS === "web"
      ? ({ textShadow: "0 0 4px rgba(0,0,0,0.7)" } as object)
      : { textShadowColor: "rgba(0,0,0,0.7)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 4 })
  },
  customWallpaperChoice: { backgroundColor: "#5d5b58", alignItems: "center", justifyContent: "center" },
  customWallpaperPreview: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  customWallpaperPlus: { color: "#fff", fontSize: 28, fontWeight: "500", marginBottom: 2 },
  wallpaperReset: { marginTop: 12, minHeight: 40, borderRadius: 12, borderWidth: 1, borderColor: "#c9c3ba", alignItems: "center", justifyContent: "center" },
  wallpaperResetText: { color: "#39352f", fontWeight: "900", fontSize: 13 },
  attachmentStatus: { position: "absolute", bottom: 66, alignSelf: "center", backgroundColor: "rgba(15,23,42,0.94)", borderRadius: 18, paddingHorizontal: 15, paddingVertical: 9, zIndex: 30 },
  attachmentStatusText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  attachmentPreviewBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", paddingTop: Platform.OS === "ios" ? 56 : 24, paddingBottom: Platform.OS === "ios" ? 34 : 20, paddingHorizontal: 14 },
  attachmentPreviewHeader: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12 },
  attachmentPreviewName: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },
  groupPreviewHeaderCopy: { flex: 1, minWidth: 0, alignItems: "center" },
  groupPreviewCount: { color: "rgba(255,255,255,0.72)", fontSize: 11, fontWeight: "700", marginTop: 2 },
  attachmentPreviewClose: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.13)", alignItems: "center", justifyContent: "center" },
  attachmentPreviewCloseText: { color: "#fff", fontSize: 28, lineHeight: 30, marginTop: -2 },
  attachmentPreviewImage: { flex: 1, width: "100%", minHeight: 200 },
  groupPreviewScroll: { flex: 1 },
  groupPreviewContent: { gap: 10, paddingBottom: 24 },
  groupPreviewPhotoWrap: { width: "100%", minHeight: 480, borderRadius: 8, overflow: "hidden", position: "relative", backgroundColor: "#080808" },
  groupPreviewPhoto: { width: "100%", height: 560 },
  attachmentPreviewSave: { minHeight: 50, borderRadius: 25, backgroundColor: theme.colors.blue, alignItems: "center", justifyContent: "center", marginTop: 12 },
  attachmentPreviewSaveText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  mediaViewerBackdrop: { flex: 1, backgroundColor: "#000", paddingTop: Platform.OS === "ios" ? 48 : 20 },
  mediaViewerHeader: { minHeight: 92, paddingHorizontal: 14, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", zIndex: 2 },
  mediaViewerRoundButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(35,35,38,0.92)", borderWidth: 1, borderColor: "rgba(255,255,255,0.13)", alignItems: "center", justifyContent: "center" },
  mediaViewerBackText: { color: "#fff", fontSize: 39, lineHeight: 41, fontWeight: "300", marginTop: -4 },
  mediaViewerMenuText: { color: "#fff", fontSize: 16, letterSpacing: 2, fontWeight: "900" },
  mediaViewerPerson: { flex: 1, minWidth: 0, alignItems: "center", paddingHorizontal: 8, marginTop: -5 },
  mediaViewerAvatar: { width: 58, height: 58, borderRadius: 29, overflow: "hidden", backgroundColor: "#283145", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  mediaViewerAvatarImage: { width: "100%", height: "100%" },
  mediaViewerAvatarText: { color: "#fff", fontSize: 18, fontWeight: "900" },
  mediaViewerName: { maxWidth: 210, color: "#fff", fontSize: 16, lineHeight: 21, fontWeight: "800", marginTop: 5 },
  mediaViewerDate: { color: "rgba(255,255,255,0.54)", fontSize: 10, fontWeight: "700", marginTop: 1 },
  mediaViewerStage: { flex: 1, minHeight: 260, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  mediaViewerImage: { width: "100%", height: "100%", maxHeight: 680 },
  attachmentPreviewVideo: { width: "100%", height: "100%", maxHeight: 680, backgroundColor: "#000" },
  mediaViewerBottom: { paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 28 : 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.12)", backgroundColor: "#000", gap: 10 },
  mediaViewerThumbnails: { minHeight: 66, paddingHorizontal: 12, alignItems: "center", gap: 7 },
  mediaViewerThumbnail: { width: 52, height: 62, borderRadius: 7, overflow: "hidden", backgroundColor: "#17191d", borderWidth: 2, borderColor: "transparent" },
  mediaViewerThumbnailActive: { borderColor: "#fff" },
  mediaViewerVideoThumb: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#1c2026" },
  mediaViewerVideoThumbText: { color: "#fff", fontSize: 19 },
  mediaViewerActions: { flexDirection: "row", justifyContent: "center", gap: 12, paddingHorizontal: 14 },
  mediaViewerAction: { minWidth: 126, minHeight: 45, paddingHorizontal: 14, borderRadius: 23, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(35,35,38,0.92)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  mediaViewerActionGlyph: { color: "#fff", fontSize: 20, fontWeight: "800" },
  mediaViewerActionText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  forwardPickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.76)", paddingHorizontal: 16, justifyContent: "center" },
  forwardPickerCard: { width: "100%", maxWidth: 540, maxHeight: "78%", alignSelf: "center", ...theme.depth.card, paddingBottom: 14, overflow: "hidden" },
  forwardPickerHeader: { minHeight: 72, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  forwardPickerTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700" },
  forwardPickerSubtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 3 },
  forwardPickerList: { flexGrow: 0 },
  forwardPickerRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 15, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  forwardPickerRowSelected: { backgroundColor: "rgba(79,124,255,0.14)" },
  forwardPickerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  forwardPickerAvatarImage: { width: "100%", height: "100%" },
  forwardPickerAvatarText: { color: "#14213a", fontSize: 14, fontWeight: "700" },
  forwardPickerCopy: { flex: 1, minWidth: 0 },
  forwardPickerName: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  forwardPickerMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 3 },
  forwardPickerCheck: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: "#64748b", alignItems: "center", justifyContent: "center" },
  forwardPickerCheckSelected: { backgroundColor: theme.colors.blue, borderColor: theme.colors.blue },
  forwardPickerCheckText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  forwardPickerEmpty: { color: theme.colors.muted, textAlign: "center", paddingVertical: 30 },
  forwardPickerSubmit: { minHeight: 48, marginHorizontal: 14, marginTop: 13, borderRadius: 24, backgroundColor: theme.colors.blue, alignItems: "center", justifyContent: "center" },
  forwardPickerSubmitDisabled: { opacity: 0.42 },
  forwardPickerSubmitText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  contactShareArrow: { color: "#8fb5ff", fontSize: 28, fontWeight: "400" },
  contactSharePrivacy: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 16, paddingTop: 12 },
  pendingAttachmentCard: { minHeight: 68, borderRadius: 16, backgroundColor: "rgba(247,249,253,0.97)", borderWidth: 1, borderColor: "#d6dce7", padding: 8, marginTop: 6, marginHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  pendingAttachmentImage: { width: 72, height: 72, borderRadius: 12, backgroundColor: "#dde3ec" },
  pendingVideoPreview: { width: 72, height: 72, borderRadius: 12, backgroundColor: "#20252d", alignItems: "center", justifyContent: "center" },
  pendingVideoPreviewText: { color: "#fff", fontSize: 27, marginLeft: 3 },
  pendingCollagePreview: { width: 76, height: 76, flexDirection: "row", flexWrap: "wrap", gap: 2, overflow: "hidden", borderRadius: 12, backgroundColor: "#d7dde7" },
  pendingCollageCell: { width: 37, height: 37, overflow: "hidden", position: "relative" },
  pendingCollageImage: { width: "100%", height: "100%", borderRadius: 0 },
  pendingCollageMore: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  pendingCollageMoreText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  pendingPreviewFallback: { alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  pendingPreviewFallbackText: { color: "#667085", fontSize: 9, fontWeight: "700", textAlign: "center" },
  pendingAttachmentFileIcon: { width: 48, height: 48, borderRadius: 12, marginBottom: 0 },
  pendingAttachmentCopy: { flex: 1, minWidth: 0 },
  pendingAttachmentName: { color: "#17202d", fontSize: 13, fontWeight: "600" },
  pendingAttachmentMeta: { color: "#667085", fontSize: 11, fontWeight: "700", marginTop: 3 },
  pendingAttachmentRemove: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#e6e9ef", alignItems: "center", justifyContent: "center" },
  pendingAttachmentRemoveText: { color: "#344054", fontSize: 22, lineHeight: 24, marginTop: -2 },
  pendingFullPreview: { flex: 1, backgroundColor: "#080a0d", paddingTop: Platform.OS === "ios" ? 48 : 20 },
  pendingFullPreviewHeader: { minHeight: 64, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.16)" },
  pendingFullPreviewClose: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  pendingFullPreviewCloseText: { color: "#fff", fontSize: 34, lineHeight: 36, fontWeight: "400", marginTop: -3 },
  pendingFullPreviewTitleWrap: { flex: 1, minWidth: 0 },
  pendingFullPreviewTitle: { color: "#fff", fontSize: 17, fontWeight: "800", textAlign: "center" },
  pendingFullPreviewSubtitle: { color: "rgba(255,255,255,0.62)", fontSize: 11, fontWeight: "700", textAlign: "center", marginTop: 2 },
  pendingFullPreviewSendTop: { minWidth: 52, minHeight: 38, borderRadius: 19, backgroundColor: "#159a68", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  pendingFullPreviewSendTopText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  pendingFullPreviewScroll: { flex: 1 },
  pendingFullPreviewContent: { paddingHorizontal: 12, paddingVertical: 12, gap: 12 },
  pendingFullPreviewPhotoCard: { width: "100%", minHeight: 480, borderRadius: 18, overflow: "hidden", position: "relative", backgroundColor: "#11151a", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  pendingFullPreviewImage: { width: "100%", height: 560, maxHeight: 560, borderRadius: 0, backgroundColor: "#080a0d" },
  pendingFullPreviewNumber: { position: "absolute", left: 12, top: 12, minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 8, backgroundColor: "rgba(0,0,0,0.66)", alignItems: "center", justifyContent: "center" },
  pendingFullPreviewNumberText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  pendingFullPreviewRemove: { position: "absolute", right: 12, top: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.72)", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)", alignItems: "center", justifyContent: "center" },
  pendingFullPreviewRemoveText: { color: "#fff", fontSize: 27, lineHeight: 29, fontWeight: "500", marginTop: -2 },
  pendingFullPreviewFooter: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: Platform.OS === "ios" ? 28 : 14, gap: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.16)", backgroundColor: "rgba(10,13,17,0.98)" },
  pendingFullPreviewFooterText: { color: "rgba(255,255,255,0.62)", fontSize: 11, lineHeight: 16, fontWeight: "700", textAlign: "center" },
  pendingFullPreviewSend: { minHeight: 52, borderRadius: 26, backgroundColor: "#159a68", alignItems: "center", justifyContent: "center" },
  pendingFullPreviewSendText: { color: "#fff", fontSize: 16, fontWeight: "900" },
  richComposerPanel: { position: "absolute", left: 10, right: 10, bottom: 62, maxHeight: "78%", backgroundColor: "#ECEDEB", borderRadius: 22, padding: 14, borderWidth: 1, borderColor: "#CBCFCA", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 14, zIndex: 21, gap: 9, overflow: "hidden" },
  richInput: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#d8d3cb", borderRadius: 12, minHeight: 44, paddingHorizontal: 12, color: "#222", fontSize: 14 },
  richMultiline: { minHeight: 82, paddingTop: 12, textAlignVertical: "top" },
  richSubmit: { backgroundColor: theme.colors.blue, borderRadius: 14, minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 2 },
  richSubmitText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  fileCard: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 220, maxWidth: 280, borderRadius: 10, padding: 10, backgroundColor: "rgba(18,24,31,0.92)", marginBottom: 5 },
  fileCardIcon: { width: 42, height: 46, borderRadius: 7, marginBottom: 0, backgroundColor: "#d9164b" },
  fileCardBadge: { color: "#fff", fontSize: 10, fontWeight: "800" },
  fileCardCopy: { flex: 1 },
  fileCardName: { color: "#f5f7fa", fontSize: 13, lineHeight: 17, fontWeight: "500" },
  fileCardMeta: { color: "#aeb5c0", fontSize: 10, marginTop: 3, fontWeight: "500" },
  expiredMediaCard: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 220, maxWidth: 280, borderRadius: 14, padding: 12, backgroundColor: "rgba(24,28,34,0.88)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", marginBottom: 5 },
  expiredMediaIcon: { width: 40, height: 40, borderRadius: 20, overflow: "hidden", textAlign: "center", textAlignVertical: "center", backgroundColor: "rgba(255,255,255,0.12)", fontSize: 20, lineHeight: 40 },
  expiredMediaCopy: { flex: 1, minWidth: 0 },
  expiredMediaTitle: { color: "#f5f7fa", fontSize: 13, fontWeight: "900" },
  expiredMediaText: { color: "#aeb5c0", fontSize: 10, lineHeight: 14, marginTop: 2, fontWeight: "700" },
  richCard: { minWidth: 230, maxWidth: 290, borderRadius: 14, padding: 12, backgroundColor: "rgba(255,255,255,0.90)", marginBottom: 4, gap: 6 },
  locationCard: { minWidth: 220, maxWidth: 290, borderRadius: 14, padding: 12, backgroundColor: "rgba(255,255,255,0.92)", marginBottom: 4, flexDirection: "row", alignItems: "center", gap: 11 },
  locationIcon: { width: 40, height: 40, borderRadius: 20, overflow: "hidden", textAlign: "center", textAlignVertical: "center", backgroundColor: "#d8f6e8", color: "#087f55", fontSize: 24, lineHeight: 40 },
  locationCopy: { flex: 1, minWidth: 0, gap: 3 },
  locationTitle: { color: "#17202d", fontSize: 14, fontWeight: "700" },
  locationMeta: { color: "#667085", fontSize: 11, lineHeight: 15 },
  richEyebrow: { color: "#087f72", fontSize: 10, letterSpacing: 0.8, fontWeight: "600" },
  richTitle: { color: "#17202d", fontSize: 16, lineHeight: 20, fontWeight: "700" },
  richDetail: { color: "#475467", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  richLink: { color: "#1463d9", fontSize: 13, lineHeight: 20, fontWeight: "800" },
  pollMeta: { color: "#68706B", fontSize: 10.5, lineHeight: 15, fontWeight: "600", marginTop: 5, marginBottom: 8 },
  pollOption: { position: "relative", minHeight: 60, borderRadius: 13, borderWidth: 1, borderColor: "#CBD3CC", paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  pollOptionSelected: { borderColor: "#15945A" },
  pollOptionClosed: { opacity: 0.78 },
  pollProgress: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "rgba(26,168,102,0.16)" },
  pollChoiceMark: { width: 25, height: 25, borderRadius: 13, borderWidth: 2, borderColor: "#737B75", backgroundColor: "#fff", alignItems: "center", justifyContent: "center", marginRight: 9 },
  pollChoiceMarkSelected: { borderColor: "#15945A", backgroundColor: "#15945A" },
  pollChoiceCheck: { color: "#fff", fontSize: 13, fontWeight: "900" },
  pollOptionCopy: { flex: 1 },
  pollOptionLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  pollOptionText: { color: "#263244", fontSize: 12, fontWeight: "800", flex: 1 },
  pollOptionTextSelected: { color: "#116B43" },
  pollCount: { color: "#667085", fontSize: 11, fontWeight: "900", marginLeft: 8 },
  pollPercent: { color: "#7A827C", fontSize: 9.5, fontWeight: "700", marginTop: 3 },
  pollFooter: { color: "#727A74", fontSize: 10, fontWeight: "600", marginTop: 8 },
  pollComposerSetting: { minHeight: 62, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  pollComposerSettingLast: { borderBottomWidth: 0 },
  pollSettingCopy: { flex: 1 },
  pollComposerSettingTitle: { color: "#181B19", fontSize: 14, fontWeight: "700" },
  pollComposerSettingMeta: { color: "#727773", fontSize: 10.5, marginTop: 2 },
  pollComposerLabel: { color: "#656A66", fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7, marginTop: 13, marginBottom: 7 },
  pollDurationRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  pollDurationChoice: { borderRadius: 18, borderWidth: 1, borderColor: "#CED3CF", backgroundColor: "#FFF", paddingHorizontal: 12, paddingVertical: 8 },
  pollDurationChoiceActive: { borderColor: "#1AA866", backgroundColor: "rgba(26,168,102,0.18)" },
  pollDurationChoiceText: { color: "#606762", fontSize: 11, fontWeight: "700" },
  pollDurationChoiceTextActive: { color: "#087744" },
  pollPrivacyNote: { color: "#5D6961", fontSize: 10.5, fontWeight: "600", marginTop: 11 },
  pollSheetHeader: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: "#D3D6D2" },
  pollSheetCancel: { color: "#2A302C", fontSize: 14, fontWeight: "600" },
  pollSheetTitle: { color: "#151816", fontSize: 16, fontWeight: "900" },
  pollSheetSend: { color: "#118A55", fontSize: 14, fontWeight: "900" },
  pollSheetSendDisabled: { color: "#9AA09C" },
  pollSheetScroll: { maxHeight: 540 },
  pollSheetContent: { paddingBottom: 8 },
  pollQuestionInput: { minHeight: 58, backgroundColor: "#FFF", borderRadius: 12, borderWidth: 1, borderColor: "#DDE0DC", paddingHorizontal: 13, color: "#171A18", fontSize: 15 },
  pollOptionsCard: { backgroundColor: "#FFF", borderRadius: 12, borderWidth: 1, borderColor: "#DDE0DC", overflow: "hidden" },
  pollOptionInputRow: { minHeight: 49, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#E4E6E3", paddingLeft: 13 },
  pollOptionInputRowLast: { borderBottomWidth: 0 },
  pollOptionInput: { flex: 1, minHeight: 48, color: "#171A18", fontSize: 14, paddingVertical: 0 },
  pollRemoveOption: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  pollRemoveOptionText: { color: "#A04B55", fontSize: 24, fontWeight: "400" },
  pollAddOption: { alignSelf: "flex-start", minHeight: 38, justifyContent: "center", paddingHorizontal: 4 },
  pollAddOptionText: { color: "#118A55", fontSize: 13, fontWeight: "800" },
  pollSettingsCard: { backgroundColor: "#FFF", borderRadius: 12, borderWidth: 1, borderColor: "#DDE0DC", paddingHorizontal: 13, marginTop: 8 },
  composerInput: { flex: 1, color: "#18342A", backgroundColor: "#F3E9D5", borderWidth: 1, borderColor: "rgba(214,169,95,0.62)", borderRadius: 21, paddingHorizontal: 14, paddingVertical: 9, minHeight: 40, maxHeight: 110, fontSize: 16 },
  composerSend: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#2B8A60", borderWidth: 1, borderColor: "#D6A95F", alignItems: "center", justifyContent: "center" },
  composerSendText: { color: "#FFF9ED", fontSize: 18, fontWeight: "900" },
  sendIcon: { width: 19, height: 19, justifyContent: "center", marginLeft: 2 },
  sendWingTop: { position: "absolute", width: 17, height: 4, borderRadius: 3, backgroundColor: theme.colors.text, transform: [{ rotate: "32deg" }], top: 5 },
  sendWingBottom: { position: "absolute", width: 17, height: 4, borderRadius: 3, backgroundColor: theme.colors.text, transform: [{ rotate: "-32deg" }], bottom: 5 },
  thread: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, marginBottom: theme.spacing.md },
  sectionEyebrow: { color: theme.colors.muted, fontWeight: "600", textTransform: "uppercase", fontSize: 11 },
  threadTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700", marginTop: 2, marginBottom: 10 },
  threadActions: { flexDirection: "row", gap: 8, marginBottom: 10 },
  smallAction: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  smallActionText: { color: theme.colors.soft, fontWeight: "900", fontSize: 12 },
  messages: { maxHeight: 260, backgroundColor: theme.colors.bg, borderRadius: theme.radius.md },
  messagesContent: { padding: theme.spacing.sm, gap: 8 },
  emptyText: { color: theme.colors.muted, textAlign: "center", padding: theme.spacing.md, fontWeight: "800" },
  bubble: { maxWidth: "88%", minWidth: 70, borderRadius: 11, paddingLeft: 9, paddingRight: 9, paddingTop: 6, paddingBottom: 4, position: "relative", shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 1.5, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  photoBubble: { maxWidth: "94%", padding: 5, borderRadius: 19, overflow: "visible", backgroundColor: "#202321" },
  myPhotoBubble: { backgroundColor: "#202321", borderColor: "rgba(255,255,255,0.16)", borderBottomRightRadius: 19 },
  theirPhotoBubble: { backgroundColor: "#202321", borderColor: "rgba(255,255,255,0.16)", borderBottomLeftRadius: 19 },
  selectedMessageBubble: { borderWidth: 2, borderColor: "#4f7cff" },
  messageSelectionCheck: { position: "absolute", top: -9, right: -9, width: 22, height: 22, borderRadius: 11, backgroundColor: "#356df3", borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center", zIndex: 5 },
  messageSelectionCheckText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  myBubble: { backgroundColor: "#176B4A", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(80,174,126,0.65)", alignSelf: "flex-end", borderBottomRightRadius: 2 },
  theirBubble: { backgroundColor: "#F2E8D3", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(183,145,78,0.42)", alignSelf: "flex-start", borderBottomLeftRadius: 2 },
  bubbleTail: { position: "absolute", bottom: 1, width: 11, height: 11, transform: [{ rotate: "45deg" }], zIndex: -1 },
  myBubbleTail: { right: -5, backgroundColor: "#176B4A" },
  theirBubbleTail: { left: -5, backgroundColor: "#F2E8D3" },
  senderLine: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  senderName: { color: "#255744", fontSize: 12, fontWeight: "600" },
  senderTime: { color: "#786F5C", fontSize: 11, fontWeight: "700" },
  photoSenderLine: { maxWidth: 286, paddingHorizontal: 8, paddingTop: 4, marginBottom: 7 },
  photoSenderName: { flex: 1, color: "#ff9b7f", fontSize: 14, lineHeight: 18, fontWeight: "800" },
  messageContext: { borderLeftWidth: 4, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, minWidth: 190 },
  myMessageContext: { borderLeftColor: "#D6A95F", backgroundColor: "rgba(246,237,218,0.92)" },
  theirMessageContext: { borderLeftColor: "#2B8061", backgroundColor: "rgba(35,97,73,0.10)" },
  messageContextType: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  myMessageContextType: { color: "#7A5622" },
  theirMessageContextType: { color: "#237158" },
  messageContextTitle: { fontSize: 13, lineHeight: 17, fontWeight: "600" },
  myMessageContextTitle: { color: "#17202d" },
  theirMessageContextTitle: { color: "#17202d" },
  messageContextSubtitle: { fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: "700" },
  myMessageContextSubtitle: { color: "#596273" },
  theirMessageContextSubtitle: { color: "#596273" },
  quotedReply: { borderLeftWidth: 3, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7, marginBottom: 7, minWidth: 190 },
  myQuotedReply: { borderLeftColor: "#F4D99E", backgroundColor: "rgba(255,255,255,0.14)" },
  theirQuotedReply: { borderLeftColor: "#2B8061", backgroundColor: "rgba(35,97,73,0.10)" },
  quotedReplyName: { color: "#D6A95F", fontSize: 12, fontWeight: "900", marginBottom: 2 },
  quotedReplyText: { color: "#776E5B", fontSize: 12, lineHeight: 16, fontWeight: "600" },
  bubbleText: { fontSize: 15.5, lineHeight: 20, fontWeight: "400" },
  discoveredLink: { textDecorationLine: "underline", fontWeight: "600" },
  myDiscoveredLink: { color: "#DDEFE6" },
  theirDiscoveredLink: { color: "#176A55" },
  websitePreviewCard: { width: 286, marginTop: 7, marginBottom: 3, borderRadius: 13, borderWidth: 1, overflow: "hidden" },
  myWebsitePreviewCard: { backgroundColor: "rgba(243,233,211,0.96)", borderColor: "rgba(73,87,74,0.22)" },
  theirWebsitePreviewCard: { backgroundColor: "#E7DBC1", borderColor: "#D1C19E" },
  websitePreviewImage: { width: "100%", height: 154, backgroundColor: "#D7D8D4" },
  websitePreviewContent: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 11 },
  websitePreviewSource: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 9 },
  websitePreviewIcon: { width: 22, height: 22, borderRadius: 6, backgroundColor: "#237458", alignItems: "center", justifyContent: "center" },
  websitePreviewIconText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  websitePreviewFavicon: { width: 22, height: 22, borderRadius: 5 },
  websitePreviewHost: { flex: 1, color: "#526074", fontSize: 11.5, fontWeight: "600" },
  websitePreviewTitle: { color: "#17202d", fontSize: 14, lineHeight: 19, fontWeight: "700" },
  websitePreviewDetail: { color: "#667085", fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  myWebsitePreviewText: { color: "#16334a" },
  myWebsitePreviewDetail: { color: "#526474" },
  photoMediaWrap: { position: "relative", borderRadius: 15, overflow: "visible" },
  messageImage: { width: 286, height: 300, borderRadius: 15, backgroundColor: theme.colors.panel2 },
  messageCollage: { width: 246, flexDirection: "row", flexWrap: "wrap", gap: 3, borderRadius: 14, overflow: "hidden", marginBottom: 6 },
  collageCell: { width: 121.5, height: 121.5, overflow: "hidden", position: "relative", backgroundColor: theme.colors.panel2 },
  collageImage: { width: "100%", height: "100%", borderRadius: 0, marginBottom: 0 },
  collageMore: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.58)", alignItems: "center", justifyContent: "center" },
  collageMoreText: { color: "#fff", fontSize: 24, fontWeight: "700" },
  collageTimeOverlay: { position: "absolute", right: 6, bottom: 6, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.58)", paddingHorizontal: 6, paddingVertical: 2, zIndex: 2 },
  collageTimeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  messageImageLoading: { height: 300, alignItems: "center", justifyContent: "center" },
  messageImageLoadingText: { color: theme.colors.muted, fontSize: 12, fontWeight: "800" },
  photoTimeOverlay: { position: "absolute", right: 8, bottom: 7, minHeight: 23, flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.64)", paddingHorizontal: 8, paddingVertical: 3 },
  photoTimeText: { color: "#fff", fontSize: 11, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 2 },
  photoReceipt: { color: "#d8e5dd", fontSize: 12, lineHeight: 14, fontWeight: "800", letterSpacing: -2 },
  photoForwardAction: { position: "absolute", right: -47, bottom: 10, width: 39, height: 39, borderRadius: 20, backgroundColor: "rgba(37,41,40,0.92)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  photoForwardActionMine: { right: undefined, left: -47 },
  photoForwardActionText: { color: "#e7e7e7", fontSize: 23, lineHeight: 25, fontWeight: "800", marginTop: -2 },
  videoMessageCard: { width: 246, minHeight: 180, borderRadius: 15, backgroundColor: "#181c22", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 },
  videoDownloadOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 8, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  videoDownloadBlurFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,18,15,0.48)" },
  downloadProgressCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(3,18,12,0.74)", borderWidth: 1, borderColor: "rgba(50,215,135,0.25)" },
  downloadProgressSegment: { position: "absolute", left: 33, top: 31, width: 5, height: 10, borderRadius: 3, backgroundColor: "rgba(219,255,236,0.16)" },
  downloadProgressSegmentActive: { backgroundColor: "#26D980" },
  downloadProgressCenter: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(4,30,20,0.94)", alignItems: "center", justifyContent: "center" },
  downloadProgressText: { color: "#E8FFF3", fontSize: 12, fontWeight: "900" },
  videoMessagePlay: { width: 58, height: 58, borderRadius: 29, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", paddingLeft: 4 },
  videoMessagePlayText: { color: "#fff", fontSize: 25 },
  videoMessageTitle: { color: "#fff", fontSize: 15, fontWeight: "900" },
  myBubbleText: { color: "#FFF9ED" },
  theirBubbleText: { color: "#18342A" },
  bubbleMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", alignSelf: "flex-end", gap: 3, marginTop: 1, minHeight: 14 },
  bubbleMeta: { fontSize: 10.5, fontWeight: "400" },
  myBubbleMeta: { color: "#CDE0D5" },
  theirBubbleMeta: { color: "#776E5B" },
  receiptMark: { color: "#66756a", fontSize: 12, lineHeight: 14, fontWeight: "700", letterSpacing: -2 },
  receiptSeen: { color: "#1689d8" },
  receiptFailed: { color: "#dc2626", letterSpacing: 0 },
  messageReactions: { position: "absolute", right: -5, bottom: -9, flexDirection: "row", alignItems: "center", gap: 0, zIndex: 8, elevation: 8 },
  messageReactionsMine: { right: -5 },
  messageReactionChip: { minHeight: 21, minWidth: 25, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 1, paddingHorizontal: 4, borderRadius: 11, borderWidth: 1, borderColor: "rgba(214,169,95,0.34)", backgroundColor: "rgba(15,23,22,0.92)" },
  messageReactionChipMine: { backgroundColor: "rgba(9,48,36,0.96)", borderColor: "rgba(214,169,95,0.48)" },
  messageReactionEmoji: { fontSize: 13 },
  messageReactionCount: { color: "#F0E4CA", fontSize: 9, fontWeight: "800" },
  messageActionBackdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 18, backgroundColor: "transparent" },
  messageActionBlurFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(3,9,14,0.58)" },
  messageActionDismissLayer: { ...StyleSheet.absoluteFillObject },
  messageActionStack: { width: "100%", maxWidth: 390, alignSelf: "center", zIndex: 3, elevation: 30 },
  messageActionStackMine: { alignItems: "flex-end" },
  messageReactionTray: { alignSelf: "flex-start", maxWidth: "96%", minHeight: 58, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 29, backgroundColor: "rgba(28,31,34,0.97)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.08)", shadowColor: "#000", shadowOpacity: 0.30, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 18, zIndex: 3 },
  messageReactionTrayMine: { alignSelf: "flex-end" },
  messageReactionChoice: { width: 38, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  messageReactionChoiceText: { fontSize: 28 },
  messageReactionMore: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.13)" },
  messageReactionMoreText: { color: "#D8DDE5", fontSize: 28, lineHeight: 31, fontWeight: "300" },
  messageActionPreviewRow: { width: "100%", alignItems: "flex-start", marginTop: 10, marginBottom: 8 },
  messageActionPreviewRowMine: { alignItems: "flex-end" },
  messageActionPreviewBubble: { transform: [{ scale: 1.015 }], shadowColor: "#000", shadowOpacity: 0.32, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 24 },
  messagePreviewReactions: { position: "absolute", right: -5, bottom: -9, flexDirection: "row", gap: 0, zIndex: 9 },
  messageActionSheet: { width: 286, maxWidth: "86%", alignSelf: "flex-start", marginTop: 0, borderRadius: 28, paddingVertical: 12, backgroundColor: "rgba(54,59,66,0.98)", shadowColor: "#000", shadowOpacity: 0.34, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 20, overflow: "hidden", zIndex: 3 },
  messageActionSheetMine: { alignSelf: "flex-end" },
  messageActionRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 24 },
  messageActionGlyph: { width: 28, color: "#F5F7FA", fontSize: 25, lineHeight: 30, textAlign: "center", fontWeight: "400" },
  messageActionLabel: { color: "#F5F7FA", fontSize: 18, fontWeight: "500" },
  messageActionDanger: { color: "#FF687D" },
  messageBox: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "flex-end" },
  messageInput: { flex: 1, color: theme.colors.text, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.md, paddingHorizontal: 12, minHeight: 46, maxHeight: 110 },
  send: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingHorizontal: 18, minHeight: 46, justifyContent: "center" },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: theme.colors.text, fontWeight: "900" },
  cancelEdit: { alignSelf: "flex-start", marginTop: 8 },
  cancelEditText: { color: theme.colors.muted, fontWeight: "900" },
  list: { flex: 1 },
  listContent: { paddingBottom: 88 },
  loadMoreLetters: { alignSelf: "center", borderWidth: 1, borderColor: theme.colors.warning, borderRadius: theme.radius.pill, paddingHorizontal: 22, paddingVertical: 11, marginTop: 8, marginBottom: 12 },
  loadMoreLettersText: { color: theme.colors.warning, fontWeight: "800", fontSize: 14 },
  chatRow: { minHeight: 78, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, paddingVertical: 11, marginBottom: 9, gap: 11, borderWidth: 1, borderColor: "rgba(219,180,107,0.16)", borderRadius: 22, backgroundColor: "rgba(7,24,22,0.76)", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  chatRowUnread: { minHeight: 86, borderColor: "rgba(87,184,91,0.70)", backgroundColor: "rgba(5,42,28,0.84)" },
  communityRow: { backgroundColor: "rgba(8,25,24,0.82)" },
  avatarWrap: { position: "relative" },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#123c27", alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1.5, borderColor: "rgba(210,167,89,0.54)" },
  avatarUnread: { borderColor: "rgba(86,190,100,0.88)" },
  avatarImage: { width: "100%", height: "100%" },
  inboxOnlineDot: { position: "absolute", width: 11, height: 11, borderRadius: 6, right: 0, bottom: 1, backgroundColor: "#3dbb59", borderWidth: 2, borderColor: "#051b13" },
  groupAvatar: { backgroundColor: "#123c27" },
  avatarText: { color: theme.colors.text, fontWeight: "700", fontSize: 16 },
  chatCopy: { flex: 1, minWidth: 0 },
  chatKind: { color: "#8f713f", fontSize: 7.25, lineHeight: 9, fontWeight: "700", letterSpacing: 0.75, marginBottom: 1 },
  chatName: { color: "#f5f3eb", fontSize: 16, fontWeight: "600" },
  communityGlyph: { fontSize: 24 },
  chatSubject: { color: theme.colors.soft, marginTop: 2, fontSize: 13, fontWeight: "500" },
  chatLast: { color: "#aaaead", marginTop: 4, fontSize: 13 },
  chatLastUnread: { color: "#efbd68", fontWeight: "500" },
  chatMeta: { alignItems: "flex-end", minWidth: 34, gap: 6 },
  chatTime: { color: "#a9ada9", fontWeight: "500", fontSize: 12 },
  chatTimeUnread: { color: "#4fc35e" },
  unread: { minWidth: 24, height: 24, lineHeight: 24, textAlign: "center", backgroundColor: "#287d39", color: "#fff", borderRadius: 12, overflow: "hidden", paddingHorizontal: 6, fontWeight: "700", fontSize: 12 },
  memberCount: { color: theme.colors.muted, fontWeight: "600" },
  joinCommunityText: { color: "#65D889", fontWeight: "800" },
  rowAction: { paddingVertical: 8, paddingLeft: 8 },
  groupInfoPanel: { ...StyleSheet.absoluteFillObject, zIndex: 40, backgroundColor: "#F3F4F1", elevation: 30 },
  groupInfoHeader: { minHeight: 62, paddingHorizontal: 15, paddingTop: 4, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#D9DDD8", backgroundColor: "rgba(250,251,249,0.98)" },
  groupInfoHeaderButton: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" },
  groupInfoHeaderButtonText: { color: "#118A55", fontSize: 38, lineHeight: 40, fontWeight: "300" },
  groupInfoHeaderTitle: { flex: 1, color: "#121513", fontSize: 18, fontWeight: "800", textAlign: "center" },
  groupInfoDoneButton: { minWidth: 44, height: 44, alignItems: "flex-end", justifyContent: "center" },
  groupInfoDoneText: { color: "#118A55", fontSize: 15, fontWeight: "800" },
  groupInfoScroll: { flex: 1 },
  groupInfoContent: { paddingHorizontal: 14, paddingTop: 24, paddingBottom: 48 },
  groupInfoHero: { alignItems: "center", paddingBottom: 22 },
  groupInfoAvatar: { width: 104, height: 104, borderRadius: 52, backgroundColor: "#D8F0E3", borderWidth: 2, borderColor: "#A8DDBF", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  groupInfoAvatarImage: { width: "100%", height: "100%" },
  groupInfoAvatarText: { color: "#117248", fontSize: 30, fontWeight: "800" },
  groupInfoEditBadge: { position: "absolute", right: 2, bottom: 2, width: 28, height: 28, borderRadius: 14, backgroundColor: "#118A55", borderWidth: 2, borderColor: "#F3F4F1", alignItems: "center", justifyContent: "center" },
  groupInfoEditBadgeText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  groupInfoTitle: { color: "#101311", fontSize: 25, fontWeight: "800", textAlign: "center", marginTop: 14 },
  groupInfoMeta: { color: "#6D736F", fontSize: 15, fontWeight: "500", textAlign: "center", marginTop: 5 },
  groupInfoActions: { flexDirection: "row", gap: 10, marginBottom: 14 },
  groupInfoAction: { flex: 1, minHeight: 76, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E0E3DE", alignItems: "center", justifyContent: "center" },
  groupInfoActionIcon: { color: "#10935A", fontSize: 25, fontWeight: "500", marginBottom: 5 },
  groupInfoActionLabel: { color: "#171A18", fontSize: 13, fontWeight: "700" },
  groupInfoCard: { borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E0E3DE", paddingHorizontal: 16, marginBottom: 14, overflow: "hidden" },
  groupInfoDescription: { color: "#202421", fontSize: 15, lineHeight: 22, paddingTop: 15, paddingBottom: 10 },
  groupInfoDescriptionMeta: { color: "#118A55", fontSize: 13, fontWeight: "700", paddingBottom: 15 },
  groupInfoSettingRow: { minHeight: 64, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#E4E6E2" },
  groupInfoSettingRowLast: { borderBottomWidth: 0 },
  groupInfoSettingIcon: { width: 36, color: "#118A55", fontSize: 22, textAlign: "center", marginRight: 8 },
  groupInfoSettingCopy: { flex: 1 },
  groupInfoSettingTitle: { color: "#191C1A", fontSize: 15, fontWeight: "700" },
  groupInfoSettingMeta: { color: "#777D79", fontSize: 12, marginTop: 2 },
  groupInfoChevron: { color: "#969C98", fontSize: 28, fontWeight: "300" },
  groupMembersSection: { borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E0E3DE", paddingHorizontal: 14, marginBottom: 14, overflow: "hidden" },
  groupMembersHeading: { color: "#555C57", fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7, paddingTop: 16, paddingBottom: 11 },
  groupMembersSearch: { height: 42, flexDirection: "row", alignItems: "center", backgroundColor: "#EFF1EE", borderRadius: 12, paddingHorizontal: 12, marginBottom: 8 },
  groupMembersSearchIcon: { color: "#68706B", fontSize: 21, marginRight: 7 },
  groupMembersSearchInput: { flex: 1, height: 42, color: "#151816", fontSize: 15, paddingVertical: 0 },
  groupMemberRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1, borderBottomColor: "#E6E8E4" },
  groupMemberAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#DDEFE5", borderWidth: 1, borderColor: "#B8DCC7", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  groupMemberAvatarImage: { width: "100%", height: "100%" },
  groupMemberAvatarText: { color: "#0E7547", fontSize: 14, fontWeight: "800" },
  groupMemberAddAvatar: { backgroundColor: "#118A55", borderColor: "#118A55" },
  groupMemberAddIcon: { color: "#fff", fontSize: 26, fontWeight: "400" },
  groupMemberCopy: { flex: 1, minWidth: 0 },
  groupMemberNameLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  groupMemberName: { color: "#171A18", fontSize: 15, fontWeight: "700", flexShrink: 1 },
  groupMemberCurrentTag: { color: "#118A55", backgroundColor: "#E5F5EC", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, fontSize: 10, fontWeight: "800" },
  groupMemberSubtext: { color: "#757C77", fontSize: 12, marginTop: 3 },
  groupMemberAddText: { color: "#118A55", fontSize: 15, fontWeight: "800" },
  groupMemberRole: { color: "#118A55", fontSize: 12, fontWeight: "700" },
  groupMemberManageButton: { minWidth: 34, height: 34, borderRadius: 17, backgroundColor: "#EFF3EF", alignItems: "center", justifyContent: "center" },
  groupMemberManageIcon: { color: "#66706A", fontSize: 13, fontWeight: "900", letterSpacing: -1 },
  groupMemberChevron: { color: "#8D938F", fontSize: 27, fontWeight: "300" },
  groupMembersEmpty: { color: "#767D78", fontSize: 14, textAlign: "center", paddingVertical: 24 },
  leaveGroupButton: { minHeight: 54, borderRadius: 16, borderWidth: 1, borderColor: "#F0C7CC", backgroundColor: "#FFF", alignItems: "center", justifyContent: "center" },
  leaveGroupText: { color: "#C83343", fontSize: 15, fontWeight: "800" },
  chevron: { color: theme.colors.muted, fontSize: 26, marginTop: -2 },
  emptyList: { color: theme.colors.muted, fontWeight: "500", textAlign: "center", padding: theme.spacing.lg },
  letterEmptyCard: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 24, borderRadius: 22, borderWidth: 1, borderColor: "rgba(219,180,107,0.24)", backgroundColor: "rgba(7,24,22,0.78)", alignItems: "center" },
  letterEmptyIcon: { fontSize: 30, marginBottom: 8 },
  letterEmptyTitle: { color: "#f5f3eb", fontSize: 17, fontWeight: "600", textAlign: "center" },
  letterEmptyCopy: { color: "#aeb3ae", fontSize: 12.5, lineHeight: 18, textAlign: "center", marginTop: 5 },
  feedbackChatCard: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10, paddingLeft: 13, paddingRight: 28, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: "rgba(239,189,104,0.72)", backgroundColor: "rgba(27,62,44,0.94)", position: "relative" },
  feedbackChatAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#D6A95F", borderWidth: 2, borderColor: "#F4D99E" },
  feedbackChatAvatarText: { color: "#173A2A", fontSize: 14, fontWeight: "800" },
  feedbackChatEyebrow: { color: "#efbd68", fontSize: 9, letterSpacing: 0.9, fontWeight: "800", marginBottom: 2 },
  feedbackChatName: { color: "#fff8e8", fontSize: 15, fontWeight: "700" },
  feedbackChatCopy: { color: "#c4cec7", fontSize: 11.5, lineHeight: 15, marginTop: 2 },
  feedbackChatArrow: { color: "#efbd68", fontSize: 25, fontWeight: "300" },
  feedbackChatDismiss: { position: "absolute", top: 3, right: 5, width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(2,18,13,0.58)", zIndex: 3 },
  feedbackChatDismissText: { color: "#f4d99e", fontSize: 18, lineHeight: 21, fontWeight: "500" },
  groupSuggestionsSection: { marginBottom: 12, padding: 10, borderRadius: 20, borderWidth: 1, borderColor: "rgba(219,180,107,0.22)", backgroundColor: "rgba(7,24,22,0.74)", gap: 7 },
  groupSuggestionsHeader: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 3 },
  groupSuggestionsCopy: { flex: 1, minWidth: 0 },
  groupSuggestionsTitle: { color: "#efbd68", fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  groupSuggestionsSubtitle: { color: "#9eaaa2", fontSize: 10.5, marginTop: 2 },
  groupSuggestionsDismiss: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)" },
  groupSuggestionsDismissText: { color: "#cbd2cd", fontSize: 20, lineHeight: 23 },
  suggestedGroupRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 15, backgroundColor: "rgba(20,51,40,0.72)" },
  suggestedJoinButton: { minWidth: 48, height: 30, paddingHorizontal: 10, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#1b8551" },
  suggestedJoinText: { color: "#fff", fontSize: 11, fontWeight: "800" }
});
