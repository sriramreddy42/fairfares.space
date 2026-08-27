import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Contacts from "expo-contacts";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import { useAudioPlayer } from "expo-audio";
import { BlurView } from "expo-blur";
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "@noble/hashes/utils";
import { useVideoPlayer, VideoView } from "expo-video";
import { ActivityIndicator, Alert, Animated, AppState, FlatList, Image, InteractionManager, Keyboard, KeyboardAvoidingView, Linking, Modal, PanResponder, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, useColorScheme, View } from "react-native";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { UserAvatar } from "../components/UserAvatar";
import { mapCoordinatesUrl, nativeMapProviderName } from "../utils/maps";
import { useResponsiveLayout } from "../utils/layout";
import {
  absoluteAssetUrl,
  authenticatedAssetSource,
  addChatGroupMember,
  blockChatUser,
  createChatCommunity,
  createChatGroupInvite,
  confirmChatAttachmentDownloaded,
  getEncryptedChatAttachmentDownloadUrl,
  downloadEncryptedAssetResumably,
  deleteChatMessage,
  editChatMessage,
  findChatPersonByPhone,
  findChatPeopleByContactHashes,
  forwardEncryptedChatAttachment,
  getChatCommunities,
  getChatCommunity,
  getChatDeviceKeys,
  getChatEncryptedEnvelopes,
  getChatEncryptedPreviewEnvelopes,
  getChatGroupMembers,
  getChatLinkPreview,
  getChatConversations,
  getChatConversationsPage,
  getChatMessages,
  getCommunityGuestInbox,
  getAuthenticatedAssetDataUrl,
  getAuthenticatedImagePreviewUri,
  joinChatCommunity,
  joinChatGroupInvite,
  lookupAccommodationLocation,
  previewChatGroupInvite,
  leaveChatGroup,
  muteChatConversation,
  openChatForRide,
  openChatForPost,
  openCommunityChat,
  openChatWithPerson,
  openIssuesAndSuggestionsChat,
  pollChatEvents,
  pendingEncryptedChatUploadSummary,
  reportChatMessage,
  resumePendingEncryptedChatUploads,
  registerChatDeviceKey,
  reactToChatMessage,
  removeChatGroupMember,
  sendEncryptedChatMessage,
  sendDirectEncryptedChatAttachment,
  sendChatRichMessage,
  answerCommunityPost,
  transferChatGroupOwnership,
  updateChatGroupDetails,
  updateChatGroupPhoto,
  updateChatGroupMemberRole,
  updateChatTyping,
  voteChatPoll
} from "../api/client";
import type { ChatLinkPreview } from "../api/client";
import { appAssets } from "../assets";
import { DateTimeField, todayLocalIso } from "../components/DateTimeField";
import { theme } from "../theme";
import { shareChitthiGroup } from "../utils/listingShare";
import { BootstrapPayload, ChatConversation, ChatGroupMember, ChatMessage, Community, CommunityPost, HousingPost, RidePost } from "../types";
import { createLightweightChatThumbnail, createLightweightVideoThumbnail, pickChatMedia, pickCompressedImages, takeChatPhoto } from "../utils/imageUpload";
import { pickChatFile } from "../utils/fileUpload";
import { contactDiscoveryHash, contactDiscoveryVariants, decryptAttachmentBase64, decryptEnvelope, DeviceIdentity, encryptAttachmentForDevices, encryptForDevices, getOrCreateDeviceIdentity } from "../utils/chatCrypto";
import { createOutboxClientMessageId, EncryptedOutboxItem, enqueueEncryptedMessage, isRetryableChatNetworkError, readEncryptedOutbox, removeEncryptedOutboxItem, updateEncryptedOutboxItem } from "../utils/chatOutbox";
import { awaitChatIdentityRecovery, chatIdentityRecoveryError, recoveredChatIdentities } from "../utils/chatRecovery";
import { NEARBY_RELAY_ENABLED_FOR_BUILD, useNearbyRelay } from "../providers/NearbyRelayProvider";
import { AdaptiveGlassView } from "../components/AdaptiveGlassView";
import { cleanupPersistentChitthiMedia, copyPersistentChitthiMedia, persistentChitthiMediaExists, persistentChitthiMediaUri, persistentChitthiThumbnailUri, writePersistentChitthiMedia } from "../utils/chitthiMediaStorage";
import { decryptChunkedAttachmentFile, deleteChunkedTemporaryFile, encryptAttachmentFileForDevices, parseChunkedAttachmentDescriptor } from "../utils/chitthiChunkedCrypto";
import { FairFaresCrypto } from "../../modules/fairfares-crypto/src";
import { logDevelopmentPerformance } from "../utils/performanceDiagnostics";

type Props = {
  data: BootstrapPayload | null;
  preferredSuggestionCity?: string;
  pendingPost: HousingPost | null;
  pendingRide: RidePost | null;
  pendingGroupInvite?: string;
  notificationConversationId?: string;
  onRequireLogin: () => void;
  onRequireSignup?: () => void;
  onClearPendingPost?: () => void;
  onClearPendingRide?: () => void;
  onClearPendingGroupInvite?: () => void;
  onClearNotificationConversation?: () => void;
  onThreadModeChange?: (active: boolean) => void;
  onMediaTransferActiveChange?: (active: boolean) => void;
  onUnreadCountChange?: (count: number) => void;
  onCardMessageSent?: (context: { postId?: string; rideId?: string; name?: string; photoUrl?: string; listingTitle?: string }) => void;
};

type MessengerTab = "All" | "Unread" | "Groups" | "Communities" | "Contacts";

const blankGroup = { name: "" };
type PendingChatAttachment = { kind: "IMAGE" | "VIDEO" | "FILE"; uri: string; blob?: Blob; name: string; mimeType: string; size: number; thumbnailBase64?: string; imageWidth?: number; imageHeight?: number; pickerAssetId?: string; ownedCacheFile?: boolean; videoQuality?: "original" | "data-saver" };
type ContactDiscoveryResult = {
  matches: Array<{ id: number; name: string; localName: string; photoUrl: string }>;
  invitations: Array<{ id: string; name: string; phone: string }>;
};
// JavaScript chunk crypto is only a compatibility path. Keeping this ceiling
// conservative prevents iOS from terminating Expo Go or a stale dev client
// under combined picker, thumbnail, crypto and React Native memory pressure.
const JAVASCRIPT_MEDIA_SAFE_BYTES = 6_000_000;
const IS_EXPO_GO = Constants.appOwnership === "expo";
type ThreadMessageItem = {
  kind: "message" | "date";
  key: string;
  message: ChatMessage;
  index: number;
  skipForMediaGroup: boolean;
  mediaGroup: ChatMessage[];
  discoveredUrl: string;
  isMediaMessage: boolean;
  messageRunEnds: boolean;
  replyTarget: ChatMessage | null;
};
const CHAT_MESSAGE_CACHE_LIMIT = 50;
const WEB_CHAT_MESSAGE_CACHE_LIMIT = 20;
const CHAT_MESSAGE_CACHE_MAX_BYTES = 750_000;
// A short, low-volume two-tone cue generated specifically for Chitthi. Keeping
// it embedded avoids a network request at the exact moment a send completes.
const CHITTHI_SENT_SOUND_BASE64 = "UklGRvQCAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YdACAAAAAJQBZAS3BO0AHPsB9832Ffpx/x0GKA1tEfINRAA67XXgyeTg+owWeSaoIIUJwu8A4Zzi1O0N/GkKaBecHloZOgUC6nnX3doN9CgUoifwI/0NyvTM5fnk1u0x+uoGyhKDGjwYowjW8P/dDd1y8AENRyHOIYMQvflU6nnnL+7U+BQE0g6oFp4W6gqC9hnk3t8j7v4GQRshHxYS6v2L7grqz+7h980BcwsbE7AUQwwc+6rpFOPq7BMCrxUZHNoSWQFo8p/sp+9E9wAAnQjnD5gS3gy+/qTufOaU7Cv+ohDdGPASFwTj9Svvq/Dw9pj+QQYPDXQQ5gyFAf/y7enw7C37JwyRFXkSMwb5+KLxzvHY9oT9UASRClkOgQyQA7z2Se3U7f/4QwhQEpMRuweo+/vzCPPw9rb8ugJpCFgMzQv7BN/5ePAb74b39QQxD1oQwQjz/S/2T/Qv9yL8cgGRBnoK5wrhBXP8aPOi8Kb2NgJGDOgOVQnc/zj4nPWP9777bQADBccI4glcBoP+D/ZP8kX2AACZCVINigloARD65/YH+IP7oP+1A0IHzwiCBh0AaPgK9En2Rv4zB6wLbwmgArf7KviS+Gj7Af+iAusFvQdpBlIBcfrB9Z32+/wYBQUKFgmJAyv9YPkr+Wn7iP6/AcAEtAYgBi8CK/xn9yr3EvxJA2kIjAgsBGv+hvrN+X/7MP4IAb8DugW4BcICmv3y+OH3fPvEAeQG3weSBHn/lvtz+qj78/10AOUC1AQ7BRkDxP5b+rD4LfuGAHsFGgfEBFcAkPwa+977y/0AAC0CBQSzBEEDr/+d+435F/uK/zQESQbJBAgBcv2/+yD8tv2l/5QBTQMpBEMDYgC3/Gz6L/vI/hIDcwWrBJEBOf5f/Gr8sP1f/xcBqwKgAykD5gCp/UX7aPs7/hYCoQRxBPQB5/73/Ln8tv0r/7AAIAIeA/wCQgE=";
const CHITTHI_SENT_SOUND_DATA_URI = `data:audio/wav;base64,${CHITTHI_SENT_SOUND_BASE64}`;
let chitthiSentSoundPreparation: Promise<string> | null = null;

function prepareChitthiSentSound() {
  if (Platform.OS === "web" || !FileSystem.cacheDirectory) return Promise.resolve(CHITTHI_SENT_SOUND_DATA_URI);
  if (chitthiSentSoundPreparation) return chitthiSentSoundPreparation;
  const uri = `${FileSystem.cacheDirectory}chitthi-sent-v1.wav`;
  chitthiSentSoundPreparation = FileSystem.getInfoAsync(uri)
    .then(async (info) => {
      if (!info.exists) {
        await FileSystem.writeAsStringAsync(uri, CHITTHI_SENT_SOUND_BASE64, {
          encoding: FileSystem.EncodingType.Base64
        });
      }
      return uri;
    })
    .catch((error) => {
      chitthiSentSoundPreparation = null;
      throw error;
    });
  return chitthiSentSoundPreparation;
}
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
// File assembly/checksum work is cooperatively yielding but still competes for
// the JS runtime and storage bandwidth. One encrypted video at a time keeps
// navigation and chat rendering responsive and avoids duplicate range work.
let encryptedVideoMaterializationQueue: Promise<void> = Promise.resolve();

function enqueueEncryptedVideoMaterialization<Result>(task: () => Promise<Result>) {
  const result = encryptedVideoMaterializationQueue.then(task, task);
  encryptedVideoMaterializationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function releasePendingAttachments(attachments: PendingChatAttachment[]) {
  if (Platform.OS === "web") return;
  attachments.forEach((attachment) => {
    if (attachment.ownedCacheFile && attachment.uri.startsWith(FileSystem.cacheDirectory || "__never__")) {
      void FileSystem.deleteAsync(attachment.uri, { idempotent: true }).catch(() => undefined);
    }
  });
}
const wallpaperChoices = [
  // Keep the original ids so existing per-chat selections migrate to the
  // brighter palette automatically instead of remaining on the old near-black
  // backgrounds after an upgrade.
  { id: "midnight", label: "Sage", color: "#D9E5DD", accent: "#83B69D" },
  { id: "ocean", label: "Ocean mist", color: "#D8E8EB", accent: "#70B3BB" },
  { id: "forest", label: "Forest", color: "#D4E4D7", accent: "#70AD83" },
  { id: "plum", label: "Plum", color: "#E7DDE7", accent: "#B38BAA" },
  { id: "sand", label: "Sand", color: "#EFE5D2", accent: "#C6A66D" },
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

// Active pagination must not use mergeChatMessages: that helper deliberately
// bounds persisted/recent state to CHAT_MESSAGE_CACHE_LIMIT. Applying the same
// limit while prepending history makes a page insert at one edge and evict
// mounted rows from the other edge in a single Fabric commit. Keep the active
// thread stable; the disk writer independently stores only recentChatMessages.
function mergeThreadHistoryMessages(existingMessages: ChatMessage[], incomingMessages: ChatMessage[]) {
  const byId = new Map<number, ChatMessage>();
  existingMessages.forEach((message) => {
    const id = Number(message.id);
    if (Number.isFinite(id)) byId.set(id, message);
  });
  incomingMessages.forEach((message) => {
    const id = Number(message.id);
    if (Number.isFinite(id)) byId.set(id, message);
  });
  return [...byId.values()].sort(
    (left, right) => chatDate(left.createdAt).getTime() - chatDate(right.createdAt).getTime() || Number(left.id) - Number(right.id)
  );
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
    if (stored.length > CHAT_MESSAGE_CACHE_MAX_BYTES) {
      logDevelopmentPerformance("chat-cache-discarded", {
        cacheKb: Math.round(stored.length / 1024),
        reason: "oversized-legacy-cache",
      }, true);
      InteractionManager.runAfterInteractions(() => {
        void Promise.allSettled([
          AsyncStorage.removeItem(chatMessageCacheName(userId, conversationId)),
          AsyncStorage.removeItem(legacyChatMessageCacheName(userId, conversationId)),
        ]);
      });
      return [];
    }
    const startedAt = Date.now();
    const parsed = JSON.parse(stored);
    const messages = Array.isArray(parsed?.messages) ? parsed.messages : Array.isArray(parsed) ? parsed : [];
    const safeMessages = recentChatMessages(messages as ChatMessage[])
      .filter((message) => !(message.id < 0 && message.metadata?.uploading))
      .map(safeCachedChatMessage);
    const durationMs = Date.now() - startedAt;
    if (durationMs >= 100) logDevelopmentPerformance("chat-cache-read", {
      durationMs,
      cacheKb: Math.round(stored.length / 1024),
      messages: safeMessages.length,
    }, durationMs >= 500);
    return safeMessages;
  } catch {
    return [];
  }
}

async function writeCachedChatMessages(userId: number, conversationId: string, messages: ChatMessage[]) {
  if (!userId || !conversationId || !messages.length) return;
  // Upload rows are process-local UI state. Persisting their negative IDs can
  // resurrect a stale duplicate after the server message has already landed,
  // especially when an earlier AsyncStorage write finishes out of order.
  const recent = recentChatMessages(messages)
    .filter((message) => !(message.id < 0 && message.metadata?.uploading))
    .map(safeCachedChatMessage);
  if (!recent.length) return;
  try {
    const serialized = JSON.stringify({
      cachedAt: new Date().toISOString(),
      messages: recent
    });
    if (serialized.length > CHAT_MESSAGE_CACHE_MAX_BYTES) return;
    await AsyncStorage.setItem(chatMessageCacheName(userId, conversationId), serialized);
  } catch {
    // Web localStorage is small; cache failure should not affect chat rendering.
  }
}

function safeCachedChatMessage(message: ChatMessage): ChatMessage {
  const metadata = message.metadata ? { ...message.metadata } : undefined;
  if (metadata) {
    delete metadata.decryptedDataUrl;
    delete metadata.thumbnailDataUrl;
    // The decrypted attachment descriptor contains the media key. Never place
    // it in AsyncStorage; it is reconstructed from the encrypted envelope.
    delete metadata.encryptedKeyPayload;
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

function rememberEncryptedChatImagePreview(key: string, uri: string) {
  encryptedChatImagePreviewCache.delete(key);
  encryptedChatImagePreviewCache.set(key, uri);
  while (encryptedChatImagePreviewCache.size > CHAT_IMAGE_MEMORY_CACHE_LIMIT) {
    const oldestKey = encryptedChatImagePreviewCache.keys().next().value;
    if (!oldestKey) break;
    encryptedChatImagePreviewCache.delete(oldestKey);
  }
}

function stablePreviewHash(value: string) {
  return Array.from(sha256(utf8ToBytes(value)).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    return JSON.parse(keyPayload) as { fileName?: string; mimeType?: string; kind?: "IMAGE" | "VIDEO" | "FILE"; thumbnailBase64?: string; size?: number };
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

function InitialsAvatar({ photoUrl, label, imageStyle, textStyle }: {
  photoUrl?: string;
  label: string;
  imageStyle: React.ComponentProps<typeof Image>["style"];
  textStyle: React.ComponentProps<typeof Text>["style"];
}) {
  const resolvedPhotoUrl = chatPhotoUrl(photoUrl);
  return (
    <UserAvatar
      photoUrl={resolvedPhotoUrl}
      imageStyle={imageStyle}
      fallback={<Text style={textStyle}>{initials(label)}</Text>}
    />
  );
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
  if (!clearText) return "New letter";
  if (clearText.startsWith("FFFORWARD:")) {
    try {
      const forwarded = JSON.parse(clearText.slice(10)) as { text?: unknown };
      const text = typeof forwarded.text === "string" ? forwarded.text.trim() : "";
      return text || "Forwarded message";
    } catch {
      return "Forwarded message";
    }
  }
  if (clearText.startsWith("FFRICH:")) {
    try {
      const rich = JSON.parse(clearText.slice(7)) as { type?: string; metadata?: Record<string, unknown> };
      if (rich.type === "POLL") return `Poll: ${String(rich.metadata?.question || "New poll")}`;
      if (rich.type === "EVENT") return `Event: ${String(rich.metadata?.title || "New event")}`;
      if (rich.type === "CONTACT") return `Contact: ${String(rich.metadata?.name || "Shared contact")}`;
      if (rich.type === "LOCATION") return "Shared a location";
      return "New letter";
    } catch {
      return "New letter";
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
    ? "New letter"
    : encryptedOverviewPreview(conversation.lastMessage) || conversation.rideRoute || conversation.subject || "No messages yet.";
}

function conversationAvatarUrl(conversation: ChatConversation | null | undefined, currentUserId: number, currentUserPhotoUrl = "", currentUserName = "") {
  const isCurrentUser = conversation?.otherUserId === currentUserId
    || (!conversation?.otherUserId && !conversation?.communityId && conversation?.otherName.trim().toLocaleLowerCase() === currentUserName.trim().toLocaleLowerCase());
  if (isCurrentUser) return currentUserPhotoUrl;
  return conversation?.otherPhotoUrl || "";
}

const ConversationListRow = React.memo(function ConversationListRow({ chat, currentUserId, currentUserPhotoUrl, currentUserName, onOpen }: {
  chat: ChatConversation;
  currentUserId: number;
  currentUserPhotoUrl?: string;
  currentUserName?: string;
  onOpen: (conversation: ChatConversation) => void;
}) {
  const isLight = useColorScheme() === "light";
  const preview = safeConversationPreview(chat);
  const unread = chat.unread > 0;
  const conversationKind = chat.communityId || chat.kind === "GROUP" ? "Group letters" : "Direct letters";
  return (
    <TouchableOpacity
      style={[styles.chatRow, isLight && styles.chatRowLight, isLight && unread && styles.chatRowUnreadLight]}
      onPress={() => onOpen(chat)}
      accessibilityLabel={`${chat.otherName || chat.subject}. ${unread ? `${chat.unread} unread. ` : ""}${preview}`}
    >
      {unread ? <View style={styles.unreadAccent} /> : null}
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <InitialsAvatar photoUrl={conversationAvatarUrl(chat, currentUserId, currentUserPhotoUrl, currentUserName)} label={chat.otherName || chat.subject || "Chat"} imageStyle={styles.avatarImage} textStyle={styles.avatarText} />
        </View>
        {chat.otherOnline ? <View style={styles.inboxOnlineDot} /> : null}
      </View>
      <View style={styles.chatCopy}>
        <View style={styles.chatTitleRow}>
          <Text style={[styles.chatName, isLight && styles.chatNameLight, unread && styles.chatNameUnread, isLight && unread && styles.chatNameUnreadLight]} numberOfLines={1}>{chat.otherName || chat.subject}</Text>
          <Text style={[styles.chatTime, unread && styles.chatTimeUnread, isLight && styles.chatTimeLight]}>{relativeTime(chat.lastMessageAt)}</Text>
        </View>
        <View style={styles.chatPreviewRow}>
          <Text style={[styles.chatLast, isLight && styles.chatLastLight, unread && styles.chatLastUnread, isLight && unread && styles.chatLastUnreadLight]} numberOfLines={1}>{preview}</Text>
          {unread ? <Text style={styles.unread}>{chat.unread > 99 ? "99+" : chat.unread}</Text> : null}
        </View>
        <Text style={styles.chatKind}>{conversationKind}{chat.rideRoute ? ` · ${chat.rideRoute}` : ""}</Text>
      </View>
    </TouchableOpacity>
  );
});

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
      if (shouldReply) onReplyRef.current();
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 280, mass: 0.65 }).start();
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
      <View style={styles.websitePreviewImageSlot}>
        {preview?.imageUrl ? <Image source={{ uri: preview.imageUrl }} style={styles.websitePreviewImage} resizeMode="cover" /> : <View style={styles.websitePreviewImagePlaceholder}><Text style={styles.websitePreviewImagePlaceholderText}>↗</Text></View>}
      </View>
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
    void (async () => {
      try {
        const localUri = await loadChatImagePreview(attachmentUrl);
        if (!cancelled) setCachedPreviewUri(localUri);
      } catch {
        // One screen-level retry covers a transient failure that outlasted the
        // downloader's quick retry without leaving the bubble permanently
        // unavailable until the user closes and reopens the conversation.
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (cancelled) return;
        try {
          const localUri = await loadChatImagePreview(attachmentUrl);
          if (!cancelled) setCachedPreviewUri(localUri);
        } catch {
          if (!cancelled) setPreviewFailed(true);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
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

function fittedChatImageSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(286 / width, 380 / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function AdaptiveChatImage({ uri, source, compact = false, onError, imageWidth = 0, imageHeight = 0 }: { uri?: string; source?: { uri: string; headers?: Record<string, string> }; compact?: boolean; onError?: () => void; imageWidth?: number; imageHeight?: number }) {
  const suppliedSize = fittedChatImageSize(imageWidth, imageHeight);
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number } | null>(suppliedSize);
  const imageUri = source?.uri || uri || "";

  useEffect(() => {
    const nextSuppliedSize = fittedChatImageSize(imageWidth, imageHeight);
    if (nextSuppliedSize) {
      setMeasuredSize(nextSuppliedSize);
      return;
    }
    setMeasuredSize(null);
    if (!imageUri) return;
    let cancelled = false;
    const onMeasured = (width: number, height: number) => {
      if (!cancelled) setMeasuredSize(fittedChatImageSize(width, height));
    };
    if (source?.headers) Image.getSizeWithHeaders(imageUri, source.headers, onMeasured, () => undefined);
    else Image.getSize(imageUri, onMeasured, () => undefined);
    return () => { cancelled = true; };
  }, [imageHeight, imageUri, imageWidth]);

  return <Image
    source={source || { uri: imageUri }}
    style={[styles.messageImage, !compact && measuredSize, compact && styles.collageImage]}
    resizeMode={compact ? "cover" : "contain"}
    onError={onError}
  />;
}

function EncryptedChatImage({ message, resolvePreview, compact = false }: { message: ChatMessage; resolvePreview?: (message: ChatMessage) => Promise<string>; compact?: boolean }) {
  const attachmentUrl = message.attachmentUrl;
  const keyPayload = String(message.metadata?.encryptedKeyPayload || "");
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
    setUri("");

    void (async () => {
      try {
        if (Platform.OS !== "web") {
          const localUri = encryptedPreviewLocalUri(attachmentUrl, keyPayload);
          if (!localUri) throw new Error("Photo preview storage is unavailable.");
          const existing = await FileSystem.getInfoAsync(localUri);
          if (existing.exists && Number(existing.size || 0) > 0) {
            rememberEncryptedChatImagePreview(previewCacheKey, localUri);
            if (!cancelled) setUri(localUri);
            return;
          }
        } else {
          setUri("");
        }

        let previewUri = "";
        if (Platform.OS !== "web") {
          // Never download and decrypt the full attachment just to populate a
          // bubble. Several visible legacy photos could otherwise materialize
          // concurrently and cause iOS memory-pressure termination. New media
          // carries a tiny encrypted thumbnail; legacy media remains tap-only
          // until the user explicitly opens it.
          throw new Error("This legacy photo has no embedded thumbnail. Tap to open it.");
        } else {
          const encryptedDataUrl = await getAuthenticatedAssetDataUrl(attachmentUrl);
          const decrypted = decryptAttachmentBase64(encryptedDataUrl.split(",", 2)[1] || "", keyPayload);
          previewUri = `data:${decrypted.mimeType};base64,${decrypted.base64}`;
          if (Platform.OS !== "web") {
            previewUri = encryptedPreviewLocalUri(attachmentUrl, keyPayload);
            if (!previewUri) throw new Error("Photo preview storage is unavailable.");
            const existing = await FileSystem.getInfoAsync(previewUri);
            if (!existing.exists || Number(existing.size || 0) === 0) {
              await FileSystem.writeAsStringAsync(previewUri, decrypted.base64, { encoding: FileSystem.EncodingType.Base64 });
            }
          }
        }
        rememberEncryptedChatImagePreview(previewCacheKey, previewUri);
        if (!cancelled) setUri(previewUri);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // Legacy encrypted photos predate embedded thumbnails. Their tap-only
        // placeholder is intentional and must not look like a crypto failure
        // in development logs. Preserve warnings for genuine download,
        // checksum, authorization, descriptor, and decryption failures.
        if (__DEV__ && !reason.startsWith("This legacy photo has no embedded thumbnail.")) {
          console.warn("Chitthi encrypted photo preview failed", { messageId: message.id, reason });
        }
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [attachmentUrl, keyPayload, message.id, previewCacheKey]);
  // Keep this placeholder non-interactive so the enclosing media Pressable
  // owns tap and long-press on Android. Nested touch responders prevented the
  // message action sheet from opening when a preview had failed.
  if (failed) return <View pointerEvents="none" style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Tap to open photo</Text></View>;
  if (!uri) return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Decrypting photo…</Text></View>;
  return <AdaptiveChatImage uri={uri} compact={compact} imageWidth={message.metadata?.imageWidth} imageHeight={message.metadata?.imageHeight} />;
}

function PendingPhotoPreview({ uri, compact = false, full = false }: { uri: string; compact?: boolean; full?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <View style={[styles.pendingAttachmentImage, compact && styles.pendingCollageImage, full && styles.pendingFullPreviewImage, styles.pendingPreviewFallback]}><Text style={styles.pendingPreviewFallbackText}>No preview</Text></View>;
  return <Image source={{ uri }} style={[styles.pendingAttachmentImage, compact && styles.pendingCollageImage, full && styles.pendingFullPreviewImage]} resizeMode={full ? "contain" : "cover"} onError={() => setFailed(true)} />;
}

function ChatMessagePhoto({ message, resolvePreview, compact = false }: { message: ChatMessage; resolvePreview?: (message: ChatMessage) => Promise<string>; compact?: boolean }) {
  // The encrypted envelope carries a privacy-safe thumbnail independently of
  // the full cloud attachment. Keep rendering that thumbnail after the source
  // file expires or becomes unavailable instead of replacing a valid preview
  // with the generic "Photo" card.
  if (message.metadata?.decryptedDataUrl) {
    return <AdaptiveChatImage uri={message.metadata.decryptedDataUrl} compact={compact} imageWidth={message.metadata.imageWidth} imageHeight={message.metadata.imageHeight} />;
  }
  if (message.metadata?.thumbnailDataUrl) {
    return <AdaptiveChatImage uri={message.metadata.thumbnailDataUrl} compact={compact} imageWidth={message.metadata.imageWidth} imageHeight={message.metadata.imageHeight} />;
  }
  if (message.metadata?.mediaExpired || !message.attachmentUrl) {
    return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Media expired</Text></View>;
  }
  if (message.metadata?.encryptedKeyPayload) {
    return <EncryptedChatImage message={message} resolvePreview={resolvePreview} compact={compact} />;
  }
  // Disk-cached E2EE messages deliberately omit the decrypted descriptor and
  // thumbnail because both can contain sensitive material. On first open,
  // wait for the freshly fetched device envelope instead of passing encrypted
  // ciphertext to the ordinary image-preview endpoint and flashing a false
  // "preview unavailable" error.
  if (message.metadata?.encrypted) {
    return <View pointerEvents="none" style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><ActivityIndicator size="small" color="#D6A95F" /></View>;
  }
  return <AuthenticatedChatImage attachmentUrl={message.attachmentUrl} compact={compact} />;
}

function replyMediaKind(message: ChatMessage | null) {
  if (!message) return "";
  if (message.type === "IMAGE") return "Photo";
  if (message.type === "VIDEO") return "Video";
  if (message.type === "FILE") return String(message.metadata?.fileName || "File");
  return "";
}

function ReplyMediaPreview({ message }: { message: ChatMessage }) {
  const previewUri = typeof message.metadata?.thumbnailDataUrl === "string"
    ? message.metadata.thumbnailDataUrl
    : message.type === "IMAGE" && typeof message.metadata?.decryptedDataUrl === "string" ? message.metadata.decryptedDataUrl : "";
  if (previewUri) return <Image source={{ uri: previewUri }} style={styles.replyMediaThumbnail} resizeMode="cover" />;
  const icon = message.type === "IMAGE" ? "▣" : message.type === "VIDEO" ? "▶" : "▤";
  return <View style={styles.replyMediaFallback}><Text style={styles.replyMediaFallbackText}>{icon}</Text></View>;
}

function QuotedReply({ target, mine }: { target: ChatMessage | null; mine: boolean }) {
  const mediaLabel = replyMediaKind(target);
  const quotedText = target ? (shareableMessageText({ ...target, senderName: "" }) || "Message") : "Message unavailable";
  return (
    <View style={[styles.quotedReply, mine ? styles.myQuotedReply : styles.theirQuotedReply]}>
      <View style={styles.quotedReplyCopy}>
        <Text style={styles.quotedReplyName}>{target ? (target.mine ? "You" : target.senderName) : "Original message"}</Text>
        <Text style={[styles.quotedReplyText, mine ? styles.myQuotedReplyText : styles.theirQuotedReplyText]} numberOfLines={2}>{mediaLabel || quotedText}</Text>
      </View>
      {target && mediaLabel ? <ReplyMediaPreview message={target} /> : null}
    </View>
  );
}

type PrivateReplyContext = NonNullable<NonNullable<ChatMessage["metadata"]>["privateReply"]>;

function decodePrivateReply(clearText: string): { text: string; context: PrivateReplyContext | null } {
  if (!clearText.startsWith("FFPRIVATE:")) return { text: clearText, context: null };
  try {
    const payload = JSON.parse(clearText.slice(10)) as { text?: unknown; context?: Partial<PrivateReplyContext> };
    const context = payload.context;
    if (!context || typeof context.senderName !== "string" || typeof context.text !== "string") {
      return { text: String(payload.text || ""), context: null };
    }
    return {
      text: String(payload.text || ""),
      context: {
        senderName: context.senderName,
        text: context.text,
        messageType: String(context.messageType || "TEXT"),
        groupName: String(context.groupName || "Group")
      }
    };
  } catch {
    return { text: clearText, context: null };
  }
}

function PrivateReplyCard({ context, mine }: { context: PrivateReplyContext; mine: boolean }) {
  return (
    <View style={[styles.quotedReply, mine ? styles.myQuotedReply : styles.theirQuotedReply]}>
      <View style={styles.quotedReplyCopy}>
        <Text style={styles.quotedReplyName}>{`Private reply · ${context.groupName}`}</Text>
        <Text style={[styles.quotedReplyText, mine ? styles.myQuotedReplyText : styles.theirQuotedReplyText]} numberOfLines={2}>
          {`${context.senderName}: ${context.text}`}
        </Text>
      </View>
    </View>
  );
}

function ChitthiVideoPlayer({ uri }: { uri: string }) {
  const [playbackError, setPlaybackError] = useState("");
  const player = useVideoPlayer({ uri, contentType: "progressive" }, (instance) => {
    instance.loop = false;
    instance.play();
  });
  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status, error }) => {
      if (status === "error") setPlaybackError(error?.message || "This video's codec is not supported on this device.");
      else if (status === "readyToPlay") setPlaybackError("");
    });
    return () => subscription.remove();
  }, [player]);
  if (playbackError) {
    return <View style={[styles.attachmentPreviewVideo, styles.videoPlaybackError]}><Text style={styles.videoPlaybackErrorText}>Video cannot be played</Text><Text style={styles.videoPlaybackErrorDetail}>{playbackError}</Text></View>;
  }
  return <VideoView player={player} style={styles.attachmentPreviewVideo} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} />;
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

const mediaProgressValues = new Map<number, number>();
const mediaProgressListeners = new Map<number, Set<(progress: number) => void>>();

type VideoSendWaiter = {
  signal: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  abort: () => void;
};

let videoSendPipelineBusy = false;
const videoSendPipelineWaiters: VideoSendWaiter[] = [];

function videoSendCancelledError() {
  const error = new Error("Video sending was cancelled.");
  error.name = "AbortError";
  return error;
}

function releaseVideoSendPipeline() {
  while (videoSendPipelineWaiters.length) {
    const waiter = videoSendPipelineWaiters.shift()!;
    waiter.signal.removeEventListener("abort", waiter.abort);
    if (waiter.signal.aborted) {
      waiter.reject(videoSendCancelledError());
      continue;
    }
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      releaseVideoSendPipeline();
    });
    return;
  }
  videoSendPipelineBusy = false;
}

function acquireVideoSendPipeline(signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(videoSendCancelledError());
  return new Promise<() => void>((resolve, reject) => {
    if (!videoSendPipelineBusy) {
      videoSendPipelineBusy = true;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        releaseVideoSendPipeline();
      });
      return;
    }
    const waiter: VideoSendWaiter = {
      signal,
      resolve,
      reject,
      abort: () => {
        const index = videoSendPipelineWaiters.indexOf(waiter);
        if (index >= 0) videoSendPipelineWaiters.splice(index, 1);
        reject(videoSendCancelledError());
      }
    };
    videoSendPipelineWaiters.push(waiter);
    signal.addEventListener("abort", waiter.abort, { once: true });
  });
}

function publishMediaProgress(messageId: number, progress: number | null) {
  if (progress === null) mediaProgressValues.delete(messageId);
  else mediaProgressValues.set(messageId, progress);
  mediaProgressListeners.get(messageId)?.forEach((listener) => listener(progress ?? 0));
}

function useMediaProgress(messageId: number) {
  const [progress, setProgress] = useState(() => mediaProgressValues.get(messageId) || 0);
  useEffect(() => {
    const listeners = mediaProgressListeners.get(messageId) || new Set<(progress: number) => void>();
    listeners.add(setProgress);
    mediaProgressListeners.set(messageId, listeners);
    setProgress(mediaProgressValues.get(messageId) || 0);
    return () => {
      listeners.delete(setProgress);
      if (!listeners.size) mediaProgressListeners.delete(messageId);
    };
  }, [messageId]);
  return progress;
}

function MediaDownloadProgress({ messageId }: { messageId: number }) {
  return <CircularDownloadProgress progress={useMediaProgress(messageId)} />;
}

function MediaUploadCancelProgress({ messageId }: { messageId: number }) {
  const progress = useMediaProgress(messageId);
  const segments = 24;
  const activeSegments = Math.round(Math.max(0, Math.min(1, progress)) * segments);
  return (
    <View style={styles.downloadProgressCircle}>
      {Array.from({ length: segments }, (_, index) => (
        <View key={index} style={[styles.downloadProgressSegment, index < activeSegments && styles.uploadProgressSegmentActive, { transform: [{ rotate: `${index * (360 / segments)}deg` }, { translateY: -25 }] }]} />
      ))}
      <View style={styles.videoUploadCancelCircle}>
        <Text style={styles.videoUploadCancelText}>×</Text>
        <Text style={styles.videoUploadPercentText}>{Math.round(progress * 100)}%</Text>
      </View>
    </View>
  );
}

function NativeKeyboardTrackingBody({ bottomSafeArea, children }: { bottomSafeArea: number; children: React.ReactNode }) {
  // Keyboard Controller publishes native keyboard frame/progress events to
  // Reanimated shared values. This keeps interactive dismissal and opening on
  // the UI thread and preloads iOS's keyboard through the root provider.
  const keyboard = useReanimatedKeyboardAnimation();
  const keyboardSafeArea = Platform.OS === "ios" ? bottomSafeArea : 0;
  const animatedStyle = useAnimatedStyle(() => ({
    // Controller height is already negative while opening. Interpolate the
    // home-indicator compensation with native progress so there is no final
    // safe-area step at either end of an interactive transition.
    transform: [{ translateY: Math.min(0, keyboard.height.value + keyboard.progress.value * keyboardSafeArea) }]
  }), [keyboardSafeArea]);

  return <Reanimated.View style={[styles.threadKeyboardBody, animatedStyle]}>{children}</Reanimated.View>;
}

function StaticKeyboardBody({ children }: { bottomSafeArea: number; children: React.ReactNode }) {
  if (Platform.OS === "web") return <View style={styles.threadKeyboardBody}>{children}</View>;
  return (
    <KeyboardAvoidingView
      style={styles.threadKeyboardBody}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

function GuestCommunityLetters({ onRequireSignup }: { onRequireSignup: () => void }) {
  const isLight = useColorScheme() === "light";
  const [threads, setThreads] = useState<CommunityPost[]>([]);
  const [guestId, setGuestId] = useState("Guest");
  const [remaining, setRemaining] = useState(6);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(true);
  const [benefitsOpen, setBenefitsOpen] = useState(false);
  const selected = threads.find((thread) => thread.id === selectedId) || null;

  const loadGuestLetters = async () => {
    setBusy(true);
    try {
      const payload = await getCommunityGuestInbox();
      setThreads(payload.threads || []);
      setGuestId(payload.guestId || "Guest");
      setRemaining(payload.remaining);
    } catch {
      setThreads([]);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void loadGuestLetters(); }, []);

  const sendGuestReply = async () => {
    if (!selected || !draft.trim() || busy) return;
    if (remaining <= 0) { setBenefitsOpen(true); return; }
    const ownRoot = [...(selected.answers || [])].reverse().find((answer) => !answer.parentAnswerId && answer.author.name === guestId);
    if (!ownRoot) return;
    setBusy(true);
    try {
      const result = await answerCommunityPost(selected.id, draft.trim(), ownRoot.id);
      setDraft("");
      if (typeof result.guestRemaining === "number") setRemaining(result.guestRemaining);
      const payload = await getCommunityGuestInbox();
      setThreads(payload.threads || []);
      setRemaining(payload.remaining);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Reply not sent.";
      if (text.toLowerCase().includes("free account") || text.toLowerCase().includes("unlimited")) setBenefitsOpen(true);
      else Alert.alert("Reply not sent", text);
    } finally {
      setBusy(false);
    }
  };

  return <View style={[styles.guestLetters, isLight && styles.guestLettersLight]}>
    <View style={styles.guestLettersHead}><View><Text style={[styles.guestLettersTitle, isLight && styles.guestLettersTitleLight]}>Your community replies</Text><Text style={styles.guestLettersSubtitle}>Replies to comments you made as {guestId}</Text></View><Text style={styles.guestLettersCount}>{remaining}/6 left</Text></View>
    {busy && !threads.length ? <ActivityIndicator color={theme.colors.brand} /> : null}
    {!busy && !threads.length ? <View style={styles.guestLettersEmpty}><Text style={[styles.guestLettersEmptyTitle, isLight && styles.guestLettersTitleLight]}>No replies yet</Text><Text style={styles.guestLettersSubtitle}>When someone replies to your Ask comment, it will appear here.</Text></View> : null}
    {threads.map((thread) => {
      const latest = (thread.answers || []).slice(-1)[0];
      return <TouchableOpacity key={thread.id} style={[styles.guestLetterRow, isLight && styles.guestLetterRowLight]} onPress={() => setSelectedId((current) => current === thread.id ? "" : thread.id)}>
        <View style={styles.guestLetterIcon}><Text>💬</Text></View><View style={styles.guestLetterCopy}><Text style={[styles.guestLetterName, isLight && styles.guestLettersTitleLight]} numberOfLines={1}>{thread.title}</Text><Text style={styles.guestLetterPreview} numberOfLines={2}>{latest ? `${latest.author.name}: ${latest.body}` : "Open conversation"}</Text></View><Text style={styles.guestLetterArrow}>{selectedId === thread.id ? "⌃" : "›"}</Text>
      </TouchableOpacity>;
    })}
    {selected ? <View style={[styles.guestThread, isLight && styles.guestLetterRowLight]}>
      {(selected.answers || []).slice(-8).map((answer) => <View key={answer.id} style={[styles.guestThreadBubble, answer.author.name === guestId && styles.guestThreadBubbleMine]}><Text style={styles.guestThreadAuthor}>{answer.author.name === guestId ? "You" : answer.author.name}</Text><Text style={[styles.guestThreadBody, isLight && answer.author.name !== guestId && styles.guestLettersTitleLight]}>{answer.body}</Text></View>)}
      <TextInput style={[styles.guestReplyInput, isLight && styles.guestReplyInputLight]} value={draft} onChangeText={setDraft} multiline placeholder={remaining > 0 ? "Write a reply…" : "Write your reply, then sign up to send…"} placeholderTextColor={theme.colors.muted} />
      <TouchableOpacity style={[styles.guestReplySend, !draft.trim() && styles.disabledButton]} disabled={!draft.trim() || busy} onPress={() => void sendGuestReply()}><Text style={styles.guestReplySendText}>{busy ? "Sending…" : "Send reply"}</Text></TouchableOpacity>
    </View> : null}
    <Modal visible={benefitsOpen} transparent animationType="fade" onRequestClose={() => setBenefitsOpen(false)}><View style={styles.guestBenefitsBackdrop}><View style={[styles.guestBenefitsCard, isLight && styles.guestBenefitsCardLight]}><TouchableOpacity style={styles.guestBenefitsClose} onPress={() => setBenefitsOpen(false)}><Text style={styles.guestBenefitsCloseText}>×</Text></TouchableOpacity><Text style={styles.guestBenefitsEyebrow}>KEEP YOUR CONVERSATIONS</Text><Text style={[styles.guestBenefitsTitle, isLight && styles.guestLettersTitleLight]}>Create your free FairFares account</Text><Text style={styles.guestBenefitsBody}>Your six guest comments and replies stay with you. Sign up for unlimited Ask conversations, housing and roommate posts, affordable rentals, and shared rides.</Text><TouchableOpacity style={styles.guestBenefitsPrimary} onPress={() => { setBenefitsOpen(false); setTimeout(onRequireSignup, 100); }}><Text style={styles.guestBenefitsPrimaryText}>Create free account</Text></TouchableOpacity><TouchableOpacity onPress={() => setBenefitsOpen(false)}><Text style={styles.guestBenefitsLater}>Not now</Text></TouchableOpacity></View></View></Modal>
  </View>;
}

export function MessengerScreen({ data, preferredSuggestionCity, pendingPost, pendingRide, pendingGroupInvite, notificationConversationId, onRequireLogin, onRequireSignup, onClearPendingPost, onClearPendingRide, onClearPendingGroupInvite, onClearNotificationConversation, onThreadModeChange, onMediaTransferActiveChange, onUnreadCountChange, onCardMessageSent }: Props) {
  const isLight = useColorScheme() === "light";
  const safeAreaInsets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const sentSoundPlayer = useAudioPlayer(null, { updateInterval: 1000 });
  const sentSoundUriRef = useRef("");
  const sentSoundLastPlayedAtRef = useRef(0);
  const chitthiFeatures = data?.features?.chitthi || { maxVideoSizeMb: 100, maxVideoSizeBytes: 100_000_000, enableMultipartUpload: true, cryptoThrottleMs: 0, rolloutCohort: "enabled" as const };
  // A stale development client may expose native encryption but not the newer
  // background multipart and resumable assembly methods. Do not advertise the
  // 100 MB path until the entire iOS long-media stack is linked; otherwise a
  // video can be selected and encrypted only to fail when upload begins.
  const nativeLongMediaAvailable = Platform.OS === "ios"
    ? FairFaresCrypto.available && FairFaresCrypto.multipartStagingAvailable && FairFaresCrypto.nativeFileAssemblyAvailable && FairFaresCrypto.backgroundTaskInspectionAvailable
    : Platform.OS === "android" && FairFaresCrypto.available;
  const effectiveAttachmentLimitBytes = nativeLongMediaAvailable
    ? chitthiFeatures.maxVideoSizeBytes
    : Math.min(JAVASCRIPT_MEDIA_SAFE_BYTES, chitthiFeatures.maxVideoSizeBytes);
  const effectiveAttachmentLimitMb = Math.round(effectiveAttachmentLimitBytes / 1_000_000);
  const ThreadKeyboardBody = Platform.OS === "web" || IS_EXPO_GO ? StaticKeyboardBody : NativeKeyboardTrackingBody;
  const { enabled: nearbyRelayEnabled, status: nearbyRelayStatus, custodyVersion: nearbyCustodyVersion, toggle: toggleNearbyRelay } = useNearbyRelay();
  const signedIn = Boolean(data?.user);
  const currentUserId = Number(data?.user?.id || 0);
  const initialDirectConversation = notificationConversationId
    ? data?.chat.conversations.find((item) => item.id === notificationConversationId) || null
    : null;
  const messagesScrollRef = useRef<FlatList<ThreadMessageItem>>(null);
  const activeConversationIdRef = useRef(notificationConversationId || "");
  const messagesContentHeightRef = useRef(0);
  const messagesViewportHeightRef = useRef(0);
  const messagesScrollOffsetRef = useRef(0);
  const prependScrollAnchorRef = useRef<{ height: number; offset: number } | null>(null);
  const prependScrollSettleRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const latestScrollFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const replyHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyKeyboardFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingOlderMessagesRef = useRef(false);
  const messagesUserDraggingRef = useRef(false);
  const paginationRequestedThisGestureRef = useRef(false);
  const userTouchedThreadRef = useRef(false);
  const shouldAutoScrollToEndRef = useRef(true);
  const lastAutoScrolledMessageKeyRef = useRef("");
  const openingThreadToLatestRef = useRef(false);
  const openingThreadQuietUntilRef = useRef(0);
  const openingThreadSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpToLatestVisibleRef = useRef(false);
  const messagesConversationIdRef = useRef("");
  const outboxFlushRunning = useRef(false);
  const multipartResumeStateRef = useRef({ userId: 0, running: false, lastAttemptAt: 0 });
  const attachmentCryptoAbortRef = useRef<AbortController | null>(null);
  const activeAttachmentSendsRef = useRef(new Map<number, { controller: AbortController; conversationId: string }>());
  const pendingMediaMessagesRef = useRef(new Map<string, ChatMessage[]>());
  const activeMediaTransferCountRef = useRef(0);
  const activeAttachmentSendKeysRef = useRef(new Set<string>());
  const activeTextSendKeysRef = useRef(new Set<string>());
  const nextOptimisticAttachmentIdRef = useRef(-Date.now());
  const deviceRegistration = useRef<{ key: string; registeredAt: number } | null>(null);
  const deviceRegistrationPromise = useRef<Promise<void> | null>(null);
  const messengerRefreshVersion = useRef(0);
  const messengerLoaderVersion = useRef(0);
  const messengerRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const messengerRefreshQueuedOptionsRef = useRef<{ showLoader?: boolean; showError?: boolean } | null>(null);
  const openConversationRef = useRef<(conversation: ChatConversation) => void>(() => undefined);
  const handleOpenConversation = React.useCallback((conversation: ChatConversation) => openConversationRef.current(conversation), []);
  const loadingMoreConversationsRef = useRef(false);
  const loadingMoreConversationsRequestRef = useRef(0);
  const messengerUserIdRef = useRef(currentUserId);
  const messageCache = useRef(new Map<string, ChatMessage[]>());
  const attachmentMaterializationJobs = useRef(new Map<string, {
    promise: Promise<{ uri: string; name: string; mimeType: string }>;
    progressListeners: Set<(progress: number) => void>;
  }>());
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingLastSentAt = useRef(0);
  const typingGeneration = useRef(0);
  const typingStateRef = useRef(false);
  const typingRequestRunningRef = useRef(false);
  const typingQueuedStateRef = useRef<boolean | null>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const locationExpiresAt = useRef(0);
  const locationLastSentAt = useRef(0);
  const [tab, setTab] = useState<MessengerTab>("All");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<ChatConversation[]>(data?.chat.conversations || []);
  const [hasMoreConversations, setHasMoreConversations] = useState((data?.chat.conversations || []).length >= 30);
  const [conversationCursor, setConversationCursor] = useState("");
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [communities, setCommunities] = useState<Community[]>(data?.communities || []);
  const [activeConversationId, setActiveConversationId] = useState(notificationConversationId || "");
  const [hydratedConversationId, setHydratedConversationId] = useState("");
  const [activeSubject, setActiveSubject] = useState(initialDirectConversation?.subject || initialDirectConversation?.otherName || pendingPost?.title || rideContextLabel(pendingRide) || "");
  const [activeConversation, setActiveConversation] = useState<ChatConversation | null>(initialDirectConversation);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [highlightedMessageId, setHighlightedMessageId] = useState(0);
  const [jumpToLatestVisible, setJumpToLatestVisible] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [nextBeforeMessageId, setNextBeforeMessageId] = useState(0);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [typingPeople, setTypingPeople] = useState<Array<{ userId: number; name: string }>>([]);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(Boolean(notificationConversationId));
  const [attachmentSending, setAttachmentSending] = useState(false);
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
  const [localVideoThumbnailUris, setLocalVideoThumbnailUris] = useState<Record<number, string>>({});
  const [downloadingMediaMessageIds, setDownloadingMediaMessageIds] = useState<number[]>([]);
  const downloadingMediaMessageIdsRef = useRef(new Set<number>());
  const [pendingAttachment, setPendingAttachment] = useState<PendingChatAttachment | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingChatAttachment[]>([]);
  const [pendingPhotoPreviewOpen, setPendingPhotoPreviewOpen] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<{ uri: string; name: string; mimeType: string; messageId: number; type: "IMAGE" | "VIDEO"; createdAt: string } | null>(null);
  const [attachmentPreviewGroup, setAttachmentPreviewGroup] = useState<Array<{ uri: string; name: string; mimeType: string; createdAt: string }>>([]);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void prepareChitthiSentSound()
      .then((uri) => {
        if (cancelled) return;
        sentSoundPlayer.replace({ uri });
        sentSoundPlayer.volume = 0.28;
        sentSoundUriRef.current = uri;
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [sentSoundPlayer]);

  function playChitthiSentSound() {
    // Protect against accidental double invocation at the reconciliation
    // boundary while still allowing normal rapid consecutive messages.
    const now = Date.now();
    if (now - sentSoundLastPlayedAtRef.current < 80) return;
    sentSoundLastPlayedAtRef.current = now;
    void prepareChitthiSentSound()
      .then(async (uri) => {
        if (sentSoundUriRef.current !== uri) {
          sentSoundPlayer.replace({ uri });
          sentSoundUriRef.current = uri;
        }
        sentSoundPlayer.pause();
        sentSoundPlayer.volume = 0.28;
        await sentSoundPlayer.seekTo(0).catch(() => undefined);
        sentSoundPlayer.play();
      })
      .catch(() => undefined);
  }

  // Upload bubbles are local, ephemeral UI records (negative IDs). They must
  // never survive an account/chat transition or Fast Refresh after their
  // owning async operation has disappeared.
  useEffect(() => {
    setMessages((current) => current.filter((message) => {
      if (!(message.id < 0 && message.metadata?.uploading)) return true;
      const operation = activeAttachmentSendsRef.current.get(message.id);
      return operation?.conversationId === activeConversationId;
    }));
  }, [currentUserId, activeConversationId]);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [privateReplyContext, setPrivateReplyContext] = useState<PrivateReplyContext | null>(null);
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const [forwardPickerOpen, setForwardPickerOpen] = useState(false);
  const [selectedForwardConversationIds, setSelectedForwardConversationIds] = useState<string[]>([]);
  const [forwardingMessages, setForwardingMessages] = useState(false);
  const [forwardingStatus, setForwardingStatus] = useState("");
  const [wallpaperPanelOpen, setWallpaperPanelOpen] = useState(false);
  const [chatOptionsOpen, setChatOptionsOpen] = useState(false);
  const [groupMembersOpen, setGroupMembersOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState<ChatGroupMember[]>([]);
  const [groupMemberSearch, setGroupMemberSearch] = useState("");
  const [groupDetailsEditing, setGroupDetailsEditing] = useState(false);
  const [groupDetailsSaving, setGroupDetailsSaving] = useState(false);
  const [groupDetailsDraft, setGroupDetailsDraft] = useState({ name: "", description: "", area: "" });
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [identityRecoveryWarning, setIdentityRecoveryWarning] = useState("");
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [encryptionStatusDetail, setEncryptionStatusDetail] = useState("");
  const [wallpaper, setWallpaper] = useState("midnight");
  const [customWallpaper, setCustomWallpaper] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [contactMatches, setContactMatches] = useState<Array<{ id: number; name: string; localName: string; photoUrl: string }>>([]);
  const [inviteContacts, setInviteContacts] = useState<Array<{ id: string; name: string; phone: string }>>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const contactDiscoveryInFlightRef = useRef<Promise<ContactDiscoveryResult> | null>(null);
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
    const rows: ThreadMessageItem[] = [];
    visibleMessages.forEach((message, index) => {
      const mediaGroupId = String(message.metadata?.mediaGroupId || "");
      const mediaGroup = mediaGroupId ? mediaGroups.get(mediaGroupId) || [] : [];
      const showDateDivider = index === 0 || chatDayKey(visibleMessages[index - 1].createdAt) !== chatDayKey(message.createdAt);
      if (showDateDivider) {
        rows.push({
          kind: "date",
          key: `date-${chatDayKey(message.createdAt)}`,
          message,
          index,
          skipForMediaGroup: false,
          mediaGroup: [],
          discoveredUrl: "",
          isMediaMessage: false,
          messageRunEnds: false,
          replyTarget: null
        });
      }
      rows.push({
        kind: "message",
        key: `message-${message.id}`,
        message,
        index,
        skipForMediaGroup: Boolean(mediaGroupId && String(visibleMessages[index - 1]?.metadata?.mediaGroupId || "") === mediaGroupId),
        mediaGroup,
        discoveredUrl: message.text ? firstDiscoveredUrl(message.text) : "",
        isMediaMessage: ["IMAGE", "VIDEO"].includes(message.type) && Boolean(message.attachmentUrl),
        messageRunEnds: mediaGroup.length > 1 || endsMessageRun(visibleMessages, index),
        replyTarget: message.replyToMessageId ? messageById.get(Number(message.replyToMessageId)) || null : null
      });
    });
    return rows.reverse();
  }, [messages, visibleMessages]);
  const activeGroup = useMemo(
    () => communities.find((item) => item.id === activeConversation?.communityId) || null,
    [communities, activeConversation?.communityId]
  );
  const activeGroupPhotoUrl = chatPhotoUrl(activeGroup?.photoUrl || activeConversation?.otherPhotoUrl);
  useEffect(() => {
    setGroupDetailsEditing(false);
  }, [activeConversation?.communityId]);
  const filteredGroupMembers = useMemo(() => {
    const query = groupMemberSearch.trim().toLowerCase();
    const roleRank: Record<ChatGroupMember["role"], number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
    return [...groupMembers]
      .sort((left, right) => Number(right.isCurrentUser) - Number(left.isCurrentUser) || roleRank[left.role] - roleRank[right.role] || left.name.localeCompare(right.name))
      .filter((member) => !query || member.name.toLowerCase().includes(query) || member.role.toLowerCase().includes(query));
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

  function jumpToRepliedMessage(messageId: number) {
    const positionReplyTarget = () => {
      const index = threadMessageItems.findIndex((item) => item.kind === "message" && Number(item.message.id) === Number(messageId));
      if (index < 0) {
        if (hasMoreMessages) void loadOlderMessages(true);
        return;
      }
      shouldAutoScrollToEndRef.current = false;
      // Variable-height bubbles may not be measured yet. An animated request can
      // visibly travel to an estimated offset and then jump when FlatList corrects
      // it. Position immediately and let the highlight provide the navigation cue.
      messagesScrollRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
      requestAnimationFrame(() => setHighlightedMessageId(messageId));
      if (replyHighlightTimerRef.current) clearTimeout(replyHighlightTimerRef.current);
      replyHighlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId((current) => current === messageId ? 0 : current);
        replyHighlightTimerRef.current = null;
      }, 1600);
    };

    if (!Keyboard.isVisible()) {
      positionReplyTarget();
      return;
    }
    let positioned = false;
    const positionAfterKeyboard = () => {
      if (positioned) return;
      positioned = true;
      subscription.remove();
      if (replyKeyboardFallbackTimerRef.current) {
        clearTimeout(replyKeyboardFallbackTimerRef.current);
        replyKeyboardFallbackTimerRef.current = null;
      }
      // Wait one frame after the native keyboard closes so FlatList measures
      // against its restored height before resolving the reply target.
      requestAnimationFrame(positionReplyTarget);
    };
    const subscription = Keyboard.addListener("keyboardDidHide", positionAfterKeyboard);
    Keyboard.dismiss();
    if (replyKeyboardFallbackTimerRef.current) clearTimeout(replyKeyboardFallbackTimerRef.current);
    replyKeyboardFallbackTimerRef.current = setTimeout(positionAfterKeyboard, 500);
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
    if (activeConversationIdRef.current !== conversationId) setHydratedConversationId("");
    activeConversationIdRef.current = conversationId;
    setActiveConversationId(conversationId);
  }

  function replaceThreadMessages(conversationId: string, nextMessages: ChatMessage[]) {
    if (activeConversationIdRef.current && activeConversationIdRef.current !== conversationId) return;
    messagesConversationIdRef.current = conversationId;
    const pending = pendingMediaMessagesRef.current.get(conversationId) || [];
    setMessages(mergeChatMessages(nextMessages, pending));
  }

  function mergeThreadMessages(conversationId: string, incomingMessages: ChatMessage[]) {
    if (activeConversationIdRef.current && activeConversationIdRef.current !== conversationId) return;
    const sameConversation = messagesConversationIdRef.current === conversationId;
    messagesConversationIdRef.current = conversationId;
    setMessages((current) => {
      const baseMessages = sameConversation ? current : [];
      const pending = pendingMediaMessagesRef.current.get(conversationId) || [];
      const merged = mergeChatMessages(mergeChatMessages(baseMessages, incomingMessages), pending);
      messageCache.current.set(conversationId, merged);
      return merged;
    });
  }

  function upsertPendingMediaMessage(conversationId: string, pendingMessage: ChatMessage) {
    const existing = pendingMediaMessagesRef.current.get(conversationId) || [];
    pendingMediaMessagesRef.current.set(conversationId, [
      ...existing.filter((message) => message.id !== pendingMessage.id),
      pendingMessage,
    ]);
  }

  function updatePendingMediaMessage(conversationId: string, messageId: number, update: (message: ChatMessage) => ChatMessage) {
    const existing = pendingMediaMessagesRef.current.get(conversationId) || [];
    pendingMediaMessagesRef.current.set(conversationId, existing.map((message) => message.id === messageId ? update(message) : message));
  }

  function removePendingMediaMessage(conversationId: string, messageId: number) {
    const remaining = (pendingMediaMessagesRef.current.get(conversationId) || []).filter((message) => message.id !== messageId);
    if (remaining.length) pendingMediaMessagesRef.current.set(conversationId, remaining);
    else pendingMediaMessagesRef.current.delete(conversationId);
  }

  function cancelPendingMediaUpload(messageId: number) {
    const operation = activeAttachmentSendsRef.current.get(messageId);
    if (!operation) {
      logDevelopmentPerformance("media-cancel-missing-operation", { messageId }, true);
      return;
    }
    // Cancellation is optimistic just like sending: acknowledge the tap
    // immediately, then let the same AbortSignal unwind preparation, crypto,
    // native URLSession tasks and the server multipart authorization.
    removePendingMediaMessage(operation.conversationId, messageId);
    if (activeConversationIdRef.current === operation.conversationId) {
      setMessages((current) => current.filter((message) => message.id !== messageId));
    }
    publishMediaProgress(messageId, null);
    logDevelopmentPerformance("media-cancel-requested", {
      conversationId: operation.conversationId,
      messageId,
    });
    operation.controller.abort();
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
    if (!__DEV__ || Platform.OS !== "ios" || IS_EXPO_GO || !inThread) return;
    let transitionStartedAt = 0;
    let expectedDurationMs = 0;
    let direction: "open" | "close" = "open";
    const begin = (nextDirection: "open" | "close") => (event: { duration?: number; endCoordinates?: { height?: number } }) => {
      direction = nextDirection;
      transitionStartedAt = Date.now();
      expectedDurationMs = Math.round(Number(event.duration || 0));
      logDevelopmentPerformance("keyboard-transition-start", {
        direction,
        expectedDurationMs,
        targetHeight: Math.round(Number(event.endCoordinates?.height || 0)),
        nativeController: true,
      });
    };
    const complete = () => {
      if (!transitionStartedAt) return;
      const actualDurationMs = Date.now() - transitionStartedAt;
      logDevelopmentPerformance("keyboard-transition-complete", {
        direction,
        expectedDurationMs,
        actualDurationMs,
        driftMs: expectedDurationMs ? actualDurationMs - expectedDurationMs : 0,
      }, expectedDurationMs > 0 && actualDurationMs - expectedDurationMs > 100);
      transitionStartedAt = 0;
    };
    const subscriptions = [
      Keyboard.addListener("keyboardWillShow", begin("open")),
      Keyboard.addListener("keyboardDidShow", complete),
      Keyboard.addListener("keyboardWillHide", begin("close")),
      Keyboard.addListener("keyboardDidHide", complete),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [inThread]);

  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const interactionTask = InteractionManager.runAfterInteractions(() => {
      idleTimer = setTimeout(() => {
        if (!cancelled && AppState.currentState === "active") void resume();
      }, 15_000);
    });
    const resume = async () => {
      const state = multipartResumeStateRef.current;
      const now = Date.now();
      if (state.running || (state.userId === currentUserId && now - state.lastAttemptAt < 5_000)) return;
      state.userId = currentUserId;
      state.running = true;
      state.lastAttemptAt = now;
      try {
        const summary = await pendingEncryptedChatUploadSummary(currentUserId);
        if (cancelled) return;
        logDevelopmentPerformance("multipart-recovery-start", {
          pending: summary.count,
          valid: summary.validCount,
          uploaded: summary.uploadedCount,
          encryptedMb: Number((summary.encryptedBytes / 1_000_000).toFixed(1)),
          nativeStaging: FairFaresCrypto.multipartStagingAvailable,
        }, summary.validCount > 0);
        if (!summary.validCount) return;
        if (Platform.OS === "ios" && !FairFaresCrypto.multipartStagingAvailable) {
          logDevelopmentPerformance("multipart-recovery-deferred", {
            reason: "native-staging-unavailable",
            pending: summary.validCount,
          }, true);
          return;
        }
        const startedAt = Date.now();
        const resumed = await resumePendingEncryptedChatUploads(currentUserId);
        logDevelopmentPerformance("multipart-recovery-complete", {
          durationMs: Date.now() - startedAt,
          finalized: resumed.length,
        }, Date.now() - startedAt >= 5000);
        if (!cancelled && resumed.length) void refreshMessenger({ showLoader: false, showError: false });
      } catch {
        // Offline/background transitions are expected. The encrypted file and
        // durable multipart state remain available for the next foreground.
      } finally {
        state.running = false;
      }
    };
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && !cancelled) {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (!cancelled) void resume();
        }, 15_000);
      }
    });
    return () => {
      cancelled = true;
      interactionTask.cancel();
      if (idleTimer) clearTimeout(idleTimer);
      subscription.remove();
    };
  }, [currentUserId]);

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
    if (!currentUserId || Platform.OS === "web") {
      setLocalVideoThumbnailUris({});
      return;
    }
    let cancelled = false;
    const legacyVideos = recentChatMessages(messages).filter(
      (message) => message.type === "VIDEO" && !message.metadata?.thumbnailDataUrl && message.id > 0
    );
    void Promise.all(legacyVideos.map(async (message) => {
      const uri = persistentChitthiThumbnailUri(currentUserId, message.id);
      return uri && await persistentChitthiMediaExists(uri) ? [message.id, uri] as const : null;
    })).then((entries) => {
      if (!cancelled) setLocalVideoThumbnailUris(Object.fromEntries(entries.filter((entry): entry is readonly [number, string] => Boolean(entry))));
    }).catch(() => {
      if (!cancelled) setLocalVideoThumbnailUris({});
    });
    return () => { cancelled = true; };
  }, [currentUserId, messages]);

  useEffect(() => {
    let cancelled = false;
    const bootstrapConversations = data?.chat.conversations || [];
    const userChanged = messengerUserIdRef.current !== currentUserId;
    if (userChanged) {
      messengerUserIdRef.current = currentUserId;
      messengerRefreshVersion.current += 1;
      messengerLoaderVersion.current += 1;
      loadingMoreConversationsRequestRef.current += 1;
      loadingMoreConversationsRef.current = false;
      setLoadingMoreConversations(false);
      attachmentCryptoAbortRef.current?.abort();
      attachmentCryptoAbortRef.current = null;
      activeAttachmentSendsRef.current.forEach(({ controller }) => controller.abort());
      activeAttachmentSendsRef.current.clear();
      pendingMediaMessagesRef.current.clear();
      activeAttachmentSendKeysRef.current.clear();
      messageCache.current.clear();
      attachmentMaterializationJobs.current.clear();
      downloadingMediaMessageIdsRef.current.clear();
      chatImagePreviewCache.clear();
      chatImagePreviewInflight.clear();
      encryptedChatImagePreviewCache.clear();
      activeConversationIdRef.current = "";
      messagesConversationIdRef.current = "";
      userTouchedThreadRef.current = false;
      shouldAutoScrollToEndRef.current = true;
      setActiveConversationId("");
      setActiveConversation(null);
      setActiveSubject("");
      setMessages([]);
      setDownloadingMediaMessageIds([]);
      setLocalMediaMessageIds([]);
      setLocalVideoThumbnailUris({});
      setAttachmentPreview(null);
      setAttachmentPreviewGroup([]);
      setAttachmentStatus("");
      setAttachmentSending(false);
      setThreadLoading(false);
      setLoading(false);
      setPendingAttachment(null);
      setPendingImages([]);
      setPendingPhotoPreviewOpen(false);
      setSelectedMessageIds([]);
      setActionMessage(null);
      setReplyingTo(null);
      setPrivateReplyContext(null);
      deviceRegistration.current = null;
      deviceRegistrationPromise.current = null;
      setDeviceIdentity(null);
      setEncryptionReady(false);
      setEncryptionStatusDetail("");
      setIdentityRecoveryWarning("");
      setConversations(bootstrapConversations);
      setConversationCursor("");
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
    AsyncStorage.getItem("fairfares.chitthi.recent-emojis").then((stored) => stored || AsyncStorage.getItem("fairfares.fchat.recent-emojis"))
      .then((value) => { if (value) setRecentEmojis(JSON.parse(value).slice(0, 16)); })
      .catch(() => undefined);
    return () => {
      if (openingThreadSettleTimer.current) clearTimeout(openingThreadSettleTimer.current);
      if (replyHighlightTimerRef.current) clearTimeout(replyHighlightTimerRef.current);
      if (replyKeyboardFallbackTimerRef.current) clearTimeout(replyKeyboardFallbackTimerRef.current);
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
        let permission = await Location.getForegroundPermissionsAsync();
        if (permission.canAskAgain && !permission.granted) permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted || !isCurrentRequest()) return;
        const position = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 5000 })
          || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!position || !isCurrentRequest()) return;
        const [address] = await Location.reverseGeocodeAsync(position.coords);
        const locality = String(address?.city || address?.district || address?.subregion || "").trim();
        const region = String(address?.region || address?.isoCountryCode || address?.country || "").trim();
        const localCity = [locality, region].filter(Boolean).join(", ");
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
    if (!currentUserId || !data?.user) return;
    const currentName = data.user.name || "You";
    const currentPhotoUrl = data.user.profilePhotoUrl || "";
    // Messages and group-member rows are intentionally cached for fast thread
    // entry. Patch the signed-in user's already-mounted projections as soon as
    // Profile returns its authoritative payload instead of waiting for the
    // next conversation fetch or app restart.
    setMessages((current) => current.map((message) => Number(message.senderId) === currentUserId
      ? { ...message, senderName: currentName, senderPhotoUrl: currentPhotoUrl }
      : message));
    setGroupMembers((current) => current.map((member) => Number(member.id) === currentUserId
      ? { ...member, name: currentName, photoUrl: currentPhotoUrl }
      : member));
  }, [currentUserId, data?.user?.name, data?.user?.profilePhotoUrl]);

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
        await awaitChatIdentityRecovery(userId);
        const identity = await getOrCreateDeviceIdentity(userId);
        if (cancelled) return;
        setIdentityRecoveryWarning(chatIdentityRecoveryError(userId));
        // Preserve the device key even if the network registration must retry.
        setDeviceIdentity(identity);
        await ensureDeviceRegistration(identity);
        // Read the live ref after registration. Capturing the state value here
        // retained the previous account's thread across logout/login and
        // turned its authorization failure into an identity retry loop.
        const conversationId = activeConversationIdRef.current;
        if (conversationId) {
          try {
            const keyPayload = await getChatDeviceKeys(conversationId);
            if (!cancelled && activeConversationIdRef.current === conversationId) {
              setEncryptionReady(Boolean(keyPayload.ready));
              setEncryptionStatusDetail(keyPayload.ready ? "" : keyPayload.warning || "Encryption key registration is incomplete.");
            }
          } catch (error) {
            // Registration already succeeded. Conversation status is fetched
            // again when a valid thread opens and must not restart recovery.
            if (!cancelled && activeConversationIdRef.current === conversationId) {
              setEncryptionReady(false);
              setEncryptionStatusDetail(error instanceof Error ? error.message : "Conversation encryption status is temporarily unavailable.");
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          setEncryptionReady(false);
          setEncryptionStatusDetail(error instanceof Error ? error.message : "This device could not register its encryption key.");
          retryTimer = setTimeout(() => void initialize(), 3000);
        }
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
    await awaitChatIdentityRecovery(userId);
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
    const encodedText = ownEnvelope ? decryptEnvelope(ownEnvelope, identity) : "Encrypted message waiting to send";
    const decoded = decodePrivateReply(encodedText);
    return {
      id: item.localMessageId,
      senderId: Number(data?.user?.id || 0),
      senderName: data?.user?.name || "You",
      mine: true,
      type: "TEXT",
      text: decoded.text || "Encrypted message waiting to send",
      attachmentUrl: "",
      metadata: { encrypted: true, privateReply: decoded.context || undefined },
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
      // This runs on a short retry timer while Chitthi is mounted. Avoid key
      // registration and its network request when there is nothing to send.
      const items = await readEncryptedOutbox(userId);
      if (!items.length) return;
      const identity = deviceIdentity || await getOrCreateDeviceIdentity(userId);
      await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
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
              const decoded = decodePrivateReply(clearText);
              const sentMessage = { ...response.message, text: decoded.text, canEdit: Boolean(response.message.canEdit && !decoded.context), metadata: { ...response.message.metadata, encrypted: true, privateReply: decoded.context || undefined } };
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
    const identities = recoveredChatIdentities(Number(data?.user?.id || 0), identity);
    // Receiving only depends on this device's envelopes. Send-key readiness is
    // a separate concern and must never prevent valid incoming ciphertext from
    // being decrypted (for example during a brief key-directory outage).
    const [envelopePayloads, keyPayload] = await Promise.all([
      Promise.all(identities.map(async (candidate) => {
        const payload = await getChatEncryptedEnvelopes(conversationId, candidate.deviceId);
        return payload.envelopes.map((envelope) => ({ ...envelope, recipientDeviceId: candidate.deviceId }));
      })),
      getChatDeviceKeys(conversationId).catch(() => ({
        ok: false,
        keys: [],
        ready: false,
        warning: "Encryption keys are temporarily unavailable."
      }))
    ]);
    return { identity, identities, envelopePayload: { ok: true, envelopes: envelopePayloads.flat() }, keyPayload };
  }

  async function decryptMessages(
    conversationId: string,
    nextMessages: ChatMessage[],
    preparedContext?: ReturnType<typeof prepareMessageDecryption>
  ) {
    try {
      const { identity, identities = [identity], envelopePayload, keyPayload } = await (preparedContext || prepareMessageDecryption(conversationId));
      setEncryptionReady(Boolean(keyPayload.ready));
      setEncryptionStatusDetail(keyPayload.ready ? "" : keyPayload.warning || "Encryption key registration is incomplete.");
      const byMessage = new Map<number, typeof envelopePayload.envelopes>();
      envelopePayload.envelopes.forEach((item) => {
        const current = byMessage.get(item.messageId) || [];
        current.push(item);
        byMessage.set(item.messageId, current);
      });
      const decryptedMessages = nextMessages.map((message) => {
        const envelopes = byMessage.get(message.id) || [];
        if (!envelopes.length) {
          if (isEncryptedPlaceholder(message.text)) {
          }
          return isEncryptedPlaceholder(message.text) ? { ...message, text: unavailableEncryptedMessageText, canEdit: false } : message;
        }
        try {
          let clearText = "";
          for (const envelope of envelopes) {
            const candidates = identities.filter((candidate) => !("recipientDeviceId" in envelope) || envelope.recipientDeviceId === candidate.deviceId);
            for (const candidate of candidates.length ? candidates : identities) {
              try {
                clearText = decryptEnvelope(envelope, candidate);
                if (clearText) break;
              } catch {
                // Try the next recovered identity for this historical message.
              }
            }
            if (clearText) break;
          }
          if (!clearText) throw new Error("Envelope authentication failed.");
          if (message.type === "ENCRYPTED_ATTACHMENT" && (message.attachmentUrl || message.metadata?.mediaExpired)) {
            const attachmentInfo = JSON.parse(clearText) as { kind: "IMAGE" | "VIDEO" | "FILE"; caption?: string; fileName?: string; mimeType?: string; thumbnailBase64?: string; imageWidth?: number; imageHeight?: number; mediaGroupId?: string; mediaGroupIndex?: number; mediaGroupCount?: number; forwarded?: boolean };
            return {
              ...message,
              type: attachmentInfo.kind,
              text: attachmentInfo.caption || "",
              metadata: { ...message.metadata, encrypted: true, forwarded: Boolean(attachmentInfo.forwarded), kind: attachmentInfo.kind, fileName: attachmentInfo.fileName, mimeType: attachmentInfo.mimeType, encryptedKeyPayload: clearText, caption: attachmentInfo.caption, thumbnailDataUrl: attachmentInfo.thumbnailBase64 ? `data:image/jpeg;base64,${attachmentInfo.thumbnailBase64}` : undefined, imageWidth: attachmentInfo.imageWidth, imageHeight: attachmentInfo.imageHeight, mediaGroupId: attachmentInfo.mediaGroupId, mediaGroupIndex: attachmentInfo.mediaGroupIndex, mediaGroupCount: attachmentInfo.mediaGroupCount }
            };
          }
          if (clearText.startsWith("FFFORWARD:")) {
            const forwarded = JSON.parse(clearText.slice(10)) as { text?: string };
            return { ...message, text: String(forwarded.text || ""), canEdit: false, metadata: { ...message.metadata, encrypted: true, forwarded: true } };
          }
          if (clearText.startsWith("FFRICH:")) {
            const rich = JSON.parse(clearText.slice(7)) as { type: string; metadata: ChatMessage["metadata"] };
            return { ...message, type: rich.type, text: "", canEdit: false, metadata: { ...rich.metadata, encrypted: true } };
          }
          const privateReply = decodePrivateReply(clearText);
          return { ...message, text: privateReply.text, canEdit: Boolean(message.mine && message.canEdit && !privateReply.context), metadata: { ...message.metadata, encrypted: true, privateReply: privateReply.context || undefined } };
        } catch {
          // A corrupt, expired, or old-device envelope must affect only that
          // message. Previously it rejected Promise.all and exposed encrypted
          // placeholders for every otherwise decryptable message in the page.
          return { ...message, text: unavailableEncryptedMessageText, canEdit: false };
        }
      });
      return decryptedMessages;
    } catch (error) {
      setEncryptionReady(false);
      setEncryptionStatusDetail(error instanceof Error ? error.message : "Encrypted message envelopes could not be retrieved.");
      // Never render the backend's encrypted storage placeholder as if it were
      // message content when envelope retrieval is temporarily unavailable.
      return nextMessages.map((message) => isEncryptedPlaceholder(message.text)
        ? { ...message, text: unavailableEncryptedMessageText, canEdit: false }
        : message);
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

  async function loadOlderMessages(force = false) {
    const conversationId = activeConversationIdRef.current;
    // Native inverted lists emit layout/scroll callbacks while their first
    // snapshot settles. Those are not user pagination intent. Automatic loads
    // require an active drag; explicit button/reply navigation passes force.
    if (!force && (!userTouchedThreadRef.current || !messagesUserDraggingRef.current)) return;
    if (!conversationId || !hasMoreMessages || !nextBeforeMessageId || loadingOlderMessagesRef.current) return;
    loadingOlderMessagesRef.current = true;
    setLoadingOlderMessages(true);
    try {
      const identity = await ensureChatDeviceIdentity();
      const [payload, keyPayload] = await Promise.all([
        getChatMessages(conversationId, nextBeforeMessageId, 30, identity.deviceId),
        getChatDeviceKeys(conversationId).catch(() => ({ ok: false, keys: [], ready: false, warning: "Encryption keys are temporarily unavailable." }))
      ]);
      if (activeConversationIdRef.current !== conversationId) return;
      const currentEnvelopePayload = Array.isArray(payload.envelopes)
        ? { ok: true, envelopes: payload.envelopes }
        : await getChatEncryptedEnvelopes(conversationId, identity.deviceId);
      const identities = recoveredChatIdentities(Number(data?.user?.id || 0), identity);
      const historicalEnvelopes = await Promise.all(identities
        .filter((candidate) => candidate.deviceId !== identity.deviceId)
        .map(async (candidate) => (await getChatEncryptedEnvelopes(conversationId, candidate.deviceId)).envelopes
          .map((envelope) => ({ ...envelope, recipientDeviceId: candidate.deviceId }))));
      const envelopePayload = {
        ok: true,
        envelopes: [
          ...currentEnvelopePayload.envelopes.map((envelope) => ({ ...envelope, recipientDeviceId: identity.deviceId })),
          ...historicalEnvelopes.flat()
        ]
      };
      const olderMessages = await decryptMessages(conversationId, payload.messages || [], Promise.resolve({
        identity,
        identities,
        envelopePayload,
        keyPayload
      }));
      if (activeConversationIdRef.current !== conversationId) return;
      prependScrollAnchorRef.current = null;
      shouldAutoScrollToEndRef.current = false;
      setMessages((current) => {
        // Message IDs are pagination cursors, not presentation clocks.
        // Preserve the full active history and sort migrated rows by their
        // original timestamp; only the independent disk cache is bounded.
        const merged = mergeThreadHistoryMessages(current, olderMessages);
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
    const knownConversation = conversations.find((item) => item.id === notificationConversationId)
      || data?.chat.conversations.find((item) => item.id === notificationConversationId);
    if (knownConversation) {
      setActiveConversation(knownConversation);
      setActiveSubject(knownConversation.subject || knownConversation.otherName || "");
    }
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
        setHydratedConversationId(notificationConversationId);
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
          if (activeConversationIdRef.current !== conversation.id) return;
          setActiveConversation(payload.conversation || conversation);
          const decryptedMessages = await decryptMessages(conversation.id, payload.messages || []);
          if (cancelled || activeConversationIdRef.current !== conversation.id) return;
          prepareThreadForLatestLayout();
          mergeThreadMessages(conversation.id, decryptedMessages);
          setHydratedConversationId(conversation.id);
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
  }, [currentUserId, pendingPost?.id]);

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
          if (activeConversationIdRef.current !== conversation.id) return;
          setActiveConversation(payload.conversation || conversation);
          const decryptedMessages = await decryptMessages(conversation.id, payload.messages || []);
          if (cancelled || activeConversationIdRef.current !== conversation.id) return;
          prepareThreadForLatestLayout();
          mergeThreadMessages(conversation.id, decryptedMessages);
          setHydratedConversationId(conversation.id);
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
  }, [currentUserId, pendingRide?.id]);

  useEffect(() => {
    if (signedIn) {
      refreshMessenger();
    }
  }, [signedIn, currentUserId]);

  useEffect(() => {
    if (!signedIn || !activeConversationId || hydratedConversationId !== activeConversationId) return;
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
          const deletedIds = new Set((payload.deletedMessageIds || []).map((messageId) => Number(messageId)).filter(Boolean));
          setMessages((current) => {
            const activeMessages = deletedIds.size
              ? current.filter((message) => !deletedIds.has(Number(message.id)))
              : current;
            const updated = activeMessages.map((message) => {
              const receipt = receiptById.get(Number(message.id));
              const reactions = reactionsById.get(Number(message.id));
              return { ...message, ...(receipt || {}), ...(reactions ? { reactions } : {}) };
            });
            // Realtime receipts, reactions, and messages must not reapply the
            // bounded disk-cache policy to the open thread. Doing so discarded
            // paginated history on every poll, making the viewport jump back
            // to the oldest row remaining in the recent 50-message window.
            return mergeThreadHistoryMessages(updated, incomingMessages);
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
  }, [signedIn, activeConversationId, hydratedConversationId, activeConversation?.communityId]);

  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    locationSubscription.current?.remove();
  }, []);

  function handleMessageTextChange(value: string) {
    setMessageText(value);
    if (!activeConversationId || editingMessageId) return;
    const conversationId = activeConversationId;
    const publishTyping = (nextTyping: boolean) => {
      if (typingStateRef.current === nextTyping && typingQueuedStateRef.current === null) return;
      typingQueuedStateRef.current = nextTyping;
      if (typingRequestRunningRef.current) return;
      const drain = async () => {
        typingRequestRunningRef.current = true;
        try {
          while (typingQueuedStateRef.current !== null) {
            const queued = typingQueuedStateRef.current;
            typingQueuedStateRef.current = null;
            if (activeConversationIdRef.current !== conversationId) break;
            if (typingStateRef.current === queued) continue;
            await updateChatTyping(conversationId, queued).catch(() => undefined);
            typingStateRef.current = queued;
          }
        } finally {
          typingRequestRunningRef.current = false;
        }
      };
      void drain();
    };
    typingGeneration.current += 1;
    const generation = typingGeneration.current;
    const now = Date.now();
    if (value.trim() && now - typingLastSentAt.current > 1800) {
      typingLastSentAt.current = now;
      publishTyping(true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      if (typingGeneration.current === generation) publishTyping(false);
    }, 2500);
    if (!value.trim()) publishTyping(false);
  }

  useEffect(() => {
    if (!activeConversationId) return;
    let cancelled = false;
    // Never leak the previous conversation's custom wallpaper into a thread
    // that has no saved preference of its own while storage is being read.
    setWallpaper("midnight");
    setCustomWallpaper("");
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

  async function performMessengerRefresh(options: { showLoader?: boolean; showError?: boolean } = {}) {
    if (!signedIn) return;
    const requestedUserId = currentUserId;
    const { showLoader = true, showError = true } = options;
    const refreshVersion = messengerRefreshVersion.current + 1;
    const loaderVersion = showLoader ? messengerLoaderVersion.current + 1 : messengerLoaderVersion.current;
    messengerRefreshVersion.current = refreshVersion;
    if (showLoader) {
      messengerLoaderVersion.current = loaderVersion;
      setLoading(true);
    }
    try {
      const [conversationPage, nextCommunities] = await Promise.all([getChatConversationsPage(), getChatCommunities(suggestionCity || data?.location.city || "")]);
      if (messengerUserIdRef.current !== requestedUserId || messengerRefreshVersion.current !== refreshVersion) return;
      const conversationPayload = conversationPage.conversations;
      const immediateConversations = conversationPayload.map((conversation) => ({
        ...conversation,
        lastMessage: safeConversationPreview(conversation)
      }));
      setConversations(immediateConversations);
      setHasMoreConversations(conversationPage.hasMore);
      setConversationCursor(conversationPage.nextCursor);
      setCommunities(nextCommunities);
      onUnreadCountChange?.(immediateConversations.reduce((total, conversation) => total + Math.max(0, Number(conversation.unread) || 0), 0));
      // Encrypted preview decryption can require one envelope request per thread.
      // Do that after the list is visible so a large inbox never blocks Chitthi opening.
      void decryptConversationPreviews(conversationPayload).then((decrypted) => {
        if (messengerUserIdRef.current !== requestedUserId || messengerRefreshVersion.current !== refreshVersion) return;
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
      if (showError && messengerUserIdRef.current === requestedUserId) Alert.alert("Messenger failed", error instanceof Error ? error.message : "Could not load chats.");
    } finally {
      if (showLoader && messengerUserIdRef.current === requestedUserId && messengerLoaderVersion.current === loaderVersion) setLoading(false);
    }
  }

  function refreshMessenger(options: { showLoader?: boolean; showError?: boolean } = {}): Promise<void> {
    const existing = messengerRefreshPromiseRef.current;
    if (existing) {
      const queued = messengerRefreshQueuedOptionsRef.current;
      messengerRefreshQueuedOptionsRef.current = {
        showLoader: Boolean(queued?.showLoader || options.showLoader !== false),
        showError: Boolean(queued?.showError || options.showError !== false),
      };
      return existing.then(async () => {
        const nextOptions = messengerRefreshQueuedOptionsRef.current;
        messengerRefreshQueuedOptionsRef.current = null;
        if (nextOptions) await refreshMessenger(nextOptions);
      });
    }
    const pending = performMessengerRefresh(options);
    const tracked = pending.finally(() => {
      if (messengerRefreshPromiseRef.current === tracked) messengerRefreshPromiseRef.current = null;
    });
    messengerRefreshPromiseRef.current = tracked;
    return tracked;
  }

  async function loadMoreConversations() {
    // FlatList may call onEndReached more than once before React commits the
    // loading state. The ref is the synchronous single-flight lock; without
    // it, duplicate offset pages can race and waste preview decryption work.
    if (!signedIn || loadingMoreConversationsRef.current || !hasMoreConversations) return;
    loadingMoreConversationsRef.current = true;
    const requestId = loadingMoreConversationsRequestRef.current + 1;
    loadingMoreConversationsRequestRef.current = requestId;
    setLoadingMoreConversations(true);
    const requestedUserId = currentUserId;
    const requestedRefreshVersion = messengerRefreshVersion.current;
    const requestedOffset = conversations.length;
    const requestedCursor = conversationCursor;
    try {
      const conversationPage = await getChatConversationsPage(requestedCursor, requestedOffset);
      const page = conversationPage.conversations;
      if (messengerUserIdRef.current !== requestedUserId || messengerRefreshVersion.current !== requestedRefreshVersion) return;
      const immediatePage = page.map((conversation) => ({
        ...conversation,
        lastMessage: safeConversationPreview(conversation)
      }));
      setConversations((current) => mergeChatConversations(current, immediatePage));
      setHasMoreConversations(conversationPage.hasMore);
      setConversationCursor(conversationPage.nextCursor);
      void decryptConversationPreviews(page).then((decrypted) => {
        if (messengerUserIdRef.current !== requestedUserId || messengerRefreshVersion.current !== requestedRefreshVersion) return;
        const previewById = new Map(decrypted.map((conversation) => [conversation.id, conversation.lastMessage]));
        setConversations((current) => current.map((conversation) => ({
          ...conversation,
          lastMessage: previewById.get(conversation.id) || conversation.lastMessage
        })));
      });
    } catch (error) {
      if (messengerUserIdRef.current === requestedUserId && messengerRefreshVersion.current === requestedRefreshVersion) {
        Alert.alert("Could not load more letters", error instanceof Error ? error.message : "Please try again.");
      }
    } finally {
      if (loadingMoreConversationsRequestRef.current === requestId) {
        loadingMoreConversationsRef.current = false;
        setLoadingMoreConversations(false);
      }
    }
  }

  async function openConversation(conversation: ChatConversation) {
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    const operationUserId = currentUserId;
    onThreadModeChange?.(true);
    userTouchedThreadRef.current = false;
    shouldAutoScrollToEndRef.current = true;
    activateThreadConversation(conversation.id);
    setActiveSubject(conversation.subject);
    setActiveConversation(conversation);
    // Disk-cache hydration and secure identity preparation are independent.
    // Start both at tap time so a cold AsyncStorage read never delays the
    // message/envelope request that unlocks encrypted photo previews.
    const identityPromise = ensureChatDeviceIdentity();
    const cachedMessages = await loadCachedThreadMessages(conversation.id);
    if (messengerUserIdRef.current !== operationUserId || activeConversationIdRef.current !== conversation.id) return;
    showCachedThreadMessages(conversation.id, cachedMessages);
    if (!cachedMessages.length) replaceThreadMessages(conversation.id, []);
    setHasMoreMessages(false);
    setNextBeforeMessageId(0);
    setThreadLoading(!cachedMessages.length);
    try {
      // Fetch only this device's envelopes for the visible page in the same
      // bounded response as its message rows. This avoids downloading the
      // conversation's entire envelope history before thumbnails can render.
      const identity = await identityPromise;
      // Receiving only needs this device's page-scoped envelopes. Destination
      // send-key readiness is useful for the composer but must not hold the
      // first photo preview behind another network round trip.
      const keyPayloadPromise = getChatDeviceKeys(conversation.id)
        .then((keyPayload) => {
          if (messengerUserIdRef.current === operationUserId && activeConversationIdRef.current === conversation.id) {
            setEncryptionReady(Boolean(keyPayload.ready));
            setEncryptionStatusDetail(keyPayload.ready ? "" : keyPayload.warning || "Encryption key registration is incomplete.");
          }
          return keyPayload;
        })
        .catch((error) => {
          if (messengerUserIdRef.current === operationUserId && activeConversationIdRef.current === conversation.id) {
            setEncryptionReady(false);
            setEncryptionStatusDetail(error instanceof Error ? error.message : "Encryption keys are temporarily unavailable.");
          }
          return { ok: false, keys: [], ready: false, warning: "Encryption keys are temporarily unavailable." };
        });
      const payload = await getChatMessages(conversation.id, 0, 20, identity.deviceId);
      if (messengerUserIdRef.current !== operationUserId || activeConversationIdRef.current !== conversation.id) return;
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
      // During rolling deploys an older backend does not include page-scoped
      // envelopes yet. Fall back to the established endpoint instead of
      // replacing correctly decrypted cached messages with "unavailable".
      const currentEnvelopePayload = Array.isArray(payload.envelopes)
        ? { ok: true, envelopes: payload.envelopes }
        : await getChatEncryptedEnvelopes(conversation.id, identity.deviceId);
      const identities = recoveredChatIdentities(Number(data?.user?.id || 0), identity);
      const historicalEnvelopes = await Promise.all(identities
        .filter((candidate) => candidate.deviceId !== identity.deviceId)
        .map(async (candidate) => (await getChatEncryptedEnvelopes(conversation.id, candidate.deviceId)).envelopes
          .map((envelope) => ({ ...envelope, recipientDeviceId: candidate.deviceId }))));
      const envelopePayload = {
        ok: true,
        envelopes: [
          ...currentEnvelopePayload.envelopes.map((envelope) => ({ ...envelope, recipientDeviceId: identity.deviceId })),
          ...historicalEnvelopes.flat()
        ]
      };
      const decryptedMessages = await decryptMessages(conversation.id, payload.messages || [], Promise.resolve({
        identity,
        identities,
        envelopePayload,
        // Decryption is independent of the send-key directory. Its eventual
        // result updates encryptionReady through keyPayloadPromise above.
        keyPayload: { ok: true, keys: [], ready: true, warning: "" }
      }));
      if (messengerUserIdRef.current !== operationUserId || activeConversationIdRef.current !== conversation.id) return;
      void keyPayloadPromise;
      prepareThreadForLatestLayout();
      mergeThreadMessages(conversation.id, decryptedMessages);
      setHydratedConversationId(conversation.id);
      updateMessagePagination(payload);
      const lastMessage = payload.messages[payload.messages.length - 1];
      if (lastMessage) {
        setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, unread: 0 } : item));
        void refreshMessenger({ showLoader: false, showError: false });
      } else {
        void refreshMessenger({ showLoader: false, showError: false });
      }
    } catch (error) {
      if (messengerUserIdRef.current === operationUserId && activeConversationIdRef.current === conversation.id) {
        Alert.alert("Chat failed", error instanceof Error ? error.message : "Could not open this chat.");
      }
    } finally {
      if (messengerUserIdRef.current === operationUserId && activeConversationIdRef.current === conversation.id) setThreadLoading(false);
    }
  }

  openConversationRef.current = openConversation;

  async function sendMessage() {
    const cleanMessage = messageText.trim();
    const startedFromCardContext = Boolean(pendingPost || pendingRide);
    const cardMessageContext = {
      postId: pendingPost?.id,
      rideId: pendingRide?.id,
      name: pendingPost?.posterName || pendingRide?.ownerName,
      photoUrl: pendingPost?.photoUrl,
      listingTitle: pendingPost?.title || pendingRide?.title
    };
    userTouchedThreadRef.current = false;
    shouldAutoScrollToEndRef.current = true;
    if (activeConversationId) void updateChatTyping(activeConversationId, false).catch(() => undefined);
    let queuedOffline = false;
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    const operationUserId = currentUserId;
    const operationConversationId = activeConversationId;
    const ensureSendContext = () => {
      if (!operationUserId || messengerUserIdRef.current !== operationUserId) {
        throw new Error("Attachment sending was cancelled because the account changed.");
      }
    };
    let attachments = pendingImages.length ? pendingImages : pendingAttachment ? [pendingAttachment] : [];
    if (attachments.length) {
      const overRemoteLimit = attachments.find((attachment) => attachment.size > effectiveAttachmentLimitBytes);
      if (overRemoteLimit) {
        Alert.alert("Current upload limit", `${overRemoteLimit.name} exceeds your current ${effectiveAttachmentLimitMb} MB Chitthi upload limit.`);
        return;
      }
      const oversizedFallbackAttachment = !nativeLongMediaAvailable && attachments.find((attachment) => attachment.size > JAVASCRIPT_MEDIA_SAFE_BYTES);
      if (oversizedFallbackAttachment) {
        Alert.alert(
          "Development build required",
          `${oversizedFallbackAttachment.name} requires FairFares native media processing. This runtime has only the memory-limited JavaScript fallback. Install the latest FairFares EAS development or production build for files up to 100 MB.`
        );
        return;
      }
      if (!activeConversationId) {
        Alert.alert("Opening Chitthi", "Wait a moment while FairFares verifies the conversation.");
        return;
      }
      const selectedVideo = attachments.length === 1 && attachments[0].kind === "VIDEO" ? attachments[0] : null;
      const attachmentOperationStartedAt = Date.now();
      if (selectedVideo) logDevelopmentPerformance("media-send-start", {
        kind: "VIDEO",
        sizeMb: Number((selectedVideo.size / 1_000_000).toFixed(1)),
        quality: selectedVideo.videoQuality || "original",
      });
      const shouldPrepareVideo = Boolean(selectedVideo && Platform.OS === "ios" && FairFaresCrypto.videoPreparationAvailable);
      if (selectedVideo && (selectedVideo.videoQuality === "data-saver" || shouldPrepareVideo) &&
          ((!FairFaresCrypto.videoPreparationAvailable && !FairFaresCrypto.videoOptimizationAvailable) || !FileSystem.cacheDirectory)) {
        Alert.alert("Development build required", "Video preparation needs the latest FairFares iOS build. Install the newest build or choose HD in the current build.");
        return;
      }
      const attachmentSendKey = attachments.map((attachment) => `${attachment.kind}:${attachment.uri}`).join("|");
      if (activeAttachmentSendKeysRef.current.has(attachmentSendKey)) return;
      activeAttachmentSendKeysRef.current.add(attachmentSendKey);
      activeMediaTransferCountRef.current += 1;
      if (activeMediaTransferCountRef.current === 1) {
        logDevelopmentPerformance("media-navigation-retention-start", {
          conversationId: operationConversationId,
          kind: attachments[0]?.kind || "unknown",
        });
        onMediaTransferActiveChange?.(true);
      }
      let mediaTransferFinished = false;
      const finishMediaTransfer = () => {
        if (mediaTransferFinished) return;
        mediaTransferFinished = true;
        activeMediaTransferCountRef.current = Math.max(0, activeMediaTransferCountRef.current - 1);
        if (activeMediaTransferCountRef.current === 0) {
          logDevelopmentPerformance("media-navigation-retention-end", {
            conversationId: operationConversationId,
          });
          onMediaTransferActiveChange?.(false);
        }
      };
      // Transfer visual ownership immediately from the composer to the send
      // operation. Keeping this card mounted throughout a long native HD
      // preparation made the selected video appear duplicated once the
      // optimistic bubble committed.
      setPendingAttachment(null);
      setPendingImages([]);
      setAttachmentSending(true);
      const mediaSendAbort = new AbortController();
      attachmentCryptoAbortRef.current = mediaSendAbort;
      const optimisticAttachment = attachments.length === 1 ? attachments[0] : null;
      const optimisticAttachmentId = optimisticAttachment ? nextOptimisticAttachmentIdRef.current-- : 0;
      if (optimisticAttachmentId) activeAttachmentSendsRef.current.set(optimisticAttachmentId, { controller: mediaSendAbort, conversationId: operationConversationId });
      let optimisticThumbnailPromise: Promise<string> | null = null;
      let releaseVideoPipeline: (() => void) | null = null;
      if (optimisticAttachment) {
        const optimisticMessage: ChatMessage = {
          id: optimisticAttachmentId,
          senderId: Number(data?.user?.id || 0),
          senderName: data?.user?.name || "You",
          mine: true,
          type: optimisticAttachment.kind,
          text: cleanMessage,
          attachmentUrl: optimisticAttachment.uri,
          metadata: {
            encrypted: true, uploading: true, kind: optimisticAttachment.kind,
            fileName: optimisticAttachment.name, mimeType: optimisticAttachment.mimeType,
            size: optimisticAttachment.size,
            imageWidth: optimisticAttachment.imageWidth,
            imageHeight: optimisticAttachment.imageHeight,
            decryptedDataUrl: optimisticAttachment.kind === "IMAGE" ? optimisticAttachment.uri : undefined,
            thumbnailDataUrl: optimisticAttachment.thumbnailBase64 ? `data:image/jpeg;base64,${optimisticAttachment.thumbnailBase64}` : undefined,
          },
          createdAt: new Date().toISOString(), deliveredAt: "", readAt: "", editedAt: "", deletedAt: "",
          canEdit: false, status: "pending",
        };
        upsertPendingMediaMessage(operationConversationId, optimisticMessage);
        publishMediaProgress(optimisticAttachmentId, 0);
        messagesConversationIdRef.current = operationConversationId;
        setMessages((current) => [...current.filter((message) => message.id !== optimisticAttachmentId), optimisticMessage]);
        if (optimisticAttachment.kind === "VIDEO" && !optimisticAttachment.thumbnailBase64) {
          optimisticThumbnailPromise = optimisticAttachment.pickerAssetId
            ? FairFaresCrypto.generatePhotoLibraryVideoThumbnail(optimisticAttachment.pickerAssetId).catch(() => createLightweightVideoThumbnail(optimisticAttachment.uri))
            : createLightweightVideoThumbnail(optimisticAttachment.uri);
          void optimisticThumbnailPromise.then((thumbnailBase64) => {
            if (!thumbnailBase64) return;
            updatePendingMediaMessage(operationConversationId, optimisticAttachmentId, (message) => ({
              ...message,
              metadata: { ...message.metadata, thumbnailDataUrl: `data:image/jpeg;base64,${thumbnailBase64}` },
            }));
            setMessages((current) => current.map((message) => message.id === optimisticAttachmentId
              ? { ...message, metadata: { ...message.metadata, thumbnailDataUrl: `data:image/jpeg;base64,${thumbnailBase64}` } }
              : message));
          }).catch(() => undefined);
        }
        setMessageText("");
        scrollThreadToLatest(false);
      }
      if (selectedVideo) {
        try {
          // Keep the UI fully concurrent while bounding expensive native video
          // preparation/encryption/upload to one pipeline. Every selection has
          // its own bubble and AbortController; cancelling one never touches a
          // different queued or active video.
          releaseVideoPipeline = await acquireVideoSendPipeline(mediaSendAbort.signal);
        } catch {
          removePendingMediaMessage(operationConversationId, optimisticAttachmentId);
          if (activeConversationIdRef.current === operationConversationId) {
            setMessages((current) => current.filter((message) => message.id !== optimisticAttachmentId));
          }
          publishMediaProgress(optimisticAttachmentId, null);
          releasePendingAttachments([selectedVideo]);
          setAttachmentSending(false);
          if (attachmentCryptoAbortRef.current === mediaSendAbort) attachmentCryptoAbortRef.current = null;
          activeAttachmentSendsRef.current.delete(optimisticAttachmentId);
          activeAttachmentSendKeysRef.current.delete(attachmentSendKey);
          finishMediaTransfer();
          return;
        }
      }
      if (selectedVideo && (selectedVideo.videoQuality === "data-saver" || shouldPrepareVideo)) {
        setAttachmentStatus("");
        const optimizedUri = `${FileSystem.cacheDirectory}chitthi-prepared/video-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
        try {
          const freeBytes = await FileSystem.getFreeDiskStorageAsync();
          if (Number.isFinite(freeBytes) && freeBytes < selectedVideo.size + 32 * 1024 * 1024) {
            throw new Error("Not enough free storage to optimize this video safely. Choose HD quality or free some space.");
          }
          const preparationStartedAt = Date.now();
          const profile = selectedVideo.videoQuality === "data-saver" ? "data-saver" : "hd";
          const optimized = FairFaresCrypto.videoPreparationAvailable
            ? await FairFaresCrypto.prepareVideo(selectedVideo.uri, optimizedUri, profile, attachmentProgressReporter("Preparing video…", optimisticAttachmentId, 0, 0.35), mediaSendAbort.signal)
            : await FairFaresCrypto.optimizeVideo(selectedVideo.uri, optimizedUri, attachmentProgressReporter("Preparing video…", optimisticAttachmentId, 0, 0.35), mediaSendAbort.signal);
          ensureSendContext();
          logDevelopmentPerformance("media-prepare-complete", {
            durationMs: Date.now() - preparationStartedAt,
            inputMb: Number((selectedVideo.size / 1_000_000).toFixed(1)),
            outputMb: Number((optimized.outputSize / 1_000_000).toFixed(1)),
          });
          if (optimized.outputSize > 0) {
            if (optimized.outputSize > effectiveAttachmentLimitBytes) {
              throw new Error(`The prepared video exceeds your current ${effectiveAttachmentLimitMb} MB Chitthi upload limit.`);
            }
            const preparedThumbnail = await createLightweightVideoThumbnail(optimizedUri).catch(() => "");
            const thumbnailBase64 = preparedThumbnail || selectedVideo.thumbnailBase64 || await optimisticThumbnailPromise?.catch(() => "") || "";
            const preparedVideo: PendingChatAttachment = {
              ...selectedVideo,
              uri: optimizedUri,
              name: selectedVideo.name.replace(/\.[^.]+$/, "") + ".mp4",
              mimeType: optimized.mimeType || "video/mp4",
              size: optimized.outputSize,
              thumbnailBase64,
              ownedCacheFile: true,
              // Keep the existing persisted/UI value for backward-compatible
              // cached drafts; "original" is presented to users as HD.
              videoQuality: profile === "hd" ? "original" : "data-saver"
            };
            releasePendingAttachments([selectedVideo]);
            attachments = [preparedVideo];
            updatePendingMediaMessage(operationConversationId, optimisticAttachmentId, (message) => ({
              ...message,
              attachmentUrl: preparedVideo.uri,
              metadata: { ...message.metadata, fileName: preparedVideo.name, mimeType: preparedVideo.mimeType, size: preparedVideo.size, thumbnailDataUrl: preparedVideo.thumbnailBase64 ? `data:image/jpeg;base64,${preparedVideo.thumbnailBase64}` : message.metadata?.thumbnailDataUrl }
            }));
            setMessages((current) => current.map((message) => message.id === optimisticAttachmentId ? {
              ...message,
              attachmentUrl: preparedVideo.uri,
              metadata: { ...message.metadata, fileName: preparedVideo.name, mimeType: preparedVideo.mimeType, size: preparedVideo.size, thumbnailDataUrl: preparedVideo.thumbnailBase64 ? `data:image/jpeg;base64,${preparedVideo.thumbnailBase64}` : message.metadata?.thumbnailDataUrl }
            } : message));
          } else {
            await FileSystem.deleteAsync(optimizedUri, { idempotent: true }).catch(() => undefined);
            const originalVideo = { ...selectedVideo, videoQuality: "original" as const };
            attachments = [originalVideo];
          }
        } catch (error) {
          await FileSystem.deleteAsync(optimizedUri, { idempotent: true }).catch(() => undefined);
          removePendingMediaMessage(operationConversationId, optimisticAttachmentId);
          setAttachmentStatus("");
          const preparationWasCancelled = mediaSendAbort.signal.aborted || (error instanceof Error && error.name === "AbortError");
          const preparationConversationStillActive = activeConversationIdRef.current === operationConversationId;
          if (preparationConversationStillActive) setMessages((current) => current.filter((message) => message.id !== optimisticAttachmentId));
          publishMediaProgress(optimisticAttachmentId, null);
          if (!preparationWasCancelled && preparationConversationStillActive) {
            setPendingAttachment(selectedVideo);
            Alert.alert("Video preparation failed", error instanceof Error ? error.message : "Could not optimize this video.");
          } else {
            releasePendingAttachments([selectedVideo]);
          }
          setAttachmentSending(false);
          if (attachmentCryptoAbortRef.current === mediaSendAbort) attachmentCryptoAbortRef.current = null;
          activeAttachmentSendsRef.current.delete(optimisticAttachmentId);
          activeAttachmentSendKeysRef.current.delete(attachmentSendKey);
          releaseVideoPipeline?.();
          releaseVideoPipeline = null;
          finishMediaTransfer();
          return;
        }
      }
      setAttachmentStatus(attachments.length > 1 ? `Sending ${attachments.length} photos…` : attachments[0].kind === "IMAGE" ? "Sending photo…" : attachments[0].kind === "VIDEO" ? "" : "Sending file…");
      try {
        await allowBusyUiToPaint();
        ensureSendContext();
        const identity = await ensureChatDeviceIdentity();
        const keyPayload = await getChatDeviceKeys(activeConversationId);
        ensureSendContext();
        if (!keyPayload.ready) throw new Error(keyPayload.warning || "Encryption keys are not ready.");
        setEncryptionReady(true);
        const mediaGroupId = attachments.length > 1 ? `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : "";
        const sentMessages: ChatMessage[] = [];
        for (let index = 0; index < attachments.length; index += 1) {
          const attachment = attachments[index];
          const mediaMetadata = mediaGroupId ? { mediaGroupId, mediaGroupIndex: index, mediaGroupCount: attachments.length } : {};
          // Video previews use a zero-decoding local placeholder. Native frame
          // extraction belongs in a background queue in a custom app build,
          // never in this send-critical JavaScript path.
          const encryptedMediaMetadata = {
            ...mediaMetadata,
            size: attachment.size,
            ...(attachment.kind === "IMAGE" && attachment.imageWidth && attachment.imageHeight ? { imageWidth: attachment.imageWidth, imageHeight: attachment.imageHeight } : {}),
            ...(attachment.thumbnailBase64 ? { thumbnailBase64: attachment.thumbnailBase64 } : {})
          };
          const caption = index === 0 ? cleanMessage : "";
          let fileBase64 = "";
          let encryptedTemporaryUri = "";
          const encryptionStartedAt = Date.now();
          const encrypted = Platform.OS === "web"
            ? (() => undefined)()
            : await encryptAttachmentFileForDevices(
                attachment.uri,
                { fileName: attachment.name, mimeType: attachment.mimeType, caption, kind: attachment.kind, ...encryptedMediaMetadata },
                identity,
                keyPayload.keys,
                attachmentProgressReporter(`Encrypting ${attachment.kind === "VIDEO" ? "video" : attachment.kind === "IMAGE" ? "photo" : "file"}…`, optimisticAttachmentId, selectedVideo && (selectedVideo.videoQuality === "data-saver" || shouldPrepareVideo) ? 0.35 : 0, 0.62),
                cryptoThrottleForSize(attachment.size),
                mediaSendAbort.signal
              );
          if (attachment.kind === "VIDEO") logDevelopmentPerformance("media-encryption-complete", {
            durationMs: Date.now() - encryptionStartedAt,
            sizeMb: Number((attachment.size / 1_000_000).toFixed(1)),
          });
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
          const encryptedPayload = encrypted || encryptAttachmentForDevices(fileBase64, { fileName: attachment.name, mimeType: attachment.mimeType, caption, kind: attachment.kind, ...encryptedMediaMetadata }, identity, keyPayload.keys);
          ensureSendContext();
          encryptedTemporaryUri = "encryptedUri" in encryptedPayload ? String(encryptedPayload.encryptedUri || "") : "";
          let response;
          let encryptedUploadFinalized = false;
          try {
            // Video upload progress is already visible inside the optimistic
            // message bubble. Avoid a second floating status label below the
            // preview; retain it for photos and files that lack that treatment.
            setAttachmentStatus(attachment.kind === "VIDEO" ? "" : `Uploading ${attachment.kind === "IMAGE" ? "photo" : "file"} securely…`);
            const uploadStartedAt = Date.now();
            response = await sendDirectEncryptedChatAttachment(
              operationUserId,
              activeConversationId,
              encryptedPayload,
              attachment.mimeType,
              index + 1 < attachments.length,
              mediaSendAbort.signal,
              (progress) => publishMediaProgress(optimisticAttachmentId, 0.62 + progress * 0.36)
            );
            if (attachment.kind === "VIDEO") logDevelopmentPerformance("media-upload-complete", {
              durationMs: Date.now() - uploadStartedAt,
              totalDurationMs: Date.now() - attachmentOperationStartedAt,
              sizeMb: Number((attachment.size / 1_000_000).toFixed(1)),
            });
            encryptedUploadFinalized = true;
          } finally {
            if (encryptedTemporaryUri && encryptedUploadFinalized) deleteChunkedTemporaryFile(encryptedTemporaryUri);
          }
          ensureSendContext();
          const acceptedMessage: ChatMessage = {
            ...response.message,
            type: attachment.kind,
            text: caption,
            metadata: {
              ...response.message.metadata,
              encrypted: true,
              kind: attachment.kind,
              fileName: attachment.name,
              mimeType: attachment.mimeType,
              decryptedDataUrl: Platform.OS === "web"
                ? `data:${attachment.mimeType};base64,${fileBase64}`
                : attachment.kind === "IMAGE" ? attachment.uri : undefined,
              thumbnailDataUrl: attachment.thumbnailBase64 ? `data:image/jpeg;base64,${attachment.thumbnailBase64}` : undefined,
              imageWidth: attachment.imageWidth,
              imageHeight: attachment.imageHeight,
              ...mediaMetadata
            }
          };
          removePendingMediaMessage(operationConversationId, optimisticAttachmentId);
          // Server acceptance is the reconciliation boundary. Do not keep the
          // optimistic row visible while a potentially 100 MB local cache copy
          // runs; realtime refresh may already have rendered the server row.
          if (activeConversationIdRef.current === operationConversationId) {
            setMessages((current) => mergeThreadHistoryMessages(
              current.filter((item) => item.id !== optimisticAttachmentId),
              [acceptedMessage]
            ));
          }
          if (index === attachments.length - 1) playChitthiSentSound();
          publishMediaProgress(optimisticAttachmentId, null);
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
          sentMessages.push({
            ...acceptedMessage,
            metadata: {
              ...acceptedMessage.metadata,
              decryptedDataUrl: Platform.OS === "web"
                ? `data:${attachment.mimeType};base64,${fileBase64}`
                : attachment.kind === "IMAGE" ? senderLocalUri || attachment.uri : undefined
            }
          });
          setAttachmentStatus(attachments.length > 1 ? `Sending photo ${index + 1} of ${attachments.length}…` : attachment.kind === "IMAGE" ? "Sending photo…" : attachment.kind === "VIDEO" ? "" : "Sending file…");
        }
        if (activeConversationIdRef.current === operationConversationId) {
          setMessages((current) => mergeThreadHistoryMessages(current.filter((item) => item.id !== optimisticAttachmentId), sentMessages));
        }
        publishMediaProgress(optimisticAttachmentId, null);
        scrollThreadToLatest(false);
        const sentKind = attachments[0].kind;
        releasePendingAttachments(attachments);
        setPendingPhotoPreviewOpen(false);
        if (activeConversationIdRef.current === operationConversationId) {
          setAttachmentStatus(attachments.length > 1 ? `${attachments.length} photos sent` : sentKind === "IMAGE" ? "Photo sent" : sentKind === "VIDEO" ? "Video sent" : "File sent");
          setTimeout(() => setAttachmentStatus(""), 1600);
        }
        if (startedFromCardContext) onCardMessageSent?.(cardMessageContext);
        onClearPendingPost?.();
        onClearPendingRide?.();
        void refreshMessenger({ showLoader: false, showError: false });
      } catch (error) {
        const sendWasCancelled = mediaSendAbort.signal.aborted || (error instanceof Error && error.name === "AbortError");
        if (attachments[0]?.kind === "VIDEO") logDevelopmentPerformance("media-send-failed", {
          durationMs: Date.now() - attachmentOperationStartedAt,
          errorType: error instanceof Error ? error.name : "UnknownError",
        }, true);
        const sendContextStillActive = messengerUserIdRef.current === operationUserId && activeConversationIdRef.current === operationConversationId;
        removePendingMediaMessage(operationConversationId, optimisticAttachmentId);
        if (optimisticAttachment && sendContextStillActive) {
          setMessages((current) => current.filter((item) => item.id !== optimisticAttachmentId));
          if (!sendWasCancelled) {
            // Preparation may already have replaced and deleted the picker
            // source. Restore the current durable attachment, not that stale
            // original URI, so Retry can actually read the file.
            setPendingAttachment(attachments[0] || optimisticAttachment);
            setMessageText(cleanMessage);
          }
        }
        publishMediaProgress(optimisticAttachmentId, null);
        if (sendWasCancelled) {
          releasePendingAttachments(attachments);
        } else if (sendContextStillActive) {
          setAttachmentStatus("");
          Alert.alert(attachments[0].kind === "IMAGE" ? "Image failed" : attachments[0].kind === "VIDEO" ? "Video failed" : "File failed", error instanceof Error ? error.message : "Could not send this attachment.");
        }
      } finally {
        if (attachmentCryptoAbortRef.current === mediaSendAbort) attachmentCryptoAbortRef.current = null;
        if (mediaSendAbort.signal.aborted) setAttachmentStatus("");
        if (messengerUserIdRef.current === operationUserId) setAttachmentSending(false);
        activeAttachmentSendsRef.current.delete(optimisticAttachmentId);
        activeAttachmentSendKeysRef.current.delete(attachmentSendKey);
        releaseVideoPipeline?.();
        finishMediaTransfer();
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
    // React state does not disable the button until the next render. A second
    // press in that interval used to create a new clientMessageId and therefore
    // a genuinely separate server message. Group key lookup can make that
    // interval more noticeable, especially while media jobs are active.
    const privateReplySnapshot = privateReplyContext;
    const textSendKey = `${operationUserId}:${operationConversationId}:${editingMessageId || 0}:${replyingTo?.id || 0}:${privateReplySnapshot ? `${privateReplySnapshot.groupName}:${privateReplySnapshot.senderName}:${privateReplySnapshot.text}` : ""}:${cleanMessage}`;
    if (activeTextSendKeysRef.current.has(textSendKey)) return;
    activeTextSendKeysRef.current.add(textSendKey);
    setThreadLoading(true);
    try {
      if (activeConversationId && editingMessageId) {
        const identity = await ensureChatDeviceIdentity();
        const keyPayload = await getEncryptionKeysForSend(activeConversationId);
        ensureSendContext();
        if (!keyPayload.ready) throw new Error(keyPayload.warning || "Encryption keys are not ready.");
        const envelopes = encryptForDevices(cleanMessage, identity, keyPayload.keys);
        const response = await editChatMessage(activeConversationId, editingMessageId, envelopes);
        ensureSendContext();
        setMessages((current) => current.map((item) => (item.id === editingMessageId
          ? { ...response.message, text: cleanMessage, canEdit: response.message.canEdit, metadata: { ...response.message.metadata, encrypted: true } }
          : item)));
        setEditingMessageId(null);
      } else if (activeConversationId) {
        const replySnapshot = replyingTo;
        const replyToMessageId = replySnapshot?.id || 0;
        const encryptedText = privateReplySnapshot
          ? `FFPRIVATE:${JSON.stringify({ text: cleanMessage, context: privateReplySnapshot })}`
          : cleanMessage;
        const localMessageId = -Date.now();
        const clientMessageId = createOutboxClientMessageId("sending");
        const createdAt = new Date().toISOString();
        const optimisticMessage: ChatMessage = {
          id: localMessageId,
          senderId: Number(data?.user?.id || 0),
          senderName: data?.user?.name || "You",
          mine: true,
          type: "TEXT",
          text: cleanMessage,
          attachmentUrl: "",
          metadata: { encrypted: true, privateReply: privateReplySnapshot || undefined },
          createdAt,
          deliveredAt: "",
          readAt: "",
          editedAt: "",
          deletedAt: "",
          canEdit: false,
          status: "pending",
          localClientMessageId: clientMessageId,
          replyToMessageId
        };
        setMessages((current) => [...current, optimisticMessage]);
        setMessageText("");
        setReplyingTo(null);
        setPrivateReplyContext(null);
        scrollThreadToLatest(false);
        let pendingIdentity: DeviceIdentity | null = null;
        let pendingEnvelopes: EncryptedOutboxItem["envelopes"] = [];
        try {
          const identity = await ensureChatDeviceIdentity();
          const keyPayload = await getEncryptionKeysForSend(activeConversationId);
          ensureSendContext();
          if (!keyPayload.ready) throw new Error(keyPayload.warning || "Encryption keys are not ready.");
          setEncryptionReady(true);
          const envelopes = encryptForDevices(encryptedText, identity, keyPayload.keys, cleanMessage);
          pendingIdentity = identity;
          pendingEnvelopes = envelopes;
          const response = await sendEncryptedChatMessage(activeConversationId, envelopes, clientMessageId, false, replyToMessageId, pendingPost?.id || "");
          ensureSendContext();
          const sentMessage: ChatMessage = {
            ...response.message,
            text: cleanMessage,
            canEdit: Boolean(response.message.canEdit && !privateReplySnapshot),
            metadata: { ...response.message.metadata, encrypted: true, privateReply: privateReplySnapshot || undefined }
          };
          setMessages((current) => {
            // A realtime group event can insert the accepted server message
            // before this request resolves. Remove that copy first, then
            // replace the optimistic row identified by clientMessageId.
            const withoutServerDuplicate = current.filter((item) =>
              item.id !== response.message.id || item.localClientMessageId === clientMessageId
            );
            const hasOptimistic = withoutServerDuplicate.some((item) => item.localClientMessageId === clientMessageId);
            return hasOptimistic
              ? withoutServerDuplicate.map((item) => item.localClientMessageId === clientMessageId ? sentMessage : item)
              : mergeThreadHistoryMessages(withoutServerDuplicate, [sentMessage]);
          });
          playChitthiSentSound();
          scrollThreadToLatest(false);
        } catch (error) {
          ensureSendContext();
          if (!isRetryableChatNetworkError(error)) {
            setMessages((current) => current.filter((item) => item.localClientMessageId !== clientMessageId));
            setMessageText(cleanMessage);
            setReplyingTo(replySnapshot);
            setPrivateReplyContext(privateReplySnapshot);
            throw error;
          }
          if (!pendingIdentity || !pendingEnvelopes.length) {
            setMessages((current) => current.filter((item) => item.localClientMessageId !== clientMessageId));
            setMessageText(cleanMessage);
            setReplyingTo(replySnapshot);
            setPrivateReplyContext(privateReplySnapshot);
            throw error;
          }
          const identityForQueue = pendingIdentity;
          const outboxItem: EncryptedOutboxItem = {
            version: 1,
            userId: Number(data?.user?.id || 0),
            conversationId: activeConversationId,
            clientMessageId,
            localMessageId,
            createdAt,
            envelopes: pendingEnvelopes,
            replyToMessageId,
            attempts: 0,
            lastAttemptAt: ""
          };
          await enqueueEncryptedMessage(outboxItem);
          setMessages((current) => current.map((item) => item.localClientMessageId === clientMessageId ? queuedMessage(outboxItem, identityForQueue) : item));
          scrollThreadToLatest(false);
          queuedOffline = true;
        }
        if (startedFromCardContext) onCardMessageSent?.(cardMessageContext);
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
      if (messengerUserIdRef.current === operationUserId && activeConversationIdRef.current === operationConversationId) {
        Alert.alert("Message failed", error instanceof Error ? error.message : "Could not send this message.");
      }
    } finally {
      activeTextSendKeysRef.current.delete(textSendKey);
      if (messengerUserIdRef.current === operationUserId) setThreadLoading(false);
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

  function beginEditingActiveGroupDetails() {
    if (!activeConversation?.communityId) return;
    setGroupDetailsDraft({
      name: activeGroup?.name || activeConversation.otherName || "",
      description: activeGroup?.description || "",
      area: activeGroup?.area || ""
    });
    setGroupDetailsEditing(true);
  }

  async function saveActiveGroupDetails() {
    const communityId = activeConversation?.communityId || "";
    const name = groupDetailsDraft.name.trim();
    if (!communityId || groupDetailsSaving) return;
    if (name.length < 3) {
      Alert.alert("Group name required", "Use at least 3 characters for the group name.");
      return;
    }
    setGroupDetailsSaving(true);
    try {
      const response = await updateChatGroupDetails(
        communityId,
        name,
        groupDetailsDraft.description.trim(),
        groupDetailsDraft.area.trim()
      );
      setCommunities((current) => current.map((item) => item.id === communityId ? response.community : item));
      setActiveConversation((current) => current ? { ...current, otherName: response.community.name } : current);
      setConversations((current) => current.map((item) => item.communityId === communityId
        ? { ...item, otherName: response.community.name }
        : item));
      setGroupDetailsEditing(false);
    } catch (error) {
      Alert.alert("Group details not updated", error instanceof Error ? error.message : "Try again.");
    } finally {
      setGroupDetailsSaving(false);
    }
  }

  async function confirmGroupInvitation(invitation: string) {
    if (invitation.startsWith("community:")) {
      const communityId = invitation.slice("community:".length).trim();
      let community = communities.find((item) => item.id === communityId);
      if (!community) {
        try {
          community = await getChatCommunity(communityId) || undefined;
          if (community) {
            const linkedCommunity = community;
            setCommunities((current) => [linkedCommunity, ...current.filter((item) => item.id !== linkedCommunity.id)]);
          }
        } catch {
          // The normal unavailable message below handles a failed refresh.
        }
      }
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

  async function openContactChat(person: { id: number; name: string }, privateReply: PrivateReplyContext | null = null) {
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
      if (privateReply) {
        setReplyingTo(null);
        setEditingMessageId(null);
        setMessageText("");
        setPrivateReplyContext(privateReply);
      }
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
    setContactPickerMode(mode);
    setAddPeopleCommunityId(communityId);
    setContactPickerOpen(true);
    setContactsLoading(true);
    let activeLookup: Promise<ContactDiscoveryResult> | null = null;
    try {
      if (!contactDiscoveryInFlightRef.current) {
        contactDiscoveryInFlightRef.current = (async (): Promise<ContactDiscoveryResult> => {
          let permission = await Contacts.getPermissionsAsync();
          if (permission.status !== "granted" && permission.canAskAgain) permission = await Contacts.requestPermissionsAsync();
          if (permission.status !== "granted") {
            const error = new Error("CONTACTS_PERMISSION_DENIED");
            error.name = "ContactsPermissionDenied";
            throw error;
          }
          const response = await Contacts.getContactsAsync({
            fields: [Contacts.Fields.PhoneNumbers],
            sort: Contacts.SortTypes.FirstName
          });
          const localNames = new Map<string, string>();
          const deviceContacts: Array<{ id: string; name: string; phone: string; hashes: string[] }> = [];
          response.data.forEach((contact, contactIndex) => {
            const label = contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Your contact";
            const contactHashes = new Set<string>();
            let primaryPhone = "";
            for (const entry of contact.phoneNumbers || []) {
              const phone = String(entry.number || "").trim();
              if (!primaryPhone && phone) primaryPhone = phone;
              contactDiscoveryVariants(phone).forEach((value) => {
                const hash = contactDiscoveryHash(value);
                contactHashes.add(hash);
                localNames.set(hash, label);
              });
            }
            if (primaryPhone && contactHashes.size) {
              deviceContacts.push({ id: String(contact.id || contactIndex), name: label, phone: primaryPhone, hashes: Array.from(contactHashes) });
            }
          });
          const hashes = Array.from(localNames.keys());
          if (!hashes.length) return { matches: [], invitations: [] };
          const peopleById = new Map<number, { id: number; name: string; photoUrl: string; phoneHash: string }>();
          for (let offset = 0; offset < hashes.length; offset += 5000) {
            const found = await findChatPeopleByContactHashes(hashes.slice(offset, offset + 5000));
            found.people.forEach((person) => peopleById.set(person.id, person));
          }
          const people = Array.from(peopleById.values());
          const matchedHashes = new Set(people.map((person) => person.phoneHash));
          return {
            matches: people
              .map((person) => ({ ...person, localName: localNames.get(person.phoneHash) || person.name }))
              .sort((left, right) => left.localName.localeCompare(right.localName)),
            invitations: deviceContacts
              .filter((contact) => !contact.hashes.some((hash) => matchedHashes.has(hash)))
              .sort((left, right) => left.name.localeCompare(right.name))
              .map(({ id, name, phone }) => ({ id, name, phone }))
          };
        })();
      }
      activeLookup = contactDiscoveryInFlightRef.current;
      const result = await activeLookup;
      setContactMatches(result.matches);
      setInviteContacts(result.invitations);
    } catch (error) {
      if (error instanceof Error && error.name === "ContactsPermissionDenied") {
        setContactPickerOpen(false);
        Alert.alert("Contacts permission not enabled", "You can still find a member by entering their full phone number in Chitthi search.");
      } else {
        Alert.alert("Contact search failed", error instanceof Error ? error.message : "Could not check your contacts.");
      }
    } finally {
      if (contactDiscoveryInFlightRef.current === activeLookup) contactDiscoveryInFlightRef.current = null;
      if (!contactDiscoveryInFlightRef.current) setContactsLoading(false);
    }
  }

  async function invitePhoneContact(contact: { name: string; phone: string }) {
    const message = `Join me on FairFares and send private letters with Chitthi: https://apps.apple.com/us/app/fairfares-ltd/id6797162820`;
    const separator = Platform.OS === "ios" ? "&" : "?";
    const smsUrl = `sms:${contact.phone.replace(/[^+\d]/g, "")}${separator}body=${encodeURIComponent(message)}`;
    try {
      if (await Linking.canOpenURL(smsUrl)) {
        await Linking.openURL(smsUrl);
        return;
      }
    } catch {
      // The system share sheet remains a reliable fallback.
    }
    await Share.share({ title: "Invite to FairFares", message });
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

  async function searchGroupsByLocation(value: string) {
    // This explicit search takes precedence over any current-location lookup
    // that may still be resolving in the background.
    const requestId = suggestionRequestId.current + 1;
    suggestionRequestId.current = requestId;
    const isCurrentRequest = () => suggestionRequestId.current === requestId;
    setLoading(true);
    try {
      const lookup = await lookupAccommodationLocation(value);
      if (!isCurrentRequest()) return;
      const resolvedCity = String(lookup?.selectedLocation || value).trim();
      const nextCommunities = await getChatCommunities(resolvedCity);
      if (!isCurrentRequest()) return;
      const hasLocalGroups = nextCommunities.some((community) => {
        const communityCity = String(community.suggestionCity || community.area || "").split(",", 1)[0].trim().toLowerCase();
        return !community.joined && communityCity === resolvedCity.split(",", 1)[0].trim().toLowerCase();
      });
      if (!hasLocalGroups) {
        Alert.alert("Location not found", "Choose a city or area from FairFares location search and try again.");
        return;
      }
      setSuggestionCity(resolvedCity);
      setCommunities(nextCommunities);
      setGroupSuggestionsDismissed(false);
      setTab("Groups");
      setSearch("");
    } catch (error) {
      if (isCurrentRequest()) Alert.alert("Group search", error instanceof Error ? error.message : "Could not find groups near that location.");
    } finally {
      if (isCurrentRequest()) setLoading(false);
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
    if (value.replace(/\D/g, "").length >= 10) {
      void startPhoneChat(value);
      return;
    }
    void searchGroupsByLocation(value);
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
      Alert.alert(
        `Invite to ${community.name}`,
        community.visibility === "PRIVATE" ? "This secure invitation link expires in 7 days." : "Anyone with this link can open the group.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Copy link", onPress: () => void Clipboard.setStringAsync(inviteUrl).then(() => Alert.alert("Link copied", "The group invitation is ready to paste.")) },
          { text: "Share", onPress: () => void shareChitthiGroup(community, inviteUrl) }
        ]
      );
    } catch (error) {
      Alert.alert("Invite unavailable", error instanceof Error ? error.message : "The invitation link could not be created.");
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
      const media = await pickChatMedia(4, 1280, 0.62, 350_000, effectiveAttachmentLimitBytes);
      if (!media.length) return;
      releasePendingAttachments([...pendingImages, ...(pendingAttachment ? [pendingAttachment] : [])]);
      if (media[0].kind === "VIDEO") {
        const selectedVideo = media[0];
        setPendingImages([]);
        setPendingAttachment(selectedVideo);
        // Thumbnail extraction is optional and must never hold the picker open
        // for a large video. Publish it only if this exact selection is still
        // in the composer when native decoding completes.
        const previewThumbnail = selectedVideo.pickerAssetId
          ? FairFaresCrypto.generatePhotoLibraryVideoThumbnail(selectedVideo.pickerAssetId).catch(() => createLightweightVideoThumbnail(selectedVideo.uri))
          : createLightweightVideoThumbnail(selectedVideo.uri);
        void previewThumbnail.then((thumbnailBase64) => {
          if (!thumbnailBase64) return;
          setPendingAttachment((current) => current?.kind === "VIDEO" && current.uri === selectedVideo.uri
            ? { ...current, thumbnailBase64 }
            : current);
        }).catch(() => undefined);
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
      releasePendingAttachments([...pendingImages, ...(pendingAttachment ? [pendingAttachment] : [])]);
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
      const file = await pickChatFile(effectiveAttachmentLimitBytes);
      if (!file) return;
      releasePendingAttachments([...pendingImages, ...(pendingAttachment ? [pendingAttachment] : [])]);
      setPendingImages([]);
      setPendingAttachment({ kind: "FILE", ...file });
    } catch (error) {
      setAttachmentStatus("");
      Alert.alert("File failed", error instanceof Error ? error.message : "Could not send this file.");
    }
  }

  function openRichComposer(type: "POLL" | "EVENT" | "CONTACT") {
    Keyboard.dismiss();
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
    const richPreview = type === "CONTACT" ? "Shared a contact" : type === "LOCATION" ? "Shared a location" : type === "POLL" ? "Shared a poll" : type === "EVENT" ? "Shared an event" : "New Chitthi letter";
    const envelopes = encryptForDevices(`FFRICH:${JSON.stringify({ type, metadata })}`, identity, keyPayload.keys, richPreview);
    const response = await sendEncryptedChatMessage(activeConversationId, envelopes, `${Date.now()}-${Math.random().toString(36).slice(2)}`, silent);
    const message = { ...response.message, type, text: "", canEdit: false, metadata: { ...metadata, encrypted: true } } as ChatMessage;
    setMessages((current) => mergeThreadHistoryMessages(current, [message]));
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
        setMessages((current) => mergeThreadHistoryMessages(current, [response.message]));
      } else {
        await sendEncryptedRichMessage(richComposer, metadata);
      }
      playChitthiSentSound();
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

  function cryptoThrottleForSize(size: number) {
    // Every 256 KB chunk already yields to the event loop. Avoid a fixed sleep
    // unless operations explicitly enable one as a safety override.
    return size <= 12_000_000 ? 0 : chitthiFeatures.cryptoThrottleMs;
  }

  function allowBusyUiToPaint() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  function attachmentProgressReporter(label: string, messageId = 0, phaseStart = 0, phaseEnd = 1) {
    let lastMilestone = -10;
    return (progress: number) => {
      const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
      const milestone = percent === 100 ? 100 : Math.floor(percent / 10) * 10;
      if (milestone <= lastMilestone) return;
      lastMilestone = milestone;
      if (!messageId) setAttachmentStatus(`${label} ${milestone}%`);
      if (messageId) publishMediaProgress(messageId, phaseStart + Math.max(0, Math.min(1, progress)) * (phaseEnd - phaseStart));
    };
  }

  async function materializeAttachmentWorker(message: ChatMessage, onProgress?: (progress: number) => void) {
    const operationUserId = currentUserId;
    if (!operationUserId || messengerUserIdRef.current !== operationUserId) {
      throw new Error("Attachment processing was cancelled because the account changed.");
    }
    let mimeType = message.metadata?.mimeType || "application/octet-stream";
    if (message.type === "IMAGE" && !mimeType.startsWith("image/")) mimeType = "image/jpeg";
    if (message.type === "VIDEO" && !mimeType.startsWith("video/")) mimeType = "video/mp4";
    let fileName = safeAttachmentName(message, mimeType);
    const encryptedKeyPayload = message.metadata?.encryptedKeyPayload;
    const encryptedMetadata = encryptedKeyPayload ? encryptedAttachmentMetadata(encryptedKeyPayload) : {};
    const chunkedDescriptor = encryptedKeyPayload ? parseChunkedAttachmentDescriptor(encryptedKeyPayload) : null;
    const authenticatedPlaintextSize = chunkedDescriptor?.plaintextSize || (Number.isSafeInteger(encryptedMetadata.size) && Number(encryptedMetadata.size) > 0 ? Number(encryptedMetadata.size) : 0);
    if (encryptedMetadata.mimeType) mimeType = encryptedMetadata.mimeType;
    if (encryptedMetadata.fileName) {
      fileName = safeAttachmentName({ ...message, metadata: { ...message.metadata, fileName: encryptedMetadata.fileName } }, mimeType);
    }
    const confirmLocalDownload = async () => {
      // Browser data URLs are memory-only, so they must not trigger permanent
      // cloud deletion. Native receipts are sent only after a durable file exists.
      if (Platform.OS !== "web" && !message.mine && message.id > 0 && messengerUserIdRef.current === operationUserId) {
        const identity = await ensureChatDeviceIdentity();
        await confirmChatAttachmentDownloaded(message.id, identity.deviceId).catch(() => undefined);
      }
    };
    if (Platform.OS !== "web") {
      const localUri = encryptedAttachmentLocalUri(operationUserId, message.id, fileName, mimeType);
      if (localUri) {
        const localInfo = await FileSystem.getInfoAsync(localUri);
        const localSize = localInfo.exists ? Number(localInfo.size || 0) : 0;
        const exactSizeValid = !authenticatedPlaintextSize || localSize === authenticatedPlaintextSize;
        if (localSize > 0 && exactSizeValid) {
          onProgress?.(100);
          await confirmLocalDownload();
          return { uri: localUri, name: fileName, mimeType };
        }
        if (localInfo.exists) await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => undefined);
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
      const localUri = encryptedAttachmentLocalUri(operationUserId, message.id, fileName, mimeType);
      if (!localUri) throw new Error("Attachment storage is unavailable on this device.");
      let encryptedDownloadCompleted = false;
      try {
        const identity = await ensureChatDeviceIdentity();
        const downloadAuthorization = await getEncryptedChatAttachmentDownloadUrl(message.id, identity.deviceId);
        const downloadStartedAt = Date.now();
        if (message.type === "VIDEO") logDevelopmentPerformance("media-download-start", {
          messageId: message.id,
          encryptedMb: Number((downloadAuthorization.encryptedSize / 1_000_000).toFixed(1)),
          nativeCrypto: FairFaresCrypto.available,
          nativeFileAssembly: FairFaresCrypto.nativeFileAssemblyAvailable,
          cryptoFormat: chunkedDescriptor?.format || "legacy-single-payload",
        });
        await downloadEncryptedAssetResumably(
          downloadAuthorization.downloadUrl,
          encryptedUri,
          downloadAuthorization.encryptedSize,
          downloadAuthorization.ciphertextSha256,
          (progress) => onProgress?.(Math.round(progress * 88))
        );
        if (message.type === "VIDEO") logDevelopmentPerformance("media-download-complete", {
          messageId: message.id,
          durationMs: Date.now() - downloadStartedAt,
          encryptedMb: Number((downloadAuthorization.encryptedSize / 1_000_000).toFixed(1)),
        }, Date.now() - downloadStartedAt >= 5000);
        onProgress?.(90);
        if (chunkedDescriptor) {
          mimeType = chunkedDescriptor.mimeType || mimeType;
          fileName = safeAttachmentName({ ...message, metadata: { ...message.metadata, fileName: chunkedDescriptor.fileName } }, mimeType);
          const finalUri = encryptedAttachmentLocalUri(operationUserId, message.id, fileName, mimeType) || localUri;
          const decryptStartedAt = Date.now();
          await decryptChunkedAttachmentFile(encryptedUri, finalUri, encryptedKeyPayload, (progress) => onProgress?.(90 + Math.round(progress * 9)));
          if (message.type === "VIDEO") logDevelopmentPerformance("media-decryption-complete", {
            messageId: message.id,
            durationMs: Date.now() - decryptStartedAt,
            nativeCrypto: FairFaresCrypto.available,
            cryptoFormat: chunkedDescriptor.format,
          }, Date.now() - decryptStartedAt >= 5000);
          await cleanupPersistentChitthiMedia(finalUri).catch(() => undefined);
          if (messengerUserIdRef.current === operationUserId) setLocalMediaMessageIds((current) => current.includes(message.id) ? current : [...current, message.id]);
          await confirmLocalDownload();
          onProgress?.(100);
          encryptedDownloadCompleted = true;
          return { uri: finalUri, name: fileName, mimeType };
        }
        const ciphertextBase64 = await FileSystem.readAsStringAsync(encryptedUri, { encoding: FileSystem.EncodingType.Base64 });
        const decrypted = decryptAttachmentBase64(ciphertextBase64, encryptedKeyPayload);
        onProgress?.(94);
        mimeType = decrypted.mimeType || mimeType;
        fileName = safeAttachmentName({ ...message, metadata: { ...message.metadata, fileName: decrypted.fileName } }, mimeType);
        const finalUri = encryptedAttachmentLocalUri(operationUserId, message.id, fileName, mimeType) || localUri;
        await writePersistentChitthiMedia(finalUri, decrypted.base64);
        onProgress?.(99);
        await cleanupPersistentChitthiMedia(finalUri).catch(() => undefined);
        if (messengerUserIdRef.current === operationUserId) setLocalMediaMessageIds((current) => current.includes(message.id) ? current : [...current, message.id]);
        await confirmLocalDownload();
        onProgress?.(100);
        encryptedDownloadCompleted = true;
        return { uri: finalUri, name: fileName, mimeType };
      } finally {
        // Keep authenticated ciphertext after interruption so the next attempt
        // resumes with a fresh short-lived URL. Delete it only after durable
        // decrypted storage and the device receipt have completed.
        if (encryptedDownloadCompleted) await FileSystem.deleteAsync(encryptedUri, { idempotent: true }).catch(() => undefined);
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
    const localUri = encryptedAttachmentLocalUri(operationUserId, message.id, fileName, mimeType);
    if (!localUri) throw new Error("Attachment storage is unavailable on this device.");
    await writePersistentChitthiMedia(localUri, base64);
    onProgress?.(99);
    await cleanupPersistentChitthiMedia(localUri).catch(() => undefined);
    if (messengerUserIdRef.current === operationUserId) setLocalMediaMessageIds((current) => current.includes(message.id) ? current : [...current, message.id]);
    if (encryptedKeyPayload) await confirmLocalDownload();
    onProgress?.(100);
    return { uri: localUri, name: fileName, mimeType };
  }

  function materializeAttachment(message: ChatMessage, onProgress?: (progress: number) => void) {
    const operationUserId = currentUserId;
    const jobKey = `${operationUserId}:${message.id}:${stablePreviewHash(String(message.metadata?.encryptedKeyPayload || message.attachmentUrl || "local"))}`;
    const existing = attachmentMaterializationJobs.current.get(jobKey);
    if (existing) {
      if (onProgress) existing.progressListeners.add(onProgress);
      return existing.promise.finally(() => {
        if (onProgress) existing.progressListeners.delete(onProgress);
      });
    }
    const progressListeners = new Set<(progress: number) => void>();
    if (onProgress) progressListeners.add(onProgress);
    const reportProgress = (progress: number) => {
      progressListeners.forEach((listener) => listener(progress));
    };
    const promise = materializeAttachmentWorker(message, reportProgress)
      .then(async (attachment) => {
        if (Platform.OS !== "web" && message.type === "VIDEO" && !message.metadata?.thumbnailDataUrl && message.id > 0) {
          const thumbnailUri = persistentChitthiThumbnailUri(operationUserId, message.id);
          if (thumbnailUri && !await persistentChitthiMediaExists(thumbnailUri)) {
            const thumbnailBase64 = await createLightweightVideoThumbnail(attachment.uri).catch(() => "");
            if (thumbnailBase64) await writePersistentChitthiMedia(thumbnailUri, thumbnailBase64);
          }
          if (thumbnailUri && await persistentChitthiMediaExists(thumbnailUri)) {
            if (messengerUserIdRef.current === operationUserId) setLocalVideoThumbnailUris((current) => current[message.id] === thumbnailUri ? current : { ...current, [message.id]: thumbnailUri });
          }
        }
        return attachment;
      })
      .finally(() => {
        const current = attachmentMaterializationJobs.current.get(jobKey);
        if (current?.promise === promise) attachmentMaterializationJobs.current.delete(jobKey);
      });
    attachmentMaterializationJobs.current.set(jobKey, { promise, progressListeners });
    return promise;
  }

  async function resolveEncryptedPhotoPreview(message: ChatMessage) {
    return (await materializeAttachment(message)).uri;
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
    // State updates are asynchronous; the ref closes the same-frame double-tap
    // window that could otherwise enqueue the same encrypted video twice.
    if (downloadingMediaMessageIdsRef.current.has(message.id)) return;
    const operationUserId = currentUserId;
    let resolvedMessage = message;
    const alreadyOnDevice = localMediaMessageIds.includes(message.id);
    try {
      // Disk-cached E2EE rows intentionally exclude the decrypted attachment
      // descriptor because it contains the media key. If an older media row is
      // tapped before its paginated page has been hydrated, recover that one
      // descriptor first. Never pass encrypted ciphertext to AVPlayer as if it
      // were a clear video; malformed input can terminate the native process.
      if (message.attachmentUrl && message.metadata?.encrypted && !message.metadata?.encryptedKeyPayload) {
        if (!activeConversationId) throw new Error("Open the conversation again and retry this attachment.");
        const hydrated = await decryptMessages(activeConversationId, [message]);
        resolvedMessage = hydrated[0] || message;
        if (!resolvedMessage.metadata?.encryptedKeyPayload) {
          throw new Error("This encrypted attachment is not available for this device.");
        }
        setMessages((current) => current.map((item) => item.id === message.id ? resolvedMessage : item));
      }
      if (!alreadyOnDevice && Platform.OS !== "web") {
        downloadingMediaMessageIdsRef.current.add(message.id);
        setDownloadingMediaMessageIds((current) => current.includes(message.id) ? current : [...current, message.id]);
        publishMediaProgress(message.id, 0);
        await allowBusyUiToPaint();
      }
      let lastRenderedProgress = -5;
      let lastProgressRenderAt = 0;
      const materialize = () => materializeAttachment(resolvedMessage, (progress) => {
        if (!alreadyOnDevice && Platform.OS !== "web") {
          const percent = Math.max(0, Math.min(100, Math.round(progress)));
          const milestone = percent === 100 ? 100 : Math.floor(percent / 5) * 5;
          const now = Date.now();
          // File and crypto workers may report every chunk. UI progress is
          // deliberately limited to four updates/second so a single media
          // bubble cannot invalidate the full thread on every native event.
          if (milestone <= lastRenderedProgress || (milestone < 100 && now - lastProgressRenderAt < 250)) return;
          lastRenderedProgress = milestone;
          lastProgressRenderAt = now;
          publishMediaProgress(message.id, milestone);
        }
      });
      const item = resolvedMessage.type === "VIDEO" && !alreadyOnDevice && Platform.OS !== "web"
        ? await enqueueEncryptedVideoMaterialization(materialize)
        : await materialize();
      if (!item || messengerUserIdRef.current !== operationUserId) return;
      if (resolvedMessage.type === "IMAGE" || resolvedMessage.type === "VIDEO") {
        if (resolvedMessage.type === "IMAGE") {
          const keyPayload = String(resolvedMessage.metadata?.encryptedKeyPayload || "");
          if (keyPayload) rememberEncryptedChatImagePreview(encryptedPreviewCacheKey(resolvedMessage.attachmentUrl, keyPayload), item.uri);
          setMessages((current) => current.map((entry) => entry.id === message.id
            ? { ...entry, metadata: { ...entry.metadata, decryptedDataUrl: item.uri } }
            : entry));
        }
        setAttachmentPreview({ ...item, messageId: resolvedMessage.id, type: resolvedMessage.type, createdAt: resolvedMessage.createdAt });
      }
      else await downloadAttachment(item);
    } catch (error) {
      if (messengerUserIdRef.current === operationUserId) Alert.alert("Attachment unavailable", error instanceof Error ? error.message : "Could not open this attachment.");
    } finally {
      downloadingMediaMessageIdsRef.current.delete(message.id);
      setDownloadingMediaMessageIds((current) => current.filter((id) => id !== message.id));
      publishMediaProgress(message.id, null);
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
    setEmojiPickerOpen(false);
    setRichComposer("");
    setAttachmentMenuOpen(willOpen);
  }

  function toggleEmojiPicker() {
    const willOpen = !emojiPickerOpen;
    Keyboard.dismiss();
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
    setPrivateReplyContext(null);
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

  function handleMessageLongPress(message: ChatMessage) {
    if (selectedMessageIds.length) {
      toggleMessageSelection(message);
      return;
    }
    showMessageActions(message);
  }

  function beginMessageSelection(message: ChatMessage) {
    const key = messageSelectionKey(message);
    setSelectedMessageIds((current) => current.includes(key) ? current : [...current, key]);
    setActionMessage(null);
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

  function forwardActionMessage(message: ChatMessage) {
    // Open directly instead of waiting for React state and then reading a
    // stale selectedMessageIds closure. That race made long-press Forward
    // occasionally do nothing, especially for media messages.
    setActionMessage(null);
    setSelectedMessageIds([messageSelectionKey(message)]);
    setSelectedForwardConversationIds([]);
    setForwardPickerOpen(true);
  }

  async function replyToGroupMessagePrivately(message: ChatMessage) {
    const senderId = Number(message.senderId || 0);
    if (!activeConversation?.communityId || message.mine || !senderId || senderId === currentUserId) return;
    const senderName = message.senderName?.trim() || "FairFares member";
    const quotedMessage = (shareableMessageText({ ...message, senderName: "" }) || "Message")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    setActionMessage(null);
    await openContactChat(
      { id: senderId, name: senderName },
      {
        senderName,
        text: quotedMessage,
        messageType: message.type || "TEXT",
        groupName: activeConversation.otherName || activeSubject || "Group"
      }
    );
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
    setForwardingStatus(`Securing ${chosenMessages.length} message${chosenMessages.length === 1 ? "" : "s"} for ${selectedForwardConversationIds.length} chat${selectedForwardConversationIds.length === 1 ? "" : "s"}…`);
    try {
      // Let React commit the busy state before CPU-heavy encryption starts.
      // Without this frame handoff the native button can look unresponsive.
      await allowBusyUiToPaint();
      // Prepare each reusable media descriptor once, concurrently with device
      // identity and destination-key requests. Previously an old photo without
      // an embedded thumbnail was downloaded and thumbnailed again for every
      // selected destination, serially extending the forwarding delay.
      const preparedDescriptors = new Map<number, Promise<{ descriptor: string; error?: unknown }>>();
      chosenMessages.forEach((message) => {
        const existingDescriptor = typeof message.metadata?.encryptedKeyPayload === "string" ? message.metadata.encryptedKeyPayload : "";
        if (message.id <= 0 || !existingDescriptor || !["IMAGE", "VIDEO", "FILE"].includes(message.type)) return;
        preparedDescriptors.set(message.id, (async () => {
          try {
            const parsed = JSON.parse(existingDescriptor) as Record<string, unknown>;
            let thumbnailBase64 = typeof parsed.thumbnailBase64 === "string" ? parsed.thumbnailBase64 : "";
            if (["IMAGE", "VIDEO"].includes(message.type) && !thumbnailBase64) {
              const localAttachment = await materializeAttachment(message);
              thumbnailBase64 = await (message.type === "VIDEO"
                ? createLightweightVideoThumbnail(localAttachment.uri)
                : createLightweightChatThumbnail(localAttachment.uri)).catch(() => "");
            }
            return { descriptor: JSON.stringify({
              ...parsed,
              forwarded: true,
              ...(thumbnailBase64 ? { thumbnailBase64 } : {})
            }) };
          } catch (error) {
            return { descriptor: "", error };
          }
        })());
      });
      const [identity, destinationKeys] = await Promise.all([
        ensureChatDeviceIdentity(),
        Promise.all(selectedForwardConversationIds.map(async (conversationId) => ({ conversationId, keyPayload: await getChatDeviceKeys(conversationId) })))
      ]);
      for (const [conversationIndex, destination] of destinationKeys.entries()) {
        const { conversationId, keyPayload } = destination;
        setForwardingStatus(`Encrypting for chat ${conversationIndex + 1} of ${selectedForwardConversationIds.length}…`);
        if (!keyPayload.ready) throw new Error(keyPayload.warning || "A selected chat is not ready for encrypted forwarding.");
        for (const [messageIndex, message] of chosenMessages.entries()) {
          setForwardingStatus(`Forwarding message ${messageIndex + 1} of ${chosenMessages.length} to chat ${conversationIndex + 1} of ${selectedForwardConversationIds.length}…`);
          if (["IMAGE", "VIDEO", "FILE"].includes(message.type) && message.attachmentUrl) {
            const existingDescriptor = typeof message.metadata?.encryptedKeyPayload === "string" ? message.metadata.encryptedKeyPayload : "";
            if (message.id > 0 && existingDescriptor) {
              const preparedDescriptor = await preparedDescriptors.get(message.id)!;
              if (preparedDescriptor.error || !preparedDescriptor.descriptor) {
                throw new Error("This attachment descriptor is invalid and cannot be forwarded securely.");
              }
              const forwardedDescriptor = preparedDescriptor.descriptor;
              const preview = message.text || (message.type === "IMAGE" ? "Forwarded a photo" : message.type === "VIDEO" ? "Forwarded a video" : "Forwarded a file");
              const envelopes = encryptForDevices(forwardedDescriptor, identity, keyPayload.keys, preview);
              try {
                await forwardEncryptedChatAttachment(message.id, conversationId, envelopes, messageIndex + 1 < chosenMessages.length);
                continue;
              } catch (error) {
                const status = (error as Error & { fairFaresHttpStatus?: number }).fairFaresHttpStatus;
                // Keep forwarding usable while the mobile app and backend are
                // being rolled out independently. Older servers do not expose
                // the reference-forward route, so use the established secure
                // download/encrypt/upload flow until that server is upgraded.
                if (status !== 404 && status !== 405) throw error;
                setForwardingStatus(`Preparing message ${messageIndex + 1} of ${chosenMessages.length} for compatibility…`);
              }
            }
            const attachment = await materializeAttachment(message, (progress) => setForwardingStatus(`Preparing message ${messageIndex + 1} of ${chosenMessages.length}… ${Math.round(progress)}%`));
            if (!attachment) continue;
            const kind = message.type as "IMAGE" | "VIDEO" | "FILE";
            const thumbnailDataUrl = typeof message.metadata?.thumbnailDataUrl === "string" ? message.metadata.thumbnailDataUrl : "";
            let thumbnailBase64 = thumbnailDataUrl.startsWith("data:image/jpeg;base64,") ? thumbnailDataUrl.slice(thumbnailDataUrl.indexOf(",") + 1) : "";
            if (["IMAGE", "VIDEO"].includes(kind) && !thumbnailBase64) {
              thumbnailBase64 = await (kind === "VIDEO"
                ? createLightweightVideoThumbnail(attachment.uri)
                : createLightweightChatThumbnail(attachment.uri)).catch(() => "");
            }
            const materializedInfo = Platform.OS === "web" ? null : await FileSystem.getInfoAsync(attachment.uri);
            const plaintextSize = materializedInfo?.exists && "size" in materializedInfo ? Number(materializedInfo.size || 0) : 0;
            const forwardMetadata = { fileName: attachment.name, mimeType: attachment.mimeType, caption: message.text || "", kind, size: plaintextSize || undefined, forwarded: true, ...(thumbnailBase64 ? { thumbnailBase64 } : {}) };
            if (Platform.OS === "web") {
              const fileBase64 = attachment.uri.slice(attachment.uri.indexOf(",") + 1);
              const encrypted = encryptAttachmentForDevices(fileBase64, forwardMetadata, identity, keyPayload.keys);
              await sendDirectEncryptedChatAttachment(currentUserId, conversationId, encrypted, attachment.mimeType);
            } else {
              const encrypted = await encryptAttachmentFileForDevices(
                attachment.uri,
                forwardMetadata,
                identity,
                keyPayload.keys,
                (progress) => setForwardingStatus(`Encrypting message ${messageIndex + 1} of ${chosenMessages.length}… ${Math.round(progress * 100)}%`),
                cryptoThrottleForSize(Number(message.metadata?.size || 0))
              );
              let encryptedUploadFinalized = false;
              try {
                await sendDirectEncryptedChatAttachment(currentUserId, conversationId, encrypted, attachment.mimeType);
                encryptedUploadFinalized = true;
              } finally {
                if (encryptedUploadFinalized) deleteChunkedTemporaryFile(encrypted.encryptedUri);
              }
            }
          } else {
            const text = shareableMessageText({ ...message, senderName: "" });
            if (!text) continue;
            const envelopes = encryptForDevices(`FFFORWARD:${JSON.stringify({ text })}`, identity, keyPayload.keys, text);
            await sendEncryptedChatMessage(conversationId, envelopes);
          }
        }
      }
      setForwardPickerOpen(false);
      setSelectedMessageIds([]);
      setSelectedForwardConversationIds([]);
      playChitthiSentSound();
      setAttachmentStatus(`${chosenMessages.length} message${chosenMessages.length === 1 ? "" : "s"} forwarded securely`);
      setTimeout(() => setAttachmentStatus(""), 1600);
      void refreshMessenger({ showLoader: false, showError: false });
    } catch (error) {
      Alert.alert("Forward failed", error instanceof Error ? error.message : "Could not forward the selected messages.");
    } finally {
      setForwardingMessages(false);
      setForwardingStatus("");
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
    releasePendingAttachments([...pendingImages, ...(pendingAttachment ? [pendingAttachment] : [])]);
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
      <View style={[styles.threadScreen, Platform.OS === "android" && styles.threadScreenAndroid, Platform.OS === "android" && { paddingBottom: safeAreaInsets.bottom }]}>
        <View pointerEvents="none" style={[styles.wallpaperBase, { backgroundColor: wallpaperChoices.find((choice) => choice.id === wallpaper)?.color || "#080d18" }]}>
          {customWallpaper ? <Image source={{ uri: customWallpaper }} style={styles.wallpaperImage} resizeMode="cover" /> : null}
          {!customWallpaper ? <><View style={[styles.wallpaperGlow, styles.wallpaperGlowOne, { backgroundColor: wallpaperChoices.find((choice) => choice.id === wallpaper)?.accent || "#164d30" }]} /><View style={[styles.wallpaperGlow, styles.wallpaperGlowTwo, { backgroundColor: wallpaperChoices.find((choice) => choice.id === wallpaper)?.accent || "#164d30" }]} /><Text style={styles.wallpaperPattern}>⌖  ·  చి  ·  ◇  ·  ♥  ·  చి  ·  ◇</Text></> : null}
          <View style={[styles.wallpaperShade, Boolean(customWallpaper) && styles.customWallpaperShade]} />
        </View>
        <View style={styles.threadHeader}>
          <TouchableOpacity style={styles.backButton} onPress={closeThread} accessibilityRole="button" accessibilityLabel="Back to conversations">
            <BackIcon />
          </TouchableOpacity>
          <TouchableOpacity style={styles.threadAvatar} disabled={!activeConversation?.communityId} onPress={() => void showGroupMembers()} accessibilityLabel={activeConversation?.communityId ? "Open group info" : undefined}>
            <InitialsAvatar photoUrl={conversationAvatarUrl(activeConversation, currentUserId, data?.user?.profilePhotoUrl, data?.user?.name) || pendingPost?.photoUrl || pendingRide?.ownerPhotoUrl} label={activeConversation?.otherName || (pendingPost ? listingPosterName(pendingPost) : "") || (pendingRide ? rideOwnerName(pendingRide) : "") || activeSubject || "Chat"} imageStyle={styles.threadAvatarImage} textStyle={styles.threadAvatarText} />
            {activeConversation?.otherOnline && !activeConversation?.communityId ? <View style={styles.activeDot} /> : null}
          </TouchableOpacity>
          <TouchableOpacity style={styles.threadHeaderCopy} disabled={!activeConversation?.communityId} onPress={() => void showGroupMembers()} accessibilityLabel={activeConversation?.communityId ? "Open group info" : undefined}>
            <Text style={styles.threadHeaderTitle} numberOfLines={1}>
              {activeConversation?.otherName || (pendingPost ? listingPosterName(pendingPost) : "") || (pendingRide ? rideOwnerName(pendingRide) : "") || "Chitthi"}
            </Text>
            <Text style={styles.threadHeaderMeta} numberOfLines={1}>
              {`${presenceLabel(activeConversation)} · ${encryptionReady ? "🔒 End-to-end encrypted" : encryptionStatusDetail || "Encryption setup pending"}`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerAction} onPress={showChatOptions} accessibilityLabel="Chat options"><DotsIcon /></TouchableOpacity>
        </View>

        <View style={styles.threadKeyboardViewport}>
        <ThreadKeyboardBody bottomSafeArea={safeAreaInsets.bottom}>

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
            {activeConversation?.communityId ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => void changeActiveGroupPhoto()}><Text style={styles.chatOptionIcon}>▣</Text><Text style={styles.chatOptionText}>Change group image</Text></TouchableOpacity> : null}
            {activeConversation?.communityId ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => void inviteToActiveGroup()}><Text style={styles.chatOptionIcon}>↗</Text><Text style={styles.chatOptionText}>Invite with group link</Text></TouchableOpacity> : null}
            <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); setWallpaperPanelOpen(true); }}><Text style={styles.chatOptionIcon}>▧</Text><Text style={styles.chatOptionText}>Chat wallpaper</Text></TouchableOpacity>
            {Platform.OS === "android" && NEARBY_RELAY_ENABLED_FOR_BUILD ? <View style={styles.nearbyOptionRow}><View style={styles.nearbyOptionCopy}><Text style={styles.nearbyOptionTitle}>Nearby offline relay</Text><Text style={styles.nearbyOptionMeta}>{nearbyRelayStatus.state === "error" ? nearbyRelayStatus.detail : nearbyRelayEnabled ? `${nearbyRelayStatus.peers} nearby device${nearbyRelayStatus.peers === 1 ? "" : "s"}` : "Off · encrypted text only"}</Text></View><Switch value={nearbyRelayEnabled} onValueChange={(value) => void toggleNearbyRelay(value)} trackColor={{ false: "#aaa", true: "#5a83f3" }} /></View> : null}
          </View>
          </>
        ) : null}

        {groupMembersOpen ? (
          <View style={styles.groupInfoPanel}>
            <View style={styles.groupInfoHeader}>
              <View style={styles.groupInfoHeaderButton} />
              <Text style={styles.groupInfoHeaderTitle}>Group info</Text>
              <TouchableOpacity style={styles.groupInfoDoneButton} onPress={() => setGroupMembersOpen(false)} accessibilityRole="button" accessibilityLabel="Close group info"><Text style={styles.groupInfoDoneText}>Done</Text></TouchableOpacity>
            </View>
            <ScrollView style={styles.groupInfoScroll} contentContainerStyle={styles.groupInfoContent}>
              <View style={styles.groupInfoHero}>
                <TouchableOpacity style={styles.groupInfoAvatar} onPress={() => void changeActiveGroupPhoto()} accessibilityLabel="Change group image">
                  <InitialsAvatar photoUrl={activeGroupPhotoUrl} label={activeGroup?.name || activeConversation?.otherName || "Group"} imageStyle={styles.groupInfoAvatarImage} textStyle={styles.groupInfoAvatarText} />
                  <View style={styles.groupInfoEditBadge}><Text style={styles.groupInfoEditBadgeText}>✎</Text></View>
                </TouchableOpacity>
                <Text style={styles.groupInfoTitle}>{activeGroup?.name || activeConversation?.otherName || "Chitthi group"}</Text>
                <Text style={styles.groupInfoMeta}>{activeGroup?.visibility === "PRIVATE" ? "Private group" : "Community"} · {groupMembers.length || activeGroup?.memberCount || 0} members</Text>
              </View>

              <View style={styles.groupInfoActions}>
                <TouchableOpacity style={styles.groupInfoAction} onPress={() => void toggleMute()} accessibilityRole="button" accessibilityLabel={activeConversation?.mutedAt ? "Unmute group notifications" : "Mute group notifications"}><Text style={styles.groupInfoActionIcon}>♩</Text><Text style={styles.groupInfoActionLabel}>{activeConversation?.mutedAt ? "Unmute" : "Mute"}</Text></TouchableOpacity>
                {activeGroup?.canManageMembers ? <TouchableOpacity style={styles.groupInfoAction} onPress={() => { setGroupMembersOpen(false); setSelectedGroupPeople([]); void findPeopleFromContacts("add", activeConversation?.communityId || ""); }} accessibilityRole="button" accessibilityLabel="Add group members"><Text style={styles.groupInfoActionIcon}>＋</Text><Text style={styles.groupInfoActionLabel}>Add</Text></TouchableOpacity> : null}
                {activeConversation?.communityId ? <TouchableOpacity style={styles.groupInfoAction} onPress={() => void inviteToActiveGroup()} accessibilityRole="button" accessibilityLabel="Invite with group link"><Text style={styles.groupInfoActionIcon}>↗</Text><Text style={styles.groupInfoActionLabel}>Invite</Text></TouchableOpacity> : null}
              </View>

              <View style={styles.groupInfoCard}>
                <View style={styles.groupDetailsHeader}>
                  <Text style={styles.groupDetailsLabel}>Group details</Text>
                  {activeConversation?.communityId && !groupDetailsEditing ? <TouchableOpacity style={styles.groupDetailsEditButton} onPress={beginEditingActiveGroupDetails} accessibilityRole="button" accessibilityLabel="Edit group details"><Text style={styles.groupDetailsEditText}>✎ Edit</Text></TouchableOpacity> : null}
                </View>
                {groupDetailsEditing ? (
                  <View style={styles.groupDetailsForm}>
                    <Text style={styles.groupDetailsFieldLabel}>Name</Text>
                    <TextInput value={groupDetailsDraft.name} onChangeText={(name) => setGroupDetailsDraft((current) => ({ ...current, name }))} maxLength={80} style={styles.groupDetailsInput} placeholder="Group name" placeholderTextColor="#7E9086" />
                    <Text style={styles.groupDetailsFieldLabel}>Description</Text>
                    <TextInput value={groupDetailsDraft.description} onChangeText={(description) => setGroupDetailsDraft((current) => ({ ...current, description }))} maxLength={220} multiline style={[styles.groupDetailsInput, styles.groupDetailsDescriptionInput]} placeholder="What is this group for?" placeholderTextColor="#7E9086" />
                    <Text style={styles.groupDetailsFieldLabel}>Location</Text>
                    <TextInput value={groupDetailsDraft.area} onChangeText={(area) => setGroupDetailsDraft((current) => ({ ...current, area }))} maxLength={80} style={styles.groupDetailsInput} placeholder="City, state or area" placeholderTextColor="#7E9086" />
                    <View style={styles.groupDetailsFormActions}>
                      <TouchableOpacity style={styles.groupDetailsCancelButton} disabled={groupDetailsSaving} onPress={() => setGroupDetailsEditing(false)}><Text style={styles.groupDetailsCancelText}>Cancel</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.groupDetailsSaveButton} disabled={groupDetailsSaving} onPress={() => void saveActiveGroupDetails()}><Text style={styles.groupDetailsSaveText}>{groupDetailsSaving ? "Saving…" : "Save"}</Text></TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <>
                    <Text style={styles.groupInfoDescription}>{activeGroup?.description || "A Chitthi group for members to connect, share updates, and help each other."}</Text>
                    {activeGroup?.area ? <Text style={styles.groupInfoDescriptionMeta}>⌖ {activeGroup.area}</Text> : null}
                  </>
                )}
              </View>

              <View style={styles.groupInfoCard}>
                <TouchableOpacity style={styles.groupInfoSettingRow} onPress={() => void toggleMute()} accessibilityRole="button" accessibilityLabel={`Group notifications ${activeConversation?.mutedAt ? "muted" : "on"}`}><Text style={styles.groupInfoSettingIcon}>♩</Text><View style={styles.groupInfoSettingCopy}><Text style={styles.groupInfoSettingTitle}>Notifications</Text><Text style={styles.groupInfoSettingMeta}>{activeConversation?.mutedAt ? "Muted" : "On"}</Text></View><Text style={styles.groupInfoChevron}>›</Text></TouchableOpacity>
                <TouchableOpacity style={styles.groupInfoSettingRow} onPress={() => { setGroupMembersOpen(false); setWallpaperPanelOpen(true); }} accessibilityRole="button" accessibilityLabel="Open group chat wallpaper"><Text style={styles.groupInfoSettingIcon}>◉</Text><View style={styles.groupInfoSettingCopy}><Text style={styles.groupInfoSettingTitle}>Chat theme</Text><Text style={styles.groupInfoSettingMeta}>Choose a Chitthi wallpaper</Text></View><Text style={styles.groupInfoChevron}>›</Text></TouchableOpacity>
                <View style={[styles.groupInfoSettingRow, styles.groupInfoSettingRowLast]}><Text style={styles.groupInfoSettingIcon}>▢</Text><View style={styles.groupInfoSettingCopy}><Text style={styles.groupInfoSettingTitle}>Encryption</Text><Text style={styles.groupInfoSettingMeta}>Messages are end-to-end encrypted</Text></View></View>
              </View>

              <View style={styles.groupMembersSection}>
                <Text style={styles.groupMembersHeading}>{groupMembers.length} members</Text>
                <View style={styles.groupMembersSearch}><Text style={styles.groupMembersSearchIcon}>⌕</Text><TextInput value={groupMemberSearch} onChangeText={setGroupMemberSearch} placeholder="Search members or roles" placeholderTextColor="#7E9086" style={styles.groupMembersSearchInput} autoCapitalize="none" /></View>
                {activeGroup?.canManageMembers ? <TouchableOpacity style={styles.groupMemberRow} onPress={() => { setGroupMembersOpen(false); setSelectedGroupPeople([]); void findPeopleFromContacts("add", activeConversation?.communityId || ""); }}><View style={[styles.groupMemberAvatar, styles.groupMemberAddAvatar]}><Text style={styles.groupMemberAddIcon}>＋</Text></View><View style={styles.groupMemberCopy}><Text style={styles.groupMemberAddText}>Add members</Text><Text style={styles.groupMemberSubtext}>Invite people to this group</Text></View><Text style={styles.groupMemberChevron}>›</Text></TouchableOpacity> : null}
                {filteredGroupMembers.map((member) => {
                  const currentRole = groupMembers.find((item) => item.isCurrentUser)?.role || "MEMBER";
                  const canManage = !member.isCurrentUser && member.role !== "OWNER" && (currentRole === "OWNER" || (currentRole === "ADMIN" && member.role === "MEMBER"));
                  const roleLabel = member.role === "OWNER" ? "Owner" : member.role === "ADMIN" ? "Admin" : "Member";
                  return <TouchableOpacity key={member.id} style={styles.groupMemberRow} disabled={member.isCurrentUser} activeOpacity={0.65} onPress={() => void messageGroupMember(member)} onLongPress={canManage ? () => showGroupMemberActions(member) : undefined} accessibilityLabel={member.isCurrentUser ? `${member.name}, you, ${roleLabel}` : `Message ${member.name} privately. ${roleLabel}`}>
                    <View style={styles.groupMemberAvatar}><InitialsAvatar photoUrl={member.photoUrl} label={member.name} imageStyle={styles.groupMemberAvatarImage} textStyle={styles.groupMemberAvatarText} /></View>
                    <View style={styles.groupMemberCopy}><View style={styles.groupMemberNameLine}><Text style={styles.groupMemberName}>{member.name}</Text>{member.isCurrentUser ? <Text style={styles.groupMemberCurrentTag}>You</Text> : null}</View><Text style={styles.groupMemberSubtext}>{member.isCurrentUser ? `You are a group ${roleLabel.toLowerCase()}` : "Tap to message privately"}</Text></View>
                    <Text style={[styles.groupMemberRole, member.role === "OWNER" ? styles.groupMemberRoleOwner : member.role === "ADMIN" ? styles.groupMemberRoleAdmin : styles.groupMemberRoleMember]}>{roleLabel}</Text>
                    {canManage ? <TouchableOpacity style={styles.groupMemberManageButton} onPress={() => showGroupMemberActions(member)} accessibilityLabel={`Manage ${member.name}`}><Text style={styles.groupMemberManageIcon}>•••</Text></TouchableOpacity> : !member.isCurrentUser ? <Text style={styles.groupMemberChevron}>›</Text> : null}
                  </TouchableOpacity>;
                })}
                {!filteredGroupMembers.length ? <Text style={styles.groupMembersEmpty}>No members match your search.</Text> : null}
              </View>
              <TouchableOpacity style={styles.leaveGroupButton} onPress={() => Alert.alert("Leave this group?", "You will stop receiving messages from this group.", [{ text: "Cancel", style: "cancel" }, { text: "Leave group", style: "destructive", onPress: () => void leaveActiveGroup() }])} accessibilityRole="button" accessibilityLabel="Leave group"><Text style={styles.leaveGroupText}>Leave group</Text></TouchableOpacity>
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.threadMessages}>
          {identityRecoveryWarning || (!encryptionReady && encryptionStatusDetail) ? (
            <View style={styles.encryptionRecoveryWarning}>
              <Text style={styles.encryptionRecoveryWarningText}>{identityRecoveryWarning || encryptionStatusDetail}</Text>
            </View>
          ) : null}
          <FlatList
            ref={messagesScrollRef}
            style={styles.threadMessagesList}
            data={threadMessageItems}
            inverted
            // Keep the same bubble pinned while envelopes decrypt, thumbnails
            // resolve, older pages arrive, or realtime updates insert rows.
            // This is the native recycler's anchor and works with an inverted
            // list without estimating variable-height message layouts in JS.
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.threadMessagesContent}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : Platform.OS === "android" ? "on-drag" : "none"}
            // Keep scroll-linked keyboard dismissal responsive on 60/90/120 Hz
            // devices. Keyboard translation itself remains native/UI-thread.
            scrollEventThrottle={16}
            // Message rows can contain authenticated media, link previews and
            // rich cards. Keep JS batches below a frame budget; the native
            // recycler fills the remaining window incrementally.
            initialNumToRender={8}
            maxToRenderPerBatch={4}
            updateCellsBatchingPeriod={48}
            windowSize={5}
            // iOS inverted lists are implemented with transforms. Clipping
            // variable-height media cells there can detach/re-attach the
            // visible anchor and produce a jump. Android's recycler benefits
            // from clipping and does not have that transform interaction.
            removeClippedSubviews={Platform.OS === "android"}
            onLayout={(event) => { messagesViewportHeightRef.current = event.nativeEvent.layout.height; }}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              messagesScrollRef.current?.scrollToOffset({ offset: Math.max(0, index * averageItemLength), animated: false });
              requestAnimationFrame(() => messagesScrollRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 }));
            }}
            onScrollBeginDrag={(event) => {
              markThreadTouched();
              messagesUserDraggingRef.current = true;
              paginationRequestedThisGestureRef.current = false;
              const offset = Math.max(0, event.nativeEvent.contentOffset.y);
              messagesScrollOffsetRef.current = offset;
              updateJumpToLatestVisibility(offset);
            }}
            onScrollEndDrag={(event) => {
              const offset = Math.max(0, event.nativeEvent.contentOffset.y);
              messagesScrollOffsetRef.current = offset;
              updateJumpToLatestVisibility(offset);
              const distanceFromOlderEdge = Math.max(0, event.nativeEvent.contentSize.height - (offset + event.nativeEvent.layoutMeasurement.height));
              if (!paginationRequestedThisGestureRef.current && !loadingOlderMessagesRef.current && distanceFromOlderEdge <= 140) {
                paginationRequestedThisGestureRef.current = true;
                void loadOlderMessages(true);
              }
              messagesUserDraggingRef.current = false;
            }}
            onMomentumScrollEnd={(event) => {
              const offset = Math.max(0, event.nativeEvent.contentOffset.y);
              messagesScrollOffsetRef.current = offset;
              updateJumpToLatestVisibility(offset);
              const distanceFromOlderEdge = Math.max(0, event.nativeEvent.contentSize.height - (offset + event.nativeEvent.layoutMeasurement.height));
              if (!paginationRequestedThisGestureRef.current && !loadingOlderMessagesRef.current && distanceFromOlderEdge <= 140) {
                paginationRequestedThisGestureRef.current = true;
                void loadOlderMessages(true);
              }
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
              // Never perform network/decryption work from frame-by-frame
              // scroll callbacks. Pagination is committed once at gesture or
              // momentum end, guarded by paginationRequestedThisGestureRef.
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
                {loadingOlderMessages ? <View pointerEvents="none" style={styles.olderMessagesStatusWrap}><Text style={styles.olderMessagesStatus}>Loading earlier messages…</Text></View> : null}
                {!loadingOlderMessages && hasMoreMessages ? (
                  <TouchableOpacity style={styles.olderMessagesButton} onPress={() => void loadOlderMessages(true)}>
                    <Text style={styles.olderMessagesButtonText}>Load earlier messages</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              <View style={styles.threadListEmpty}>
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
            if (item.kind === "date") {
              return <View style={styles.dateDivider}><View style={styles.dateDividerLine} /><Text style={styles.dateDividerText}>{chatDayLabel(item.message.createdAt)}</Text><View style={styles.dateDividerLine} /></View>;
            }
            const { message, skipForMediaGroup, mediaGroup, discoveredUrl, isMediaMessage, messageRunEnds, replyTarget } = item;
            if (skipForMediaGroup) return null;
            const mediaUploading = Boolean(message.metadata?.uploading);
            const mediaDownloading = downloadingMediaMessageIds.includes(message.id);
            return (
            <View key={message.id} style={styles.threadMessageCell}>
            <SwipeToReply onReply={() => beginReply(message)}><View style={[styles.threadMessageRow, message.mine && styles.threadMessageRowMine, messageRunEnds && styles.threadMessageRunEnd, highlightedMessageId === message.id && styles.highlightedMessageRow]}>
              {!message.mine && Boolean(activeConversation?.communityId) && messageRunEnds ? (
                <View style={styles.smallAvatar}>
                  <InitialsAvatar photoUrl={message.senderPhotoUrl} label={message.senderName || "F"} imageStyle={styles.smallAvatarImage} textStyle={styles.smallAvatarText} />
                </View>
              ) : !message.mine && Boolean(activeConversation?.communityId) ? <View style={styles.smallAvatarSpacer} /> : null}
              <TouchableOpacity
                activeOpacity={selectedMessageIds.length ? 0.78 : 1}
                delayLongPress={350}
                onLongPress={() => handleMessageLongPress(message)}
                onPress={() => {
                  if (mediaUploading) {
                    cancelPendingMediaUpload(message.id);
                  } else if (selectedMessageIds.length) {
                    toggleMessageSelection(message);
                  } else if (message.replyToMessageId) {
                    jumpToRepliedMessage(Number(message.replyToMessageId));
                  }
                }}
                style={[styles.bubble, isMediaMessage && styles.photoBubble, message.mine ? styles.myBubble : styles.theirBubble, isMediaMessage && (message.mine ? styles.myPhotoBubble : styles.theirPhotoBubble), selectedMessageIds.includes(messageSelectionKey(message)) && styles.selectedMessageBubble]}
              >
                {selectedMessageIds.includes(messageSelectionKey(message)) ? <View style={styles.messageSelectionCheck}><Text style={styles.messageSelectionCheckText}>✓</Text></View> : null}
                {messageRunEnds ? <View style={[styles.bubbleTail, message.mine ? styles.myBubbleTail : styles.theirBubbleTail]} /> : null}
                {!message.mine && Boolean(activeConversation?.communityId) ? <View style={[styles.senderLine, isMediaMessage && styles.photoSenderLine]}><Text style={[styles.senderName, isMediaMessage && styles.photoSenderName]} numberOfLines={1}>{message.senderName || activeConversation?.otherName}</Text></View> : null}
                {message.metadata?.forwarded ? <View style={styles.forwardedLabel}><Text style={[styles.forwardedLabelText, message.mine && styles.myForwardedLabelText]}>↪ Forwarded</Text></View> : null}
                {message.metadata?.privateReply ? <PrivateReplyCard context={message.metadata.privateReply} mine={message.mine} /> : null}
                {message.replyToMessageId ? <TouchableOpacity activeOpacity={0.72} delayLongPress={350} onPress={(event) => { event.stopPropagation(); jumpToRepliedMessage(Number(message.replyToMessageId)); }} onLongPress={(event) => { event.stopPropagation(); handleMessageLongPress(message); }} accessibilityLabel="Go to replied message"><QuotedReply target={replyTarget} mine={message.mine} /></TouchableOpacity> : null}
                {message.contextTitle ? (
                  <View style={[styles.messageContext, message.mine ? styles.myMessageContext : styles.theirMessageContext]}>
                    <Text style={[styles.messageContextType, message.mine ? styles.myMessageContextType : styles.theirMessageContextType]}>
                      {message.contextType === "CARPOOL" ? "Carpool listing" : message.contextType === "COMMUNITY" ? "Ask Community" : "Housing listing"}
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
                {message.attachmentUrl || (message.type === "IMAGE" && Boolean(message.metadata?.thumbnailDataUrl || message.metadata?.decryptedDataUrl)) ? (
                  message.type === "IMAGE" ? <View style={styles.photoMediaWrap}>{mediaGroup.length > 1 ? <View style={styles.messageCollage}>{mediaGroup.slice(0, 4).map((photo, photoIndex) => { const photoSelected = selectedMessageIds.includes(messageSelectionKey(photo)); return <Pressable key={photo.id} style={[styles.collageCell, photoSelected && styles.selectedCollageCell]} delayLongPress={300} onPress={(event) => { event.stopPropagation(); selectedMessageIds.length ? toggleMessageSelection(photo) : void openPhotoGroup(mediaGroup); }} onLongPress={(event) => { event.stopPropagation(); handleMessageLongPress(photo); }} accessibilityRole="button" accessibilityLabel={`Open all ${mediaGroup.length} photos`}><ChatMessagePhoto message={photo} resolvePreview={resolveEncryptedPhotoPreview} compact />{photoSelected ? <View style={styles.collageSelectionCheck} pointerEvents="none"><Text style={styles.messageSelectionCheckText}>✓</Text></View> : null}<View style={styles.collageTimeOverlay} pointerEvents="none"><Text style={styles.collageTimeText}>{chatClock(photo.createdAt)}</Text></View>{photoIndex === 3 && mediaGroup.length > 4 ? <View style={styles.collageMore} pointerEvents="none"><Text style={styles.collageMoreText}>+{mediaGroup.length - 3}</Text></View> : null}</Pressable>; })}</View> : <Pressable disabled={Boolean(message.metadata?.uploading)} delayLongPress={300} onPress={(event) => { event.stopPropagation(); selectedMessageIds.length ? toggleMessageSelection(message) : void openAttachment(message); }} onLongPress={(event) => { event.stopPropagation(); handleMessageLongPress(message); }} accessibilityRole="button" accessibilityLabel={message.metadata?.uploading ? "Photo uploading" : "Preview photo"}><ChatMessagePhoto message={message} resolvePreview={resolveEncryptedPhotoPreview} /></Pressable>}{mediaGroup.length <= 1 ? <View style={styles.photoTimeOverlay} pointerEvents="none"><Text style={styles.photoTimeText}>{chatClock(message.createdAt)}</Text>{message.mine && messageReceipt(message.status) ? <Text style={[styles.photoReceipt, message.status === "seen" && styles.receiptSeen]}>{messageReceipt(message.status)}</Text> : null}</View> : null}</View> : message.type === "VIDEO" ? (
                    <View style={styles.photoMediaWrap}>
                      <Pressable
                        style={styles.videoMessageCard}
                        delayLongPress={300}
                        onLongPress={(event) => { event.stopPropagation(); handleMessageLongPress(message); }}
                        disabled={Boolean(message.metadata?.uploading)}
                        onPress={(event) => { event.stopPropagation(); selectedMessageIds.length ? toggleMessageSelection(message) : void openAttachment(message); }}
                        accessibilityRole="button"
                        accessibilityLabel={message.metadata?.uploading ? "Video uploading" : "Play video"}
                      >
                        {message.metadata?.thumbnailDataUrl || localVideoThumbnailUris[message.id] ? <Image source={{ uri: String(message.metadata?.thumbnailDataUrl || localVideoThumbnailUris[message.id]) }} style={styles.videoMessageThumbnail} resizeMode="cover" /> : <View style={styles.videoMessageBackdrop}><Text style={styles.videoMessageBackdropIcon}>▧</Text></View>}
                        <View style={styles.videoMessagePlay}><Text style={styles.videoMessagePlayText}>▶</Text></View>
                        <View style={styles.videoMessageBadge}><Text style={styles.videoMessageBadgeText}>↓ {Math.max(1, Number(message.metadata?.size || 0) / (1024 * 1024)).toFixed(1)} MB</Text></View>
                        {mediaDownloading ? (
                          <View style={styles.videoDownloadOverlay} pointerEvents="none">
                            {Platform.OS === "web" ? <View style={styles.videoDownloadBlurFallback} /> : <BlurView intensity={24} tint="dark" style={styles.videoDownloadBlurFallback} />}
                            <MediaDownloadProgress messageId={message.id} />
                          </View>
                        ) : null}
                      </Pressable>
                      {mediaUploading ? (
                        <View style={styles.videoUploadCancelOverlay} pointerEvents="none">
                          {Platform.OS === "web" ? <View pointerEvents="none" style={styles.videoDownloadBlurFallback} /> : <BlurView pointerEvents="none" intensity={24} tint="dark" style={styles.videoDownloadBlurFallback} />}
                          <View style={styles.videoUploadCancelButton}>
                            <MediaUploadCancelProgress messageId={message.id} />
                          </View>
                        </View>
                      ) : null}
                      <View style={styles.photoTimeOverlay}><Text style={styles.photoTimeText}>{chatClock(message.createdAt)}</Text>{message.mine && messageReceipt(message.status) ? <Text style={[styles.photoReceipt, message.status === "seen" && styles.receiptSeen]}>{messageReceipt(message.status)}</Text> : null}</View>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.fileCard} onPress={() => void openAttachment(message)} accessibilityRole="button" accessibilityLabel={`Open or save ${String(message.metadata?.fileName || "Chitthi file")}`}>
                      <View style={[styles.attachmentIcon, styles.fileIcon, styles.fileCardIcon]}><Text style={styles.fileCardBadge}>{chatFileBadge(String(message.metadata?.fileName || ""), String(message.metadata?.mimeType || ""))}</Text></View>
                      <View style={styles.fileCardCopy}><Text style={styles.fileCardName} numberOfLines={2}>{message.metadata?.fileName || "Chitthi file"}</Text><Text style={styles.fileCardMeta}>{Math.max(1, Math.round(Number(message.metadata?.size || 0) / 1024))} KB</Text></View>
                    </TouchableOpacity>
                  )
                ) : null}
                {!message.attachmentUrl && message.metadata?.mediaExpired && !message.metadata?.thumbnailDataUrl && !message.metadata?.decryptedDataUrl ? (
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
                {!isMediaMessage ? <View style={styles.bubbleMetaRow} accessibilityLabel={`${chatClock(message.createdAt)}${message.mine ? `, ${messageReceiptLabel(message.status)}` : ""}`}>
                  {message.editedAt ? <Text style={[styles.bubbleMeta, message.mine ? styles.myBubbleMeta : styles.theirBubbleMeta]}>Edited · </Text> : null}
                  <Text style={[styles.bubbleMeta, message.mine ? styles.myBubbleMeta : styles.theirBubbleMeta]}>{chatClock(message.createdAt)}</Text>
                  {message.mine && messageReceipt(message.status) ? <Text style={[styles.receiptMark, message.status === "seen" && styles.receiptSeen, message.status === "failed" && styles.receiptFailed]}>{messageReceipt(message.status)}</Text> : null}
                </View> : null}
                {(message.reactions || []).length ? <View style={styles.messageReactions}>{message.reactions!.map((reaction) => <TouchableOpacity key={reaction.emoji} style={[styles.messageReactionChip, reaction.mine && styles.messageReactionChipMine]} onPress={() => void reactToMessage(message, reaction.emoji)}><Text style={styles.messageReactionEmoji}>{reaction.emoji}</Text>{reaction.count > 1 ? <Text style={styles.messageReactionCount}>{reaction.count}</Text> : null}</TouchableOpacity>)}</View> : null}
              </TouchableOpacity>
            </View></SwipeToReply>
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
          <Pressable
            style={styles.messageActionBackdrop}
            onPress={() => setActionMessage(null)}
            accessible={false}
          >
            {Platform.OS === "web" || actionMessage?.type === "VIDEO" ? <View pointerEvents="none" style={styles.messageActionBlurFallback} /> : <BlurView pointerEvents="none" intensity={34} tint="dark" style={styles.messageActionBlurFallback} />}
              {actionMessage ? (
              <Pressable onPress={() => setActionMessage(null)} style={[styles.messageActionStack, actionMessage.mine && styles.messageActionStackMine]} accessible={false}>
                <Pressable onPress={(event) => event.stopPropagation()} style={[styles.messageReactionTray, actionMessage.mine && styles.messageReactionTrayMine]} accessible={false}>
                  {["👍", "❤️", "😂", "😮", "😢", "🙏", "👏"].map((emoji) => (
                    <TouchableOpacity key={emoji} style={styles.messageReactionChoice} onPress={() => void reactToMessage(actionMessage, emoji)} accessibilityRole="button" accessibilityLabel={`React ${emoji}`}>
                      <Text style={styles.messageReactionChoiceText}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={styles.messageReactionMore} onPress={() => Alert.alert("More reactions", "Use one of these quick reactions for now.")} accessibilityRole="button" accessibilityLabel="More reactions">
                    <Text style={styles.messageReactionMoreText}>＋</Text>
                  </TouchableOpacity>
                </Pressable>
                <Pressable onPress={() => setActionMessage(null)} style={[styles.messageActionPreviewRow, actionMessage.mine && styles.messageActionPreviewRowMine]} accessibilityRole="button" accessibilityLabel="Close message actions">
                  <View pointerEvents="none" style={[styles.bubble, actionMessage.type === "IMAGE" && actionMessage.attachmentUrl && styles.photoBubble, actionMessage.mine ? styles.myBubble : styles.theirBubble, actionMessage.type === "IMAGE" && actionMessage.attachmentUrl && (actionMessage.mine ? styles.myPhotoBubble : styles.theirPhotoBubble), styles.messageActionPreviewBubble]}>
                    {actionMessage.attachmentUrl && actionMessage.type === "IMAGE" ? <ChatMessagePhoto message={actionMessage} resolvePreview={resolveEncryptedPhotoPreview} /> : null}
                    {actionMessage.text && !["POLL", "EVENT", "CONTACT", "LOCATION"].includes(actionMessage.type) ? <DiscoveredMessageText message={actionMessage.text} mine={actionMessage.mine} /> : null}
                    {!actionMessage.text && actionMessage.type !== "IMAGE" ? <Text style={[styles.bubbleText, actionMessage.mine ? styles.myBubbleText : styles.theirBubbleText]}>{shareableMessageText(actionMessage) || "Message"}</Text> : null}
                    <View style={styles.bubbleMetaRow}><Text style={[styles.bubbleMeta, actionMessage.mine ? styles.myBubbleMeta : styles.theirBubbleMeta]}>{chatClock(actionMessage.createdAt)}</Text>{actionMessage.mine && messageReceipt(actionMessage.status) ? <Text style={[styles.receiptMark, actionMessage.status === "seen" && styles.receiptSeen, actionMessage.status === "failed" && styles.receiptFailed]}>{messageReceipt(actionMessage.status)}</Text> : null}</View>
                    {(actionMessage.reactions || []).length ? <View style={styles.messagePreviewReactions}>{actionMessage.reactions!.map((reaction) => <TouchableOpacity key={reaction.emoji} style={[styles.messageReactionChip, reaction.mine && styles.messageReactionChipMine]} onPress={() => void reactToMessage(actionMessage, reaction.emoji)}><Text style={styles.messageReactionEmoji}>{reaction.emoji}</Text>{reaction.count > 1 ? <Text style={styles.messageReactionCount}>{reaction.count}</Text> : null}</TouchableOpacity>)}</View> : null}
                  </View>
                </Pressable>
                <Pressable onPress={(event) => event.stopPropagation()} style={[styles.messageActionSheet, actionMessage.mine && styles.messageActionSheetMine]} accessible={false}>
                  <TouchableOpacity style={styles.messageActionRow} onPress={() => beginReply(actionMessage)} accessibilityRole="button" accessibilityLabel="Reply"><Text style={styles.messageActionGlyph}>↩</Text><Text style={styles.messageActionLabel}>Reply</Text></TouchableOpacity>
                  {!actionMessage.mine && Boolean(activeConversation?.communityId) && Number(actionMessage.senderId || 0) > 0 ? <TouchableOpacity style={styles.messageActionRow} onPress={() => void replyToGroupMessagePrivately(actionMessage)} accessibilityRole="button" accessibilityLabel={`Reply privately to ${actionMessage.senderName || "member"}`}><Text style={styles.messageActionGlyph}>✉</Text><Text style={styles.messageActionLabel}>Reply privately</Text></TouchableOpacity> : null}
                  <TouchableOpacity style={styles.messageActionRow} onPress={() => forwardActionMessage(actionMessage)} accessibilityRole="button" accessibilityLabel="Forward"><Text style={styles.messageActionGlyph}>↗</Text><Text style={styles.messageActionLabel}>Forward</Text></TouchableOpacity>
                  {actionMessage.text ? <TouchableOpacity style={styles.messageActionRow} onPress={() => { void Clipboard.setStringAsync(actionMessage.text); setActionMessage(null); }} accessibilityRole="button" accessibilityLabel="Copy"><Text style={styles.messageActionGlyph}>▣</Text><Text style={styles.messageActionLabel}>Copy</Text></TouchableOpacity> : null}
                  <TouchableOpacity style={styles.messageActionRow} onPress={() => beginMessageSelection(actionMessage)} accessibilityRole="button" accessibilityLabel="Select"><Text style={styles.messageActionGlyph}>✓</Text><Text style={styles.messageActionLabel}>Select</Text></TouchableOpacity>
                  {actionMessage.mine && actionMessage.canEdit ? <TouchableOpacity style={styles.messageActionRow} onPress={() => { const target = actionMessage; setActionMessage(null); editMessage(target); }} accessibilityRole="button" accessibilityLabel="Edit"><Text style={styles.messageActionGlyph}>✎</Text><Text style={styles.messageActionLabel}>Edit</Text></TouchableOpacity> : null}
                  {actionMessage.mine && actionMessage.canEdit ? <TouchableOpacity style={styles.messageActionRow} onPress={() => { const target = actionMessage; setActionMessage(null); void deleteMessage(target); }} accessibilityRole="button" accessibilityLabel="Delete"><Text style={[styles.messageActionGlyph, styles.messageActionDanger]}>⌫</Text><Text style={[styles.messageActionLabel, styles.messageActionDanger]}>Delete</Text></TouchableOpacity> : null}
                  {!actionMessage.mine ? <TouchableOpacity style={styles.messageActionRow} onPress={() => { const target = actionMessage; setActionMessage(null); void reportMessage(target); }} accessibilityRole="button" accessibilityLabel="Report"><Text style={[styles.messageActionGlyph, styles.messageActionDanger]}>!</Text><Text style={[styles.messageActionLabel, styles.messageActionDanger]}>Report</Text></TouchableOpacity> : null}
                </Pressable>
              </Pressable>
              ) : null}
          </Pressable>
        </Modal>

        <Modal visible={Boolean(attachmentPreview)} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setAttachmentPreview(null)}>
          <View style={styles.mediaViewerBackdrop}>
            <View style={styles.mediaViewerHeader}>
              <TouchableOpacity style={styles.mediaViewerRoundButton} onPress={() => setAttachmentPreview(null)} accessibilityLabel="Back to conversation"><Text style={styles.mediaViewerBackText}>‹</Text></TouchableOpacity>
              <View style={styles.mediaViewerPerson}>
                <View style={styles.mediaViewerAvatar}><InitialsAvatar photoUrl={conversationAvatarUrl(activeConversation, currentUserId, data?.user?.profilePhotoUrl, data?.user?.name)} label={activeConversation?.otherName || "F"} imageStyle={styles.mediaViewerAvatarImage} textStyle={styles.mediaViewerAvatarText} /></View>
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
                {visibleMessages.filter((item) => (item.type === "IMAGE" || item.type === "VIDEO") && Boolean(item.attachmentUrl) && !item.metadata?.mediaExpired).slice(-20).map((item) => <TouchableOpacity key={item.id} style={[styles.mediaViewerThumbnail, attachmentPreview?.messageId === item.id && styles.mediaViewerThumbnailActive]} onPress={() => void openAttachment(item)} accessibilityLabel={`Open ${item.type === "VIDEO" ? "video" : "photo"} from ${chatClock(item.createdAt)}`}>{item.type === "IMAGE" ? <ChatMessagePhoto message={item} resolvePreview={resolveEncryptedPhotoPreview} compact /> : <View style={styles.mediaViewerVideoThumb}><Text style={styles.mediaViewerVideoThumbText}>▶</Text></View>}</TouchableOpacity>)}
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

        <Modal visible={forwardPickerOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!forwardingMessages) { setForwardPickerOpen(false); setSelectedMessageIds([]); setSelectedForwardConversationIds([]); } }}>
          <View style={styles.forwardPickerBackdrop}>
            <View style={styles.forwardPickerCard}>
              <View style={styles.forwardPickerHeader}>
                <View><Text style={styles.forwardPickerTitle}>Forward messages</Text><Text style={styles.forwardPickerSubtitle}>Choose one or more Chitthi conversations</Text></View>
                <TouchableOpacity style={styles.attachmentPreviewClose} disabled={forwardingMessages} onPress={() => { setForwardPickerOpen(false); setSelectedMessageIds([]); setSelectedForwardConversationIds([]); }} accessibilityLabel="Close forward picker"><Text style={styles.attachmentPreviewCloseText}>×</Text></TouchableOpacity>
              </View>
              {forwardingMessages ? <View style={styles.forwardSecureProgress} accessibilityRole="progressbar" accessibilityLabel={forwardingStatus || "Forwarding securely"}><ActivityIndicator size="small" color="#71e39b" /><View style={styles.forwardSecureProgressCopy}><Text style={styles.forwardSecureProgressTitle}>Forwarding securely</Text><Text style={styles.forwardSecureProgressText} numberOfLines={2}>{forwardingStatus}</Text></View></View> : null}
              <ScrollView style={styles.forwardPickerList}>
                {personConversations.filter((conversation) => conversation.id !== activeConversationId).map((conversation) => {
                  const selected = selectedForwardConversationIds.includes(conversation.id);
                  return <TouchableOpacity key={conversation.id} disabled={forwardingMessages} style={[styles.forwardPickerRow, selected && styles.forwardPickerRowSelected]} onPress={() => toggleForwardConversation(conversation.id)}>
                    <View style={styles.forwardPickerAvatar}><InitialsAvatar photoUrl={conversationAvatarUrl(conversation, currentUserId, data?.user?.profilePhotoUrl, data?.user?.name)} label={conversation.otherName || conversation.subject} imageStyle={styles.forwardPickerAvatarImage} textStyle={styles.forwardPickerAvatarText} /></View>
                    <View style={styles.forwardPickerCopy}><Text style={styles.forwardPickerName} numberOfLines={1}>{conversation.otherName || conversation.subject}</Text><Text style={styles.forwardPickerMeta} numberOfLines={1}>{conversation.communityId ? "Group" : conversation.lastMessage || "Chitthi conversation"}</Text></View>
                    <View style={[styles.forwardPickerCheck, selected && styles.forwardPickerCheckSelected]}><Text style={styles.forwardPickerCheckText}>{selected ? "✓" : ""}</Text></View>
                  </TouchableOpacity>;
                })}
                {!personConversations.filter((conversation) => conversation.id !== activeConversationId).length ? <Text style={styles.forwardPickerEmpty}>No other conversations yet.</Text> : null}
              </ScrollView>
              <TouchableOpacity style={[styles.forwardPickerSubmit, (!selectedForwardConversationIds.length || forwardingMessages) && styles.forwardPickerSubmitDisabled]} disabled={!selectedForwardConversationIds.length || forwardingMessages} onPress={() => void forwardSelectedMessages()}>
                {forwardingMessages ? <ActivityIndicator size="small" color="#fff" /> : null}<Text style={styles.forwardPickerSubmitText}>{forwardingMessages ? "Forwarding securely…" : `Forward to ${selectedForwardConversationIds.length || "chat"}`}</Text>
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
              <View style={styles.attachmentPanelHeader}><Text style={styles.attachmentPanelTitle}>{richComposer === "EVENT" ? "Create event" : "Share contact"}</Text><TouchableOpacity style={styles.attachmentClose} onPress={() => setRichComposer("")} accessibilityLabel={`Close ${richComposer === "EVENT" ? "event" : "contact"} composer`}><Text style={styles.attachmentCloseText}>×</Text></TouchableOpacity></View>
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
            <View style={styles.attachmentPanelHeader}><Text style={styles.attachmentPanelTitle}>Chat wallpaper</Text><TouchableOpacity style={styles.attachmentClose} onPress={() => setWallpaperPanelOpen(false)} accessibilityLabel="Close chat wallpaper"><Text style={styles.attachmentCloseText}>×</Text></TouchableOpacity></View>
            <Text style={styles.wallpaperHelp}>Only you will see this wallpaper.</Text>
            <View style={styles.wallpaperGrid}>
              {wallpaperChoices.map((choice) => <TouchableOpacity key={choice.id} style={[styles.wallpaperChoice, { backgroundColor: choice.color }, wallpaper === choice.id && styles.wallpaperChoiceSelected]} onPress={() => void applyWallpaper(choice.id)} accessibilityRole="button" accessibilityState={{ selected: wallpaper === choice.id }}><View style={[styles.wallpaperChoiceGlow, { backgroundColor: choice.accent }]} /><Text style={styles.wallpaperChoiceLabel}>{choice.label}</Text></TouchableOpacity>)}
              <TouchableOpacity style={[styles.wallpaperChoice, styles.customWallpaperChoice, wallpaper === "custom" && styles.wallpaperChoiceSelected]} onPress={() => void chooseCustomWallpaper()}>{customWallpaper ? <Image source={{ uri: customWallpaper }} style={styles.customWallpaperPreview} /> : <Text style={styles.customWallpaperPlus}>＋</Text>}<Text style={styles.wallpaperChoiceLabel}>Your photo</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.wallpaperReset} onPress={() => void applyWallpaper("midnight")}><Text style={styles.wallpaperResetText}>Reset to default</Text></TouchableOpacity>
          </View>
        ) : null}

        {attachmentStatus ? <View style={styles.attachmentStatus}><Text style={styles.attachmentStatusText}>{attachmentStatus}</Text>{attachmentCryptoAbortRef.current ? <TouchableOpacity onPress={() => attachmentCryptoAbortRef.current?.abort()} accessibilityLabel="Cancel media processing"><Text style={styles.attachmentStatusCancel}>Cancel</Text></TouchableOpacity> : null}</View> : null}

        {pendingImages.length ? (
          <TouchableOpacity style={styles.pendingAttachmentCard} onPress={() => setPendingPhotoPreviewOpen(true)} activeOpacity={0.84} accessibilityLabel={`Preview ${pendingImages.length} selected photos`}>
            <View style={styles.pendingCollagePreview}>
              {pendingImages.slice(0, 4).map((image, index) => <View key={`${image.uri}-${index}`} style={styles.pendingCollageCell}><PendingPhotoPreview uri={image.uri} compact />{index === 3 && pendingImages.length > 4 ? <View style={styles.pendingCollageMore}><Text style={styles.pendingCollageMoreText}>+{pendingImages.length - 3}</Text></View> : null}</View>)}
            </View>
            <View style={styles.pendingAttachmentCopy}><Text style={styles.pendingAttachmentName}>{pendingImages.length} photos selected</Text><Text style={styles.pendingAttachmentMeta}>Collage ready to send</Text></View>
            <TouchableOpacity style={styles.pendingAttachmentRemove} onPress={() => { releasePendingAttachments(pendingImages); setPendingImages([]); }} accessibilityLabel="Remove selected photos"><Text style={styles.pendingAttachmentRemoveText}>×</Text></TouchableOpacity>
          </TouchableOpacity>
        ) : pendingAttachment ? (
          <View style={styles.pendingAttachmentCard}>
            {pendingAttachment.kind === "IMAGE" ? <PendingPhotoPreview uri={pendingAttachment.uri} /> : pendingAttachment.kind === "VIDEO" ? <View style={styles.pendingVideoPreview}>{pendingAttachment.thumbnailBase64 ? <Image source={{ uri: `data:image/jpeg;base64,${pendingAttachment.thumbnailBase64}` }} style={styles.pendingVideoThumbnail} /> : null}<View style={styles.pendingVideoPlayBadge}><Text style={styles.pendingVideoPreviewText}>▶</Text></View></View> : <View style={[styles.attachmentIcon, styles.fileIcon, styles.pendingAttachmentFileIcon]}><Text style={styles.attachmentIconText}>▰</Text></View>}
            <View style={styles.pendingAttachmentCopy}><Text style={styles.pendingAttachmentName} numberOfLines={1}>{pendingAttachment.kind === "IMAGE" ? "Photo selected" : pendingAttachment.kind === "VIDEO" ? "Video selected" : pendingAttachment.name}</Text><Text style={styles.pendingAttachmentMeta}>{pendingAttachment.kind === "IMAGE" ? "Ready to send" : pendingAttachment.kind === "VIDEO" ? `${(pendingAttachment.size / 1_000_000).toFixed(1)} MB · ${pendingAttachment.videoQuality === "data-saver" ? "Data saver" : "HD"}` : `${Math.max(1, Math.round(pendingAttachment.size / 1024))} KB · Ready to send`}</Text>{pendingAttachment.kind === "VIDEO" && Platform.OS === "ios" && FairFaresCrypto.videoOptimizationAvailable ? <View style={styles.videoQualityChoices}><TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: pendingAttachment.videoQuality !== "data-saver" }} accessibilityLabel="HD video quality" style={[styles.videoQualityChoice, pendingAttachment.videoQuality !== "data-saver" && styles.videoQualityChoiceSelected]} onPress={() => setPendingAttachment((current) => current?.kind === "VIDEO" ? { ...current, videoQuality: "original" } : current)}><Text style={[styles.videoQualityChoiceText, pendingAttachment.videoQuality !== "data-saver" && styles.videoQualityChoiceTextSelected]}>HD</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: pendingAttachment.videoQuality === "data-saver" }} accessibilityLabel="Data saver video quality" style={[styles.videoQualityChoice, pendingAttachment.videoQuality === "data-saver" && styles.videoQualityChoiceSelected]} onPress={() => setPendingAttachment((current) => current?.kind === "VIDEO" ? { ...current, videoQuality: "data-saver" } : current)}><Text style={[styles.videoQualityChoiceText, pendingAttachment.videoQuality === "data-saver" && styles.videoQualityChoiceTextSelected]}>Data saver</Text></TouchableOpacity></View> : null}</View>
            <TouchableOpacity style={styles.pendingAttachmentRemove} onPress={() => { releasePendingAttachments(pendingAttachment ? [pendingAttachment] : []); setPendingAttachment(null); }} accessibilityLabel="Remove selected attachment"><Text style={styles.pendingAttachmentRemoveText}>×</Text></TouchableOpacity>
          </View>
        ) : null}

        {typingPeople.length ? (
          <View style={styles.chittiTypingIndicator} accessibilityLiveRegion="polite">
            <View style={styles.chittiTypingMascotWrap}>
              <Image source={appAssets.chittiMascot} style={styles.chittiTypingMascot} resizeMode="contain" />
            </View>
            <Text style={styles.chittiTypingText} numberOfLines={1}>
              <Text style={styles.chittiTypingName}>{typingPeople.map((person) => {
                const firstName = person.name.trim().split(/\s+/)[0] || "Someone";
                return firstName.charAt(0).toUpperCase() + firstName.slice(1);
              }).join(", ")}</Text> {typingPeople.length === 1 ? "is" : "are"} typing
              <Text style={styles.chittiTypingDots}>…</Text>
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

        {!messageText.trim() && !typingPeople.length && !pendingAttachment && !pendingImages.length && !editingMessageId && !emojiPickerOpen ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickReplies} contentContainerStyle={styles.quickRepliesContent}>
            {[`Hi, ${(activeConversation?.otherName || "there").split(" ")[0]}`, `Hello, ${(activeConversation?.otherName || "there").split(" ")[0]}`, "👍"].map((reply) => <TouchableOpacity key={reply} style={styles.quickReply} onPress={() => setMessageText(reply)}><Text style={styles.quickReplyText}>{reply}</Text></TouchableOpacity>)}
          </ScrollView>
        ) : null}

        <View style={styles.composerDock}>
          {privateReplyContext ? <View style={styles.replyComposerPreview}><View style={styles.replyComposerBar} /><View style={styles.replyComposerCopy}><Text style={styles.replyComposerName}>{`Private reply · ${privateReplyContext.groupName}`}</Text><Text style={styles.replyComposerText} numberOfLines={2}>{`${privateReplyContext.senderName}: ${privateReplyContext.text}`}</Text></View><TouchableOpacity onPress={() => setPrivateReplyContext(null)} accessibilityLabel="Cancel private reply"><Text style={styles.replyComposerClose}>×</Text></TouchableOpacity></View> : null}
          {replyingTo ? <View style={styles.replyComposerPreview}><View style={styles.replyComposerBar} /><View style={styles.replyComposerCopy}><Text style={styles.replyComposerName}>{replyingTo.mine ? "You" : replyingTo.senderName}</Text><Text style={styles.replyComposerText} numberOfLines={1}>{replyMediaKind(replyingTo) || shareableMessageText({ ...replyingTo, senderName: "" }) || "Message"}</Text></View>{replyMediaKind(replyingTo) ? <ReplyMediaPreview message={replyingTo} /> : null}<TouchableOpacity onPress={() => setReplyingTo(null)} accessibilityLabel="Cancel reply"><Text style={styles.replyComposerClose}>×</Text></TouchableOpacity></View> : null}
          <View style={styles.composer}>
          {editingMessageId ? (
            <TouchableOpacity style={styles.editCancelIcon} onPress={() => { setEditingMessageId(null); setMessageText(""); }} accessibilityLabel="Cancel editing"><Text style={styles.editCancelIconText}>×</Text></TouchableOpacity>
          ) : <>
            <TouchableOpacity style={styles.composerIcon} onPress={showComposerOptions} accessibilityLabel="Add attachment"><Text style={styles.paperclipIcon}>📎</Text></TouchableOpacity>
            <TouchableOpacity style={styles.composerEmoji} onPress={toggleEmojiPicker} accessibilityLabel="Choose emoji"><Text style={styles.composerEmojiText}>☺</Text></TouchableOpacity>
          </>}
          <TextInput
            placeholder={editingMessageId ? "Edit message" : "Write a message…"}
            placeholderTextColor="#a7a08d"
            style={styles.composerInput}
            value={messageText}
            onChangeText={handleMessageTextChange}
            onFocus={() => {
              if (emojiPickerOpen) setEmojiPickerOpen(false);
              shouldAutoScrollToEndRef.current = true;
            }}
            multiline
          />
          <TouchableOpacity accessibilityLabel={pendingAttachment || pendingImages.length ? "Send attachment" : "Send message"} style={[styles.composerSend, threadLoading && styles.sendDisabled]} onPress={sendMessage} disabled={threadLoading}>
            {editingMessageId ? <Text style={styles.composerSendText}>✓</Text> : <SendIcon />}
          </TouchableOpacity>
          </View>
        </View>
        {Platform.OS === "ios" && safeAreaInsets.bottom > 0 ? <View pointerEvents="none" style={[styles.composerSafeArea, { height: safeAreaInsets.bottom }]} /> : null}
        </ThreadKeyboardBody>
        </View>
        <Modal visible={contactPickerOpen && contactPickerMode === "add"} transparent animationType="fade" onRequestClose={() => setContactPickerOpen(false)}>
          <View style={styles.contactPickerBackdrop}>
            <View style={styles.contactPickerCard}>
              <View style={styles.contactPickerHeader}>
                <View style={styles.contactPickerHeadingCopy}><Text style={styles.contactPickerTitle}>Add members</Text><Text style={styles.contactPickerSubtitle}>Select FairFares contacts to add to this group</Text></View>
                <TouchableOpacity style={styles.contactPickerClose} onPress={() => setContactPickerOpen(false)} accessibilityLabel="Close contacts"><Text style={styles.contactPickerCloseText}>×</Text></TouchableOpacity>
              </View>
              {contactsLoading && !contactMatches.length ? <View style={styles.contactSectionEmpty}><ActivityIndicator color={theme.colors.brand} /><Text style={styles.contactSectionEmpty}>Checking your FairFares contacts…</Text></View> : null}
              <ScrollView style={styles.contactPickerList} contentContainerStyle={styles.contactPickerListContent} showsVerticalScrollIndicator={false}>
                {!contactsLoading && !contactMatches.length ? <Text style={styles.contactSectionEmpty}>No registered contacts matched yet.</Text> : null}
                {contactMatches.map((person) => <TouchableOpacity key={`thread-contact-picker-${person.id}`} style={[styles.contactPickerRow, selectedGroupPeople.includes(person.id) && styles.contactPickerRowSelected]} onPress={() => toggleGroupPerson(person.id)}><View style={styles.avatar}><InitialsAvatar photoUrl={person.photoUrl} label={person.localName} imageStyle={styles.avatarImage} textStyle={styles.avatarText} /></View><View style={styles.chatCopy}><Text style={styles.chatName}>{person.localName}</Text><Text style={styles.chatLast}>{person.name !== person.localName ? `${person.name} · FairFares member` : "FairFares member"}</Text></View><View style={styles.contactPickerMessageButton}><Text style={styles.contactPickerMessageText}>{selectedGroupPeople.includes(person.id) ? "Selected" : "Add"}</Text></View></TouchableOpacity>)}
              </ScrollView>
              <TouchableOpacity style={[styles.primaryButton, !selectedGroupPeople.length && styles.disabledButton]} disabled={!selectedGroupPeople.length || contactsLoading} onPress={() => void addSelectedPeopleToExistingGroup()}><Text style={styles.primaryButtonText}>{contactsLoading ? "Checking…" : `Add ${selectedGroupPeople.length} ${selectedGroupPeople.length === 1 ? "person" : "people"}`}</Text></TouchableOpacity>
              <Text style={styles.contactPickerPrivacy}>Phone numbers stay private and are never displayed.</Text>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={[
      styles.screen,
      isLight && styles.screenLight,
      Platform.OS === "android" && styles.screenAndroid,
      layout.isTablet && { maxWidth: layout.contentMaxWidth, width: "100%", alignSelf: "center" }
    ]}>
      <View pointerEvents="none" style={[styles.chittiBackdrop, isLight && styles.chittiBackdropLight]}>
        <View style={styles.chittiGlowTop} />
        <View style={styles.chittiGlowBottom} />
      </View>
      <View style={[styles.header, isLight && styles.headerLight]}>
        <View style={styles.chittiHeaderMascotWrap}>
          <Image source={appAssets.chittiMascot} style={styles.chittiHeaderMascot} resizeMode="contain" />
          {(data?.chat.unreadCount || 0) > 0 ? <Text style={styles.chittiHeaderBadge}>{data?.chat.unreadCount}</Text> : null}
        </View>
        <View style={[styles.chatBrandWrap, isLight && styles.chatBrandWrapLight]}>
          <Image source={appAssets.chittiLettersGold} style={styles.chittiBrandPaper} resizeMode="contain" />
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity
            style={[styles.headerIcon, isLight && styles.headerControlLight]}
            accessibilityRole="button"
            accessibilityLabel="Chitthi options"
            onPress={() => Alert.alert("Chitthi", "Choose an inbox action.", [
              { text: "Refresh inbox", onPress: () => void refreshMessenger() },
              { text: "Find contacts", onPress: () => void findPeopleFromContacts() },
              { text: "Create group", onPress: () => setCreatingGroup(true) },
              { text: "Cancel", style: "cancel" },
            ])}
          ><Text style={[styles.headerIconText, isLight && styles.headerIconTextLight]}>•••</Text></TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.iconButton, isLight && styles.headerControlLight]}
          onPress={() => (signedIn ? setCreatingGroup((value) => !value) : onRequireLogin())}
          accessibilityLabel="Create a Chitthi group"
        >
          <Text style={[styles.iconButtonText, isLight && styles.headerIconTextLight]}>✐</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          placeholder="Search people, groups, or city"
          placeholderTextColor={theme.colors.muted}
          style={[styles.search, styles.searchInput, isLight && styles.searchLight]}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={handleMessengerSearchSubmit}
          returnKeyType="search"
          autoCapitalize="none"
        />
        {search.length ? (
          <TouchableOpacity
            style={styles.searchClear}
            onPress={() => setSearch("")}
            accessibilityRole="button"
            accessibilityLabel="Clear Chitthi search"
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <Text style={styles.searchClearText}>×</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/(?:group_invite|community_id)=/.test(search.trim()) ? <TouchableOpacity style={styles.searchAction} onPress={handleMessengerSearchSubmit}><Text style={styles.searchActionText}>Open group invitation</Text></TouchableOpacity> : null}
      {search.replace(/\D/g, "").length >= 10 && !/(?:group_invite|community_id)=/.test(search) ? <TouchableOpacity style={styles.searchAction} onPress={handleMessengerSearchSubmit}><Text style={styles.searchActionText}>Message this FairFares member</Text></TouchableOpacity> : null}
      {search.trim().length >= 2 && search.replace(/\D/g, "").length < 10 && !/(?:group_invite|community_id)=/.test(search) ? <TouchableOpacity style={styles.searchAction} onPress={handleMessengerSearchSubmit}><Text style={styles.searchActionText}>Show groups near {search.trim()}</Text></TouchableOpacity> : null}

      <View style={styles.tabs}>
        {(["All", "Unread", "Groups", "Communities", "Contacts"] as MessengerTab[]).map((item) => (
          <TouchableOpacity key={item} onPress={() => { setTab(item); if (item === "Contacts") void findPeopleFromContacts(); }} style={[styles.tab, isLight && styles.tabLight, tab === item && styles.activeTab, isLight && tab === item && styles.activeTabLight]} accessibilityRole="tab" accessibilityState={{ selected: tab === item }}>
            <Text style={[styles.tabText, isLight && styles.tabTextLight, tab === item && styles.activeTabText, isLight && tab === item && styles.activeTabTextLight]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Modal visible={contactPickerOpen} transparent animationType="fade" onRequestClose={() => setContactPickerOpen(false)}>
        <View style={styles.contactPickerBackdrop}>
          <View style={[styles.contactPickerCard, isLight && styles.contactPickerCardLight]}>
            <View style={[styles.contactPickerHeader, isLight && styles.contactPickerHeaderLight]}>
              <View style={styles.contactPickerHeadingCopy}>
                <Text style={[styles.contactPickerTitle, isLight && styles.contactPickerTitleLight]}>{contactPickerMode === "chat" ? "Your contacts" : "Contacts on FairFares"}</Text>
                <Text style={[styles.contactPickerSubtitle, isLight && styles.contactPickerSubtitleLight]}>{contactPickerMode === "chat" ? "Message registered contacts or invite others" : "Select FairFares members to add"}</Text>
              </View>
              <TouchableOpacity style={styles.contactPickerClose} onPress={() => setContactPickerOpen(false)} accessibilityLabel="Close contacts">
                <Text style={styles.contactPickerCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.contactPickerList} contentContainerStyle={styles.contactPickerListContent} showsVerticalScrollIndicator={false}>
              <View style={[styles.contactSectionHeader, isLight && styles.contactSectionHeaderLight]}>
                <Text style={styles.contactSectionTitle}>ON FAIRFARES</Text>
                <Text style={[styles.contactSectionCount, isLight && styles.contactSectionCountLight]}>{contactsLoading ? "Refreshing…" : contactMatches.length}</Text>
              </View>
              {contactMatches.map((person) => (
                <TouchableOpacity key={`contact-picker-${person.id}`} style={[styles.contactPickerRow, isLight && styles.contactPickerRowLight, contactPickerMode !== "chat" && selectedGroupPeople.includes(person.id) && styles.contactPickerRowSelected]} onPress={() => contactPickerMode === "chat" ? void openContactChat(person) : toggleGroupPerson(person.id)}>
                  <View style={styles.avatar}>
                    <InitialsAvatar photoUrl={person.photoUrl} label={person.localName} imageStyle={styles.avatarImage} textStyle={styles.avatarText} />
                  </View>
                  <View style={styles.chatCopy}>
                    <Text style={[styles.chatName, isLight && styles.chatNameLight]}>{person.localName}</Text>
                    <Text style={[styles.chatLast, isLight && styles.chatLastLight]}>{person.name !== person.localName ? `${person.name} · FairFares member` : "FairFares member"}</Text>
                  </View>
                  <View style={styles.contactPickerMessageButton}><Text style={styles.contactPickerMessageText}>{contactPickerMode === "chat" ? "Message" : selectedGroupPeople.includes(person.id) ? "Selected" : "Add"}</Text></View>
                </TouchableOpacity>
              ))}
              {!contactMatches.length ? <Text style={styles.contactSectionEmpty}>No registered contacts matched yet.</Text> : null}
              {contactPickerMode === "chat" ? (
                <>
                  <View style={[styles.contactSectionHeader, isLight && styles.contactSectionHeaderLight]}>
                    <Text style={styles.contactSectionTitle}>INVITE TO FAIRFARES</Text>
                    <Text style={styles.contactSectionCount}>{inviteContacts.length}</Text>
                  </View>
                  {inviteContacts.map((contact) => (
                    <TouchableOpacity key={`invite-contact-${contact.id}`} style={[styles.contactPickerRow, isLight && styles.contactPickerRowLight]} onPress={() => void invitePhoneContact(contact)}>
                      <View style={styles.inviteContactAvatar}><Text style={styles.inviteContactAvatarText}>{initials(contact.name)}</Text></View>
                      <View style={styles.chatCopy}>
                        <Text style={[styles.chatName, isLight && styles.chatNameLight]}>{contact.name}</Text>
                        <Text style={[styles.chatLast, isLight && styles.chatLastLight]}>Not on FairFares yet</Text>
                      </View>
                      <View style={styles.inviteContactButton}><Text style={styles.inviteContactButtonText}>Invite</Text></View>
                    </TouchableOpacity>
                  ))}
                  {!inviteContacts.length ? <Text style={styles.contactSectionEmpty}>All available phone contacts are already on FairFares.</Text> : null}
                </>
              ) : null}
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
            <Text style={[styles.contactPickerPrivacy, isLight && styles.contactPickerPrivacyLight]}>Phone numbers stay private and are never displayed.</Text>
          </View>
        </View>
      </Modal>

      {!signedIn ? (
        <GuestCommunityLetters onRequireSignup={onRequireSignup || onRequireLogin} />
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
          <TouchableOpacity style={styles.groupPeoplePicker} onPress={() => void findPeopleFromContacts("create")} disabled={contactsLoading} accessibilityRole="button" accessibilityLabel="Add people to new group" accessibilityState={{ disabled: contactsLoading }}>
            <Text style={styles.groupPeoplePickerIcon}>＋</Text>
            <View style={styles.groupPeoplePickerCopy}>
              <Text style={styles.groupPeoplePickerTitle}>{selectedGroupPeople.length ? `${selectedGroupPeople.length} people selected` : "Add people"}</Text>
              <Text style={styles.groupPeoplePickerMeta}>Choose FairFares members from your contacts</Text>
            </View>
            <Text style={styles.groupPeoplePickerArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={createGroup} disabled={loading} accessibilityRole="button" accessibilityLabel="Create group and add people" accessibilityState={{ disabled: loading }}>
            <Text style={styles.primaryButtonText}>{loading ? "Creating..." : "Create group and add people"}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        style={[styles.list, isLight && styles.listLight]}
        data={(tab === "All" || tab === "Unread" || tab === "Groups") ? filteredConversations : []}
        keyExtractor={(chat) => chat.id}
        contentContainerStyle={[styles.listContent, isLight && styles.listContentLight, { paddingBottom: layout.navClearance }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} tintColor={theme.colors.text} onRefresh={refreshMessenger} />}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        removeClippedSubviews={Platform.OS === "android"}
        onEndReachedThreshold={0.25}
        onEndReached={() => { if ((tab === "All" || tab === "Unread" || tab === "Groups") && hasMoreConversations) void loadMoreConversations(); }}
        ListHeaderComponent={<>
        {tab === "All" && !feedbackCardDismissed ? (
          <TouchableOpacity style={[styles.feedbackChatCard, isLight && styles.feedbackChatCardLight]} onPress={() => void openFeedbackChat()} disabled={loading}>
            <View style={styles.feedbackChatAvatar}><Text style={styles.feedbackChatAvatarText}>SR</Text></View>
            <View style={styles.chatCopy}>
              <Text style={[styles.feedbackChatEyebrow, isLight && styles.feedbackChatEyebrowLight]}>ISSUES &amp; SUGGESTIONS</Text>
              <Text style={[styles.feedbackChatName, isLight && styles.feedbackChatNameLight]}>Sriram Reddy Bandari</Text>
              <Text style={[styles.feedbackChatCopy, isLight && styles.feedbackChatCopyLight]} numberOfLines={1}>Share an issue or suggestion with FairFares.</Text>
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
        </>}
        renderItem={({ item: chat }) => <ConversationListRow chat={chat} currentUserId={currentUserId} currentUserPhotoUrl={data?.user?.profilePhotoUrl} currentUserName={data?.user?.name} onOpen={handleOpenConversation} />}
        ListFooterComponent={<>

        {(tab === "All" || tab === "Groups" || tab === "Communities") && filteredCommunities.map((community) => (
          <TouchableOpacity key={community.id} style={[styles.chatRow, styles.communityRow, isLight && styles.chatRowLight]} onPress={() => openCommunityThread(community)}>
            <View style={[styles.avatar, styles.groupAvatar]}><InitialsAvatar photoUrl={community.photoUrl} label={community.name} imageStyle={styles.avatarImage} textStyle={styles.avatarText} /></View>
            <View style={styles.chatCopy}>
              <Text style={styles.chatKind}>{community.kind === "GROUP" ? "PUBLIC GROUP" : "COMMUNITY"}</Text>
              <Text style={[styles.chatName, isLight && styles.chatNameLight]}>{community.name}</Text>
              <Text style={[styles.chatLast, isLight && styles.chatLastLight]}>{community.description || community.area || "FairFares community"}</Text>
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
          <View style={[styles.groupSuggestionsSection, isLight && styles.groupSuggestionsSectionLight]}>
            <View style={styles.groupSuggestionsHeader}>
              <View style={styles.groupSuggestionsCopy}>
                <Text style={[styles.groupSuggestionsTitle, isLight && styles.groupSuggestionsTitleLight]}>Suggested groups</Text>
                <Text style={[styles.groupSuggestionsSubtitle, isLight && styles.groupSuggestionsSubtitleLight]}>Public groups near {suggestionCity.split(",", 1)[0] || "your location"}</Text>
              </View>
              <TouchableOpacity
                style={[styles.groupSuggestionsDismiss, isLight && styles.groupSuggestionsDismissLight]}
                accessibilityLabel="Dismiss suggested groups"
                onPress={() => setGroupSuggestionsDismissed(true)}
              >
                <Text style={[styles.groupSuggestionsDismissText, isLight && styles.groupSuggestionsDismissTextLight]}>×</Text>
              </TouchableOpacity>
            </View>
            {suggestedCommunities.map((community) => (
              <View key={`suggested-${community.id}`} style={[styles.suggestedGroupRow, isLight && styles.suggestedGroupRowLight]}>
                <View style={[styles.avatar, styles.groupAvatar]}><InitialsAvatar photoUrl={community.photoUrl} label={community.name} imageStyle={styles.avatarImage} textStyle={styles.avatarText} /></View>
                <View style={styles.chatCopy}>
                  <Text style={[styles.chatName, isLight && styles.chatNameLight]}>{community.name}</Text>
                  <Text style={[styles.chatLast, isLight && styles.chatLastLight]} numberOfLines={1}>{community.description || community.area || "Public FairFares group"}</Text>
                </View>
                <TouchableOpacity style={styles.suggestedJoinButton} onPress={() => void openCommunityThread(community)} accessibilityLabel={`Join ${community.name}`}><Text style={styles.suggestedJoinText}>Join</Text></TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
        </>}
      />
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
  screenLight: { backgroundColor: "#f3f4f6" },
  screenAndroid: { paddingTop: 10 },
  chittiBackdrop: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  chittiBackdropLight: { opacity: 0.06 },
  chittiGlowTop: { position: "absolute", width: 270, height: 270, borderRadius: 135, top: -120, right: -100, backgroundColor: "rgba(19,102,70,0.20)" },
  chittiGlowBottom: { position: "absolute", width: 240, height: 240, borderRadius: 120, bottom: 20, left: -140, backgroundColor: "rgba(3,76,55,0.13)" },
  threadScreen: { flex: 1, backgroundColor: "#D9E5DD", paddingTop: 0, paddingBottom: 0, position: "relative", overflow: "hidden" },
  threadScreenAndroid: { paddingBottom: 0 },
  threadKeyboardViewport: { flex: 1, position: "relative", overflow: "hidden" },
  threadKeyboardBody: { flex: 1, position: "relative", overflow: "visible" },
  wallpaperBase: { ...StyleSheet.absoluteFillObject },
  wallpaperImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  wallpaperShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.06)" },
  customWallpaperShade: { backgroundColor: "rgba(0,16,12,0.20)" },
  wallpaperGlow: { position: "absolute", width: 280, height: 280, borderRadius: 140, opacity: 0.18 },
  wallpaperGlowOne: { top: -90, right: -100 },
  wallpaperGlowTwo: { bottom: 90, left: -130 },
  wallpaperPattern: { position: "absolute", top: "47%", left: -20, color: "rgba(27,86,63,0.075)", fontSize: 25, letterSpacing: 13, transform: [{ rotate: "-12deg" }] },
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6 },
  headerLight: { backgroundColor: "#f3f4f6", marginHorizontal: -16, marginTop: -16, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 7, minHeight: 76, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(15,23,42,0.06)" },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  title: { color: theme.colors.text, ...theme.typography.screenTitle },
  chatBrandWrap: { flex: 1, minWidth: 0, height: 48, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  chatBrandWrapLight: { position: "absolute", left: 68, right: 68, height: 66, alignItems: "center", justifyContent: "center" },
  chatBrand: { width: 132, height: 42 },
  chittiHeaderMascotWrap: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  chittiHeaderMascot: { width: 34, height: 42 },
  chittiHeaderBadge: { position: "absolute", top: 0, right: -2, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, overflow: "hidden", backgroundColor: "#3cad50", color: "#fff", textAlign: "center", lineHeight: 22, fontSize: 11, fontWeight: "700" },
  chittiBrandPaper: { width: 220, height: 62 },
  headerIcons: { flexDirection: "row", gap: 6, marginLeft: "auto" },
  headerIcon: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: "rgba(239,189,104,0.65)", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(14,32,29,0.92)" },
  headerIconText: { color: "#efbd68", fontSize: 16, fontWeight: "700", letterSpacing: 1 },
  iconButton: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: "rgba(239,189,104,0.65)", backgroundColor: "rgba(14,32,29,0.92)", alignItems: "center", justifyContent: "center" },
  iconButtonText: { color: "#efbd68", fontSize: 20, fontWeight: "600", marginTop: -2 },
  headerControlLight: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#f0f2f5", borderColor: "transparent" },
  headerIconTextLight: { color: "#176b4a" },
  search: { backgroundColor: "rgba(15,29,28,0.98)", color: theme.colors.text, borderRadius: theme.radius.pill, borderWidth: 1.25, borderColor: "rgba(239,189,104,0.4)", paddingHorizontal: 17, minHeight: 54, fontSize: 15, fontWeight: "700" },
  searchLight: { backgroundColor: "#ffffff", borderColor: "rgba(15,23,42,0.06)", minHeight: 46, shadowColor: "#14251f", shadowOpacity: 0.07, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 2, fontWeight: "500" },
  searchRow: { position: "relative", flexDirection: "row", alignItems: "center", gap: 8, shadowColor: "#efbd68", shadowOpacity: 0.07, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  searchInput: { flex: 1, minWidth: 0, paddingRight: 52 },
  searchClear: { position: "absolute", right: 9, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(214,169,95,0.14)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(214,169,95,0.34)" },
  searchClearText: { color: "#E7C98F", fontSize: 25, lineHeight: 28, fontWeight: "500", marginTop: -2 },
  contactsButton: { minHeight: 48, paddingHorizontal: 10, borderRadius: 22, borderWidth: 1, borderColor: "rgba(57,143,77,0.20)", backgroundColor: "rgba(18,71,40,0.70)", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  contactsButtonIcon: { color: "#e9d7ad", fontSize: 17 },
  contactsButtonText: { color: "#f3ead6", fontSize: 12, fontWeight: "600" },
  searchAction: { alignSelf: "flex-start", marginTop: 7, marginLeft: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: "#132849" },
  searchActionText: { color: "#8fc2ff", fontSize: 13, fontWeight: "600" },
  contactPickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", padding: 18, justifyContent: "center" },
  contactPickerCard: { width: "100%", maxWidth: 520, maxHeight: "72%", alignSelf: "center", ...theme.depth.card, overflow: "hidden" },
  contactPickerCardLight: { backgroundColor: "#ffffff", borderColor: "#d8dadf", shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  contactPickerHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  contactPickerHeaderLight: { backgroundColor: "#ffffff", borderBottomColor: "#e4e6eb" },
  contactPickerHeadingCopy: { flex: 1, minWidth: 0 },
  contactPickerTitle: { color: theme.colors.text, ...theme.typography.sectionTitle },
  contactPickerTitleLight: { color: "#050505" },
  contactPickerSubtitle: { color: theme.colors.muted, ...theme.typography.caption, marginTop: 3 },
  contactPickerSubtitleLight: { color: "#65676b" },
  contactPickerClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center", marginLeft: 10 },
  contactPickerCloseText: { color: theme.colors.soft, fontSize: 25, lineHeight: 27 },
  contactPickerList: { flexGrow: 0 },
  contactPickerListContent: { paddingVertical: 4 },
  contactSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 7, backgroundColor: theme.colors.panel2 },
  contactSectionHeaderLight: { backgroundColor: "#f0f2f5" },
  contactSectionTitle: { color: theme.colors.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1.1 },
  contactSectionCount: { color: theme.colors.muted, fontSize: 11, fontWeight: "700" },
  contactSectionCountLight: { color: "#65676b" },
  contactSectionEmpty: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, paddingHorizontal: 16, paddingVertical: 18 },
  contactPickerRow: { minHeight: 72, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  contactPickerRowLight: { backgroundColor: "#ffffff", borderBottomColor: "#e4e6eb" },
  contactPickerRowSelected: { backgroundColor: "rgba(79,124,255,0.16)" },
  contactPickerMessageButton: { backgroundColor: theme.colors.blue, borderRadius: 17, paddingHorizontal: 12, paddingVertical: 8, marginLeft: 8 },
  contactPickerMessageText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  inviteContactAvatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line },
  inviteContactAvatarText: { color: theme.colors.soft, fontSize: 15, fontWeight: "800" },
  inviteContactButton: { borderRadius: 17, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 8, borderWidth: 1, borderColor: theme.colors.accent },
  inviteContactButtonText: { color: theme.colors.accent, fontSize: 12, fontWeight: "700" },
  contactPickerPrivacy: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 16, paddingVertical: 12 },
  contactPickerPrivacyLight: { color: "#65676b", backgroundColor: "#ffffff" },
  tabs: { flexDirection: "row", gap: 5, marginTop: 7, marginBottom: 8, width: "100%" },
  tab: { flex: 1, minWidth: 0, minHeight: 31, borderWidth: 1, borderColor: "rgba(226,181,101,0.22)", borderRadius: theme.radius.pill, paddingHorizontal: 2, paddingVertical: 6, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,18,17,0.50)" },
  tabLight: { backgroundColor: "#ffffff", borderColor: "rgba(15,23,42,0.05)", shadowColor: "#14251f", shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  activeTab: { backgroundColor: "rgba(31,101,52,0.72)", borderColor: "rgba(68,153,78,0.44)" },
  activeTabLight: { backgroundColor: "#dff3e9", borderColor: "transparent", shadowOpacity: 0, elevation: 0 },
  tabText: { color: "#e9e2d4", fontSize: 9.25, fontWeight: "500" },
  tabTextLight: { color: "#65676b" },
  activeTabText: { color: "#fff", fontWeight: "700" },
  activeTabTextLight: { color: "#176b4a" },
  loginGate: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, gap: 10 },
  loginGateLight: { backgroundColor: "#ffffff", borderColor: "rgba(15,23,42,0.08)", shadowColor: "#15251f", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  loginTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  loginTitleLight: { color: "#111827" },
  loginCopy: { color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
  loginCopyLight: { color: "#667085" },
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
  threadHeader: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, paddingTop: 7, paddingBottom: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(76,114,97,0.30)", backgroundColor: "#C4D9CE", overflow: "hidden" },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 24, height: 24, justifyContent: "center" },
  backLine: { position: "absolute", width: 18, height: 4, borderRadius: 3, backgroundColor: "#866525", left: 2 },
  backLineTop: { transform: [{ rotate: "-45deg" }], top: 6 },
  backLineBottom: { transform: [{ rotate: "45deg" }], bottom: 5 },
  threadAvatar: { width: 43, height: 43, borderRadius: 22, backgroundColor: "#173E2E", borderWidth: 1, borderColor: "rgba(214,169,95,0.62)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  threadAvatarImage: { width: "100%", height: "100%" },
  threadAvatarText: { color: "#f6e0ae", fontWeight: "700", fontSize: 15 },
  activeDot: { position: "absolute", right: 0, bottom: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: "#43c866", borderWidth: 2, borderColor: "#021c16" },
  threadHeaderCopy: { flex: 1 },
  threadHeaderTitle: { color: "#153D31", fontSize: 16.5, fontWeight: "700" },
  threadHeaderMeta: { color: "#4D675D", fontSize: 11.5, fontWeight: "500", marginTop: 2 },
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
  dotIcon: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#866525" },
  threadMessages: { flex: 1 },
  threadMessagesList: { flex: 1 },
  threadMessagesContent: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 10, gap: 2 },
  encryptionRecoveryWarning: { marginHorizontal: 10, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: "rgba(116,77,18,0.92)", borderWidth: 1, borderColor: "rgba(214,169,95,0.55)", zIndex: 3 },
  encryptionRecoveryWarningText: { color: "#F3E9D5", fontSize: 12, lineHeight: 17, fontWeight: "700", textAlign: "center" },
  jumpToLatestButton: { position: "absolute", right: 16, bottom: 18, width: 43, height: 43, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7,35,29,0.94)", borderWidth: 1, borderColor: "rgba(214,169,95,0.55)", shadowColor: "#000", shadowOpacity: 0.26, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  jumpToLatestButtonText: { color: "#F4D99E", fontSize: 30, lineHeight: 32, fontWeight: "900", marginTop: -6 },
  threadListFooter: { overflow: "visible" },
  threadListEmpty: { minHeight: 360, flexGrow: 1, alignItems: "center", justifyContent: "center" },
  olderMessagesStatusWrap: { alignItems: "center", marginBottom: 8 },
  olderMessagesStatus: { color: theme.colors.muted, textAlign: "center", fontSize: 12, fontWeight: "800", paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: "rgba(3,16,15,0.82)", overflow: "hidden" },
  olderMessagesButton: { alignSelf: "center", minHeight: 38, justifyContent: "center", paddingHorizontal: 16, marginBottom: 8, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.06)" },
  olderMessagesButtonText: { color: theme.colors.soft, fontSize: 12, fontWeight: "900" },
  threadMessageCell: { overflow: "visible" },
  threadMessageRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-start", gap: 5, position: "relative", overflow: "visible" },
  threadMessageRowMine: { justifyContent: "flex-end" },
  threadMessageRunEnd: { marginBottom: 7 },
  highlightedMessageRow: { borderRadius: 16, backgroundColor: "rgba(214,169,95,0.24)" },
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
  composerDock: { position: "relative", zIndex: 34, elevation: 18, overflow: "visible" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 5, paddingHorizontal: 8, paddingTop: 7, paddingBottom: Platform.OS === "ios" ? 8 : 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#B6CABD", backgroundColor: "rgba(244,248,245,0.98)", overflow: "hidden" },
  composerSafeArea: { backgroundColor: "rgba(244,248,245,0.98)" },
  composerIcon: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  paperclipIcon: { color: "#6E6040", fontSize: 24 },
  composerEmoji: { width: 32, height: 40, alignItems: "center", justifyContent: "center" },
  composerEmojiText: { color: "#6E6040", fontSize: 25, lineHeight: 28 },
  replyComposerPreview: { position: "absolute", left: 8, right: 8, bottom: "100%", minHeight: 58, zIndex: 35, elevation: 19, flexDirection: "row", alignItems: "center", gap: 9, paddingLeft: 10, paddingRight: 6, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: "#B6CABD", borderRadius: 14, backgroundColor: "rgba(248,251,249,0.99)", shadowColor: "#234238", shadowOpacity: 0.16, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } },
  replyComposerBar: { width: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: "#D6A95F" },
  replyComposerCopy: { flex: 1, minWidth: 0 },
  replyComposerName: { color: "#27674F", fontSize: 12, fontWeight: "900", marginBottom: 2 },
  replyComposerText: { color: "#3F554C", fontSize: 13, fontWeight: "600" },
  replyComposerClose: { width: 32, height: 32, color: "#52645D", fontSize: 26, lineHeight: 31, textAlign: "center" },
  replyMediaThumbnail: { width: 46, height: 46, borderRadius: 8, backgroundColor: "#173d32" },
  replyMediaFallback: { width: 46, height: 46, borderRadius: 8, backgroundColor: "rgba(214,169,95,0.14)", alignItems: "center", justifyContent: "center" },
  replyMediaFallbackText: { color: "#F4D99E", fontSize: 20, fontWeight: "800" },
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
  chittiTypingIndicator: { minHeight: 32, marginLeft: 12, marginTop: 2, marginBottom: 2, paddingRight: 11, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.72)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(23,107,74,0.16)", alignSelf: "flex-start", maxWidth: "82%", flexDirection: "row", alignItems: "center", gap: 5, zIndex: 3 },
  chittiTypingMascotWrap: { width: 31, height: 34, marginTop: 5, overflow: "hidden" },
  chittiTypingMascot: { width: "100%", height: "100%" },
  chittiTypingText: { flexShrink: 1, color: "#52665d", fontSize: 12.5, fontWeight: "500" },
  chittiTypingName: { color: "#174f3a", fontWeight: "800" },
  chittiTypingDots: { color: "#176b4a", letterSpacing: 1.5 },
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
  attachmentStatus: { position: "absolute", bottom: 66, alignSelf: "center", backgroundColor: "rgba(15,23,42,0.94)", borderRadius: 18, paddingHorizontal: 15, paddingVertical: 9, zIndex: 30, flexDirection: "row", alignItems: "center", gap: 10 },
  attachmentStatusText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  attachmentStatusCancel: { color: "#ffb4b4", fontWeight: "900", fontSize: 12 },
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
  videoPlaybackError: { alignItems: "center", justifyContent: "center", padding: 28, gap: 10 },
  videoPlaybackErrorText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  videoPlaybackErrorDetail: { color: "#bbb", fontSize: 13, lineHeight: 19, textAlign: "center" },
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
  forwardSecureProgress: { marginHorizontal: 14, marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: "rgba(113,227,155,0.34)", backgroundColor: "rgba(24,185,132,0.12)", paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  forwardSecureProgressCopy: { flex: 1, minWidth: 0 },
  forwardSecureProgressTitle: { color: "#71e39b", fontSize: 13, fontWeight: "700" },
  forwardSecureProgressText: { color: theme.colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
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
  forwardPickerSubmit: { minHeight: 48, marginHorizontal: 14, marginTop: 13, borderRadius: 24, backgroundColor: theme.colors.blue, flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "center" },
  forwardPickerSubmitDisabled: { opacity: 0.42 },
  forwardPickerSubmitText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  contactShareArrow: { color: "#8fb5ff", fontSize: 28, fontWeight: "400" },
  contactSharePrivacy: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 16, paddingTop: 12 },
  pendingAttachmentCard: { minHeight: 68, borderRadius: 16, backgroundColor: "rgba(247,249,253,0.97)", borderWidth: 1, borderColor: "#d6dce7", padding: 8, marginTop: 6, marginHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  pendingAttachmentImage: { width: 72, height: 72, borderRadius: 12, backgroundColor: "#dde3ec" },
  pendingVideoPreview: { width: 72, height: 72, borderRadius: 12, backgroundColor: "#20252d", alignItems: "center", justifyContent: "center" },
  pendingVideoThumbnail: { ...StyleSheet.absoluteFillObject, width: 72, height: 72, borderRadius: 12 },
  pendingVideoPlayBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.56)", alignItems: "center", justifyContent: "center" },
  pendingVideoPreviewText: { color: "#fff", fontSize: 18, marginLeft: 2 },
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
  videoQualityChoices: { flexDirection: "row", gap: 6, marginTop: 7 },
  videoQualityChoice: { minHeight: 26, paddingHorizontal: 9, borderRadius: 13, borderWidth: 1, borderColor: "#c8cfda", alignItems: "center", justifyContent: "center" },
  videoQualityChoiceSelected: { backgroundColor: "#177653", borderColor: "#177653" },
  videoQualityChoiceText: { color: "#526071", fontSize: 10, fontWeight: "800" },
  videoQualityChoiceTextSelected: { color: "#fff" },
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
  composerInput: { flex: 1, color: "#18342A", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#B6CABD", borderRadius: 21, paddingHorizontal: 14, paddingVertical: 9, minHeight: 40, maxHeight: 110, fontSize: 16 },
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
  selectedCollageCell: { borderWidth: 2, borderColor: "#4f7cff" },
  collageSelectionCheck: { position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: "#356df3", borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center", zIndex: 8 },
  messageSelectionCheck: { position: "absolute", top: -9, right: -9, width: 22, height: 22, borderRadius: 11, backgroundColor: "#356df3", borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center", zIndex: 5 },
  messageSelectionCheckText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  myBubble: { backgroundColor: "#176B4A", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(80,174,126,0.65)", alignSelf: "flex-end", borderBottomRightRadius: 2 },
  theirBubble: { backgroundColor: "#F2E8D3", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(183,145,78,0.42)", alignSelf: "flex-start", borderBottomLeftRadius: 2 },
  bubbleTail: { position: "absolute", bottom: 1, width: 11, height: 11, transform: [{ rotate: "45deg" }], zIndex: -1 },
  myBubbleTail: { right: -5, backgroundColor: "#176B4A" },
  theirBubbleTail: { left: -5, backgroundColor: "#F2E8D3" },
  senderLine: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  forwardedLabel: { alignSelf: "flex-start", paddingHorizontal: 7, paddingTop: 3, paddingBottom: 5 },
  forwardedLabelText: { color: "rgba(214,225,219,0.68)", fontSize: 12, lineHeight: 16, fontWeight: "700", fontStyle: "italic" },
  myForwardedLabelText: { color: "rgba(216,235,226,0.72)" },
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
  quotedReply: { borderLeftWidth: 3, borderRadius: 9, paddingLeft: 9, paddingRight: 5, paddingVertical: 5, marginBottom: 7, minWidth: 190, minHeight: 50, flexDirection: "row", alignItems: "center", gap: 8, overflow: "hidden" },
  myQuotedReply: { borderLeftColor: "#F4D99E", backgroundColor: "rgba(255,255,255,0.14)" },
  theirQuotedReply: { borderLeftColor: "#2B8061", backgroundColor: "rgba(35,97,73,0.10)" },
  quotedReplyName: { color: "#D6A95F", fontSize: 12, fontWeight: "900", marginBottom: 2 },
  quotedReplyText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  myQuotedReplyText: { color: "#FFF8E9" },
  theirQuotedReplyText: { color: "#24483C" },
  quotedReplyCopy: { flex: 1, minWidth: 0 },
  bubbleText: { fontSize: 15.5, lineHeight: 20, fontWeight: "400" },
  discoveredLink: { textDecorationLine: "underline", fontWeight: "600" },
  myDiscoveredLink: { color: "#DDEFE6" },
  theirDiscoveredLink: { color: "#176A55" },
  websitePreviewCard: { width: 286, height: 276, marginTop: 7, marginBottom: 3, borderRadius: 13, borderWidth: 1, overflow: "hidden" },
  myWebsitePreviewCard: { backgroundColor: "rgba(243,233,211,0.96)", borderColor: "rgba(73,87,74,0.22)" },
  theirWebsitePreviewCard: { backgroundColor: "#E7DBC1", borderColor: "#D1C19E" },
  websitePreviewImageSlot: { width: "100%", height: 154, overflow: "hidden", backgroundColor: "#D7D8D4" },
  websitePreviewImage: { width: "100%", height: "100%", backgroundColor: "#D7D8D4" },
  websitePreviewImagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(35,116,88,0.12)" },
  websitePreviewImagePlaceholderText: { color: "rgba(35,116,88,0.55)", fontSize: 34, fontWeight: "700" },
  websitePreviewContent: { height: 120, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 11, overflow: "hidden" },
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
  videoMessageCard: { width: 286, height: 300, borderRadius: 15, backgroundColor: "#14231e", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  videoMessageBackdrop: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#18382e" },
  videoMessageThumbnail: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  videoMessageBackdropIcon: { color: "rgba(255,255,255,0.10)", fontSize: 104, transform: [{ rotate: "-8deg" }] },
  videoDownloadOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 8, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  videoUploadCancelOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 9, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  videoUploadCancelButton: { width: 82, height: 82, alignItems: "center", justifyContent: "center" },
  videoUploadCancelCircle: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(4,30,20,0.96)", borderWidth: 1, borderColor: "rgba(50,215,135,0.32)", alignItems: "center", justifyContent: "center" },
  videoUploadCancelText: { color: "#E8FFF3", fontSize: 25, lineHeight: 25, fontWeight: "500", marginTop: -2 },
  videoUploadPercentText: { color: "rgba(232,255,243,0.78)", fontSize: 8, lineHeight: 9, fontWeight: "800" },
  uploadProgressSegmentActive: { backgroundColor: "#0B6B43" },
  videoDownloadBlurFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,18,15,0.48)" },
  downloadProgressCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(3,18,12,0.74)", borderWidth: 1, borderColor: "rgba(50,215,135,0.25)" },
  downloadProgressSegment: { position: "absolute", left: 33, top: 31, width: 5, height: 10, borderRadius: 3, backgroundColor: "rgba(219,255,236,0.16)" },
  downloadProgressSegmentActive: { backgroundColor: "#26D980" },
  downloadProgressCenter: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(4,30,20,0.94)", alignItems: "center", justifyContent: "center" },
  downloadProgressText: { color: "#E8FFF3", fontSize: 12, fontWeight: "900" },
  videoMessagePlay: { width: 58, height: 58, borderRadius: 29, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", paddingLeft: 4 },
  videoMessagePlayText: { color: "#fff", fontSize: 25 },
  videoMessageBadge: { position: "absolute", left: 10, bottom: 9, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.70)", paddingHorizontal: 9, paddingVertical: 5 },
  videoMessageBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
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
  editCancelIcon: { width: 43, height: 43, borderRadius: 22, borderWidth: 2, borderColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center", marginBottom: 1 },
  editCancelIconText: { color: "#fff", fontSize: 34, lineHeight: 36, fontWeight: "300", marginTop: -3 },
  list: { flex: 1 },
  listLight: { marginHorizontal: -16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(15,23,42,0.07)" },
  listContent: { paddingBottom: 88 },
  listContentLight: { backgroundColor: "#f3f4f6" },
  loadMoreLetters: { alignSelf: "center", borderWidth: 1, borderColor: theme.colors.warning, borderRadius: theme.radius.pill, paddingHorizontal: 22, paddingVertical: 11, marginTop: 8, marginBottom: 12 },
  loadMoreLettersText: { color: theme.colors.warning, fontWeight: "800", fontSize: 14 },
  chatRow: { minHeight: 76, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6, gap: 11, borderWidth: 1, borderColor: "rgba(219,180,107,0.14)", borderRadius: 18, backgroundColor: "rgba(7,24,22,0.76)", shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2, overflow: "hidden" },
  chatRowLight: { minHeight: 74, marginBottom: 0, paddingHorizontal: 18, paddingVertical: 10, backgroundColor: "#ffffff", borderWidth: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(15,23,42,0.09)", borderRadius: 0, shadowOpacity: 0, elevation: 0 },
  chatRowUnreadLight: { backgroundColor: "#f1faf6" },
  unreadAccent: { position: "absolute", left: 0, top: 15, bottom: 15, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: "#45C56A" },
  communityRow: { backgroundColor: "rgba(8,25,24,0.82)" },
  avatarWrap: { position: "relative" },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#123c27", alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1.5, borderColor: "rgba(210,167,89,0.54)" },
  avatarImage: { width: "100%", height: "100%" },
  inboxOnlineDot: { position: "absolute", width: 11, height: 11, borderRadius: 6, right: 0, bottom: 1, backgroundColor: "#3dbb59", borderWidth: 2, borderColor: "#051b13" },
  groupAvatar: { backgroundColor: "#123c27" },
  avatarText: { color: "#ffffff", fontWeight: "700", fontSize: 16 },
  chatCopy: { flex: 1, minWidth: 0, gap: 3 },
  chatTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chatPreviewRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 20 },
  chatKind: { color: "#8E9D96", fontSize: 10, lineHeight: 13, fontWeight: "600", letterSpacing: 0.2 },
  chatName: { flex: 1, color: "#F0F3F1", fontSize: 16, lineHeight: 20, fontWeight: "600" },
  chatNameLight: { color: "#050505" },
  chatNameUnread: { color: "#FFFFFF", fontWeight: "800" },
  chatNameUnreadLight: { color: "#101418" },
  chatSubject: { color: theme.colors.soft, marginTop: 2, fontSize: 13, fontWeight: "500" },
  chatLast: { flex: 1, color: "#A8B0AC", fontSize: 13.5, lineHeight: 18 },
  chatLastLight: { color: "#65676b" },
  chatLastUnread: { color: "#E8F3EC", fontWeight: "700" },
  chatLastUnreadLight: { color: "#34473f" },
  chatTime: { color: "#8E9993", fontWeight: "500", fontSize: 11.5 },
  chatTimeLight: { color: "#7b8580" },
  chatTimeUnread: { color: "#73D68E", fontWeight: "700" },
  unread: { minWidth: 22, height: 22, lineHeight: 22, textAlign: "center", backgroundColor: "#35A957", color: "#fff", borderRadius: 11, overflow: "hidden", paddingHorizontal: 6, fontWeight: "800", fontSize: 11 },
  memberCount: { color: theme.colors.muted, fontWeight: "600" },
  joinCommunityText: { color: "#65D889", fontWeight: "800" },
  rowAction: { paddingVertical: 8, paddingLeft: 8 },
  groupInfoPanel: { ...StyleSheet.absoluteFillObject, zIndex: 40, backgroundColor: "#061B15", elevation: 30 },
  groupInfoHeader: { minHeight: 58, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "rgba(219,180,107,0.25)", backgroundColor: "#08271D" },
  groupInfoHeaderButton: { width: 52, height: 44 },
  groupInfoHeaderTitle: { flex: 1, color: "#FFF8E8", fontSize: 18, fontWeight: "800", textAlign: "center" },
  groupInfoDoneButton: { minWidth: 52, height: 44, alignItems: "flex-end", justifyContent: "center" },
  groupInfoDoneText: { color: "#E7B968", fontSize: 15, fontWeight: "800" },
  groupInfoScroll: { flex: 1 },
  groupInfoContent: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 48 },
  groupInfoHero: { alignItems: "center", paddingBottom: 17 },
  groupInfoAvatar: { width: 92, height: 92, borderRadius: 46, backgroundColor: "#173E2E", borderWidth: 2, borderColor: "#D6A95F", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  groupInfoAvatarImage: { width: "100%", height: "100%" },
  groupInfoAvatarText: { color: "#F6E0AE", fontSize: 29, fontWeight: "800", letterSpacing: 1 },
  groupInfoEditBadge: { position: "absolute", right: 1, bottom: 1, width: 28, height: 28, borderRadius: 14, backgroundColor: "#D6A95F", borderWidth: 2, borderColor: "#061B15", alignItems: "center", justifyContent: "center" },
  groupInfoEditBadgeText: { color: "#08251B", fontSize: 13, fontWeight: "900" },
  groupInfoTitle: { color: "#FFF8E8", fontSize: 24, fontWeight: "800", textAlign: "center", marginTop: 12 },
  groupInfoMeta: { color: "#AAB8B0", fontSize: 14, fontWeight: "500", textAlign: "center", marginTop: 4 },
  groupInfoActions: { flexDirection: "row", gap: 10, marginBottom: 14 },
  groupInfoAction: { flex: 1, minHeight: 70, borderRadius: 17, backgroundColor: "rgba(18,55,42,0.92)", borderWidth: 1, borderColor: "rgba(214,169,95,0.34)", alignItems: "center", justifyContent: "center" },
  groupInfoActionIcon: { color: "#E7B968", fontSize: 24, fontWeight: "600", marginBottom: 4 },
  groupInfoActionLabel: { color: "#F8EFD9", fontSize: 13, fontWeight: "700" },
  groupInfoCard: { borderRadius: 18, backgroundColor: "rgba(10,39,29,0.96)", borderWidth: 1, borderColor: "rgba(219,180,107,0.25)", paddingHorizontal: 16, marginBottom: 14, overflow: "hidden" },
  groupDetailsHeader: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(219,180,107,0.18)" },
  groupDetailsLabel: { color: "#D7B36D", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.1 },
  groupDetailsEditButton: { minHeight: 36, paddingLeft: 16, justifyContent: "center" },
  groupDetailsEditText: { color: "#E7B968", fontSize: 13, fontWeight: "800" },
  groupDetailsForm: { paddingTop: 12, paddingBottom: 14 },
  groupDetailsFieldLabel: { color: "#B9C6BF", fontSize: 11, fontWeight: "700", marginBottom: 5, marginTop: 8 },
  groupDetailsInput: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: "rgba(219,180,107,0.32)", backgroundColor: "#061F18", color: "#F2F5F3", paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  groupDetailsDescriptionInput: { minHeight: 82, textAlignVertical: "top" },
  groupDetailsFormActions: { flexDirection: "row", justifyContent: "flex-end", gap: 9, marginTop: 14 },
  groupDetailsCancelButton: { minHeight: 38, borderRadius: 19, borderWidth: 1, borderColor: "rgba(219,180,107,0.28)", paddingHorizontal: 17, alignItems: "center", justifyContent: "center" },
  groupDetailsCancelText: { color: "#C7D0CB", fontSize: 13, fontWeight: "700" },
  groupDetailsSaveButton: { minHeight: 38, borderRadius: 19, backgroundColor: "#D6A95F", paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  groupDetailsSaveText: { color: "#08251B", fontSize: 13, fontWeight: "900" },
  groupInfoDescription: { color: "#E7ECE8", fontSize: 15, lineHeight: 22, paddingTop: 15, paddingBottom: 10 },
  groupInfoDescriptionMeta: { color: "#E7B968", fontSize: 13, fontWeight: "700", paddingBottom: 15 },
  groupInfoSettingRow: { minHeight: 64, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "rgba(219,180,107,0.16)" },
  groupInfoSettingRowLast: { borderBottomWidth: 0 },
  groupInfoSettingIcon: { width: 36, color: "#E7B968", fontSize: 22, textAlign: "center", marginRight: 8 },
  groupInfoSettingCopy: { flex: 1 },
  groupInfoSettingTitle: { color: "#F8EFD9", fontSize: 15, fontWeight: "700" },
  groupInfoSettingMeta: { color: "#93A39A", fontSize: 12, marginTop: 2 },
  groupInfoChevron: { color: "#D6A95F", fontSize: 28, fontWeight: "300" },
  groupMembersSection: { borderRadius: 18, backgroundColor: "rgba(10,39,29,0.96)", borderWidth: 1, borderColor: "rgba(219,180,107,0.25)", paddingHorizontal: 14, marginBottom: 14, overflow: "hidden" },
  groupMembersHeading: { color: "#D6A95F", fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.1, paddingTop: 16, paddingBottom: 11 },
  groupMembersSearch: { height: 42, flexDirection: "row", alignItems: "center", backgroundColor: "rgba(3,24,18,0.8)", borderWidth: 1, borderColor: "rgba(219,180,107,0.18)", borderRadius: 12, paddingHorizontal: 12, marginBottom: 8 },
  groupMembersSearchIcon: { color: "#A6B5AC", fontSize: 21, marginRight: 7 },
  groupMembersSearchInput: { flex: 1, height: 42, color: "#F5F3EB", fontSize: 14, paddingVertical: 0 },
  groupMemberRow: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: "rgba(219,180,107,0.14)" },
  groupMemberAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#173E2E", borderWidth: 1, borderColor: "rgba(214,169,95,0.6)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  groupMemberAvatarImage: { width: "100%", height: "100%" },
  groupMemberAvatarText: { color: "#F6E0AE", fontSize: 14, fontWeight: "800" },
  groupMemberAddAvatar: { backgroundColor: "#D6A95F", borderColor: "#E8C984" },
  groupMemberAddIcon: { color: "#08251B", fontSize: 26, fontWeight: "700" },
  groupMemberCopy: { flex: 1, minWidth: 0 },
  groupMemberNameLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  groupMemberName: { color: "#FFF8E8", fontSize: 15, fontWeight: "700", flexShrink: 1 },
  groupMemberCurrentTag: { color: "#08251B", backgroundColor: "#D6A95F", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, fontSize: 10, fontWeight: "900" },
  groupMemberSubtext: { color: "#8FA097", fontSize: 12, marginTop: 3 },
  groupMemberAddText: { color: "#E7B968", fontSize: 15, fontWeight: "800" },
  groupMemberRole: { borderRadius: 8, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontWeight: "900" },
  groupMemberRoleOwner: { color: "#08251B", backgroundColor: "#E7B968" },
  groupMemberRoleAdmin: { color: "#DFF8EA", backgroundColor: "#176442" },
  groupMemberRoleMember: { color: "#B9C8BF", backgroundColor: "rgba(116,139,126,0.2)" },
  groupMemberManageButton: { minWidth: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(214,169,95,0.13)", alignItems: "center", justifyContent: "center" },
  groupMemberManageIcon: { color: "#D6A95F", fontSize: 13, fontWeight: "900", letterSpacing: -1 },
  groupMemberChevron: { color: "#D6A95F", fontSize: 27, fontWeight: "300" },
  groupMembersEmpty: { color: "#91A198", fontSize: 14, textAlign: "center", paddingVertical: 24 },
  leaveGroupButton: { minHeight: 54, borderRadius: 16, borderWidth: 1, borderColor: "rgba(232,92,102,0.5)", backgroundColor: "rgba(92,22,30,0.24)", alignItems: "center", justifyContent: "center" },
  leaveGroupText: { color: "#FF8C96", fontSize: 15, fontWeight: "800" },
  chevron: { color: theme.colors.muted, fontSize: 26, marginTop: -2 },
  emptyList: { color: theme.colors.muted, fontWeight: "500", textAlign: "center", padding: theme.spacing.lg },
  letterEmptyCard: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 24, borderRadius: 22, borderWidth: 1, borderColor: "rgba(219,180,107,0.24)", backgroundColor: "rgba(7,24,22,0.78)", alignItems: "center" },
  letterEmptyIcon: { fontSize: 30, marginBottom: 8 },
  letterEmptyTitle: { color: "#f5f3eb", fontSize: 17, fontWeight: "600", textAlign: "center" },
  letterEmptyCopy: { color: "#aeb3ae", fontSize: 12.5, lineHeight: 18, textAlign: "center", marginTop: 5 },
  feedbackChatCard: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10, paddingLeft: 13, paddingRight: 28, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: "rgba(239,189,104,0.72)", backgroundColor: "rgba(27,62,44,0.94)", position: "relative" },
  feedbackChatCardLight: { backgroundColor: "#ffffff", borderColor: "rgba(15,23,42,0.07)", shadowColor: "#15251f", shadowOpacity: 0.09, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  feedbackChatAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#D6A95F", borderWidth: 2, borderColor: "#F4D99E" },
  feedbackChatAvatarText: { color: "#173A2A", fontSize: 14, fontWeight: "800" },
  feedbackChatEyebrow: { color: "#efbd68", fontSize: 9, letterSpacing: 0.9, fontWeight: "800", marginBottom: 2 },
  feedbackChatEyebrowLight: { color: "#9a6700" },
  feedbackChatName: { color: "#fff8e8", fontSize: 15, fontWeight: "700" },
  feedbackChatNameLight: { color: "#111827" },
  feedbackChatCopy: { color: "#c4cec7", fontSize: 11.5, lineHeight: 15, marginTop: 2 },
  feedbackChatCopyLight: { color: "#667085" },
  feedbackChatArrow: { color: "#efbd68", fontSize: 25, fontWeight: "300" },
  feedbackChatDismiss: { position: "absolute", top: 3, right: 5, width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(2,18,13,0.58)", zIndex: 3 },
  feedbackChatDismissText: { color: "#f4d99e", fontSize: 18, lineHeight: 21, fontWeight: "500" },
  groupSuggestionsSection: { marginBottom: 12, padding: 10, borderRadius: 20, borderWidth: 1, borderColor: "rgba(219,180,107,0.22)", backgroundColor: "rgba(7,24,22,0.74)", gap: 7 },
  groupSuggestionsSectionLight: { backgroundColor: "#ffffff", borderColor: "rgba(15,23,42,0.07)", shadowColor: "#15251f", shadowOpacity: 0.10, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  groupSuggestionsHeader: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 3 },
  groupSuggestionsCopy: { flex: 1, minWidth: 0 },
  groupSuggestionsTitle: { color: "#efbd68", fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  groupSuggestionsTitleLight: { color: "#147a58" },
  groupSuggestionsSubtitle: { color: "#9eaaa2", fontSize: 10.5, marginTop: 2 },
  groupSuggestionsSubtitleLight: { color: "#667085" },
  groupSuggestionsDismiss: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)" },
  groupSuggestionsDismissLight: { backgroundColor: "#f1f3f5" },
  groupSuggestionsDismissText: { color: "#cbd2cd", fontSize: 20, lineHeight: 23 },
  groupSuggestionsDismissTextLight: { color: "#667085" },
  suggestedGroupRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 15, backgroundColor: "rgba(20,51,40,0.72)" },
  suggestedGroupRowLight: { backgroundColor: "#f5f7f9", borderWidth: 1, borderColor: "rgba(15,23,42,0.05)" },
  suggestedJoinButton: { minWidth: 48, height: 30, paddingHorizontal: 10, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#1b8551" },
  suggestedJoinText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  guestLetters: { marginBottom: 12, padding: 12, borderRadius: 20, borderWidth: 1, borderColor: "rgba(214,169,95,.28)", backgroundColor: "rgba(7,31,23,.82)", gap: 9 },
  guestLettersLight: { backgroundColor: "#fff", borderColor: "rgba(15,23,42,.07)", shadowColor: "#15251f", shadowOpacity: .09, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  guestLettersHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  guestLettersTitle: { color: "#fff8e8", fontSize: 16, fontWeight: "800" },
  guestLettersTitleLight: { color: "#17201c" },
  guestLettersSubtitle: { color: "#8fa097", fontSize: 11, lineHeight: 16, marginTop: 2 },
  guestLettersCount: { color: "#65d7aa", fontSize: 11, fontWeight: "800" },
  guestLettersEmpty: { paddingVertical: 14, alignItems: "center" },
  guestLettersEmptyTitle: { color: "#f6f2e6", fontSize: 14, fontWeight: "800" },
  guestLetterRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 15, backgroundColor: "rgba(20,55,42,.78)" },
  guestLetterRowLight: { backgroundColor: "#f5f7f6" },
  guestLetterIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(30,196,142,.16)" },
  guestLetterCopy: { flex: 1, minWidth: 0 },
  guestLetterName: { color: "#f8f5ea", fontSize: 14, fontWeight: "800" },
  guestLetterPreview: { color: "#8fa097", fontSize: 11, lineHeight: 15, marginTop: 3 },
  guestLetterArrow: { color: "#d6a95f", fontSize: 22 },
  guestThread: { gap: 7, padding: 10, borderRadius: 15, backgroundColor: "rgba(3,23,17,.74)" },
  guestThreadBubble: { alignSelf: "flex-start", maxWidth: "88%", paddingHorizontal: 11, paddingVertical: 8, borderRadius: 13, backgroundColor: "rgba(255,255,255,.07)" },
  guestThreadBubbleMine: { alignSelf: "flex-end", backgroundColor: "#176e4e" },
  guestThreadAuthor: { color: "#d6a95f", fontSize: 9, fontWeight: "800", marginBottom: 2 },
  guestThreadBody: { color: "#f4f6f4", fontSize: 13, lineHeight: 18 },
  guestReplyInput: { minHeight: 54, maxHeight: 110, borderRadius: 15, borderWidth: 1, borderColor: "rgba(214,169,95,.25)", color: "#f5f6f5", backgroundColor: "#071f18", paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: "top" },
  guestReplyInputLight: { color: "#17201c", backgroundColor: "#fff", borderColor: "rgba(15,23,42,.10)" },
  guestReplySend: { alignSelf: "flex-end", minHeight: 38, justifyContent: "center", borderRadius: 19, backgroundColor: "#1ec493", paddingHorizontal: 18 },
  guestReplySendText: { color: "#06291e", fontSize: 12, fontWeight: "900" },
  guestBenefitsBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.52)", padding: 14 },
  guestBenefitsCard: { borderRadius: 24, borderWidth: 1, borderColor: "rgba(214,169,95,.36)", backgroundColor: "#09251c", padding: 20, gap: 12 },
  guestBenefitsCardLight: { backgroundColor: "#fff", borderColor: "rgba(15,23,42,.08)" },
  guestBenefitsClose: { position: "absolute", right: 12, top: 10, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(128,128,128,.13)", zIndex: 2 },
  guestBenefitsCloseText: { color: "#78817c", fontSize: 23 },
  guestBenefitsEyebrow: { color: "#1ec493", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  guestBenefitsTitle: { color: "#fff8e8", fontSize: 21, lineHeight: 26, fontWeight: "900", paddingRight: 35 },
  guestBenefitsBody: { color: "#8fa097", fontSize: 13, lineHeight: 20 },
  guestBenefitsPrimary: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: "#1ec493" },
  guestBenefitsPrimaryText: { color: "#06291e", fontSize: 14, fontWeight: "900" },
  guestBenefitsLater: { color: "#7f8d86", fontSize: 12, fontWeight: "700", textAlign: "center", paddingVertical: 5 }
});
