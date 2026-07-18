import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  blockChatUser,
  createChatCommunity,
  deleteChatMessage,
  editChatMessage,
  getChatCommunities,
  getChatConversations,
  getChatMessages,
  joinChatCommunity,
  markChatRead,
  muteChatConversation,
  openCommunityChat,
  reportChatMessage,
  sendChatMessage,
  startChatForPost
} from "../api/client";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { BootstrapPayload, ChatConversation, ChatMessage, Community, HousingPost } from "../types";

type Props = {
  data: BootstrapPayload | null;
  pendingPost: HousingPost | null;
  onRequireLogin: () => void;
  onClearPendingPost?: () => void;
  onThreadModeChange?: (active: boolean) => void;
};

type MessengerTab = "All" | "Unread" | "Groups" | "Communities";

const blankGroup = { name: "", area: "", description: "" };

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

function presenceLabel(conversation: ChatConversation | null) {
  if (!conversation || conversation.communityId) return "Group chat";
  if (conversation.otherOnline) return "Active now";
  const lastSeen = relativeTime(conversation.otherLastSeenAt || "");
  return lastSeen ? `Active ${lastSeen} ago` : "Offline";
}

export function MessengerScreen({ data, pendingPost, onRequireLogin, onClearPendingPost, onThreadModeChange }: Props) {
  const signedIn = Boolean(data?.user);
  const [tab, setTab] = useState<MessengerTab>("All");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<ChatConversation[]>(data?.chat.conversations || []);
  const [communities, setCommunities] = useState<Community[]>(data?.communities || []);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [activeSubject, setActiveSubject] = useState(pendingPost?.title || "");
  const [activeConversation, setActiveConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState(blankGroup);
  const inThread = signedIn && (Boolean(activeConversationId) || Boolean(pendingPost));

  useEffect(() => {
    setConversations(data?.chat.conversations || []);
    setCommunities(data?.communities || []);
  }, [data?.chat.conversations, data?.communities]);

  useEffect(() => {
    if (pendingPost) {
      setActiveConversationId("");
      setActiveConversation(null);
      setActiveSubject(pendingPost.title);
      setMessages([]);
      setMessageText(`Hi, I am interested in ${pendingPost.title}. Is it still available?`);
    }
  }, [pendingPost?.id]);

  useEffect(() => {
    if (signedIn) {
      refreshMessenger();
    }
  }, [signedIn]);

  useEffect(() => {
    onThreadModeChange?.(inThread);
    return () => onThreadModeChange?.(false);
  }, [inThread, onThreadModeChange]);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const matchesSearch = !query || `${conversation.subject} ${conversation.otherName} ${conversation.lastMessage}`.toLowerCase().includes(query);
      const matchesTab =
        tab === "All" ||
        (tab === "Unread" && conversation.unread > 0) ||
        (tab === "Groups" && (conversation.kind === "GROUP" || Boolean(conversation.communityId)));
      return matchesSearch && matchesTab;
    });
  }, [conversations, search, tab]);

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
        kind: (payload.conversation.kind as ChatConversation["kind"]) || conversation.kind,
        status: payload.conversation.status || conversation.status,
        communityId: payload.conversation.communityId || conversation.communityId
      });
      setMessages(payload.messages || []);
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
    if (!cleanMessage) {
      Alert.alert("Message required", "Type a message before sending.");
      return;
    }
    setThreadLoading(true);
    try {
      if (activeConversationId && editingMessageId) {
        const response = await editChatMessage(activeConversationId, editingMessageId, cleanMessage);
        setMessages((current) => current.map((item) => (item.id === editingMessageId ? response.message : item)));
        setEditingMessageId(null);
      } else if (activeConversationId) {
        const response = await sendChatMessage(activeConversationId, cleanMessage);
        setMessages((current) => [...current, response.message]);
      } else if (pendingPost) {
        const response = await startChatForPost(pendingPost.id, cleanMessage);
        setActiveConversationId(response.conversation.id);
        setActiveSubject(response.conversation.subject || pendingPost.title);
        setActiveConversation({
          id: response.conversation.id,
          communityId: response.conversation.communityId,
          kind: response.conversation.communityId ? "GROUP" : "HOST_GUEST",
          subject: response.conversation.subject || pendingPost.title,
          otherName: pendingPost.title,
          lastMessage: cleanMessage,
          lastMessageAt: new Date().toISOString(),
          unread: 0
        });
        setMessages(response.message ? [response.message] : []);
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
      setMessages(payload.messages || []);
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
    if (community.joinUrl) {
      await Share.share({ message: `Join ${community.name} on FairFares: ${community.joinUrl}` });
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

  function showChatOptions() {
    const actions = [
      {
        text: activeConversation?.mutedAt ? "Unmute chat" : "Mute chat",
        onPress: toggleMute
      }
    ];
    if (activeConversationId && !activeConversation?.communityId) {
      actions.push({
        text: activeConversation?.blockedAt ? "Unblock member" : "Block member",
        onPress: toggleBlock
      });
    }
    Alert.alert(activeConversation?.otherName || activeSubject || "Chat options", "Manage this conversation.", [
      ...actions,
      { text: "Cancel", style: "cancel" }
    ]);
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
    onClearPendingPost?.();
    onThreadModeChange?.(false);
  }

  if (inThread) {
    return (
      <KeyboardAvoidingView
        style={styles.threadScreen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <View style={styles.threadHeader}>
          <TouchableOpacity style={styles.backButton} onPress={closeThread}>
            <BackIcon />
          </TouchableOpacity>
          <View style={styles.threadAvatar}>
            <Text style={styles.threadAvatarText}>{initials(activeConversation?.otherName || activeSubject || "Chat")}</Text>
            {activeConversation?.otherOnline && !activeConversation?.communityId ? <View style={styles.activeDot} /> : null}
          </View>
          <View style={styles.threadHeaderCopy}>
            <Text style={styles.threadHeaderTitle} numberOfLines={1}>{activeConversation?.otherName || activeSubject || pendingPost?.title || "FairFares chat"}</Text>
            <Text style={styles.threadHeaderMeta}>{presenceLabel(activeConversation)}</Text>
          </View>
          <TouchableOpacity style={styles.headerAction} onPress={showChatOptions}><DotsIcon /></TouchableOpacity>
        </View>

        <ScrollView style={styles.threadMessages} contentContainerStyle={styles.threadMessagesContent}>
          {threadLoading && !messages.length ? <Text style={styles.emptyText}>Loading messages...</Text> : null}
          {!threadLoading && !messages.length ? (
            <View style={styles.emptyThread}>
              <Text style={styles.emptyThreadTitle}>No messages yet.</Text>
              <Text style={styles.emptyThreadCopy}>Send a message to start the conversation.</Text>
            </View>
          ) : null}
          {messages.map((message) => (
            <View key={message.id} style={[styles.threadMessageRow, message.mine && styles.threadMessageRowMine]}>
              <View style={[styles.bubble, message.mine ? styles.myBubble : styles.theirBubble]}>
                {!message.mine && activeConversation?.communityId ? <Text style={styles.senderName}>{message.senderName}</Text> : null}
                <Text style={[styles.bubbleText, message.mine ? styles.myBubbleText : styles.theirBubbleText]}>{message.text}</Text>
                <Text style={[styles.bubbleMeta, message.mine ? styles.myBubbleMeta : styles.theirBubbleMeta]}>
                  {message.editedAt ? "Edited · " : ""}
                  {message.mine ? message.status === "seen" ? "Seen" : message.status === "delivered" ? "Delivered" : "Sent" : ""}
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
              {!message.mine ? (
                <View style={styles.smallAvatar}><Text style={styles.smallAvatarText}>{initials(message.senderName || "F")}</Text></View>
              ) : null}
            </View>
          ))}
        </ScrollView>

        <View style={styles.composer}>
          <TouchableOpacity style={styles.composerIcon} onPress={showChatOptions}><PlusIcon /></TouchableOpacity>
          <TextInput
            placeholder={editingMessageId ? "Edit message" : "Aa"}
            placeholderTextColor="#7c8493"
            style={styles.composerInput}
            value={messageText}
            onChangeText={setMessageText}
            multiline
          />
          <TouchableOpacity style={[styles.composerSend, threadLoading && styles.sendDisabled]} onPress={sendMessage} disabled={threadLoading}>
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
    <View style={styles.screen}>
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
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} tintColor={theme.colors.text} onRefresh={refreshMessenger} />}
      >
        {(tab === "All" || tab === "Unread" || tab === "Groups") && filteredConversations.map((chat) => (
          <TouchableOpacity key={chat.id} style={styles.chatRow} onPress={() => openConversation(chat)}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(chat.otherName || chat.subject || "Chat")}</Text></View>
            <View style={styles.chatCopy}>
              <Text style={styles.chatName}>{chat.otherName || chat.subject}</Text>
              <Text style={styles.chatLast} numberOfLines={1}>{chat.lastMessage || chat.subject || "No messages yet."}</Text>
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
              <Text style={styles.memberCount}>{community.joined ? "Share" : "Join"} · {community.memberCount}</Text>
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
  screen: { flex: 1, backgroundColor: theme.colors.bg, padding: theme.spacing.md, paddingBottom: 116 },
  threadScreen: { flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: theme.spacing.md, paddingTop: 8, paddingBottom: 18 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing.md },
  eyebrow: { color: theme.colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  title: { color: theme.colors.text, fontSize: 32, fontWeight: "900" },
  chatBrandWrap: { flex: 1, minWidth: 0, gap: 2 },
  chatBrand: { width: 152, height: 48 },
  headerIcons: { flexDirection: "row", gap: 8, marginLeft: "auto", marginRight: 10 },
  headerIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  headerIconText: { color: theme.colors.muted, fontSize: 19, fontWeight: "900" },
  iconButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  iconButtonText: { color: theme.colors.text, fontSize: 23, fontWeight: "800", marginTop: -2 },
  search: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.pill, paddingHorizontal: 16, minHeight: 48, fontSize: 16 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: theme.spacing.md },
  tab: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  activeTab: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  tabText: { color: theme.colors.text, fontWeight: "900" },
  activeTabText: { color: theme.colors.bg },
  loginGate: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, gap: 10 },
  loginTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "900" },
  loginCopy: { color: theme.colors.muted, fontSize: 15, lineHeight: 21 },
  loginButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10 },
  loginButtonText: { color: theme.colors.text, fontWeight: "900" },
  groupComposer: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, gap: 10, marginBottom: theme.spacing.md },
  sectionTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "900" },
  input: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.md, paddingHorizontal: 14, minHeight: 48, fontSize: 15 },
  multiline: { minHeight: 82, paddingTop: 13, textAlignVertical: "top" },
  primaryButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingVertical: 13, alignItems: "center" },
  primaryButtonText: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  threadHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 4, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backIcon: { width: 24, height: 24, justifyContent: "center" },
  backLine: { position: "absolute", width: 18, height: 4, borderRadius: 3, backgroundColor: theme.colors.blue, left: 2 },
  backLineTop: { transform: [{ rotate: "-45deg" }], top: 6 },
  backLineBottom: { transform: [{ rotate: "45deg" }], bottom: 5 },
  threadAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center" },
  threadAvatarText: { color: "#0f172a", fontWeight: "900", fontSize: 15 },
  activeDot: { position: "absolute", right: 0, bottom: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.green, borderWidth: 2, borderColor: theme.colors.bg },
  threadHeaderCopy: { flex: 1 },
  threadHeaderTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  threadHeaderMeta: { color: theme.colors.muted, fontSize: 13, fontWeight: "800", marginTop: 1 },
  headerAction: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  dotsIcon: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  dotIcon: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.blue },
  threadMessages: { flex: 1 },
  threadMessagesContent: { paddingVertical: 16, gap: 10, flexGrow: 1, justifyContent: "flex-end" },
  threadMessageRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 8 },
  threadMessageRowMine: { justifyContent: "flex-start" },
  smallAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center" },
  smallAvatarText: { color: "#0f172a", fontWeight: "900", fontSize: 10 },
  emptyThread: { alignItems: "center", marginTop: "auto", marginBottom: "auto", gap: 6 },
  emptyThreadTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  emptyThreadCopy: { color: theme.colors.muted, fontSize: 14, fontWeight: "700" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingTop: 10, paddingBottom: 4, borderTopWidth: 1, borderTopColor: theme.colors.line },
  composerIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  plusIcon: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  plusHorizontal: { position: "absolute", width: 24, height: 5, borderRadius: 3, backgroundColor: theme.colors.blue },
  plusVertical: { position: "absolute", width: 5, height: 24, borderRadius: 3, backgroundColor: theme.colors.blue },
  composerInput: { flex: 1, color: "#101828", backgroundColor: "#f5f7fb", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, minHeight: 38, maxHeight: 110, fontSize: 16 },
  composerSend: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.blue, alignItems: "center", justifyContent: "center" },
  composerSendText: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  sendIcon: { width: 19, height: 19, justifyContent: "center", marginLeft: 2 },
  sendWingTop: { position: "absolute", width: 17, height: 4, borderRadius: 3, backgroundColor: theme.colors.text, transform: [{ rotate: "32deg" }], top: 5 },
  sendWingBottom: { position: "absolute", width: 17, height: 4, borderRadius: 3, backgroundColor: theme.colors.text, transform: [{ rotate: "-32deg" }], bottom: 5 },
  thread: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, marginBottom: theme.spacing.md },
  sectionEyebrow: { color: theme.colors.muted, fontWeight: "900", textTransform: "uppercase", fontSize: 11 },
  threadTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900", marginTop: 2, marginBottom: 10 },
  threadActions: { flexDirection: "row", gap: 8, marginBottom: 10 },
  smallAction: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  smallActionText: { color: theme.colors.soft, fontWeight: "900", fontSize: 12 },
  messages: { maxHeight: 260, backgroundColor: theme.colors.bg, borderRadius: theme.radius.md },
  messagesContent: { padding: theme.spacing.sm, gap: 8 },
  emptyText: { color: theme.colors.muted, textAlign: "center", padding: theme.spacing.md, fontWeight: "800" },
  bubble: { maxWidth: "84%", borderRadius: 20, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1 },
  myBubble: { backgroundColor: "rgba(255,255,255,0.92)", borderColor: "rgba(255,255,255,0.62)", alignSelf: "flex-start", borderBottomLeftRadius: 6 },
  theirBubble: { backgroundColor: "rgba(79,124,255,0.9)", borderColor: "rgba(137,170,255,0.42)", alignSelf: "flex-end", borderBottomRightRadius: 6 },
  senderName: { color: "rgba(255,255,255,0.78)", fontSize: 10, fontWeight: "900", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  myBubbleText: { color: "#111827" },
  theirBubbleText: { color: theme.colors.text },
  bubbleMeta: { fontSize: 10, fontWeight: "800", marginTop: 4, opacity: 0.8 },
  myBubbleMeta: { color: "#667085" },
  theirBubbleMeta: { color: "rgba(255,255,255,0.78)" },
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
  chatRow: { flexDirection: "row", alignItems: "center", paddingVertical: 13, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  groupAvatar: { backgroundColor: "#172138" },
  avatarText: { color: theme.colors.text, fontWeight: "900", fontSize: 18 },
  chatCopy: { flex: 1 },
  chatName: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  chatSubject: { color: theme.colors.soft, marginTop: 2, fontSize: 13, fontWeight: "700" },
  chatLast: { color: theme.colors.muted, marginTop: 3 },
  chatMeta: { alignItems: "flex-end", minWidth: 34, gap: 6 },
  chatTime: { color: theme.colors.muted, fontWeight: "800", fontSize: 12 },
  unread: { backgroundColor: theme.colors.accent, color: theme.colors.text, borderRadius: 10, overflow: "hidden", paddingHorizontal: 8, fontWeight: "900" },
  memberCount: { color: theme.colors.muted, fontWeight: "900" },
  rowAction: { paddingVertical: 8, paddingLeft: 8 },
  chevron: { color: theme.colors.muted, fontSize: 30, marginTop: -2 },
  emptyList: { color: theme.colors.muted, fontWeight: "800", textAlign: "center", padding: theme.spacing.lg }
});
