import React, { useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  createChatCommunity,
  getChatCommunities,
  getChatConversations,
  getChatMessages,
  joinChatCommunity,
  markChatRead,
  openCommunityChat,
  sendChatMessage,
  startChatForPost
} from "../api/client";
import { theme } from "../theme";
import { BootstrapPayload, ChatConversation, ChatMessage, Community, HousingPost } from "../types";

type Props = {
  data: BootstrapPayload | null;
  pendingPost: HousingPost | null;
  onRequireLogin: () => void;
};

type MessengerTab = "All" | "Unread" | "Groups" | "Communities";

const blankGroup = { name: "", area: "", description: "" };

export function MessengerScreen({ data, pendingPost, onRequireLogin }: Props) {
  const signedIn = Boolean(data?.user);
  const [tab, setTab] = useState<MessengerTab>("All");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<ChatConversation[]>(data?.chat.conversations || []);
  const [communities, setCommunities] = useState<Community[]>(data?.communities || []);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [activeSubject, setActiveSubject] = useState(pendingPost?.title || "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState(blankGroup);

  useEffect(() => {
    setConversations(data?.chat.conversations || []);
    setCommunities(data?.communities || []);
  }, [data?.chat.conversations, data?.communities]);

  useEffect(() => {
    if (pendingPost) {
      setActiveConversationId("");
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

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const matchesSearch = !query || `${conversation.subject} ${conversation.otherName} ${conversation.lastMessage}`.toLowerCase().includes(query);
      const matchesTab = tab === "All" || (tab === "Unread" && conversation.unread > 0);
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
    setActiveConversationId(conversation.id);
    setActiveSubject(conversation.subject);
    setThreadLoading(true);
    try {
      const payload = await getChatMessages(conversation.id);
      setActiveSubject(payload.conversation.subject || conversation.subject);
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
      if (activeConversationId) {
        const response = await sendChatMessage(activeConversationId, cleanMessage);
        setMessages((current) => [...current, response.message]);
      } else if (pendingPost) {
        const response = await startChatForPost(pendingPost.id, cleanMessage);
        setActiveConversationId(response.conversation.id);
        setActiveSubject(response.conversation.subject || pendingPost.title);
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
    setLoading(true);
    try {
      const joinedCommunity = community.joined ? community : (await joinChatCommunity(community.id)).community;
      setCommunities((current) => current.map((item) => (item.id === joinedCommunity.id ? joinedCommunity : item)));
      const response = await openCommunityChat(joinedCommunity.id);
      setActiveConversationId(response.conversation.id);
      setActiveSubject(response.conversation.subject || joinedCommunity.name);
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

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Fair Messenger</Text>
          <Text style={styles.title}>Chats</Text>
        </View>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => (signedIn ? setCreatingGroup((value) => !value) : onRequireLogin())}
        >
          <Text style={styles.iconButtonText}>+</Text>
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

      {(pendingPost || activeConversationId) && signedIn ? (
        <View style={styles.thread}>
          <Text style={styles.sectionEyebrow}>Current chat</Text>
          <Text style={styles.threadTitle}>{activeSubject || pendingPost?.title || "Accommodation chat"}</Text>
          <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
            {threadLoading && !messages.length ? <Text style={styles.emptyText}>Loading messages...</Text> : null}
            {!threadLoading && !messages.length ? <Text style={styles.emptyText}>No messages yet.</Text> : null}
            {messages.map((message) => (
              <View key={message.id} style={[styles.bubble, message.mine ? styles.myBubble : styles.theirBubble]}>
                {!message.mine ? <Text style={styles.senderName}>{message.senderName}</Text> : null}
                <Text style={styles.bubbleText}>{message.text}</Text>
                <Text style={styles.bubbleMeta}>
                  {message.editedAt ? "Edited · " : ""}
                  {message.mine ? message.status === "seen" ? "Seen" : "Sent" : ""}
                </Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.messageBox}>
            <TextInput
              placeholder="Type a message"
              placeholderTextColor={theme.colors.muted}
              style={styles.messageInput}
              value={messageText}
              onChangeText={setMessageText}
              multiline
            />
            <TouchableOpacity style={[styles.send, threadLoading && styles.sendDisabled]} onPress={sendMessage} disabled={threadLoading}>
              <Text style={styles.sendText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} tintColor={theme.colors.text} onRefresh={refreshMessenger} />}
      >
        {(tab === "All" || tab === "Unread") && filteredConversations.map((chat) => (
          <TouchableOpacity key={chat.id} style={styles.chatRow} onPress={() => openConversation(chat)}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{(chat.otherName || chat.subject || "C").slice(0, 1)}</Text></View>
            <View style={styles.chatCopy}>
              <Text style={styles.chatName}>{chat.otherName || chat.subject}</Text>
              <Text style={styles.chatSubject}>{chat.subject}</Text>
              <Text style={styles.chatLast}>{chat.lastMessage || "No messages yet."}</Text>
            </View>
            {chat.unread ? <Text style={styles.unread}>{chat.unread}</Text> : <Text style={styles.chevron}>›</Text>}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg, padding: theme.spacing.md, paddingBottom: 116 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing.md },
  eyebrow: { color: theme.colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  title: { color: theme.colors.text, fontSize: 32, fontWeight: "900" },
  iconButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  iconButtonText: { color: theme.colors.text, fontSize: 28, fontWeight: "800", marginTop: -2 },
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
  thread: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, marginBottom: theme.spacing.md },
  sectionEyebrow: { color: theme.colors.muted, fontWeight: "900", textTransform: "uppercase", fontSize: 11 },
  threadTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900", marginTop: 2, marginBottom: 10 },
  messages: { maxHeight: 260, backgroundColor: theme.colors.bg, borderRadius: theme.radius.md },
  messagesContent: { padding: theme.spacing.sm, gap: 8 },
  emptyText: { color: theme.colors.muted, textAlign: "center", padding: theme.spacing.md, fontWeight: "800" },
  bubble: { maxWidth: "84%", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9 },
  myBubble: { backgroundColor: theme.colors.blue, alignSelf: "flex-end", borderBottomRightRadius: 4 },
  theirBubble: { backgroundColor: theme.colors.panel2, alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  senderName: { color: theme.colors.soft, fontSize: 12, fontWeight: "800", marginBottom: 3 },
  bubbleText: { color: theme.colors.text, fontSize: 15, lineHeight: 20 },
  bubbleMeta: { color: theme.colors.soft, fontSize: 11, fontWeight: "800", marginTop: 4, opacity: 0.8 },
  messageBox: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "flex-end" },
  messageInput: { flex: 1, color: theme.colors.text, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.md, paddingHorizontal: 12, minHeight: 46, maxHeight: 110 },
  send: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingHorizontal: 18, minHeight: 46, justifyContent: "center" },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: theme.colors.text, fontWeight: "900" },
  list: { flex: 1 },
  chatRow: { flexDirection: "row", alignItems: "center", paddingVertical: 13, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  groupAvatar: { backgroundColor: "#172138" },
  avatarText: { color: theme.colors.text, fontWeight: "900", fontSize: 18 },
  chatCopy: { flex: 1 },
  chatName: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  chatSubject: { color: theme.colors.soft, marginTop: 2, fontSize: 13, fontWeight: "700" },
  chatLast: { color: theme.colors.muted, marginTop: 3 },
  unread: { backgroundColor: theme.colors.accent, color: theme.colors.text, borderRadius: 10, overflow: "hidden", paddingHorizontal: 8, fontWeight: "900" },
  memberCount: { color: theme.colors.muted, fontWeight: "900" },
  rowAction: { paddingVertical: 8, paddingLeft: 8 },
  chevron: { color: theme.colors.muted, fontSize: 30, marginTop: -2 },
  emptyList: { color: theme.colors.muted, fontWeight: "800", textAlign: "center", padding: theme.spacing.lg }
});
