import React from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { BootstrapPayload } from "../types";

type Props = {
  data: BootstrapPayload | null;
};

export function DashboardScreen({ data }: Props) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionHeader eyebrow="Workspace" title="Dashboard" />
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Hi {data?.user?.name?.split(" ")[0] || "there"}</Text>
        <Text style={styles.heroCopy}>Your rentals, housing posts, roommate requests, rides, and messages will live here.</Text>
      </View>
      <View style={styles.grid}>
        <View style={styles.stat}><Text style={styles.statNumber}>{data?.dashboard.housingPosts || 0}</Text><Text style={styles.statLabel}>Housing Posts</Text></View>
        <View style={styles.stat}><Text style={styles.statNumber}>{data?.dashboard.messages || 0}</Text><Text style={styles.statLabel}>Messages</Text></View>
        <View style={styles.stat}><Text style={styles.statNumber}>30</Text><Text style={styles.statLabel}>Ad Days</Text></View>
        <View style={styles.stat}><Text style={styles.statNumber}>0</Text><Text style={styles.statLabel}>Ride Leads</Text></View>
      </View>
      <SectionHeader title="Recent housing activity" />
      {(data?.housing || []).slice(0, 4).map((post) => (
        <TouchableOpacity key={post.id} style={styles.row} onPress={() => Alert.alert(post.title, post.description || "No description yet.")}>
          <View>
            <Text style={styles.rowTitle}>{post.title}</Text>
            <Text style={styles.rowMeta}>{post.location} · {post.expiryLabel}</Text>
          </View>
          <Text style={styles.rowPrice}>{post.rent}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.md, paddingBottom: 32, gap: theme.spacing.lg },
  hero: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.line },
  heroTitle: { color: theme.colors.text, fontSize: 30, fontWeight: "900" },
  heroCopy: { color: theme.colors.muted, marginTop: 8, fontSize: 16, lineHeight: 23 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
  stat: { width: "47%", backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line },
  statNumber: { color: theme.colors.text, fontSize: 30, fontWeight: "900" },
  statLabel: { color: theme.colors.muted, fontWeight: "800", marginTop: 4 },
  row: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, flexDirection: "row", justifyContent: "space-between", gap: 10 },
  rowTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16, maxWidth: 230 },
  rowMeta: { color: theme.colors.muted, marginTop: 5 },
  rowPrice: { color: theme.colors.green, fontWeight: "900" }
});
