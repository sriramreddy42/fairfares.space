import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Image, KeyboardAvoidingView, Linking, Platform, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  absoluteAssetUrl,
  blockChatUser,
  createChatCommunity,
  createChatGroupInvite,
  deleteChatMessage,
  editChatMessage,
  findChatPersonByPhone,
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
  sendChatMessage,
  sendEncryptedChatMessage,
  sendChatAttachment,
  sendChatRichMessage,
  startChatForPost,
  startChatForRide,
  transferChatGroupOwnership,
  updateChatGroupMemberRole,
  voteChatPoll
} from "../api/client";
import { appAssets } from "../assets";
import { DateTimeField, todayLocalIso } from "../components/DateTimeField";
import { theme } from "../theme";
import { BootstrapPayload, ChatConversation, ChatGroupMember, ChatMessage, Community, HousingPost, RidePost } from "../types";
import { pickChatImage, pickCompressedImages } from "../utils/imageUpload";
import { pickChatFile } from "../utils/fileUpload";
import { decryptEnvelope, DeviceIdentity, encryptForDevices, getOrCreateDeviceIdentity } from "../utils/chatCrypto";

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

const blankGroup = { name: "", area: "", description: "" };
const wallpaperChoices = [
  { id: "midnight", label: "Midnight", color: "#080d18", accent: "#163a6b" },
  { id: "ocean", label: "Ocean", color: "#071d2b", accent: "#0d6685" },
  { id: "forest", label: "Forest", color: "#0b211a", accent: "#206b50" },
  { id: "plum", label: "Plum", color: "#241329", accent: "#75487f" },
  { id: "sand", label: "Sand", color: "#30271f", accent: "#8a6c48" },
] as const;

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

function chatPhotoUrl(value?: string) {
  return value ? absoluteAssetUrl(value) : "";
}

function AuthenticatedChatImage({ attachmentUrl }: { attachmentUrl: string }) {
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
    return <View style={[styles.messageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Photo preview unavailable</Text></View>;
  }
  if (!previewSource) {
    return <View style={[styles.messageImage, styles.messageImageLoading]}><Text style={styles.messageImageLoadingText}>Loading photo…</Text></View>;
  }
  return <Image source={{ uri: previewSource }} style={styles.messageImage} resizeMode="cover" onError={() => setPreviewFailed(true)} />;
}

function PendingPhotoPreview({ uri }: { uri: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <View style={[styles.pendingAttachmentImage, styles.pendingPreviewFallback]}><Text style={styles.pendingPreviewFallbackText}>No preview</Text></View>;
  return <Image source={{ uri }} style={styles.pendingAttachmentImage} resizeMode="cover" onError={() => setFailed(true)} />;
}

export function MessengerScreen({ data, pendingPost, pendingRide, pendingGroupInvite, onRequireLogin, onClearPendingPost, onClearPendingRide, onClearPendingGroupInvite, onThreadModeChange, onUnreadCountChange }: Props) {
  const messagesScrollRef = useRef<ScrollView>(null);
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
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [richComposer, setRichComposer] = useState<"POLL" | "EVENT" | "CONTACT" | "">("");
  const [richDraft, setRichDraft] = useState({ primary: "", secondary: "", tertiary: "", fourth: "" });
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<{ kind: "IMAGE" | "FILE"; uri: string; blob?: Blob; name: string; mimeType: string; size: number } | null>(null);
  const [wallpaperPanelOpen, setWallpaperPanelOpen] = useState(false);
  const [chatOptionsOpen, setChatOptionsOpen] = useState(false);
  const [groupMembersOpen, setGroupMembersOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState<ChatGroupMember[]>([]);
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentity | null>(null);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [wallpaper, setWallpaper] = useState("midnight");
  const [customWallpaper, setCustomWallpaper] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [phoneSearch, setPhoneSearch] = useState("");
  const [groupInvite, setGroupInvite] = useState("");
  const [groupDraft, setGroupDraft] = useState(blankGroup);
  const inThread = signedIn && (Boolean(activeConversationId) || Boolean(pendingPost) || Boolean(pendingRide));

  useEffect(() => {
    setConversations(data?.chat.conversations || []);
    setCommunities(data?.communities || []);
  }, [data?.chat.conversations, data?.communities]);

  useEffect(() => {
    const userId = Number(data?.user?.id || 0);
    if (!userId || Platform.OS === "web") return;
    getOrCreateDeviceIdentity(userId)
      .then(async (identity) => {
        await registerChatDeviceKey(identity.deviceId, identity.publicKey);
        setDeviceIdentity(identity);
      })
      .catch(() => setDeviceIdentity(null));
  }, [data?.user?.id]);

  async function decryptMessages(conversationId: string, nextMessages: ChatMessage[]) {
    if (!deviceIdentity || Platform.OS === "web") return nextMessages;
    try {
      const [envelopePayload, keyPayload] = await Promise.all([
        getChatEncryptedEnvelopes(conversationId, deviceIdentity.deviceId), getChatDeviceKeys(conversationId)
      ]);
      setEncryptionReady(Boolean(keyPayload.ready));
      const byMessage = new Map(envelopePayload.envelopes.map((item) => [item.messageId, item]));
      return nextMessages.map((message) => {
        const envelope = byMessage.get(message.id);
        if (!envelope) return message;
        const clearText = decryptEnvelope(envelope, deviceIdentity);
        return { ...message, text: clearText || "Unable to decrypt this message on this device." };
      });
    } catch {
      setEncryptionReady(false);
      return nextMessages;
    }
  }

  useEffect(() => {
    if (!pendingGroupInvite) return;
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    let cancelled = false;
    setLoading(true);
    joinChatGroupInvite(pendingGroupInvite)
      .then(async (response) => {
        if (cancelled) return;
        onClearPendingGroupInvite?.();
        setCommunities((current) => [response.community, ...current.filter((item) => item.id !== response.community.id)]);
        await openCommunityThread(response.community);
      })
      .catch((error) => {
        if (!cancelled) Alert.alert("Could not join group", error instanceof Error ? error.message : "This invitation is not valid.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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
        } catch {
          if (!cancelled) await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [signedIn, activeConversationId]);

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
    return communities.filter((community) => {
      const matchesSearch = !query || `${community.name} ${community.description} ${community.area}`.toLowerCase().includes(query);
      const matchesTab = tab === "All" || tab === "Groups" || tab === "Communities";
      const kindMatches = tab !== "Groups" || community.kind === "GROUP";
      return matchesSearch && matchesTab && kindMatches;
    });
  }, [communities, search, tab]);

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
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    if (pendingAttachment) {
      if (!activeConversationId) {
        Alert.alert("Opening FChat", "Wait a moment while FairFares verifies the conversation.");
        return;
      }
      setThreadLoading(true);
      setAttachmentStatus(pendingAttachment.kind === "IMAGE" ? "Sending photo…" : `Sending ${pendingAttachment.name}…`);
      try {
        const response = await sendChatAttachment(activeConversationId, pendingAttachment, cleanMessage);
        setMessages((current) => [...current.filter((item) => item.id !== response.message.id), response.message].sort((a, b) => a.id - b.id));
        const sentKind = pendingAttachment.kind;
        setPendingAttachment(null);
        setMessageText("");
        setAttachmentStatus(sentKind === "IMAGE" ? "Photo sent" : "File sent");
        setTimeout(() => setAttachmentStatus(""), 1600);
        onClearPendingPost?.();
        onClearPendingRide?.();
        await refreshMessenger();
      } catch (error) {
        setAttachmentStatus("");
        Alert.alert(pendingAttachment.kind === "IMAGE" ? "Image failed" : "File failed", error instanceof Error ? error.message : "Could not send this attachment.");
      } finally {
        setThreadLoading(false);
      }
      return;
    }
    if (!cleanMessage) {
      Alert.alert("Message required", "Type a message or select an attachment before sending.");
      return;
    }
    setThreadLoading(true);
    try {
      if (activeConversationId && editingMessageId) {
        const response = await editChatMessage(activeConversationId, editingMessageId, cleanMessage);
        setMessages((current) => current.map((item) => (item.id === editingMessageId ? response.message : item)));
        setEditingMessageId(null);
      } else if (pendingPost) {
        const response = await startChatForPost(pendingPost.id, cleanMessage);
        setActiveConversationId(response.conversation.id);
        setActiveSubject(response.conversation.subject || pendingPost.title);
        setActiveConversation({
          ...response.conversation,
          id: response.conversation.id,
          communityId: response.conversation.communityId,
          kind: response.conversation.communityId ? "GROUP" : "HOST_GUEST",
          subject: response.conversation.subject || pendingPost.title,
          otherName: response.conversation.otherName || listingPosterName(pendingPost),
          otherPhotoUrl: response.conversation.otherPhotoUrl,
          lastMessage: cleanMessage,
          lastMessageAt: new Date().toISOString(),
          unread: 0
        });
        setMessages(response.message ? [response.message] : []);
      } else if (pendingRide) {
        const response = await startChatForRide(pendingRide.id, cleanMessage);
        setActiveConversationId(response.conversation.id);
        setActiveSubject(response.conversation.subject || rideContextLabel(pendingRide));
        setActiveConversation({
          ...response.conversation,
          id: response.conversation.id,
          kind: response.conversation.kind || "RIDE",
          subject: response.conversation.subject || rideContextLabel(pendingRide),
          otherName: response.conversation.otherName || rideOwnerName(pendingRide),
          otherPhotoUrl: response.conversation.otherPhotoUrl,
          lastMessage: cleanMessage,
          lastMessageAt: new Date().toISOString(),
          unread: 0
        });
        setMessages(response.message ? [response.message] : []);
        onClearPendingRide?.();
      } else if (activeConversationId) {
        if (deviceIdentity && encryptionReady && Platform.OS !== "web") {
          const keyPayload = await getChatDeviceKeys(activeConversationId);
          if (!keyPayload.ready) throw new Error(keyPayload.warning || "Encryption keys are not ready.");
          const envelopes = encryptForDevices(cleanMessage, deviceIdentity, keyPayload.keys);
          const response = await sendEncryptedChatMessage(activeConversationId, envelopes);
          setMessages((current) => [...current, { ...response.message, text: cleanMessage }]);
        } else {
          const response = await sendChatMessage(activeConversationId, cleanMessage);
          setMessages((current) => [...current, response.message]);
        }
      } else {
        Alert.alert("Choose a chat", "Open a listing or conversation first.");
        return;
      }
      setMessageText("");
      await refreshMessenger();
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
    setLoading(true);
    try {
      const response = await createChatCommunity(name, "GROUP", groupDraft.description.trim(), groupDraft.area.trim());
      setCommunities((current) => [response.community, ...current.filter((community) => community.id !== response.community.id)]);
      setGroupDraft(blankGroup);
      setCreatingGroup(false);
      if (response.community.joinUrl) {
        await Share.share({ message: `Join ${response.community.name} on FairFares: ${response.community.joinUrl}` });
      }
    } catch (error) {
      Alert.alert("Group failed", error instanceof Error ? error.message : "Could not create this group.");
    } finally {
      setLoading(false);
    }
  }

  async function joinPrivateGroup() {
    if (!groupInvite.trim()) {
      Alert.alert("Invitation required", "Paste the private FairFares group invitation link.");
      return;
    }
    setLoading(true);
    try {
      const response = await joinChatGroupInvite(groupInvite);
      setGroupInvite("");
      setCommunities((current) => [response.community, ...current.filter((item) => item.id !== response.community.id)]);
      await openCommunityThread(response.community);
    } catch (error) {
      Alert.alert("Could not join group", error instanceof Error ? error.message : "Check the invitation and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function startPhoneChat() {
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    if (phoneSearch.replace(/\D/g, "").length < 10) {
      Alert.alert("Complete number required", "Enter the full phone number, including country code.");
      return;
    }
    setLoading(true);
    try {
      const found = await findChatPersonByPhone(phoneSearch);
      const response = await openChatWithPerson(found.person.id);
      setActiveConversationId(response.conversation.id);
      setActiveConversation(response.conversation);
      setActiveSubject(found.person.name);
      setPhoneSearch("");
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
      if (inviteUrl) await Share.share({ message: `Join ${community.name} on FairFares: ${inviteUrl}` });
    } catch (error) {
      Alert.alert("Invite unavailable", error instanceof Error ? error.message : "Only group owners and admins can invite members.");
    }
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
    try {
      await leaveChatGroup(communityId);
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
      const image = await pickChatImage(1600, 0.76);
      if (!image) return;
      setPendingAttachment({ kind: "IMAGE", ...image });
    } catch (error) {
      setAttachmentStatus("");
      Alert.alert("Image failed", error instanceof Error ? error.message : "Could not send this image.");
    }
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
      const response = await sendChatRichMessage(activeConversationId, richComposer, metadata);
      setMessages((current) => [...current.filter((item) => item.id !== response.message.id), response.message].sort((a, b) => a.id - b.id));
      setRichComposer("");
      await refreshMessenger();
    } catch (error) {
      Alert.alert(`${richComposer.toLowerCase()} failed`, error instanceof Error ? error.message : "Could not send this item.");
    } finally {
      setThreadLoading(false);
    }
  }

  async function voteOnPoll(message: ChatMessage, optionIndex: number) {
    try {
      const response = await voteChatPoll(message.id, optionIndex);
      setMessages((current) => current.map((item) => item.id === message.id ? response.message : item));
    } catch (error) {
      Alert.alert("Vote failed", error instanceof Error ? error.message : "Could not save your vote.");
    }
  }

  async function openFile(message: ChatMessage) {
    if (!message.attachmentUrl) return;
    try {
      const dataUrl = await getAuthenticatedAssetDataUrl(message.attachmentUrl);
      await Linking.openURL(dataUrl);
    } catch (error) {
      Alert.alert("File unavailable", error instanceof Error ? error.message : "Could not open this file.");
    }
  }

  function showComposerOptions() {
    setAttachmentMenuOpen((current) => !current);
  }

  function showChatOptions() {
    setChatOptionsOpen((current) => !current);
  }

  function editMessage(message: ChatMessage) {
    if (!message.canEdit) return;
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

  function closeThread() {
    setActiveConversationId("");
    setActiveConversation(null);
    setActiveSubject("");
    setMessages([]);
    setMessageText("");
    setEditingMessageId(null);
    setAttachmentMenuOpen(false);
    setWallpaperPanelOpen(false);
    setChatOptionsOpen(false);
    setGroupMembersOpen(false);
    setGroupMembers([]);
    setAttachmentStatus("");
    setPendingAttachment(null);
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
        <View style={styles.threadHeader}>
          <TouchableOpacity style={styles.backButton} onPress={closeThread}>
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
              {encryptionReady ? "🔒 End-to-end encrypted" : presenceLabel(activeConversation)}
            </Text>
          </View>
          <TouchableOpacity style={styles.headerAction} onPress={showChatOptions} accessibilityLabel="Chat options"><DotsIcon /></TouchableOpacity>
        </View>

        {chatOptionsOpen ? (
          <View style={styles.chatOptionsPanel}>
            <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); void toggleMute(); }}><Text style={styles.chatOptionIcon}>◉</Text><Text style={styles.chatOptionText}>{activeConversation?.mutedAt ? "Unmute notifications" : "Mute notifications"}</Text></TouchableOpacity>
            {!activeConversation?.communityId ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); void toggleBlock(); }}><Text style={styles.chatOptionIcon}>⊘</Text><Text style={styles.chatOptionText}>{activeConversation?.blockedAt ? "Unblock member" : "Block member"}</Text></TouchableOpacity> : null}
            {activeConversation?.communityId ? <TouchableOpacity style={styles.chatOptionRow} onPress={() => void showGroupMembers()}><Text style={styles.chatOptionIcon}>♙</Text><Text style={styles.chatOptionText}>Group members</Text></TouchableOpacity> : null}
            <TouchableOpacity style={styles.chatOptionRow} onPress={() => { setChatOptionsOpen(false); setWallpaperPanelOpen(true); }}><Text style={styles.chatOptionIcon}>▧</Text><Text style={styles.chatOptionText}>Chat wallpaper</Text></TouchableOpacity>
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
          {messages.map((message, index) => (
            <React.Fragment key={message.id}>
            {index === 0 || chatDayKey(messages[index - 1].createdAt) !== chatDayKey(message.createdAt) ? <View style={styles.dateDivider}><View style={styles.dateDividerLine} /><Text style={styles.dateDividerText}>{chatDayLabel(message.createdAt)}</Text><View style={styles.dateDividerLine} /></View> : null}
            <View style={[styles.threadMessageRow, message.mine && styles.threadMessageRowMine]}>
              {!message.mine ? (
                <View style={styles.smallAvatar}>
                  {chatPhotoUrl(message.senderPhotoUrl) ? <Image source={{ uri: chatPhotoUrl(message.senderPhotoUrl) }} style={styles.smallAvatarImage} /> : <Text style={styles.smallAvatarText}>{initials(message.senderName || "F")}</Text>}
                </View>
              ) : null}
              <View style={[styles.bubble, message.mine ? styles.myBubble : styles.theirBubble]}>
                {!message.mine ? <View style={styles.senderLine}><Text style={styles.senderName}>{message.senderName}</Text><Text style={styles.senderTime}>· {chatClock(message.createdAt)}</Text></View> : null}
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
                  message.type === "IMAGE" ? <AuthenticatedChatImage attachmentUrl={message.attachmentUrl} /> : (
                    <TouchableOpacity style={styles.fileCard} onPress={() => void openFile(message)}>
                      <View style={[styles.attachmentIcon, styles.fileIcon, styles.fileCardIcon]}><Text style={styles.attachmentIconText}>▰</Text></View>
                      <View style={styles.fileCardCopy}><Text style={styles.fileCardName} numberOfLines={2}>{message.metadata?.fileName || "FChat file"}</Text><Text style={styles.fileCardMeta}>{Math.max(1, Math.round(Number(message.metadata?.size || 0) / 1024))} KB · Tap to open</Text></View>
                    </TouchableOpacity>
                  )
                ) : null}
                {message.type === "POLL" ? (
                  <View style={styles.richCard}>
                    <Text style={styles.richEyebrow}>POLL</Text><Text style={styles.richTitle}>{message.metadata?.question || message.text}</Text>
                    {(message.metadata?.options || []).map((option, index) => {
                      const count = message.metadata?.voteCounts?.[index] || 0;
                      const selected = message.metadata?.selectedOption === index;
                      return <TouchableOpacity key={`${message.id}-${index}`} style={[styles.pollOption, selected && styles.pollOptionSelected]} onPress={() => void voteOnPoll(message, index)}><Text style={[styles.pollOptionText, selected && styles.pollOptionTextSelected]}>{option}</Text><Text style={[styles.pollCount, selected && styles.pollOptionTextSelected]}>{count}</Text></TouchableOpacity>;
                    })}
                  </View>
                ) : null}
                {message.type === "EVENT" ? <View style={styles.richCard}><Text style={styles.richEyebrow}>EVENT</Text><Text style={styles.richTitle}>{message.metadata?.title}</Text><Text style={styles.richDetail}>▦ {message.metadata?.date}{message.metadata?.time ? ` · ${message.metadata.time}` : ""}</Text>{message.metadata?.location ? <Text style={styles.richDetail}>⌖ {message.metadata.location}</Text> : null}</View> : null}
                {message.type === "CONTACT" ? <View style={styles.richCard}><Text style={styles.richEyebrow}>CONTACT</Text><Text style={styles.richTitle}>{message.metadata?.name}</Text>{message.metadata?.phone ? <TouchableOpacity onPress={() => Linking.openURL(`tel:${message.metadata?.phone}`)}><Text style={styles.richLink}>☎ {message.metadata.phone}</Text></TouchableOpacity> : null}{message.metadata?.email ? <TouchableOpacity onPress={() => Linking.openURL(`mailto:${message.metadata?.email}`)}><Text style={styles.richLink}>✉ {message.metadata.email}</Text></TouchableOpacity> : null}</View> : null}
                {message.text && !["POLL", "EVENT", "CONTACT"].includes(message.type) ? <Text style={[styles.bubbleText, message.mine ? styles.myBubbleText : styles.theirBubbleText]}>{message.text}</Text> : null}
                <Text style={[styles.bubbleMeta, message.mine ? styles.myBubbleMeta : styles.theirBubbleMeta]}>
                  {message.editedAt ? "Edited · " : ""}
                  {message.mine ? `${chatClock(message.createdAt)} · ${message.status === "seen" ? "Seen" : message.status === "delivered" ? "Delivered" : "Sent"}` : ""}
                </Text>
                <View style={styles.messageActions}>
                  {message.mine && message.canEdit ? (
                    <>
                      <TouchableOpacity onPress={() => editMessage(message)}><Text style={styles.messageActionText}>Edit</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteMessage(message)}><Text style={styles.messageActionText}>Delete</Text></TouchableOpacity>
                    </>
                  ) : null}
                  {!message.mine ? (
                    <TouchableOpacity onPress={() => reportMessage(message)}><Text style={styles.messageActionText}>Report</Text></TouchableOpacity>
                  ) : null}
                </View>
              </View>
            </View>
            </React.Fragment>
          ))}
        </ScrollView>

        {attachmentMenuOpen ? (
          <View style={styles.attachmentPanel}>
            <View style={styles.attachmentPanelHeader}>
              <Text style={styles.attachmentPanelTitle}>Add to FChat</Text>
              <TouchableOpacity style={styles.attachmentClose} onPress={() => setAttachmentMenuOpen(false)} accessibilityLabel="Close attachments">
                <Text style={styles.attachmentCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.attachmentGrid}>
              <TouchableOpacity style={styles.attachmentTile} onPress={() => void chooseAndSendFile()}>
                <View style={[styles.attachmentIcon, styles.fileIcon]}><Text style={styles.attachmentIconText}>▰</Text></View>
                <Text style={styles.attachmentLabel}>File</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachmentTile} onPress={() => void chooseAndSendImage()}>
                <View style={[styles.attachmentIcon, styles.photoIcon]}><Text style={styles.attachmentIconText}>▧</Text></View>
                <Text style={styles.attachmentLabel}>Photos</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachmentTile} onPress={() => openRichComposer("POLL")}>
                <View style={[styles.attachmentIcon, styles.pollIcon]}><Text style={styles.attachmentIconText}>≡</Text></View>
                <Text style={styles.attachmentLabel}>Poll</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachmentTile} onPress={() => openRichComposer("EVENT")}>
                <View style={[styles.attachmentIcon, styles.eventIcon]}><Text style={styles.attachmentIconText}>▦</Text></View>
                <Text style={styles.attachmentLabel}>Event</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachmentTile} onPress={() => openRichComposer("CONTACT")}>
                <View style={[styles.attachmentIcon, styles.contactIcon]}><Text style={styles.attachmentIconText}>●</Text></View>
                <Text style={styles.attachmentLabel}>Contact</Text>
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

        {pendingAttachment ? (
          <View style={styles.pendingAttachmentCard}>
            {pendingAttachment.kind === "IMAGE" ? <PendingPhotoPreview uri={pendingAttachment.uri} /> : <View style={[styles.attachmentIcon, styles.fileIcon, styles.pendingAttachmentFileIcon]}><Text style={styles.attachmentIconText}>▰</Text></View>}
            <View style={styles.pendingAttachmentCopy}><Text style={styles.pendingAttachmentName} numberOfLines={1}>{pendingAttachment.kind === "IMAGE" ? "Photo selected" : pendingAttachment.name}</Text><Text style={styles.pendingAttachmentMeta}>{pendingAttachment.kind === "IMAGE" ? "Ready to send" : `${Math.max(1, Math.round(pendingAttachment.size / 1024))} KB · Ready to send`}</Text></View>
            <TouchableOpacity style={styles.pendingAttachmentRemove} onPress={() => setPendingAttachment(null)} accessibilityLabel="Remove selected attachment"><Text style={styles.pendingAttachmentRemoveText}>×</Text></TouchableOpacity>
          </View>
        ) : null}

        {!pendingAttachment && !editingMessageId ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickReplies} contentContainerStyle={styles.quickRepliesContent}>
            {[`Hi, ${(activeConversation?.otherName || "there").split(" ")[0]}`, `Hello, ${(activeConversation?.otherName || "there").split(" ")[0]}`, "👍"].map((reply) => <TouchableOpacity key={reply} style={styles.quickReply} onPress={() => setMessageText(reply)}><Text style={styles.quickReplyText}>{reply}</Text></TouchableOpacity>)}
          </ScrollView>
        ) : null}

        <View style={styles.composer}>
          <TouchableOpacity style={styles.composerIcon} onPress={showComposerOptions} accessibilityLabel="Add attachment"><Text style={styles.paperclipIcon}>📎</Text></TouchableOpacity>
          <TextInput
            placeholder={editingMessageId ? "Edit message" : "Write a message…"}
            placeholderTextColor="#7c8493"
            style={styles.composerInput}
            value={messageText}
            onChangeText={setMessageText}
            multiline
          />
          <TouchableOpacity accessibilityLabel={pendingAttachment ? "Send attachment" : "Send message"} style={[styles.composerSend, threadLoading && styles.sendDisabled]} onPress={sendMessage} disabled={threadLoading}>
            {editingMessageId ? <Text style={styles.composerSendText}>✓</Text> : <SendIcon />}
          </TouchableOpacity>
        </View>
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

      <TextInput
        placeholder="Search Messenger"
        placeholderTextColor={theme.colors.muted}
        style={styles.search}
        value={search}
        onChangeText={setSearch}
      />

      <View style={styles.tabs}>
        {(["All", "Unread", "Groups", "Communities"] as MessengerTab[]).map((item) => (
          <TouchableOpacity key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.activeTab]}>
            <Text style={[styles.tabText, tab === item && styles.activeTabText]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>

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
          <Text style={styles.sectionTitle}>Message by phone</Text>
          <Text style={styles.loginCopy}>Enter the exact number of a member who enabled phone discovery. Their number stays private.</Text>
          <TextInput
            placeholder="Country code and phone number"
            placeholderTextColor={theme.colors.muted}
            value={phoneSearch}
            onChangeText={setPhoneSearch}
            style={styles.input}
            keyboardType="phone-pad"
          />
          <TouchableOpacity style={styles.primaryButton} onPress={startPhoneChat} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? "Finding..." : "Find and message"}</Text>
          </TouchableOpacity>
          <View style={styles.composerDivider} />
          <Text style={styles.sectionTitle}>Join a private group</Text>
          <TextInput
            placeholder="Paste invitation link"
            placeholderTextColor={theme.colors.muted}
            value={groupInvite}
            onChangeText={setGroupInvite}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={joinPrivateGroup} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? "Checking..." : "Join securely"}</Text>
          </TouchableOpacity>
          <View style={styles.composerDivider} />
          <Text style={styles.sectionTitle}>Create a group</Text>
          <TextInput
            placeholder="Group name, e.g. Denver roommates"
            placeholderTextColor={theme.colors.muted}
            value={groupDraft.name}
            onChangeText={(name) => setGroupDraft((current) => ({ ...current, name }))}
            style={styles.input}
          />
          <TextInput
            placeholder="Area, city, or community"
            placeholderTextColor={theme.colors.muted}
            value={groupDraft.area}
            onChangeText={(area) => setGroupDraft((current) => ({ ...current, area }))}
            style={styles.input}
          />
          <TextInput
            placeholder="What is this group for?"
            placeholderTextColor={theme.colors.muted}
            value={groupDraft.description}
            onChangeText={(description) => setGroupDraft((current) => ({ ...current, description }))}
            style={[styles.input, styles.multiline]}
            multiline
          />
          <TouchableOpacity style={styles.primaryButton} onPress={createGroup} disabled={loading}>
            <Text style={styles.primaryButtonText}>{loading ? "Creating..." : "Create and share"}</Text>
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
            <View style={[styles.avatar, styles.groupAvatar]}><Text style={styles.avatarText}>#</Text></View>
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
  threadScreen: { flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: theme.spacing.md, paddingTop: 8, paddingBottom: 18, position: "relative", overflow: "hidden" },
  threadScreenAndroid: { paddingBottom: 4 },
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
  composerDivider: { height: 1, backgroundColor: theme.colors.line, marginVertical: 4 },
  sectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  input: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.md, paddingHorizontal: 13, minHeight: 45, fontSize: 14 },
  multiline: { minHeight: 82, paddingTop: 13, textAlignVertical: "top" },
  primaryButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingVertical: 13, alignItems: "center" },
  primaryButtonText: { color: theme.colors.text, fontWeight: "900", fontSize: 15 },
  threadHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 4, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 24, height: 24, justifyContent: "center" },
  backLine: { position: "absolute", width: 18, height: 4, borderRadius: 3, backgroundColor: theme.colors.blue, left: 2 },
  backLineTop: { transform: [{ rotate: "-45deg" }], top: 6 },
  backLineBottom: { transform: [{ rotate: "45deg" }], bottom: 5 },
  threadAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  threadAvatarImage: { width: "100%", height: "100%" },
  threadAvatarText: { color: "#0f172a", fontWeight: "700", fontSize: 15 },
  activeDot: { position: "absolute", right: 0, bottom: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.green, borderWidth: 2, borderColor: theme.colors.bg },
  threadHeaderCopy: { flex: 1 },
  threadHeaderTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  threadHeaderMeta: { color: theme.colors.muted, fontSize: 13, fontWeight: "500", marginTop: 1 },
  headerAction: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  chatOptionsPanel: { position: "absolute", top: 58, right: 14, width: 220, backgroundColor: "#f7f3ed", borderRadius: 16, padding: 7, borderWidth: 1, borderColor: "#cbc7c0", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 15, shadowOffset: { width: 0, height: 7 }, elevation: 15, zIndex: 40 },
  chatOptionRow: { minHeight: 46, borderRadius: 11, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 11 },
  chatOptionIcon: { color: "#2864d7", width: 22, textAlign: "center", fontSize: 18, fontWeight: "900" },
  chatOptionText: { color: "#242424", fontSize: 14, fontWeight: "600" },
  dotsIcon: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  dotIcon: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.blue },
  threadMessages: { flex: 1 },
  threadMessagesContent: { paddingVertical: 16, gap: 10, flexGrow: 1, justifyContent: "flex-end" },
  threadMessageRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "flex-start", gap: 8 },
  threadMessageRowMine: { justifyContent: "flex-end" },
  dateDivider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 10 },
  dateDividerLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.22)" },
  dateDividerText: { color: "rgba(255,255,255,0.72)", fontSize: 10, fontWeight: "600", letterSpacing: 1.4 },
  smallAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  smallAvatarImage: { width: "100%", height: "100%" },
  smallAvatarText: { color: "#0f172a", fontWeight: "900", fontSize: 10 },
  emptyThread: { alignItems: "center", marginTop: "auto", marginBottom: "auto", gap: 6 },
  emptyThreadTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  emptyThreadCopy: { color: theme.colors.muted, fontSize: 14, fontWeight: "500" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingTop: 10, paddingBottom: 4, borderTopWidth: 1, borderTopColor: theme.colors.line },
  composerIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  paperclipIcon: { color: theme.colors.text, fontSize: 24 },
  quickReplies: { flexGrow: 0, marginTop: 8 },
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
  pollIcon: { backgroundColor: "#ffad32" },
  eventIcon: { backgroundColor: "#f23d63" },
  contactIcon: { backgroundColor: "#e45d2a" },
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
  pendingAttachmentCard: { minHeight: 68, borderRadius: 16, backgroundColor: "rgba(247,249,253,0.97)", borderWidth: 1, borderColor: "#d6dce7", padding: 8, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  pendingAttachmentImage: { width: 72, height: 72, borderRadius: 12, backgroundColor: "#dde3ec" },
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
  fileCard: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 220, maxWidth: 280, borderRadius: 14, padding: 10, backgroundColor: "rgba(255,255,255,0.90)", marginBottom: 6 },
  fileCardIcon: { width: 44, height: 44, borderRadius: 12, marginBottom: 0 },
  fileCardCopy: { flex: 1 },
  fileCardName: { color: "#17202d", fontSize: 13, lineHeight: 17, fontWeight: "600" },
  fileCardMeta: { color: "#667085", fontSize: 10, marginTop: 3, fontWeight: "700" },
  richCard: { minWidth: 230, maxWidth: 290, borderRadius: 14, padding: 12, backgroundColor: "rgba(255,255,255,0.90)", marginBottom: 4, gap: 6 },
  richEyebrow: { color: "#087f72", fontSize: 10, letterSpacing: 0.8, fontWeight: "600" },
  richTitle: { color: "#17202d", fontSize: 16, lineHeight: 20, fontWeight: "700" },
  richDetail: { color: "#475467", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  richLink: { color: "#1463d9", fontSize: 13, lineHeight: 20, fontWeight: "800" },
  pollOption: { minHeight: 38, borderRadius: 11, borderWidth: 1, borderColor: "#cbd5e1", paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pollOptionSelected: { backgroundColor: "#1463d9", borderColor: "#1463d9" },
  pollOptionText: { color: "#263244", fontSize: 12, fontWeight: "800", flex: 1 },
  pollOptionTextSelected: { color: "#fff" },
  pollCount: { color: "#667085", fontSize: 11, fontWeight: "900", marginLeft: 8 },
  composerInput: { flex: 1, color: "#101828", backgroundColor: "#f5f7fb", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, minHeight: 38, maxHeight: 110, fontSize: 16 },
  composerSend: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.blue, alignItems: "center", justifyContent: "center" },
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
  bubble: { maxWidth: "84%", borderRadius: 20, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1 },
  myBubble: { backgroundColor: "rgba(65,111,230,0.95)", borderColor: "rgba(137,170,255,0.48)", alignSelf: "flex-end", borderBottomRightRadius: 6 },
  theirBubble: { backgroundColor: "rgba(255,255,255,0.94)", borderColor: "rgba(255,255,255,0.68)", alignSelf: "flex-start", borderBottomLeftRadius: 6 },
  senderLine: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  senderName: { color: "#17202d", fontSize: 12, fontWeight: "600" },
  senderTime: { color: "#667085", fontSize: 11, fontWeight: "700" },
  messageContext: { borderLeftWidth: 4, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, minWidth: 190 },
  myMessageContext: { borderLeftColor: "#9dddf5", backgroundColor: "rgba(255,255,255,0.15)" },
  theirMessageContext: { borderLeftColor: "#0f9f8f", backgroundColor: "rgba(8,122,109,0.10)" },
  messageContextType: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  myMessageContextType: { color: "#e4f7ff" },
  theirMessageContextType: { color: "#087f72" },
  messageContextTitle: { fontSize: 13, lineHeight: 17, fontWeight: "600" },
  myMessageContextTitle: { color: theme.colors.text },
  theirMessageContextTitle: { color: "#17202d" },
  messageContextSubtitle: { fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: "700" },
  myMessageContextSubtitle: { color: "rgba(255,255,255,0.78)" },
  theirMessageContextSubtitle: { color: "#596273" },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  messageImage: { width: 230, height: 210, borderRadius: 14, marginBottom: 6, backgroundColor: theme.colors.panel2 },
  messageImageLoading: { alignItems: "center", justifyContent: "center" },
  messageImageLoadingText: { color: theme.colors.muted, fontSize: 12, fontWeight: "800" },
  myBubbleText: { color: theme.colors.text },
  theirBubbleText: { color: "#111827" },
  bubbleMeta: { fontSize: 10, fontWeight: "800", marginTop: 4, opacity: 0.8 },
  myBubbleMeta: { color: "rgba(255,255,255,0.78)" },
  theirBubbleMeta: { color: "#667085" },
  messageActions: { flexDirection: "row", gap: 10, marginTop: 6 },
  messageActionText: { color: theme.colors.soft, fontSize: 11, fontWeight: "900" },
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
