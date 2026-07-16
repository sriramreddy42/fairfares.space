import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { BootstrapPayload } from "../types";

type Props = {
  data: BootstrapPayload | null;
  onLogin: () => void;
};

export function ProfileScreen({ data, onLogin }: Props) {
  const user = data?.user;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionHeader eyebrow="Account" title="Profile" />
      <View style={styles.card}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{user?.name?.slice(0, 1) || "F"}</Text></View>
        <Text style={styles.name}>{user?.name || "FairFares Guest"}</Text>
        <Text style={styles.meta}>{user?.email || "Login with email and phone to message users."}</Text>
        <Text style={styles.meta}>{user?.phone || "Phone number required for verified contact."}</Text>
        {!user ? (
          <TouchableOpacity style={styles.button} onPress={onLogin}>
            <Text style={styles.buttonText}>Login / Sign up</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {["Notifications", "Roommates", "Rentals", "Rides", "Fair Messenger", "Support"].map((item) => (
        <View key={item} style={styles.menuRow}>
          <Text style={styles.menuTitle}>{item}</Text>
          <Text style={styles.chevron}>{">"}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.md, paddingBottom: 126, gap: theme.spacing.md },
  card: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.line, alignItems: "center", gap: 10 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  avatarText: { color: theme.colors.text, fontSize: 30, fontWeight: "900" },
  name: { color: theme.colors.text, fontSize: 24, fontWeight: "900" },
  meta: { color: theme.colors.muted, textAlign: "center" },
  button: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  buttonText: { color: theme.colors.text, fontWeight: "900" },
  menuRow: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  menuTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  chevron: { color: theme.colors.muted, fontSize: 20, fontWeight: "900" }
});
