import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  AccessibilityInfo, ActivityIndicator, Alert, Animated, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, Share,
  StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, View,
} from "react-native";
import {
  absoluteAssetUrl, acceptCommunityAnswer, answerCommunityPost, createCommunityPost, deleteCommunityPost,
  ensureCommunityGuestSession,
  getAccommodationLocationOptions, getChatCommunities, getChatLinkPreview, getCommunityFeed, getCommunityPost, joinChatCommunity,
  reactToCommunityContent, reportCommunityContent, saveCommunityPost,
  updateCommunityPost, updateCommunityPostStatus,
} from "../api/client";
import type { ChatLinkPreview } from "../api/client";
import { Car, Community, CommunityAnswer, CommunityPost, FairFaresUser } from "../types";
import { UserAvatar } from "../components/UserAvatar";
import { theme } from "../theme";
import { pickCompressedImages } from "../utils/imageUpload";
import { useResponsiveLayout } from "../utils/layout";
import { readGasCache } from "../utils/gasPriceCache";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  user: FairFaresUser | null;
  city: string;
  cars: Car[];
  onRequireLogin: () => void;
  onRequireSignup: () => void;
  onOpenHousing: (postId?: string) => void;
  onCreateHousingPost: (intent: "need_place" | "need_roommates" | "have_place") => void;
  onOpenRides: () => void;
  onOpenRentalCars: () => void;
  onOpenGas: () => void;
  onOpenCommunity: (communityId: string) => void;
  onBottomTabsHiddenChange?: (hidden: boolean) => void;
  initialPostId?: string;
  onInitialPostOpened?: () => void;
};

const categories = ["ALL", "GENERAL", "NEED_ROOMMATE", "NEED_PLACE", "HAVE_PLACE", "CARPOOL_RIDE"] as const;
const popularTopics = [
  { value: "HOUSING", image: require("../../assets/ask-topic-housing.png"), title: "Housing", subtitle: "Ask or share", color: "#d8edff" },
  { value: "RIDES", image: require("../../assets/ask-topic-carpool.png"), title: "Carpool", subtitle: "Find or offer", color: "#d9ffe7" },
  { value: "ALL", image: require("../../assets/ask-topic-general.png"), title: "General", subtitle: "All local posts", color: "#eee4ff" },
  { value: "RENTALS", image: require("../../assets/ask-topic-rental.png"), title: "Car Rental", subtitle: "Find a car", color: "#ffeadb" },
] as const;
const housingQuickLinks = [
  { intent: "need_place", icon: "👤", title: "I need a place", accent: "#16c98d", background: "#0a211b" },
  { intent: "need_roommates", icon: "👥", title: "Need roommates", accent: "#398bff", background: "#091827" },
  { intent: "have_place", icon: "⌂", title: "I have a place", accent: "#ff7b16", background: "#21160d" },
] as const;
const communityHeroPoster = require("../../assets/ask-community-logo-transparent.png");
const types: Array<{ value: CommunityPost["type"]; label: string }> = [
  { value: "QUESTION", label: "Ask a question" }, { value: "REQUEST", label: "Request help" },
  { value: "RECOMMENDATION", label: "Recommend" }, { value: "UPDATE", label: "Share update" },
];
const categoryLabels: Record<string, string> = {
  ALL: "For you", GENERAL: "General", NEED_ROOMMATE: "Need a roommate", NEED_PLACE: "Need a place",
  HAVE_PLACE: "Have a place", CARPOOL_RIDE: "Carpool ride", HOUSING: "Housing", RIDES: "Rides",
  LOCAL: "Local", PLACES: "Places", STUDENT: "Students", SERVICES: "Services", SAFETY: "Safety",
};
const categoryIcons: Record<string, string> = { GENERAL: "💬", NEED_ROOMMATE: "👥", NEED_PLACE: "🔑", HAVE_PLACE: "🏠", CARPOOL_RIDE: "🚗" };
const reactionOptions = [
  { value: "LIKE", emoji: "👍", label: "Like" },
  { value: "LOVE", emoji: "❤️", label: "Love" },
  { value: "CARE", emoji: "🥰", label: "Care" },
  { value: "HAHA", emoji: "😄", label: "Haha" },
  { value: "WOW", emoji: "😮", label: "Wow" },
  { value: "SAD", emoji: "😢", label: "Sad" },
  { value: "ANGRY", emoji: "😡", label: "Angry" },
] as const;
const emptyDetails = { budget: "", moveInDate: "", preference: "", rent: "", availableDate: "", roomType: "", origin: "", destination: "", travelDate: "", travelTime: "", seats: "" };

function absoluteUrl(value: string) {
  return absoluteAssetUrl(value);
}

function monthlyRentalRange(price: number | string) {
  const daily = Math.round(Number(price || 0));
  const dailyLow = Math.max(25, daily - 5);
  const dailyHigh = Math.max(dailyLow, daily + 5);
  const discountedDailyLow = Math.max(1, Math.round(dailyLow * 0.7));
  const discountedDailyHigh = Math.max(discountedDailyLow, Math.round(dailyHigh * 0.7));
  return {
    dailyLow: discountedDailyLow,
    dailyHigh: discountedDailyHigh,
  };
}

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Just now";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "FF"; }
function firstWebUrl(value: string) {
  const match = value.match(/https?:\/\/[^\s<>]+/i)?.[0] || "";
  return match.replace(/[),.!?;:'\"]+$/, "");
}
const usStateCodes = new Set(["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"]);
const usStateNames: Record<string, string> = { Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC" };
const usStateNameCodes = new Map(Object.entries(usStateNames).map(([name, code]) => [name.toLocaleLowerCase(), code]));
function normalizedUsCityKey(value: string) {
  let parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 3 && /^(?:US|USA|United States)$/i.test(parts[2])) parts = parts.slice(0, 2);
  if (parts.length !== 2) return "";
  const region = usStateCodes.has(parts[1].toUpperCase()) ? parts[1].toUpperCase() : usStateNameCodes.get(parts[1].toLocaleLowerCase());
  return region ? `${parts[0].toLocaleLowerCase()},${region}` : "";
}
function normalizedLocationLabel(value: string) {
  let parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 3 && /^(?:US|USA|United States)$/i.test(parts[2])) parts = parts.slice(0, 2);
  if (parts.length !== 2) return value.trim();
  const region = usStateCodes.has(parts[1].toUpperCase()) ? parts[1].toUpperCase() : usStateNameCodes.get(parts[1].toLocaleLowerCase());
  return region ? `${parts[0]}, ${region}` : value.trim();
}
function utcTimestamp(value: string) {
  if (!value) return Number.POSITIVE_INFINITY;
  return new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime();
}
function isActivePublicUsPost(post: CommunityPost, localCity: string, localIds: Set<string>) {
  const parts = post.city.split(",").map((part) => part.trim()).filter(Boolean);
  const expiresAt = utcTimestamp(post.expiresAt);
  return parts.length === 2
    && Boolean(normalizedUsCityKey(post.city))
    && normalizedUsCityKey(post.city) !== normalizedUsCityKey(localCity)
    && !localIds.has(post.id)
    && post.status === "PUBLISHED"
    && post.fulfillmentStatus === "OPEN"
    && (!Number.isFinite(expiresAt) || expiresAt > Date.now())
    && post.community?.visibility !== "PRIVATE";
}
function previewOrFallback<T>(promise: Promise<T>, fallback: T, timeoutMs = 2500) {
  return Promise.race([promise.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs))]);
}

function SharedLinkCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<ChatLinkPreview | null>(null);
  const [previewImageFailed, setPreviewImageFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const fallbackHost = useMemo(() => {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch { return url; }
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setPreviewImageFailed(false);
    setFaviconFailed(false);
    void getChatLinkPreview(url)
      .then((payload) => { if (!cancelled) setPreview(payload.preview || null); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [url]);

  const title = preview?.title || preview?.siteName || fallbackHost;
  const host = preview?.siteName || preview?.host || fallbackHost;
  const fallbackFaviconUrl = useMemo(() => {
    try { return `${new URL(url).origin}/favicon.ico`; }
    catch { return ""; }
  }, [url]);
  const faviconUrl = preview?.faviconUrl || fallbackFaviconUrl;
  const destinationUrl = preview?.url || url;
  return (
    <TouchableOpacity
      style={[styles.linkCard, { backgroundColor: theme.colors.panel2, borderColor: theme.colors.line }]}
      activeOpacity={0.84}
      onPress={(event) => { event.stopPropagation(); void Linking.openURL(destinationUrl); }}
      accessibilityRole="link"
      accessibilityLabel={`Open helpful link from ${host}`}
    >
      {preview?.imageUrl && !previewImageFailed
        ? <Image source={{ uri: preview.imageUrl }} style={styles.linkPreviewImage} resizeMode="cover" onError={() => setPreviewImageFailed(true)} />
        : <View style={styles.linkPreviewPlaceholder}><Text style={styles.linkPreviewPlaceholderText}>↗</Text></View>}
      <View style={styles.linkContent}>
        <Text style={styles.linkLabel} numberOfLines={2}>{title}</Text>
        {preview?.description ? <Text style={styles.linkDescription} numberOfLines={2}>{preview.description}</Text> : null}
        <View style={styles.linkSource}>
          {faviconUrl && !faviconFailed
            ? <Image source={{ uri: faviconUrl }} style={styles.linkFavicon} resizeMode="contain" onError={() => setFaviconFailed(true)} />
            : <View style={styles.linkFaviconFallback}><Text style={styles.linkFaviconFallbackText}>↗</Text></View>}
          <Text style={styles.linkUrl} numberOfLines={1}>{host}</Text>
        </View>
      </View>
      <Text style={styles.linkChevron}>›</Text>
    </TouchableOpacity>
  );
}

export function CommunityScreen({ user, city, cars, onRequireLogin, onRequireSignup, onOpenHousing, onCreateHousingPost, onOpenRides, onOpenRentalCars, onOpenGas, onOpenCommunity, onBottomTabsHiddenChange, initialPostId = "", onInitialPostOpened }: Props) {
  const layout = useResponsiveLayout();
  const safeAreaInsets = useSafeAreaInsets();
  // React Native's Android page-sheet Modal can report a zero top inset even
  // when the device has a centered camera cutout. Keep the whole action row
  // below that system region instead of only making the row taller.
  const modalHeaderTopInset = Platform.OS === "android" ? Math.max(safeAreaInsets.top, 32) : safeAreaInsets.top;
  const isLight = useColorScheme() === "light";
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [nationalPosts, setNationalPosts] = useState<CommunityPost[]>([]);
  const [groups, setGroups] = useState<Community[]>([]);
  const [groupSuggestionCity, setGroupSuggestionCity] = useState(city);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [cityDraft, setCityDraft] = useState("");
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [cityOptionsLoading, setCityOptionsLoading] = useState(false);
  const [locationRefreshKey, setLocationRefreshKey] = useState(0);
  const [lowestGasPrice, setLowestGasPrice] = useState<number | null>(null);
  const [gasPreviewCoordinates, setGasPreviewCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [category, setCategory] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const pullOffset = useRef(new Animated.Value(0)).current;
  const heroEntrance = useRef(new Animated.Value(0)).current;
  const gasIconScale = useRef(new Animated.Value(1)).current;
  const gasIconShake = useRef(new Animated.Value(0)).current;
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingPostId, setEditingPostId] = useState("");
  const [detail, setDetail] = useState<CommunityPost | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [answerReplyTarget, setAnswerReplyTarget] = useState<{ id: string; name: string } | null>(null);
  const [expandedReplyThreads, setExpandedReplyThreads] = useState<Set<string>>(() => new Set());
  const [guestIdentity, setGuestIdentity] = useState("");
  const [guestRemaining, setGuestRemaining] = useState(6);
  const [guestBenefitsOpen, setGuestBenefitsOpen] = useState(false);
  const pendingGuestAuth = useRef<"signup" | "login" | "">("");
  const [form, setForm] = useState({ type: "QUESTION" as CommunityPost["type"], category: "GENERAL" as CommunityPost["category"], title: "", body: "", area: "", linkUrl: "", communityId: "", images: [] as string[], details: { ...emptyDetails }, expiresInDays: 45 });
  const [publishing, setPublishing] = useState(false);
  const [groupBusyId, setGroupBusyId] = useState("");
  const [expandedReactionTarget, setExpandedReactionTarget] = useState("");
  const reactionRequests = useRef(new Set<string>());
  const reactionLongPressTarget = useRef("");
  const groupLoadGeneration = useRef(0);
  const feedLoadGeneration = useRef(0);
  const fallbackNationalOffset = useRef(0);
  const manualFeedCity = useRef(false);
  const feedCityStorageKey = `fairfares.ask.feed-city.${Number(user?.id || 0) || "guest"}`;
  const lowestRental = useMemo(() => cars.reduce<Car | null>((lowest, car) => {
    const price = Number(car.daily_price);
    if (!Number.isFinite(price) || price <= 0 || !car.image_url) return lowest;
    return !lowest || price < Number(lowest.daily_price) ? car : lowest;
  }, null), [cars]);
  const displayedGasPrice = lowestGasPrice ?? 3.54;

  const load = useCallback(async (quiet = false) => {
    const requestedFeedGeneration = feedLoadGeneration.current + 1;
    feedLoadGeneration.current = requestedFeedGeneration;
    fallbackNationalOffset.current = 0;
    setLoadingMore(false);
    if (!quiet) setLoading(true);
    try {
      // Communities can be noticeably slower than the feed in production.
      // Load them independently so a slow Chitthi request never freezes Ask.
      const requestedGroupGeneration = groupLoadGeneration.current + 1;
      groupLoadGeneration.current = requestedGroupGeneration;
      void previewOrFallback(getChatCommunities(groupSuggestionCity), [] as Community[], 10000)
        .then((communityRows) => {
          if (groupLoadGeneration.current !== requestedGroupGeneration) return;
          setGroups((communityRows || []).filter((group) => group.joined || group.visibility === "PUBLIC"));
        })
        .catch(() => undefined);
      const feed = await previewOrFallback(
        getCommunityFeed({ q: appliedQuery, city: groupSuggestionCity, category: category === "ALL" ? "" : category, communityId: selectedGroup, layered: !selectedGroup, limit: 30 }),
        { ok: true, posts: [] as CommunityPost[], pagination: { hasMore: false } },
        10000,
      );
      if (feedLoadGeneration.current !== requestedFeedGeneration) return;
      setPosts(feed.sections?.local?.posts || feed.posts || []);
      if (feed.sections) {
        setNationalPosts(feed.sections.national?.posts || []);
        setHasMore(Boolean(feed.pagination?.hasMore));
      } else if (!selectedGroup) {
        const nationwide = await previewOrFallback(
          getCommunityFeed({ q: appliedQuery, category: category === "ALL" ? "" : category, limit: 30 }),
          { ok: true, posts: [] as CommunityPost[], pagination: { hasMore: false } },
          10000,
        );
        if (feedLoadGeneration.current !== requestedFeedGeneration) return;
        fallbackNationalOffset.current = nationwide.posts?.length || 0;
        const localIds = new Set((feed.posts || []).map((post) => post.id));
        setNationalPosts((nationwide.posts || []).filter((post) => isActivePublicUsPost(post, groupSuggestionCity, localIds)));
        setHasMore(Boolean(feed.pagination?.hasMore || nationwide.pagination?.hasMore));
      } else {
        setNationalPosts([]);
        setHasMore(Boolean(feed.pagination?.hasMore));
      }
    } catch { if (feedLoadGeneration.current === requestedFeedGeneration) { setPosts([]); setNationalPosts([]); } }
    finally { if (feedLoadGeneration.current === requestedFeedGeneration) { setLoading(false); setRefreshing(false); } }
  }, [appliedQuery, category, city, groupSuggestionCity, selectedGroup, user?.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (loading) {
      heroEntrance.setValue(0);
      return;
    }
    const animation = Animated.spring(heroEntrance, {
      toValue: 1,
      damping: 18,
      stiffness: 105,
      mass: 0.9,
      restDisplacementThreshold: 0.5,
      restSpeedThreshold: 0.5,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [heroEntrance, loading]);
  useEffect(() => {
    let cancelled = false;
    let animation: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled || reduceMotion) return;
      animation = Animated.sequence([
        Animated.delay(450),
        Animated.spring(gasIconScale, { toValue: 1.2, damping: 8, stiffness: 190, mass: 0.65, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(gasIconShake, { toValue: -1, duration: 55, useNativeDriver: true }),
          Animated.timing(gasIconShake, { toValue: 1, duration: 75, useNativeDriver: true }),
          Animated.timing(gasIconShake, { toValue: -0.7, duration: 65, useNativeDriver: true }),
          Animated.timing(gasIconShake, { toValue: 0.45, duration: 60, useNativeDriver: true }),
          Animated.timing(gasIconShake, { toValue: 0, duration: 55, useNativeDriver: true }),
        ]),
        Animated.spring(gasIconScale, { toValue: 1, damping: 11, stiffness: 150, mass: 0.7, useNativeDriver: true }),
      ]);
      animation.start();
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      animation?.stop();
      gasIconScale.stopAnimation();
      gasIconShake.stopAnimation();
    };
  }, [gasIconScale, gasIconShake]);
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(feedCityStorageKey).then((storedCity) => {
      const normalized = normalizedLocationLabel(storedCity || "");
      if (!cancelled && normalized && normalizedUsCityKey(normalized)) {
        manualFeedCity.current = true;
        setGroupSuggestionCity(normalized);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [feedCityStorageKey]);
  useEffect(() => {
    let cancelled = false;
    if (manualFeedCity.current) return () => { cancelled = true; };
    setGroupSuggestionCity(normalizedLocationLabel(city));
    if (Platform.OS === "web") return () => { cancelled = true; };
    void (async () => {
      try {
        let permission = await Location.getForegroundPermissionsAsync();
        if (permission.canAskAgain && !permission.granted) permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted || cancelled) return;
        // A live fix is authoritative for city selection. Last-known location is
        // only a short-lived fallback; preferring it previously allowed a stale
        // simulator/device coordinate to label Denver as another state.
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .catch(() => Location.getLastKnownPositionAsync({ maxAge: 60 * 1000, requiredAccuracy: 1000 }));
        if (!position || cancelled) return;
        setGasPreviewCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        const [address] = await Location.reverseGeocodeAsync(position.coords);
        const locality = String(address?.city || address?.district || address?.subregion || "").trim();
        const region = String(address?.region || "").trim();
        const currentCity = normalizedLocationLabel([locality, region].filter(Boolean).join(", "));
        if (currentCity && !cancelled && !manualFeedCity.current) setGroupSuggestionCity(currentCity);
      } catch {
        // The selected feed city remains the fallback when device location is unavailable.
      }
    })();
    return () => { cancelled = true; };
  }, [city, locationRefreshKey, user?.id]);
  useEffect(() => {
    if (Platform.OS === "web" || gasPreviewCoordinates) return;
    let cancelled = false;
    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted || cancelled) return;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .catch(() => Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000, requiredAccuracy: 1000 }));
      if (!position || cancelled) return;
      setGasPreviewCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [gasPreviewCoordinates, locationRefreshKey, user?.id]);
  useEffect(() => {
    let cancelled = false;
    // Ask only reads the last result saved when Cheap Gas was explicitly
    // opened. Merely loading this feed never contacts Google.
    if (!gasPreviewCoordinates) {
      setLowestGasPrice(null);
      return () => { cancelled = true; };
    }
    void readGasCache("regular", gasPreviewCoordinates).then((result) => {
      if (cancelled) return;
      const prices = (result?.stations || [])
        .map((station) => Number(station.price))
        .filter((price) => Number.isFinite(price) && price > 0);
      setLowestGasPrice(prices.length ? Math.min(...prices) : null);
    });
    return () => { cancelled = true; };
  }, [gasPreviewCoordinates, locationRefreshKey, user?.id]);
  useEffect(() => {
    if (!cityPickerOpen || cityDraft.trim().length < 2) { setCityOptions([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      setCityOptionsLoading(true);
      void getAccommodationLocationOptions(cityDraft.trim()).then((result) => {
        if (cancelled) return;
        const requestedParts = cityDraft.split(",").map((part) => part.trim()).filter(Boolean);
        const requestedCity = requestedParts[0]?.toLocaleLowerCase() || "";
        const requestedKey = normalizedUsCityKey(cityDraft);
        const requestedRegion = requestedKey.split(",")[1] || "";
        const options = (result?.cities || [])
          .map(normalizedLocationLabel)
          .filter((value) => Boolean(normalizedUsCityKey(value)))
          .filter((value) => normalizedUsCityKey(value).split(",")[0].startsWith(requestedCity))
          .filter((value) => !requestedRegion || normalizedUsCityKey(value).endsWith(`,${requestedRegion}`))
          .filter((value, index, values) => value && values.indexOf(value) === index)
          .slice(0, 8);
        setCityOptions(options);
      }).finally(() => { if (!cancelled) setCityOptionsLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cityDraft, cityPickerOpen]);

  const chooseFeedCity = (value: string) => {
    const nextCity = normalizedLocationLabel(value);
    if (!normalizedUsCityKey(nextCity)) {
      Alert.alert("Choose a city and state", "Select a suggestion or enter a location such as Denver, CO.");
      return;
    }
    manualFeedCity.current = true;
    setSelectedGroup("");
    setGroupSuggestionCity(nextCity);
    setCityPickerOpen(false);
    void AsyncStorage.setItem(feedCityStorageKey, nextCity);
  };
  useEffect(() => {
    if (!initialPostId) return;
    setDetailBusy(true);
    void getCommunityPost(initialPostId).then((post) => {
      if (post) setDetail(post);
      else Alert.alert("Post unavailable", "This community post was removed or is no longer available.");
    }).catch((error) => Alert.alert("Post unavailable", message(error))).finally(() => {
      setDetailBusy(false);
      onInitialPostOpened?.();
    });
  }, [initialPostId, onInitialPostOpened]);
  useEffect(() => { onBottomTabsHiddenChange?.(composerOpen || Boolean(detail)); }, [composerOpen, detail, onBottomTabsHiddenChange]);

  const openComposer = () => {
    if (!user) { onRequireLogin(); return; }
    setEditingPostId("");
    setForm((current) => ({ ...current, area: current.area || groupSuggestionCity, communityId: selectedGroup }));
    setComposerOpen(true);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const requestedFeedGeneration = feedLoadGeneration.current;
    try {
      const feed = await getCommunityFeed({ q: appliedQuery, city: groupSuggestionCity, category: category === "ALL" ? "" : category, communityId: selectedGroup, layered: !selectedGroup, offset: posts.length, localOffset: posts.length, nationalOffset: nationalPosts.length, limit: 30 });
      const nextLocal = feed.sections?.local?.posts || feed.posts || [];
      const nationwide = !feed.sections && !selectedGroup
        ? await getCommunityFeed({ q: appliedQuery, category: category === "ALL" ? "" : category, offset: fallbackNationalOffset.current, limit: 30 })
        : null;
      if (feedLoadGeneration.current !== requestedFeedGeneration) return;
      if (nationwide) fallbackNationalOffset.current += nationwide.posts?.length || 0;
      const localIds = new Set([...posts, ...nextLocal].map((post) => post.id));
      const nextNational = feed.sections?.national?.posts || (nationwide?.posts || []).filter((post) => isActivePublicUsPost(post, groupSuggestionCity, localIds));
      setPosts((current) => [...current, ...nextLocal.filter((post) => !current.some((item) => item.id === post.id))]);
      setNationalPosts((current) => [...current, ...nextNational.filter((post) => !current.some((item) => item.id === post.id))]);
      setHasMore(Boolean(feed.pagination?.hasMore || nationwide?.pagination?.hasMore));
    } catch (error) { if (feedLoadGeneration.current === requestedFeedGeneration) Alert.alert("Could not load more", message(error)); }
    finally { if (feedLoadGeneration.current === requestedFeedGeneration) setLoadingMore(false); }
  };

  const openDetail = async (post: CommunityPost) => {
    setDetail(post); setDetailBusy(true);
    try {
      if (!user) {
        const guest = await ensureCommunityGuestSession();
        setGuestIdentity(guest.guestId);
        setGuestRemaining(guest.remaining);
      }
      setDetail(await getCommunityPost(post.id));
    }
    catch (error) { Alert.alert("Could not open post", message(error)); }
    finally { setDetailBusy(false); }
  };

  const mutatePost = (id: string, update: (post: CommunityPost) => CommunityPost) => {
    setPosts((current) => current.map((post) => post.id === id ? update(post) : post));
    setNationalPosts((current) => current.map((post) => post.id === id ? update(post) : post));
    setDetail((current) => current?.id === id ? update(current) : current);
  };

  const optimisticReaction = <T extends { viewerReaction: string; reactionCount: number; reactionCounts?: Record<string, number> }>(item: T, reaction: string): T => {
    const previous = item.viewerReaction;
    const selecting = previous !== reaction;
    const counts = { ...(item.reactionCounts || {}) };
    if (previous) counts[previous] = Math.max(0, Number(counts[previous] || 0) - 1);
    if (selecting) counts[reaction] = Number(counts[reaction] || 0) + 1;
    return {
      ...item,
      viewerReaction: selecting ? reaction : "",
      reactionCount: Math.max(0, Number(item.reactionCount || 0) + (previous ? -1 : 0) + (selecting ? 1 : 0)),
      reactionCounts: counts,
    };
  };

  const reactPost = async (post: CommunityPost, reaction: string) => {
    const requestKey = `post-${post.id}`;
    if (reactionRequests.current.has(requestKey)) return;
    reactionRequests.current.add(requestKey);
    const previousReaction = post.viewerReaction;
    const previousReactionCount = post.reactionCount;
    const previousReactionCounts = post.reactionCounts;
    mutatePost(post.id, (value) => {
      const optimistic = optimisticReaction(value, reaction);
      return { ...optimistic, reacted: Boolean(optimistic.viewerReaction) };
    });
    try {
      const result = await reactToCommunityContent({ postId: post.id }, reaction);
      mutatePost(post.id, (value) => ({ ...value, reacted: result.active, viewerReaction: result.reaction, reactionCount: result.count, reactionCounts: result.counts }));
    } catch (error) {
      mutatePost(post.id, (value) => ({ ...value, reacted: Boolean(previousReaction), viewerReaction: previousReaction, reactionCount: previousReactionCount, reactionCounts: previousReactionCounts }));
      Alert.alert("Reaction not saved", message(error));
    } finally { reactionRequests.current.delete(requestKey); }
  };

  const reactAnswer = async (answerItem: CommunityAnswer, reaction: string) => {
    const requestKey = `answer-${answerItem.id}`;
    if (reactionRequests.current.has(requestKey)) return;
    reactionRequests.current.add(requestKey);
    const previousReaction = answerItem.viewerReaction;
    const previousReactionCount = answerItem.reactionCount;
    const previousReactionCounts = answerItem.reactionCounts;
    setDetail((current) => current ? { ...current, answers: current.answers?.map((item) => item.id === answerItem.id ? optimisticReaction(item, reaction) : item) } : current);
    try {
      const result = await reactToCommunityContent({ answerId: answerItem.id }, reaction);
      setDetail((current) => current ? { ...current, answers: current.answers?.map((item) => item.id === answerItem.id ? { ...item, reactionCount: result.count, viewerReaction: result.reaction, reactionCounts: result.counts } : item) } : current);
    } catch (error) {
      setDetail((current) => current ? { ...current, answers: current.answers?.map((item) => item.id === answerItem.id ? { ...item, viewerReaction: previousReaction, reactionCount: previousReactionCount, reactionCounts: previousReactionCounts } : item) } : current);
      Alert.alert("Reaction not saved", message(error));
    } finally { reactionRequests.current.delete(requestKey); }
  };

  const normalizedReactionCount = (counts: Record<string, number> | undefined, reaction: string) => {
    if (reaction === "LIKE") return Number(counts?.LIKE || 0) + Number(counts?.HELPFUL || 0);
    if (reaction === "LOVE") return Number(counts?.LOVE || 0) + Number(counts?.THANKS || 0);
    if (reaction === "CARE") return Number(counts?.CARE || 0) + Number(counts?.SUPPORT || 0);
    return Number(counts?.[reaction] || 0);
  };

  const reactionBreakdown = (counts: Record<string, number> | undefined, total: number, viewerReaction = "") => {
    const detailed = reactionOptions
      .map((option) => ({ ...option, count: normalizedReactionCount(counts, option.value) }))
      .filter((option) => option.count > 0);
    if (detailed.length || total <= 0) return detailed;
    // Older deployed API responses contain only `reactionCount`. Keep the
    // Admin-style summary visible until those servers return per-emoji counts.
    const fallback = reactionOptions.find((option) => option.value === viewerReaction) || reactionOptions[0];
    return [{ ...fallback, count: total }];
  };

  const reactionStats = (counts: Record<string, number> | undefined, total: number, viewerReaction = "") => total > 0 ? (
    <View style={styles.answerReactionStats}>
      {reactionBreakdown(counts, total, viewerReaction).map((option) => <Text key={option.value} style={styles.activityText}>{option.count} {option.emoji} {option.label}</Text>)}
    </View>
  ) : null;

  const reactionPicker = (target: string, viewerReaction: string, count: number, counts: Record<string, number> | undefined, onReact: (reaction: string) => void, iconOnly = false) => {
    const selected = reactionOptions.find((option) => option.value === viewerReaction);
    return <View style={styles.reactionControl}>
      {expandedReactionTarget === target ? <View style={styles.reactionTray}>{reactionOptions.map((option) => <TouchableOpacity key={option.value} style={styles.reactionChoice} onPress={(event) => { event.stopPropagation(); reactionLongPressTarget.current = ""; setExpandedReactionTarget(""); onReact(option.value); }} accessibilityLabel={`${option.label} reaction`}><Text style={styles.reactionChoiceEmoji}>{option.emoji}</Text></TouchableOpacity>)}</View> : null}
      <TouchableOpacity
        style={[styles.reactionSummary, iconOnly && styles.reactionSummaryIconOnly]}
        onPress={(event) => {
          event.stopPropagation();
          if (reactionLongPressTarget.current === target) {
            reactionLongPressTarget.current = "";
            return;
          }
          setExpandedReactionTarget((current) => current === target ? "" : target);
        }}
        onLongPress={(event) => {
          event.stopPropagation();
          reactionLongPressTarget.current = target;
          setExpandedReactionTarget(target);
        }}
        delayLongPress={250}
        accessibilityLabel={`${selected?.label || "Like"}${count ? `, ${count} reactions` : ""}. Choose reaction`}
        accessibilityHint="Tap to show all seven reactions"
        accessibilityState={{ expanded: expandedReactionTarget === target }}
      ><Text style={styles.reactionSummaryEmoji}>{selected?.emoji || "👍"}</Text>{!iconOnly ? <Text style={[styles.reactionSummaryText, isLight && styles.textBodyLight, selected && styles.reactionSummaryTextActive]}>{selected?.label || "Like"}</Text> : null}{count ? <Text style={[styles.reactionTotal, isLight && styles.textSecondaryLight]}>{count}</Text> : null}</TouchableOpacity>
    </View>
  };

  const toggleSave = async (post: CommunityPost) => {
    if (!user) { onRequireLogin(); return; }
    try { const result = await saveCommunityPost(post.id); mutatePost(post.id, (value) => ({ ...value, saved: result.saved })); }
    catch (error) { Alert.alert("Post not saved", message(error)); }
  };

  const publish = async () => {
    if (!form.title.trim() || !form.body.trim()) { Alert.alert("Complete your post", "Add a clear title and helpful details."); return; }
    setPublishing(true);
    try {
      if (editingPostId) {
        await updateCommunityPost(editingPostId, { title: form.title.trim(), body: form.body.trim(), linkUrl: form.linkUrl.trim(), details: form.details });
        await load(true);
      } else {
        const result = await createCommunityPost({ ...form, city: groupSuggestionCity, title: form.title.trim(), body: form.body.trim(), area: form.area.trim(), linkUrl: form.linkUrl.trim() });
        setPosts((current) => [result.post, ...current]);
      }
      setForm({ type: "QUESTION", category: "GENERAL", title: "", body: "", area: "", linkUrl: "", communityId: "", images: [], details: { ...emptyDetails }, expiresInDays: 45 });
      setComposerOpen(false);
      Alert.alert(editingPostId ? "Post updated" : "Posted", editingPostId ? "Your changes are live." : "Your post is now live in Ask Community.");
      setEditingPostId("");
    } catch (error) { Alert.alert("Could not publish", message(error)); }
    finally { setPublishing(false); }
  };

  const submitAnswer = async () => {
    if (!detail || !answer.trim()) return;
    if (!user && guestRemaining <= 0) { setGuestBenefitsOpen(true); return; }
    const replyThreadId = answerReplyTarget?.id || "";
    setDetailBusy(true);
    try {
      const result = await answerCommunityPost(detail.id, answer.trim(), answerReplyTarget?.id || "");
      setAnswer("");
      setAnswerReplyTarget(null);
      if (replyThreadId) setExpandedReplyThreads((current) => new Set([...current, replyThreadId]));
      if (!user && typeof result.guestRemaining === "number") {
        setGuestRemaining(result.guestRemaining);
      }
      setDetail(await getCommunityPost(detail.id));
      await load(true);
    }
    catch (error) {
      if (!user && message(error).toLowerCase().includes("unlimited community")) setGuestBenefitsOpen(true);
      else Alert.alert("Answer not posted", message(error));
    }
    finally { setDetailBusy(false); }
  };

  const confirmDelete = (post: CommunityPost) => Alert.alert("Delete post?", "This removes the post from all community feeds.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { try { await deleteCommunityPost(post.id); setPosts((current) => current.filter((item) => item.id !== post.id)); setNationalPosts((current) => current.filter((item) => item.id !== post.id)); setDetail(null); } catch (error) { Alert.alert("Could not delete", message(error)); } } },
  ]);

  const beginGuestAuth = (mode: "signup" | "login") => {
    pendingGuestAuth.current = mode;
    setGuestBenefitsOpen(false);
    setDetail(null);
    if (Platform.OS !== "ios") {
      setTimeout(() => {
        if (pendingGuestAuth.current !== mode) return;
        pendingGuestAuth.current = "";
        mode === "signup" ? onRequireSignup() : onRequireLogin();
      }, 550);
    }
  };

  const finishGuestAuth = () => {
    if (!pendingGuestAuth.current) return;
    const mode = pendingGuestAuth.current;
    pendingGuestAuth.current = "";
    setTimeout(() => mode === "signup" ? onRequireSignup() : onRequireLogin(), 80);
  };

  const completedStatus = (post: CommunityPost): CommunityPost["fulfillmentStatus"] => post.category === "HAVE_PLACE" ? "FILLED" : post.category === "CARPOOL_RIDE" ? "ARRANGED" : post.category === "NEED_PLACE" || post.category === "NEED_ROOMMATE" ? "FOUND" : "RESOLVED";
  const managePost = (post: CommunityPost) => Alert.alert("Manage post", "Choose an action.", [
    { text: post.expiresAt && new Date(post.expiresAt).getTime() <= Date.now() ? "Renew for 45 days" : post.fulfillmentStatus === "OPEN" ? `Mark ${completedStatus(post).toLowerCase()}` : "Reopen post", onPress: async () => { try { const expired = Boolean(post.expiresAt && new Date(post.expiresAt).getTime() <= Date.now()); const status = expired || post.fulfillmentStatus !== "OPEN" ? "OPEN" : completedStatus(post); await updateCommunityPostStatus(post.id, status); mutatePost(post.id, (value) => ({ ...value, fulfillmentStatus: status, canAnswer: status === "OPEN", expiresAt: expired ? new Date(Date.now() + 45 * 86400000).toISOString() : value.expiresAt })); } catch (error) { Alert.alert("Status not changed", message(error)); } } },
    { text: "Edit", onPress: () => { setEditingPostId(post.id); setForm({ type: post.type, category: post.category, title: post.title, body: post.body, area: post.area, linkUrl: post.linkUrl, communityId: post.community?.id || "", images: [], details: { ...emptyDetails, ...post.details }, expiresInDays: 45 }); setDetail(null); setComposerOpen(true); } },
    { text: "Delete", style: "destructive", onPress: () => confirmDelete(post) },
    { text: "Cancel", style: "cancel" },
  ]);

  const report = (post: CommunityPost) => {
    if (!user) { onRequireLogin(); return; }
    const submitReport = (reason: string) => void reportCommunityContent({ postId: post.id }, reason)
      .then(() => Alert.alert("Report received", "Moderators will review this post."))
      .catch((error) => Alert.alert("Report not submitted", message(error)));
    Alert.alert("Report post", "Choose the closest reason.", [
    { text: "Spam", onPress: () => submitReport("SPAM") },
    { text: "Unsafe", onPress: () => submitReport("UNSAFE") },
    { text: "Cancel", style: "cancel" },
    ]);
  };

  const groupOptions = useMemo(() => groups.filter((group) => group.joined), [groups]);
  const suggestedCommunities = useMemo(() => {
    const currentCity = normalizedUsCityKey(groupSuggestionCity);
    return groups
      .filter((group) => {
        if (group.visibility !== "PUBLIC") return false;
        const groupCity = normalizedUsCityKey(group.suggestionCity || group.area || "");
        return Boolean(currentCity && groupCity === currentCity);
      })
      .sort((left, right) => Number(left.joined) - Number(right.joined) || right.memberCount - left.memberCount);
  }, [groupSuggestionCity, groups]);
  const setDetailField = (key: keyof typeof emptyDetails, value: string) => setForm((current) => ({ ...current, details: { ...current.details, [key]: value } }));

  const joinSuggestedCommunity = async (group: Community) => {
    if (!user) { onRequireLogin(); return; }
    if (group.joined) { onOpenCommunity(group.id); return; }
    setGroupBusyId(group.id);
    try {
      await joinChatCommunity(group.id, group.suggestionCity || groupSuggestionCity, group.suggestionPurpose || "COMMUNITY");
      setGroups((current) => current.map((item) => item.id === group.id
        ? { ...item, joined: true, memberCount: item.memberCount + 1 }
        : item));
    } catch (error) {
      Alert.alert("Could not join", message(error));
    } finally {
      setGroupBusyId("");
    }
  };

  const renderCommunitySuggestions = () => suggestedCommunities.length ? (
    <View style={[styles.inlineCommunities, isLight && styles.inlineCommunitiesLight]}>
      <View style={styles.inlineCommunityHead}><View><Text style={styles.inlineCommunityEyebrow}>NEAR {groupSuggestionCity.split(",", 1)[0].toUpperCase()}</Text><Text style={styles.inlineCommunityTitle}>Join communities</Text></View><View style={styles.inlineCommunitySwipe}><Text style={styles.inlineCommunitySwipeText}>Swipe</Text><Text style={styles.inlineCommunitySwipeArrow}>→</Text></View></View>
      <Text style={styles.inlineCommunityBody}>Connect with local members and conversations near you.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.inlineCommunityRail}>
        {suggestedCommunities.map((group) => <View key={group.id} style={[styles.inlineCommunityCard, isLight && styles.inlineCommunityCardLight]}><UserAvatar photoUrl={group.photoUrl} style={styles.inlineCommunityPhoto} imageStyle={styles.inlineCommunityPhotoImage} fallback={<Text style={styles.inlineCommunityPhotoGlyph}>🏘️</Text>} /><Text style={styles.inlineCommunityName} numberOfLines={2}>{group.name}</Text><Text style={styles.inlineCommunityMeta} numberOfLines={1}>{group.area || group.suggestionCity || groupSuggestionCity}</Text><Text style={styles.inlineCommunityMembers}>{group.memberCount} members</Text><TouchableOpacity style={[styles.inlineJoinButton, group.joined && styles.inlineJoinedButton]} disabled={Boolean(groupBusyId)} accessibilityRole="button" accessibilityLabel={`${group.joined ? "Open" : "Join"} ${group.name}`} onPress={() => void joinSuggestedCommunity(group)}><Text style={[styles.inlineJoinText, group.joined && styles.inlineJoinedText]}>{groupBusyId === group.id ? "…" : group.joined ? "Open" : "Join"}</Text></TouchableOpacity></View>)}
      </ScrollView>
    </View>
  ) : null;

  const communityInsertIndex = Math.min(3, posts.length - 1);

  const renderPostImages = (images: string[]) => {
    const visible = images.slice(0, 4);
    if (!visible.length) return null;
    return <View style={[styles.postMediaGrid, visible.length === 1 && styles.postMediaGridSingle]}>
      {visible.map((image, index) => (
        <View key={`${image}-${index}`} style={[
          styles.postMediaCell,
          visible.length === 1 && styles.postMediaCellSingle,
          visible.length === 2 && styles.postMediaCellTwo,
          visible.length === 3 && index === 0 && styles.postMediaCellThreeHero,
          visible.length === 3 && index > 0 && styles.postMediaCellThreeSmall,
          visible.length === 4 && styles.postMediaCellFour,
        ]}>
          <Image source={{ uri: absoluteUrl(image) }} style={styles.postMediaImage} resizeMode="cover" />
          {index === 3 && images.length > 4 ? <View style={styles.postMediaMore}><Text style={styles.postMediaMoreText}>+{images.length - 4}</Text></View> : null}
        </View>
      ))}
    </View>;
  };

  const renderPost = (post: CommunityPost) => (
    <View key={post.id} style={[styles.postCard, isLight && styles.postCardLight]}>
      <TouchableOpacity activeOpacity={0.92} style={styles.postOpenArea} onPress={() => void openDetail(post)} accessible={false}>
      <View style={styles.postHead}>
        <UserAvatar photoUrl={post.author.photoUrl} style={styles.avatar} imageStyle={styles.avatarImage} fallback={<Text style={styles.avatarInitials}>{initials(post.author.name)}</Text>} />
        <View style={styles.postAuthor}><Text style={[styles.author, styles.postAuthorSoft, isLight && styles.textPrimaryLight]}>{post.author.name}</Text><Text style={[styles.meta, isLight && styles.textSecondaryLight]}>{post.community?.name || [post.area, post.city].filter(Boolean).join(" · ") || "FairFares Community"} · {relativeTime(post.createdAt)}</Text></View>
        <View style={styles.typeBadge}><Text style={[styles.typeBadgeText, styles.postBadgeSoft]}>{post.sourceKind === "HOUSING" ? "🏠 HOUSING" : post.type === "QUESTION" ? "QUESTION" : post.type}</Text></View>
      </View>
      <Text style={[styles.postTitle, styles.postTitleSoft, isLight && styles.textPrimaryLight]}>{post.title}</Text>
      {post.fulfillmentStatus !== "OPEN" ? <View style={styles.resolvedBadge}><Text style={[styles.resolvedText, styles.postBadgeSoft]}>✓ {post.fulfillmentStatus === "ARRANGED" ? "Ride arranged" : post.fulfillmentStatus.charAt(0) + post.fulfillmentStatus.slice(1).toLowerCase()}</Text></View> : null}
      <Text style={[styles.postBody, isLight && styles.textBodyLight]} numberOfLines={4}>{post.body}</Text>
      {Object.keys(post.details || {}).length ? <View style={styles.detailFacts}>{Object.entries(post.details).filter(([, value]) => value).slice(0, 6).map(([key, value]) => <View key={key} style={styles.fact}><Text style={[styles.factLabel, isLight && styles.textSecondaryLight]}>{key.replace(/([A-Z])/g, " $1")}</Text><Text style={[styles.factValue, isLight && styles.textPrimaryLight]}>{value}</Text></View>)}</View> : null}
      {renderPostImages(post.images)}
      {post.linkUrl || firstWebUrl(post.body) ? <SharedLinkCard url={post.linkUrl || firstWebUrl(post.body)} /> : null}
      </TouchableOpacity>
      {post.reactionCount ? <View style={[styles.activitySummary, isLight && styles.activitySummaryLight]}><View style={styles.reactionBreakdown}>{reactionBreakdown(post.reactionCounts, post.reactionCount, post.viewerReaction).map((option) => <Text key={option.value} style={styles.activityText}>{option.count} {option.emoji} {option.label}</Text>)}</View></View> : null}
      <View style={[styles.postActions, isLight && styles.postActionsLight]}>
        {reactionPicker(`post-${post.id}`, post.viewerReaction, post.reactionCount, post.reactionCounts, (reaction) => void reactPost(post, reaction))}
        <TouchableOpacity style={styles.footerCommentAction} onPress={() => void openDetail(post)} accessibilityLabel={`${post.answerCount} comments`}><Text style={[styles.footerIcon, isLight && styles.textBodyLight]}>◯</Text><Text style={[styles.footerActionLabel, isLight && styles.textBodyLight]}>Comment{post.answerCount ? ` ${post.answerCount}` : ""}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.footerIconAction} onPress={(event) => { event.stopPropagation(); const url = `https://www.fairfare.space/community/${post.id}?share=3`; const summary = `${post.title}\n${post.body.slice(0, 180)}`; void Share.share(Platform.OS === "ios" ? { title: post.title, message: summary, url } : { title: post.title, message: `${summary}\n\n${url}` }); }} accessibilityLabel="Share"><Text style={[styles.footerShareIcon, isLight && styles.textBodyLight]}>↗</Text><Text style={[styles.footerActionLabel, isLight && styles.textBodyLight]}>Share</Text></TouchableOpacity>
        {post.sourceKind === "HOUSING" && post.sourceId ? <TouchableOpacity style={styles.viewListingButton} onPress={(event) => { event.stopPropagation(); onOpenHousing(post.sourceId); }} accessibilityRole="button" accessibilityLabel={`View housing details: ${post.title}`}><Text style={styles.viewListingIcon}>⌂</Text><Text style={[styles.viewListingButtonText, isLight && styles.textBodyLight]}>Details</Text><Text style={[styles.viewListingArrow, isLight && styles.textSecondaryLight]}>›</Text></TouchableOpacity> : null}
      </View>
    </View>
  );

  const renderLowestRental = () => lowestRental ? (
    <TouchableOpacity
      key={`rental-${lowestRental.id}`}
      style={styles.rentalFeatureCard}
      activeOpacity={0.9}
      onPress={onOpenRentalCars}
      accessibilityRole="button"
      accessibilityLabel={`Lowest-priced monthly rental car, ${lowestRental.name}, ${monthlyRentalRange(lowestRental.daily_price).dailyLow} to ${monthlyRentalRange(lowestRental.daily_price).dailyHigh} dollars per day after the monthly discount. View rental cars`}
    >
      <Image source={{ uri: absoluteUrl(lowestRental.image_url) }} style={styles.rentalFeatureImage} resizeMode="cover" />
      <View style={styles.rentalFeatureContent}>
        <View style={styles.rentalFeatureTopline}><Text style={styles.rentalFeatureEyebrow}>LOWEST CAR RENTAL</Text><Text style={styles.rentalFeatureBadge}>CAR RENTAL</Text></View>
        <Text style={styles.rentalFeatureTitle} numberOfLines={1}>{lowestRental.name || `${lowestRental.brand} ${lowestRental.model}`}</Text>
        <Text style={styles.rentalFeatureLocation} numberOfLines={1}>{lowestRental.location || "Available in the USA"}</Text>
        <View style={styles.rentalFeatureBottom}>
          <View style={styles.rentalFeaturePricing}><Text style={styles.rentalFeaturePrice}>${monthlyRentalRange(lowestRental.daily_price).dailyLow}–${monthlyRentalRange(lowestRental.daily_price).dailyHigh}<Text style={styles.rentalFeaturePerDay}> / day</Text></Text><Text style={styles.rentalFeatureDiscountedDaily}>30% monthly-rate discount applied</Text></View>
          <View style={styles.rentalFeatureAction}><Text style={styles.rentalFeatureActionText}>View rental</Text><Text style={styles.rentalFeatureArrow}>›</Text></View>
        </View>
      </View>
    </TouchableOpacity>
  ) : null;

  const renderInlineReplyComposer = (parent: CommunityAnswer) => answerReplyTarget?.id === parent.id ? (
    <View style={styles.inlineReplyComposer}>
      <View style={styles.replyingTo}><Text style={styles.replyingToText}>Replying to {answerReplyTarget.name}</Text><TouchableOpacity onPress={() => { setAnswerReplyTarget(null); setAnswer(""); }}><Text style={styles.replyingToClose}>×</Text></TouchableOpacity></View>
      {!user ? <Text style={styles.inlineGuestAllowance}>{guestRemaining} of 6 guest messages left</Text> : null}
      <TextInput autoFocus style={styles.inlineReplyInput} value={answer} onChangeText={setAnswer} multiline placeholder={guestRemaining > 0 || user ? "Write a reply…" : "Write your reply, then sign up to post…"} placeholderTextColor={theme.colors.muted} editable />
      <TouchableOpacity style={[styles.inlineReplySend, !answer.trim() && styles.disabled]} disabled={!answer.trim() || detailBusy} onPress={() => void submitAnswer()}><Text style={styles.sendAnswerText}>{detailBusy ? "…" : "Reply"}</Text></TouchableOpacity>
      {!user && guestRemaining <= 0 ? <TouchableOpacity onPress={() => setGuestBenefitsOpen(true)}><Text style={styles.guestSignupHint}>Sign up for unlimited comments and replies</Text></TouchableOpacity> : null}
    </View>
  ) : null;

  const renderNestedReply = (item: CommunityAnswer, allAnswers: CommunityAnswer[], depth: number): React.ReactNode => {
    const replies = allAnswers.filter((reply) => reply.parentAnswerId === item.id);
    const expanded = expandedReplyThreads.has(item.id);
    const visibleReplies = expanded ? replies : replies.slice(-2);
    const hiddenReplyCount = Math.max(0, replies.length - visibleReplies.length);
    return <View key={item.id} style={[styles.inlineReply, depth > 1 && styles.inlineReplyNested]}>
      <View style={styles.inlineReplyHead}><UserAvatar photoUrl={item.author.photoUrl} style={styles.inlineReplyAvatar} imageStyle={styles.avatarImage} /><View style={styles.postAuthor}><Text style={styles.inlineReplyAuthor}>{item.author.name}</Text><Text style={styles.meta}>{relativeTime(item.createdAt)}</Text></View></View>
      <Text style={styles.inlineReplyBody}>{item.body}</Text>
      {reactionStats(item.reactionCounts, item.reactionCount, item.viewerReaction)}
      <View style={styles.answerActions}>{reactionPicker(`answer-${item.id}`, item.viewerReaction, item.reactionCount, item.reactionCounts, (reaction) => void reactAnswer(item, reaction))}<TouchableOpacity onPress={() => { setAnswerReplyTarget({ id: item.id, name: item.author.name }); setAnswer(""); }}><Text style={styles.replyAction}>Reply</Text></TouchableOpacity></View>
      {visibleReplies.length ? <View style={[styles.inlineReplies, depth < 2 ? styles.inlineRepliesNested : styles.inlineRepliesDeep]}>{visibleReplies.map((reply) => renderNestedReply(reply, allAnswers, depth + 1))}{hiddenReplyCount ? <TouchableOpacity style={styles.moreRepliesButton} onPress={() => setExpandedReplyThreads((current) => new Set([...current, item.id]))}><Text style={styles.moreRepliesText}>View {hiddenReplyCount} more {hiddenReplyCount === 1 ? "reply" : "replies"}</Text></TouchableOpacity> : expanded && replies.length > 2 ? <TouchableOpacity style={styles.moreRepliesButton} onPress={() => setExpandedReplyThreads((current) => { const next = new Set(current); next.delete(item.id); return next; })}><Text style={styles.moreRepliesText}>Show fewer replies</Text></TouchableOpacity> : null}</View> : null}
      {renderInlineReplyComposer(item)}
    </View>;
  };

  const renderAnswer = (item: CommunityAnswer, allAnswers: CommunityAnswer[] = []) => {
    const replies = allAnswers.filter((reply) => reply.parentAnswerId === item.id);
    const expanded = expandedReplyThreads.has(item.id);
    const visibleReplies = expanded ? replies : replies.slice(-2);
    const hiddenReplyCount = Math.max(0, replies.length - visibleReplies.length);
    return (
    <View key={item.id} style={[styles.answerCard, item.accepted && styles.acceptedCard]}>
      <View style={styles.postHead}><UserAvatar photoUrl={item.author.photoUrl} style={styles.answerAvatar} imageStyle={styles.avatarImage} /><View style={styles.postAuthor}><Text style={styles.author}>{item.author.name}</Text><Text style={styles.meta}>{relativeTime(item.createdAt)}</Text></View>{item.accepted ? <Text style={styles.accepted}>✓ Accepted</Text> : null}</View>
      <Text style={styles.answerBody}>{item.body}</Text>
      {reactionStats(item.reactionCounts, item.reactionCount, item.viewerReaction)}
      <View style={styles.answerActions}>{reactionPicker(`answer-${item.id}`, item.viewerReaction, item.reactionCount, item.reactionCounts, (reaction) => void reactAnswer(item, reaction))}<TouchableOpacity onPress={() => { setAnswerReplyTarget({ id: item.id, name: item.author.name }); setAnswer(""); }}><Text style={styles.replyAction}>Reply</Text></TouchableOpacity>{detail?.canEdit && detail.type === "QUESTION" && !item.accepted ? <TouchableOpacity onPress={async () => { await acceptCommunityAnswer(detail.id, item.id); setDetail(await getCommunityPost(detail.id)); }}><Text style={styles.acceptAction}>Accept answer</Text></TouchableOpacity> : null}</View>
      {replies.length ? <View style={styles.inlineReplies}>{visibleReplies.map((reply) => renderNestedReply(reply, allAnswers, 1))}{hiddenReplyCount ? <TouchableOpacity style={styles.moreRepliesButton} onPress={() => setExpandedReplyThreads((current) => new Set([...current, item.id]))}><Text style={styles.moreRepliesText}>View {hiddenReplyCount} more {hiddenReplyCount === 1 ? "reply" : "replies"}</Text></TouchableOpacity> : expanded && replies.length > 2 ? <TouchableOpacity style={styles.moreRepliesButton} onPress={() => setExpandedReplyThreads((current) => { const next = new Set(current); next.delete(item.id); return next; })}><Text style={styles.moreRepliesText}>Show fewer replies</Text></TouchableOpacity> : null}</View> : null}
      {renderInlineReplyComposer(item)}
    </View>
    );
  };

  return <View style={styles.screen}>
    {expandedReactionTarget && !detail ? <Pressable style={styles.reactionDismissLayer} onPress={() => { reactionLongPressTarget.current = ""; setExpandedReactionTarget(""); }} accessibilityLabel="Close reactions" /> : null}
    <Animated.ScrollView
      contentContainerStyle={[styles.content, isLight && styles.contentLight, { maxWidth: layout.contentMaxWidth, paddingBottom: layout.navClearance }]}
      alwaysBounceVertical
      scrollEventThrottle={16}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: pullOffset } } }], { useNativeDriver: true })}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.colors.brand} onRefresh={() => { setRefreshing(true); void load(true); }} />}
    >
      <Animated.View
        style={[styles.heroPosterFrame, {
          opacity: heroEntrance.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0.25, 0.9, 1] }),
          transform: [{
            translateY: pullOffset.interpolate({ inputRange: [-140, 0], outputRange: [54, 0], extrapolate: "clamp" })
          }, {
            translateY: heroEntrance.interpolate({ inputRange: [0, 1], outputRange: [64, 0] })
          }]
        }]}
        accessibilityLabel="Ask Community"
      >
        <Image source={communityHeroPoster} style={styles.heroPoster} resizeMode="contain" />
      </Animated.View>
      <View style={[styles.quickComposer, isLight && styles.quickComposerLight]}>
        <UserAvatar photoUrl={user?.profilePhotoUrl} style={styles.composerAvatar} imageStyle={styles.composerAvatarImage} />
        <TouchableOpacity style={[styles.composerPrompt, isLight && styles.composerPromptLight]} onPress={openComposer} accessibilityRole="button" accessibilityLabel="Write a community post"><Text style={[styles.composerPromptText, isLight && styles.textSecondaryLight]}>Write something…</Text></TouchableOpacity>
        <TouchableOpacity style={styles.composerAsk} onPress={openComposer} accessibilityRole="button" accessibilityLabel="Ask community"><Text style={styles.composerAskText}>＋ Ask</Text></TouchableOpacity>
      </View>
      <TouchableOpacity style={[styles.gasPreviewCard, isLight && styles.gasPreviewCardLight]} onPress={onOpenGas} activeOpacity={0.78} accessibilityRole="button" accessibilityLabel={lowestGasPrice !== null ? `Last found cheapest regular gas was ${lowestGasPrice.toFixed(2)} dollars. Open nearby gas prices to refresh` : "Starting gas price example is 3.54 dollars. Open nearby gas prices to refresh"}>
        <View style={styles.gasPreviewIcon}>
          <Animated.View pointerEvents="none" style={[styles.gasPreviewGlyphLayer, { transform: [{ scale: gasIconScale }, { rotate: gasIconShake.interpolate({ inputRange: [-1, 1], outputRange: ["-9deg", "9deg"] }) }] }]}>
            <Text style={styles.gasPreviewGlyph}>⛽</Text>
          </Animated.View>
        </View>
        <View style={styles.gasPreviewCopy}><Text style={[styles.gasPreviewTitle, isLight && styles.gasPreviewTitleLight]}>Cheap gas near you</Text><Text style={[styles.gasPreviewSubtitle, isLight && styles.textSecondaryLight]}>Tap to compare reported station prices</Text></View>
        <View style={styles.gasPreviewPriceBlock}><Text style={styles.gasPreviewPrice}>${displayedGasPrice.toFixed(2)}</Text><Text style={styles.gasPreviewPriceLabel}>{lowestGasPrice !== null ? "last found" : "starting"}</Text></View>
        <Text style={[styles.gasPreviewChevron, isLight && styles.gasPreviewChevronLight]}>›</Text>
      </TouchableOpacity>
      <View><View style={styles.sectionRow}><Text style={[styles.sectionTitle, isLight && styles.textPrimaryLight]}>Popular topics</Text><TouchableOpacity onPress={() => { setSelectedGroup(""); setCategory("ALL"); }}><Text style={styles.manageLink}>View all  ›</Text></TouchableOpacity></View><View style={styles.topicGrid}>{popularTopics.map((item) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.subtitle}`} key={item.value} style={[styles.topicCard, isLight && styles.topicCardLight, { width: "23.5%", backgroundColor: item.color }, category === item.value && styles.topicSelected]} onPress={() => { if (item.value === "HOUSING") { onOpenHousing(); return; } if (item.value === "RIDES") { onOpenRides(); return; } if (item.value === "RENTALS") { onOpenRentalCars(); return; } setSelectedGroup(""); setCategory(item.value); }}><Image source={item.image} style={styles.topicImage} resizeMode="contain" /><Text style={styles.topicTitle}>{item.title}</Text><Text style={styles.topicSubtitle}>{item.subtitle}</Text></TouchableOpacity>)}</View></View>
      {category === "ALL" ? <View style={styles.quickLinksSection}><Text style={[styles.quickLinksHeading, isLight && styles.textPrimaryLight]}>Quick links</Text><View style={styles.quickLinksRow}>{housingQuickLinks.map((item) => <TouchableOpacity key={item.intent} style={[styles.quickLinkTextButton, { backgroundColor: theme.colors.panel, borderColor: item.accent }, isLight && styles.quickLinkTextButtonLight]} activeOpacity={0.7} onPress={() => onCreateHousingPost(item.intent)} accessibilityRole="button" accessibilityLabel={`Create post: ${item.title}`}><Text style={[styles.quickLinkIcon, { color: item.accent }]}>{item.icon}</Text><Text style={[styles.quickLinkText, { color: item.accent }]}>{item.title}</Text><Text style={[styles.quickLinkChevron, { color: item.accent }]}>›</Text></TouchableOpacity>)}</View></View> : null}
      <View style={[styles.feedControls, isLight && styles.feedControlsLight]}><TouchableOpacity style={styles.feedLocationButton} onPress={() => { setCityDraft(groupSuggestionCity); setCityPickerOpen(true); }} accessibilityRole="button" accessibilityLabel={`Change feed city. Currently ${groupSuggestionCity}`}><View><Text style={[styles.relevanceTitle, isLight && styles.textPrimaryLight]}>Near {groupSuggestionCity.split(",", 1)[0] || "you"} <Text style={styles.cityChevron}>⌄</Text></Text><Text style={[styles.relevanceSubtitle, isLight && styles.textSecondaryLight]}>{category === "ALL" ? "Current-city posts and listings · Tap to change" : categoryLabels[category]}</Text></View></TouchableOpacity><TouchableOpacity style={styles.filterButton} onPress={() => { setQuery(""); setAppliedQuery(""); setSelectedGroup(""); setCategory("ALL"); }} accessibilityRole="button" accessibilityLabel="Reset feed filters"><Text style={[styles.filterIcon, isLight && styles.textBodyLight]}>☷</Text></TouchableOpacity></View>
      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.brand} size="large" /> : <View style={styles.unifiedFeed}>
        {posts.map((post, index) => <React.Fragment key={post.id}>{renderPost(post)}{category === "ALL" && index === communityInsertIndex ? renderCommunitySuggestions() : null}</React.Fragment>)}
        {category === "ALL" && posts.length === 0 ? renderCommunitySuggestions() : null}
        {!posts.length ? <View style={styles.localFeedNote}><Text style={styles.localFeedNoteTitle}>No posts near {groupSuggestionCity.split(",", 1)[0] || "you"} yet</Text><Text style={styles.localFeedNoteBody}>Start a local conversation above, or explore active posts from across the country.</Text></View> : null}
        {!selectedGroup && nationalPosts.length ? <View style={styles.nationalSectionHead}><View><Text style={styles.nationalEyebrow}>DISCOVER MORE</Text><Text style={styles.nationalTitle}>Across the USA</Text><Text style={styles.nationalBody}>Active public posts from FairFares communities nationwide.</Text></View><Text style={styles.nationalIcon}>🇺🇸</Text></View> : null}
        {!selectedGroup ? nationalPosts.map((post, index) => <React.Fragment key={`national-${post.id}`}>{renderPost(post)}{index === 2 ? renderLowestRental() : null}</React.Fragment>) : null}
        {!selectedGroup && nationalPosts.length < 3 ? renderLowestRental() : null}
        {!posts.length && !nationalPosts.length ? <Text style={styles.feedEndNote}>Be the first to ask. Your post will appear here for people near {groupSuggestionCity.split(",", 1)[0] || "your city"}.</Text> : null}
        {hasMore ? <TouchableOpacity style={styles.loadMore} disabled={loadingMore} onPress={() => void loadMore()}><Text style={styles.loadMoreText}>{loadingMore ? "Loading…" : "Load more conversations"}</Text></TouchableOpacity> : null}
      </View>}
    </Animated.ScrollView>

    <Modal visible={cityPickerOpen} transparent animationType="fade" onRequestClose={() => setCityPickerOpen(false)}>
      <View style={styles.cityPickerBackdrop}><View style={styles.cityPickerCard}>
        <View style={styles.cityPickerHeader}><View><Text style={styles.cityPickerTitle}>Choose your feed city</Text><Text style={styles.cityPickerSubtitle}>Local posts appear first. USA posts remain below.</Text></View><TouchableOpacity onPress={() => setCityPickerOpen(false)} accessibilityLabel="Close city picker"><Text style={styles.cityPickerClose}>×</Text></TouchableOpacity></View>
        <TextInput style={styles.cityPickerInput} value={cityDraft} onChangeText={setCityDraft} placeholder="Enter city and state" placeholderTextColor={theme.colors.muted} autoCapitalize="words" returnKeyType="search" onSubmitEditing={() => chooseFeedCity(cityDraft)} />
        {cityOptionsLoading ? <ActivityIndicator color={theme.colors.brand} style={styles.cityPickerLoader} /> : null}
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.cityPickerResults}>{cityOptions.map((option) => <TouchableOpacity key={option} style={styles.cityPickerOption} onPress={() => chooseFeedCity(option)}><Text style={styles.cityPickerOptionText}>{option}</Text><Text style={styles.cityPickerOptionArrow}>›</Text></TouchableOpacity>)}</ScrollView>
        {cityDraft.trim().length >= 2 ? <TouchableOpacity style={styles.cityPickerUseTyped} onPress={() => chooseFeedCity(cityDraft)}><Text style={styles.cityPickerUseTypedText}>Use “{cityDraft.trim()}”</Text></TouchableOpacity> : null}
        <TouchableOpacity style={styles.currentLocationButton} accessibilityRole="button" accessibilityLabel="Use my current location" onPress={() => { manualFeedCity.current = false; setCityPickerOpen(false); void AsyncStorage.removeItem(feedCityStorageKey); setLocationRefreshKey((value) => value + 1); }}><Text style={styles.currentLocationText}>⌖ Use my current location</Text></TouchableOpacity>
      </View></View>
    </Modal>

    <Modal visible={composerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setComposerOpen(false)}>
      <View style={styles.modal}><View style={[styles.modalHead, { marginTop: modalHeaderTopInset }]}><TouchableOpacity onPress={() => { setComposerOpen(false); setEditingPostId(""); }} accessibilityRole="button" accessibilityLabel="Cancel community post"><Text style={styles.cancel}>Cancel</Text></TouchableOpacity><Text style={styles.modalTitle}>{editingPostId ? "Edit post" : "Create post"}</Text><TouchableOpacity disabled={publishing} onPress={() => void publish()} accessibilityRole="button" accessibilityLabel={editingPostId ? "Save community post" : "Publish community post"} accessibilityState={{ disabled: publishing }}><Text style={[styles.publish, publishing && styles.disabled]}>{publishing ? "Saving…" : editingPostId ? "Save" : "Post"}</Text></TouchableOpacity></View><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.formLabel}>What are you sharing?</Text><View style={styles.optionGrid}>{types.map((item) => <TouchableOpacity key={item.value} style={[styles.option, form.type === item.value && styles.optionActive]} onPress={() => setForm((current) => ({ ...current, type: item.value }))} accessibilityRole="button" accessibilityState={{ selected: form.type === item.value }}><Text style={[styles.optionText, form.type === item.value && styles.optionTextActive]}>{item.label}</Text></TouchableOpacity>)}</View>
        <Text style={styles.formLabel}>What do you need?</Text><View style={styles.needGrid}>{categories.slice(1).map((item) => <TouchableOpacity key={item} style={[styles.needOption, form.category === item && styles.optionActive]} onPress={() => setForm((current) => ({ ...current, category: item as CommunityPost["category"] }))} accessibilityRole="button" accessibilityState={{ selected: form.category === item }}><Text style={styles.needIcon}>{categoryIcons[item]}</Text><Text style={[styles.needText, form.category === item && styles.optionTextActive]}>{categoryLabels[item]}</Text></TouchableOpacity>)}</View>
        {(form.category === "NEED_ROOMMATE" || form.category === "NEED_PLACE") ? <><Text style={styles.formLabel}>Housing details</Text><TextInput style={styles.input} value={form.details.budget} onChangeText={(value) => setDetailField("budget", value)} placeholder="Monthly budget, for example $900" placeholderTextColor={theme.colors.muted} /><TextInput style={styles.input} value={form.details.moveInDate} onChangeText={(value) => setDetailField("moveInDate", value)} placeholder="Move-in date" placeholderTextColor={theme.colors.muted} /><TextInput style={styles.input} value={form.details.preference} onChangeText={(value) => setDetailField("preference", value)} placeholder="Roommate or home preferences" placeholderTextColor={theme.colors.muted} /></> : null}
        {form.category === "HAVE_PLACE" ? <><Text style={styles.formLabel}>Place details</Text><TextInput style={styles.input} value={form.details.rent} onChangeText={(value) => setDetailField("rent", value)} placeholder="Monthly rent" placeholderTextColor={theme.colors.muted} /><TextInput style={styles.input} value={form.details.availableDate} onChangeText={(value) => setDetailField("availableDate", value)} placeholder="Available date" placeholderTextColor={theme.colors.muted} /><TextInput style={styles.input} value={form.details.roomType} onChangeText={(value) => setDetailField("roomType", value)} placeholder="Private room, shared room, entire place…" placeholderTextColor={theme.colors.muted} /></> : null}
        {form.category === "CARPOOL_RIDE" ? <><Text style={styles.formLabel}>Ride details</Text><TextInput style={styles.input} value={form.details.origin} onChangeText={(value) => setDetailField("origin", value)} placeholder="Leaving from" placeholderTextColor={theme.colors.muted} /><TextInput style={styles.input} value={form.details.destination} onChangeText={(value) => setDetailField("destination", value)} placeholder="Going to" placeholderTextColor={theme.colors.muted} /><View style={styles.inlineFields}><TextInput style={[styles.input, styles.inlineInput]} value={form.details.travelDate} onChangeText={(value) => setDetailField("travelDate", value)} placeholder="Date" placeholderTextColor={theme.colors.muted} /><TextInput style={[styles.input, styles.inlineInput]} value={form.details.travelTime} onChangeText={(value) => setDetailField("travelTime", value)} placeholder="Time" placeholderTextColor={theme.colors.muted} /><TextInput style={[styles.input, { width: 78 }]} value={form.details.seats} onChangeText={(value) => setDetailField("seats", value.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" placeholder="Seats" placeholderTextColor={theme.colors.muted} /></View></> : null}
        <TextInput style={styles.titleInput} value={form.title} onChangeText={(title) => setForm((current) => ({ ...current, title }))} maxLength={140} placeholder="Write a clear title" placeholderTextColor={theme.colors.muted} />
        <TextInput style={styles.bodyInput} value={form.body} onChangeText={(body) => setForm((current) => ({ ...current, body }))} multiline maxLength={3000} textAlignVertical="top" placeholder="Add details that will help people give a useful answer…" placeholderTextColor={theme.colors.muted} />
        <View style={styles.counter}><Text style={styles.counterText}>{form.body.length}/3000</Text></View>
        <View style={[styles.attachmentPanel, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
          <View><Text style={styles.attachmentTitle}>Add to your post</Text><Text style={styles.attachmentHint}>Share a helpful link or up to 4 photos</Text></View>
          <TextInput style={styles.input} value={form.linkUrl} onChangeText={(linkUrl) => setForm((current) => ({ ...current, linkUrl }))} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="🔗 Paste a website link (optional)" placeholderTextColor={theme.colors.muted} />
          {form.images.length ? <ScrollView horizontal contentContainerStyle={styles.imageRow}>{form.images.map((image, index) => <TouchableOpacity key={index} onPress={() => setForm((current) => ({ ...current, images: current.images.filter((_, target) => target !== index) }))}><Image source={{ uri: image }} style={styles.previewImage} /><View style={styles.removeImage}><Text style={styles.removeImageText}>×</Text></View></TouchableOpacity>)}</ScrollView> : null}
          <TouchableOpacity style={styles.addPhoto} onPress={async () => { try { const images = await pickCompressedImages(4 - form.images.length); setForm((current) => ({ ...current, images: [...current.images, ...images].slice(0, 4) })); } catch (error) { Alert.alert("Photos not added", message(error)); } }} accessibilityRole="button" accessibilityLabel="Add up to four photos"><Text style={styles.addPhotoIcon}>▣</Text><View style={styles.addPhotoCopy}><Text style={styles.addPhotoTitle}>Add photos</Text><Text style={styles.addPhotoBody}>{form.images.length ? `${form.images.length} of 4 selected · Tap a photo to remove it` : "Choose up to 4 clear, relevant images"}</Text></View><Text style={styles.addPhotoChevron}>›</Text></TouchableOpacity>
        </View>
        <TextInput style={styles.input} value={form.area} onChangeText={(area) => setForm((current) => ({ ...current, area }))} placeholder={`Location or area · ${city}`} placeholderTextColor={theme.colors.muted} />
        {groupOptions.length ? <><Text style={styles.formLabel}>Audience</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}><TouchableOpacity style={[styles.chip, !form.communityId && styles.chipActive]} onPress={() => setForm((current) => ({ ...current, communityId: "" }))}><Text style={[styles.chipText, !form.communityId && styles.chipTextActive]}>Everyone</Text></TouchableOpacity>{groupOptions.map((group) => <TouchableOpacity key={group.id} style={[styles.chip, form.communityId === group.id && styles.chipActive]} onPress={() => setForm((current) => ({ ...current, communityId: group.id }))}><Text style={[styles.chipText, form.communityId === group.id && styles.chipTextActive]}>{group.name}</Text></TouchableOpacity>)}</ScrollView></> : null}
        <Text style={[styles.safety, { backgroundColor: theme.colors.panel2 }]}>Keep personal phone numbers, exact home addresses, and sensitive documents out of public posts.</Text>
      </ScrollView></View>
    </Modal>

    <Modal visible={Boolean(detail)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetail(null)} onDismiss={finishGuestAuth}>
      <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === "ios" ? "padding" : "height"}>{expandedReactionTarget ? <Pressable style={styles.reactionDismissLayer} onPress={() => { reactionLongPressTarget.current = ""; setExpandedReactionTarget(""); }} accessibilityLabel="Close reactions" /> : null}<View style={[styles.modalHead, { marginTop: modalHeaderTopInset }]}><TouchableOpacity onPress={() => setDetail(null)}><Text style={[styles.cancel, isLight && styles.textBodyLight]}>Close</Text></TouchableOpacity><Text style={[styles.modalTitle, isLight && styles.textPrimaryLight]}>Community post</Text><TouchableOpacity onPress={() => detail && (detail.canEdit ? managePost(detail) : report(detail))}><Text style={detail?.canEdit ? styles.publish : styles.danger}>{detail?.canEdit ? "Manage" : "Report"}</Text></TouchableOpacity></View>
      <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>{detail ? <>
        {renderPost(detail)}
        <Text style={[styles.answersTitle, isLight && styles.textPrimaryLight]}>{detail.answerCount} {detail.answerCount === 1 ? "comment" : "comments"}</Text>
        {detail.answers?.filter((item) => !item.parentAnswerId).map((item) => renderAnswer(item, detail.answers || []))}
        {detail.canAnswer && !answerReplyTarget ? <View style={styles.answerComposer}>{!user ? <View style={styles.guestAllowance}><Text style={styles.guestAllowanceName}>{guestIdentity || "Guest"}</Text><Text style={styles.guestAllowanceCount}>{guestRemaining} of 6 guest messages left</Text></View> : null}<TextInput style={styles.answerInput} value={answer} onChangeText={setAnswer} multiline placeholder={guestRemaining > 0 || user ? "Write a comment…" : "Write your comment, then sign up to post…"} placeholderTextColor={theme.colors.muted} editable /><TouchableOpacity style={[styles.sendAnswer, !answer.trim() && styles.disabled]} disabled={!answer.trim() || detailBusy} onPress={() => void submitAnswer()}><Text style={styles.sendAnswerText}>{detailBusy ? "…" : "Post comment"}</Text></TouchableOpacity>{!user ? <TouchableOpacity onPress={() => setGuestBenefitsOpen(true)}><Text style={styles.guestSignupHint}>Sign up for unlimited comments and replies</Text></TouchableOpacity> : null}</View> : !detail.canAnswer ? <Text style={styles.locked}>This discussion is closed to new comments.</Text> : null}
      </> : null}{detailBusy && !detail?.answers ? <ActivityIndicator color={theme.colors.brand} /> : null}</ScrollView>
      {guestBenefitsOpen ? <View style={styles.guestBenefitsBackdrop}>
        <View style={styles.guestBenefitsCard}>
          <TouchableOpacity style={styles.guestBenefitsClose} onPress={() => setGuestBenefitsOpen(false)} accessibilityLabel="Close"><Text style={styles.guestBenefitsCloseText}>×</Text></TouchableOpacity>
          <Text style={styles.guestBenefitsEyebrow}>KEEP THE CONVERSATION GOING</Text>
          <Text style={styles.guestBenefitsTitle}>Create your free FairFares account</Text>
          <Text style={styles.guestBenefitsIntro}>Register once to unlock the full community.</Text>
          <View style={styles.guestBenefit}><Text style={styles.guestBenefitIcon}>💬</Text><View><Text style={styles.guestBenefitTitle}>Unlimited community comments and replies</Text><Text style={styles.guestBenefitBody}>Keep talking with posters and local members.</Text></View></View>
          <View style={styles.guestBenefit}><Text style={styles.guestBenefitIcon}>🏠</Text><View><Text style={styles.guestBenefitTitle}>List your property or find a home</Text><Text style={styles.guestBenefitBody}>Post a place, request housing, or find roommates.</Text></View></View>
          <View style={styles.guestBenefit}><Text style={styles.guestBenefitIcon}>🚗</Text><View><Text style={styles.guestBenefitTitle}>Cheap car rentals and shared rides</Text><Text style={styles.guestBenefitBody}>Find affordable cars and carpools near you.</Text></View></View>
          <TouchableOpacity style={styles.guestBenefitsPrimary} onPress={() => beginGuestAuth("signup")}><Text style={styles.guestBenefitsPrimaryText}>Create free account</Text></TouchableOpacity>
          <TouchableOpacity style={styles.guestBenefitsSecondary} onPress={() => beginGuestAuth("login")}><Text style={styles.guestBenefitsSecondaryText}>Already registered? Log in</Text></TouchableOpacity>
        </View>
      </View> : null}
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  unifiedFeed: { gap: 3 }, housingSection: { gap: 3 }, housingPostCard: { backgroundColor: theme.colors.panel, borderTopColor: theme.colors.line, borderBottomColor: theme.colors.line, borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: 13, paddingVertical: 16, gap: 12 }, housingPostBadge: { maxWidth: 128, backgroundColor: "#173a2d", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 }, housingPostBadgeText: { color: "#8ee4bf", fontWeight: "900", fontSize: 9, textTransform: "uppercase" }, housingPostImage: { width: 280, height: 190, borderRadius: 5, backgroundColor: theme.colors.panel2 }, housingPostPhotoFallback: { height: 126, borderRadius: 5, alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#122d24", borderWidth: 1, borderColor: "#244c3d" }, housingPostPhotoIcon: { fontSize: 35 }, housingPostPhotoCopy: { color: "#9dd9c2", fontWeight: "800", fontSize: 12 }, housingFacts: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, housingFact: { maxWidth: "48%", minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, backgroundColor: theme.colors.panel2, paddingHorizontal: 10 }, housingFactIcon: { fontSize: 12 }, housingFactText: { flexShrink: 1, color: theme.colors.soft, fontWeight: "700", fontSize: 11 }, housingPostActions: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 11 }, housingDetailsButton: { minHeight: 37, justifyContent: "center", borderRadius: 8, backgroundColor: theme.colors.brand, paddingHorizontal: 15 }, housingDetailsButtonText: { color: "#06291e", fontWeight: "900", fontSize: 12 }, housingShareButton: { minHeight: 37, justifyContent: "center", borderRadius: 8, backgroundColor: theme.colors.panel2, paddingHorizontal: 13 }, housingShareButtonText: { color: theme.colors.soft, fontWeight: "800", fontSize: 12 }, housingExpiry: { marginLeft: "auto", color: theme.colors.muted, fontSize: 10, fontWeight: "700" }, housingCopy: { flex: 1 }, housingArrow: { color: theme.colors.muted, fontSize: 28, fontWeight: "300" }, addHousingCard: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11, padding: 11, marginTop: 8, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.brand, backgroundColor: "rgba(24,168,120,.08)" }, addHousingIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.brand }, addHousingPlus: { color: "#06291e", fontSize: 25, fontWeight: "700" }, addHousingTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "900" }, addHousingBody: { color: theme.colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  heroGlow: { position: "absolute", right: -40, bottom: -70, width: 260, height: 150, borderRadius: 130, backgroundColor: "rgba(16,108,87,.18)" }, accentLeft: { position: "absolute", left: 25, top: 19, color: "#ffad24", fontSize: 25, fontWeight: "900", transform: [{ rotate: "-25deg" }] }, accentRight: { position: "absolute", right: 87, top: 17, color: "#18a681", fontSize: 21, fontWeight: "900", transform: [{ rotate: "20deg" }] }, askBadgeTail: { position: "absolute", left: 9, bottom: -7, width: 18, height: 18, backgroundColor: "#ef3e42", transform: [{ rotate: "25deg" }] }, communityTagStitch: { position: "absolute", top: 4, bottom: 4, left: 5, right: 5, borderWidth: 1, borderStyle: "dashed", borderColor: "#ed9d38", borderRadius: 7 }, subtitleAccent: { color: theme.colors.brand, fontWeight: "900" },
  resolvedBadge: { alignSelf: "flex-start", borderRadius: 999, backgroundColor: "#173b2d", paddingHorizontal: 11, paddingVertical: 6 }, resolvedText: { color: "#8ce6bf", fontWeight: "800", fontSize: 12 }, detailFacts: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, fact: { minWidth: "30%", flexGrow: 1, borderRadius: 12, backgroundColor: theme.colors.panel2, padding: 10 }, factLabel: { color: theme.colors.muted, fontSize: 9, textTransform: "uppercase" }, factValue: { color: theme.colors.text, fontWeight: "800", fontSize: 12, marginTop: 3 }, inlineFields: { flexDirection: "row", gap: 8 }, inlineInput: { flex: 1 },
  postAuthorSoft: { fontWeight: "700" }, postTitleSoft: { fontWeight: "700" }, postBadgeSoft: { fontWeight: "600" },
  screen: { flex: 1, backgroundColor: theme.colors.bg }, content: { width: "100%", alignSelf: "center", padding: 12, gap: 12 },
  quickComposer: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 6, padding: 8, backgroundColor: theme.colors.panel, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.line }, composerAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.panel2 }, composerAvatarImage: { borderRadius: 21 }, composerPrompt: { flex: 1, minWidth: 84, minHeight: 42, justifyContent: "center", paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel2 }, composerPromptText: { color: theme.colors.muted, fontSize: 13 }, composerAsk: { minHeight: 42, justifyContent: "center", borderRadius: 10, backgroundColor: theme.colors.brand, paddingHorizontal: 13 }, composerAskText: { color: "#06291e", fontSize: 12, fontWeight: "900" }, feedControls: { minHeight: 66, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.line }, feedLocationButton: { flex: 1, minHeight: 58, justifyContent: "center" }, relevanceTitle: { color: theme.colors.text, fontSize: 21, fontWeight: "800" }, cityChevron: { color: theme.colors.brand, fontSize: 17, fontWeight: "700" }, relevanceSubtitle: { color: theme.colors.muted, fontSize: 11, marginTop: 3 }, filterButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: theme.colors.panel }, filterIcon: { color: theme.colors.soft, fontSize: 23, transform: [{ rotate: "90deg" }] }, localFeedNote: { paddingHorizontal: 4, paddingVertical: 6 }, localFeedNoteTitle: { color: theme.colors.soft, fontSize: 13, fontWeight: "800" }, localFeedNoteBody: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 }, nationalSectionHead: { marginTop: 12, paddingHorizontal: 4, paddingVertical: 11, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.line, backgroundColor: "transparent" }, nationalEyebrow: { color: theme.colors.brand, fontSize: 8, fontWeight: "800", letterSpacing: .8 }, nationalTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800", marginTop: 2 }, nationalBody: { color: theme.colors.muted, fontSize: 10, marginTop: 3 }, nationalIcon: { fontSize: 22 }, feedEndNote: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", paddingHorizontal: 20, paddingVertical: 12 },
  gasPreviewCard: { minHeight: 66, marginTop: 10, marginHorizontal: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", borderRadius: 17, borderWidth: 1, borderColor: "rgba(30,202,147,0.28)", backgroundColor: "rgba(12,47,37,0.74)" },
  gasPreviewCardLight: { backgroundColor: "#ffffff", borderColor: "rgba(15,23,42,0.06)", shadowColor: "#14251f", shadowOpacity: 0.10, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  gasPreviewIcon: { width: 42, height: 42, position: "relative", alignItems: "center", justifyContent: "center", overflow: "visible" }, gasPreviewGlyphLayer: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" }, gasPreviewGlyph: { fontSize: 26 }, gasPreviewCopy: { flex: 1, minWidth: 0, paddingHorizontal: 11 }, gasPreviewTitle: { color: "#f5f7f6", fontSize: 14, fontWeight: "800" }, gasPreviewTitleLight: { color: "#151719" }, gasPreviewSubtitle: { color: theme.colors.muted, fontSize: 10, marginTop: 3 }, gasPreviewPriceBlock: { alignItems: "flex-end", marginLeft: 6 }, gasPreviewPrice: { color: "#16b981", fontSize: 17, fontWeight: "900", letterSpacing: -0.3 }, gasPreviewPriceLabel: { color: theme.colors.muted, fontSize: 8, fontWeight: "600", marginTop: 1 }, gasPreviewChevron: { color: "#f5f7f6", fontSize: 27, marginLeft: 8 }, gasPreviewChevronLight: { color: "#151719" },
  rentalFeatureCard: { minHeight: 220, borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "#796029", backgroundColor: theme.colors.panel, shadowColor: "#000", shadowOpacity: .18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  rentalFeatureImage: { width: "100%", height: 142, backgroundColor: theme.colors.panel2 },
  rentalFeatureContent: { paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  rentalFeatureTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rentalFeatureEyebrow: { color: "#e8b743", fontSize: 9, fontWeight: "900", letterSpacing: .8 },
  rentalFeatureBadge: { color: "#f1c75c", backgroundColor: "#302711", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 8, fontWeight: "900" },
  rentalFeatureTitle: { color: theme.colors.text, fontSize: 19, lineHeight: 24, fontWeight: "800" },
  rentalFeatureLocation: { color: theme.colors.muted, fontSize: 11 },
  rentalFeatureBottom: { marginTop: 3, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rentalFeaturePricing: { flex: 1, minWidth: 0, gap: 2 },
  rentalFeaturePrice: { color: "#68d78f", fontSize: 20, fontWeight: "900" },
  rentalFeaturePerDay: { color: theme.colors.muted, fontSize: 11, fontWeight: "700" },
  rentalFeatureDiscountedDaily: { color: "#b6c4be", fontSize: 9, lineHeight: 12, fontWeight: "700" },
  rentalFeatureAction: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: "#796029" },
  rentalFeatureActionText: { color: "#f1d27f", fontSize: 11, fontWeight: "800" },
  rentalFeatureArrow: { color: "#f1d27f", fontSize: 20, lineHeight: 21 },
  cityPickerBackdrop: { flex: 1, justifyContent: "center", padding: 18, backgroundColor: "rgba(0,0,0,.72)" }, cityPickerCard: { maxHeight: "78%", gap: 12, padding: 18, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel }, cityPickerHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, cityPickerTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "800" }, cityPickerSubtitle: { color: theme.colors.muted, fontSize: 11, marginTop: 4 }, cityPickerClose: { color: theme.colors.soft, fontSize: 28, lineHeight: 28 }, cityPickerInput: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: "#386753", backgroundColor: theme.colors.panel2, color: theme.colors.text, paddingHorizontal: 14, fontSize: 15 }, cityPickerLoader: { marginVertical: 4 }, cityPickerResults: { maxHeight: 250 }, cityPickerOption: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: theme.colors.line, paddingHorizontal: 4 }, cityPickerOptionText: { color: theme.colors.text, fontSize: 14, fontWeight: "700" }, cityPickerOptionArrow: { color: theme.colors.brand, fontSize: 23 }, cityPickerUseTyped: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#173b2d" }, cityPickerUseTypedText: { color: "#a9f2d2", fontWeight: "800" }, currentLocationButton: { minHeight: 44, alignItems: "center", justifyContent: "center" }, currentLocationText: { color: theme.colors.brand, fontWeight: "800" },
  housingSearchAction: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel }, housingSearchIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.brand }, housingSearchIconText: { color: "#06291e", fontSize: 28, lineHeight: 31, fontWeight: "800" }, housingSearchCopy: { flex: 1 }, housingSearchTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "900" }, housingSearchBody: { color: theme.colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 }, housingSearchArrow: { color: theme.colors.brand, fontSize: 30, fontWeight: "300" },
  currentLocationCard: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel }, currentLocationPin: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.panel2 }, currentLocationPinText: { color: theme.colors.brand, fontSize: 25, lineHeight: 28, fontWeight: "800" }, currentLocationCopy: { flex: 1 }, currentLocationEyebrow: { color: theme.colors.brand, fontSize: 8, fontWeight: "900", letterSpacing: .8 }, currentLocationCity: { color: theme.colors.text, fontSize: 15, fontWeight: "900", marginTop: 2 }, currentLocationArea: { color: theme.colors.muted, fontSize: 10, lineHeight: 14, marginTop: 2 }, currentLocationArrow: { color: theme.colors.brand, fontSize: 28, lineHeight: 30, fontWeight: "300" },
  inlineCommunities: { marginVertical: 10, paddingVertical: 16, gap: 9, borderRadius: 19, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel, overflow: "hidden" }, inlineCommunityHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 }, inlineCommunityEyebrow: { color: theme.colors.brand, fontSize: 9, fontWeight: "900", letterSpacing: .8 }, inlineCommunityTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900", marginTop: 2 }, inlineCommunitySwipe: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, minHeight: 31, borderRadius: 999, backgroundColor: theme.colors.panel2 }, inlineCommunitySwipeText: { color: theme.colors.muted, fontSize: 10, fontWeight: "800" }, inlineCommunitySwipeArrow: { color: theme.colors.brand, fontSize: 20, fontWeight: "900", marginTop: -1 }, inlineCommunityBody: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 16 }, inlineCommunityRail: { paddingHorizontal: 16, gap: 10 }, inlineCommunityCard: { width: 140, minHeight: 170, padding: 11, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel2, alignItems: "center" }, inlineCommunityPhoto: { width: 54, height: 54, borderRadius: 27, marginBottom: 7, backgroundColor: theme.colors.panel }, inlineCommunityPhotoImage: { borderRadius: 27 }, inlineCommunityPhotoGlyph: { fontSize: 25 }, inlineCommunityName: { color: theme.colors.text, fontSize: 12, lineHeight: 14, fontWeight: "900", minHeight: 28, textAlign: "center" }, inlineCommunityMeta: { color: theme.colors.muted, fontSize: 9, marginTop: 2, maxWidth: "100%" }, inlineCommunityMembers: { color: theme.colors.muted, fontSize: 9, fontWeight: "700", marginTop: 2, marginBottom: 7 }, inlineJoinButton: { width: "100%", minHeight: 31, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: theme.colors.brand, paddingHorizontal: 11 }, inlineJoinedButton: { borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel }, inlineJoinText: { color: "#06291e", fontSize: 11, fontWeight: "900" }, inlineJoinedText: { color: theme.colors.text },
  hero: { minHeight: 136, gap: 11, padding: 16, paddingTop: 23, backgroundColor: "#071e1b", borderWidth: 1, borderColor: "#17604e", borderRadius: 28, overflow: "hidden" }, heroTop: { width: "100%", flexDirection: "row", alignItems: "center", gap: 12 }, heroMark: { width: 92, height: 70, justifyContent: "center" }, askBadge: { width: 82, height: 55, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: "#ef3e42", transform: [{ rotate: "-5deg" }], shadowColor: "#000", shadowOpacity: .25, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } }, askBadgeText: { color: "#fff", fontSize: 29, fontStyle: "italic", fontWeight: "900" }, chatBubbles: { position: "absolute", right: 0, top: -5 }, chatBubbleBlue: { color: "#e8fff7", backgroundColor: "#16a878", borderRadius: 14, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3, fontSize: 9 }, chatBubbleGold: { alignSelf: "flex-end", marginTop: -1, color: "#fff7d1", backgroundColor: "#f0a800", borderRadius: 9, overflow: "hidden", paddingHorizontal: 5, fontSize: 7 }, heroCopy: { flex: 1 }, communityTag: { alignSelf: "flex-start", minWidth: 150, height: 43, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 13, backgroundColor: "#fff5cf", borderWidth: 2, borderColor: "#e9aa20", borderRadius: 10, transform: [{ rotate: "-2deg" }], shadowColor: "#000", shadowOpacity: .22, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }, communityTagTail: { position: "absolute", left: -5, bottom: -4, width: 12, height: 12, backgroundColor: "#fff5cf", borderLeftWidth: 2, borderBottomWidth: 2, borderColor: "#e9aa20", transform: [{ rotate: "-20deg" }] }, communityTagDot: { position: "absolute", right: 6, color: "#e9aa20", fontSize: 7 }, heroCommunity: { color: "#082b62", fontSize: 24, lineHeight: 30, fontFamily: Platform.select({ ios: "Bradley Hand", android: "cursive", default: "serif" }), fontWeight: "700", letterSpacing: -0.4 }, eyebrow: { ...theme.typography.eyebrow, color: "#72d9ae" }, title: { color: "#fff", fontSize: 31, lineHeight: 36, fontWeight: "800" }, subtitle: { width: "100%", color: "#f2faf7", fontSize: 14, lineHeight: 20, marginTop: 2, paddingHorizontal: 4 }, askButton: { backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 14, minHeight: 38, justifyContent: "center" }, askButtonText: { color: "#06291e", fontWeight: "800", fontSize: 14 },
  heroPosterFrame: { width: "100%", height: 78, alignItems: "center", justifyContent: "center" }, heroPoster: { width: "58%", height: 68 },
  topicGrid: { flexDirection: "row", justifyContent: "space-between", gap: 6, paddingTop: 8 }, topicCard: { minHeight: 88, borderRadius: 16, padding: 7, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,.45)" }, topicSelected: { borderColor: theme.colors.brand, transform: [{ scale: 0.98 }] }, topicImage: { width: 38, height: 38, marginBottom: 2 }, topicTitle: { color: "#11181b", fontWeight: "900", fontSize: 12 }, topicSubtitle: { color: "#627078", fontSize: 9, marginTop: 2, textAlign: "center" }, tipCard: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 13, borderRadius: 22, paddingHorizontal: 17, backgroundColor: "#0d4038", borderWidth: 1, borderColor: "#25685b" }, tipIcon: { fontSize: 25 }, tipTitle: { color: "#fff", fontWeight: "900", fontSize: 16 }, tipBody: { color: "#a9cfc5", fontSize: 12, lineHeight: 18, marginTop: 3 }, tipArrow: { color: "#fff", fontSize: 38, fontWeight: "300" },
  quickLinksSection: { gap: 7 }, quickLinksHeading: { color: theme.colors.text, fontSize: 13, fontWeight: "900" }, quickLinksRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 7 }, quickLinkTextButton: { flex: 1, minWidth: 0, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 6, borderRadius: 14, borderWidth: 1 }, quickLinkIcon: { fontSize: 15, lineHeight: 18, fontWeight: "900" }, quickLinkText: { flexShrink: 1, fontSize: 10, lineHeight: 14, fontWeight: "800", textAlign: "center" }, quickLinkChevron: { fontSize: 20, lineHeight: 21, fontWeight: "600", marginTop: -1 }, quickLinkDivider: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: theme.colors.line },
  needGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 }, needOption: { width: "48%", minHeight: 76, flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel }, needIcon: { fontSize: 22 }, needText: { flex: 1, color: theme.colors.soft, fontWeight: "800", fontSize: 13 },
  searchRow: { flexDirection: "row", gap: 8 }, searchInput: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 15, backgroundColor: theme.colors.panel, color: theme.colors.text, paddingHorizontal: 14 }, searchButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 16, borderRadius: 15, backgroundColor: theme.colors.brand }, searchButtonText: { color: "#06291e", fontWeight: "800" },
  chips: { gap: 8, paddingRight: 12 }, chip: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 999, paddingHorizontal: 14, minHeight: 38, justifyContent: "center", marginRight: 8, backgroundColor: theme.colors.panel }, chipActive: { backgroundColor: "#d8fff0", borderColor: "#d8fff0" }, chipText: { color: theme.colors.soft, fontWeight: "700", fontSize: 13 }, chipTextActive: { color: "#093525" }, sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, sectionTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800" }, manageLink: { color: theme.colors.brand, fontWeight: "800", fontSize: 13 }, groups: { gap: 7, paddingTop: 7, paddingRight: 8 }, groupCard: { width: 96, minHeight: 78, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 14, padding: 9, gap: 3 }, groupActive: { borderColor: theme.colors.brand, backgroundColor: "#14271f" }, groupEmoji: { fontSize: 20 }, groupPhoto: { width: 24, height: 24, borderRadius: 8 }, groupName: { color: theme.colors.text, fontWeight: "800", fontSize: 11 }, groupCount: { color: theme.colors.muted, fontSize: 9 }, feedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }, feedHint: { color: theme.colors.muted, fontSize: 11 }, loader: { marginVertical: 50 },
  postCard: { backgroundColor: theme.colors.panel, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 15, gap: 12, shadowColor: "#000", shadowOpacity: .14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 }, postHead: { flexDirection: "row", alignItems: "center", gap: 10 }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#204538" }, avatarImage: { borderRadius: 22 }, avatarInitials: { color: "#a8ecd1", fontSize: 14, fontWeight: "900" }, postAuthor: { flex: 1, minWidth: 0 }, author: { color: theme.colors.text, fontWeight: "900", fontSize: 15 }, meta: { color: theme.colors.muted, fontSize: 11, marginTop: 2 }, typeBadge: { backgroundColor: "#153a2c", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 }, typeBadgeText: { color: "#78dcb4", fontWeight: "800", fontSize: 9, letterSpacing: .4 }, postTitle: { color: theme.colors.text, fontSize: 19, lineHeight: 25, fontWeight: "800" }, postBody: { color: theme.colors.soft, fontSize: 14, lineHeight: 21 }, imageRow: { gap: 5 }, postImage: { width: 255, height: 175, borderRadius: 12, backgroundColor: theme.colors.panel2 }, linkCard: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: "#315945", backgroundColor: "#10291f", borderRadius: 14, padding: 9, overflow: "hidden" }, linkPreviewImage: { width: 74, height: 74, borderRadius: 10, backgroundColor: theme.colors.panel2 }, linkPreviewPlaceholder: { width: 74, height: 74, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#173b2d" }, linkPreviewPlaceholderText: { color: theme.colors.brand, fontSize: 28 }, linkContent: { flex: 1, minWidth: 0, gap: 4 }, linkLabel: { color: theme.colors.text, fontWeight: "800", fontSize: 13, lineHeight: 17 }, linkDescription: { color: theme.colors.muted, fontSize: 10, lineHeight: 14 }, linkSource: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }, linkFavicon: { width: 15, height: 15, borderRadius: 3 }, linkFaviconFallback: { width: 15, height: 15, borderRadius: 3, alignItems: "center", justifyContent: "center", backgroundColor: "#1c4938" }, linkFaviconFallbackText: { color: theme.colors.brand, fontSize: 9 }, linkUrl: { flex: 1, color: "#85caae", fontSize: 10 }, linkChevron: { color: theme.colors.brand, fontSize: 26, marginRight: 2 }, latestComment: { flexDirection: "row", alignItems: "flex-start", gap: 9 }, latestCommentAvatar: { width: 31, height: 31, borderRadius: 16, backgroundColor: "#204538" }, latestCommentInitials: { color: "#a8ecd1", fontSize: 9, fontWeight: "900" }, latestCommentBubble: { flex: 1, minHeight: 46, borderRadius: 13, backgroundColor: theme.colors.panel2, paddingHorizontal: 11, paddingVertical: 8 }, latestCommentAuthor: { color: theme.colors.text, fontSize: 11, fontWeight: "900" }, latestCommentBody: { color: theme.colors.soft, fontSize: 12, lineHeight: 17, marginTop: 2 }, addCommentPrompt: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.line }, addCommentIcon: { color: theme.colors.brand, fontSize: 15 }, addCommentText: { color: theme.colors.muted, fontSize: 12, fontWeight: "700" }, postActions: { position: "relative", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 10, overflow: "visible" }, reactionDismissLayer: { ...StyleSheet.absoluteFillObject, zIndex: 0, backgroundColor: "transparent" }, reactionControl: { position: "relative", zIndex: 30 }, reactionTray: { position: "absolute", left: 0, bottom: 40, height: 50, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 7, borderRadius: 25, borderWidth: 1, borderColor: "#dedede", backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: .24, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 24, zIndex: 50 }, reactionChoice: { width: 37, height: 42, alignItems: "center", justifyContent: "center" }, reactionChoiceEmoji: { fontSize: 24 }, reactionSummary: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 9 }, reactionSummaryEmoji: { fontSize: 16 }, reactionSummaryText: { color: theme.colors.soft, fontSize: 11, fontWeight: "800" }, reactionSummaryTextActive: { color: theme.colors.brand }, reactionTotal: { color: theme.colors.muted, fontSize: 10, fontWeight: "800" }, action: { backgroundColor: "transparent", borderRadius: 9, paddingHorizontal: 7, minHeight: 36, justifyContent: "center" }, iconAction: { width: 34, height: 34, borderRadius: 9, justifyContent: "center", alignItems: "center", backgroundColor: "transparent" }, actionActive: { backgroundColor: "#174c38" }, actionText: { color: theme.colors.soft, fontSize: 11, fontWeight: "700" },
  activitySummary: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(145,145,150,.28)", paddingTop: 8 }, activitySummaryLight: { borderTopColor: "rgba(101,103,107,.16)" }, reactionBreakdown: { flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }, answerReactionStats: { minHeight: 24, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 5 }, activityText: { color: theme.colors.soft, fontSize: 10, fontWeight: "700" }, commentCount: { color: theme.colors.muted, fontSize: 10, fontWeight: "700" }, footerIconAction: { minWidth: 58, height: 34, paddingHorizontal: 6, flexDirection: "row", gap: 4, borderRadius: 9, alignItems: "center", justifyContent: "center" }, footerIcon: { color: theme.colors.soft, fontSize: 20, lineHeight: 23 }, footerShareIcon: { color: theme.colors.soft, fontSize: 19, fontWeight: "500", transform: [{ rotate: "-12deg" }] }, footerActionLabel: { color: theme.colors.soft, fontSize: 10, fontWeight: "800" },
  postOpenArea: { gap: 12 },
  postActionsLight: { borderTopColor: "rgba(101,103,107,.16)" },
  postMediaGrid: { width: "100%", height: 310, flexDirection: "row", flexWrap: "wrap", gap: 3, borderRadius: 14, overflow: "hidden", backgroundColor: theme.colors.panel2 },
  postMediaGridSingle: { height: 330 },
  postMediaCell: { width: "49.5%", height: "49.5%", overflow: "hidden", backgroundColor: theme.colors.panel2 },
  postMediaCellSingle: { width: "100%", height: "100%" },
  postMediaCellTwo: { width: "49.5%", height: "100%", flexGrow: 1 },
  postMediaCellThreeHero: { width: "100%", height: "58%" },
  postMediaCellThreeSmall: { width: "49.5%", height: "41%", flexGrow: 1 },
  postMediaCellFour: { width: "49.5%", height: "49.5%", flexGrow: 1 },
  postMediaImage: { width: "100%", height: "100%" },
  postMediaMore: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,.48)" },
  postMediaMoreText: { color: "#fff", fontSize: 28, fontWeight: "900" },
  viewListingButton: { marginLeft: "auto", minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, borderRadius: 9 }, viewListingIcon: { color: theme.colors.brand, fontSize: 18, lineHeight: 20 }, viewListingButtonText: { color: theme.colors.soft, fontSize: 14, lineHeight: 19, fontWeight: "800" }, viewListingArrow: { color: theme.colors.muted, fontSize: 20, lineHeight: 21, marginTop: -1 },
  footerCommentAction: { minWidth: 42, height: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 7, borderRadius: 9 }, footerCommentCount: { color: theme.colors.soft, fontSize: 12, fontWeight: "800" },
  reactionSummaryIconOnly: { minWidth: 42, paddingHorizontal: 7, justifyContent: "center" },
  empty: { alignItems: "center", backgroundColor: theme.colors.panel, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.line, padding: 30, gap: 8 }, emptyIcon: { fontSize: 36 }, emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800" }, emptyBody: { color: theme.colors.muted, textAlign: "center", lineHeight: 20 }, emptyButton: { marginTop: 8, backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 }, emptyButtonText: { color: "#06291e", fontWeight: "800" },
  loadMore: { alignSelf: "center", borderWidth: 1, borderColor: "#315945", backgroundColor: "#10291f", borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 }, loadMoreText: { color: "#9be8c7", fontWeight: "800" },
  modal: { flex: 1, backgroundColor: theme.colors.bg }, modalHead: { minHeight: 62, borderBottomWidth: 1, borderBottomColor: theme.colors.line, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, cancel: { color: theme.colors.soft, fontSize: 15 }, modalTitle: { color: theme.colors.text, fontWeight: "800", fontSize: 16 }, publish: { color: theme.colors.brand, fontWeight: "800", fontSize: 15 }, danger: { color: theme.colors.accent, fontWeight: "800" }, disabled: { opacity: .45 }, form: { padding: 18, gap: 15, paddingBottom: 40 }, formLabel: { color: theme.colors.soft, fontWeight: "800", fontSize: 12, textTransform: "uppercase", letterSpacing: .5 }, optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, option: { width: "48%", backgroundColor: theme.colors.panel, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 14, padding: 13 }, optionActive: { backgroundColor: "#173b2d", borderColor: theme.colors.brand }, optionText: { color: theme.colors.soft, fontWeight: "700" }, optionTextActive: { color: "#a9f2d2" }, titleInput: { color: theme.colors.text, fontSize: 22, fontWeight: "800", borderBottomWidth: 1, borderBottomColor: theme.colors.line, paddingVertical: 13 }, bodyInput: { minHeight: 150, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 18, padding: 15, color: theme.colors.text, fontSize: 15, lineHeight: 22 }, input: { minHeight: 50, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 15, paddingHorizontal: 14, color: theme.colors.text }, counter: { alignItems: "flex-end", marginTop: -10 }, counterText: { color: theme.colors.muted, fontSize: 11 }, attachmentPanel: { gap: 10, padding: 13, borderRadius: 17, borderWidth: 1, borderColor: "#315348", backgroundColor: "#111d19" }, attachmentTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "900" }, attachmentHint: { color: theme.colors.muted, fontSize: 11, marginTop: 2 }, previewImage: { width: 105, height: 105, borderRadius: 15 }, removeImage: { position: "absolute", right: 5, top: 5, width: 25, height: 25, borderRadius: 13, backgroundColor: "rgba(0,0,0,.75)", alignItems: "center", justifyContent: "center" }, removeImageText: { color: "#fff", fontSize: 18 }, addPhoto: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "#3f6554", borderRadius: 14, padding: 13 }, addPhotoIcon: { color: theme.colors.brand, fontSize: 24 }, addPhotoCopy: { flex: 1, minWidth: 0 }, addPhotoTitle: { color: theme.colors.text, fontWeight: "800" }, addPhotoBody: { color: theme.colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 }, addPhotoChevron: { color: theme.colors.brand, fontSize: 25 }, safety: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, backgroundColor: "#211f17", borderRadius: 14, padding: 13 },
  detailContent: { padding: 14, gap: 14, paddingBottom: 45 }, answersTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "800", marginTop: 6 }, answerCard: { backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 18, padding: 15, gap: 11 }, acceptedCard: { borderColor: theme.colors.brand, backgroundColor: "#11271e" }, answerAvatar: { width: 36, height: 36, borderRadius: 12, backgroundColor: theme.colors.panel2 }, accepted: { color: "#7ee2b8", fontSize: 12, fontWeight: "800" }, answerBody: { color: theme.colors.soft, lineHeight: 21 }, answerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, answerAction: { color: theme.colors.muted, fontWeight: "700", fontSize: 12 }, acceptAction: { color: theme.colors.brand, fontWeight: "800", fontSize: 12 }, answerComposer: { backgroundColor: theme.colors.panel, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.line, padding: 12, gap: 10 }, answerInput: { minHeight: 75, color: theme.colors.text, fontSize: 14, textAlignVertical: "top" }, sendAnswer: { alignSelf: "flex-end", backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10 }, sendAnswerText: { color: "#06291e", fontWeight: "800" }, locked: { color: theme.colors.muted, textAlign: "center", padding: 18 },
  signInAnswer: { backgroundColor: "#10291f", borderWidth: 1, borderColor: "#315945", borderRadius: 18, padding: 18, alignItems: "center", gap: 4 }, signInAnswerTitle: { color: "#9be8c7", fontSize: 16, fontWeight: "800" }, signInAnswerBody: { color: theme.colors.muted, fontSize: 12, textAlign: "center" },
  replyLabel: { color: theme.colors.brand, fontSize: 10, fontWeight: "800" }, replyAction: { color: theme.colors.brand, fontWeight: "800", fontSize: 12 }, replyingTo: { minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, borderRadius: 9, backgroundColor: theme.colors.panel2 }, replyingToText: { color: theme.colors.soft, fontSize: 11, fontWeight: "700" }, replyingToClose: { color: theme.colors.muted, fontSize: 20 }, guestAllowance: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, guestAllowanceName: { color: theme.colors.brand, fontSize: 11, fontWeight: "900" }, guestAllowanceCount: { color: theme.colors.muted, fontSize: 10, fontWeight: "700" }, guestSignupHint: { color: theme.colors.brand, fontSize: 11, textAlign: "center", fontWeight: "800", paddingVertical: 3 },
  inlineReplies: { marginTop: 8, marginLeft: 38, borderLeftWidth: 2, borderLeftColor: "rgba(24,184,132,.28)", paddingLeft: 10, gap: 8 }, inlineReply: { paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.line }, inlineReplyHead: { flexDirection: "row", alignItems: "center", gap: 8 }, inlineReplyAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.panel2 }, inlineReplyAuthor: { color: theme.colors.text, fontSize: 12, fontWeight: "900" }, inlineReplyBody: { color: theme.colors.soft, fontSize: 13, lineHeight: 19, marginTop: 7 },
  inlineRepliesNested: { marginLeft: 12, paddingLeft: 8 },
  inlineRepliesDeep: { marginLeft: 0, paddingLeft: 6 },
  inlineReplyNested: { borderTopColor: "rgba(145,145,150,.20)" },
  moreRepliesButton: { alignSelf: "flex-start", paddingVertical: 7, paddingRight: 12 }, moreRepliesText: { color: theme.colors.brand, fontSize: 11, fontWeight: "900" }, inlineReplyComposer: { marginTop: 7, marginLeft: 38, gap: 8, padding: 10, borderRadius: 13, backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: "rgba(24,184,132,.28)" }, inlineReplyInput: { minHeight: 58, maxHeight: 120, color: theme.colors.text, fontSize: 13, lineHeight: 18, textAlignVertical: "top" }, inlineReplySend: { alignSelf: "flex-end", minWidth: 72, alignItems: "center", borderRadius: 999, backgroundColor: theme.colors.brand, paddingHorizontal: 14, paddingVertical: 9 }, inlineGuestAllowance: { color: theme.colors.muted, fontSize: 10, fontWeight: "700" },
  guestBenefitsBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 20, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.64)" }, guestBenefitsCard: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 34, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel, gap: 13 }, guestBenefitsClose: { position: "absolute", right: 17, top: 15, width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: theme.colors.panel2, zIndex: 2 }, guestBenefitsCloseText: { color: theme.colors.soft, fontSize: 23 }, guestBenefitsEyebrow: { color: theme.colors.brand, fontSize: 9, fontWeight: "900", letterSpacing: 1 }, guestBenefitsTitle: { color: theme.colors.text, fontSize: 22, lineHeight: 28, fontWeight: "900", paddingRight: 30 }, guestBenefitsIntro: { color: theme.colors.muted, fontSize: 13, marginBottom: 3 }, guestBenefit: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 5 }, guestBenefitIcon: { width: 36, fontSize: 25 }, guestBenefitTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "900" }, guestBenefitBody: { maxWidth: 290, color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 }, guestBenefitsPrimary: { minHeight: 50, marginTop: 5, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: theme.colors.brand }, guestBenefitsPrimaryText: { color: "#06291e", fontWeight: "900", fontSize: 15 }, guestBenefitsSecondary: { minHeight: 42, alignItems: "center", justifyContent: "center" }, guestBenefitsSecondaryText: { color: theme.colors.soft, fontWeight: "800", fontSize: 13 },
  groupCreate: { backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 20, padding: 15, gap: 12 }, discoverGroup: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 16, padding: 14 }, joined: { color: theme.colors.brand, fontWeight: "800", fontSize: 12 }, joinButton: { backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9 }, joinButtonText: { color: "#06291e", fontWeight: "800" },
  contentLight: { gap: 9 },
  quickComposerLight: { borderColor: "rgba(255,255,255,0.72)", borderRadius: 18, backgroundColor: "rgba(255,255,255,0.90)", shadowColor: "#101828", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 5 },
  composerPromptLight: { borderColor: "rgba(255,255,255,0.62)", backgroundColor: "rgba(240,242,245,0.86)" },
  quickLinkTextButtonLight: { borderColor: "rgba(255,255,255,0.66)", backgroundColor: "rgba(255,255,255,0.90)", shadowColor: "#101828", shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  topicCardLight: { borderColor: "rgba(255,255,255,0.64)", shadowColor: "#101828", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  feedControlsLight: { borderBottomColor: "#e4e6eb" },
  postCardLight: { marginHorizontal: 0, borderColor: "rgba(255,255,255,0.74)", borderRadius: 20, backgroundColor: "rgba(255,255,255,0.92)", shadowColor: "#101828", shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6, paddingHorizontal: 16 },
  inlineCommunitiesLight: { marginHorizontal: 0, borderColor: "rgba(255,255,255,0.72)", borderRadius: 20, backgroundColor: "rgba(255,255,255,0.90)", shadowColor: "#101828", shadowOpacity: 0.13, shadowRadius: 15, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  inlineCommunityCardLight: { borderColor: "rgba(255,255,255,0.62)", backgroundColor: "rgba(240,242,245,0.84)", shadowColor: "#101828", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  textPrimaryLight: { color: "#151719" },
  textBodyLight: { color: "#1c1e21" },
  textSecondaryLight: { color: "#65676b" },
});
