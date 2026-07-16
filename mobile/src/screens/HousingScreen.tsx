import React, { useEffect, useMemo, useState } from "react";
import { Image, ImageSourcePropType, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { appAssets } from "../assets";
import { HousingCard } from "../components/HousingCard";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { BootstrapPayload, Car, HousingPost } from "../types";

type Props = {
  data: BootstrapPayload | null;
  posts: HousingPost[];
  cars: Car[];
  selectedNeed: string;
  selectedCategory: string;
  onMessage: (post: HousingPost) => void;
  onOpenMessenger: () => void;
  onNeedSelect: (need: string) => void;
  onAreaSelect: (area: string) => void;
  onOpenSearch: () => void;
  onCategorySelect: (category: string) => void;
  onPostNeed: () => void;
  onTopAction: (action: string) => void;
};

const quickActions: Array<{ label: string; icon: ImageSourcePropType; need: string }> = [
  { label: "I need a place", icon: appAssets.bed, need: "need_place" },
  { label: "Need roommates", icon: appAssets.roommates, need: "need_roommates" },
  { label: "I have a place", icon: appAssets.bed, need: "have_place" },
  { label: "I need a ride", icon: appAssets.ride, need: "ride_need" },
  { label: "I provide a ride", icon: appAssets.ride, need: "ride_offer" }
];

const roomTypes: Array<{ label: string; category: string; icon: ImageSourcePropType }> = [
  { label: "Shared Room", category: "shared_room", icon: appAssets.roommates },
  { label: "Single Room", category: "single_room", icon: appAssets.bed },
  { label: "Paying Guest", category: "paying_guest", icon: appAssets.bed }
];

const searchPhrases = ["Search city", "Search area", "Search building"];

export function HousingScreen({
  data,
  posts,
  cars,
  selectedNeed,
  selectedCategory,
  onMessage,
  onOpenMessenger,
  onNeedSelect,
  onAreaSelect,
  onOpenSearch,
  onCategorySelect,
  onPostNeed,
  onTopAction
}: Props) {
  const [mode, setMode] = useState<"housing" | "ride" | "cheapCars">("housing");
  const [searchPhraseIndex, setSearchPhraseIndex] = useState(0);
  const [searchLetterCount, setSearchLetterCount] = useState(1);
  const displayName = data?.user?.name?.split(" ")[0] || "there";
  const selectedLocationText = (data?.location.selected || data?.location.city || "").trim();
  const animatedSearchText = selectedLocationText || searchPhrases[searchPhraseIndex].slice(0, searchLetterCount);
  const cheapestCar = useMemo(
    () =>
      [...cars]
        .filter((car) => Number(car.daily_price) > 0)
        .sort((a, b) => Number(a.daily_price) - Number(b.daily_price))[0],
    [cars]
  );
  const localities = useMemo(() => {
    const groups = new Map<string, { total: number; count: number; offered: number; needed: number }>();
    posts.forEach((post) => {
      const name = (post.area || post.location || data?.location.city || "Area open").trim();
      if (!name) return;
      const current = groups.get(name) || { total: 0, count: 0, offered: 0, needed: 0 };
      if (post.rentValue > 0) {
        current.total += post.rentValue;
        current.count += 1;
      }
      if (post.mode === "HAVE_PLACE") current.offered += 1;
      if (post.mode === "NEED_PLACE") current.needed += 1;
      groups.set(name, current);
    });
    return Array.from(groups.entries()).map(([name, value]) => ({
      name,
      offered: value.offered,
      needed: value.needed,
      rent: value.count ? `$${Math.round(value.total / value.count)}` : "Open"
    }));
  }, [data?.location.city, posts]);
  const showRoomTypes = selectedNeed === "need_place" || selectedNeed === "need_roommates";

  useEffect(() => {
    const phrase = searchPhrases[searchPhraseIndex];
    const timer = setTimeout(() => {
      if (searchLetterCount < phrase.length) {
        setSearchLetterCount((value) => value + 1);
      } else {
        setSearchPhraseIndex((value) => (value + 1) % searchPhrases.length);
        setSearchLetterCount(1);
      }
    }, searchLetterCount < phrase.length ? 95 : 900);
    return () => clearTimeout(timer);
  }, [searchLetterCount, searchPhraseIndex]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} stickyHeaderIndices={[2]} showsVerticalScrollIndicator={false}>
        <View style={styles.brandHeader}>
          <Image source={appAssets.logo} style={styles.logo} resizeMode="contain" />
        </View>

        <View style={styles.topTabs}>
          {["Ride", "Housing", "Explorer", "Deals"].map((item) => (
            <TouchableOpacity key={item} onPress={() => onTopAction(item)} style={[styles.topTab, item === "Housing" && styles.topTabActive]}>
              <Text style={[styles.topTabText, item === "Housing" && styles.topTabTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.stickySearch}>
          <TouchableOpacity style={styles.searchBar} onPress={onOpenSearch}>
            <Image source={appAssets.search} style={styles.searchIcon} resizeMode="contain" />
            <Text style={styles.searchText} numberOfLines={1}>{animatedSearchText}</Text>
            <Text style={styles.later}>Search</Text>
          </TouchableOpacity>
        </View>

      <View style={styles.segment}>
        <TouchableOpacity
          style={[styles.segmentButton, mode === "housing" && styles.segmentActive]}
          onPress={() => {
            setMode("housing");
            onNeedSelect("need_place");
          }}
        >
          <Text style={[styles.segmentText, mode === "housing" && styles.segmentTextActive]}>Housing</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentButton, mode === "ride" && styles.segmentActive]}
          onPress={() => {
            setMode("ride");
            onTopAction("Ride");
          }}
        >
          <Text style={[styles.segmentText, mode === "ride" && styles.segmentTextActive]}>Ride</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentButton, mode === "cheapCars" && styles.segmentActive]}
          onPress={() => {
            setMode("cheapCars");
            onTopAction("Ride");
          }}
        >
          <Text style={[styles.segmentText, mode === "cheapCars" && styles.segmentTextActive]}>Cheap Cars</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => onNeedSelect("")}>
        <SectionHeader title="For you" action="See all" />
      </TouchableOpacity>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
        {quickActions.map((action) => (
          <TouchableOpacity key={action.label} style={styles.quickAction} onPress={() => onNeedSelect(action.need)}>
            <View style={[styles.quickBubble, selectedNeed === action.need && styles.quickBubbleActive]}>
              <Image source={action.icon} style={styles.quickIcon} resizeMode="contain" />
            </View>
            <Text style={[styles.quickLabel, selectedNeed === action.need && styles.quickLabelActive]}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.postNeed}>
        <View>
          <Text style={styles.postNeedTitle}>List your room / property for rent</Text>
          <Text style={styles.postNeedMeta}>Need a place to stay? Get matched today.</Text>
        </View>
        <TouchableOpacity style={styles.postNeedButton} onPress={onPostNeed}>
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

      {showRoomTypes ? (
        <>
          <SectionHeader title={`Room Types in ${data?.location.city || "Denver, CO"}`} />
          <View style={styles.roomTypeRow}>
            {roomTypes.map((type) => (
              <TouchableOpacity
                key={type.category}
                style={styles.roomType}
                onPress={() => {
                  onCategorySelect(selectedCategory === type.category ? "" : type.category);
                }}
              >
                <View style={[styles.roomCircle, selectedCategory === type.category && styles.roomCircleActive]}>
                  <Image source={type.icon} style={styles.roomIcon} resizeMode="contain" />
                </View>
                <Text style={styles.roomLabel}>{type.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}

      {localities.length ? (
        <>
          <SectionHeader title="Explore localities" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {localities.map((locality) => (
              <TouchableOpacity key={locality.name} style={styles.localityCard} onPress={() => onAreaSelect(locality.name)}>
                <Text style={styles.localityTitle}>{locality.name}</Text>
                <View style={styles.localityStats}>
                  <Text style={styles.localityChip}>{locality.offered} offered</Text>
                  <Text style={styles.localityChip}>{locality.needed} needed</Text>
                </View>
                <Text style={styles.avgRent}>Avg Rent: {locality.rent}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      ) : null}

      <View style={styles.carOverview}>
        <View style={styles.carOverviewCopy}>
          <Text style={styles.carEyebrow}>Rental cars</Text>
          <Text style={styles.carTitle}>Today's cheapest rate</Text>
          <Text style={styles.carMeta}>
            {cheapestCar ? `${cheapestCar.name} · ${cheapestCar.location || "Denver pickup"}` : "No active rental cars in this database yet."}
          </Text>
          <Text style={styles.carPhone}>Call / text: +1 9372518688</Text>
        </View>
        <View style={styles.carRateBox}>
          <Text style={styles.carRate}>{cheapestCar ? `$${cheapestCar.daily_price}` : "Open"}</Text>
          <Text style={styles.carRateMeta}>per day</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.md, paddingBottom: 32, gap: theme.spacing.lg },
  brandHeader: { alignItems: "center" },
  logo: { width: 150, height: 62 },
  topTabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  topTab: { paddingVertical: 12, paddingRight: 22 },
  topTabActive: { borderBottomWidth: 3, borderBottomColor: theme.colors.soft },
  topTabText: { color: theme.colors.muted, fontSize: 18, fontWeight: "900" },
  topTabTextActive: { color: theme.colors.text },
  stickySearch: { backgroundColor: theme.colors.bg, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  searchBar: { backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, minHeight: 64, paddingHorizontal: theme.spacing.md, flexDirection: "row", alignItems: "center", gap: 12 },
  searchIcon: { width: 30, height: 30 },
  searchText: { color: theme.colors.soft, flex: 1, fontSize: 20, fontWeight: "800" },
  later: { color: theme.colors.soft, backgroundColor: theme.colors.bg, borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 10, fontWeight: "900" },
  segment: { backgroundColor: "#252a7a", borderRadius: theme.radius.pill, flexDirection: "row", padding: 5 },
  segmentButton: { flex: 1, borderRadius: theme.radius.pill, alignItems: "center", paddingVertical: 13 },
  segmentActive: { backgroundColor: theme.colors.text },
  segmentText: { color: theme.colors.soft, fontSize: 17, fontWeight: "900" },
  segmentTextActive: { color: theme.colors.blue },
  quickRow: { gap: theme.spacing.md },
  quickAction: { width: 92, alignItems: "center", gap: 9 },
  quickBubble: { width: 78, height: 78, borderRadius: 39, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  quickBubbleActive: { backgroundColor: theme.colors.brand },
  quickIcon: { width: 52, height: 52 },
  quickLabel: { color: theme.colors.soft, fontSize: 13, textAlign: "center", fontWeight: "800" },
  quickLabelActive: { color: theme.colors.text },
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
  carOverview: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  carOverviewCopy: { flex: 1, gap: 5 },
  carEyebrow: { color: theme.colors.accent, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  carTitle: { color: theme.colors.text, fontSize: 22, fontWeight: "900" },
  carMeta: { color: theme.colors.muted, fontWeight: "800", lineHeight: 20 },
  carPhone: { color: theme.colors.green, fontWeight: "900" },
  carRateBox: { minWidth: 92, borderRadius: theme.radius.md, backgroundColor: theme.colors.text, padding: theme.spacing.sm, alignItems: "center" },
  carRate: { color: theme.colors.bg, fontSize: 24, fontWeight: "900" },
  carRateMeta: { color: "#555", fontWeight: "900" },
  roomTypeRow: { flexDirection: "row", justifyContent: "space-between" },
  roomType: { alignItems: "center", gap: 10, flex: 1 },
  roomCircle: { width: 86, height: 86, borderRadius: 43, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  roomCircleActive: { borderWidth: 2, borderColor: theme.colors.brand },
  roomIcon: { width: 58, height: 58 },
  roomLabel: { color: theme.colors.soft, fontWeight: "900", fontSize: 16 },
  localityCard: { width: 270, borderRadius: theme.radius.lg, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, marginRight: theme.spacing.md, padding: theme.spacing.md, gap: 14 },
  localityTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  localityStats: { flexDirection: "row", gap: 10 },
  localityChip: { color: theme.colors.blue, borderWidth: 1, borderColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 7, overflow: "hidden", fontWeight: "800" },
  avgRent: { color: theme.colors.green, fontSize: 18, fontWeight: "900" }
});
