import React, { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { HousingCard } from "../components/HousingCard";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { BootstrapPayload, HousingPost } from "../types";

type Props = {
  data: BootstrapPayload | null;
  onMessage: (post: HousingPost) => void;
  onOpenMessenger: () => void;
};

const quickActions = [
  { label: "I need a place", icon: "BED", need: "need_place" },
  { label: "Need roommates", icon: "ROOM", need: "need_roommates" },
  { label: "I have a place", icon: "HOME", need: "have_place" },
  { label: "I need a ride", icon: "RIDE", need: "ride_need" },
  { label: "I provide a ride", icon: "CAR", need: "ride_offer" }
];

const roomTypes = ["Shared Room", "Single Room", "Paying Guest"];

export function HousingScreen({ data, onMessage, onOpenMessenger }: Props) {
  const [mode, setMode] = useState<"roommates" | "rentals">("roommates");
  const posts = data?.housing || [];
  const displayName = data?.user?.name?.split(" ")[0] || "there";
  const localities = useMemo(
    () => [
      { name: "Englewood, CO", owner: "23%", tenant: "46%", rent: "$773" },
      { name: "Aurora, CO", owner: "18%", tenant: "51%", rent: "$820" },
      { name: "Littleton, CO", owner: "20%", tenant: "39%", rent: "$895" }
    ],
    []
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.topTabs}>
        {["Ride", "Housing", "Explorer", "Deals"].map((item) => (
          <TouchableOpacity key={item} style={[styles.topTab, item === "Housing" && styles.topTabActive]}>
            <Text style={[styles.topTabText, item === "Housing" && styles.topTabTextActive]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.searchBar} onPress={() => Alert.alert("Search", "City, area, and building search will use FairFares location APIs.")}>
        <Text style={styles.searchIcon}>Q</Text>
        <Text style={styles.searchText}>Where do you need accommodation?</Text>
        <Text style={styles.later}>Later</Text>
      </TouchableOpacity>

      <View style={styles.locationCard}>
        <View style={styles.locationIcon}><Text style={styles.locationIconText}>FF</Text></View>
        <View style={styles.locationCopy}>
          <Text style={styles.locationTitle}>{data?.location.selected || "Denver, CO"}</Text>
          <Text style={styles.locationMeta}>Search city, building, campus, or neighborhood</Text>
          <Text style={styles.green}>Lower housing friction than usual</Text>
        </View>
      </View>

      <View style={styles.segment}>
        <TouchableOpacity style={[styles.segmentButton, mode === "roommates" && styles.segmentActive]} onPress={() => setMode("roommates")}>
          <Text style={[styles.segmentText, mode === "roommates" && styles.segmentTextActive]}>Roommates</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentButton, mode === "rentals" && styles.segmentActive]} onPress={() => setMode("rentals")}>
          <Text style={[styles.segmentText, mode === "rentals" && styles.segmentTextActive]}>Rentals</Text>
        </TouchableOpacity>
      </View>

      <SectionHeader title="For you" action="See all" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
        {quickActions.map((action) => (
          <TouchableOpacity key={action.label} style={styles.quickAction}>
            <View style={styles.quickBubble}>
              <Text style={styles.quickIcon}>{action.icon}</Text>
            </View>
            <Text style={styles.quickLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.postNeed}>
        <View>
          <Text style={styles.postNeedTitle}>List your room / property for rent</Text>
          <Text style={styles.postNeedMeta}>Need a place to stay? Get matched today.</Text>
        </View>
        <TouchableOpacity style={styles.postNeedButton}>
          <Text style={styles.postNeedButtonText}>Post</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.welcome}>
        <Text style={styles.welcomeTitle}>Hi {displayName}! Welcome back.</Text>
        <Text style={styles.welcomeMeta}>Check recent listings, messages, and dashboard activity here.</Text>
        <View style={styles.statRow}>
          <Text style={styles.stat}>{data?.dashboard.housingPosts || 0} Housing Posts</Text>
          <TouchableOpacity onPress={onOpenMessenger}>
            <Text style={styles.stat}>{data?.chat.unreadCount || 0} Messages</Text>
          </TouchableOpacity>
        </View>
      </View>

      <SectionHeader title={`Rooms for rent in ${data?.location.city || "Denver, CO"}`} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {posts.length ? (
          posts.map((post) => <HousingCard key={post.id} post={post} onMessage={onMessage} />)
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No matching housing posts yet.</Text>
            <Text style={styles.emptyText}>Try Denver, Union Station, DU, Aurora, or create the first post.</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.promo}>
        <View>
          <Text style={styles.promoTitle}>Need a place to stay / have a rental to offer?</Text>
          <Text style={styles.promoMeta}>Answer a few questions and we will help find the closest match.</Text>
        </View>
        <TouchableOpacity style={styles.promoButton}>
          <Text style={styles.promoButtonText}>Get matched</Text>
        </TouchableOpacity>
      </View>

      <SectionHeader title={`Room Types in ${data?.location.city || "Denver, CO"}`} />
      <View style={styles.roomTypeRow}>
        {roomTypes.map((type) => (
          <View key={type} style={styles.roomType}>
            <View style={styles.roomCircle}><Text style={styles.roomIcon}>BED</Text></View>
            <Text style={styles.roomLabel}>{type}</Text>
          </View>
        ))}
      </View>

      <SectionHeader title="Explore localities" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {localities.map((locality) => (
          <View key={locality.name} style={styles.localityCard}>
            <Text style={styles.localityTitle}>{locality.name}</Text>
            <View style={styles.localityStats}>
              <Text style={styles.localityChip}>Owner {locality.owner}</Text>
              <Text style={styles.localityChip}>Tenant {locality.tenant}</Text>
            </View>
            <Text style={styles.avgRent}>Avg Rent: {locality.rent}</Text>
          </View>
        ))}
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.md, paddingBottom: 126, gap: theme.spacing.lg },
  topTabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  topTab: { paddingVertical: 12, paddingRight: 22 },
  topTabActive: { borderBottomWidth: 3, borderBottomColor: theme.colors.soft },
  topTabText: { color: theme.colors.muted, fontSize: 18, fontWeight: "900" },
  topTabTextActive: { color: theme.colors.text },
  searchBar: { backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, minHeight: 64, paddingHorizontal: theme.spacing.md, flexDirection: "row", alignItems: "center", gap: 12 },
  searchIcon: { color: theme.colors.muted, fontWeight: "900", fontSize: 18 },
  searchText: { color: theme.colors.soft, flex: 1, fontSize: 20, fontWeight: "800" },
  later: { color: theme.colors.soft, backgroundColor: theme.colors.bg, borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 10, fontWeight: "900" },
  locationCard: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.lg, padding: theme.spacing.md, flexDirection: "row", gap: theme.spacing.md },
  locationIcon: { width: 54, height: 54, borderRadius: theme.radius.md, backgroundColor: "#0e3a21", alignItems: "center", justifyContent: "center" },
  locationIconText: { color: theme.colors.green, fontWeight: "900" },
  locationCopy: { flex: 1, gap: 4 },
  locationTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  locationMeta: { color: theme.colors.muted, fontSize: 15 },
  green: { color: theme.colors.green, fontSize: 15, fontWeight: "800" },
  segment: { backgroundColor: "#252a7a", borderRadius: theme.radius.pill, flexDirection: "row", padding: 5 },
  segmentButton: { flex: 1, borderRadius: theme.radius.pill, alignItems: "center", paddingVertical: 13 },
  segmentActive: { backgroundColor: theme.colors.text },
  segmentText: { color: theme.colors.soft, fontSize: 17, fontWeight: "900" },
  segmentTextActive: { color: theme.colors.blue },
  quickRow: { gap: theme.spacing.md },
  quickAction: { width: 92, alignItems: "center", gap: 9 },
  quickBubble: { width: 78, height: 78, borderRadius: 39, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  quickIcon: { color: theme.colors.text, fontSize: 14, fontWeight: "900" },
  quickLabel: { color: theme.colors.soft, fontSize: 13, textAlign: "center", fontWeight: "800" },
  postNeed: { backgroundColor: "#fff7df", borderRadius: theme.radius.lg, padding: theme.spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  postNeedTitle: { color: "#111", fontSize: 18, fontWeight: "900" },
  postNeedMeta: { color: "#5b5148", marginTop: 4, fontSize: 14 },
  postNeedButton: { backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill, paddingHorizontal: 18, paddingVertical: 12 },
  postNeedButtonText: { color: theme.colors.text, fontWeight: "900" },
  welcome: { borderWidth: 1, borderColor: theme.colors.brand, borderRadius: theme.radius.md, padding: theme.spacing.md, backgroundColor: "#18241d", gap: 8 },
  welcomeTitle: { color: theme.colors.text, fontSize: 21, fontWeight: "900" },
  welcomeMeta: { color: theme.colors.soft, fontSize: 15 },
  statRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  stat: { color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.brand, borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 8, overflow: "hidden", fontWeight: "900" },
  emptyCard: { width: 286, minHeight: 170, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, justifyContent: "center" },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  emptyText: { color: theme.colors.muted, marginTop: 8 },
  promo: { backgroundColor: "#2b1719", borderRadius: theme.radius.lg, padding: theme.spacing.md, gap: theme.spacing.md },
  promoTitle: { color: "#ff8ea0", fontSize: 20, fontWeight: "900" },
  promoMeta: { color: theme.colors.soft, fontSize: 16, marginTop: 5 },
  promoButton: { backgroundColor: theme.colors.brand, borderRadius: theme.radius.pill, alignSelf: "flex-start", paddingHorizontal: 18, paddingVertical: 12 },
  promoButtonText: { color: theme.colors.text, fontWeight: "900", textTransform: "uppercase" },
  roomTypeRow: { flexDirection: "row", justifyContent: "space-between" },
  roomType: { alignItems: "center", gap: 10, flex: 1 },
  roomCircle: { width: 86, height: 86, borderRadius: 43, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  roomIcon: { color: theme.colors.text, fontWeight: "900" },
  roomLabel: { color: theme.colors.soft, fontWeight: "900", fontSize: 16 },
  localityCard: { width: 270, borderRadius: theme.radius.lg, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, marginRight: theme.spacing.md, padding: theme.spacing.md, gap: 14 },
  localityTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  localityStats: { flexDirection: "row", gap: 10 },
  localityChip: { color: theme.colors.blue, borderWidth: 1, borderColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 7, overflow: "hidden", fontWeight: "800" },
  avgRent: { color: theme.colors.green, fontSize: 18, fontWeight: "900" }
});
