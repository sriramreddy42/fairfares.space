import React from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { theme } from "../theme";
import { BootstrapPayload, HousingPost } from "../types";

type Props = {
  data: BootstrapPayload | null;
  pendingPost: HousingPost | null;
  onRequireLogin: () => void;
};

export function MessengerScreen({ data, pendingPost, onRequireLogin }: Props) {
  const signedIn = Boolean(data?.user);
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Fair Messenger</Text>
          <Text style={styles.title}>Chats</Text>
        </View>
        <TouchableOpacity
          style={styles.newButton}
          onPress={() =>
            signedIn
              ? Alert.alert("Create group", "Group creation will save to FairFares communities in the next mobile slice.")
              : onRequireLogin()
          }
        >
          <Text style={styles.newButtonText}>New group</Text>
        </TouchableOpacity>
      </View>
      <TextInput placeholder="Search Messenger" placeholderTextColor={theme.colors.muted} style={styles.search} />
      <View style={styles.tabs}>
        {["All", "Unread", "Groups", "Communities"].map((tab, index) => (
          <Text key={tab} style={[styles.tab, index === 0 && styles.activeTab]}>
            {tab}
          </Text>
        ))}
      </View>
      {!signedIn ? (
        <View style={styles.loginGate}>
          <Text style={styles.loginTitle}>Login required to message</Text>
          <Text style={styles.loginCopy}>People can browse listings, but sending a message requires a FairFares account with email and phone.</Text>
          <TouchableOpacity style={styles.loginButton} onPress={onRequireLogin}>
            <Text style={styles.loginButtonText}>Login / Sign up</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {pendingPost ? (
        <View style={styles.pending}>
          <Text style={styles.pendingTitle}>{pendingPost.title}</Text>
          <Text style={styles.pendingMeta}>Message the poster about this accommodation.</Text>
          <View style={styles.messageBox}>
            <TextInput editable={signedIn} placeholder="Type a message" placeholderTextColor={theme.colors.muted} style={styles.messageInput} />
            <TouchableOpacity
              style={[styles.send, !signedIn && styles.sendDisabled]}
              onPress={() => (signedIn ? Alert.alert("Message", "This will send through Fair Messenger.") : onRequireLogin())}
            >
              <Text style={styles.sendText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {(data?.chat.conversations || []).map((chat) => (
          <TouchableOpacity key={chat.id} style={styles.chatRow} onPress={() => Alert.alert(chat.subject, chat.lastMessage || "No messages yet.")}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{chat.otherName.slice(0, 1)}</Text></View>
            <View style={styles.chatCopy}>
              <Text style={styles.chatName}>{chat.otherName}</Text>
              <Text style={styles.chatLast}>{chat.lastMessage || chat.subject}</Text>
            </View>
            {chat.unread ? <Text style={styles.unread}>{chat.unread}</Text> : null}
          </TouchableOpacity>
        ))}
        {(data?.communities || []).map((community) => (
          <TouchableOpacity
            key={community.id}
            style={styles.chatRow}
            onPress={() =>
              signedIn
                ? Alert.alert(community.name, community.joined ? "You are already joined." : "Join community will be wired to the backend next.")
                : onRequireLogin()
            }
          >
            <View style={styles.avatar}><Text style={styles.avatarText}>G</Text></View>
            <View style={styles.chatCopy}>
              <Text style={styles.chatName}>{community.name}</Text>
              <Text style={styles.chatLast}>{community.description}</Text>
            </View>
            <Text style={styles.memberCount}>{community.memberCount}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg, padding: theme.spacing.md, paddingBottom: 116 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing.md },
  eyebrow: { color: theme.colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  title: { color: theme.colors.text, fontSize: 32, fontWeight: "900" },
  newButton: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 9 },
  newButtonText: { color: theme.colors.text, fontWeight: "900" },
  search: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.pill, paddingHorizontal: 16, minHeight: 48, fontSize: 16 },
  tabs: { flexDirection: "row", gap: 12, marginVertical: theme.spacing.md },
  tab: { color: theme.colors.text, fontWeight: "900", paddingHorizontal: 12, paddingVertical: 8 },
  activeTab: { color: theme.colors.blue, backgroundColor: "#172138", borderRadius: theme.radius.pill, overflow: "hidden" },
  loginGate: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, gap: 10 },
  loginTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "900" },
  loginCopy: { color: theme.colors.muted, fontSize: 15, lineHeight: 21 },
  loginButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10 },
  loginButtonText: { color: theme.colors.text, fontWeight: "900" },
  pending: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, marginTop: theme.spacing.md, gap: 10 },
  pendingTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  pendingMeta: { color: theme.colors.muted },
  messageBox: { flexDirection: "row", gap: 8 },
  messageInput: { flex: 1, color: theme.colors.text, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.sm, paddingHorizontal: 12 },
  send: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm, paddingHorizontal: 18, justifyContent: "center" },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: theme.colors.text, fontWeight: "900" },
  list: { marginTop: theme.spacing.md },
  chatRow: { flexDirection: "row", alignItems: "center", paddingVertical: 13, gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  avatarText: { color: theme.colors.text, fontWeight: "900", fontSize: 18 },
  chatCopy: { flex: 1 },
  chatName: { color: theme.colors.text, fontSize: 17, fontWeight: "800" },
  chatLast: { color: theme.colors.muted, marginTop: 3 },
  unread: { backgroundColor: theme.colors.accent, color: theme.colors.text, borderRadius: 10, overflow: "hidden", paddingHorizontal: 8, fontWeight: "900" },
  memberCount: { color: theme.colors.muted, fontWeight: "900" }
});
