import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Contacts from "expo-contacts";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import { BlurView } from "expo-blur";
import { Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { mapCoordinatesUrl, nativeMapProviderName } from "../utils/maps";
import {
  absoluteAssetUrl,
  addChatGroupMember,
  blockChatUser,
  createChatCommunity,
  createChatGroupInvite,
  deleteChatMessage,
  editChatMessage,
  findChatPersonByPhone,
  findChatPeopleByContactHashes,
  getChatCommunities,
  getChatDeviceKeys,
  getChatEncryptedEnvelopes,
  getChatGroupMembers,
  getChatConversations,
  getChatMessages,
  getAuthenticatedAssetDataUrl,
  getAuthenticatedImagePreviewUri,
  joinChatCommunity,
  joinChatGroupInvite,
  previewChatGroupInvite,
  leaveChatGroup,
  markChatRead,
  muteChatConversation,
  openChatForRide,
  openChatForPost,
  openCommunityChat,
  openChatWithPerson,
  pollChatEvents,
  reportChatMessage,
  registerChatDeviceKey,
  removeChatGroupMember,
  sendEncryptedChatMessage,
  sendEncryptedChatAttachment,
  transferChatGroupOwnership,
  updateChatGroupPhoto,
  updateChatGroupMemberRole,
  updateChatTyping,
  voteChatPoll
} from "../api/client";
import { appAssets } from "../assets";
import { DateTimeField, todayLocalIso } from "../components/DateTimeField";
import { theme } from "../theme";
import { BootstrapPayload, ChatConversation, ChatGroupMember, ChatMessage, Community, HousingPost, RidePost } from "../types";
import { pickChatImages, pickCompressedImages, takeChatPhoto } from "../utils/imageUpload";
import { pickChatFile } from "../utils/fileUpload";
import { contactDiscoveryHash, contactDiscoveryVariants, decryptAttachmentBase64, decryptEnvelope, DeviceIdentity, encryptAttachmentForDevices, encryptForDevices, getOrCreateDeviceIdentity } from "../utils/chatCrypto";
import { createOutboxClientMessageId, EncryptedOutboxItem, enqueueEncryptedMessage, isRetryableChatNetworkError, readEncryptedOutbox, removeEncryptedOutboxItem, updateEncryptedOutboxItem } from "../utils/chatOutbox";
import { useNearbyRelay } from "../providers/NearbyRelayProvider";

type Props = {
  data: BootstrapPayload | null;
  pendingPost: HousingPost | null;
  pendingRide: RidePost | null;
  pendingGroupInvite?: string;
  onRequireLogin: () => void;
  onClearPendingPost?: () => void;
  onClearPendingRide?: () => void;
  onClearPendingGroupInvite?: () => void;
  onThreadModeChange?: (active: boolean) => void;
  onUnreadCountChange?: (count: number) => void;
};

type MessengerTab = "All" | "Unread" | "Groups" | "Communities";

const blankGroup = { name: "" };
type PendingChatAttachment = { kind: "IMAGE" | "VIDEO" | "FILE"; uri: string; blob?: Blob; name: string; mimeType: string; size: number };
const conversationKeyCacheName = (userId: number, conversationId: string) => `fairfares.fchat.public-keys.${userId}.${conversationId}`;
const wallpaperChoices = [
  { id: "midnight", label: "Midnight", color: "#080d18", accent: "#163a6b" },
  { id: "ocean", label: "Ocean", color: "#071d2b", accent: "#0d6685" },
  { id: "forest", label: "Forest", color: "#0b211a", accent: "#206b50" },
  { id: "plum", label: "Plum", color: "#241329", accent: "#75487f" },
  { id: "sand", label: "Sand", color: "#30271f", accent: "#8a6c48" },
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
  return <Image source={{ uri: previewSource }} style={[styles.messageImage, compact && styles.collageImage]} resizeMode="cover" onError={() => setPreviewFailed(true)} />;
}

function EncryptedChatImage({ attachmentUrl, keyPayload, compact = false }: { attachmentUrl: string; keyPayload: string; compact?: boolean }) {
  const [uri, setUri] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getAuthenticatedAssetDataUrl(attachmentUrl)
      .then((encryptedDataUrl) => decryptAttachmentBase64(encryptedDataUrl.split(",", 2)[1] || "", keyPayload))
      .then(async (decrypted) => {
        let previewUri = `data:${decrypted.mimeType};base64,${decrypted.base64}`;
        if (Platform.OS !== "web") {
          const cacheRoot = FileSystem.cacheDirectory;
          if (!cacheRoot) throw new Error("Photo preview storage is unavailable.");
          const extension = decrypted.mimeType === "image/png" ? "png" : decrypted.mimeType === "image/webp" ? "webp" : "jpg";
          previewUri = `${cacheRoot}fchat-decrypted-${attachmentUrl.replace(/[^A-Za-z0-9]+/g, "-").slice(-64)}.${extension}`;
          const existing = await FileSystem.getInfoAsync(previewUri);
          if (!existing.exists || Number(existing.size || 0) === 0) {
            await FileSystem.writeAsStringAsync(previewUri, decrypted.base64, { encoding: FileSystem.EncodingType.Base64 });
          }
        }
        if (!cancelled) setUri(previewUri);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attachmentUrl, keyPayload]);
  if (failed) return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Encrypted preview unavailable</Text></View>;
  if (!uri) return <View style={[styles.messageImage, compact && styles.collageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Decrypting photo…</Text></View>;
  return <Image source={{ uri }} style={[styles.messageImage, compact && styles.collageImage]} resizeMode="cover" />;
}

function PendingPhotoPreview({ uri, compact = false }: { uri: string; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <View style={[styles.pendingAttachmentImage, compact && styles.pendingCollageImage, styles.pendingPreviewFallback]}><Text style={styles.pendingPreviewFallbackText}>No preview</Text></View>;
  return <Image source={{ uri }} style={[styles.pendingAttachmentImage, compact && styles.pendingCollageImage]} resizeMode="cover" onError={() => setFailed(true)} />;
}

function ChatMessagePhoto({ message, compact = false }: { message: ChatMessage; compact?: boolean }) {
  if (message.metadata?.decryptedDataUrl) {
    return <Image source={{ uri: message.metadata.decryptedDataUrl }} style={[styles.messageImage, compact && styles.collageImage]} resizeMode="cover" />;
  }
  if (message.metadata?.encryptedKeyPayload) {
    return <EncryptedChatImage attachmentUrl={message.attachmentUrl} keyPayload={message.metadata.encryptedKeyPayload} compact={compact} />;
  }
  return <AuthenticatedChatImage attachmentUrl={message.attachmentUrl} compact={compact} />;
}

export function MessengerScreen({ data, pendingPost, pendingRide, pendingGroupInvite, onRequireLogin, onClearPendingPost, onClearPendingRide, onClearPendingGroupInvite, onThreadModeChange, onUnreadCountChange }: Props) {
  const { enabled: nearbyRelayEnabled, status: nearbyRelayStatus, custodyVersion: nearbyCustodyVersion, toggle: toggleNearbyRelay } = useNearbyRelay();
  const messagesScrollRef = useRef<ScrollView>(null);
  const outboxFlushRunning = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingLastSentAt = useRef(0);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const locationExpiresAt = useRef(0);
  const locationLastSentAt = useRef(0);
  const signedIn = Boolean(data?.user);
  const [tab, setTab] = useState<MessengerTab>("All");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<ChatConversation[]>(data?.chat.conversations || []);
  const [communities, setCommunities] = useState<Community[]>(data?.communities || []);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [activeSubject, setActiveSubject] = useState(pendingPost?.title || rideContextLabel(pendingRide) || "");
  const [activeConversation, setActiveConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<PendingChatAttachment | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingChatAttachment[]>([]);
  const [composerFocused, setComposerFocused] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [forwardPickerOpen, setForwardPickerOpen] = useState(false);
  const [selectedForwardConversationIds, setSelectedForwardConversationIds] = useState<string[]>([]);
  const [forwardingMessages, setForwardingMessages] = useState(false);
  const [wallpaperPanelOpen, setWallpaperPanelOpen] = useState(false);
  const [chatOptionsOpen, setChatOptionsOpen] = useState(false);
  const [groupMembersOpen, setGroupMembersOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState<ChatGroupMember[]>([]);
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
  const inThread = signedIn && (Boolean(activeConversationId) || Boolean(pendingPost) || Boolean(pendingRide));
  const visibleMessages = useMemo(() => collapseLocationUpdates(messages), [messages]);

  useEffect(() => {
    setConversations(data?.chat.conversations || []);
    setCommunities(data?.communities || []);
  }, [data?.chat.conversations, data?.communities]);

  useEffect(() => {
    AsyncStorage.getItem("fairfares.fchat.recent-emojis")
      .then((value) => { if (value) setRecentEmojis(JSON.parse(value).slice(0, 16)); })
      .catch(() => undefined);
  }, []);

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
        await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
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

  async function ensureChatDeviceIdentity() {
    const userId = Number(data?.user?.id || 0);
    if (!userId) throw new Error("Sign in to use encrypted FChat.");
    const identity = deviceIdentity || await getOrCreateDeviceIdentity(userId);
    setDeviceIdentity(identity);
    try {
      await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
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
      const cached = await AsyncStorage.getItem(conversationKeyCacheName(userId, conversationId));
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
      localClientMessageId: item.clientMessageId
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
          const response = await sendEncryptedChatMessage(item.conversationId, refreshedEnvelopes, item.clientMessageId);
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

  async function decryptMessages(conversationId: string, nextMessages: ChatMessage[]) {
    try {
      const identity = await ensureChatDeviceIdentity();
      const [envelopePayload, keyPayload] = await Promise.all([
        getChatEncryptedEnvelopes(conversationId, identity.deviceId), getChatDeviceKeys(conversationId)
      ]);
      setEncryptionReady(Boolean(keyPayload.ready));
      const byMessage = new Map(envelopePayload.envelopes.map((item) => [item.messageId, item]));
      return await Promise.all(nextMessages.map(async (message) => {
        const envelope = byMessage.get(message.id);
        if (!envelope) return message.text.includes("End-to-end encrypted message")
          ? { ...message, text: "Encrypted message unavailable on this device. Ask the sender to resend it.", canEdit: false }
          : message;
        const clearText = decryptEnvelope(envelope, identity);
        if (message.type === "ENCRYPTED_ATTACHMENT" && message.attachmentUrl && clearText) {
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
    if (pendingPost) {
      setActiveConversationId("");
      setActiveConversation(null);
      setActiveSubject(pendingPost.title);
      setMessages([]);
      setMessageText(`Hi, I am interested in ${pendingPost.title}. Is it still available?`);
      let cancelled = false;
      setThreadLoading(true);
      void openChatForPost(pendingPost.id)
        .then(async (response) => {
          if (cancelled) return;
          const conversation = response.conversation;
          setActiveConversationId(conversation.id);
          setActiveConversation(conversation);
          setActiveSubject(conversation.subject || pendingPost.title);
          const payload = await getChatMessages(conversation.id);
          if (cancelled) return;
          setActiveConversation(payload.conversation || conversation);
          setMessages(await decryptMessages(conversation.id, payload.messages || []));
        })
        .catch((error) => {
          if (!cancelled) Alert.alert("FChat unavailable", error instanceof Error ? error.message : "Could not verify this listing owner.");
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
      setActiveConversationId("");
      setActiveConversation(null);
      setActiveSubject(rideContextLabel(pendingRide));
      setMessages([]);
      setMessageText(`Hi, I am interested in this ride from ${pendingRide.origin} to ${pendingRide.destination}. Is it still available?`);
      let cancelled = false;
      setThreadLoading(true);
      void openChatForRide(pendingRide.id)
        .then(async (response) => {
          if (cancelled) return;
          const conversation = response.conversation;
          setActiveConversationId(conversation.id);
          setActiveConversation(conversation);
          setActiveSubject(conversation.subject || rideContextLabel(pendingRide));
          const payload = await getChatMessages(conversation.id);
          if (cancelled) return;
          setActiveConversation(payload.conversation || conversation);
          setMessages(await decryptMessages(conversation.id, payload.messages || []));
        })
        .catch((error) => {
          if (!cancelled) {
            Alert.alert("FChat unavailable", error instanceof Error ? error.message : "Could not verify this listing owner.");
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
          setMessages((current) => {
            const byId = new Map<number, ChatMessage>();
            current.forEach((message) => {
              const receipt = receiptById.get(Number(message.id));
              byId.set(Number(message.id), receipt ? { ...message, ...receipt } : message);
            });
            incomingMessages.forEach((message) => byId.set(Number(message.id), message));
            return [...byId.values()].sort((left, right) => Number(left.id) - Number(right.id));
          });
          if ((payload.messages || []).some((message) => !message.mine)) {
            await markChatRead(activeConversationId, String(cursor));
            const nextConversations = await getChatConversations();
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
            setMessages([]);
            setConversations((current) => current.filter((conversation) => conversation.id !== activeConversationId));
            closeThread();
            Alert.alert("Group access ended", "You are no longer a member of this group, so its messages are no longer available.");
            return;
          }
          if (!cancelled) await new Promise((resolve) => setTimeout(resolve, 1200));
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
      if (tab === "Communities") return true;
      if (tab !== "All" && tab !== "Groups") return false;
      if (!community.joined) return false;
      if (tab === "Groups" && community.kind !== "GROUP") return false;
      return !activeCommunityIds.has(community.id);
    });
  }, [communities, personConversations, search, tab]);

  async function refreshMessenger() {
    if (!signedIn) return;
    setLoading(true);
    try {
      const [nextConversations, nextCommunities] = await Promise.all([getChatConversations(), getChatCommunities()]);
      setConversations(nextConversations);
      setCommunities(nextCommunities);
      onUnreadCountChange?.(nextConversations.reduce((total, conversation) => total + Math.max(0, Number(conversation.unread) || 0), 0));
    } catch (error) {
      Alert.alert("Messenger failed", error instanceof Error ? error.message : "Could not load chats.");
    } finally {
      setLoading(false);
    }
  }

  async function openConversation(conversation: ChatConversation) {
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    onThreadModeChange?.(true);
    setActiveConversationId(conversation.id);
    setActiveSubject(conversation.subject);
    setActiveConversation(conversation);
    setThreadLoading(true);
    try {
      const payload = await getChatMessages(conversation.id);
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
      setMessages(await decryptMessages(conversation.id, payload.messages || []));
      const lastMessage = payload.messages[payload.messages.length - 1];
      if (lastMessage) {
        await markChatRead(conversation.id, String(lastMessage.id));
      }
      await refreshMessenger();
    } catch (error) {
      Alert.alert("Chat failed", error instanceof Error ? error.message : "Could not open this chat.");
    } finally {
      setThreadLoading(false);
    }
  }

  async function sendMessage() {
    const cleanMessage = messageText.trim();
    if (activeConversationId) void updateChatTyping(activeConversationId, false).catch(() => undefined);
    let queuedOffline = false;
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    const attachments = pendingImages.length ? pendingImages : pendingAttachment ? [pendingAttachment] : [];
    if (attachments.length) {
      if (!activeConversationId) {
        Alert.alert("Opening FChat", "Wait a moment while FairFares verifies the conversation.");
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
          const fileBase64 = Platform.OS === "web"
            ? await new Promise<string>(async (resolve, reject) => {
                try {
                  let blob = attachment.blob;
                  if (!blob) blob = await fetch(attachment.uri).then((item) => item.blob());
                  const reader = new FileReader();
                  reader.onerror = () => reject(new Error("Could not read this attachment."));
                  reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
                  reader.readAsDataURL(blob as Blob);
                } catch (error) { reject(error); }
              })
            : await FileSystem.readAsStringAsync(attachment.uri, { encoding: FileSystem.EncodingType.Base64 });
          const mediaMetadata = mediaGroupId ? { mediaGroupId, mediaGroupIndex: index, mediaGroupCount: attachments.length } : {};
          const caption = index === 0 ? cleanMessage : "";
          const encrypted = encryptAttachmentForDevices(fileBase64, { fileName: attachment.name, mimeType: attachment.mimeType, caption, kind: attachment.kind, ...mediaMetadata }, identity, keyPayload.keys);
          const response = await sendEncryptedChatAttachment(activeConversationId, encrypted.ciphertextBase64, encrypted.envelopes, index + 1 < attachments.length);
          sentMessages.push({ ...response.message, type: attachment.kind, text: caption, metadata: { ...response.message.metadata, encrypted: true, kind: attachment.kind, fileName: attachment.name, mimeType: attachment.mimeType, decryptedDataUrl: `data:${attachment.mimeType};base64,${fileBase64}`, ...mediaMetadata } });
          setAttachmentStatus(attachments.length > 1 ? `Sending photo ${index + 1} of ${attachments.length}…` : attachment.kind === "IMAGE" ? "Sending photo…" : `Sending ${attachment.name}…`);
        }
        setMessages((current) => [...current.filter((item) => !sentMessages.some((sent) => sent.id === item.id)), ...sentMessages].sort((a, b) => a.id - b.id));
        const sentKind = attachments[0].kind;
        setPendingAttachment(null);
        setPendingImages([]);
        setMessageText("");
        setAttachmentStatus(attachments.length > 1 ? `${attachments.length} photos sent` : sentKind === "IMAGE" ? "Photo sent" : "File sent");
        setTimeout(() => setAttachmentStatus(""), 1600);
        onClearPendingPost?.();
        onClearPendingRide?.();
        await refreshMessenger();
      } catch (error) {
        setAttachmentStatus("");
        Alert.alert(attachments[0].kind === "IMAGE" ? "Image failed" : "File failed", error instanceof Error ? error.message : "Could not send this attachment.");
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
      Alert.alert("Securing FChat", "Wait a moment while FairFares prepares the encrypted conversation.");
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
          const response = await sendEncryptedChatMessage(activeConversationId, envelopes, clientMessageId);
          setMessages((current) => [...current, { ...response.message, text: cleanMessage, canEdit: response.message.canEdit, metadata: { ...response.message.metadata, encrypted: true } }]);
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
            attempts: 0,
            lastAttemptAt: ""
          };
          await enqueueEncryptedMessage(outboxItem);
          setMessages((current) => [...current, queuedMessage(outboxItem, identity)]);
          queuedOffline = true;
        }
        onClearPendingPost?.();
        onClearPendingRide?.();
      } else {
        Alert.alert("Choose a chat", "Open a listing or conversation first.");
        return;
      }
      setMessageText("");
      if (!queuedOffline) {
        try {
          await refreshMessenger();
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
      setActiveConversationId(response.conversation.id);
      setActiveConversation(response.conversation);
      setActiveSubject(found.person.name);
      setSearch("");
      setCreatingGroup(false);
      onThreadModeChange?.(true);
      const payload = await getChatMessages(response.conversation.id);
      setMessages(await decryptMessages(response.conversation.id, payload.messages || []));
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
      setActiveConversationId(response.conversation.id);
      setActiveConversation(response.conversation);
      setActiveSubject(person.name);
      onThreadModeChange?.(true);
      const payload = await getChatMessages(response.conversation.id);
      setMessages(await decryptMessages(response.conversation.id, payload.messages || []));
      await refreshMessenger();
    } catch (error) {
      Alert.alert("Could not open chat", error instanceof Error ? error.message : "Try again shortly.");
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
        Alert.alert("Contacts permission not enabled", "You can still find a member by entering their full phone number in FChat search.");
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
    if (value.includes("group_invite=")) {
      void confirmGroupInvitation(value);
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
      const joinedCommunity = community.joined ? community : (await joinChatCommunity(community.id)).community;
      setCommunities((current) => current.map((item) => (item.id === joinedCommunity.id ? joinedCommunity : item)));
      const response = await openCommunityChat(joinedCommunity.id);
      setActiveConversationId(response.conversation.id);
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
      setMessages(await decryptMessages(response.conversation.id, payload.messages || []));
      const lastMessage = payload.messages[payload.messages.length - 1];
      if (lastMessage) {
        await markChatRead(response.conversation.id, String(lastMessage.id));
      }
      await refreshMessenger();
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
      Alert.alert("Group unavailable", "Refresh FChat and open the group again.");
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
      Alert.alert("Opening FChat", "Wait a moment while FairFares verifies the conversation.");
      return;
    }
    try {
      const images = await pickChatImages(4, 1600, 0.76);
      if (!images.length) return;
      setPendingAttachment(null);
      setPendingImages(images);
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
      Alert.alert("Opening FChat", "Wait a moment while FairFares verifies the conversation.");
      return;
    }
    try {
      const photo = await takeChatPhoto(1600, 0.82);
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
      Alert.alert("Opening FChat", "Wait a moment while FairFares verifies the conversation.");
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
    setAttachmentMenuOpen(false);
    setRichDraft({ primary: "", secondary: "", tertiary: "", fourth: "" });
    setRichComposer(type);
  }

  async function sendEncryptedRichMessage(type: string, metadata: Record<string, unknown>, silent = false) {
    if (!activeConversationId) throw new Error("Open a conversation first.");
    const identity = await ensureChatDeviceIdentity();
    const keyPayload = await getEncryptionKeysForSend(activeConversationId);
    if (!keyPayload.ready) throw new Error(keyPayload.warning || "Encryption keys are not ready.");
    setEncryptionReady(true);
    const envelopes = encryptForDevices(`FFRICH:${JSON.stringify({ type, metadata })}`, identity, keyPayload.keys);
    const response = await sendEncryptedChatMessage(activeConversationId, envelopes, `${Date.now()}-${Math.random().toString(36).slice(2)}`, silent);
    const message = { ...response.message, type, text: "", canEdit: false, metadata: { ...metadata, encrypted: true } } as ChatMessage;
    setMessages((current) => [...current.filter((item) => item.id !== message.id), message].sort((a, b) => a.id - b.id));
    return message;
  }

  async function submitRichMessage() {
    if (!activeConversationId || !richComposer) return;
    let metadata: Record<string, unknown>;
    if (richComposer === "POLL") {
      metadata = { question: richDraft.primary.trim(), options: richDraft.secondary.split(/\n|,/).map((value) => value.trim()).filter(Boolean) };
    } else if (richComposer === "EVENT") {
      metadata = { title: richDraft.primary.trim(), date: richDraft.secondary.trim(), time: richDraft.tertiary.trim(), location: richDraft.fourth.trim() };
    } else {
      metadata = { name: richDraft.primary.trim(), phone: richDraft.secondary.trim(), email: richDraft.tertiary.trim() };
    }
    try {
      setThreadLoading(true);
      await sendEncryptedRichMessage(richComposer, metadata);
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
        Alert.alert("Location permission needed", "Enable location access to share your live position in this FChat.");
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
    if (message.metadata?.encrypted) {
      Alert.alert("Encrypted poll", "Private poll voting will be added with anonymous encrypted vote envelopes. This poll is currently view-only.");
      return;
    }
    try {
      const response = await voteChatPoll(message.id, optionIndex);
      setMessages((current) => current.map((item) => item.id === message.id ? response.message : item));
    } catch (error) {
      Alert.alert("Vote failed", error instanceof Error ? error.message : "Could not save your vote.");
    }
  }

  function safeAttachmentName(message: ChatMessage, mimeType: string) {
    const fallbackExtension = mimeType.startsWith("image/") ? ".jpg" : mimeType.startsWith("video/") ? ".mp4" : ".bin";
    const raw = String(message.metadata?.fileName || `fchat-${message.id}${fallbackExtension}`);
    const clean = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-120);
    return clean || `fchat-${message.id}${fallbackExtension}`;
  }

  async function materializeAttachment(message: ChatMessage) {
    if (!message.attachmentUrl && !message.metadata?.decryptedDataUrl) return;
    let dataUrl = message.metadata?.decryptedDataUrl || await getAuthenticatedAssetDataUrl(message.attachmentUrl);
    let mimeType = message.metadata?.mimeType || "application/octet-stream";
    let fileName = safeAttachmentName(message, mimeType);
    if (message.metadata?.encryptedKeyPayload && !message.metadata?.decryptedDataUrl) {
      const decrypted = decryptAttachmentBase64(dataUrl.split(",", 2)[1] || "", message.metadata.encryptedKeyPayload);
      mimeType = decrypted.mimeType || mimeType;
      fileName = safeAttachmentName({ ...message, metadata: { ...message.metadata, fileName: decrypted.fileName } }, mimeType);
      dataUrl = `data:${mimeType};base64,${decrypted.base64}`;
    }
    if (Platform.OS === "web") return { uri: dataUrl, name: fileName, mimeType };
    const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
    if (!base64) throw new Error("The downloaded attachment is empty.");
    const cacheRoot = FileSystem.cacheDirectory;
    if (!cacheRoot) throw new Error("Attachment storage is unavailable on this device.");
    const localUri = `${cacheRoot}${Date.now()}-${fileName}`;
    await FileSystem.writeAsStringAsync(localUri, base64, { encoding: FileSystem.EncodingType.Base64 });
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
    try {
      setAttachmentStatus("Preparing attachment…");
      const item = await materializeAttachment(message);
      if (!item) return;
      if (message.type === "IMAGE") setAttachmentPreview(item);
      else await downloadAttachment(item);
    } catch (error) {
      Alert.alert("Attachment unavailable", error instanceof Error ? error.message : "Could not open this attachment.");
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
    setEmojiPickerOpen(false);
    setAttachmentMenuOpen((current) => !current);
  }

  function toggleEmojiPicker() {
    setAttachmentMenuOpen(false);
    setRichComposer("");
    setEmojiPickerOpen((current) => !current);
  }

  function chooseEmoji(emoji: string) {
    setMessageText((current) => `${current}${emoji}`);
    const next = [emoji, ...recentEmojis.filter((item) => item !== emoji)].slice(0, 16);
    setRecentEmojis(next);
    void AsyncStorage.setItem("fairfares.fchat.recent-emojis", JSON.stringify(next));
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
    const actions: Array<{ text: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }> = [];
    actions.push({ text: "Select messages", onPress: () => setSelectedMessageIds([messageSelectionKey(message)]) });
    if (message.mine && message.canEdit) {
      actions.push({ text: "Edit message", onPress: () => editMessage(message) });
      actions.push({ text: "Delete message", style: "destructive", onPress: () => void deleteMessage(message) });
    }
    if (!message.mine) {
      actions.push({ text: "Report message", style: "destructive", onPress: () => void reportMessage(message) });
    }
    actions.push({ text: "Cancel", style: "cancel" });
    Alert.alert("Message options", undefined, actions);
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
      await Share.share({ title: "FChat messages", message: transcript });
    } catch (error) {
      Alert.alert("Share failed", error instanceof Error ? error.message : "Could not share these messages.");
    }
  }

  function openForwardPicker() {
    if (!selectedMessageIds.length) return;
    setSelectedForwardConversationIds([]);
    setForwardPickerOpen(true);
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
            const fileBase64 = Platform.OS === "web"
              ? attachment.uri.slice(attachment.uri.indexOf(",") + 1)
              : await FileSystem.readAsStringAsync(attachment.uri, { encoding: FileSystem.EncodingType.Base64 });
            const kind = message.type as "IMAGE" | "VIDEO" | "FILE";
            const encrypted = encryptAttachmentForDevices(fileBase64, { fileName: attachment.name, mimeType: attachment.mimeType, caption: message.text || "", kind }, identity, keyPayload.keys);
            await sendEncryptedChatAttachment(conversationId, encrypted.ciphertextBase64, encrypted.envelopes);
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
    setActiveConversationId("");
    setActiveConversation(null);
    setActiveSubject("");
    setMessages([]);
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
      <KeyboardAvoidingView
        style={[styles.threadScreen, Platform.OS === "android" && styles.threadScreenAndroid]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View pointerEvents="none" style={[styles.wallpaperBase, { backgroundColor: wallpaperChoices.find((choice) => choice.id === wallpaper)?.color || "#080d18" }]}>
          {customWallpaper ? <Image source={{ uri: customWallpaper }} style={styles.wallpaperImage} resizeMode="cover" /> : null}
          {!customWallpaper ? <><View style={[styles.wallpaperGlow, styles.wallpaperGlowOne, { backgroundColor: wallpaperChoices.find((choice) => choice.id === wallpaper)?.accent || "#163a6b" }]} /><View style={[styles.wallpaperGlow, styles.wallpaperGlowTwo, { backgroundColor: wallpaperChoices.find((choice) => choice.id === wallpaper)?.accent || "#163a6b" }]} /><Text style={styles.wallpaperPattern}>⌖  ·  F  ·  ◇  ·  ⌁  ·  F  ·  ◇</Text></> : null}
          <View style={styles.wallpaperShade} />
        </View>
        <BlurView intensity={48} tint="dark" style={styles.threadHeader}>
          <TouchableOpacity style={styles.backButton} onPress={closeThread} accessibilityRole="button" accessibilityLabel="Back to conversations">
            <BackIcon />
          </TouchableOpacity>
          <View style={styles.threadAvatar}>
            {chatPhotoUrl(activeConversation?.otherPhotoUrl) ? (
              <Image source={{ uri: chatPhotoUrl(activeConversation?.otherPhotoUrl) }} style={styles.threadAvatarImage} />
            ) : (
              <Text style={styles.threadAvatarText}>
                {initials(activeConversation?.otherName || (pendingPost ? listingPosterName(pendingPost) : "") || (pendingRide ? rideOwnerName(pendingRide) : "") || activeSubject || "Chat")}
              </Text>
            )}
            {activeConversation?.otherOnline && !activeConversation?.communityId ? <View style={styles.activeDot} /> : null}
          </View>
          <View style={styles.threadHeaderCopy}>
            <Text style={styles.threadHeaderTitle} numberOfLines={1}>
              {activeConversation?.otherName || (pendingPost ? listingPosterName(pendingPost) : "") || (pendingRide ? rideOwnerName(pendingRide) : "") || "FairFares chat"}
            </Text>
            <Text style={styles.threadHeaderMeta} numberOfLines={1}>
              {typingPeople.length
                ? `${typingPeople.map((person) => person.name.split(" ")[0]).join(", ")} ${typingPeople.length === 1 ? "is" : "are"} typing…`
                : `${presenceLabel(activeConversation)} · ${encryptionReady ? "🔒 End-to-end encrypted" : "Encryption setup pending"}`}
            </Text>
          </View>
          <TouchableOpacity style={styles.headerAction} onPress={showChatOptions} accessibilityLabel="Chat options"><DotsIcon /></TouchableOpacity>
        </BlurView>

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
          <View style={styles.chatOptionsPanel}>
            <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); void toggleMute(); }}><Text style={styles.chatOptionIcon}>◉</Text><Text style={styles.chatOptionText}>{activeConversation?.mutedAt ? "Unmute notifications" : "Mute notifications"}</Text></TouchableOpacity>
            {!activeConversation?.communityId ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); void toggleBlock(); }}><Text style={styles.chatOptionIcon}>⊘</Text><Text style={styles.chatOptionText}>{activeConversation?.blockedAt ? "Unblock member" : "Block member"}</Text></TouchableOpacity> : null}
            {activeConversation?.communityId ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => void showGroupMembers()}><Text style={styles.chatOptionIcon}>♙</Text><Text style={styles.chatOptionText}>Group members</Text></TouchableOpacity> : null}
            {activeConversation?.communityId && (() => { const group = communities.find((item) => item.id === activeConversation.communityId); return Boolean(group?.canManageMembers); })() ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); setSelectedGroupPeople([]); void findPeopleFromContacts("add", activeConversation.communityId || ""); }}><Text style={styles.chatOptionIcon}>＋</Text><Text style={styles.chatOptionText}>Add people</Text></TouchableOpacity> : null}
            {activeConversation?.communityId && (() => { const group = communities.find((item) => item.id === activeConversation.communityId); return Boolean(group?.canManageMembers); })() ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => void changeActiveGroupPhoto()}><Text style={styles.chatOptionIcon}>▣</Text><Text style={styles.chatOptionText}>Change group image</Text></TouchableOpacity> : null}
            {activeConversation?.communityId && (() => { const group = communities.find((item) => item.id === activeConversation.communityId); return Boolean(group && (group.visibility === "PUBLIC" || group.canManageMembers)); })() ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => void inviteToActiveGroup()}><Text style={styles.chatOptionIcon}>↗</Text><Text style={styles.chatOptionText}>Invite with group link</Text></TouchableOpacity> : null}
            <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); setWallpaperPanelOpen(true); }}><Text style={styles.chatOptionIcon}>▧</Text><Text style={styles.chatOptionText}>Chat wallpaper</Text></TouchableOpacity>
            {Platform.OS === "android" ? <View style={styles.nearbyOptionRow}><View style={styles.nearbyOptionCopy}><Text style={styles.nearbyOptionTitle}>Nearby offline relay</Text><Text style={styles.nearbyOptionMeta}>{nearbyRelayStatus.state === "error" ? nearbyRelayStatus.detail : nearbyRelayEnabled ? `${nearbyRelayStatus.peers} nearby device${nearbyRelayStatus.peers === 1 ? "" : "s"}` : "Off · encrypted text only"}</Text></View><Switch value={nearbyRelayEnabled} onValueChange={(value) => void toggleNearbyRelay(value)} trackColor={{ false: "#aaa", true: "#5a83f3" }} /></View> : null}
          </View>
        ) : null}

        {groupMembersOpen ? (
          <View style={styles.groupMembersPanel}>
            <View style={styles.attachmentPanelHeader}><Text style={styles.attachmentPanelTitle}>Group members</Text><TouchableOpacity style={styles.attachmentClose} onPress={() => setGroupMembersOpen(false)}><Text style={styles.attachmentCloseText}>×</Text></TouchableOpacity></View>
            <ScrollView style={styles.groupMembersList}>
              {groupMembers.map((member) => {
                const currentRole = groupMembers.find((item) => item.isCurrentUser)?.role || "MEMBER";
                const canChangeRole = currentRole === "OWNER" && !member.isCurrentUser && member.role !== "OWNER";
                const canRemove = !member.isCurrentUser && member.role !== "OWNER" && (currentRole === "OWNER" || (currentRole === "ADMIN" && member.role === "MEMBER"));
                return <View key={member.id} style={styles.groupMemberRow}><View style={styles.groupMemberAvatar}><Text style={styles.groupMemberAvatarText}>{initials(member.name)}</Text></View><View style={styles.groupMemberCopy}><Text style={styles.groupMemberName}>{member.name}{member.isCurrentUser ? " · You" : ""}</Text><Text style={styles.groupMemberRole}>{member.role.toLowerCase()}</Text></View>{canChangeRole ? <View><TouchableOpacity onPress={() => void transferGroupTo(member)}><Text style={styles.groupMemberAction}>Make owner</Text></TouchableOpacity><TouchableOpacity onPress={() => void changeGroupMember(member, "ROLE")}><Text style={styles.groupMemberAction}>{member.role === "ADMIN" ? "Remove admin" : "Make admin"}</Text></TouchableOpacity></View> : null}{canRemove ? <TouchableOpacity onPress={() => void changeGroupMember(member, "REMOVE")}><Text style={[styles.groupMemberAction, styles.groupMemberRemove]}>Remove</Text></TouchableOpacity> : null}</View>;
              })}
            </ScrollView>
            <TouchableOpacity style={styles.leaveGroupButton} onPress={() => void leaveActiveGroup()}><Text style={styles.leaveGroupText}>Leave group</Text></TouchableOpacity>
          </View>
        ) : null}

        <ScrollView
          ref={messagesScrollRef}
          style={styles.threadMessages}
          contentContainerStyle={styles.threadMessagesContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          onContentSizeChange={() => messagesScrollRef.current?.scrollToEnd({ animated: false })}
        >
          {threadLoading && !messages.length ? <Text style={styles.emptyText}>Loading messages...</Text> : null}
          {!threadLoading && !messages.length ? (
            <View style={styles.emptyThread}>
              <Text style={styles.emptyThreadTitle}>No messages yet.</Text>
              <Text style={styles.emptyThreadCopy}>Send a message to start the conversation.</Text>
            </View>
          ) : null}
          {visibleMessages.map((message, index) => {
            const mediaGroupId = String(message.metadata?.mediaGroupId || "");
            if (mediaGroupId && String(visibleMessages[index - 1]?.metadata?.mediaGroupId || "") === mediaGroupId) return null;
            const mediaGroup = mediaGroupId
              ? visibleMessages.filter((candidate) => candidate.type === "IMAGE" && candidate.metadata?.mediaGroupId === mediaGroupId).sort((a, b) => Number(a.metadata?.mediaGroupIndex || 0) - Number(b.metadata?.mediaGroupIndex || 0))
              : [];
            const messageRunEnds = mediaGroup.length > 1 || endsMessageRun(visibleMessages, index);
            return (
            <React.Fragment key={message.id}>
            {index === 0 || chatDayKey(visibleMessages[index - 1].createdAt) !== chatDayKey(message.createdAt) ? <View style={styles.dateDivider}><View style={styles.dateDividerLine} /><Text style={styles.dateDividerText}>{chatDayLabel(message.createdAt)}</Text><View style={styles.dateDividerLine} /></View> : null}
            <View style={[styles.threadMessageRow, message.mine && styles.threadMessageRowMine, messageRunEnds && styles.threadMessageRunEnd]}>
              {!message.mine && Boolean(activeConversation?.communityId) && messageRunEnds ? (
                <View style={styles.smallAvatar}>
                  {chatPhotoUrl(message.senderPhotoUrl) ? <Image source={{ uri: chatPhotoUrl(message.senderPhotoUrl) }} style={styles.smallAvatarImage} /> : <Text style={styles.smallAvatarText}>{initials(message.senderName || "F")}</Text>}
                </View>
              ) : !message.mine && Boolean(activeConversation?.communityId) ? <View style={styles.smallAvatarSpacer} /> : null}
              <TouchableOpacity
                activeOpacity={selectedMessageIds.length ? 0.78 : 1}
                delayLongPress={350}
                onLongPress={() => toggleMessageSelection(message)}
                onPress={() => { if (selectedMessageIds.length) toggleMessageSelection(message); }}
                style={[styles.bubble, message.mine ? styles.myBubble : styles.theirBubble, selectedMessageIds.includes(messageSelectionKey(message)) && styles.selectedMessageBubble]}
              >
                {selectedMessageIds.includes(messageSelectionKey(message)) ? <View style={styles.messageSelectionCheck}><Text style={styles.messageSelectionCheckText}>✓</Text></View> : null}
                {messageRunEnds ? <View style={[styles.bubbleTail, message.mine ? styles.myBubbleTail : styles.theirBubbleTail]} /> : null}
                {!selectedMessageIds.length && (!message.mine || message.canEdit) && !["pending", "relayed", "failed"].includes(message.status) ? (
                  <TouchableOpacity style={styles.messageMenuButton} onPress={() => showMessageActions(message)} accessibilityLabel="Message options">
                    <Text style={[styles.messageMenuText, message.mine ? styles.myMessageMenuText : styles.theirMessageMenuText]}>•••</Text>
                  </TouchableOpacity>
                ) : null}
                {!message.mine && Boolean(activeConversation?.communityId) ? <View style={styles.senderLine}><Text style={styles.senderName}>{message.senderName}</Text><Text style={styles.senderTime}>· {chatClock(message.createdAt)}</Text></View> : null}
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
                  message.type === "IMAGE" ? mediaGroup.length > 1 ? <View style={styles.messageCollage}>{mediaGroup.slice(0, 4).map((photo, photoIndex) => <TouchableOpacity key={photo.id} style={styles.collageCell} onPress={() => void openAttachment(photo)} accessibilityLabel={`Preview photo ${photoIndex + 1} of ${mediaGroup.length}`}><ChatMessagePhoto message={photo} compact />{photoIndex === 3 && mediaGroup.length > 4 ? <View style={styles.collageMore}><Text style={styles.collageMoreText}>+{mediaGroup.length - 3}</Text></View> : null}</TouchableOpacity>)}</View> : <TouchableOpacity onPress={() => void openAttachment(message)} accessibilityLabel="Preview photo"><ChatMessagePhoto message={message} /></TouchableOpacity> : (
                    <TouchableOpacity style={styles.fileCard} onPress={() => void openAttachment(message)} accessibilityRole="button" accessibilityLabel={`Open or save ${String(message.metadata?.fileName || "FChat file")}`}>
                      <View style={[styles.attachmentIcon, styles.fileIcon, styles.fileCardIcon]}><Text style={styles.fileCardBadge}>{chatFileBadge(String(message.metadata?.fileName || ""), String(message.metadata?.mimeType || ""))}</Text></View>
                      <View style={styles.fileCardCopy}><Text style={styles.fileCardName} numberOfLines={2}>{message.metadata?.fileName || "FChat file"}</Text><Text style={styles.fileCardMeta}>{Math.max(1, Math.round(Number(message.metadata?.size || 0) / 1024))} KB · Tap to open or save</Text></View>
                    </TouchableOpacity>
                  )
                ) : null}
                {message.type === "POLL" ? (
                  <View style={styles.richCard}>
                    <Text style={styles.richEyebrow}>POLL</Text><Text style={styles.richTitle}>{message.metadata?.question || message.text}</Text>
                    {(message.metadata?.options || []).map((option, index) => {
                      const count = message.metadata?.voteCounts?.[index] || 0;
                      const selected = message.metadata?.selectedOption === index;
                      return <TouchableOpacity key={`${message.id}-${index}`} style={[styles.pollOption, selected && styles.pollOptionSelected]} onPress={() => void voteOnPoll(message, index)} accessibilityRole="button" accessibilityLabel={`Vote for ${option}. ${count} vote${count === 1 ? "" : "s"}`}><Text style={[styles.pollOptionText, selected && styles.pollOptionTextSelected]}>{option}</Text><Text style={[styles.pollCount, selected && styles.pollOptionTextSelected]}>{count}</Text></TouchableOpacity>;
                    })}
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
                {message.text && !["POLL", "EVENT", "CONTACT", "LOCATION"].includes(message.type) ? <Text style={[styles.bubbleText, message.mine ? styles.myBubbleText : styles.theirBubbleText]}>{message.text}</Text> : null}
                <View style={styles.bubbleMetaRow} accessibilityLabel={`${chatClock(message.createdAt)}${message.mine ? `, ${messageReceiptLabel(message.status)}` : ""}`}>
                  {message.editedAt ? <Text style={[styles.bubbleMeta, message.mine ? styles.myBubbleMeta : styles.theirBubbleMeta]}>Edited · </Text> : null}
                  <Text style={[styles.bubbleMeta, message.mine ? styles.myBubbleMeta : styles.theirBubbleMeta]}>{chatClock(message.createdAt)}</Text>
                  {message.mine && messageReceipt(message.status) ? <Text style={[styles.receiptMark, message.status === "seen" && styles.receiptSeen, message.status === "failed" && styles.receiptFailed]}>{messageReceipt(message.status)}</Text> : null}
                </View>
              </TouchableOpacity>
            </View>
            </React.Fragment>
            );
          })}
        </ScrollView>

        <Modal visible={Boolean(attachmentPreview)} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setAttachmentPreview(null)}>
          <View style={styles.attachmentPreviewBackdrop}>
            <View style={styles.attachmentPreviewHeader}>
              <Text style={styles.attachmentPreviewName} numberOfLines={1}>{attachmentPreview?.name || "FChat photo"}</Text>
              <TouchableOpacity style={styles.attachmentPreviewClose} onPress={() => setAttachmentPreview(null)} accessibilityLabel="Close photo preview"><Text style={styles.attachmentPreviewCloseText}>×</Text></TouchableOpacity>
            </View>
            {attachmentPreview ? <Image source={{ uri: attachmentPreview.uri }} style={styles.attachmentPreviewImage} resizeMode="contain" /> : null}
            <TouchableOpacity style={styles.attachmentPreviewSave} onPress={() => void savePreviewAttachment()}><Text style={styles.attachmentPreviewSaveText}>Save or share original</Text></TouchableOpacity>
          </View>
        </Modal>

        <Modal visible={forwardPickerOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setForwardPickerOpen(false)}>
          <View style={styles.forwardPickerBackdrop}>
            <View style={styles.forwardPickerCard}>
              <View style={styles.forwardPickerHeader}>
                <View><Text style={styles.forwardPickerTitle}>Forward messages</Text><Text style={styles.forwardPickerSubtitle}>Choose one or more FChat conversations</Text></View>
                <TouchableOpacity style={styles.attachmentPreviewClose} onPress={() => setForwardPickerOpen(false)}><Text style={styles.attachmentPreviewCloseText}>×</Text></TouchableOpacity>
              </View>
              <ScrollView style={styles.forwardPickerList}>
                {personConversations.filter((conversation) => conversation.id !== activeConversationId).map((conversation) => {
                  const selected = selectedForwardConversationIds.includes(conversation.id);
                  return <TouchableOpacity key={conversation.id} style={[styles.forwardPickerRow, selected && styles.forwardPickerRowSelected]} onPress={() => toggleForwardConversation(conversation.id)}>
                    <View style={styles.forwardPickerAvatar}>{chatPhotoUrl(conversation.otherPhotoUrl) ? <Image source={{ uri: chatPhotoUrl(conversation.otherPhotoUrl) }} style={styles.forwardPickerAvatarImage} /> : <Text style={styles.forwardPickerAvatarText}>{initials(conversation.otherName || conversation.subject)}</Text>}</View>
                    <View style={styles.forwardPickerCopy}><Text style={styles.forwardPickerName} numberOfLines={1}>{conversation.otherName || conversation.subject}</Text><Text style={styles.forwardPickerMeta} numberOfLines={1}>{conversation.communityId ? "Group" : conversation.lastMessage || "FChat conversation"}</Text></View>
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
              <Text style={styles.attachmentPanelTitle}>Add to FChat</Text>
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
            <View style={styles.attachmentPanelHeader}><Text style={styles.attachmentPanelTitle}>{richComposer === "POLL" ? "Create poll" : richComposer === "EVENT" ? "Create event" : "Share contact"}</Text><TouchableOpacity style={styles.attachmentClose} onPress={() => setRichComposer("")}><Text style={styles.attachmentCloseText}>×</Text></TouchableOpacity></View>
            <TextInput style={styles.richInput} placeholder={richComposer === "POLL" ? "Ask a question" : richComposer === "EVENT" ? "Event title" : "Contact name"} placeholderTextColor="#777" value={richDraft.primary} onChangeText={(primary) => setRichDraft((current) => ({ ...current, primary }))} />
            {richComposer === "EVENT" ? <DateTimeField label="Event date" mode="date" minimumDate={todayLocalIso()} value={richDraft.secondary} onChange={(secondary) => setRichDraft((current) => ({ ...current, secondary }))} /> : <TextInput style={[styles.richInput, richComposer === "POLL" && styles.richMultiline]} multiline={richComposer === "POLL"} placeholder={richComposer === "POLL" ? "Options, one per line" : "Phone number"} placeholderTextColor="#777" value={richDraft.secondary} onChangeText={(secondary) => setRichDraft((current) => ({ ...current, secondary }))} />}
            {richComposer === "EVENT" ? <DateTimeField label="Event time" mode="time" value={richDraft.tertiary} onChange={(tertiary) => setRichDraft((current) => ({ ...current, tertiary }))} /> : richComposer !== "POLL" ? <TextInput style={styles.richInput} placeholder="Email address" placeholderTextColor="#777" value={richDraft.tertiary} onChangeText={(tertiary) => setRichDraft((current) => ({ ...current, tertiary }))} /> : null}
            {richComposer === "EVENT" ? <TextInput style={styles.richInput} placeholder="Location" placeholderTextColor="#777" value={richDraft.fourth} onChangeText={(fourth) => setRichDraft((current) => ({ ...current, fourth }))} /> : null}
            <TouchableOpacity style={styles.richSubmit} onPress={() => void submitRichMessage()} disabled={threadLoading}><Text style={styles.richSubmitText}>{threadLoading ? "Sending…" : "Send"}</Text></TouchableOpacity>
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
          <View style={styles.pendingAttachmentCard}>
            <View style={styles.pendingCollagePreview}>
              {pendingImages.slice(0, 4).map((image, index) => <View key={`${image.uri}-${index}`} style={styles.pendingCollageCell}><PendingPhotoPreview uri={image.uri} compact />{index === 3 && pendingImages.length > 4 ? <View style={styles.pendingCollageMore}><Text style={styles.pendingCollageMoreText}>+{pendingImages.length - 3}</Text></View> : null}</View>)}
            </View>
            <View style={styles.pendingAttachmentCopy}><Text style={styles.pendingAttachmentName}>{pendingImages.length} photos selected</Text><Text style={styles.pendingAttachmentMeta}>Collage ready to send</Text></View>
            <TouchableOpacity style={styles.pendingAttachmentRemove} onPress={() => setPendingImages([])} accessibilityLabel="Remove selected photos"><Text style={styles.pendingAttachmentRemoveText}>×</Text></TouchableOpacity>
          </View>
        ) : pendingAttachment ? (
          <View style={styles.pendingAttachmentCard}>
            {pendingAttachment.kind === "IMAGE" ? <PendingPhotoPreview uri={pendingAttachment.uri} /> : <View style={[styles.attachmentIcon, styles.fileIcon, styles.pendingAttachmentFileIcon]}><Text style={styles.attachmentIconText}>▰</Text></View>}
            <View style={styles.pendingAttachmentCopy}><Text style={styles.pendingAttachmentName} numberOfLines={1}>{pendingAttachment.kind === "IMAGE" ? "Photo selected" : pendingAttachment.name}</Text><Text style={styles.pendingAttachmentMeta}>{pendingAttachment.kind === "IMAGE" ? "Ready to send" : `${Math.max(1, Math.round(pendingAttachment.size / 1024))} KB · Ready to send`}</Text></View>
            <TouchableOpacity style={styles.pendingAttachmentRemove} onPress={() => setPendingAttachment(null)} accessibilityLabel="Remove selected attachment"><Text style={styles.pendingAttachmentRemoveText}>×</Text></TouchableOpacity>
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

        {!pendingAttachment && !pendingImages.length && !editingMessageId && !emojiPickerOpen && !composerFocused ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickReplies} contentContainerStyle={styles.quickRepliesContent}>
            {[`Hi, ${(activeConversation?.otherName || "there").split(" ")[0]}`, `Hello, ${(activeConversation?.otherName || "there").split(" ")[0]}`, "👍"].map((reply) => <TouchableOpacity key={reply} style={styles.quickReply} onPress={() => setMessageText(reply)}><Text style={styles.quickReplyText}>{reply}</Text></TouchableOpacity>)}
          </ScrollView>
        ) : null}

        <BlurView intensity={52} tint="dark" style={styles.composer}>
          <TouchableOpacity style={styles.composerIcon} onPress={showComposerOptions} accessibilityLabel="Add attachment"><Text style={styles.paperclipIcon}>📎</Text></TouchableOpacity>
          <TouchableOpacity style={styles.composerEmoji} onPress={toggleEmojiPicker} accessibilityLabel="Choose emoji"><Text style={styles.composerEmojiText}>☺</Text></TouchableOpacity>
          <TextInput
            placeholder={editingMessageId ? "Edit message" : "Write a message…"}
            placeholderTextColor="#7c8493"
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
        </BlurView>
        {editingMessageId ? (
          <TouchableOpacity style={styles.cancelEdit} onPress={() => { setEditingMessageId(null); setMessageText(""); }}>
            <Text style={styles.cancelEditText}>Cancel edit</Text>
          </TouchableOpacity>
        ) : null}
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.screen, Platform.OS === "android" && styles.screenAndroid]}>
      <View style={styles.header}>
        <View style={styles.chatBrandWrap}>
          <Image source={appAssets.fchatWordmark} style={styles.chatBrand} resizeMode="contain" />
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity style={styles.headerIcon}><Text style={styles.headerIconText}>•••</Text></TouchableOpacity>
          <TouchableOpacity style={styles.headerIcon}><Text style={styles.headerIconText}>⛶</Text></TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => (signedIn ? setCreatingGroup((value) => !value) : onRequireLogin())}
        >
          <Text style={styles.iconButtonText}>✎</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          placeholder="Search name, phone, or invite link"
          placeholderTextColor={theme.colors.muted}
          style={[styles.search, styles.searchInput]}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={handleMessengerSearchSubmit}
          returnKeyType="search"
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.contactsButton} onPress={() => void findPeopleFromContacts()} disabled={contactsLoading} accessibilityLabel="Find people from contacts">
          <Text style={styles.contactsButtonIcon}>♙</Text>
          <Text style={styles.contactsButtonText}>{contactsLoading ? "Checking" : "Contacts"}</Text>
        </TouchableOpacity>
      </View>

      {search.trim().includes("group_invite=") ? <TouchableOpacity style={styles.searchAction} onPress={handleMessengerSearchSubmit}><Text style={styles.searchActionText}>Open group invitation</Text></TouchableOpacity> : null}
      {search.replace(/\D/g, "").length >= 10 && !search.includes("group_invite=") ? <TouchableOpacity style={styles.searchAction} onPress={handleMessengerSearchSubmit}><Text style={styles.searchActionText}>Message this FairFares member</Text></TouchableOpacity> : null}

      <View style={styles.tabs}>
        {(["All", "Unread", "Groups", "Communities"] as MessengerTab[]).map((item) => (
          <TouchableOpacity key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.activeTab]}>
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
                <Text style={styles.contactPickerSubtitle}>{contactPickerMode === "chat" ? "Select a member to open FChat" : "Select FairFares members to add"}</Text>
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
        {(tab === "All" || tab === "Unread" || tab === "Groups") && filteredConversations.map((chat) => (
          <TouchableOpacity key={chat.id} style={styles.chatRow} onPress={() => openConversation(chat)}>
            <View style={styles.avatar}>
              {chatPhotoUrl(chat.otherPhotoUrl) ? (
                <Image source={{ uri: chatPhotoUrl(chat.otherPhotoUrl) }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{initials(chat.otherName || chat.subject || "Chat")}</Text>
              )}
            </View>
            <View style={styles.chatCopy}>
              <Text style={styles.chatName}>{chat.otherName || chat.subject}</Text>
              <Text style={styles.chatLast} numberOfLines={1}>{chat.lastMessage || chat.rideRoute || chat.subject || "No messages yet."}</Text>
            </View>
            <View style={styles.chatMeta}>
              <Text style={styles.chatTime}>{relativeTime(chat.lastMessageAt)}</Text>
              {chat.unread ? <Text style={styles.unread}>{chat.unread}</Text> : null}
            </View>
          </TouchableOpacity>
        ))}

        {(tab === "All" || tab === "Groups" || tab === "Communities") && filteredCommunities.map((community) => (
          <TouchableOpacity key={community.id} style={styles.chatRow} onPress={() => openCommunityThread(community)}>
            <View style={[styles.avatar, styles.groupAvatar]}>{community.photoUrl ? <Image source={{ uri: chatPhotoUrl(community.photoUrl) }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>#</Text>}</View>
            <View style={styles.chatCopy}>
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
              <Text style={styles.memberCount}>{community.joined ? (community.canManageMembers || community.visibility === "PUBLIC" ? "Invite" : "Joined") : "Join"} · {community.memberCount}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        ))}

        {signedIn && !filteredConversations.length && !filteredCommunities.length ? (
          <Text style={styles.emptyList}>No chats found. Message a listing poster or create a group.</Text>
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
  screen: { flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md },
  screenAndroid: { paddingTop: 10 },
  threadScreen: { flex: 1, backgroundColor: theme.colors.bg, paddingTop: 0, paddingBottom: 0, position: "relative", overflow: "hidden" },
  threadScreenAndroid: { paddingBottom: 0 },
  wallpaperBase: { ...StyleSheet.absoluteFillObject },
  wallpaperImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  wallpaperShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.43)" },
  wallpaperGlow: { position: "absolute", width: 280, height: 280, borderRadius: 140, opacity: 0.26 },
  wallpaperGlowOne: { top: -90, right: -100 },
  wallpaperGlowTwo: { bottom: 90, left: -130 },
  wallpaperPattern: { position: "absolute", top: "47%", left: -20, color: "rgba(255,255,255,0.07)", fontSize: 25, letterSpacing: 13, transform: [{ rotate: "-12deg" }] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing.md },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  title: { color: theme.colors.text, fontSize: 24, fontWeight: "700" },
  chatBrandWrap: { flex: 1, minWidth: 0, gap: 2 },
  chatBrand: { width: 132, height: 42 },
  headerIcons: { flexDirection: "row", gap: 8, marginLeft: "auto", marginRight: 10 },
  headerIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  headerIconText: { color: theme.colors.muted, fontSize: 17, fontWeight: "900" },
  iconButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  iconButtonText: { color: theme.colors.text, fontSize: 20, fontWeight: "800", marginTop: -2 },
  search: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.pill, paddingHorizontal: 14, minHeight: 44, fontSize: 15 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, minWidth: 0 },
  contactsButton: { minHeight: 44, paddingHorizontal: 11, borderRadius: 18, backgroundColor: "#132849", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  contactsButtonIcon: { color: "#8fc2ff", fontSize: 16 },
  contactsButtonText: { color: "#d8e7ff", fontSize: 11, fontWeight: "600" },
  searchAction: { alignSelf: "flex-start", marginTop: 7, marginLeft: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: "#132849" },
  searchActionText: { color: "#8fc2ff", fontSize: 13, fontWeight: "600" },
  contactPickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", padding: 18, justifyContent: "center" },
  contactPickerCard: { width: "100%", maxWidth: 520, maxHeight: "72%", alignSelf: "center", backgroundColor: "#101827", borderRadius: 22, borderWidth: 1, borderColor: "#315d98", overflow: "hidden" },
  contactPickerHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  contactPickerHeadingCopy: { flex: 1, minWidth: 0 },
  contactPickerTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700" },
  contactPickerSubtitle: { color: theme.colors.muted, fontSize: 12, marginTop: 3 },
  contactPickerClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center", marginLeft: 10 },
  contactPickerCloseText: { color: theme.colors.soft, fontSize: 25, lineHeight: 27 },
  contactPickerList: { flexGrow: 0 },
  contactPickerListContent: { paddingVertical: 4 },
  contactPickerRow: { minHeight: 72, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  contactPickerRowSelected: { backgroundColor: "rgba(79,124,255,0.16)" },
  contactPickerMessageButton: { backgroundColor: theme.colors.blue, borderRadius: 17, paddingHorizontal: 12, paddingVertical: 8, marginLeft: 8 },
  contactPickerMessageText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  contactPickerPrivacy: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 16, paddingVertical: 12 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: theme.spacing.md },
  tab: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  activeTab: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  tabText: { color: theme.colors.text, fontWeight: "600" },
  activeTabText: { color: theme.colors.bg },
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
  sectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  input: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.md, paddingHorizontal: 13, minHeight: 45, fontSize: 14 },
  multiline: { minHeight: 82, paddingTop: 13, textAlignVertical: "top" },
  primaryButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingVertical: 13, alignItems: "center" },
  disabledButton: { opacity: 0.45 },
  primaryButtonText: { color: theme.colors.text, fontWeight: "900", fontSize: 15 },
  threadHeader: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, paddingTop: 7, paddingBottom: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.16)", backgroundColor: "rgba(8,15,27,0.74)", overflow: "hidden" },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 24, height: 24, justifyContent: "center" },
  backLine: { position: "absolute", width: 18, height: 4, borderRadius: 3, backgroundColor: theme.colors.blue, left: 2 },
  backLineTop: { transform: [{ rotate: "-45deg" }], top: 6 },
  backLineBottom: { transform: [{ rotate: "45deg" }], bottom: 5 },
  threadAvatar: { width: 43, height: 43, borderRadius: 22, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  threadAvatarImage: { width: "100%", height: "100%" },
  threadAvatarText: { color: "#0f172a", fontWeight: "700", fontSize: 15 },
  activeDot: { position: "absolute", right: 0, bottom: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.green, borderWidth: 2, borderColor: theme.colors.bg },
  threadHeaderCopy: { flex: 1 },
  threadHeaderTitle: { color: theme.colors.text, fontSize: 16.5, fontWeight: "600" },
  threadHeaderMeta: { color: "#c1c7d0", fontSize: 11.5, fontWeight: "400", marginTop: 2 },
  headerAction: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  messageSelectionBar: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.line, backgroundColor: "rgba(9,18,33,0.98)", zIndex: 12 },
  messageSelectionCancel: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.panel2 },
  messageSelectionCancelText: { color: theme.colors.text, fontSize: 25, lineHeight: 27, marginTop: -2 },
  messageSelectionTitle: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  messageSelectionAction: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, borderRadius: 18, borderWidth: 1, borderColor: "#315d98" },
  messageSelectionActionIcon: { color: "#8fb5ff", fontSize: 17 },
  messageSelectionActionText: { color: "#dce8ff", fontSize: 12, fontWeight: "600" },
  chatOptionsPanel: { position: "absolute", top: 58, right: 14, width: 258, backgroundColor: "#f7f3ed", borderRadius: 16, padding: 7, borderWidth: 1, borderColor: "#cbc7c0", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 15, shadowOffset: { width: 0, height: 7 }, elevation: 15, zIndex: 40 },
  chatOptionRow: { minHeight: 46, borderRadius: 11, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 11 },
  chatOptionIcon: { color: "#2864d7", width: 22, textAlign: "center", fontSize: 18, fontWeight: "900" },
  nearbyOptionRow: { minHeight: 58, borderTopWidth: 1, borderTopColor: "#ddd8d0", marginTop: 4, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  nearbyOptionCopy: { flex: 1, minWidth: 0 },
  nearbyOptionTitle: { color: "#1f2937", fontSize: 13, fontWeight: "700" },
  nearbyOptionMeta: { color: "#6b7280", fontSize: 10, lineHeight: 14, marginTop: 2 },
  chatOptionText: { color: "#242424", fontSize: 14, fontWeight: "600" },
  dotsIcon: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  dotIcon: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.blue },
  threadMessages: { flex: 1 },
  threadMessagesContent: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 10, gap: 2, flexGrow: 1, justifyContent: "flex-end" },
  threadMessageRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-start", gap: 5 },
  threadMessageRowMine: { justifyContent: "flex-end" },
  threadMessageRunEnd: { marginBottom: 7 },
  dateDivider: { alignSelf: "center", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5, marginVertical: 10, backgroundColor: "rgba(9,17,29,0.88)" },
  dateDividerLine: { display: "none" },
  dateDividerText: { color: "rgba(255,255,255,0.80)", fontSize: 10, fontWeight: "600", letterSpacing: 0.8 },
  smallAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  smallAvatarImage: { width: "100%", height: "100%" },
  smallAvatarText: { color: "#0f172a", fontWeight: "900", fontSize: 10 },
  smallAvatarSpacer: { width: 26 },
  emptyThread: { alignItems: "center", marginTop: "auto", marginBottom: "auto", gap: 6 },
  emptyThreadTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  emptyThreadCopy: { color: theme.colors.muted, fontSize: 14, fontWeight: "500" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 5, paddingHorizontal: 8, paddingTop: 7, paddingBottom: Platform.OS === "ios" ? 8 : 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(12,18,27,0.78)", overflow: "hidden" },
  composerIcon: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  paperclipIcon: { color: theme.colors.text, fontSize: 24 },
  composerEmoji: { width: 32, height: 40, alignItems: "center", justifyContent: "center" },
  composerEmojiText: { color: theme.colors.text, fontSize: 25, lineHeight: 28 },
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
  quickReply: { borderWidth: 1.5, borderColor: "#5f8fff", backgroundColor: "rgba(9,20,38,0.86)", borderRadius: 20, paddingHorizontal: 15, minHeight: 36, alignItems: "center", justifyContent: "center" },
  quickReplyText: { color: "#8db0ff", fontSize: 14, fontWeight: "600" },
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
  wallpaperChoiceLabel: { color: "#fff", fontSize: 11, fontWeight: "900", textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 4 },
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
  attachmentPreviewClose: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.13)", alignItems: "center", justifyContent: "center" },
  attachmentPreviewCloseText: { color: "#fff", fontSize: 28, lineHeight: 30, marginTop: -2 },
  attachmentPreviewImage: { flex: 1, width: "100%", minHeight: 200 },
  attachmentPreviewSave: { minHeight: 50, borderRadius: 25, backgroundColor: theme.colors.blue, alignItems: "center", justifyContent: "center", marginTop: 12 },
  attachmentPreviewSaveText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  forwardPickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.76)", paddingHorizontal: 16, justifyContent: "center" },
  forwardPickerCard: { width: "100%", maxWidth: 540, maxHeight: "78%", alignSelf: "center", backgroundColor: "#101827", borderRadius: 22, borderWidth: 1, borderColor: "#315d98", paddingBottom: 14, overflow: "hidden" },
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
  richComposerPanel: { position: "absolute", left: 8, bottom: 62, width: 340, maxWidth: "92%", backgroundColor: "#f7f3ed", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "#cbc7c0", shadowColor: "#000", shadowOpacity: 0.24, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 14, zIndex: 21, gap: 9 },
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
  pollOption: { minHeight: 38, borderRadius: 11, borderWidth: 1, borderColor: "#cbd5e1", paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pollOptionSelected: { backgroundColor: "#1463d9", borderColor: "#1463d9" },
  pollOptionText: { color: "#263244", fontSize: 12, fontWeight: "800", flex: 1 },
  pollOptionTextSelected: { color: "#fff" },
  pollCount: { color: "#667085", fontSize: 11, fontWeight: "900", marginLeft: 8 },
  composerInput: { flex: 1, color: "#101828", backgroundColor: "rgba(248,249,252,0.96)", borderRadius: 21, paddingHorizontal: 14, paddingVertical: 9, minHeight: 40, maxHeight: 110, fontSize: 16 },
  composerSend: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.blue, alignItems: "center", justifyContent: "center" },
  composerSendText: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
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
  selectedMessageBubble: { borderWidth: 2, borderColor: "#4f7cff" },
  messageSelectionCheck: { position: "absolute", top: -9, right: -9, width: 22, height: 22, borderRadius: 11, backgroundColor: "#356df3", borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center", zIndex: 5 },
  messageSelectionCheckText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  myBubble: { backgroundColor: "#d9fdd3", alignSelf: "flex-end", borderBottomRightRadius: 2 },
  theirBubble: { backgroundColor: "#ffffff", alignSelf: "flex-start", borderBottomLeftRadius: 2 },
  bubbleTail: { position: "absolute", bottom: 1, width: 11, height: 11, transform: [{ rotate: "45deg" }], zIndex: -1 },
  myBubbleTail: { right: -5, backgroundColor: "#d9fdd3" },
  theirBubbleTail: { left: -5, backgroundColor: "#ffffff" },
  senderLine: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  senderName: { color: "#17202d", fontSize: 12, fontWeight: "600" },
  senderTime: { color: "#667085", fontSize: 11, fontWeight: "700" },
  messageMenuButton: { position: "absolute", top: 3, right: 7, minWidth: 24, minHeight: 24, alignItems: "center", justifyContent: "center", zIndex: 2 },
  messageMenuText: { fontSize: 12, letterSpacing: 1, fontWeight: "700" },
  myMessageMenuText: { color: "#718075" },
  theirMessageMenuText: { color: "#7a8494" },
  messageContext: { borderLeftWidth: 4, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, minWidth: 190 },
  myMessageContext: { borderLeftColor: "#1689d8", backgroundColor: "rgba(255,255,255,0.50)" },
  theirMessageContext: { borderLeftColor: "#0f9f8f", backgroundColor: "rgba(8,122,109,0.10)" },
  messageContextType: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  myMessageContextType: { color: "#0879bb" },
  theirMessageContextType: { color: "#087f72" },
  messageContextTitle: { fontSize: 13, lineHeight: 17, fontWeight: "600" },
  myMessageContextTitle: { color: "#17202d" },
  theirMessageContextTitle: { color: "#17202d" },
  messageContextSubtitle: { fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: "700" },
  myMessageContextSubtitle: { color: "#596273" },
  theirMessageContextSubtitle: { color: "#596273" },
  bubbleText: { fontSize: 15.5, lineHeight: 20, fontWeight: "400" },
  messageImage: { width: 244, height: 230, borderRadius: 9, marginBottom: 4, backgroundColor: theme.colors.panel2 },
  messageCollage: { width: 246, flexDirection: "row", flexWrap: "wrap", gap: 3, borderRadius: 14, overflow: "hidden", marginBottom: 6 },
  collageCell: { width: 121.5, height: 121.5, overflow: "hidden", position: "relative", backgroundColor: theme.colors.panel2 },
  collageImage: { width: "100%", height: "100%", borderRadius: 0, marginBottom: 0 },
  collageMore: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.58)", alignItems: "center", justifyContent: "center" },
  collageMoreText: { color: "#fff", fontSize: 24, fontWeight: "700" },
  messageImageLoading: { alignItems: "center", justifyContent: "center" },
  messageImageLoadingText: { color: theme.colors.muted, fontSize: 12, fontWeight: "800" },
  myBubbleText: { color: "#111827" },
  theirBubbleText: { color: "#111827" },
  bubbleMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", alignSelf: "flex-end", gap: 3, marginTop: 1, minHeight: 14 },
  bubbleMeta: { fontSize: 10.5, fontWeight: "400" },
  myBubbleMeta: { color: "#66756a" },
  theirBubbleMeta: { color: "#6b7280" },
  receiptMark: { color: "#66756a", fontSize: 12, lineHeight: 14, fontWeight: "700", letterSpacing: -2 },
  receiptSeen: { color: "#1689d8" },
  receiptFailed: { color: "#dc2626", letterSpacing: 0 },
  messageBox: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "flex-end" },
  messageInput: { flex: 1, color: theme.colors.text, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.md, paddingHorizontal: 12, minHeight: 46, maxHeight: 110 },
  send: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingHorizontal: 18, minHeight: 46, justifyContent: "center" },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: theme.colors.text, fontWeight: "900" },
  cancelEdit: { alignSelf: "flex-start", marginTop: 8 },
  cancelEditText: { color: theme.colors.muted, fontWeight: "900" },
  list: { flex: 1 },
  listContent: { paddingBottom: 88 },
  chatRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8, gap: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 18, backgroundColor: "rgba(255,255,255,0.035)", shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  groupAvatar: { backgroundColor: "#172138" },
  avatarText: { color: theme.colors.text, fontWeight: "700", fontSize: 16 },
  chatCopy: { flex: 1 },
  chatName: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  chatSubject: { color: theme.colors.soft, marginTop: 2, fontSize: 13, fontWeight: "500" },
  chatLast: { color: theme.colors.muted, marginTop: 3 },
  chatMeta: { alignItems: "flex-end", minWidth: 34, gap: 6 },
  chatTime: { color: theme.colors.muted, fontWeight: "500", fontSize: 12 },
  unread: { backgroundColor: theme.colors.accent, color: theme.colors.text, borderRadius: 10, overflow: "hidden", paddingHorizontal: 8, fontWeight: "900" },
  memberCount: { color: theme.colors.muted, fontWeight: "600" },
  rowAction: { paddingVertical: 8, paddingLeft: 8 },
  groupMembersPanel: { position: "absolute", top: 78, right: 10, width: 360, maxWidth: "94%", maxHeight: 430, zIndex: 30, backgroundColor: "#111827", borderWidth: 1, borderColor: theme.colors.line, borderRadius: 20, padding: 14, elevation: 20, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 18 },
  groupMembersList: { maxHeight: 310 },
  groupMemberRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  groupMemberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#233253", alignItems: "center", justifyContent: "center" },
  groupMemberAvatarText: { color: theme.colors.text, fontSize: 12, fontWeight: "700" },
  groupMemberCopy: { flex: 1 },
  groupMemberName: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  groupMemberRole: { color: theme.colors.muted, fontSize: 11, marginTop: 2, textTransform: "capitalize" },
  groupMemberAction: { color: "#78a5ff", fontSize: 11, fontWeight: "600", padding: 5 },
  groupMemberRemove: { color: "#ff7c8c" },
  leaveGroupButton: { minHeight: 42, borderRadius: 13, borderWidth: 1, borderColor: "#843444", alignItems: "center", justifyContent: "center", marginTop: 12 },
  leaveGroupText: { color: "#ff8b99", fontSize: 13, fontWeight: "600" },
  chevron: { color: theme.colors.muted, fontSize: 26, marginTop: -2 },
  emptyList: { color: theme.colors.muted, fontWeight: "500", textAlign: "center", padding: theme.spacing.lg }
});
