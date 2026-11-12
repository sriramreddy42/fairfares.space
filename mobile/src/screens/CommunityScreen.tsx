import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Contacts from "expo-contacts";
import * as Location from "expo-location";
import { VideoView, useVideoPlayer } from "expo-video";
import {
  AccessibilityInfo, ActivityIndicator, Alert, Animated, AppState, FlatList, Image, KeyboardAvoidingView, Linking, Modal, PanResponder, Platform, Pressable, RefreshControl, ScrollView, Share,
  StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, useWindowDimensions, View,
} from "react-native";
import {
  absoluteAssetUrl, acceptCommunityAnswer, answerCommunityPost, createCommunityPost, deleteCommunityPost,
  ensureCommunityGuestSession,
  getAccommodationLocationOptions, getChatCommunities, getChatLinkPreview, getCommunityFeed, getCommunityPost, joinChatCommunity,
  findChatPeopleByContactHashes, getPeopleContactPool, getPeopleConnections, getPeopleMapCityPool, getPeopleSuggestions, hidePeopleSuggestion, PeopleMapCityPool, PeopleSuggestion, getRelocationSuggestions, recordCurrentCityObservation, RelocationSuggestion,
  getHousingActivity, getRentalBookings, getRideActivity, getCommunityUserProfile,
  createCommunityVideoPost, reactToCommunityContent, reportCommunityContent, resumePendingCommunityVideoUploads, saveCommunityPost,
  updateCommunityAnswer, updateCommunityPost, updateCommunityPostStatus, updateMobileProfile, uploadCommunityVideo,
} from "../api/client";
import type { ChatLinkPreview, FairFaresContact } from "../api/client";
import { BootstrapPayload, Car, Community, CommunityAnswer, CommunityPost, FairFaresUser, HousingActivityPost, RentalServiceBooking, RidePost } from "../types";
import { UserAvatar } from "../components/UserAvatar";
import { PeopleMap, PeopleMapMember, PeopleMapRegion } from "../components/PeopleMap";
import { TactilePressable } from "../components/TactilePressable";
import { MemberProfileSheet, MemberProfileSheetHandle, MemberProfileTarget } from "../components/MemberProfileSheet";
import { theme } from "../theme";
import { pickCommunityVideo, pickCompressedImages, prepareCommunityVideoForFeed, removePreparedCommunityVideo } from "../utils/imageUpload";
import type { CommunityVideoFile } from "../utils/imageUpload";
import { useResponsiveLayout } from "../utils/layout";
import { requestUserLocationPermission } from "../utils/locationPermission";
import { readCachedDeviceCity, resolveCurrentDeviceCity } from "../utils/deviceCity";
import { avatarInitials } from "../utils/text";
import { contactDiscoveryHash, contactDiscoveryVariants } from "../utils/chatCrypto";
import { readGasCache } from "../utils/gasPriceCache";
import { locationCountryCodeFromLabel } from "../utils/locationRegion";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  user: FairFaresUser | null;
  city: string;
  cars: Car[];
  testimonials?: BootstrapPayload["testimonials"];
  onRequireLogin: () => void;
  onRequireSignup: () => void;
  onRequestGuestNotifications?: () => void;
  onOpenHousing: (postId?: string) => void;
  onOpenRides: (target?: "ride" | "requests" | "activity", rideId?: string) => void;
  onOpenRentalCars: () => void;
  onOpenRentalBooking: (bookingId: string, action?: "balance" | "deposit" | "extension" | "extendRequest" | "pickup" | "returnReview" | "manage") => void;
  onOpenGas: () => void;
  gasPriceRefreshKey?: number;
  onOpenCommunity: (communityId: string) => void;
  onOpenUserChat: (userId: number) => void;
  onProfileUpdated: (user: BootstrapPayload["user"]) => void;
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
const communityHeroPoster = require("../../assets/ask-community-logo-transparent.png");
const categoryLabels: Record<string, string> = {
  ALL: "For you", GENERAL: "General", NEED_ROOMMATE: "Need a roommate", NEED_PLACE: "Need a place",
  HAVE_PLACE: "Have a place", CARPOOL_RIDE: "Carpool ride", HOUSING: "Housing", RIDES: "Rides",
  LOCAL: "Local", PLACES: "Places", STUDENT: "Students", SERVICES: "Services", SAFETY: "Safety",
};
const categoryIcons: Record<string, string> = { GENERAL: "💬", NEED_ROOMMATE: "👥", NEED_PLACE: "🔑", HAVE_PLACE: "🏠", CARPOOL_RIDE: "🚗" };
const relocationReasons = [
  { value: "NEW_JOB", label: "New job" },
  { value: "SCHOOL_COLLEGE", label: "School / college" },
  { value: "FAMILY", label: "Family" },
  { value: "OTHER", label: "Other" },
] as const;
type RelocationReason = typeof relocationReasons[number]["value"] | "";
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
type ComposerMedia = CommunityPost["media"][number] & { pendingVideo?: CommunityVideoFile };
function emptyCommunityPostForm() {
  return {
    type: "QUESTION" as CommunityPost["type"],
    category: "GENERAL" as CommunityPost["category"],
    title: "",
    body: "",
    area: "",
    linkUrl: "",
    communityId: "",
    media: [] as ComposerMedia[],
    details: { ...emptyDetails },
    expiresInDays: 45,
  };
}

function postFieldExamples(category: CommunityPost["category"]) {
  switch (category) {
    case "NEED_PLACE":
      return { title: "Looking for a room near downtown", body: "Include your preferred area, move-in date, budget, and what you are looking for." };
    case "NEED_ROOMMATE":
      return { title: "Looking for a roommate from August", body: "Share the area, budget, move-in date, and the kind of roommate you hope to find." };
    case "HAVE_PLACE":
      return { title: "Private room available near campus", body: "Include the area, monthly rent, available date, room type, and who it would suit." };
    case "CARPOOL_RIDE":
      return { title: "Ride needed from Aurora to Denver", body: "Include where you are leaving from, where you are going, and when you need to travel." };
    default:
      return { title: "Looking for local recommendations", body: "Explain your question and include the details people need to give you a useful answer." };
  }
}

type CommunityFeedSnapshot = {
  posts: CommunityPost[];
  nationalPosts: CommunityPost[];
  localHasMore: boolean;
  nationalHasMore: boolean;
  updatedAt: number;
};

type CommunityFeedRow =
  | { key: string; kind: "post"; post: CommunityPost }
  | { key: string; kind: "communities" }
  | { key: string; kind: "local-empty" }
  | { key: string; kind: "local-more" }
  | { key: string; kind: "national-heading" }
  | { key: string; kind: "national-more" }
  | { key: string; kind: "testimonial" }
  | { key: string; kind: "rental" }
  | { key: string; kind: "empty" };

type CommunityActionNotice = {
  id: string;
  icon: string;
  eyebrow: string;
  title: string;
  body: string;
  actionLabel: string;
  action: "housing" | "ride" | "ride-request" | "rental";
  rideId?: string;
  bookingId?: string;
  housingPostId?: string;
  housingInquiryUserId?: number;
  rentalAction?: "balance" | "deposit" | "extension" | "extendRequest" | "pickup" | "returnReview" | "manage";
};

const communityFeedSnapshots = new Map<string, CommunityFeedSnapshot>();
const communityGroupSnapshots = new Map<string, Community[]>();
const communityReviewFallback: BootstrapPayload["testimonials"][number] = {
  id: -10,
  name: "Sriram Reddy Bandari",
  city: "Denver, CO",
  avatarEmoji: "🎓",
  demo: true,
  rating: 5,
  message: "I like it very nice app helpful in relocating"
};

type CommunityReview = BootstrapPayload["testimonials"][number];

// The active-review state intentionally lives inside this memoized card. Its
// timer can rotate a review without committing the image-heavy Ask feed or
// disturbing a person's scroll position.
const CommunityReviewCard = React.memo(function CommunityReviewCard({ reviews, city, isLight }: { reviews: CommunityReview[]; city: string; isLight: boolean }) {
  const reviewCount = reviews.length;
  const [activeReviewIndex, setActiveReviewIndex] = useState(0);
  const featuredReview = reviews[activeReviewIndex % reviewCount] || communityReviewFallback;
  const visibleReviewDots = Math.min(reviewCount, 5);
  const activeDotIndex = activeReviewIndex % visibleReviewDots;
  const rating = Math.max(1, Math.min(5, Math.round(Number(featuredReview.rating || 5))));
  const photoUrl = featuredReview.photoUrl ? absoluteAssetUrl(featuredReview.photoUrl) : "";

  useEffect(() => {
    setActiveReviewIndex(0);
  }, [reviewCount]);

  useEffect(() => {
    if (reviewCount <= 1) return undefined;
    const timer = setInterval(() => {
      setActiveReviewIndex((current) => (current + 1) % reviewCount);
    }, 5000);
    return () => clearInterval(timer);
  }, [reviewCount]);

  return (
    <View style={[styles.communityReviewCard, isLight && styles.communityReviewCardLight]}>
      <View style={styles.communityReviewAvatarWrap}>
        <UserAvatar
          photoUrl={photoUrl}
          style={styles.communityReviewAvatar}
          imageStyle={styles.communityReviewAvatarImage}
          fallback={<Text style={styles.communityReviewAvatarFallback}>{featuredReview.avatarEmoji || avatarInitials(featuredReview.name || "FairFares", "FF")}</Text>}
        />
      </View>
      <View style={styles.communityReviewCopy}>
        <View style={styles.communityReviewTop}>
          <Text style={[styles.communityReviewName, isLight && styles.textPrimaryLight]} numberOfLines={1}>{featuredReview.name || "FairFares member"}</Text>
          <Text style={styles.communityReviewStars}>{Array.from({ length: rating }).map(() => "★").join("")}</Text>
        </View>
        <Text style={styles.communityReviewLocation} numberOfLines={1}>📍 {featuredReview.city || city || "FairFares community"}</Text>
        <Text style={[styles.communityReviewQuote, isLight && styles.textPrimaryLight]} numberOfLines={2}>“{String(featuredReview.message || communityReviewFallback.message).replace(/^“|”$/g, "")}”</Text>
      </View>
      {reviewCount > 1 ? (
        <View style={styles.communityReviewDots} pointerEvents="none">
          {reviews.slice(0, visibleReviewDots).map((review, index) => (
            <View key={`${review.id || index}-dot`} style={[styles.communityReviewDot, index === activeDotIndex && styles.communityReviewDotActive]} />
          ))}
        </View>
      ) : <View style={styles.communityReviewPill} />}
    </View>
  );
});

// Decorative only: the motion is intentionally slow, subtle, and disabled
// when the system asks for reduced motion. It makes the discovery rail feel
// alive without competing with the people or their trust signals.
const PeopleDiscoveryBubbles = React.memo(function PeopleDiscoveryBubbles() {
  const drift = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      drift.stopAnimation();
      pulse.stopAnimation();
      return undefined;
    }
    const animation = Animated.parallel([
      Animated.loop(Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 7200, useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 7200, useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 4000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 4000, useNativeDriver: true }),
      ])),
    ]);
    animation.start();
    return () => animation.stop();
  }, [drift, pulse, reduceMotion]);

  const driftRight = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 16] });
  const driftLeft = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const softOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.52] });

  return <View pointerEvents="none" style={styles.peopleDiscoveryBubbles}>
    <Animated.View style={[styles.peopleDiscoveryBubble, styles.peopleDiscoveryBubbleOne, { opacity: softOpacity, transform: [{ translateX: driftRight }] }]} />
    <Animated.View style={[styles.peopleDiscoveryBubble, styles.peopleDiscoveryBubbleTwo, { opacity: softOpacity, transform: [{ translateX: driftLeft }] }]} />
    <Animated.View style={[styles.peopleDiscoveryBubble, styles.peopleDiscoveryBubbleThree, { transform: [{ translateX: driftRight }] }]} />
  </View>;
});

function peopleSuggestionTag(reason: string) {
  const normalized = reason.toLowerCase();
  if (normalized.includes("mutual") && normalized.includes("near")) return "Nearby mutual";
  if (normalized.includes("mutual")) return "Mutual connection";
  if (normalized.includes("shared") && normalized.includes("near")) return "Nearby community";
  if (normalized.includes("shared")) return "Shared community";
  return "Near you";
}

type FloatingPersonSuggestion = {
  id: number;
  name: string;
  photoUrl: string;
  tag: string;
  ratingLabel?: string;
  canDismiss?: boolean;
  sourceSuggestion?: PeopleSuggestion;
};

const floatingPersonPositions = [
  { left: "5%", top: 14, size: 82 },
  { left: "36%", top: 58, size: 94 },
  { right: "5%", top: 16, size: 78 },
  { left: "14%", top: 159, size: 88 },
  { right: "19%", top: 158, size: 98 },
] as const;
const floatingPersonCompactPositions = [
  { left: "7%", top: 5, size: 54 },
  { left: "39%", top: 23, size: 64 },
  { right: "7%", top: 5, size: 54 },
] as const;

const FloatingPersonBubble = React.memo(function FloatingPersonBubble({ member, index, compact = false, isLight, onOpen, onDismiss }: {
  member: FloatingPersonSuggestion;
  index: number;
  compact?: boolean;
  isLight: boolean;
  onOpen: () => void;
  onDismiss?: () => void;
}) {
  const bounce = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const positions = compact ? floatingPersonCompactPositions : floatingPersonPositions;
  const position = positions[index % positions.length];

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      bounce.stopAnimation();
      return undefined;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(index * 220),
      Animated.timing(bounce, { toValue: 1, duration: 1750 + index * 95, useNativeDriver: true }),
      Animated.timing(bounce, { toValue: 0, duration: 1750 + index * 95, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [bounce, index, reduceMotion]);

  const translateY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, index % 2 ? -8 : -11] });
  const translateX = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, index % 2 ? 2 : -2] });
  return <Animated.View style={[styles.floatingPerson, position, { width: position.size + 18, transform: [{ translateY }, { translateX }] }]}>
    <TouchableOpacity style={[styles.floatingPersonTap, { width: position.size, height: position.size, borderRadius: position.size / 2 }, isLight && styles.floatingPersonTapLight]} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`View ${member.name}'s profile`}>
      <UserAvatar photoUrl={member.photoUrl} style={[styles.floatingPersonAvatar, { width: position.size - 8, height: position.size - 8, borderRadius: (position.size - 8) / 2 }]} imageStyle={{ borderRadius: (position.size - 8) / 2 }} fallback={<Text style={styles.floatingPersonInitials}>{initials(member.name)}</Text>} />
      <View style={styles.floatingPersonStatus}><Text style={styles.floatingPersonStatusText}>✦</Text></View>
    </TouchableOpacity>
    <View style={[styles.floatingPersonNameTag, isLight && styles.floatingPersonNameTagLight]}>
      <Text style={[styles.floatingPersonName, isLight && styles.textPrimaryLight]} numberOfLines={1}>{member.name}</Text>
      <Text style={styles.floatingPersonReason} numberOfLines={1}>{member.tag}{member.ratingLabel ? ` · ★ ${member.ratingLabel}` : ""}</Text>
    </View>
    {member.canDismiss && onDismiss ? <TouchableOpacity style={styles.floatingPersonDismiss} onPress={onDismiss} accessibilityRole="button" accessibilityLabel={`Hide ${member.name} from people suggestions`}><Text style={styles.floatingPersonDismissText}>×</Text></TouchableOpacity> : null}
  </Animated.View>;
});

function communityFeedSnapshotKey(userId: number, city: string, category: string, query: string, groupId: string) {
  return [userId || "guest", normalizedLocationLabel(city).toLocaleLowerCase(), category, query.trim().toLocaleLowerCase(), groupId].join("|");
}

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
function initials(name: string) { return avatarInitials(name, "FF"); }

/** A restrained idle motion gives the illustrated member characters some life
 * without competing with the post itself. It runs only on feed cards. */
function FeedCharacterAvatar({ photoUrl, name, delay = 0 }: { photoUrl?: string; name: string; delay?: number }) {
  const lift = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.parallel([
        Animated.timing(lift, { toValue: -5, duration: 900, useNativeDriver: true }),
        Animated.timing(sway, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(lift, { toValue: 0, duration: 900, useNativeDriver: true }),
        Animated.timing(sway, { toValue: -1, duration: 900, useNativeDriver: true }),
      ]),
    ]));
    const starter = setTimeout(() => animation.start(), delay);
    return () => { clearTimeout(starter); animation.stop(); };
  }, [delay, lift, sway]);
  const rotate = sway.interpolate({ inputRange: [-1, 0, 1], outputRange: ["-2.5deg", "0deg", "2.5deg"] });
  return <Animated.View style={[styles.avatar, { transform: [{ translateY: lift }, { rotate }] }]}>
    <UserAvatar photoUrl={photoUrl} imageStyle={styles.avatarImage} fallback={<Text style={styles.avatarInitials}>{initials(name)}</Text>} />
  </Animated.View>;
}

function firstWebUrl(value: string) {
  const match = value.match(/https?:\/\/[^\s<>]+/i)?.[0] || "";
  return match.replace(/[),.!?;:'\"]+$/, "");
}

function communityLinkPreviewUrl(linkUrl: string, body: string) {
  const candidate = linkUrl.trim() || firstWebUrl(body);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.hostname ? candidate : "";
  } catch {
    return "";
  }
}
const usStateCodes = new Set(["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"]);
const usStateNames: Record<string, string> = { Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC" };
const usStateNameCodes = new Map(Object.entries(usStateNames).map(([name, code]) => [name.toLocaleLowerCase(), code]));
const indiaStateCodes: Record<string, string> = { AP: "Andhra Pradesh", AR: "Arunachal Pradesh", AS: "Assam", BR: "Bihar", CT: "Chhattisgarh", GA: "Goa", GJ: "Gujarat", HR: "Haryana", HP: "Himachal Pradesh", JH: "Jharkhand", KA: "Karnataka", KL: "Kerala", MP: "Madhya Pradesh", MH: "Maharashtra", MN: "Manipur", ML: "Meghalaya", MZ: "Mizoram", NL: "Nagaland", OD: "Odisha", OR: "Odisha", PB: "Punjab", RJ: "Rajasthan", SK: "Sikkim", TN: "Tamil Nadu", TS: "Telangana", TG: "Telangana", TR: "Tripura", UP: "Uttar Pradesh", UK: "Uttarakhand", UT: "Uttarakhand", WB: "West Bengal", AN: "Andaman and Nicobar Islands", CH: "Chandigarh", DH: "Dadra and Nagar Haveli and Daman and Diu", DL: "Delhi", JK: "Jammu and Kashmir", LA: "Ladakh", LD: "Lakshadweep", PY: "Puducherry" };
const indiaStateNameCodes = new Map(Object.entries(indiaStateCodes).map(([code, name]) => [name.toLocaleLowerCase(), code]));
function normalizedUsCityKey(value: string) {
  let parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 3 && /^(?:US|USA|United States)$/i.test(parts[2])) parts = parts.slice(0, 2);
  if (parts.length !== 2) return "";
  const region = usStateCodes.has(parts[1].toUpperCase()) ? parts[1].toUpperCase() : usStateNameCodes.get(parts[1].toLocaleLowerCase());
  return region ? `${parts[0].toLocaleLowerCase()},${region}` : "";
}
function normalizedIndiaCityKey(value: string) {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  const country = parts[parts.length - 1]?.toUpperCase();
  if (country !== "IN" && country !== "INDIA") return "";
  const city = parts[0] || "";
  if (!city) return "";
  const rawState = parts.length >= 3 ? parts[1] || "" : "";
  const code = indiaStateCodes[rawState.toUpperCase()] || indiaStateNameCodes.get(rawState.toLocaleLowerCase()) || rawState.toLocaleUpperCase();
  return `${city.toLocaleLowerCase()},${code},IN`;
}
function normalizedCityKey(value: string) {
  return normalizedUsCityKey(value) || normalizedIndiaCityKey(value);
}
function normalizedLocationLabel(value: string) {
  let parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (/^(?:IN|India)$/i.test(parts[parts.length - 1] || "")) {
    const city = parts[0] || "";
    const rawState = parts.length >= 3 ? parts[1] || "" : "";
    const code = indiaStateCodes[rawState.toUpperCase()] || indiaStateNameCodes.get(rawState.toLocaleLowerCase()) || rawState;
    const state = indiaStateCodes[code.toUpperCase()] || rawState;
    return [city, state, "India"].filter(Boolean).join(", ");
  }
  if (parts.length === 3 && /^(?:US|USA|United States)$/i.test(parts[2])) parts = parts.slice(0, 2);
  if (parts.length !== 2) return value.trim();
  const region = usStateCodes.has(parts[1].toUpperCase()) ? parts[1].toUpperCase() : usStateNameCodes.get(parts[1].toLocaleLowerCase());
  return region ? `${parts[0]}, ${region}` : value.trim();
}
function communityPostLocation(area: string, city: string) {
  const cleanArea = area.trim();
  const cleanCity = normalizedLocationLabel(city);
  if (!cleanArea) return cleanCity;
  if (!cleanCity) return cleanArea;
  const comparable = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const areaKey = comparable(cleanArea);
  const cityKey = comparable(cleanCity);
  // A selected address or locality often already ends with City, ST. Showing
  // both produced labels such as “Bridgeport, CT · Bridgeport, CT”.
  if (areaKey === cityKey || areaKey.includes(cityKey)) return cleanArea;
  return `${cleanArea} · ${cleanCity}`;
}

const housingCommunityCategories = new Set<CommunityPost["category"]>([
  "HAVE_PLACE", "NEED_PLACE", "NEED_ROOMMATE", "HOUSING",
]);

const communityFactLabels: Record<string, string> = {
  rent: "Monthly rent",
  budget: "Monthly budget",
  availableDate: "Available from",
  moveIn: "Move-in date",
  moveInDate: "Move-in date",
  roomType: "Room type",
  leaseTerm: "Lease term",
  bathroomType: "Bathroom",
  genderPreference: "Who it suits",
  preference: "Preferences",
  location: "Location",
  neighborhood: "Neighborhood",
};

type CommunityFact = { id: string; label: string; value: string; wide?: boolean };

function isHousingCommunityPost(post: CommunityPost) {
  return post.sourceKind === "HOUSING" || housingCommunityCategories.has(post.category);
}

function communityPostFacts(post: CommunityPost): CommunityFact[] {
  const details = post.details || {};
  const values = Object.entries(details)
    .map(([key, value]) => [key, String(value || "").trim()] as const)
    .filter(([, value]) => Boolean(value));
  if (!isHousingCommunityPost(post)) {
    return values.slice(0, 6).map(([key, value]) => ({
      id: key,
      label: communityFactLabels[key] || key.replace(/([A-Z])/g, " $1").trim(),
      value,
    }));
  }

  const locationDetail = values.find(([key]) => key === "location" || key === "neighborhood")?.[1] || "";
  const location = communityPostLocation(locationDetail || post.area, post.city);
  const orderedKeys = ["rent", "budget", "availableDate", "moveInDate", "moveIn", "roomType", "leaseTerm", "bathroomType", "genderPreference", "preference"];
  const detailsByKey = new Map(values);
  const facts: CommunityFact[] = [];
  for (const key of orderedKeys) {
    const value = detailsByKey.get(key);
    if (!value) continue;
    facts.push({ id: key, label: communityFactLabels[key] || key, value });
    detailsByKey.delete(key);
  }
  for (const [key, value] of detailsByKey) {
    if (key === "location" || key === "neighborhood") continue;
    facts.push({ id: key, label: communityFactLabels[key] || key.replace(/([A-Z])/g, " $1").trim(), value });
  }
  // Location is intentionally part of the listing facts. It is where people
  // compare rent, availability, and room type—not a crowded piece of the
  // poster identity line. Exact home addresses remain excluded from Ask.
  return [
    ...facts.slice(0, location ? 6 : 7),
    ...(location ? [{ id: "listing-location", label: "Location", value: location, wide: true }] : []),
  ];
}

function ZoomableCommunityPhoto({ uri }: { uri: string }) {
  const scaleValue = useRef(new Animated.Value(1)).current;
  const translateXValue = useRef(new Animated.Value(0)).current;
  const translateYValue = useRef(new Animated.Value(0)).current;
  const gesture = useRef({ scale: 1, x: 0, y: 0, width: 1, height: 1, mode: "none" as "none" | "pan" | "pinch", startX: 0, startY: 0, startPanX: 0, startPanY: 0, startDistance: 1, startScale: 1, anchorX: 0, anchorY: 0 }).current;
  const updateTransform = (scale: number, x: number, y: number) => {
    const nextScale = Math.max(1, Math.min(4, scale));
    const maxX = (nextScale - 1) * gesture.width / 2;
    const maxY = (nextScale - 1) * gesture.height / 2;
    gesture.scale = nextScale;
    gesture.x = Math.max(-maxX, Math.min(maxX, x));
    gesture.y = Math.max(-maxY, Math.min(maxY, y));
    scaleValue.setValue(gesture.scale); translateXValue.setValue(gesture.x); translateYValue.setValue(gesture.y);
  };
  const beginPan = (touch: { pageX: number; pageY: number }) => { gesture.mode = "pan"; gesture.startX = touch.pageX; gesture.startY = touch.pageY; gesture.startPanX = gesture.x; gesture.startPanY = gesture.y; };
  const beginPinch = (touches: ReadonlyArray<{ pageX: number; pageY: number; locationX: number; locationY: number }>) => {
    if (touches.length < 2) return;
    gesture.mode = "pinch";
    gesture.startDistance = Math.max(1, Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY));
    gesture.startScale = gesture.scale;
    const midpointX = (touches[0].locationX + touches[1].locationX) / 2;
    const midpointY = (touches[0].locationY + touches[1].locationY) / 2;
    gesture.anchorX = (midpointX - gesture.width / 2 - gesture.x) / gesture.scale;
    gesture.anchorY = (midpointY - gesture.height / 2 - gesture.y) / gesture.scale;
  };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event) => { const touches = event.nativeEvent.touches; if (touches.length >= 2) beginPinch(touches); else if (touches[0]) beginPan(touches[0]); },
    onPanResponderStart: (event) => { if (event.nativeEvent.touches.length >= 2) beginPinch(event.nativeEvent.touches); },
    onPanResponderMove: (event) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        if (gesture.mode !== "pinch") beginPinch(touches);
        const distance = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
        const nextScale = gesture.startScale * distance / gesture.startDistance;
        const midpointX = (touches[0].locationX + touches[1].locationX) / 2;
        const midpointY = (touches[0].locationY + touches[1].locationY) / 2;
        updateTransform(nextScale, midpointX - gesture.width / 2 - nextScale * gesture.anchorX, midpointY - gesture.height / 2 - nextScale * gesture.anchorY);
      } else if (touches[0] && gesture.scale > 1) {
        if (gesture.mode !== "pan") beginPan(touches[0]);
        updateTransform(gesture.scale, gesture.startPanX + touches[0].pageX - gesture.startX, gesture.startPanY + touches[0].pageY - gesture.startY);
      }
    },
    onPanResponderRelease: () => { gesture.mode = "none"; if (gesture.scale < 1.02) updateTransform(1, 0, 0); },
    onPanResponderTerminate: () => { gesture.mode = "none"; },
  })).current;
  return <View style={styles.photoViewerStage} onLayout={(event) => { gesture.width = event.nativeEvent.layout.width; gesture.height = event.nativeEvent.layout.height; }} accessibilityLabel="Listing photo. Pinch with two fingers to zoom." {...responder.panHandlers}><Animated.Image source={{ uri: absoluteUrl(uri) }} style={[styles.photoViewerImage, { transform: [{ translateX: translateXValue }, { translateY: translateYValue }, { scale: scaleValue }] }]} resizeMode="contain" /></View>;
}

/**
 * A single post photo should keep its own proportions. The feed used to put
 * every photo into the same 330px-tall box, which cut off the top or bottom of
 * flyers and portrait images. Photo sets still use the compact grid below.
 */
function CommunitySinglePostPhoto({ image, interactive, onPress, label }: { image: string; interactive: boolean; onPress: () => void; label: string }) {
  const [aspectRatio, setAspectRatio] = useState(1);
  const uri = absoluteUrl(image);
  const setLoadedAspectRatio = useCallback((width: number, height: number) => {
    if (width > 0 && height > 0) setAspectRatio(width / height);
  }, []);
  useEffect(() => {
    let mounted = true;
    // Image.onLoad is not consistently called again for an image already held
    // in the native cache. Ask for its dimensions explicitly so cached flyers
    // still receive the correct height.
    Image.getSize(uri, (width, height) => {
      if (mounted) setLoadedAspectRatio(width, height);
    }, () => undefined);
    return () => { mounted = false; };
  }, [uri, setLoadedAspectRatio]);
  const handleLoad = useCallback((event: { nativeEvent: { source?: { width?: number; height?: number } } }) => {
    const { width = 0, height = 0 } = event.nativeEvent.source || {};
    setLoadedAspectRatio(width, height);
  }, [setLoadedAspectRatio]);
  const photo = <Image source={{ uri }} style={styles.postMediaSingleImage} resizeMode="cover" onLoad={handleLoad} />;
  const containerStyle = [styles.postMediaSingle, { aspectRatio }];
  return interactive
    ? <TouchableOpacity style={containerStyle} activeOpacity={0.78} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>{photo}</TouchableOpacity>
    : <View style={containerStyle}>{photo}</View>;
}

function CommunityPostVideo({ video, style, contentFit = "cover", autoPlay = false }: { video: string; style: object; contentFit?: "contain" | "cover" | "fill"; autoPlay?: boolean }) {
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer(absoluteUrl(video), (instance) => {
    // Feed videos follow the familiar social convention: autoplay only while
    // visible, always start muted, and loop until the member scrolls away.
    instance.muted = true;
    instance.loop = true;
  });
  useEffect(() => {
    const statusSubscription = player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay" && autoPlay) player.play();
    });
    return () => statusSubscription.remove();
  }, [autoPlay, player]);
  useEffect(() => {
    player.muted = muted;
    if (autoPlay) player.play();
    else player.pause();
  }, [autoPlay, muted, player]);
  // The full feed card opens its discussion when pressed. Stop a touch that
  // began on the native player from bubbling to that card: play/pause, seek,
  // fullscreen, and audio controls must remain video-only interactions.
  return <View
    style={style}
    onTouchStart={(event) => event.stopPropagation()}
    onTouchEnd={(event) => event.stopPropagation()}
  >
    <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit={contentFit} allowsFullscreen />
    <TouchableOpacity
      style={styles.communityVideoSoundButton}
      onPress={() => { const nextMuted = !muted; setMuted(nextMuted); if (!nextMuted) player.play(); }}
      accessibilityRole="button"
      accessibilityLabel={muted ? "Unmute video" : "Mute video"}
    >
      <Text style={styles.communityVideoSoundIcon}>{muted ? "🔇" : "🔊"}</Text>
    </TouchableOpacity>
  </View>;
}
function utcTimestamp(value: string) {
  if (!value) return Number.POSITIVE_INFINITY;
  return new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime();
}
function isActivePublicCountryPost(post: CommunityPost, localCity: string, localIds: Set<string>, country: string) {
  const expiresAt = utcTimestamp(post.expiresAt);
  return locationCountryCodeFromLabel(post.city) === country
    && Boolean(normalizedCityKey(post.city))
    && normalizedCityKey(post.city) !== normalizedCityKey(localCity)
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
      onPress={(event) => { event.stopPropagation(); void Linking.openURL(destinationUrl).catch((error) => Alert.alert("Link not opened", message(error))); }}
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

export function CommunityScreen({ user, city, cars, testimonials = [], onRequireLogin, onRequireSignup, onRequestGuestNotifications, onOpenHousing, onOpenRides, onOpenRentalCars, onOpenRentalBooking, onOpenGas, gasPriceRefreshKey = 0, onOpenCommunity, onOpenUserChat, onProfileUpdated, onBottomTabsHiddenChange, initialPostId = "", onInitialPostOpened }: Props) {
  const layout = useResponsiveLayout();
  const { width: viewportWidth } = useWindowDimensions();
  const compactPostActions = !layout.isTablet && viewportWidth < 390;
  const safeAreaInsets = useSafeAreaInsets();
  // React Native's Android page-sheet Modal can report a zero top inset even
  // when the device has a centered camera cutout. Keep the whole action row
  // below that system region instead of only making the row taller.
  const modalHeaderTopInset = Platform.OS === "android" ? Math.max(safeAreaInsets.top, 32) : safeAreaInsets.top;
  const isLight = useColorScheme() === "light";
  const initialFeedSnapshot = communityFeedSnapshots.get(communityFeedSnapshotKey(Number(user?.id || 0), city, "ALL", "", ""));
  const initialGroups = communityGroupSnapshots.get(normalizedLocationLabel(city).toLocaleLowerCase());
  const [posts, setPosts] = useState<CommunityPost[]>(() => initialFeedSnapshot?.posts || []);
  const [nationalPosts, setNationalPosts] = useState<CommunityPost[]>(() => initialFeedSnapshot?.nationalPosts || []);
  const [localHasMore, setLocalHasMore] = useState(() => initialFeedSnapshot?.localHasMore || false);
  const [nationalHasMore, setNationalHasMore] = useState(() => initialFeedSnapshot?.nationalHasMore || false);
  const [groups, setGroups] = useState<Community[]>(() => initialGroups || []);
  const [relocationSuggestions, setRelocationSuggestions] = useState<RelocationSuggestion[]>([]);
  const [peopleSuggestions, setPeopleSuggestions] = useState<PeopleSuggestion[]>([]);
  const [contactSuggestions, setContactSuggestions] = useState<FairFaresContact[]>([]);
  const [connections, setConnections] = useState<FairFaresContact[]>([]);
  const [peopleNetworkOpen, setPeopleNetworkOpen] = useState(false);
  const [peopleNetworkTab, setPeopleNetworkTab] = useState<"FOR_YOU" | "FRIENDS" | "MUTUALS" | "CONTACTS">("FOR_YOU");
  const [savedContactMapPins, setSavedContactMapPins] = useState<PeopleMapMember[]>([]);
  const [contactSuggestionsLoading, setContactSuggestionsLoading] = useState(false);
  const [contactSuggestionsChecked, setContactSuggestionsChecked] = useState(false);
  const [peopleMapOpen, setPeopleMapOpen] = useState(false);
  const [peopleMapPlannerOpen, setPeopleMapPlannerOpen] = useState(false);
  const [peopleMapInitialFocus, setPeopleMapInitialFocus] = useState<{ latitude: number; longitude: number } | null>(null);
  const [peopleMapListOpen, setPeopleMapListOpen] = useState(false);
  const [peopleMapCompany, setPeopleMapCompany] = useState("");
  const [peopleMapMoreBusy, setPeopleMapMoreBusy] = useState(false);
  const [peopleMapCityPool, setPeopleMapCityPool] = useState<PeopleMapCityPool | null>(null);
  const [peopleMapMember, setPeopleMapMember] = useState<MemberProfileTarget | null>(null);
  const [peopleMapMemberProfile, setPeopleMapMemberProfile] = useState<Awaited<ReturnType<typeof getCommunityUserProfile>> | null>(null);
  const [peopleMapMemberLoading, setPeopleMapMemberLoading] = useState(false);
  const peopleMapViewportKeyRef = useRef("");
  const peopleMapViewportRequestRef = useRef(0);
  const peopleMapMemberRequestRef = useRef(0);
  const peopleMapPlannerEntrance = useRef(new Animated.Value(0)).current;
  const peopleMapPlannerPulse = useRef(new Animated.Value(0)).current;
  const [relocationPlannerOpen, setRelocationPlannerOpen] = useState(false);
  const [relocationCityDraft, setRelocationCityDraft] = useState(user?.relocationCity || "");
  const [relocationMonthDraft, setRelocationMonthDraft] = useState(user?.relocationCity ? user.relocationMonth || "" : "");
  const [relocationCompanyDraft, setRelocationCompanyDraft] = useState(user?.relocationCity ? user.relocationCompany || "" : "");
  const [relocationReasonDraft, setRelocationReasonDraft] = useState<RelocationReason>(user?.relocationCity ? user.relocationReason || "" : "");
  const [relocationCityOptions, setRelocationCityOptions] = useState<string[]>([]);
  const [relocationCityOptionsLoading, setRelocationCityOptionsLoading] = useState(false);
  const [relocationSaving, setRelocationSaving] = useState(false);
  const [groupSuggestionCity, setGroupSuggestionCity] = useState(city);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [cityDraft, setCityDraft] = useState("");
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [cityOptionsLoading, setCityOptionsLoading] = useState(false);
  const [locationRefreshKey, setLocationRefreshKey] = useState(0);
  const [feedCityPreferenceReady, setFeedCityPreferenceReady] = useState(false);
  const [locationResolving, setLocationResolving] = useState(false);
  const [lowestGasPrice, setLowestGasPrice] = useState<number | null>(null);
  const [gasPreviewCoordinates, setGasPreviewCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [category, setCategory] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [actionNotice, setActionNotice] = useState<CommunityActionNotice | null>(null);
  const [actionNoticeRefreshKey, setActionNoticeRefreshKey] = useState(0);
  const actionNoticeMotion = useRef(new Animated.Value(0)).current;
  const actionNoticeVisible = useRef(false);

  useEffect(() => {
    peopleMapPlannerEntrance.stopAnimation();
    peopleMapPlannerPulse.stopAnimation();
    if (!peopleMapPlannerOpen) {
      peopleMapPlannerEntrance.setValue(0);
      peopleMapPlannerPulse.setValue(0);
      return undefined;
    }
    peopleMapPlannerEntrance.setValue(0);
    const entrance = Animated.spring(peopleMapPlannerEntrance, {
      toValue: 1,
      damping: 15,
      stiffness: 155,
      mass: 0.82,
      useNativeDriver: true,
    });
    entrance.start();
    let pulse: Animated.CompositeAnimation | null = null;
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (!active || reduceMotion) return;
      pulse = Animated.loop(Animated.sequence([
        Animated.timing(peopleMapPlannerPulse, { toValue: 1, duration: 1700, useNativeDriver: true }),
        Animated.timing(peopleMapPlannerPulse, { toValue: 0, duration: 1700, useNativeDriver: true }),
      ]));
      pulse.start();
    }).catch(() => undefined);
    return () => {
      active = false;
      entrance.stop();
      pulse?.stop();
    };
  }, [peopleMapPlannerEntrance, peopleMapPlannerOpen, peopleMapPlannerPulse]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setActionNoticeRefreshKey((current) => current + 1);
        setLocationRefreshKey((current) => current + 1);
      }
    });
    return () => subscription.remove();
  }, []);
  const lastFeedScrollOffset = useRef(0);
  const pullOffset = useRef(new Animated.Value(0)).current;
  const heroEntrance = useRef(new Animated.Value(0)).current;
  const gasIconScale = useRef(new Animated.Value(1)).current;
  const gasIconShake = useRef(new Animated.Value(0)).current;
  const [loading, setLoading] = useState(!initialFeedSnapshot);
  const [feedReadyForSecondaryReads, setFeedReadyForSecondaryReads] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingPostId, setEditingPostId] = useState("");
  const [detail, setDetail] = useState<CommunityPost | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [photoViewer, setPhotoViewer] = useState<{ images: string[]; index: number; returnToPost: CommunityPost | null } | null>(null);
  const memberProfileSheetRef = useRef<MemberProfileSheetHandle>(null);
  const pendingMemberProfileRef = useRef<MemberProfileTarget | null>(null);
  const pendingMapActionRef = useRef<{ type: "chat"; userId: number } | { type: "housing"; postId: string } | null>(null);
  const pendingPhotoViewerRef = useRef<{ images: string[]; index: number; returnToPost: CommunityPost | null } | null>(null);
  const pendingPhotoReturnRef = useRef<CommunityPost | null>(null);
  const [answer, setAnswer] = useState("");
  const [answerReplyTarget, setAnswerReplyTarget] = useState<{ id: string; name: string } | null>(null);
  const [editingAnswerId, setEditingAnswerId] = useState("");
  const [expandedReplyThreads, setExpandedReplyThreads] = useState<Set<string>>(() => new Set());
  const [guestIdentity, setGuestIdentity] = useState("");
  const [guestRemaining, setGuestRemaining] = useState(6);
  const [guestBenefitsOpen, setGuestBenefitsOpen] = useState(false);
  const pendingGuestAuth = useRef<"signup" | "login" | "">("");
  const [form, setForm] = useState(emptyCommunityPostForm);
  const [listingCity, setListingCity] = useState("");
  const [housingCurrentCity, setHousingCurrentCity] = useState("");
  const [housingMoveAnswer, setHousingMoveAnswer] = useState<"" | "YES" | "NO">("");
  const [housingMoveMonth, setHousingMoveMonth] = useState("");
  const [housingMoveVisible, setHousingMoveVisible] = useState(false);
  const isNewHousingPost = !editingPostId && ["HAVE_PLACE", "NEED_PLACE", "NEED_ROOMMATE"].includes(form.category);
  const housingCitiesDiffer = Boolean(normalizedCityKey(housingCurrentCity) && normalizedCityKey(listingCity)
    && normalizedCityKey(housingCurrentCity) !== normalizedCityKey(listingCity));
  useEffect(() => {
    if (!composerOpen) return;
    setListingCity(groupSuggestionCity);
    setHousingCurrentCity(user?.localCity || "");
    setHousingMoveAnswer("");
    setHousingMoveMonth("");
    setHousingMoveVisible(false);
  }, [composerOpen]);
  useEffect(() => {
    setHousingMoveAnswer("");
    setHousingMoveMonth("");
    setHousingMoveVisible(false);
  }, [listingCity, housingCurrentCity, form.category]);
  const [postValidation, setPostValidation] = useState<{ title?: string; body?: string }>({});
  const fieldExamples = postFieldExamples(form.category);
  const composerLinkPreviewUrl = useMemo(() => communityLinkPreviewUrl(form.linkUrl, form.body), [form.linkUrl, form.body]);
  const composerLinkIsFromField = Boolean(form.linkUrl.trim());
  const [publishing, setPublishing] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(null);
  const [videoUploadPath, setVideoUploadPath] = useState<"preparing" | "direct-r2" | "relay" | null>(null);
  const [communityVideoProgress, setCommunityVideoProgress] = useState<Record<string, number>>({});
  const composerBaselineRef = useRef("");
  const [groupBusyId, setGroupBusyId] = useState("");
  const [expandedReactionTarget, setExpandedReactionTarget] = useState("");
  const [visibleVideoPostIds, setVisibleVideoPostIds] = useState<Set<string>>(() => new Set());
  const onFeedViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ isViewable?: boolean; item: CommunityFeedRow }> }) => {
    const next = new Set<string>();
    for (const item of viewableItems) {
      if (!item.isViewable || item.item.kind !== "post") continue;
      if ((item.item.post.media || []).some((media) => media.type === "VIDEO")) next.add(item.item.post.id);
    }
    setVisibleVideoPostIds((current) => current.size === next.size && [...current].every((id) => next.has(id)) ? current : next);
  }).current;
  const feedVideoViewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;
  const reactionRequests = useRef(new Set<string>());
  const reactionLongPressTarget = useRef("");
  const groupLoadGeneration = useRef(0);
  const feedLoadGeneration = useRef(0);
  const fallbackNationalOffset = useRef(0);
  const manualFeedCity = useRef(false);
  const feedCityStorageKey = `fairfares.ask.feed-city.${Number(user?.id || 0) || "guest"}`;
  useEffect(() => { if (!detail) setPhotoViewer(null); }, [detail]);
  const lowestRental = useMemo(() => cars.reduce<Car | null>((lowest, car) => {
    const price = Number(car.daily_price);
    if (!Number.isFinite(price) || price <= 0 || !car.image_url) return lowest;
    return !lowest || price < Number(lowest.daily_price) ? car : lowest;
  }, null), [cars]);
  const communityReviews = useMemo(() => {
    const usable = testimonials.filter((item) => Number(item.rating || 0) >= 4 && String(item.message || "").trim().length > 0);
    return usable.length ? usable.slice(0, 8) : [communityReviewFallback];
  }, [testimonials]);
  const acrossCountryName = locationCountryCodeFromLabel(groupSuggestionCity || city) === "IN" ? "India" : "USA";
  const displayedGasPrice = lowestGasPrice ?? 3.54;
  const peopleDiscoveryMembers = useMemo<FloatingPersonSuggestion[]>(() => {
    const contactIds = new Set(contactSuggestions.map((suggestion) => suggestion.id));
    return [
      ...contactSuggestions.map((suggestion) => ({
        id: suggestion.id,
        name: suggestion.name,
        photoUrl: suggestion.photoUrl,
        tag: "In your contacts",
      })),
      ...peopleSuggestions
        .filter((suggestion) => !contactIds.has(suggestion.id))
        .map((suggestion) => ({
          id: suggestion.id,
          name: suggestion.name,
          photoUrl: suggestion.photoUrl,
          tag: peopleSuggestionTag(suggestion.reason),
          ratingLabel: suggestion.ratingSummary?.count ? suggestion.ratingSummary.label : undefined,
          canDismiss: true,
          sourceSuggestion: suggestion,
        })),
    ].slice(0, floatingPersonPositions.length);
  }, [contactSuggestions, peopleSuggestions]);
  const peopleMapMembers = useMemo<PeopleMapMember[]>(() => {
    if (peopleMapCityPool) {
      const cityPeople = peopleMapCityPool.people.map((person) => ({
        ...person,
        source: "MUTUAL" as const,
        areaTotal: peopleMapCityPool.total,
        companyMatchCount: peopleMapCityPool.companyMatches,
        boosted: person.companyMatch,
      }));
      return [...cityPeople, ...savedContactMapPins.filter((contact) => normalizedCityKey(contact.city) === normalizedCityKey(peopleMapCityPool.city))];
    }
    const contactIds = new Set(contactSuggestions.map((suggestion) => suggestion.id));
    return [
      ...contactSuggestions.map((suggestion) => ({ ...suggestion, source: "CONTACT" as const })),
      ...savedContactMapPins,
      ...peopleSuggestions.filter((suggestion) => !contactIds.has(suggestion.id)).map((suggestion) => ({
        id: suggestion.id,
        name: suggestion.name,
        photoUrl: suggestion.photoUrl,
        city: suggestion.city || "",
        latitude: Number(suggestion.latitude || 0),
        longitude: Number(suggestion.longitude || 0),
        source: "MUTUAL" as const,
      })),
    ];
  }, [contactSuggestions, peopleMapCityPool, peopleSuggestions, savedContactMapPins]);
  const peopleMapIntentCounts = useMemo(() => ({
    needPlace: peopleMapCityPool?.people.filter((person) => person.housingIntent === "NEED_PLACE").length || 0,
    havePlace: peopleMapCityPool?.people.filter((person) => person.housingIntent === "HAVE_PLACE").length || 0,
    roommates: peopleMapCityPool?.people.filter((person) => person.housingIntent === "NEED_ROOMMATE").length || 0,
  }), [peopleMapCityPool]);
  const peopleNetworkPeople = useMemo(() => {
    if (peopleNetworkTab === "FRIENDS") return connections.map((person) => ({ ...person, relationshipLabel: "Connected friend" }));
    if (peopleNetworkTab === "CONTACTS") return contactSuggestions.map((person) => ({ ...person, relationshipLabel: "In your contacts" }));
    const mutualsOnly = peopleNetworkTab === "MUTUALS";
    return peopleSuggestions
      .filter((person) => person.reason.toLowerCase().includes("mutual") === mutualsOnly)
      .map((person) => ({ ...person, relationshipLabel: person.reason }));
  }, [connections, contactSuggestions, peopleNetworkTab, peopleSuggestions]);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !feedReadyForSecondaryReads || loading || refreshing) {
      setRelocationSuggestions([]);
      return () => { cancelled = true; };
    }
    const timer = setTimeout(() => {
      void getRelocationSuggestions()
        .then((suggestions) => { if (!cancelled) setRelocationSuggestions(suggestions); })
        .catch(() => { if (!cancelled) setRelocationSuggestions([]); });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [feedReadyForSecondaryReads, loading, refreshing, user?.id]);

  useEffect(() => {
    if (!user?.id || !feedReadyForSecondaryReads || loading || refreshing) { setConnections([]); return; }
    void getPeopleConnections().then(setConnections).catch(() => setConnections([]));
  }, [feedReadyForSecondaryReads, loading, refreshing, user?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !feedReadyForSecondaryReads || loading || refreshing) {
      setContactSuggestions([]);
      return () => { cancelled = true; };
    }
    const cacheKey = `fairfares:people-contact-suggestions:v1:${user.id}`;
    void AsyncStorage.getItem(cacheKey).then((stored) => {
      if (cancelled || !stored) return;
      try {
        const cached = JSON.parse(stored) as { savedAt?: number; people?: FairFaresContact[] };
        if (Date.now() - Number(cached.savedAt || 0) < 6 * 60 * 60 * 1000 && Array.isArray(cached.people)) setContactSuggestions(cached.people);
      } catch { /* Ignore an invalid local cache. */ }
    });
    const timer = setTimeout(() => {
      void getPeopleContactPool()
        .then((people) => {
          if (cancelled) return;
          setContactSuggestions(people);
          void AsyncStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), people }));
        })
        .catch(() => { if (!cancelled) setContactSuggestions([]); });
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [feedReadyForSecondaryReads, loading, refreshing, user?.id]);

  const dismissPeopleSuggestion = useCallback((suggestion: PeopleSuggestion) => {
    setPeopleSuggestions((current) => current.filter((item) => item.id !== suggestion.id));
    void hidePeopleSuggestion(suggestion.id).catch(() => {
      // A dismissed card stays out of this session even if the device is offline.
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !feedReadyForSecondaryReads || loading || refreshing) {
      setPeopleSuggestions([]);
      return () => { cancelled = true; };
    }
    const cacheKey = `fairfares:people-suggestions:v1:${user.id}`;
    void AsyncStorage.getItem(cacheKey).then((stored) => {
      if (cancelled || !stored) return;
      try {
        const cached = JSON.parse(stored) as { savedAt?: number; people?: PeopleSuggestion[] };
        if (Date.now() - Number(cached.savedAt || 0) < 6 * 60 * 60 * 1000 && Array.isArray(cached.people)) setPeopleSuggestions(cached.people);
      } catch { /* Ignore an invalid local cache. */ }
    });
    const timer = setTimeout(() => {
      void getPeopleSuggestions()
        .then((suggestions) => {
          if (cancelled) return;
          setPeopleSuggestions(suggestions);
          void AsyncStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), people: suggestions }));
        })
        .catch(() => { if (!cancelled) setPeopleSuggestions([]); });
    }, 850);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [feedReadyForSecondaryReads, loading, refreshing, user?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !feedReadyForSecondaryReads || loading || refreshing) return () => { cancelled = true; };

    const timer = setTimeout(() => {
      // These power a helpful banner, not the first paint of Ask. Starting
      // all three account-heavy reads together made a cold launch contend
      // with bootstrap, the community feed, and Chitthi on the same SQLite
      // service. Keep the priority (rental, housing, then carpool) but make
      // the reads cooperative and leave the feed fully usable while they run.
      void (async () => {
        const [rentalResult] = await Promise.allSettled([getRentalBookings()]);
        const [housingResult] = await Promise.allSettled([getHousingActivity()]);
        const [rideResult] = await Promise.allSettled([getRideActivity()]);
        return [rideResult, rentalResult, housingResult] as const;
      })().then(([rideResult, rentalResult, housingResult]) => {
        if (cancelled) return;
        const rides = rideResult.status === "fulfilled" ? rideResult.value : [] as RidePost[];
        const bookings = rentalResult.status === "fulfilled" ? rentalResult.value : [] as RentalServiceBooking[];
        const housingPosts = housingResult.status === "fulfilled" ? housingResult.value : [] as HousingActivityPost[];
        const actionableBooking = bookings.find((booking) => booking.status === "PICKUP_SUBMITTED" && booking.handoff?.pickupAcceptanceStatus === "PENDING")
        || bookings.find((booking) => booking.status === "RETURN_SUBMITTED" && booking.handoff?.returnReviewStatus === "CHARGES_PENDING")
        || bookings.find((booking) => booking.status === "PICKED_UP" && booking.extensionPaymentStatus === "PENDING" && Number(booking.extensionPaymentDue || 0) > 0)
        || bookings.find((booking) => ["MODIFIED", "CANCELLATION_REQUESTED"].includes(booking.status))
        || bookings.find((booking) => booking.status === "CONFIRMED" && booking.paymentStatus === "HOLD_PAID")
        || bookings.find((booking) => booking.status === "CONFIRMED" && booking.paymentStatus === "PAID" && booking.depositStatus !== "AUTHORIZED")
        || bookings.find((booking) => booking.status === "PICKED_UP" && booking.paymentStatus === "PAID")
        || bookings.find((booking) => booking.status === "CONFIRMED" && booking.paymentStatus === "PAID" && booking.depositStatus === "AUTHORIZED");

        if (actionableBooking) {
        const pickupReview = actionableBooking.status === "PICKUP_SUBMITTED" && actionableBooking.handoff?.pickupAcceptanceStatus === "PENDING";
        const returnReview = actionableBooking.status === "RETURN_SUBMITTED" && actionableBooking.handoff?.returnReviewStatus === "CHARGES_PENDING";
        const extensionDue = actionableBooking.extensionPaymentStatus === "PENDING" && Number(actionableBooking.extensionPaymentDue || 0) > 0;
        const modificationReview = actionableBooking.status === "MODIFIED";
        const cancellationReview = actionableBooking.status === "CANCELLATION_REQUESTED";
        const balanceDue = actionableBooking.paymentStatus === "HOLD_PAID";
        const depositDue = actionableBooking.paymentStatus === "PAID" && actionableBooking.depositStatus !== "AUTHORIZED";
        const rentalInProgress = actionableBooking.status === "PICKED_UP";
        const amount = extensionDue
          ? actionableBooking.extensionPaymentDueLabel || "approved amount"
          : balanceDue
            ? actionableBooking.dueAtPickupLabel || "remaining balance"
            : `$${Number(actionableBooking.depositAmount || 250).toFixed(2)}`;
        setActionNotice({
          id: `rental:${actionableBooking.id}:${actionableBooking.paymentStatus}:${actionableBooking.depositStatus || ""}:${actionableBooking.extensionPaymentStatus || ""}:${actionableBooking.handoff?.returnReviewStatus || ""}`,
          icon: pickupReview ? "📋" : returnReview ? "⚠️" : extensionDue ? "↗" : modificationReview || cancellationReview ? "⏳" : balanceDue ? "💳" : depositDue ? "🔒" : rentalInProgress ? "⏱" : "🚗",
          eyebrow: pickupReview ? "Pickup condition ready" : returnReview ? "Return review in progress" : extensionDue ? "Approved rental extension" : modificationReview ? "Rental modification review" : cancellationReview ? "Rental cancellation review" : balanceDue ? "Complete rental payment" : depositDue ? "Optional refundable deposit" : rentalInProgress ? "Rental in progress" : "Rental ready",
          title: pickupReview ? "Review pickup condition" : returnReview ? "Return review in progress" : extensionDue ? `Pay ${amount} to complete your extension` : modificationReview ? "Your rental changes are under review" : cancellationReview ? "Your cancellation request is under review" : balanceDue ? `Pay full remaining amount: ${amount}` : depositDue ? `Optional ${amount} refundable deposit` : rentalInProgress ? "Need more time with your rental?" : "Your rental is ready for pickup",
          body: pickupReview ? "Staff recorded vehicle photos and existing condition. Review and e-sign before the vehicle is released." : returnReview ? "Staff recorded return evidence. FairFares is reviewing the deposit outcome; you can view the photos and notes." : extensionDue ? "Your new return window is reserved. Complete secure payment to confirm it." : modificationReview ? "Your current booking remains reserved while FairFares reviews the requested changes." : cancellationReview ? "Your current booking remains reserved while FairFares reviews your cancellation request." : balanceDue ? "Your 10% hold secured the booking. Complete the full payment before pickup." : depositDue ? "Your rental is paid in full. This card authorization is optional and does not block identity verification, pickup, or return." : rentalInProgress ? "Extend the return time before the current return deadline. We will check availability first." : "Payment and the refundable deposit are complete. View pickup details; documents unlock after pickup.",
          actionLabel: pickupReview ? "Review & sign" : returnReview ? "View return details" : extensionDue ? "Pay extension" : modificationReview || cancellationReview ? "Manage rental" : balanceDue ? "Pay full amount" : depositDue ? "Optional deposit" : rentalInProgress ? "Extend rental" : "Manage rental",
          action: "rental",
          bookingId: actionableBooking.id,
          rentalAction: pickupReview ? "pickup" : returnReview ? "returnReview" : extensionDue ? "extension" : modificationReview || cancellationReview ? "manage" : balanceDue ? "balance" : depositDue ? "deposit" : rentalInProgress ? "extendRequest" : "manage",
        });
          return;
        }

        const housingInquiry = housingPosts.find((post) => (
        post.status === "ACTIVE"
        && post.expiryLabel !== "Expired"
        && Number(post.unreadInquiryCount || 0) > 0
        && Number(post.latestInquiryUserId || 0) > 0
      ));
        if (housingInquiry) {
        const inquiryCount = Number(housingInquiry.unreadInquiryCount || 0);
        setActionNotice({
          id: `housing:${housingInquiry.id}:${inquiryCount}:${housingInquiry.latestInquiryUserId}`,
          icon: "🏠",
          eyebrow: "Housing inquiry",
          title: inquiryCount === 1 ? "You have a new housing inquiry" : `You have ${inquiryCount} new housing inquiries`,
          body: `${housingInquiry.title} · ${housingInquiry.location}`,
          actionLabel: "Open Chitthi",
          action: "housing",
          housingPostId: housingInquiry.id,
          housingInquiryUserId: housingInquiry.latestInquiryUserId,
        });
          return;
        }

        const pendingDriverRequest = rides.find((item) => {
        const status = String(item.dispatchStatus || item.status || "").toUpperCase();
        return item.activityRole === "DRIVER_NOTIFICATION" && ["PENDING", "REQUESTED", "MATCHING", "ACTIVE", "OPEN"].includes(status);
      });
      const ride = pendingDriverRequest || rides.find((item) => ["ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"].includes(String(item.dispatchStatus || item.status || "").toUpperCase()));
        if (!ride) {
        // Keep the cached notice while the screen remounts, but remove it
        // once both live sources confirm there is no longer an action.
        if (rideResult.status === "fulfilled" && rentalResult.status === "fulfilled" && housingResult.status === "fulfilled") setActionNotice(null);
          return;
        }
      const status = String(ride.dispatchStatus || ride.status || "").toUpperCase();
      const incomingRequest = ride.activityRole === "DRIVER_NOTIFICATION" && ["PENDING", "REQUESTED", "MATCHING", "ACTIVE", "OPEN"].includes(status);
      const driverTrip = ride.activityRole === "DRIVER_NOTIFICATION";
      const rideTitle = incomingRequest
        ? "A rider is waiting for your response"
        : driverTrip && status === "ACCEPTED"
          ? "Your rider is confirmed"
          : driverTrip && status === "EN_ROUTE"
            ? "Continue to rider pickup"
            : driverTrip && status === "ARRIVED"
              ? "Your rider is at pickup"
              : status === "ACCEPTED"
                ? "Your ride was accepted"
                : status === "EN_ROUTE"
                  ? "Your driver is on the way"
                  : status === "ARRIVED"
                    ? "Your driver has arrived"
                    : "Your ride is in progress";
        setActionNotice({
        id: `ride:${ride.id}:${status}:${incomingRequest ? "incoming" : "trip"}`,
        icon: incomingRequest ? "🙋" : "🚗",
        eyebrow: incomingRequest ? "Carpool request" : driverTrip ? "Carpool trip" : "Ride update",
        title: rideTitle,
        body: `${ride.origin || "Pickup"} → ${ride.destination || "Destination"}`,
        actionLabel: incomingRequest ? "Review request" : driverTrip ? "Manage ride" : "Review ride",
        action: incomingRequest ? "ride-request" : "ride",
        rideId: ride.id,
        });
      });
    }, 2_500);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [actionNoticeRefreshKey, feedReadyForSecondaryReads, loading, refreshing, user?.id]);

  const setActionNoticeVisibility = useCallback((visible: boolean) => {
    if (actionNoticeVisible.current === visible) return;
    actionNoticeVisible.current = visible;
    Animated.timing(actionNoticeMotion, { toValue: visible ? 1 : 0, duration: visible ? 220 : 180, useNativeDriver: false }).start();
  }, [actionNoticeMotion]);

  const dismissActionNotice = useCallback((noticeId: string) => {
    actionNoticeVisible.current = false;
    Animated.timing(actionNoticeMotion, { toValue: 0, duration: 280, useNativeDriver: false }).start(({ finished }) => {
      if (finished) setActionNotice((current) => current?.id === noticeId ? null : current);
    });
  }, [actionNoticeMotion]);

  useEffect(() => {
    if (!actionNotice) {
      actionNoticeVisible.current = false;
      actionNoticeMotion.setValue(0);
      return undefined;
    }
    actionNoticeMotion.stopAnimation();
    actionNoticeMotion.setValue(0);
    actionNoticeVisible.current = false;
    setActionNoticeVisibility(true);
    return undefined;
  }, [actionNotice?.id, actionNoticeMotion, setActionNoticeVisibility]);

  const handleFeedScroll = useCallback((offset: number) => {
    const currentOffset = Math.max(0, offset);
    const delta = currentOffset - lastFeedScrollOffset.current;
    if (Math.abs(delta) >= 8) {
      setActionNoticeVisibility(delta < 0 || currentOffset <= 0);
      lastFeedScrollOffset.current = currentOffset;
    }
  }, [setActionNoticeVisibility]);

  const openMemberProfile = useCallback((author: MemberProfileTarget) => {
    if (!author.id) return;
    // iOS cannot reliably present the member modal over the page-sheet post
    // modal. Dismiss the post first, then present the member profile from the
    // root screen in the post modal's onDismiss callback.
    if (Platform.OS === "ios" && detail) {
      pendingMemberProfileRef.current = author;
      setDetail(null);
      return;
    }
    memberProfileSheetRef.current?.open(author);
  }, [detail]);

  const findPeopleFromContacts = useCallback(async () => {
    if (!user?.id) {
      onRequireLogin();
      return false;
    }
    if (Platform.OS === "web" || !(await Contacts.isAvailableAsync())) {
      Alert.alert("Contacts unavailable", "Contact matching is available in the FairFares Android and iOS apps.");
      return false;
    }
    setContactSuggestionsLoading(true);
    try {
      let permission = await Contacts.getPermissionsAsync();
      if (permission.status !== "granted" && permission.canAskAgain) permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Allow Contacts access", "Allow Contacts to find FairFares members you already know. Your phone numbers are matched as hashes, not uploaded as an address book.");
        return false;
      }
      const response = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Addresses, Contacts.Fields.Image],
        sort: Contacts.SortTypes.FirstName,
      });
      const phoneHashes = new Set<string>();
      response.data.forEach((contact) => {
        (contact.phoneNumbers || []).forEach((entry) => {
          contactDiscoveryVariants(String(entry.number || "")).forEach((value) => phoneHashes.add(contactDiscoveryHash(value)));
        });
      });
      const contactCities = new Map<string, { id: string; name: string; photoUrl: string; city: string }>();
      response.data.forEach((contact) => {
        const address = (contact.addresses || []).find((item) => String(item.city || "").trim());
        const city = String(address?.city || "").trim();
        const region = String(address?.region || "").trim();
        const label = normalizedLocationLabel(region ? `${city}, ${region}` : city);
        if (!contact.id || !city || !label || contactCities.has(contact.id)) return;
        contactCities.set(contact.id, { id: contact.id, name: String(contact.name || "Contact"), photoUrl: String(contact.image?.uri || ""), city: label });
      });
      const coordinateEntries = await Promise.all([...new Set([...contactCities.values()].map((contact) => contact.city))].slice(0, 40).map(async (city) => {
        const [point] = await Location.geocodeAsync(city).catch(() => []);
        return [city, point ? { latitude: point.latitude, longitude: point.longitude } : null] as const;
      }));
      const coordinates = new Map(coordinateEntries);
      setSavedContactMapPins([...contactCities.values()].flatMap((contact, index) => {
        const point = coordinates.get(contact.city);
        return point ? [{ id: -(index + 1), name: contact.name, photoUrl: contact.photoUrl, city: contact.city, latitude: point.latitude, longitude: point.longitude, source: "SAVED_CONTACT" as const, savedContactAddress: true }] : [];
      }));
      if (!phoneHashes.size) {
        setContactSuggestions([]);
        setContactSuggestionsChecked(true);
        return true;
      }
      const peopleById = new Map<number, { id: number; name: string; photoUrl: string; city: string; latitude: number; longitude: number }>();
      const hashes = Array.from(phoneHashes);
      for (let offset = 0; offset < hashes.length; offset += 5000) {
        const found = await findChatPeopleByContactHashes(hashes.slice(offset, offset + 5000));
        found.people.forEach((person) => peopleById.set(person.id, { id: person.id, name: person.name, photoUrl: person.photoUrl, city: person.city || "", latitude: Number(person.latitude || 0), longitude: Number(person.longitude || 0) }));
      }
      const matches = Array.from(peopleById.values()).sort((left, right) => left.name.localeCompare(right.name));
      setContactSuggestions(matches);
      setContactSuggestionsChecked(true);
      if (!matches.length) Alert.alert("No FairFares contacts yet", "We couldn't find a FairFares member in your contacts. You can refresh later.");
      return true;
    } catch (error) {
      Alert.alert("Contact search failed", error instanceof Error ? error.message : "Could not check your contacts.");
      return false;
    } finally {
      setContactSuggestionsLoading(false);
    }
  }, [onRequireLogin, user?.id]);

  const openPeopleMap = useCallback(async () => {
    if (!user?.id) { onRequireLogin(); return; }
    setRelocationCityDraft(user.localCity || user.relocationCity || groupSuggestionCity);
    setRelocationCompanyDraft(user.relocationCompany || "");
    setPeopleMapListOpen(false);
    setPeopleMapPlannerOpen(true);
    setPeopleMapOpen(true);
    setPeopleMapInitialFocus(null);
    const initialCity = user.localCity || user.relocationCity || groupSuggestionCity;
    if (initialCity) {
      try {
        const area = await getPeopleMapCityPool(normalizedLocationLabel(initialCity));
        setPeopleMapInitialFocus({ latitude: area.latitude, longitude: area.longitude });
      } catch { /* Keep search available when the initial city cannot resolve. */ }
    }
  }, [user?.id, user?.localCity, user?.relocationCity, user?.relocationCompany, groupSuggestionCity, onRequireLogin]);

  const openPostPhoto = (post: CommunityPost, images: string[], index: number) => {
    const openedFromPostSheet = detail?.id === post.id;
    const viewer = { images, index, returnToPost: openedFromPostSheet ? post : null };
    // The Community post is an iOS page sheet. Present the full-screen photo
    // only after that sheet is gone, just as we do for a member profile.
    if (Platform.OS === "ios" && openedFromPostSheet) {
      pendingPhotoViewerRef.current = viewer;
      setDetail(null);
      return;
    }
    setPhotoViewer(viewer);
  };

  const load = useCallback(async (quiet = false) => {
    const requestedFeedGeneration = feedLoadGeneration.current + 1;
    feedLoadGeneration.current = requestedFeedGeneration;
    fallbackNationalOffset.current = 0;
    setLoadingMore(false);
    const snapshotKey = communityFeedSnapshotKey(Number(user?.id || 0), groupSuggestionCity, category, appliedQuery, selectedGroup);
    const cached = communityFeedSnapshots.get(snapshotKey);
    if (cached) {
      setPosts(cached.posts);
      setNationalPosts(cached.nationalPosts);
      setLocalHasMore(cached.localHasMore);
      setNationalHasMore(cached.nationalHasMore);
    }
    if (!quiet) setLoading(!cached);
    try {
      // Communities can be noticeably slower than the feed in production.
      // Load them independently so a slow Chitthi request never freezes Ask.
      const requestedGroupGeneration = groupLoadGeneration.current + 1;
      groupLoadGeneration.current = requestedGroupGeneration;
      void previewOrFallback(getChatCommunities(groupSuggestionCity), [] as Community[], 10000)
        .then((communityRows) => {
          if (groupLoadGeneration.current !== requestedGroupGeneration) return;
          const visibleGroups = (communityRows || []).filter((group) => group.joined || group.visibility === "PUBLIC");
          setGroups(visibleGroups);
          communityGroupSnapshots.set(normalizedLocationLabel(groupSuggestionCity).toLocaleLowerCase(), visibleGroups);
        })
        .catch(() => undefined);
      const feed = await previewOrFallback(
        getCommunityFeed({ q: appliedQuery, city: groupSuggestionCity, category: category === "ALL" ? "" : category, communityId: selectedGroup, layered: !selectedGroup, limit: 30 }),
        { ok: true, posts: [] as CommunityPost[], pagination: { hasMore: false } },
        10000,
      );
      if (feedLoadGeneration.current !== requestedFeedGeneration) return;
      const nextPosts = feed.sections?.local?.posts || feed.posts || [];
      let nextNationalPosts: CommunityPost[] = [];
      let nextLocalHasMore = false;
      let nextNationalHasMore = false;
      setPosts(nextPosts);
      if (feed.sections) {
        nextNationalPosts = feed.sections.national?.posts || [];
        nextLocalHasMore = Boolean(feed.sections.local?.hasMore);
        nextNationalHasMore = Boolean(feed.sections.national?.hasMore);
      } else if (!selectedGroup) {
        const nationwide = await previewOrFallback(
          getCommunityFeed({ q: appliedQuery, category: category === "ALL" ? "" : category, limit: 30 }),
          { ok: true, posts: [] as CommunityPost[], pagination: { hasMore: false } },
          10000,
        );
        if (feedLoadGeneration.current !== requestedFeedGeneration) return;
        fallbackNationalOffset.current = nationwide.posts?.length || 0;
        const localIds = new Set((feed.posts || []).map((post) => post.id));
        const selectedCountry = locationCountryCodeFromLabel(groupSuggestionCity) || "US";
        nextNationalPosts = (nationwide.posts || []).filter((post) => isActivePublicCountryPost(post, groupSuggestionCity, localIds, selectedCountry));
        nextLocalHasMore = Boolean(feed.pagination?.hasMore);
        nextNationalHasMore = Boolean(nationwide.pagination?.hasMore);
      } else {
        nextLocalHasMore = Boolean(feed.pagination?.hasMore);
      }
      setNationalPosts(nextNationalPosts);
      setLocalHasMore(nextLocalHasMore);
      setNationalHasMore(nextNationalHasMore);
      communityFeedSnapshots.set(snapshotKey, { posts: nextPosts, nationalPosts: nextNationalPosts, localHasMore: nextLocalHasMore, nationalHasMore: nextNationalHasMore, updatedAt: Date.now() });
    } catch { if (feedLoadGeneration.current === requestedFeedGeneration) { setPosts([]); setNationalPosts([]); setLocalHasMore(false); setNationalHasMore(false); } }
    finally { if (feedLoadGeneration.current === requestedFeedGeneration) { setLoading(false); setRefreshing(false); setFeedReadyForSecondaryReads(true); } }
  }, [appliedQuery, category, city, groupSuggestionCity, selectedGroup, user?.id]);

  useEffect(() => {
    // Resolve the persisted city before asking the API for a feed. Previously
    // a returning member could start one full local/national feed request for
    // the profile city and immediately start another for their saved Ask city.
    // That duplicate work was visible as a slower Ask opening.
    if (!feedCityPreferenceReady) return;
    void load();
  }, [feedCityPreferenceReady, load]);
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
        // Use a pronounced zoom (1 → 3) while
        // transforming only the glyph layer; the fixed icon slot/card never
        // changes size or participates in layout.
        Animated.spring(gasIconScale, { toValue: 2.6, damping: 8, stiffness: 190, mass: 0.65, useNativeDriver: true }),
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
    manualFeedCity.current = false;
    setFeedCityPreferenceReady(false);
    void AsyncStorage.getItem(feedCityStorageKey).then((storedCity) => {
      if (cancelled) return;
      const normalized = normalizedLocationLabel(storedCity || "");
      if (normalized && normalizedCityKey(normalized)) {
        manualFeedCity.current = true;
        setGroupSuggestionCity(normalized);
      }
    }).catch(() => undefined).finally(() => {
      if (!cancelled) setFeedCityPreferenceReady(true);
    });
    return () => { cancelled = true; };
  }, [feedCityStorageKey]);
  useEffect(() => {
    let cancelled = false;
    if (!feedCityPreferenceReady || manualFeedCity.current) return () => { cancelled = true; };
    const fallbackCity = normalizedLocationLabel(city);
    if (fallbackCity) setGroupSuggestionCity(fallbackCity);
    if (Platform.OS === "web") return () => { cancelled = true; };
    setLocationResolving(true);
    void (async () => {
      try {
        if (!fallbackCity) {
          const cached = await readCachedDeviceCity();
          const cachedCity = normalizedLocationLabel(cached?.city || "");
          if (cachedCity && !cancelled && !manualFeedCity.current) setGroupSuggestionCity(cachedCity);
        }
        const result = await resolveCurrentDeviceCity({ allowCachedFallback: true });
        if (!result || cancelled) return;
        setGasPreviewCoordinates({ latitude: result.latitude, longitude: result.longitude });
        const currentCity = normalizedLocationLabel(result.city);
        if (currentCity) {
          if (!manualFeedCity.current) setGroupSuggestionCity(currentCity);
          if (user?.id) void recordCurrentCityObservation(currentCity).catch(() => undefined);
        }
      } catch {
        // The selected feed city remains the fallback when device location is unavailable.
      } finally {
        if (!cancelled) setLocationResolving(false);
      }
    })();
    return () => { cancelled = true; };
  }, [city, feedCityPreferenceReady, locationRefreshKey, user?.id]);
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
    // opened. GasStationsScreen resolves the device location before writing
    // this cache, so applying a second radius check here can incorrectly
    // discard the valid result when the next GPS fix drifts. Housing and Ask
    // city selections never write this device-scoped cache.
    setLowestGasPrice(null);
    // The home card is a last-reported teaser. Keep it stable for an hour;
    // opening Cheap Gas still uses the stricter ten-minute freshness window.
    void readGasCache("regular", undefined, 5, 60 * 60 * 1000).then((result) => {
      if (cancelled) return;
      const prices = (result?.stations || [])
        .map((station) => Number(station.price))
        .filter((price) => Number.isFinite(price) && price > 0);
      setLowestGasPrice(prices.length ? Math.min(...prices) : null);
    });
    return () => { cancelled = true; };
  }, [gasPriceRefreshKey, locationRefreshKey, user?.id]);
  useEffect(() => {
    if (!cityPickerOpen || cityDraft.trim().length < 2) { setCityOptions([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      setCityOptionsLoading(true);
      void getAccommodationLocationOptions(cityDraft.trim()).then((result) => {
        if (cancelled) return;
        const requestedParts = cityDraft.split(",").map((part) => part.trim()).filter(Boolean);
        const requestedCity = requestedParts[0]?.toLocaleLowerCase() || "";
        const requestedKey = normalizedCityKey(cityDraft);
        const requestedRegion = requestedKey.split(",")[1] || "";
        const options = (result?.cities || [])
          .map(normalizedLocationLabel)
          .filter((value) => Boolean(normalizedCityKey(value)))
          .filter((value) => normalizedCityKey(value).split(",")[0].startsWith(requestedCity))
          .filter((value) => !requestedRegion || normalizedCityKey(value).split(",")[1] === requestedRegion)
          .filter((value, index, values) => value && values.indexOf(value) === index)
          .slice(0, 8);
        setCityOptions(options);
      }).finally(() => { if (!cancelled) setCityOptionsLoading(false); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cityDraft, cityPickerOpen]);

  useEffect(() => {
    if ((!relocationPlannerOpen && !peopleMapPlannerOpen) || relocationCityDraft.trim().length < 2) {
      setRelocationCityOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setRelocationCityOptionsLoading(true);
      void getAccommodationLocationOptions(relocationCityDraft.trim()).then((result) => {
        if (cancelled) return;
        const requestedCity = relocationCityDraft.split(",")[0]?.trim().toLocaleLowerCase() || "";
        const options = (result?.cities || [])
          .map(normalizedLocationLabel)
          .filter((value) => Boolean(normalizedCityKey(value)))
          .filter((value) => normalizedCityKey(value).split(",")[0].startsWith(requestedCity))
          .filter((value, index, values) => value && values.indexOf(value) === index)
          .slice(0, 6);
        setRelocationCityOptions(options);
      }).finally(() => { if (!cancelled) setRelocationCityOptionsLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [peopleMapPlannerOpen, relocationCityDraft, relocationPlannerOpen]);

  useEffect(() => {
    if (relocationPlannerOpen || peopleMapPlannerOpen) return;
    setRelocationCityDraft(user?.relocationCity || "");
    setRelocationMonthDraft(user?.relocationCity ? user.relocationMonth || "" : "");
    setRelocationCompanyDraft(user?.relocationCity ? user.relocationCompany || "" : "");
    setRelocationReasonDraft(user?.relocationCity ? user.relocationReason || "" : "");
  }, [peopleMapPlannerOpen, relocationPlannerOpen, user?.id, user?.relocationCity, user?.relocationCompany, user?.relocationMonth, user?.relocationReason]);

  const searchPeopleMap = useCallback(async () => {
    if (!user?.id) { onRequireLogin(); return; }
    const query = relocationCityDraft.trim();
    if (!query) { Alert.alert("Choose a city", "Enter a city such as Denver or Centennial, CO."); return; }
    setRelocationSaving(true);
    try {
      const options = await getAccommodationLocationOptions(query).catch(() => null);
      const destination = (options?.cities || []).map(normalizedLocationLabel).find(
        (value) => value.split(",")[0].trim().toLocaleLowerCase() === query.split(",")[0].trim().toLocaleLowerCase()
          && (!query.includes(",") || value.toLocaleLowerCase() === normalizedLocationLabel(query).toLocaleLowerCase())
      ) || normalizedLocationLabel(query);
      const pool = await getPeopleMapCityPool(destination, relocationCompanyDraft.trim());
      if (!pool.latitude && !pool.longitude) throw new Error("City not found. Choose a city and state from the suggestions.");
      setPeopleMapCityPool(pool);
      setPeopleMapCompany(relocationCompanyDraft.trim());
      setPeopleMapListOpen(false);
      setPeopleMapPlannerOpen(false);
    } catch (error) {
      Alert.alert("Could not load city", error instanceof Error ? error.message : "Please try again.");
    } finally { setRelocationSaving(false); }
  }, [onRequireLogin, relocationCityDraft, relocationCompanyDraft, user?.id]);

  const loadMoreMapPeople = async () => {
    if (!peopleMapCityPool || peopleMapCityPool.nextOffset == null || peopleMapMoreBusy) return;
    const pool = peopleMapCityPool;
    setPeopleMapMoreBusy(true);
    try {
      const next = await getPeopleMapCityPool(pool.city, peopleMapCompany, pool.nextOffset ?? 0);
      setPeopleMapCityPool((current) => current === pool ? {
        ...next, people: [...pool.people, ...next.people.filter((person) => !pool.people.some((existing) => existing.id === person.id))],
      } : current);
    } catch (error) {
      Alert.alert("Could not load more people", error instanceof Error ? error.message : "Please try again.");
    } finally { setPeopleMapMoreBusy(false); }
  };

  const loadPeopleForMapViewport = useCallback(async (region: PeopleMapRegion) => {
    if (!peopleMapOpen || !user?.id || peopleMapPlannerOpen || region.latitudeDelta > 3 || region.longitudeDelta > 3) return;
    const viewportKey = `${region.latitude.toFixed(2)},${region.longitude.toFixed(2)}`;
    if (viewportKey === peopleMapViewportKeyRef.current) return;
    peopleMapViewportKeyRef.current = viewportKey;
    const requestId = peopleMapViewportRequestRef.current + 1;
    peopleMapViewportRequestRef.current = requestId;
    try {
      const [address] = await Location.reverseGeocodeAsync({ latitude: region.latitude, longitude: region.longitude });
      const city = String(address?.city || address?.subregion || "").trim();
      const state = String(address?.region || "").trim();
      if (!city) return;
      const destination = normalizedLocationLabel(state ? `${city}, ${state}` : city);
      if (!destination || normalizedCityKey(destination) === normalizedCityKey(peopleMapCityPool?.city || "")) return;
      const pool = await getPeopleMapCityPool(destination, peopleMapCompany);
      if (peopleMapViewportRequestRef.current !== requestId) return;
      setPeopleMapCityPool(pool);
      setPeopleMapListOpen(false);
    } catch {
      // The map remains usable if reverse geocoding is unavailable; a city can
      // still be chosen directly from the search sheet.
    }
  }, [peopleMapCityPool?.city, peopleMapCompany, peopleMapOpen, peopleMapPlannerOpen, user?.id]);

  const closePeopleMap = useCallback(() => {
    // Invalidate reverse-geocoding and city-pool work started by the map before
    // the page-sheet closes, so it cannot update the Ask screen afterward.
    peopleMapViewportRequestRef.current += 1;
    peopleMapViewportKeyRef.current = "";
    setPeopleMapListOpen(false);
    setPeopleMapPlannerOpen(false);
    setPeopleMapMember(null);
    setPeopleMapMemberProfile(null);
    setPeopleMapMemberLoading(false);
    peopleMapMemberRequestRef.current += 1;
    setPeopleMapOpen(false);
  }, []);

  const openMapMemberProfile = useCallback((member: MemberProfileTarget) => {
    if (!member.id) return;
    // Keep the card inside the existing map page-sheet. Presenting another
    // native modal above it can leave iOS with a black, unresponsive screen.
    const requestId = peopleMapMemberRequestRef.current + 1;
    peopleMapMemberRequestRef.current = requestId;
    setPeopleMapMember(member);
    setPeopleMapMemberProfile({ id: member.id, name: member.name, photoUrl: member.photoUrl, listings: [] });
    setPeopleMapMemberLoading(true);
    void getCommunityUserProfile(member.id).then((profile) => {
      if (peopleMapMemberRequestRef.current === requestId) setPeopleMapMemberProfile(profile);
    }).catch(() => {
      // The immediately-visible member card remains useful even when profile
      // details are briefly unavailable.
    }).finally(() => {
      if (peopleMapMemberRequestRef.current === requestId) setPeopleMapMemberLoading(false);
    });
  }, []);

  const openMapChat = useCallback(() => {
    if (!peopleMapMember?.id) return;
    pendingMapActionRef.current = { type: "chat", userId: peopleMapMember.id };
    closePeopleMap();
  }, [closePeopleMap, peopleMapMember?.id]);

  const openMapListing = useCallback((postId: string) => {
    pendingMapActionRef.current = { type: "housing", postId };
    closePeopleMap();
  }, [closePeopleMap]);

  const handlePeopleMapDismiss = useCallback(() => {
    const action = pendingMapActionRef.current;
    pendingMapActionRef.current = null;
    if (!action) return;
    requestAnimationFrame(() => {
      if (action.type === "chat") onOpenUserChat(action.userId);
      else onOpenHousing(action.postId);
    });
  }, [onOpenHousing, onOpenUserChat]);

  const saveRelocationPlan = useCallback(async () => {
    if (!user?.id) {
      onRequireLogin();
      return;
    }
    const destination = relocationCityDraft.trim();
    if (!destination) {
      Alert.alert("Add a destination", "Choose the city you are moving to before turning on relocation connections.");
      return;
    }
    if (!relocationReasonDraft) {
      Alert.alert("Why are you moving?", "Choose the reason that best fits your move so we can prioritize the right people.");
      return;
    }
    setRelocationSaving(true);
    try {
      const result = await updateMobileProfile({
        relocationCity: destination,
        relocationMonth: relocationMonthDraft.trim(),
        relocationCompany: relocationCompanyDraft.trim(),
        relocationReason: relocationReasonDraft,
        relocationDiscoverable: true,
      });
      onProfileUpdated(result.user);
      const [suggestions, mapPool] = await Promise.all([
        getRelocationSuggestions().catch(() => []),
        getPeopleMapCityPool(destination, relocationCompanyDraft.trim()),
      ]);
      setRelocationSuggestions(suggestions);
      setPeopleMapCityPool(mapPool);
      setRelocationPlannerOpen(false);
      setPeopleMapPlannerOpen(false);
    } catch (error) {
      Alert.alert("Could not load relocation connections", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setRelocationSaving(false);
    }
  }, [onProfileUpdated, onRequireLogin, relocationCityDraft, relocationCompanyDraft, relocationMonthDraft, relocationReasonDraft, user?.id]);

  const chooseFeedCity = (value: string) => {
    const nextCity = normalizedLocationLabel(value);
    if (!normalizedCityKey(nextCity)) {
      Alert.alert("Choose a city and state", "Select a suggestion or enter a location such as Denver, CO or Kamareddy, Telangana, India.");
      return;
    }
    manualFeedCity.current = true;
    setSelectedGroup("");
    setGroupSuggestionCity(nextCity);
    setCityPickerOpen(false);
    void AsyncStorage.setItem(feedCityStorageKey, nextCity);
  };

  const useCurrentFeedLocation = async () => {
    if (Platform.OS === "web") return;
    const granted = await requestUserLocationPermission({
      title: "Location needed",
      requestMessage: "Allow location to show posts and groups near your current city.",
      settingsMessage: "Enable location for FairFares in Settings to show posts and groups near your current city.",
    });
    if (!granted) return;
    setLocationResolving(true);
    try {
      const result = await resolveCurrentDeviceCity({ allowCachedFallback: true });
      if (!result) {
        Alert.alert("Location unavailable", "We couldn't detect your current location. Try again or enter your city manually.");
        return;
      }
      const currentCity = normalizedLocationLabel(result.city);
      if (!currentCity) {
        Alert.alert("Location unavailable", "We couldn't detect your city. Try again or enter your city manually.");
        return;
      }
      manualFeedCity.current = false;
      setSelectedGroup("");
      setGasPreviewCoordinates({ latitude: result.latitude, longitude: result.longitude });
      setGroupSuggestionCity(currentCity);
      setCityPickerOpen(false);
      void AsyncStorage.removeItem(feedCityStorageKey);
    } catch {
      Alert.alert("Location unavailable", "We couldn't detect your current location. Try again or enter your city manually.");
    } finally {
      setLocationResolving(false);
    }
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
  useEffect(() => {
    setEditingAnswerId("");
    setAnswerReplyTarget(null);
    setAnswer("");
  }, [detail?.id]);

  const composerFingerprint = (value: typeof form) => JSON.stringify(value);

  const discardCommunityComposer = () => {
    const emptyForm = emptyCommunityPostForm();
    composerBaselineRef.current = composerFingerprint(emptyForm);
    setForm(emptyForm);
    setPostValidation({});
    setEditingPostId("");
    setComposerOpen(false);
  };

  const requestCommunityComposerClose = () => {
    if (publishing) return;
    const changed = Boolean(composerBaselineRef.current)
      && composerFingerprint(form) !== composerBaselineRef.current;
    if (!changed) {
      discardCommunityComposer();
      return;
    }
    Alert.alert(
      editingPostId ? "Discard post changes?" : "Discard this post?",
      editingPostId ? "Your unsaved changes will be lost." : "Your unfinished post will be lost.",
      [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: discardCommunityComposer },
      ],
    );
  };

  const openCommunityPostEditor = (post: CommunityPost) => {
    const editorForm = {
      type: post.type,
      category: post.category,
      title: post.title,
      body: post.body,
      area: post.area,
      linkUrl: post.linkUrl,
      communityId: post.community?.id || "",
      media: [...(post.media || post.images.map((url) => ({ url, type: "IMAGE" as const })))],
      details: { ...emptyDetails, ...post.details },
      expiresInDays: 45,
    };
    composerBaselineRef.current = composerFingerprint(editorForm);
    setEditingPostId(post.id);
    setForm(editorForm);
    setPostValidation({});
    setDetail(null);
    setComposerOpen(true);
  };

  const openComposer = () => {
    if (!user) { onRequireLogin(); return; }
    setEditingPostId("");
    const newForm = {
      ...emptyCommunityPostForm(),
      area: groupSuggestionCity,
      communityId: selectedGroup,
    };
    composerBaselineRef.current = composerFingerprint(newForm);
    setForm(newForm);
    setPostValidation({});
    setComposerOpen(true);
  };

  const loadMore = async (section: "local" | "national" = "local") => {
    const sectionHasMore = section === "local" ? localHasMore : nationalHasMore;
    if (loadingMore || !sectionHasMore) return;
    setLoadingMore(true);
    const requestedFeedGeneration = feedLoadGeneration.current;
    try {
      const feed = await getCommunityFeed({ q: appliedQuery, city: groupSuggestionCity, category: category === "ALL" ? "" : category, communityId: selectedGroup, layered: !selectedGroup, offset: section === "local" ? posts.length : nationalPosts.length, localOffset: posts.length, nationalOffset: nationalPosts.length, includeLocal: section === "local", includeNational: section === "national", limit: 30 });
      const nextLocal = feed.sections?.local?.posts || feed.posts || [];
      const nationwide = !feed.sections && !selectedGroup && section === "national"
        ? await getCommunityFeed({ q: appliedQuery, category: category === "ALL" ? "" : category, offset: fallbackNationalOffset.current, limit: 30 })
        : null;
      if (feedLoadGeneration.current !== requestedFeedGeneration) return;
      if (nationwide) fallbackNationalOffset.current += nationwide.posts?.length || 0;
      const localIds = new Set([...posts, ...nextLocal].map((post) => post.id));
        const selectedCountry = locationCountryCodeFromLabel(groupSuggestionCity) || "US";
        const nextNational = feed.sections?.national?.posts || (nationwide?.posts || []).filter((post) => isActivePublicCountryPost(post, groupSuggestionCity, localIds, selectedCountry));
      if (section === "local") {
        setPosts((current) => [...current, ...nextLocal.filter((post) => !current.some((item) => item.id === post.id))]);
        setLocalHasMore(Boolean(feed.sections?.local?.hasMore ?? feed.pagination?.hasMore));
      } else {
        setNationalPosts((current) => [...current, ...nextNational.filter((post) => !current.some((item) => item.id === post.id))]);
        setNationalHasMore(Boolean(feed.sections?.national?.hasMore ?? nationwide?.pagination?.hasMore));
      }
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
      const refreshed = await getCommunityPost(post.id);
      setDetail(refreshed);
      // Detail fetches the authoritative post, including a video that may
      // have completed while this feed card was still rendering its local
      // upload state. Keep both views in sync when the sheet is closed.
      if (refreshed) {
        setPosts((current) => current.map((item) => item.id === refreshed.id ? refreshed : item));
        setNationalPosts((current) => current.map((item) => item.id === refreshed.id ? refreshed : item));
        setCommunityVideoProgress((current) => {
          const next = { ...current };
          delete next[refreshed.id];
          return next;
        });
      }
    }
    catch (error) { Alert.alert("Could not open post", message(error)); }
    finally { setDetailBusy(false); }
  };

  const mutatePost = (id: string, update: (post: CommunityPost) => CommunityPost) => {
    setPosts((current) => current.map((post) => post.id === id ? update(post) : post));
    setNationalPosts((current) => current.map((post) => post.id === id ? update(post) : post));
    setDetail((current) => current?.id === id ? update(current) : current);
  };

  useEffect(() => {
    if (!user?.id) return;
    let stopped = false;
    const resume = async () => {
      const completed = await resumePendingCommunityVideoUploads((postId, progress) => {
        if (!stopped) setCommunityVideoProgress((current) => ({ ...current, [postId]: progress }));
      });
      if (stopped || !completed.length) return;
      setPosts((current) => current.map((post) => completed.find((item) => item.id === post.id) || post));
      setCommunityVideoProgress((current) => {
        const next = { ...current };
        completed.forEach((post) => delete next[post.id]);
        return next;
      });
    };
    void resume();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void resume(); });
    return () => { stopped = true; subscription.remove(); };
  }, [user?.id]);

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

  const reactionPicker = (target: string, viewerReaction: string, count: number, counts: Record<string, number> | undefined, onReact: (reaction: string) => void, iconOnly = false, compact = false) => {
    const selected = reactionOptions.find((option) => option.value === viewerReaction);
    return <View style={[styles.reactionControl, compact && styles.compactPostAction]}>
      {expandedReactionTarget === target ? <View style={styles.reactionTray}>{reactionOptions.map((option) => <TouchableOpacity key={option.value} style={styles.reactionChoice} onPress={(event) => { event.stopPropagation(); reactionLongPressTarget.current = ""; setExpandedReactionTarget(""); onReact(option.value); }} accessibilityLabel={`${option.label} reaction`}><Text style={styles.reactionChoiceEmoji}>{option.emoji}</Text></TouchableOpacity>)}</View> : null}
      <TouchableOpacity
        style={[styles.reactionSummary, iconOnly && styles.reactionSummaryIconOnly, compact && styles.compactReactionSummary]}
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

  const updatePostTextField = (field: "title" | "body", value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setPostValidation((current) => current[field] ? { ...current, [field]: undefined } : current);
  };

  const publish = async () => {
    const housingLocation = isNewHousingPost ? {
      currentCity: normalizedLocationLabel(housingCurrentCity),
      moving: housingCitiesDiffer && housingMoveAnswer === "YES",
      moveMonth: housingMoveMonth.trim(),
      showOnMap: housingCitiesDiffer && housingMoveAnswer === "YES" && housingMoveVisible,
        showCurrentOnMap: !housingCitiesDiffer && housingMoveVisible ? true : undefined,
    } : undefined;
    if (isNewHousingPost && (!normalizedCityKey(listingCity) || !normalizedCityKey(housingCurrentCity))) {
      Alert.alert("Choose city and state", "Enter your current city and the listing city, such as Houston, TX or Denver, CO.");
      return;
    }
    if (isNewHousingPost && housingCitiesDiffer && !housingMoveAnswer) {
      Alert.alert("Confirm your move", "Choose whether you are moving to the listing city.");
      return;
    }
    if (housingLocation?.moving && housingLocation.moveMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(housingLocation.moveMonth)) {
      Alert.alert("Check move month", "Use YYYY-MM, such as 2027-01, or leave it blank.");
      return;
    }

    const titleLength = form.title.trim().length;
    const bodyLength = form.body.trim().length;
    const validation = {
      title: titleLength < 6 ? (titleLength ? "Use at least 6 characters for the title." : "Add a clear title.") : undefined,
      body: bodyLength < 12 ? (bodyLength ? "Add a little more detail (at least 12 characters)." : "Add helpful details for your post.") : undefined,
    };
    if (validation.title || validation.body) {
      setPostValidation(validation);
      return;
    }
    let preparedVideo: CommunityVideoFile | null = null;
    const hasQueuedVideo = form.media.some((item) => item.pendingVideo);
    setPublishing(true);
    try {
      // A video post remains private to its author until R2 verifies the
      // media. Its durable upload job runs independently of this page sheet.
      let media = form.media.filter((item) => !item.pendingVideo).map((item) => ({ url: item.url, type: item.type }));
      const pendingVideo = form.media.find((item) => item.pendingVideo)?.pendingVideo;
      if (pendingVideo) {
        setVideoUploadProgress(0);
        setVideoUploadPath("preparing");
        preparedVideo = await prepareCommunityVideoForFeed(pendingVideo, (progress) => setVideoUploadProgress(Math.max(0, Math.min(0.18, progress * 0.18))));
        if (!editingPostId && !housingLocation) {
          const nextTitle = form.title.trim();
          const nextBody = form.body.trim();
          const nextLinkUrl = form.linkUrl.trim();
          const nextDetails = { ...form.details };
          const uploadProgressKey = `pending-${Date.now()}`;
          let createdPostId = "";
          const created = await createCommunityVideoPost(
            { ...form, media, city: groupSuggestionCity, title: nextTitle, body: nextBody, area: form.area.trim(), linkUrl: nextLinkUrl, details: nextDetails },
            preparedVideo,
            (progress) => setCommunityVideoProgress((current) => ({ ...current, [createdPostId || uploadProgressKey]: progress })),
          );
          createdPostId = created.post.id;
          setPosts((current) => [created.post, ...current]);
          setCommunityVideoProgress((current) => {
            const next = { ...current, [createdPostId]: current[uploadProgressKey] || 0 };
            delete next[uploadProgressKey];
            return next;
          });
          void created.completion.then((completed) => {
            if (completed) setPosts((current) => current.map((post) => post.id === completed.id ? completed : post));
            setCommunityVideoProgress((current) => { const next = { ...current }; delete next[createdPostId]; return next; });
          }).catch(() => {
            // The durable outbox retries on the next foreground session. Keep
            // the author-visible card instead of misleadingly publishing it.
          });
          const emptyForm = emptyCommunityPostForm();
          composerBaselineRef.current = composerFingerprint(emptyForm);
          setForm(emptyForm);
          setPostValidation({});
          setComposerOpen(false);
          return;
        }
        const uploaded = await uploadCommunityVideo(preparedVideo, (progress) => setVideoUploadProgress(0.18 + Math.max(0, Math.min(1, progress)) * 0.82), setVideoUploadPath);
        setVideoUploadPath(uploaded.uploadPath);
        media = form.media.map((item) => item.pendingVideo ? uploaded.media : { url: item.url, type: item.type });
      }
      const nextTitle = form.title.trim();
      const nextBody = form.body.trim();
      const nextLinkUrl = form.linkUrl.trim();
      const nextDetails = { ...form.details };
      if (editingPostId) {
        const postId = editingPostId;
        await updateCommunityPost(postId, { title: nextTitle, body: nextBody, linkUrl: nextLinkUrl, details: nextDetails, media });
        // The save has succeeded. Do not hold this page-sheet open behind a
        // full local-and-national feed refresh: that extra request made an
        // Edit tap appear stuck when the feed was slow. Update the card the
        // member sees immediately and reconcile it quietly in the background.
        mutatePost(postId, (post) => ({
          ...post,
          title: nextTitle,
          body: nextBody,
          linkUrl: nextLinkUrl,
          details: nextDetails,
          media,
          images: media.filter((item) => item.type === "IMAGE").map((item) => item.url),
        }));
        void load(true);
      } else {
        const result = await createCommunityPost({ ...form, housingLocation, media, city: isNewHousingPost ? normalizedLocationLabel(listingCity) : groupSuggestionCity, title: nextTitle, body: nextBody, area: form.area.trim(), linkUrl: nextLinkUrl });
        setPosts((current) => [result.post, ...current]);
        if (result.user) onProfileUpdated(result.user);
      }
      const emptyForm = emptyCommunityPostForm();
      composerBaselineRef.current = composerFingerprint(emptyForm);
      setForm(emptyForm);
      setPostValidation({});
      setComposerOpen(false);
      Alert.alert(editingPostId ? "Post updated" : "Posted", editingPostId ? "Your changes are live." : "Your post is now live in Ask Community.");
      setEditingPostId("");
    } catch (error) {
      Alert.alert(hasQueuedVideo ? "Video not uploaded" : "Could not publish", hasQueuedVideo ? `${message(error)} Your post is still a draft. Try posting again when the connection is better.` : message(error));
    } finally {
      void removePreparedCommunityVideo(preparedVideo);
      setVideoUploadProgress(null);
      setVideoUploadPath(null);
      setPublishing(false);
    }
  };

  const addCommunityPhotos = async () => {
    if (form.media.length >= 4) { Alert.alert("Attachment limit", "A post can have up to four attachments."); return; }
    try {
      const images = await pickCompressedImages(4 - form.media.length);
      setForm((current) => ({ ...current, media: [...current.media, ...images.map((url) => ({ url, type: "IMAGE" as const }))].slice(0, 4) }));
    } catch (error) { Alert.alert("Photos not added", message(error)); }
  };

  const addCommunityVideo = async () => {
    if (form.media.some((item) => item.type === "VIDEO")) { Alert.alert("Video already added", "Each post can include one video."); return; }
    if (form.media.length >= 4) { Alert.alert("Attachment limit", "Remove an attachment before adding a video."); return; }
    try {
      const video = await pickCommunityVideo();
      if (!video) return;
      setForm((current) => ({ ...current, media: [...current.media, { url: video.uri, type: "VIDEO" as const, pendingVideo: video }].slice(0, 4) }));
    } catch (error) { Alert.alert("Video not added", message(error)); }
  };

  const chooseCommunityAttachment = () => Alert.alert(
    "Add to your post",
    "Choose photos or one video.",
    [
      { text: "Photos", onPress: () => void addCommunityPhotos() },
      { text: "Video", onPress: () => void addCommunityVideo() },
      { text: "Cancel", style: "cancel" },
    ],
  );

  const submitAnswer = async () => {
    if (!detail || !answer.trim()) return;
    if (!user && guestRemaining <= 0) { setGuestBenefitsOpen(true); return; }
    const replyThreadId = answerReplyTarget?.id || "";
    const postId = detail.id;
    const submittedBody = answer.trim();
    setDetailBusy(true);
    try {
      const result = await answerCommunityPost(postId, submittedBody, replyThreadId);
      setAnswer("");
      setAnswerReplyTarget(null);
      if (replyThreadId) setExpandedReplyThreads((current) => new Set([...current, replyThreadId]));
      if (!user && typeof result.guestRemaining === "number") {
        setGuestRemaining(result.guestRemaining);
        // A guest who has chosen to join a discussion can opt into the system
        // prompt here. The app then alerts only for replies to that guest's
        // own Ask Community comments.
        void onRequestGuestNotifications?.();
      }
      const now = new Date().toISOString();
      const optimisticAnswer: CommunityAnswer = {
        id: result.answerId,
        body: submittedBody,
        parentAnswerId: replyThreadId,
        author: user
          ? { id: user.id, name: user.name, photoUrl: user.profilePhotoUrl || "" }
          : { id: 0, name: guestIdentity || "Guest", photoUrl: "", isGuest: true },
        reactionCount: 0,
        reactionCounts: {},
        viewerReaction: "",
        accepted: false,
        canEdit: Boolean(user),
        createdAt: now,
        updatedAt: now,
      };
      setDetail((current) => current?.id === postId
        ? {
            ...current,
            answerCount: current.answerCount + 1,
            latestAnswer: { id: optimisticAnswer.id, body: optimisticAnswer.body, author: optimisticAnswer.author, createdAt: optimisticAnswer.createdAt },
            answers: [...(current.answers || []), optimisticAnswer],
          }
        : current);
      void getCommunityPost(postId)
        .then((fresh) => setDetail((current) => current?.id === postId ? fresh : current))
        .catch(() => undefined);
      void load(true);
    }
    catch (error) {
      if (!user && message(error).toLowerCase().includes("unlimited community")) setGuestBenefitsOpen(true);
      else Alert.alert("Answer not posted", message(error));
    }
    finally { setDetailBusy(false); }
  };

  const beginAnswerEdit = (item: CommunityAnswer) => {
    setAnswerReplyTarget(null);
    setEditingAnswerId(item.id);
    setAnswer(item.body);
  };

  const cancelAnswerEdit = () => {
    setEditingAnswerId("");
    setAnswer("");
  };

  const saveAnswerEdit = async () => {
    if (!detail || !editingAnswerId || answer.trim().length < 2) return;
    const postId = detail.id;
    const answerId = editingAnswerId;
    const submittedBody = answer.trim();
    setDetailBusy(true);
    try {
      await updateCommunityAnswer(answerId, submittedBody);
      setEditingAnswerId("");
      setAnswer("");
      setDetail((current) => current?.id === postId
        ? {
            ...current,
            answers: (current.answers || []).map((item) => item.id === answerId ? { ...item, body: submittedBody, updatedAt: new Date().toISOString() } : item),
          }
        : current);
      void getCommunityPost(postId)
        .then((fresh) => setDetail((current) => current?.id === postId ? fresh : current))
        .catch(() => undefined);
      void load(true);
    } catch (error) {
      Alert.alert("Comment not updated", message(error));
    } finally {
      setDetailBusy(false);
    }
  };

  const acceptAnswer = async (answerId: string) => {
    if (!detail || detailBusy) return;
    const postId = detail.id;
    setDetailBusy(true);
    try {
      await acceptCommunityAnswer(postId, answerId);
      setDetail((current) => current?.id === postId
        ? {
            ...current,
            acceptedAnswerId: answerId,
            answers: (current.answers || []).map((item) => ({ ...item, accepted: item.id === answerId })),
          }
        : current);
      void getCommunityPost(postId)
        .then((fresh) => setDetail((current) => current?.id === postId ? fresh : current))
        .catch(() => undefined);
      void load(true);
    } catch (error) {
      Alert.alert("Answer not accepted", message(error));
    } finally {
      setDetailBusy(false);
    }
  };

  const editableAnswerBody = (item: CommunityAnswer, bodyStyle: object) => editingAnswerId === item.id ? (
    <View style={styles.answerEditBox}>
      <TextInput autoFocus style={[styles.inlineReplyInput, styles.answerEditInput]} value={answer} onChangeText={setAnswer} multiline maxLength={1800} placeholder="Edit your comment…" placeholderTextColor={theme.colors.muted} />
      <View style={styles.answerEditActions}>
        <TouchableOpacity onPress={cancelAnswerEdit}><Text style={styles.replyAction}>Cancel</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.inlineReplySend, answer.trim().length < 2 && styles.disabled]} disabled={answer.trim().length < 2 || detailBusy} onPress={() => void saveAnswerEdit()}><Text style={styles.sendAnswerText}>{detailBusy ? "…" : "Save"}</Text></TouchableOpacity>
      </View>
    </View>
  ) : <Text style={bodyStyle}>{item.body}</Text>;

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

  const handleDetailDismiss = () => {
    finishGuestAuth();
    const photo = pendingPhotoViewerRef.current;
    pendingPhotoViewerRef.current = null;
    if (photo) {
      requestAnimationFrame(() => setPhotoViewer(photo));
      return;
    }
    const author = pendingMemberProfileRef.current;
    pendingMemberProfileRef.current = null;
    if (!author) return;
    requestAnimationFrame(() => memberProfileSheetRef.current?.open(author));
  };

  const closePhotoViewer = () => {
    pendingPhotoReturnRef.current = Platform.OS === "ios" ? photoViewer?.returnToPost || null : null;
    setPhotoViewer(null);
  };

  const handlePhotoViewerDismiss = () => {
    if (Platform.OS !== "ios") return;
    const post = pendingPhotoReturnRef.current;
    pendingPhotoReturnRef.current = null;
    if (post) requestAnimationFrame(() => setDetail(post));
  };

  const completedStatus = (post: CommunityPost): CommunityPost["fulfillmentStatus"] => post.category === "HAVE_PLACE" ? "FILLED" : post.category === "CARPOOL_RIDE" ? "ARRANGED" : post.category === "NEED_PLACE" || post.category === "NEED_ROOMMATE" ? "FOUND" : "RESOLVED";
  const managePost = (post: CommunityPost) => Alert.alert("Manage post", "Choose an action.", [
    { text: post.expiresAt && new Date(post.expiresAt).getTime() <= Date.now() ? "Renew for 45 days" : post.fulfillmentStatus === "OPEN" ? `Mark ${completedStatus(post).toLowerCase()}` : "Reopen post", onPress: async () => { try { const expired = Boolean(post.expiresAt && new Date(post.expiresAt).getTime() <= Date.now()); const status = expired || post.fulfillmentStatus !== "OPEN" ? "OPEN" : completedStatus(post); await updateCommunityPostStatus(post.id, status); mutatePost(post.id, (value) => ({ ...value, fulfillmentStatus: status, canAnswer: status === "OPEN", expiresAt: expired ? new Date(Date.now() + 45 * 86400000).toISOString() : value.expiresAt })); } catch (error) { Alert.alert("Status not changed", message(error)); } } },
    { text: "Edit", onPress: () => openCommunityPostEditor(post) },
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
    const currentCity = normalizedCityKey(groupSuggestionCity);
    return groups
      .filter((group) => {
        if (group.visibility !== "PUBLIC") return false;
        const groupCity = normalizedCityKey(group.suggestionCity || group.area || "");
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

  const renderPostImages = (post: CommunityPost, interactive = false, playVideo = false) => {
    const media = post.media?.length ? post.media : post.images.map((url) => ({ url, type: "IMAGE" as const }));
    const visible = media.slice(0, 4);
    const photos = media.filter((item) => item.type === "IMAGE").map((item) => item.url);
    const autoPlayVideo = playVideo || visibleVideoPostIds.has(post.id);
    if (!visible.length) return null;
    if (visible.length === 1 && visible[0].type === "IMAGE") {
      return <CommunitySinglePostPhoto
        image={visible[0].url}
        interactive={interactive}
        label={`Open listing photo 1 of ${photos.length}`}
        onPress={() => openPostPhoto(post, photos, 0)}
      />;
    }
    // A feed card should use its full visual area. Portrait videos retain their
    // center framing while the native player crops the outer edges instead of
    // leaving contrasting black side bars around the content.
    if (visible.length === 1) return <View style={styles.postMediaSingle}><CommunityPostVideo video={visible[0].url} style={styles.postMediaSingleImage} contentFit="cover" autoPlay={autoPlayVideo} /></View>;
    return <View style={styles.postMediaGrid}>
      {visible.map((item, index) => {
        const cellStyle = [
          styles.postMediaCell,
          visible.length === 2 && styles.postMediaCellTwo,
          visible.length === 3 && index === 0 && styles.postMediaCellThreeHero,
          visible.length === 3 && index > 0 && styles.postMediaCellThreeSmall,
          visible.length === 4 && styles.postMediaCellFour,
        ];
        if (item.type === "VIDEO") return <View key={`${item.url}-${index}`} style={cellStyle}><CommunityPostVideo video={item.url} style={styles.postMediaImage} autoPlay={autoPlayVideo} /></View>;
        const photoIndex = photos.indexOf(item.url);
        const imageCell = <Image source={{ uri: absoluteUrl(item.url) }} style={styles.postMediaImage} resizeMode="cover" />;
        return interactive ? <TouchableOpacity key={`${item.url}-${index}`} accessibilityRole="button" accessibilityLabel={`Open listing photo ${photoIndex + 1} of ${photos.length}`} activeOpacity={0.78} onPress={() => openPostPhoto(post, photos, photoIndex)} style={cellStyle}>{imageCell}</TouchableOpacity> : <View key={`${item.url}-${index}`} style={cellStyle}>{imageCell}</View>;
      })}
    </View>;
  };

  const renderPost = (post: CommunityPost) => {
    const facts = communityPostFacts(post);
    const showingPostDetail = detail?.id === post.id;
    const videoStillUploading = post.uploadState === "UPLOADING";
    const PostOpenContainer: React.ElementType = showingPostDetail || videoStillUploading ? View : TouchableOpacity;
    const postOpenProps = showingPostDetail || videoStillUploading ? {} : { activeOpacity: 0.92, onPress: () => void openDetail(post), accessible: false };
    return (
    <View key={post.id} style={[styles.postCard, isLight && styles.postCardLight]}>
      <PostOpenContainer style={styles.postOpenArea} {...postOpenProps}>
      <View style={styles.postHead}>
        <TouchableOpacity onPress={(event) => { event.stopPropagation(); void openMemberProfile(post.author); }} accessibilityRole="button" accessibilityLabel={`View ${post.author.name}'s profile`}><FeedCharacterAvatar photoUrl={post.author.photoUrl} name={post.author.name} delay={(post.id.length % 5) * 170} /></TouchableOpacity>
        <TouchableOpacity style={styles.postAuthor} onPress={(event) => { event.stopPropagation(); void openMemberProfile(post.author); }} accessibilityRole="button" accessibilityLabel={`View ${post.author.name}'s profile`}><Text style={[styles.author, styles.postAuthorSoft, isLight && styles.textPrimaryLight]} numberOfLines={1}>{post.author.name}</Text><View style={styles.authorMetaLine}>{post.author.ratingSummary?.count ? <Text style={styles.authorRatingBadge}>⭐ {post.author.ratingSummary.label}</Text> : null}<Text style={[styles.meta, styles.postMeta, isLight && styles.textSecondaryLight]} numberOfLines={1}>{post.community?.name || (isHousingCommunityPost(post) ? "Housing listing" : communityPostLocation(post.area, post.city) || "FairFares Community")} · {relativeTime(post.createdAt)}</Text></View></TouchableOpacity>
      </View>
      <Text style={[styles.postTitle, styles.postTitleSoft, isLight && styles.textPrimaryLight]}>{post.title}</Text>
      {post.fulfillmentStatus !== "OPEN" ? <View style={styles.resolvedBadge}><Text style={[styles.resolvedText, styles.postBadgeSoft]}>✓ {post.fulfillmentStatus === "ARRANGED" ? "Ride arranged" : post.fulfillmentStatus.charAt(0) + post.fulfillmentStatus.slice(1).toLowerCase()}</Text></View> : null}
      <Text style={[styles.postBody, isLight && styles.textBodyLight]} numberOfLines={4}>{post.body}</Text>
      {post.uploadState === "UPLOADING" ? <View style={[styles.videoUploadCard, isLight && styles.videoUploadCardLight]}>
        <View style={styles.videoUploadRing}><Text style={styles.videoUploadPercent}>{Math.round((communityVideoProgress[post.id] || 0) * 100)}%</Text></View>
        <View style={styles.videoUploadCopy}><Text style={[styles.videoUploadTitle, isLight && styles.textPrimaryLight]}>Uploading your video</Text><Text style={[styles.videoUploadBody, isLight && styles.textSecondaryLight]}>Only you can see this until it finishes. You can keep using FairFares.</Text></View>
      </View> : null}
      {facts.length ? <View style={styles.detailFacts}>{facts.map((fact) => <View key={fact.id} style={[styles.fact, fact.wide && styles.factWide]}><Text style={[styles.factLabel, isLight && styles.textSecondaryLight]}>{fact.wide ? "⌖  " : ""}{fact.label}</Text><Text style={[styles.factValue, isLight && styles.textPrimaryLight]} numberOfLines={2}>{fact.value}</Text></View>)}</View> : null}
      {post.linkUrl || firstWebUrl(post.body) ? <SharedLinkCard url={post.linkUrl || firstWebUrl(post.body)} /> : null}
      </PostOpenContainer>
      {/* Photos always open the zoomable viewer. They sit outside the post
          navigation target, so this works in both the feed and post sheet. */}
      {renderPostImages(post, true, showingPostDetail)}
      {post.reactionCount ? <View style={[styles.activitySummary, isLight && styles.activitySummaryLight]}><View style={styles.reactionBreakdown}>{reactionBreakdown(post.reactionCounts, post.reactionCount, post.viewerReaction).map((option) => <Text key={option.value} style={styles.activityText}>{option.count} {option.emoji} {option.label}</Text>)}</View></View> : null}
      {!videoStillUploading ? <View style={[styles.postActions, compactPostActions && styles.postActionsCompact, isLight && styles.postActionsLight]}>
        {reactionPicker(`post-${post.id}`, post.viewerReaction, post.reactionCount, post.reactionCounts, (reaction) => void reactPost(post, reaction), false, compactPostActions)}
        <TouchableOpacity style={[styles.footerCommentAction, compactPostActions && styles.compactPostAction]} onPress={() => void openDetail(post)} accessibilityLabel={`${post.answerCount} comments`}><Text style={[styles.footerIcon, compactPostActions && styles.compactFooterIcon, isLight && styles.textBodyLight]}>◯</Text><Text numberOfLines={1} style={[styles.footerActionLabel, compactPostActions && styles.compactFooterActionLabel, isLight && styles.textBodyLight]}>Comment{post.answerCount ? ` ${post.answerCount}` : ""}</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.footerIconAction, compactPostActions && styles.compactPostAction]} onPress={(event) => { event.stopPropagation(); const url = `https://www.fairfare.space/community/open?postId=${encodeURIComponent(post.id)}&share=3`; const summary = `${post.title}\n${post.body.slice(0, 180)}`; void Share.share(Platform.OS === "ios" ? { title: post.title, message: summary, url } : { title: post.title, message: `${summary}\n\n${url}` }); }} accessibilityLabel="Share"><Text style={[styles.footerShareIcon, compactPostActions && styles.compactFooterIcon, isLight && styles.textBodyLight]}>↗</Text><Text numberOfLines={1} style={[styles.footerActionLabel, compactPostActions && styles.compactFooterActionLabel, isLight && styles.textBodyLight]}>Share</Text></TouchableOpacity>
        {post.sourceKind === "HOUSING" && post.sourceId ? <TouchableOpacity style={[styles.viewListingButton, compactPostActions && styles.compactPostAction]} onPress={(event) => { event.stopPropagation(); onOpenHousing(post.sourceId); }} accessibilityRole="button" accessibilityLabel={`View housing details: ${post.title}`}><Text style={[styles.viewListingIcon, compactPostActions && styles.compactFooterIcon]}>⌂</Text><Text numberOfLines={1} style={[styles.viewListingButtonText, compactPostActions && styles.compactViewListingButtonText, isLight && styles.textBodyLight]}>Details</Text><Text style={[styles.viewListingArrow, compactPostActions && styles.compactViewListingArrow, isLight && styles.textSecondaryLight]}>›</Text></TouchableOpacity> : null}
      </View>
      : null}
    </View>
    );
  };

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

  const renderCommunityReview = () => <CommunityReviewCard reviews={communityReviews} city={city} isLight={isLight} />;

  const renderLocalMore = () => {
    const label = posts.length ? `Show more posts near ${groupSuggestionCity.split(",", 1)[0] || "you"}` : "Show more posts";
    return (
      <TouchableOpacity style={styles.loadMore} disabled={loadingMore} onPress={() => void loadMore("local")} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={styles.loadMoreText}>{loadingMore ? "Loading…" : label}</Text>
      </TouchableOpacity>
    );
  };

  const renderNationalMore = () => {
    const label = "Show more posts from across the USA";
    return (
      <TouchableOpacity style={styles.loadMore} disabled={loadingMore} onPress={() => void loadMore("national")} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={styles.loadMoreText}>{loadingMore ? "Loading…" : label}</Text>
      </TouchableOpacity>
    );
  };

  const feedRows = useMemo<CommunityFeedRow[]>(() => {
    const rows: CommunityFeedRow[] = [];
    posts.forEach((post, index) => {
      rows.push({ key: `local-${post.id}`, kind: "post", post });
      if (category === "ALL" && index === communityInsertIndex) rows.push({ key: "community-suggestions", kind: "communities" });
    });
    if (category === "ALL" && posts.length === 0) rows.push({ key: "community-suggestions", kind: "communities" });
    if (!posts.length) rows.push({ key: "local-empty", kind: "local-empty" });
    // Put paging directly after local posts. Previously users had to scroll
    // through the nationwide section before they could discover the next page
    // of listings from their own metro.
    if (!selectedGroup && posts.length && localHasMore) rows.push({ key: "local-more", kind: "local-more" });
    if (!selectedGroup && nationalPosts.length) {
      rows.push({ key: "national-heading", kind: "national-heading" });
      rows.push({ key: "community-testimonial", kind: "testimonial" });
    }
    if (!selectedGroup) {
      nationalPosts.forEach((post, index) => {
        rows.push({ key: `national-${post.id}`, kind: "post", post });
        if (index === 2 && lowestRental) rows.push({ key: "lowest-rental", kind: "rental" });
      });
      if (nationalPosts.length < 3 && lowestRental) rows.push({ key: "lowest-rental", kind: "rental" });
      if (nationalHasMore) rows.push({ key: "national-more", kind: "national-more" });
    }
    if (!posts.length && !nationalPosts.length) rows.push({ key: "feed-empty", kind: "empty" });
    return rows;
  }, [category, communityInsertIndex, localHasMore, lowestRental, nationalHasMore, nationalPosts, posts, selectedGroup]);

  // The detail sheet is intentionally stateful, but opening a comment must not
  // replace FlatList's render callback. On iOS that made every visible card
  // eligible for a costly update before the sheet could animate in.
  const feedRenderContext = useRef<{
    renderPost: (post: CommunityPost) => React.ReactElement;
    renderCommunitySuggestions: () => React.ReactElement | null;
    renderCommunityReview: () => React.ReactElement;
    renderLocalMore: () => React.ReactElement;
    renderNationalMore: () => React.ReactElement;
    renderLowestRental: () => React.ReactElement | null;
    groupSuggestionCity: string;
    acrossCountryName: string;
  } | null>(null);
  feedRenderContext.current = {
    renderPost,
    renderCommunitySuggestions,
    renderCommunityReview,
    renderLocalMore,
    renderNationalMore,
    renderLowestRental,
    groupSuggestionCity,
    acrossCountryName,
  };

  const renderFeedRow = useCallback(({ item }: { item: CommunityFeedRow }) => {
    const context = feedRenderContext.current;
    if (!context) return null;
    if (item.kind === "post") return context.renderPost(item.post);
    if (item.kind === "communities") return context.renderCommunitySuggestions();
    if (item.kind === "local-empty") return <View style={styles.localFeedNote}><Text style={styles.localFeedNoteTitle}>No posts near {context.groupSuggestionCity.split(",", 1)[0] || "you"} yet</Text><Text style={styles.localFeedNoteBody}>Start a local conversation above, or explore active posts from across the country.</Text></View>;
    if (item.kind === "local-more") return context.renderLocalMore();
    if (item.kind === "national-more") return context.renderNationalMore();
    if (item.kind === "national-heading") return <View style={styles.nationalSectionHead}><View><Text style={styles.nationalEyebrow}>DISCOVER MORE</Text><Text style={styles.nationalTitle}>Across {context.acrossCountryName === "India" ? "India" : "the USA"}</Text><Text style={styles.nationalBody}>Active public posts from FairFares communities nationwide.</Text></View><Text style={styles.nationalIcon}>{context.acrossCountryName === "India" ? "🇮🇳" : "🇺🇸"}</Text></View>;
    if (item.kind === "testimonial") return context.renderCommunityReview();
    if (item.kind === "rental") return context.renderLowestRental();
    return <Text style={styles.feedEndNote}>Be the first to ask. Your post will appear here for people near {context.groupSuggestionCity.split(",", 1)[0] || "your city"}.</Text>;
  }, []);

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
      <TouchableOpacity style={styles.inlineReplyHead} onPress={() => void openMemberProfile(item.author)} accessibilityRole="button" accessibilityLabel={`View ${item.author.name}'s profile`}><UserAvatar photoUrl={item.author.photoUrl} style={styles.inlineReplyAvatar} imageStyle={styles.avatarImage} fallback={<Text style={styles.latestCommentInitials}>{initials(item.author.name)}</Text>} /><View style={styles.postAuthor}><Text style={styles.inlineReplyAuthor}>{item.author.name}</Text><Text style={styles.meta}>{relativeTime(item.createdAt)}</Text></View></TouchableOpacity>
      {editableAnswerBody(item, styles.inlineReplyBody)}
      {reactionStats(item.reactionCounts, item.reactionCount, item.viewerReaction)}
      <View style={styles.answerActions}>{reactionPicker(`answer-${item.id}`, item.viewerReaction, item.reactionCount, item.reactionCounts, (reaction) => void reactAnswer(item, reaction))}{item.canEdit ? <TouchableOpacity onPress={() => beginAnswerEdit(item)}><Text style={styles.replyAction}>Edit</Text></TouchableOpacity> : null}<TouchableOpacity onPress={() => { setEditingAnswerId(""); setAnswerReplyTarget({ id: item.id, name: item.author.name }); setAnswer(""); }}><Text style={styles.replyAction}>Reply</Text></TouchableOpacity></View>
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
    <View key={item.id} style={styles.answerCard}>
      <View style={styles.postHead}><TouchableOpacity style={styles.answerAuthorButton} onPress={() => void openMemberProfile(item.author)} accessibilityRole="button" accessibilityLabel={`View ${item.author.name}'s profile`}><UserAvatar photoUrl={item.author.photoUrl} style={styles.answerAvatar} imageStyle={styles.avatarImage} fallback={<Text style={styles.avatarInitials}>{initials(item.author.name)}</Text>} /><View style={styles.postAuthor}><Text style={styles.author}>{item.author.name}</Text><Text style={styles.meta}>{relativeTime(item.createdAt)}</Text></View></TouchableOpacity>{item.accepted ? <Text style={[styles.accepted, isLight && styles.acceptedLight]}>✓ Accepted</Text> : null}</View>
      {editableAnswerBody(item, styles.answerBody)}
      {reactionStats(item.reactionCounts, item.reactionCount, item.viewerReaction)}
      <View style={styles.answerActions}>{reactionPicker(`answer-${item.id}`, item.viewerReaction, item.reactionCount, item.reactionCounts, (reaction) => void reactAnswer(item, reaction))}{item.canEdit ? <TouchableOpacity onPress={() => beginAnswerEdit(item)}><Text style={styles.replyAction}>Edit</Text></TouchableOpacity> : null}<TouchableOpacity onPress={() => { setEditingAnswerId(""); setAnswerReplyTarget({ id: item.id, name: item.author.name }); setAnswer(""); }}><Text style={styles.replyAction}>Reply</Text></TouchableOpacity>{detail?.canEdit && detail.type === "QUESTION" && !item.accepted ? <TouchableOpacity disabled={detailBusy} onPress={() => void acceptAnswer(item.id)}><Text style={[styles.acceptAction, detailBusy && styles.disabled]}>Accept answer</Text></TouchableOpacity> : null}</View>
      {replies.length ? <View style={styles.inlineReplies}>{visibleReplies.map((reply) => renderNestedReply(reply, allAnswers, 1))}{hiddenReplyCount ? <TouchableOpacity style={styles.moreRepliesButton} onPress={() => setExpandedReplyThreads((current) => new Set([...current, item.id]))}><Text style={styles.moreRepliesText}>View {hiddenReplyCount} more {hiddenReplyCount === 1 ? "reply" : "replies"}</Text></TouchableOpacity> : expanded && replies.length > 2 ? <TouchableOpacity style={styles.moreRepliesButton} onPress={() => setExpandedReplyThreads((current) => { const next = new Set(current); next.delete(item.id); return next; })}><Text style={styles.moreRepliesText}>Show fewer replies</Text></TouchableOpacity> : null}</View> : null}
      {renderInlineReplyComposer(item)}
    </View>
    );
  };

  return <View style={styles.screen}>
    {expandedReactionTarget && !detail ? <Pressable style={styles.reactionDismissLayer} onPress={() => { reactionLongPressTarget.current = ""; setExpandedReactionTarget(""); }} accessibilityLabel="Close reactions" /> : null}
    <Animated.FlatList
      data={loading ? [] : feedRows}
      keyExtractor={(item) => item.key}
      renderItem={renderFeedRow}
      ItemSeparatorComponent={() => <View style={styles.feedRowSeparator} />}
      initialNumToRender={Platform.OS === "android" ? 6 : 7}
      maxToRenderPerBatch={Platform.OS === "android" ? 4 : 6}
      windowSize={Platform.OS === "android" ? 9 : 8}
      updateCellsBatchingPeriod={Platform.OS === "android" ? 28 : 32}
      removeClippedSubviews={Platform.OS === "android"}
      onViewableItemsChanged={onFeedViewableItemsChanged}
      viewabilityConfig={feedVideoViewabilityConfig}
      contentContainerStyle={[styles.content, isLight && styles.contentLight, { maxWidth: layout.contentMaxWidth, paddingBottom: layout.navClearance }]}
      alwaysBounceVertical
      scrollEventThrottle={16}
      onScroll={Animated.event(
        [{ nativeEvent: { contentOffset: { y: pullOffset } } }],
        {
          useNativeDriver: true,
          listener: (event: { nativeEvent: { contentOffset: { y: number } } }) => handleFeedScroll(event.nativeEvent.contentOffset.y),
        }
      )}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.colors.brand} onRefresh={() => { setRefreshing(true); setActionNoticeRefreshKey((current) => current + 1); void load(true); }} />}
      ListHeaderComponent={<>
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
        <UserAvatar photoUrl={user?.profilePhotoUrl} style={styles.composerAvatar} imageStyle={styles.composerAvatarImage} fallback={<Text style={styles.avatarInitials}>{initials(user?.name || "FairFares")}</Text>} />
        <TactilePressable style={[styles.composerPrompt, isLight && styles.composerPromptLight]} onPress={openComposer} accessibilityRole="button" accessibilityLabel="Write a community post"><Text style={[styles.composerPromptText, isLight && styles.textSecondaryLight]}>Write something…</Text></TactilePressable>
        <TactilePressable style={styles.composerAsk} onPress={openComposer} pressScale={0.94} accessibilityRole="button" accessibilityLabel="Ask community"><Text style={styles.composerAskText}>＋ Ask</Text></TactilePressable>
      </View>
      <TactilePressable style={[styles.gasPreviewCard, isLight && styles.gasPreviewCardLight]} onPress={onOpenGas} pressScale={0.985} accessibilityRole="button" accessibilityLabel={lowestGasPrice !== null ? `Last found cheapest regular gas was ${lowestGasPrice.toFixed(2)} dollars. Open nearby gas prices to refresh` : "Starting gas price example is 3.54 dollars. Open nearby gas prices to refresh"}>
        <View style={styles.gasPreviewIcon}>
          <Animated.View pointerEvents="none" style={[styles.gasPreviewGlyphLayer, { transform: [{ scale: gasIconScale }, { rotate: gasIconShake.interpolate({ inputRange: [-1, 1], outputRange: ["-9deg", "9deg"] }) }] }]}>
            <Text style={styles.gasPreviewGlyph}>⛽</Text>
          </Animated.View>
        </View>
        <View style={styles.gasPreviewCopy}><Text style={[styles.gasPreviewTitle, isLight && styles.gasPreviewTitleLight]}>Cheap gas near you</Text><Text style={[styles.gasPreviewSubtitle, isLight && styles.textSecondaryLight]}>Tap to compare reported station prices</Text></View>
        <View style={styles.gasPreviewPriceBlock}><Text style={styles.gasPreviewPrice}>${displayedGasPrice.toFixed(2)}</Text><Text style={styles.gasPreviewPriceLabel}>{lowestGasPrice !== null ? "last found" : "starting"}</Text></View>
        <Text style={[styles.gasPreviewChevron, isLight && styles.gasPreviewChevronLight]}>›</Text>
      </TactilePressable>
      <View><View style={styles.sectionRow}><Text style={[styles.sectionTitle, isLight && styles.textPrimaryLight]}>Popular topics</Text><TouchableOpacity onPress={() => { setSelectedGroup(""); setCategory("ALL"); }}><Text style={styles.manageLink}>View all  ›</Text></TouchableOpacity></View><View style={styles.topicGrid}>{popularTopics.map((item) => <TactilePressable accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.subtitle}`} key={item.value} pressScale={0.94} style={[styles.topicCard, isLight && styles.topicCardLight, { width: "23.5%", backgroundColor: item.color }, category === item.value && styles.topicSelected]} onPress={() => { if (item.value === "HOUSING") { onOpenHousing(); return; } if (item.value === "RIDES") { onOpenRides(); return; } if (item.value === "RENTALS") { onOpenRentalCars(); return; } setSelectedGroup(""); setCategory(item.value); }}><Image source={item.image} style={styles.topicImage} resizeMode="contain" /><Text style={styles.topicTitle}>{item.title}</Text><Text style={styles.topicSubtitle}>{item.subtitle}</Text></TactilePressable>)}</View></View>
      <View style={[styles.feedControls, isLight && styles.feedControlsLight]}><TouchableOpacity style={styles.feedLocationButton} onPress={() => { setCityDraft(groupSuggestionCity); setCityPickerOpen(true); }} accessibilityRole="button" accessibilityLabel={groupSuggestionCity ? `Change feed city. Currently ${groupSuggestionCity}` : "Choose a feed city or use current location"}><View><Text style={[styles.relevanceTitle, isLight && styles.textPrimaryLight]}>{groupSuggestionCity ? `Near ${groupSuggestionCity.split(",", 1)[0]}` : "Choose your location"} <Text style={styles.cityChevron}>⌄</Text></Text><Text style={[styles.relevanceSubtitle, isLight && styles.textSecondaryLight]}>{category !== "ALL" ? categoryLabels[category] : locationResolving && !groupSuggestionCity ? "Finding your current city…" : groupSuggestionCity ? "Current-city posts and listings · Tap to change" : "Use current location or choose a city"}</Text></View></TouchableOpacity><TouchableOpacity style={styles.filterButton} onPress={() => { setQuery(""); setAppliedQuery(""); setSelectedGroup(""); setCategory("ALL"); }} accessibilityRole="button" accessibilityLabel="Reset feed filters"><Text style={[styles.filterIcon, isLight && styles.textBodyLight]}>☷</Text></TouchableOpacity></View>
      {relocationSuggestions.length ? <View style={[styles.relocationConnections, isLight && styles.relocationConnectionsLight]}>
        <View style={styles.relocationConnectionsHead}><View><Text style={[styles.relocationConnectionsTitle, isLight && styles.textPrimaryLight]}>Relocation connections</Text><Text style={[styles.relocationConnectionsCopy, isLight && styles.textSecondaryLight]}>Both sides chose to connect around a city.</Text></View><Text style={styles.relocationConnectionsBadge}>OPT-IN</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.relocationConnectionsRail}>
          {relocationSuggestions.map((suggestion) => <TouchableOpacity key={suggestion.id} style={[styles.relocationConnectionCard, isLight && styles.relocationConnectionCardLight]} onPress={() => openMemberProfile({ id: suggestion.id, name: suggestion.name, photoUrl: suggestion.photoUrl })} accessibilityRole="button" accessibilityLabel={`View ${suggestion.name}'s relocation profile`}>
            <UserAvatar photoUrl={suggestion.photoUrl} style={styles.relocationConnectionAvatar} imageStyle={styles.relocationConnectionAvatarImage} fallback={<Text style={styles.relocationConnectionInitials}>{initials(suggestion.name)}</Text>} />
            <Text style={[styles.relocationConnectionName, isLight && styles.textPrimaryLight]} numberOfLines={1}>{suggestion.name}</Text>
            <Text style={styles.relocationConnectionReason} numberOfLines={2}>{suggestion.reason}</Text>
            {suggestion.month ? <Text style={styles.relocationConnectionMonth}>{suggestion.month}</Text> : null}
            {suggestion.ratingSummary?.count ? <Text style={styles.relocationConnectionRating}>⭐ {suggestion.ratingSummary.label}</Text> : null}
          </TouchableOpacity>)}
        </ScrollView>
      </View> : null}
      <View style={[styles.peopleSuggestions, isLight && styles.peopleSuggestionsLight]}>
        <View style={styles.peopleDiscoveryContent}>
          <View style={[styles.peopleDiscoveryInlineGuide, isLight && styles.peopleDiscoveryInlineGuideLight]}>
            <View style={styles.peopleDiscoveryInlineGuideRow}>
              <View style={styles.peopleDiscoveryGuidePair} pointerEvents="none">
                {peopleDiscoveryMembers.slice(0, 2).map((member, index) => <View key={`guide-${member.id}`} style={[styles.peopleDiscoveryGuideAvatarWrap, index === 1 && styles.peopleDiscoveryGuideAvatarSecond]}><UserAvatar photoUrl={member.photoUrl} style={styles.peopleDiscoveryGuideAvatar} imageStyle={styles.peopleDiscoveryGuideAvatarImage} fallback={<Text style={styles.peopleDiscoveryGuideAvatarInitials}>{initials(member.name)}</Text>} /></View>)}
                {!peopleDiscoveryMembers.length ? <View style={styles.peopleDiscoveryGuideAvatarWrap}><Text style={styles.peopleDiscoveryGuideAvatarInitials}>✦</Text></View> : null}
                <View style={styles.peopleDiscoveryGuidePairLink}><Text style={styles.peopleDiscoveryGuidePairLinkText}>✦</Text></View>
              </View>
              <View style={styles.peopleDiscoveryInlineGuideCopy}>
                <Text style={styles.peopleDiscoveryInlineGuideEyebrow}>DISCOVER MUTUAL FRIENDS</Text>
                <Text style={[styles.peopleDiscoveryInlineGuideTitle, isLight && styles.textPrimaryLight]}>Find friends around you</Text>
                <Text style={[styles.peopleDiscoveryInlineGuideBody, isLight && styles.textSecondaryLight]}>Find friends who work at the same company or attend the same school or college, and live in the same area.</Text>
                <TouchableOpacity style={styles.peopleDiscoveryInlineGuideAction} onPress={() => setPeopleNetworkOpen(true)} accessibilityRole="button" accessibilityLabel="Explore your people, friends, mutuals, and contacts"><Text style={styles.peopleDiscoveryInlineGuideActionText}>Explore people ›</Text></TouchableOpacity>
              </View>
            </View>
          </View>
          {peopleDiscoveryMembers.length ? <View style={styles.floatingPeopleStageCompact}>
            {peopleDiscoveryMembers.slice(0, 3).map((member, index) => <FloatingPersonBubble key={`preview-${member.id}-${member.tag}`} member={member} index={index} compact isLight={isLight} onOpen={() => openMemberProfile({ id: member.id, name: member.name, photoUrl: member.photoUrl })} />)}
          </View> : null}
        </View>
      </View>
      </>}
      ListEmptyComponent={loading ? <ActivityIndicator style={styles.loader} color={theme.colors.brand} size="large" /> : null}
      ListFooterComponent={selectedGroup && localHasMore ? renderLocalMore() : null}
    />
    {actionNotice ? <View pointerEvents="box-none" style={[styles.actionNoticeOverlay, { bottom: layout.navClearance + 8 }]}>
      <Animated.View style={[styles.actionNotice, isLight && styles.actionNoticeLight, {
        height: actionNoticeMotion.interpolate({ inputRange: [0, 1], outputRange: [0, 102] }),
        opacity: actionNoticeMotion,
        transform: [{ translateY: actionNoticeMotion.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }, { scale: actionNoticeMotion.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
      }]} accessibilityRole="alert">
        <View pointerEvents="none" style={styles.actionNoticeAccent} />
        <View style={styles.actionNoticeIcon}><Text style={styles.actionNoticeIconText}>{actionNotice.icon}</Text></View>
        <View style={styles.actionNoticeCopy}>
          <Text style={styles.actionNoticeEyebrow}>{actionNotice.eyebrow}</Text>
          <Text style={[styles.actionNoticeTitle, isLight && styles.textPrimaryLight]} numberOfLines={1}>{actionNotice.title}</Text>
          <Text style={[styles.actionNoticeBody, isLight && styles.textSecondaryLight]} numberOfLines={2}>{actionNotice.body}</Text>
        </View>
        <View style={styles.actionNoticeActions}>
          <TouchableOpacity
            style={styles.actionNoticeButton}
            onPress={() => actionNotice.action === "rental"
              ? onOpenRentalBooking(actionNotice.bookingId || "", actionNotice.rentalAction)
              : actionNotice.action === "housing"
                ? actionNotice.housingInquiryUserId
                  ? onOpenUserChat(actionNotice.housingInquiryUserId)
                  : onOpenHousing(actionNotice.housingPostId)
                : onOpenRides(actionNotice.action === "ride-request" ? "requests" : "activity", actionNotice.rideId)}
            accessibilityRole="button"
            accessibilityLabel={actionNotice.actionLabel}
          >
            <Text style={styles.actionNoticeButtonText}>{actionNotice.actionLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionNoticeClose} onPress={() => dismissActionNotice(actionNotice.id)} accessibilityRole="button" accessibilityLabel="Dismiss update"><Text style={styles.actionNoticeCloseText}>×</Text></TouchableOpacity>
        </View>
      </Animated.View>
    </View> : null}

    <Modal visible={cityPickerOpen} transparent animationType="fade" onRequestClose={() => setCityPickerOpen(false)}>
      <View style={styles.cityPickerBackdrop}><View style={styles.cityPickerCard}>
        <View style={styles.cityPickerHeader}><View><Text style={styles.cityPickerTitle}>Choose your feed city</Text><Text style={styles.cityPickerSubtitle}>Local posts appear first. USA posts remain below.</Text></View><TouchableOpacity onPress={() => setCityPickerOpen(false)} accessibilityLabel="Close city picker"><Text style={styles.cityPickerClose}>×</Text></TouchableOpacity></View>
        <TextInput style={styles.cityPickerInput} value={cityDraft} onChangeText={setCityDraft} placeholder="Enter city and state" placeholderTextColor={theme.colors.muted} autoCapitalize="words" returnKeyType="search" onSubmitEditing={() => chooseFeedCity(cityDraft)} />
        {cityOptionsLoading ? <ActivityIndicator color={theme.colors.brand} style={styles.cityPickerLoader} /> : null}
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.cityPickerResults}>{cityOptions.map((option) => <TouchableOpacity key={option} style={styles.cityPickerOption} onPress={() => chooseFeedCity(option)}><Text style={styles.cityPickerOptionText}>{option}</Text><Text style={styles.cityPickerOptionArrow}>›</Text></TouchableOpacity>)}</ScrollView>
        {cityDraft.trim().length >= 2 ? <TouchableOpacity style={styles.cityPickerUseTyped} onPress={() => chooseFeedCity(cityDraft)}><Text style={styles.cityPickerUseTypedText}>Use “{cityDraft.trim()}”</Text></TouchableOpacity> : null}
        <TouchableOpacity style={styles.currentLocationButton} disabled={locationResolving} accessibilityRole="button" accessibilityLabel="Use my current location" onPress={() => { void useCurrentFeedLocation(); }}>{locationResolving ? <ActivityIndicator color={theme.colors.brand} /> : <Text style={styles.currentLocationText}>⌖ Use my current location</Text>}</TouchableOpacity>
      </View></View>
    </Modal>

    <Modal visible={peopleNetworkOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPeopleNetworkOpen(false)}>
      <View style={[styles.peopleNetworkScreen, isLight && styles.peopleNetworkScreenLight]}>
        <View style={styles.peopleNetworkHeader}><View><Text style={styles.peopleMapEyebrow}>YOUR PEOPLE</Text><Text style={[styles.peopleMapTitle, isLight && styles.textPrimaryLight]}>Connections</Text><Text style={[styles.peopleMapSubtitle, isLight && styles.textSecondaryLight]}>Contacts are opt-in. Friends are always mutual.</Text></View><TouchableOpacity style={styles.peopleMapClose} onPress={() => setPeopleNetworkOpen(false)} accessibilityLabel="Close connections"><Text style={styles.peopleMapCloseText}>×</Text></TouchableOpacity></View>
        <View style={styles.peopleNetworkTabs}>{([['FOR_YOU', 'For you'], ['FRIENDS', `Friends ${connections.length || ''}`], ['MUTUALS', 'Mutuals'], ['CONTACTS', `Contacts ${contactSuggestions.length || ''}`]] as const).map(([value, label]) => <TouchableOpacity key={value} onPress={() => setPeopleNetworkTab(value)} style={[styles.peopleNetworkTab, peopleNetworkTab === value && styles.peopleNetworkTabActive]} accessibilityRole="tab" accessibilityState={{ selected: peopleNetworkTab === value }}><Text style={[styles.peopleNetworkTabText, peopleNetworkTab === value && styles.peopleNetworkTabTextActive]}>{label}</Text></TouchableOpacity>)}</View>
        <ScrollView contentContainerStyle={styles.peopleNetworkList}>
          {peopleNetworkTab === 'CONTACTS' && !contactSuggestions.length ? <View style={styles.peopleNetworkEmpty}><Text style={[styles.peopleNetworkEmptyTitle, isLight && styles.textPrimaryLight]}>Find people you already know</Text><Text style={[styles.peopleNetworkEmptyCopy, isLight && styles.textSecondaryLight]}>Choose contacts to match by secure phone hash. Contacts who are not FairFares members stay private and never appear on the map.</Text><TouchableOpacity style={styles.peopleNetworkPrimary} onPress={() => void findPeopleFromContacts()}><Text style={styles.peopleNetworkPrimaryText}>{contactSuggestionsLoading ? 'Checking contacts…' : 'Find contacts'}</Text></TouchableOpacity></View> : null}
          {peopleNetworkTab === 'FRIENDS' && !connections.length ? <View style={styles.peopleNetworkEmpty}><Text style={[styles.peopleNetworkEmptyTitle, isLight && styles.textPrimaryLight]}>No friends yet</Text><Text style={[styles.peopleNetworkEmptyCopy, isLight && styles.textSecondaryLight]}>When both people accept a connection, they appear here. A phone contact never becomes a friend automatically.</Text></View> : null}
          {peopleNetworkTab === 'MUTUALS' && !peopleNetworkPeople.length ? <View style={styles.peopleNetworkEmpty}><Text style={[styles.peopleNetworkEmptyTitle, isLight && styles.textPrimaryLight]}>No mutual connections yet</Text><Text style={[styles.peopleNetworkEmptyCopy, isLight && styles.textSecondaryLight]}>Mutuals appear after you and other members build accepted FairFares connections.</Text></View> : null}
          {peopleNetworkTab === 'FOR_YOU' && !peopleNetworkPeople.length ? <View style={styles.peopleNetworkEmpty}><Text style={[styles.peopleNetworkEmptyTitle, isLight && styles.textPrimaryLight]}>People will appear here</Text><Text style={[styles.peopleNetworkEmptyCopy, isLight && styles.textSecondaryLight]}>Join a community, add your city, or connect with someone to receive relevant introductions.</Text></View> : null}
          {peopleNetworkPeople.map((person) => <TouchableOpacity key={person.id} style={[styles.peopleNetworkPerson, isLight && styles.peopleNetworkPersonLight]} onPress={() => openMemberProfile({ id: person.id, name: person.name, photoUrl: person.photoUrl })} accessibilityRole="button" accessibilityLabel={`View ${person.name}`}><UserAvatar photoUrl={person.photoUrl} style={styles.peopleNetworkAvatar} imageStyle={styles.peopleNetworkAvatarImage} fallback={<Text style={styles.peopleNetworkInitials}>{avatarInitials(person.name)}</Text>} /><View style={{ flex: 1 }}><Text style={[styles.peopleNetworkName, isLight && styles.textPrimaryLight]}>{person.name}</Text><Text style={[styles.peopleNetworkReason, isLight && styles.textSecondaryLight]}>{person.relationshipLabel}</Text></View><Text style={styles.peopleNetworkArrow}>›</Text></TouchableOpacity>)}
        </ScrollView>
        <TouchableOpacity style={styles.peopleNetworkMapButton} onPress={() => { setPeopleNetworkOpen(false); void openPeopleMap(); }}><Text style={styles.peopleNetworkMapButtonText}>Open people map</Text></TouchableOpacity>
      </View>
    </Modal>

    <Modal visible={peopleMapOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={closePeopleMap} onDismiss={handlePeopleMapDismiss}>
      <View style={[styles.peopleMapScreen, isLight && styles.peopleMapScreenLight]}>
          <View style={styles.peopleMapHeader}>
          <View style={styles.peopleMapHeaderCopy}><Text style={styles.peopleMapEyebrow}>FRIENDS MAP</Text><Text style={[styles.peopleMapTitle, isLight && styles.textPrimaryLight]}>People map</Text><Text style={[styles.peopleMapSubtitle, isLight && styles.textSecondaryLight]}>City-level only · never live locations</Text></View>
          <TouchableOpacity style={styles.peopleMapClose} onPress={closePeopleMap} accessibilityRole="button" accessibilityLabel="Close friends map"><Text style={styles.peopleMapCloseText}>×</Text></TouchableOpacity>
        </View>
        <View style={styles.peopleMapCanvas}>
          <PeopleMap onRegionChangeComplete={loadPeopleForMapViewport} onMemberPress={(member) => openMapMemberProfile({ id: member.id, name: member.name, photoUrl: member.photoUrl })} members={peopleMapMembers} focus={peopleMapCityPool || peopleMapInitialFocus || gasPreviewCoordinates} focusSelected={Boolean(peopleMapCityPool)} />
          {peopleMapMember ? <View style={styles.peopleMapMemberBackdrop}>
            <View style={[styles.peopleMapMemberCard, isLight && styles.peopleMapMemberCardLight]}>
              <TouchableOpacity style={[styles.peopleMapMemberClose, isLight && styles.peopleMapMemberCloseLight]} onPress={() => { peopleMapMemberRequestRef.current += 1; setPeopleMapMember(null); setPeopleMapMemberProfile(null); setPeopleMapMemberLoading(false); }} accessibilityRole="button" accessibilityLabel="Close member details"><Text style={[styles.peopleMapMemberCloseText, isLight && styles.peopleMapMemberCloseTextLight]}>×</Text></TouchableOpacity>
              <UserAvatar photoUrl={peopleMapMemberProfile?.photoUrl || peopleMapMember.photoUrl} style={styles.peopleMapMemberAvatar} imageStyle={styles.peopleMapMemberAvatarImage} fallback={<Text style={styles.peopleMapMemberInitials}>{avatarInitials(peopleMapMember.name)}</Text>} />
              <Text style={[styles.peopleMapMemberName, isLight && styles.textPrimaryLight]}>{peopleMapMemberProfile?.name || peopleMapMember.name}</Text>
              <Text style={[styles.peopleMapMemberMeta, isLight && styles.textSecondaryLight]}>{peopleMapMemberLoading ? "Loading profile…" : `${peopleMapMemberProfile?.listings.length || 0} active ${(peopleMapMemberProfile?.listings.length || 0) === 1 ? "listing" : "listings"}`}</Text>
              <TouchableOpacity style={styles.peopleMapMemberMessage} onPress={openMapChat} accessibilityRole="button" accessibilityLabel={`Message ${peopleMapMember.name}`}><Text style={styles.peopleMapMemberMessageText}>Message</Text></TouchableOpacity>
              {!peopleMapMemberLoading && peopleMapMemberProfile?.listings.length ? <ScrollView style={styles.peopleMapMemberListings} contentContainerStyle={styles.peopleMapMemberListingsContent}>
                {peopleMapMemberProfile.listings.map((listing) => <TouchableOpacity key={listing.id} style={[styles.peopleMapMemberListing, isLight && styles.peopleMapMemberListingLight]} onPress={() => openMapListing(listing.id)} accessibilityRole="button" accessibilityLabel={`Open ${listing.title}`}><View style={{ flex: 1 }}><Text style={[styles.peopleMapMemberListingTitle, isLight && styles.textPrimaryLight]} numberOfLines={2}>{listing.title}</Text><Text style={[styles.peopleMapMemberListingMeta, isLight && styles.textSecondaryLight]} numberOfLines={1}>{listing.addressLabel || listing.location} · {listing.rent}</Text></View><Text style={styles.peopleMapMemberListingArrow}>›</Text></TouchableOpacity>)}
              </ScrollView> : !peopleMapMemberLoading ? <Text style={[styles.peopleMapMemberEmpty, isLight && styles.textSecondaryLight]}>No active listings right now.</Text> : <ActivityIndicator color={theme.colors.brand} />}
            </View>
          </View> : null}
          {peopleMapPlannerOpen ? <View style={styles.peopleMapPlannerOverlay}>
            <Animated.View pointerEvents="none" style={[styles.peopleMapPlannerAura, { opacity: peopleMapPlannerPulse.interpolate({ inputRange: [0, 1], outputRange: [.26, .56] }), transform: [{ scale: peopleMapPlannerPulse.interpolate({ inputRange: [0, 1], outputRange: [.86, 1.13] }) }] }]} />
            <Animated.View style={[styles.peopleMapPlannerCard, isLight && styles.peopleMapPlannerCardLight, { opacity: peopleMapPlannerEntrance, transform: [{ translateY: peopleMapPlannerEntrance.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }, { scale: peopleMapPlannerEntrance.interpolate({ inputRange: [0, 1], outputRange: [.96, 1] }) }] }]}>
              <View style={styles.peopleMapPlannerTopline}>
                <View style={styles.peopleMapPlannerOrb}><Text style={styles.peopleMapPlannerOrbText}>✦</Text></View>
                <View style={styles.peopleMapPlannerToplineCopy}><Text style={styles.peopleMapPlannerEyebrow}>FIND YOUR PEOPLE</Text><Text style={[styles.peopleMapPlannerHint, isLight && styles.peopleMapPlannerHintLight]}>Search a city and optionally highlight your company</Text></View>
                <View style={styles.peopleMapPlannerProgress}><Text style={styles.peopleMapPlannerProgressText}>1 · 2</Text></View>
                <TouchableOpacity style={styles.peopleMapPlannerClose} onPress={() => { if (!relocationSaving) { if (peopleMapCityPool) setPeopleMapPlannerOpen(false); else setPeopleMapOpen(false); } }} disabled={relocationSaving} accessibilityRole="button" accessibilityLabel="Dismiss find your people setup"><Text style={styles.peopleMapPlannerCloseText}>×</Text></TouchableOpacity>
              </View>
              <View style={styles.peopleMapPlannerQuestion}><View style={styles.peopleMapPlannerStep}><Text style={styles.peopleMapPlannerStepText}>1</Text></View><View><Text style={[styles.peopleMapPlannerTitle, isLight && styles.textPrimaryLight]}>Which city do you want to explore?</Text><Text style={[styles.peopleMapPlannerQuestionHint, isLight && styles.peopleMapPlannerQuestionHintLight]}>Choose a city so we can look in the right place.</Text></View></View>
              <TextInput style={[styles.peopleMapPlannerInput, isLight && styles.peopleMapPlannerInputLight]} value={relocationCityDraft} onChangeText={setRelocationCityDraft} placeholder="Denver or Centennial, CO" placeholderTextColor={theme.colors.muted} autoCapitalize="words" />
              {relocationCityOptionsLoading ? <ActivityIndicator size="small" color={theme.colors.brand} style={styles.peopleMapPlannerLoader} /> : null}
              {relocationCityOptions.map((option) => <TouchableOpacity key={option} style={[styles.peopleMapPlannerOption, isLight && styles.peopleMapPlannerOptionLight]} onPress={() => { setRelocationCityDraft(option); setRelocationCityOptions([]); }} accessibilityRole="button" accessibilityLabel={`Choose ${option}`}><Text style={[styles.peopleMapPlannerOptionText, isLight && styles.textPrimaryLight]}>{option}</Text><Text style={styles.peopleMapPlannerOptionArrow}>›</Text></TouchableOpacity>)}
              <View style={styles.peopleMapPlannerReasonHeading}><View style={styles.peopleMapPlannerStep}><Text style={styles.peopleMapPlannerStepText}>2</Text></View><View><Text style={[styles.peopleMapPlannerLabel, isLight && styles.peopleMapPlannerLabelLight]}>Company or school (optional)</Text><Text style={[styles.peopleMapPlannerQuestionHint, isLight && styles.peopleMapPlannerQuestionHintLight]}>Choose work or school to highlight matching people.</Text></View></View>
              <View style={styles.peopleMapPlannerReasons}>{relocationReasons.slice(0, 2).map((item) => <TouchableOpacity key={item.value} style={[styles.peopleMapPlannerReason, isLight && styles.peopleMapPlannerReasonLight, relocationReasonDraft === item.value && styles.peopleMapPlannerReasonSelected]} onPress={() => setRelocationReasonDraft(item.value)} accessibilityRole="button" accessibilityState={{ selected: relocationReasonDraft === item.value }}><Text style={styles.peopleMapPlannerReasonIcon}>{item.value === "NEW_JOB" ? "💼" : "🎓"}</Text><Text style={[styles.peopleMapPlannerReasonText, isLight && styles.peopleMapPlannerReasonTextLight, relocationReasonDraft === item.value && styles.peopleMapPlannerReasonTextSelected]}>{item.label}</Text></TouchableOpacity>)}</View>
              {relocationReasonDraft ? <><Text style={[styles.peopleMapPlannerCompanyLabel, isLight && styles.peopleMapPlannerLabelLight]}>{relocationReasonDraft === "NEW_JOB" ? "Where will you work?" : "Which school or college?"}</Text><TextInput style={[styles.peopleMapPlannerInput, isLight && styles.peopleMapPlannerInputLight]} value={relocationCompanyDraft} onChangeText={setRelocationCompanyDraft} placeholder={relocationReasonDraft === "NEW_JOB" ? "Company name" : "School or college name"} placeholderTextColor={theme.colors.muted} autoCapitalize="words" /></> : null}
              <TouchableOpacity style={[styles.peopleMapPlannerAction, relocationSaving && styles.disabled]} onPress={() => void searchPeopleMap()} disabled={relocationSaving} accessibilityRole="button" accessibilityLabel="Show friends on the map"><Text style={styles.peopleMapPlannerActionIcon}>✦</Text><Text style={styles.peopleMapPlannerActionText}>{relocationSaving ? "Searching…" : "Show people on map"}</Text><Text style={styles.peopleMapPlannerActionArrow}>›</Text></TouchableOpacity>
            </Animated.View>
          </View> : null}
          {!peopleMapPlannerOpen ? <TouchableOpacity style={{ alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,.94)", paddingHorizontal: 12, paddingVertical: 9, margin: 12, borderRadius: 20, shadowColor: "#102a21", shadowOpacity: .12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }} onPress={() => setPeopleMapPlannerOpen(true)} accessibilityRole="button" accessibilityLabel="Search another city"><Text style={{ color: "#102b25", fontSize: 12, fontWeight: "900" }}>{peopleMapCityPool ? <><Text>{peopleMapCityPool.city} · </Text><Text style={{ color: "#6079ef" }}>{peopleMapIntentCounts.needPlace} need place</Text><Text> · </Text><Text style={{ color: "#087254" }}>{peopleMapIntentCounts.havePlace} have place</Text><Text> · </Text><Text style={{ color: "#d87e0c" }}>{peopleMapIntentCounts.roommates} roommates</Text></> : "Search a city"} <Text style={{ color: "#087254" }}>Change</Text></Text></TouchableOpacity> : null}
          {!peopleMapPlannerOpen && peopleMapCityPool && peopleMapCityPool.total > 0 ? <View style={{ position: "absolute", bottom: 76, left: 12, right: 12, maxHeight: "45%", borderRadius: 16, padding: 12, backgroundColor: "#fff" }}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={peopleMapListOpen ? "Hide city people" : "View city people"} onPress={() => setPeopleMapListOpen((value) => !value)}><Text style={{ color: "#102b25", fontWeight: "800" }}>{peopleMapListOpen ? "Hide people" : `View ${peopleMapCityPool.total} people`} {peopleMapListOpen ? "⌄" : "⌃"}</Text></TouchableOpacity>
            {peopleMapListOpen ? <ScrollView style={{ marginTop: 8 }} keyboardShouldPersistTaps="handled">
              {peopleMapCityPool.people.map((person) => <View key={person.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e6ece9" }}>
                <View style={{ width: person.companyMatch ? 44 : 34, height: person.companyMatch ? 44 : 34, borderRadius: 24, backgroundColor: person.companyMatch ? "#fff0c2" : "#e3f5ee", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#102b25", fontWeight: "800" }}>{person.name.slice(0, 1)}</Text></View>
                <View style={{ flex: 1 }}><Text style={{ color: "#102b25", fontWeight: "700" }}>{person.name}</Text><Text style={{ color: "#526560", fontSize: 12 }}>{person.moving ? `Moving from ${person.fromCity || "another city"} to ${peopleMapCityPool.city}` : `Living in ${peopleMapCityPool.city}`}</Text>{person.companyMatch ? <Text style={{ color: "#986100", fontSize: 12 }}>Company / school match</Text> : null}</View>
              </View>)}
              {peopleMapCityPool.nextOffset != null ? <TouchableOpacity disabled={peopleMapMoreBusy} onPress={() => void loadMoreMapPeople()} accessibilityRole="button"><Text style={{ color: "#087254", paddingVertical: 12, fontWeight: "800" }}>{peopleMapMoreBusy ? "Loading…" : "Load more people"}</Text></TouchableOpacity> : null}
            </ScrollView> : null}
          </View> : null}
          {!peopleMapPlannerOpen ? <View pointerEvents="none" style={styles.peopleMapLegend}>{peopleMapCityPool ? <><Text style={styles.peopleMapLegendText}>● Have place</Text><Text style={[styles.peopleMapLegendText, { color: "#6079ef" }]}>● Need place</Text><Text style={[styles.peopleMapLegendText, { color: "#d87e0c" }]}>● Roommates</Text></> : <><Text style={styles.peopleMapLegendText}>● Contacts</Text><Text style={styles.peopleMapLegendText}>● Mutuals</Text></>}<Text style={styles.peopleMapLegendHint}>Explore map</Text></View> : null}
        </View>
      </View>
    </Modal>

    <Modal visible={relocationPlannerOpen} transparent animationType="slide" onRequestClose={() => setRelocationPlannerOpen(false)}>
      <KeyboardAvoidingView style={styles.relocationPlannerBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.relocationPlannerSheet, isLight && styles.relocationPlannerSheetLight]}>
          <View style={styles.relocationPlannerHeader}><View style={styles.relocationPlannerHeaderCopy}><Text style={[styles.relocationPlannerTitle, isLight && styles.textPrimaryLight]}>Plan a move</Text><Text style={[styles.relocationPlannerSubtitle, isLight && styles.textSecondaryLight]}>Meet people moving to the same city and locals who want to help.</Text></View><TouchableOpacity onPress={() => setRelocationPlannerOpen(false)} accessibilityRole="button" accessibilityLabel="Close relocation plan"><Text style={styles.relocationPlannerClose}>×</Text></TouchableOpacity></View>
          <Text style={styles.relocationPlannerLabel}>Destination city</Text>
          <TextInput style={[styles.relocationPlannerInput, isLight && styles.relocationPlannerInputLight]} value={relocationCityDraft} onChangeText={setRelocationCityDraft} placeholder="Start typing a city" placeholderTextColor={theme.colors.muted} autoCapitalize="words" />
          {relocationCityOptionsLoading ? <ActivityIndicator size="small" color={theme.colors.brand} /> : null}
          {relocationCityOptions.map((option) => <TouchableOpacity key={option} style={styles.relocationPlannerOption} onPress={() => { setRelocationCityDraft(option); setRelocationCityOptions([]); }} accessibilityRole="button" accessibilityLabel={`Choose ${option}`}><Text style={[styles.relocationPlannerOptionText, isLight && styles.textPrimaryLight]}>{option}</Text><Text style={styles.relocationPlannerOptionArrow}>›</Text></TouchableOpacity>)}
          <Text style={styles.relocationPlannerLabel}>Why are you moving?</Text>
          <View style={styles.relocationReasonChoices}>{relocationReasons.map((item) => <TouchableOpacity key={item.value} style={[styles.relocationReasonChoice, relocationReasonDraft === item.value && styles.relocationReasonChoiceSelected]} onPress={() => setRelocationReasonDraft(item.value)} accessibilityRole="button" accessibilityState={{ selected: relocationReasonDraft === item.value }}><Text style={[styles.relocationReasonChoiceText, relocationReasonDraft === item.value && styles.relocationReasonChoiceTextSelected]}>{item.label}</Text></TouchableOpacity>)}</View>
          <View style={styles.relocationPlannerFields}>
            <View style={styles.relocationPlannerField}><Text style={styles.relocationPlannerLabel}>Target month</Text><TextInput style={[styles.relocationPlannerInput, isLight && styles.relocationPlannerInputLight]} value={relocationMonthDraft} onChangeText={setRelocationMonthDraft} placeholder="2026-12" placeholderTextColor={theme.colors.muted} keyboardType="numbers-and-punctuation" maxLength={7} /></View>
            <View style={styles.relocationPlannerField}><Text style={styles.relocationPlannerLabel}>{relocationReasonDraft === "NEW_JOB" ? "Company" : relocationReasonDraft === "SCHOOL_COLLEGE" ? "School or college" : "Organization"}</Text><TextInput style={[styles.relocationPlannerInput, isLight && styles.relocationPlannerInputLight]} value={relocationCompanyDraft} onChangeText={setRelocationCompanyDraft} placeholder="Optional" placeholderTextColor={theme.colors.muted} autoCapitalize="words" maxLength={120} /></View>
          </View>
          <Text style={[styles.relocationPlannerPrivacy, isLight && styles.textSecondaryLight]}>We show you members who chose the same destination or to welcome newcomers. Company or school only helps order introductions.</Text>
          <TouchableOpacity style={[styles.relocationPlannerSave, relocationSaving && styles.disabled]} onPress={() => void saveRelocationPlan()} disabled={relocationSaving} accessibilityRole="button" accessibilityLabel="See relocation connections"><Text style={styles.relocationPlannerSaveText}>{relocationSaving ? "Finding people…" : "See people"}</Text></TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    <Modal visible={composerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={requestCommunityComposerClose}>
      <View style={styles.modal}><View style={[styles.modalHead, { marginTop: modalHeaderTopInset }]}><TouchableOpacity onPress={requestCommunityComposerClose} accessibilityRole="button" accessibilityLabel="Cancel community post"><Text style={styles.cancel}>Cancel</Text></TouchableOpacity><Text style={styles.modalTitle}>{editingPostId ? "Edit post" : "Create post"}</Text><TouchableOpacity disabled={publishing} onPress={() => void publish()} accessibilityRole="button" accessibilityLabel={editingPostId ? "Save community post" : "Publish community post"} accessibilityState={{ disabled: publishing }}><Text style={[styles.publish, publishing && styles.disabled]}>{publishing ? videoUploadProgress !== null ? `Uploading ${Math.round(videoUploadProgress * 100)}%` : "Posting…" : editingPostId ? "Save" : "Post"}</Text></TouchableOpacity></View><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.formLabel}>What do you need?</Text><View style={styles.needGrid}>{categories.slice(1).map((item) => <TouchableOpacity key={item} style={[styles.needOption, form.category === item && styles.optionActive]} onPress={() => setForm((current) => ({ ...current, category: item as CommunityPost["category"] }))} accessibilityRole="button" accessibilityState={{ selected: form.category === item }}><Text style={styles.needIcon}>{categoryIcons[item]}</Text><Text style={[styles.needText, form.category === item && styles.optionTextActive]}>{categoryLabels[item]}</Text></TouchableOpacity>)}</View>
        {isNewHousingPost ? <View style={styles.detailFields}>
          <Text style={styles.fieldLabel}>Listing city</Text>
          <TextInput accessibilityLabel="Listing city" style={styles.input} value={listingCity} onChangeText={setListingCity} placeholder="Denver, CO" placeholderTextColor={theme.colors.muted} editable={!publishing} />
          {!user?.localCity ? <><Text style={styles.fieldLabel}>Which city do you currently live in?</Text>
            <TextInput accessibilityLabel="Current home city" style={styles.input} value={housingCurrentCity} onChangeText={setHousingCurrentCity} placeholder="Houston, TX" placeholderTextColor={theme.colors.muted} editable={!publishing} /></> : <Text style={styles.fieldHint}>Currently living in {housingCurrentCity}</Text>}
          {!housingCitiesDiffer ? <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: housingMoveVisible }} onPress={() => setHousingMoveVisible((value) => !value)}><Text style={styles.fieldLabel}>{housingMoveVisible ? "☑" : "☐"} Show me in this city on the people map</Text></TouchableOpacity> : null}
          {housingCitiesDiffer ? <>
            <Text style={styles.fieldLabel}>{form.category === "HAVE_PLACE" ? "Are you also moving" : "Are you moving"} from {housingCurrentCity} to {listingCity}?</Text>
            {(["YES", "NO"] as const).map((answer) => <TouchableOpacity key={answer} disabled={publishing} style={[styles.input, { justifyContent: "center" }, housingMoveAnswer === answer && styles.optionActive]} accessibilityRole="radio" accessibilityState={{ checked: housingMoveAnswer === answer }} onPress={() => { setHousingMoveAnswer(answer); setHousingMoveVisible(false); }}>
              <Text style={styles.fieldLabel}>{answer === "YES" ? "Yes, I’m moving there" : "No, this post doesn’t change where I live"}</Text>
            </TouchableOpacity>)}
            {housingMoveAnswer === "YES" ? <>
              <Text style={styles.fieldLabel}>Move month (optional)</Text>
              <TextInput accessibilityLabel="Move month" style={styles.input} value={housingMoveMonth} onChangeText={setHousingMoveMonth} placeholder="YYYY-MM" placeholderTextColor={theme.colors.muted} maxLength={7} editable={!publishing} />
              <TouchableOpacity disabled={publishing} accessibilityRole="checkbox" accessibilityState={{ checked: housingMoveVisible }} onPress={() => setHousingMoveVisible((value) => !value)}><Text style={styles.fieldLabel}>{housingMoveVisible ? "☑" : "☐"} Show my move on the people map</Text></TouchableOpacity>
              <Text style={styles.fieldHint}>Shows your destination city and where you’re moving from. No address or live location.</Text>
            </> : null}
          </> : null}
        </View> : null}
        {(form.category === "NEED_ROOMMATE" || form.category === "NEED_PLACE") ? <View style={styles.detailFields}>
          <Text style={styles.formLabel}>Housing details <Text style={styles.formLabelOptional}>Optional</Text></Text>
          <Text style={styles.fieldLabel}>Monthly budget</Text>
          <TextInput style={styles.input} value={form.details.budget} onChangeText={(value) => setDetailField("budget", value)} placeholder="Example: $900 per month" placeholderTextColor={theme.colors.muted} />
          <Text style={styles.fieldLabel}>Move-in date</Text>
          <TextInput style={styles.input} value={form.details.moveInDate} onChangeText={(value) => setDetailField("moveInDate", value)} placeholder="Example: August 1" placeholderTextColor={theme.colors.muted} />
          <Text style={styles.fieldLabel}>Preferences</Text>
          <TextInput style={styles.input} value={form.details.preference} onChangeText={(value) => setDetailField("preference", value)} placeholder="Example: Quiet home, pet-friendly" placeholderTextColor={theme.colors.muted} />
        </View> : null}
        {form.category === "HAVE_PLACE" ? <View style={styles.detailFields}>
          <Text style={styles.formLabel}>Place details <Text style={styles.formLabelOptional}>Optional</Text></Text>
          <Text style={styles.fieldLabel}>Monthly rent</Text>
          <TextInput style={styles.input} value={form.details.rent} onChangeText={(value) => setDetailField("rent", value)} placeholder="Example: $950 per month" placeholderTextColor={theme.colors.muted} />
          <Text style={styles.fieldLabel}>Available from</Text>
          <TextInput style={styles.input} value={form.details.availableDate} onChangeText={(value) => setDetailField("availableDate", value)} placeholder="Example: August 1" placeholderTextColor={theme.colors.muted} />
          <Text style={styles.fieldLabel}>Room type</Text>
          <TextInput style={styles.input} value={form.details.roomType} onChangeText={(value) => setDetailField("roomType", value)} placeholder="Example: Private room" placeholderTextColor={theme.colors.muted} />
        </View> : null}
        {form.category === "CARPOOL_RIDE" ? <View style={styles.detailFields}>
          <Text style={styles.formLabel}>Ride details <Text style={styles.formLabelOptional}>Optional</Text></Text>
          <Text style={styles.fieldLabel}>Leaving from</Text>
          <TextInput style={styles.input} value={form.details.origin} onChangeText={(value) => setDetailField("origin", value)} placeholder="Example: Aurora" placeholderTextColor={theme.colors.muted} />
          <Text style={styles.fieldLabel}>Going to</Text>
          <TextInput style={styles.input} value={form.details.destination} onChangeText={(value) => setDetailField("destination", value)} placeholder="Example: Downtown Denver" placeholderTextColor={theme.colors.muted} />
          <Text style={styles.fieldLabel}>When are you travelling?</Text>
          <View style={styles.inlineFields}>
            <TextInput style={[styles.input, styles.inlineInput]} value={form.details.travelDate} onChangeText={(value) => setDetailField("travelDate", value)} placeholder="Date" placeholderTextColor={theme.colors.muted} />
            <TextInput style={[styles.input, styles.inlineInput]} value={form.details.travelTime} onChangeText={(value) => setDetailField("travelTime", value)} placeholder="Time" placeholderTextColor={theme.colors.muted} />
            <TextInput style={[styles.input, { width: 78 }]} value={form.details.seats} onChangeText={(value) => setDetailField("seats", value.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" placeholder="Seats" placeholderTextColor={theme.colors.muted} />
          </View>
        </View> : null}
        <View style={styles.fieldGroup}>
          <View style={styles.fieldHeader}><Text style={styles.fieldLabel}>Post title <Text style={styles.fieldRequired}>Required</Text></Text><Text style={styles.fieldHint}>One short summary people can scan.</Text></View>
          <TextInput style={[styles.titleInput, postValidation.title && styles.fieldInputInvalid]} value={form.title} onChangeText={(title) => updatePostTextField("title", title)} maxLength={140} placeholder={fieldExamples.title} placeholderTextColor={theme.colors.muted} accessibilityLabel="Post title" accessibilityHint={postValidation.title || "Use at least 6 characters."} />
          {postValidation.title ? <Text style={styles.fieldError}>{postValidation.title}</Text> : null}
        </View>
        <View style={styles.fieldGroup}>
          <View style={styles.fieldHeader}><Text style={styles.fieldLabel}>Details <Text style={styles.fieldRequired}>Required</Text></Text><Text style={styles.fieldHint}>The more useful context you share, the better replies you will get.</Text></View>
          <TextInput style={[styles.bodyInput, postValidation.body && styles.fieldInputInvalid]} value={form.body} onChangeText={(body) => updatePostTextField("body", body)} multiline maxLength={3000} textAlignVertical="top" placeholder={fieldExamples.body} placeholderTextColor={theme.colors.muted} accessibilityLabel="Post details" accessibilityHint={postValidation.body || "Use at least 12 characters."} />
          {postValidation.body ? <Text style={styles.fieldError}>{postValidation.body}</Text> : null}
        </View>
        <View style={styles.counter}><Text style={styles.counterText}>{form.body.length}/3000</Text></View>
        <View style={[styles.attachmentPanel, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
          <View><Text style={styles.attachmentTitle}>Add to your post <Text style={styles.attachmentOptional}>Optional</Text></Text><Text style={styles.attachmentHint}>Add up to 4 photos, or combine photos with one video.</Text></View>
          <TextInput style={styles.input} value={form.linkUrl} onChangeText={(linkUrl) => setForm((current) => ({ ...current, linkUrl }))} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="🔗 Paste a website link (optional)" placeholderTextColor={theme.colors.muted} />
          {composerLinkPreviewUrl ? <View style={styles.composerLinkPreview}>
            <View style={styles.composerLinkPreviewHead}>
              <View><Text style={styles.composerLinkPreviewTitle}>Link preview</Text><Text style={styles.composerLinkPreviewHint}>{composerLinkIsFromField ? "This is how your link will appear" : "Link found in your post details"}</Text></View>
              {composerLinkIsFromField ? <TouchableOpacity onPress={() => setForm((current) => ({ ...current, linkUrl: "" }))} accessibilityRole="button" accessibilityLabel="Remove website link"><Text style={styles.composerLinkRemove}>Remove</Text></TouchableOpacity> : null}
            </View>
            <SharedLinkCard url={composerLinkPreviewUrl} />
          </View> : null}
          {form.media.length ? <ScrollView horizontal contentContainerStyle={styles.imageRow}>{form.media.map((item, index) => <TouchableOpacity key={`${item.url.slice(0, 24)}-${index}`} onPress={() => setForm((current) => ({ ...current, media: current.media.filter((_, target) => target !== index) }))}>{item.type === "VIDEO" ? <View style={styles.previewVideo}><Text style={styles.previewVideoIcon}>▶</Text><Text style={styles.previewVideoText}>Video</Text></View> : <Image source={{ uri: absoluteUrl(item.url) }} style={styles.previewImage} />}<View style={styles.removeImage}><Text style={styles.removeImageText}>×</Text></View></TouchableOpacity>)}</ScrollView> : null}
          <TouchableOpacity style={[styles.addPhoto, publishing && { opacity: 0.6 }]} onPress={publishing ? undefined : chooseCommunityAttachment} disabled={publishing} accessibilityRole="button" accessibilityLabel="Add photos or video" accessibilityState={{ disabled: publishing }}><Text style={styles.addPhotoIcon}>▣</Text><View style={styles.addPhotoCopy}><Text style={styles.addPhotoTitle}>Add photos or video</Text><Text style={styles.addPhotoBody}>{videoUploadProgress !== null ? `${videoUploadPath === "preparing" ? "Making video color compatible" : videoUploadPath === "direct-r2" ? "Uploading directly to secure storage" : videoUploadPath === "relay" ? "Uploading through FairFares" : "Preparing direct upload"} · ${Math.round(videoUploadProgress * 100)}%` : form.media.some((item) => item.pendingVideo) ? "Video ready · uploads when you post" : form.media.length ? `${form.media.length} of 4 selected · One video max · Tap an attachment to remove it` : "Choose up to 4 photos or one video"}</Text></View><Text style={styles.addPhotoChevron}>›</Text></TouchableOpacity>
          {videoUploadProgress !== null ? <View style={{ height: 7, borderRadius: 999, overflow: "hidden", backgroundColor: isLight ? "#bbf7d0" : "#285f47" }}><View style={{ width: `${Math.max(2, Math.round(videoUploadProgress * 100))}%`, height: "100%", borderRadius: 999, backgroundColor: theme.colors.brand }} /></View> : null}
        </View>
        <View style={styles.fieldGroup}>
          <View style={styles.fieldHeader}><Text style={styles.fieldLabel}>Location or area <Text style={styles.fieldOptional}>Optional</Text></Text><Text style={styles.fieldHint}>This helps nearby members find your post.</Text></View>
          <TextInput style={styles.input} value={form.area} onChangeText={(area) => setForm((current) => ({ ...current, area }))} placeholder={`Example: Near downtown · ${city}`} placeholderTextColor={theme.colors.muted} />
        </View>
        {groupOptions.length ? <><Text style={styles.formLabel}>Audience</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}><TouchableOpacity style={[styles.chip, !form.communityId && styles.chipActive]} onPress={() => setForm((current) => ({ ...current, communityId: "" }))}><Text style={[styles.chipText, !form.communityId && styles.chipTextActive]}>Everyone</Text></TouchableOpacity>{groupOptions.map((group) => <TouchableOpacity key={group.id} style={[styles.chip, form.communityId === group.id && styles.chipActive]} onPress={() => setForm((current) => ({ ...current, communityId: group.id }))}><Text style={[styles.chipText, form.communityId === group.id && styles.chipTextActive]}>{group.name}</Text></TouchableOpacity>)}</ScrollView></> : null}
        <Text style={[styles.safety, { backgroundColor: theme.colors.panel2 }]}>Keep personal phone numbers, exact home addresses, and sensitive documents out of public posts.</Text>
      </ScrollView></View>
    </Modal>

    <Modal visible={Boolean(detail)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetail(null)} onDismiss={handleDetailDismiss}>
      <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === "ios" ? "padding" : "height"}>{expandedReactionTarget ? <Pressable style={styles.reactionDismissLayer} onPress={() => { reactionLongPressTarget.current = ""; setExpandedReactionTarget(""); }} accessibilityLabel="Close reactions" /> : null}<View style={[styles.modalHead, { marginTop: modalHeaderTopInset }]}><TouchableOpacity onPress={() => setDetail(null)}><Text style={[styles.cancel, isLight && styles.textBodyLight]}>Close</Text></TouchableOpacity><Text style={[styles.modalTitle, isLight && styles.textPrimaryLight]}>Community post</Text><TouchableOpacity onPress={() => detail && (detail.canEdit ? managePost(detail) : report(detail))}><Text style={detail?.canEdit ? styles.publish : styles.danger}>{detail?.canEdit ? "Manage" : "Report"}</Text></TouchableOpacity></View>
      <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>{detail ? <>
        {renderPost(detail)}
        <Text style={[styles.answersTitle, isLight && styles.textPrimaryLight]}>{detail.answerCount} {detail.answerCount === 1 ? "comment" : "comments"}</Text>
        {detail.answers?.filter((item) => !item.parentAnswerId).map((item) => renderAnswer(item, detail.answers || []))}
        {detail.canAnswer && !answerReplyTarget && !editingAnswerId ? <View style={styles.answerComposer}>{!user ? <View style={styles.guestAllowance}><Text style={styles.guestAllowanceName}>{guestIdentity || "Guest"}</Text><Text style={styles.guestAllowanceCount}>{guestRemaining} of 6 guest messages left</Text></View> : null}<TextInput style={styles.answerInput} value={answer} onChangeText={setAnswer} multiline placeholder={guestRemaining > 0 || user ? "Write a comment…" : "Write your comment, then sign up to post…"} placeholderTextColor={theme.colors.muted} editable /><TouchableOpacity style={[styles.sendAnswer, !answer.trim() && styles.disabled]} disabled={!answer.trim() || detailBusy} onPress={() => void submitAnswer()}><Text style={styles.sendAnswerText}>{detailBusy ? "…" : "Post comment"}</Text></TouchableOpacity>{!user ? <TouchableOpacity onPress={() => setGuestBenefitsOpen(true)}><Text style={styles.guestSignupHint}>Sign up for unlimited comments and replies</Text></TouchableOpacity> : null}</View> : !detail.canAnswer ? <Text style={styles.locked}>This discussion is closed to new comments.</Text> : null}
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

    <Modal visible={Boolean(photoViewer)} animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={closePhotoViewer} onDismiss={handlePhotoViewerDismiss}>
      <View style={styles.photoViewerBackdrop}>
        <View style={[styles.photoViewerHeader, { paddingTop: Math.max(safeAreaInsets.top, 12) }]}><TouchableOpacity style={styles.photoViewerClose} onPress={closePhotoViewer} accessibilityRole="button" accessibilityLabel="Close photos"><Text style={styles.photoViewerCloseText}>Close</Text></TouchableOpacity><Text style={styles.photoViewerCounter}>{photoViewer ? `${photoViewer.index + 1} of ${photoViewer.images.length}` : ""}</Text><View style={styles.photoViewerHeaderSpacer} /></View>
        {photoViewer ? <ZoomableCommunityPhoto uri={photoViewer.images[photoViewer.index]} /> : null}
        {photoViewer && photoViewer.images.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoViewerThumbs}>{photoViewer.images.map((image, index) => <TouchableOpacity key={`${image}-${index}`} onPress={() => setPhotoViewer((current) => current ? { ...current, index } : current)} style={[styles.photoViewerThumb, index === photoViewer.index && styles.photoViewerThumbActive]} accessibilityRole="button" accessibilityLabel={`View photo ${index + 1}`}><Image source={{ uri: absoluteUrl(image) }} style={styles.photoViewerThumbImage} /></TouchableOpacity>)}</ScrollView> : null}
        <Text style={styles.photoViewerHint}>Pinch with two fingers to zoom · Drag to move</Text>
      </View>
    </Modal>

    <MemberProfileSheet
      ref={memberProfileSheetRef}
      viewerId={Number(user?.id || 0)}
      isSignedIn={Boolean(user)}
      onRequireLogin={onRequireLogin}
      onOpenHousing={onOpenHousing}
      onOpenUserChat={onOpenUserChat}
    />
  </View>;
}

const styles = StyleSheet.create({
  unifiedFeed: { gap: 3 }, feedRowSeparator: { height: 3 }, housingSection: { gap: 3 }, housingPostCard: { backgroundColor: theme.colors.panel, borderTopColor: theme.colors.line, borderBottomColor: theme.colors.line, borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: 13, paddingVertical: 16, gap: 12 }, housingPostBadge: { maxWidth: 128, backgroundColor: "#173a2d", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 }, housingPostBadgeText: { color: "#8ee4bf", fontWeight: "900", fontSize: 9, textTransform: "uppercase" }, housingPostImage: { width: 280, height: 190, borderRadius: 5, backgroundColor: theme.colors.panel2 }, housingPostPhotoFallback: { height: 126, borderRadius: 5, alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#122d24", borderWidth: 1, borderColor: "#244c3d" }, housingPostPhotoIcon: { fontSize: 35 }, housingPostPhotoCopy: { color: "#9dd9c2", fontWeight: "800", fontSize: 12 }, housingFacts: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, housingFact: { maxWidth: "48%", minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, backgroundColor: theme.colors.panel2, paddingHorizontal: 10 }, housingFactIcon: { fontSize: 12 }, housingFactText: { flexShrink: 1, color: theme.colors.soft, fontWeight: "700", fontSize: 11 }, housingPostActions: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 11 }, housingDetailsButton: { minHeight: 37, justifyContent: "center", borderRadius: 8, backgroundColor: theme.colors.brand, paddingHorizontal: 15 }, housingDetailsButtonText: { color: "#06291e", fontWeight: "900", fontSize: 12 }, housingShareButton: { minHeight: 37, justifyContent: "center", borderRadius: 8, backgroundColor: theme.colors.panel2, paddingHorizontal: 13 }, housingShareButtonText: { color: theme.colors.soft, fontWeight: "800", fontSize: 12 }, housingExpiry: { marginLeft: "auto", color: theme.colors.muted, fontSize: 10, fontWeight: "700" }, housingCopy: { flex: 1 }, housingArrow: { color: theme.colors.muted, fontSize: 28, fontWeight: "300" }, addHousingCard: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11, padding: 11, marginTop: 8, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.brand, backgroundColor: "rgba(24,168,120,.08)" }, addHousingIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.brand }, addHousingPlus: { color: "#06291e", fontSize: 25, fontWeight: "700" }, addHousingTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "900" }, addHousingBody: { color: theme.colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  heroGlow: { position: "absolute", right: -40, bottom: -70, width: 260, height: 150, borderRadius: 130, backgroundColor: "rgba(16,108,87,.18)" }, accentLeft: { position: "absolute", left: 25, top: 19, color: "#ffad24", fontSize: 25, fontWeight: "900", transform: [{ rotate: "-25deg" }] }, accentRight: { position: "absolute", right: 87, top: 17, color: "#18a681", fontSize: 21, fontWeight: "900", transform: [{ rotate: "20deg" }] }, askBadgeTail: { position: "absolute", left: 9, bottom: -7, width: 18, height: 18, backgroundColor: "#ef3e42", transform: [{ rotate: "25deg" }] }, communityTagStitch: { position: "absolute", top: 4, bottom: 4, left: 5, right: 5, borderWidth: 1, borderStyle: "dashed", borderColor: "#ed9d38", borderRadius: 7 }, subtitleAccent: { color: theme.colors.brand, fontWeight: "900" },
  resolvedBadge: { alignSelf: "flex-start", borderRadius: 999, backgroundColor: "#173b2d", paddingHorizontal: 11, paddingVertical: 6 }, resolvedText: { color: "#8ce6bf", fontWeight: "800", fontSize: 12 }, detailFacts: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, fact: { minWidth: "30%", flexGrow: 1, borderRadius: 12, backgroundColor: theme.colors.panel2, padding: 10 }, factWide: { width: "100%", flexGrow: 0 }, factLabel: { color: theme.colors.muted, fontSize: 9, textTransform: "uppercase" }, factValue: { color: theme.colors.text, fontWeight: "800", fontSize: 12, marginTop: 3 }, inlineFields: { flexDirection: "row", gap: 8 }, inlineInput: { flex: 1 },
  postAuthorSoft: { fontWeight: "700" }, postTitleSoft: { fontWeight: "700" }, postBadgeSoft: { fontWeight: "600" },
  authorMetaLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }, postMeta: { flex: 1, minWidth: 0, marginTop: 0 },
  authorRatingBadge: { color: "#8b5a00", backgroundColor: "rgba(255,191,0,0.18)", borderRadius: 999, overflow: "hidden", paddingHorizontal: 6, paddingVertical: 2, fontSize: 9, lineHeight: 11, fontWeight: "900" },
  screen: { flex: 1, backgroundColor: theme.colors.bg }, content: { width: "100%", alignSelf: "center", padding: 12, gap: 12 },
  quickComposer: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 6, padding: 8, backgroundColor: theme.colors.panel, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.line }, composerAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.panel2 }, composerAvatarImage: { borderRadius: 21 }, composerPrompt: { flex: 1, minWidth: 84, minHeight: 42, justifyContent: "center", paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel2 }, composerPromptText: { color: theme.colors.muted, fontSize: 13 }, composerAsk: { minHeight: 42, justifyContent: "center", borderRadius: 10, backgroundColor: theme.colors.brand, paddingHorizontal: 13 }, composerAskText: { color: "#06291e", fontSize: 12, fontWeight: "900" }, feedControls: { minHeight: 66, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.line }, feedLocationButton: { flex: 1, minHeight: 58, justifyContent: "center" }, relevanceTitle: { color: theme.colors.text, fontSize: 21, fontWeight: "800" }, cityChevron: { color: theme.colors.brand, fontSize: 17, fontWeight: "700" }, relevanceSubtitle: { color: theme.colors.muted, fontSize: 11, marginTop: 3 }, filterButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: theme.colors.panel }, filterIcon: { color: theme.colors.soft, fontSize: 23, transform: [{ rotate: "90deg" }] }, localFeedNote: { paddingHorizontal: 4, paddingVertical: 6 }, localFeedNoteTitle: { color: theme.colors.soft, fontSize: 13, fontWeight: "800" }, localFeedNoteBody: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 }, nationalSectionHead: { marginTop: 8, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.line, backgroundColor: "transparent" }, nationalEyebrow: { color: theme.colors.brand, fontSize: 7, fontWeight: "800", letterSpacing: .9 }, nationalTitle: { color: theme.colors.text, fontSize: 15, lineHeight: 18, fontWeight: "800", marginTop: 1 }, nationalBody: { color: theme.colors.muted, fontSize: 9, lineHeight: 12, marginTop: 2 }, nationalIcon: { fontSize: 19 }, communityReviewCard: { minHeight: 92, marginTop: 6, marginBottom: 6, marginHorizontal: 1, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 18, borderWidth: 1, borderColor: "rgba(183,205,214,0.48)", backgroundColor: "#ffffff", flexDirection: "row", alignItems: "center", gap: 10, shadowColor: "#12382d", shadowOpacity: 0.10, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 }, communityReviewCardLight: { backgroundColor: "#ffffff", borderColor: "rgba(120,151,163,0.34)" }, communityReviewAvatarWrap: { width: 50, height: 50, borderRadius: 25, padding: 2.5, backgroundColor: "#12c989", shadowColor: "#0aa66d", shadowOpacity: 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 }, communityReviewAvatar: { width: 45, height: 45, borderRadius: 23, backgroundColor: "#ecfdf5" }, communityReviewAvatarImage: { borderRadius: 23 }, communityReviewAvatarFallback: { color: "#065f46", fontSize: 18, fontWeight: "900" }, communityReviewCopy: { flex: 1, minWidth: 0 }, communityReviewTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }, communityReviewName: { flex: 1, minWidth: 0, color: "#101820", fontSize: 13, lineHeight: 16, fontWeight: "900" }, communityReviewStars: { color: "#ffae00", fontSize: 11, letterSpacing: 0.3, fontWeight: "900" }, communityReviewLocation: { color: "#1ecf8d", fontSize: 10, lineHeight: 13, fontWeight: "900", marginTop: 2 }, communityReviewQuote: { color: "#1a1d22", fontSize: 12, lineHeight: 16, fontWeight: "800", marginTop: 4 }, communityReviewPill: { position: "absolute", alignSelf: "center", bottom: 5, width: 24, height: 6, borderRadius: 999, backgroundColor: "#12d69a", left: "50%", marginLeft: -12 }, communityReviewDots: { position: "absolute", left: 0, right: 0, bottom: 5, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 4 }, communityReviewDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "rgba(15,23,42,0.18)" }, communityReviewDotActive: { width: 18, backgroundColor: "#12d69a" }, feedEndNote: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", paddingHorizontal: 20, paddingVertical: 12 },
  relocationConnections: { marginTop: 12, marginBottom: 3, borderRadius: 18, borderWidth: 1, borderColor: "rgba(76, 202, 154, 0.46)", backgroundColor: "rgba(24, 73, 58, 0.30)", paddingVertical: 12 },
  relocationConnectionsLight: { backgroundColor: "#f4fffa", borderColor: "#a9e7cf" },
  peopleSuggestions: { position: "relative", overflow: "hidden", marginTop: 12, marginBottom: 3, borderRadius: 21, borderWidth: 1, borderColor: "rgba(116, 145, 255, 0.48)", backgroundColor: "rgba(27, 43, 91, 0.34)", paddingVertical: 14, shadowColor: "#0b173f", shadowOpacity: 0.20, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 4 },
  peopleSuggestionsLight: { backgroundColor: "#f7f9ff", borderColor: "#cad7ff", shadowColor: "#667db8", shadowOpacity: 0.15 },
  peopleNetworkScreen: { flex: 1, backgroundColor: theme.colors.bg }, peopleNetworkScreenLight: { backgroundColor: "#f7f9fb" },
  peopleNetworkHeader: { minHeight: 92, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingTop: 15, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  peopleNetworkTabs: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.colors.line }, peopleNetworkTab: { flex: 1, minHeight: 35, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: theme.colors.panel2, paddingHorizontal: 5 }, peopleNetworkTabActive: { backgroundColor: theme.colors.brand }, peopleNetworkTabText: { color: theme.colors.muted, fontSize: 10, fontWeight: "900" }, peopleNetworkTabTextActive: { color: "#06291e" },
  peopleNetworkList: { flexGrow: 1, gap: 8, padding: 12, paddingBottom: 96 }, peopleNetworkEmpty: { alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 42 }, peopleNetworkEmptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900", textAlign: "center" }, peopleNetworkEmptyCopy: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, fontWeight: "600", textAlign: "center" },
  peopleNetworkPrimary: { minHeight: 46, marginTop: 7, alignSelf: "stretch", alignItems: "center", justifyContent: "center", borderRadius: 23, backgroundColor: theme.colors.brand }, peopleNetworkPrimaryText: { color: "#06291e", fontSize: 13, fontWeight: "900" },
  peopleNetworkPerson: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel, paddingHorizontal: 11, paddingVertical: 9 }, peopleNetworkPersonLight: { borderColor: "#e1e7ec", backgroundColor: "#fff" }, peopleNetworkAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#d8f7e8" }, peopleNetworkAvatarImage: { borderRadius: 22 }, peopleNetworkInitials: { color: "#087254", fontSize: 15, fontWeight: "900" }, peopleNetworkName: { color: theme.colors.text, fontSize: 14, fontWeight: "900" }, peopleNetworkReason: { color: "#5c74d9", marginTop: 3, fontSize: 11, fontWeight: "800" }, peopleNetworkArrow: { color: theme.colors.brand, fontSize: 26, lineHeight: 28 },
  peopleNetworkMapButton: { minHeight: 52, alignItems: "center", justifyContent: "center", marginHorizontal: 12, marginBottom: 16, borderRadius: 16, backgroundColor: "#12382e" }, peopleNetworkMapButtonText: { color: "#bdf6dc", fontSize: 14, fontWeight: "900" },
  peopleDiscoveryBubbles: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  peopleDiscoveryBubble: { position: "absolute", borderRadius: 999, backgroundColor: "#7d9dff" },
  peopleDiscoveryBubbleOne: { width: 142, height: 142, right: -57, top: -75, opacity: 0.42 },
  peopleDiscoveryBubbleTwo: { width: 90, height: 90, left: -47, bottom: -50, opacity: 0.32 },
  peopleDiscoveryBubbleThree: { width: 28, height: 28, right: 30, bottom: 33, opacity: 0.38 },
  peopleMapReopen: { minHeight: 46, marginHorizontal: 10, marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, borderColor: "rgba(123, 151, 255, .40)", backgroundColor: "rgba(245,248,255,.78)", paddingHorizontal: 12 },
  peopleMapReopenLight: { backgroundColor: "rgba(255,255,255,.74)", borderColor: "#d8e1fb" },
  peopleMapReopenIcon: { color: "#5579ee", fontSize: 15, fontWeight: "900" },
  peopleMapReopenText: { color: theme.colors.text, fontSize: 12, fontWeight: "900" },
  peopleMapReopenHint: { flex: 1, color: theme.colors.muted, fontSize: 10, fontWeight: "700" },
  peopleMapReopenChevron: { color: "#20ad7d", fontSize: 22, lineHeight: 23, fontWeight: "700" },
  peopleDiscoveryContent: { position: "relative", zIndex: 1 },
  peopleDiscoveryEyebrow: { color: "#7797ff", fontSize: 8, lineHeight: 10, fontWeight: "900", letterSpacing: 1.05, marginBottom: 2 },
  floatingPeopleStage: { position: "relative", height: 282, marginTop: 8, overflow: "hidden" },
  floatingPeopleStageCompact: { position: "relative", height: 126, marginHorizontal: 12, marginBottom: 7, overflow: "hidden" },
  floatingPeopleEmpty: { minHeight: 112, justifyContent: "center", paddingHorizontal: 24 },
  floatingPeopleEmptyText: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  floatingPerson: { position: "absolute", alignItems: "center" },
  floatingPersonTap: { alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(77, 221, 172, 0.95)", backgroundColor: "rgba(10, 61, 51, 0.92)", shadowColor: "#0c7e5d", shadowOpacity: 0.30, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  floatingPersonTapLight: { borderColor: "#20c995", backgroundColor: "#ffffff", shadowColor: "#339b7d", shadowOpacity: 0.23 },
  floatingPersonAvatar: { backgroundColor: "#d8f7e8" },
  floatingPersonInitials: { color: "#087254", fontSize: 17, fontWeight: "900" },
  floatingPersonStatus: { position: "absolute", right: -1, bottom: 2, width: 23, height: 23, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#0e3028", backgroundColor: "#f7bd1d" },
  floatingPersonStatusText: { color: "#533b00", fontSize: 11, lineHeight: 13, fontWeight: "900" },
  floatingPersonNameTag: { width: "100%", marginTop: 6, alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: "rgba(130, 163, 255, 0.32)", backgroundColor: "rgba(13, 29, 72, 0.72)", paddingHorizontal: 5, paddingVertical: 4 },
  floatingPersonNameTagLight: { borderColor: "rgba(153, 181, 237, 0.42)", backgroundColor: "rgba(255,255,255,0.90)" },
  floatingPersonName: { width: "100%", color: "#ffffff", fontSize: 10, lineHeight: 12, fontWeight: "900", textAlign: "center" },
  floatingPersonReason: { width: "100%", color: "#7ce0c0", fontSize: 8, lineHeight: 10, fontWeight: "800", textAlign: "center", marginTop: 1 },
  floatingPersonDismiss: { position: "absolute", right: 0, top: -3, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.48)", backgroundColor: "rgba(23,31,47,0.84)" },
  floatingPersonDismissText: { color: "#ffffff", fontSize: 16, lineHeight: 18, fontWeight: "500" },
  peopleDiscoveryInlineGuide: { position: "relative", marginTop: 8, marginHorizontal: 12, marginBottom: 6, borderRadius: 18, borderWidth: 1, borderColor: "rgba(126, 157, 255, 0.38)", backgroundColor: "rgba(12, 30, 72, 0.76)", padding: 12 },
  peopleDiscoveryInlineGuideLight: { borderColor: "#d0dcff", backgroundColor: "rgba(255,255,255,0.90)" },
  peopleDiscoveryInlineGuideRow: { minHeight: 101, flexDirection: "row", alignItems: "center", gap: 9, paddingRight: 19 },
  peopleDiscoveryGuidePair: { width: 91, height: 91, position: "relative", alignItems: "center", justifyContent: "center" },
  peopleDiscoveryGuideAvatarWrap: { position: "absolute", left: 1, top: 10, width: 59, height: 59, borderRadius: 30, padding: 3, borderWidth: 2, borderColor: "#2ecb99", backgroundColor: "#ffffff" },
  peopleDiscoveryGuideAvatarSecond: { left: 33, top: 22, borderColor: "#8ca7ff" },
  peopleDiscoveryGuideAvatar: { width: 49, height: 49, borderRadius: 25, backgroundColor: "#d8f7e8" },
  peopleDiscoveryGuideAvatarImage: { borderRadius: 25 },
  peopleDiscoveryGuideAvatarInitials: { color: "#087254", fontSize: 16, fontWeight: "900" },
  peopleDiscoveryGuidePairLink: { position: "absolute", left: 36, top: 56, width: 23, height: 23, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#0e3028", backgroundColor: "#f7bd1d", zIndex: 3 },
  peopleDiscoveryGuidePairLinkText: { color: "#503900", fontSize: 12, lineHeight: 14, fontWeight: "900" },
  peopleDiscoveryInlineGuideCopy: { flex: 1, minWidth: 0 },
  peopleDiscoveryInlineGuideEyebrow: { color: "#86a2ff", fontSize: 8, fontWeight: "900", letterSpacing: .9 },
  peopleDiscoveryInlineGuideTitle: { color: "#ffffff", fontSize: 14, lineHeight: 17, fontWeight: "900", marginTop: 2 },
  peopleDiscoveryInlineGuideBody: { color: "#bdc9de", fontSize: 9, lineHeight: 12, marginTop: 3 },
  peopleDiscoveryInlineGuideAction: { alignSelf: "flex-start", minHeight: 25, justifyContent: "center", marginTop: 6, borderRadius: 13, backgroundColor: "#24c995", paddingHorizontal: 9 },
  peopleDiscoveryInlineGuideActionText: { color: "#063427", fontSize: 10, fontWeight: "900" },
  peopleDiscoveryInlineGuideClose: { position: "absolute", top: 8, right: 8, width: 25, height: 25, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "rgba(255,255,255,0.12)", zIndex: 4 },
  peopleDiscoveryInlineGuideCloseText: { color: "#d6e1f6", fontSize: 21, lineHeight: 24, fontWeight: "500" },
  peopleMapScreen: { flex: 1, backgroundColor: theme.colors.bg },
  peopleMapScreenLight: { backgroundColor: "#f6f8fb" },
  peopleMapHeader: { minHeight: 70, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 18, paddingTop: 6, borderBottomWidth: 1, borderBottomColor: "#e1e7f1", backgroundColor: "#ffffff" },
  peopleMapHeaderCopy: { flex: 1, minWidth: 0 },
  peopleMapEyebrow: { color: "#5d7fff", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  peopleMapTitle: { color: theme.colors.text, fontSize: 17, lineHeight: 20, fontWeight: "900", marginTop: 1 },
  peopleMapSubtitle: { color: theme.colors.muted, fontSize: 9, lineHeight: 12, marginTop: 1 },
  peopleMapClose: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: theme.colors.panel2 },
  peopleMapCloseText: { color: theme.colors.soft, fontSize: 25, lineHeight: 28 },
  peopleMapCanvas: { flex: 1, overflow: "hidden", backgroundColor: "#dce8e2" },
  peopleMapMemberBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 20, justifyContent: "flex-end", padding: 12, backgroundColor: "rgba(12, 32, 26, .20)" },
  peopleMapMemberCard: { maxHeight: "67%", borderRadius: 24, backgroundColor: "#102b25", padding: 18, alignItems: "center", shadowColor: "#071a14", shadowOpacity: .32, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  peopleMapMemberCardLight: { backgroundColor: "#fff" },
  peopleMapMemberClose: { position: "absolute", top: 11, right: 11, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.14)", zIndex: 2 },
  peopleMapMemberCloseLight: { backgroundColor: "#eef1f3" }, peopleMapMemberCloseText: { color: "#fff", fontSize: 25, lineHeight: 28, fontWeight: "400" }, peopleMapMemberCloseTextLight: { color: "#17231e" },
  peopleMapMemberAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#d9f5e9", borderWidth: 3, borderColor: "#30c796" }, peopleMapMemberAvatarImage: { borderRadius: 33 }, peopleMapMemberInitials: { color: "#102b25", fontSize: 21, fontWeight: "900" },
  peopleMapMemberName: { color: "#fff", marginTop: 8, fontSize: 21, fontWeight: "900" }, peopleMapMemberMeta: { color: "#a9c2b8", marginTop: 3, fontSize: 12, fontWeight: "700" },
  peopleMapMemberMessage: { alignSelf: "stretch", minHeight: 48, marginTop: 14, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.brand }, peopleMapMemberMessageText: { color: "#06291e", fontSize: 14, fontWeight: "900" },
  peopleMapMemberListings: { alignSelf: "stretch", width: "100%", marginTop: 11 }, peopleMapMemberListingsContent: { gap: 7 }, peopleMapMemberListing: { minHeight: 61, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 13, backgroundColor: "rgba(255,255,255,.09)" }, peopleMapMemberListingLight: { backgroundColor: "#f3f6f5" }, peopleMapMemberListingTitle: { color: "#fff", fontSize: 13, fontWeight: "900" }, peopleMapMemberListingMeta: { color: "#b8d2c8", fontSize: 11, fontWeight: "700", marginTop: 3 }, peopleMapMemberListingArrow: { color: theme.colors.brand, fontSize: 27, lineHeight: 29 }, peopleMapMemberEmpty: { color: "#b8d2c8", marginTop: 14, marginBottom: 4, fontSize: 12, fontWeight: "700" },
  peopleMapPlannerOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "center", padding: 10, backgroundColor: "rgba(7, 20, 27, .12)" },
  peopleMapPlannerAura: { position: "absolute", width: 270, height: 270, borderRadius: 135, top: -78, right: -60, backgroundColor: "#7c9cff" },
  peopleMapPlannerCard: { maxHeight: "90%", borderRadius: 20, borderWidth: 1.5, borderColor: "rgba(152, 178, 255, .66)", backgroundColor: "rgba(10, 29, 51, .84)", padding: 12, shadowColor: "#06151d", shadowOpacity: .28, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 8 },
  peopleMapPlannerCardLight: { borderColor: "rgba(159, 181, 255, .76)", backgroundColor: "rgba(255,255,255,.86)" },
  peopleMapPlannerTopline: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 7 },
  peopleMapPlannerOrb: { width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(217,255,240,.9)", borderWidth: 1, borderColor: "#75dfbb" },
  peopleMapPlannerOrbText: { color: "#087254", fontSize: 14, fontWeight: "900" },
  peopleMapPlannerToplineCopy: { flex: 1, minWidth: 0 },
  peopleMapPlannerEyebrow: { color: "#6389ff", fontSize: 8, fontWeight: "900", letterSpacing: 1.15 },
  peopleMapPlannerHint: { color: "#b9c7d9", fontSize: 8, lineHeight: 11, fontWeight: "700", marginTop: 1 },
  peopleMapPlannerHintLight: { color: "#718096" },
  peopleMapPlannerProgress: { borderRadius: 10, backgroundColor: "rgba(114,143,255,.17)", paddingHorizontal: 7, paddingVertical: 4 },
  peopleMapPlannerProgressText: { color: "#6488fd", fontSize: 9, fontWeight: "900" },
  peopleMapPlannerClose: { width: 23, height: 23, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "rgba(27, 48, 78, .10)" },
  peopleMapPlannerCloseText: { color: "#53647e", fontSize: 21, lineHeight: 22, fontWeight: "500" },
  peopleMapPlannerQuestion: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  peopleMapPlannerStep: { width: 18, height: 18, marginTop: 1, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#20c995" },
  peopleMapPlannerStepText: { color: "#073326", fontSize: 10, lineHeight: 12, fontWeight: "900" },
  peopleMapPlannerTitle: { color: "#ffffff", fontSize: 16, lineHeight: 19, fontWeight: "900" },
  peopleMapPlannerQuestionHint: { color: "#bdc9de", fontSize: 8, lineHeight: 11, marginTop: 1 },
  peopleMapPlannerQuestionHintLight: { color: "#718096" },
  peopleMapPlannerInput: { minHeight: 38, marginTop: 6, borderRadius: 12, borderWidth: 1, borderColor: "rgba(150,177,235,.42)", backgroundColor: "rgba(255,255,255,.11)", color: "#ffffff", paddingHorizontal: 11, fontSize: 11, fontWeight: "800" },
  peopleMapPlannerInputLight: { borderColor: "#d4dfef", backgroundColor: "rgba(245,247,251,.82)", color: "#151719" },
  peopleMapPlannerLoader: { marginTop: 4 },
  peopleMapPlannerOption: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(154,177,234,.28)" },
  peopleMapPlannerOptionLight: { borderBottomColor: "#e1e8f2" },
  peopleMapPlannerOptionText: { color: "#ffffff", fontSize: 11, fontWeight: "800" },
  peopleMapPlannerOptionArrow: { color: "#5fe1b6", fontSize: 19, lineHeight: 20 },
  peopleMapPlannerReasonHeading: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginTop: 7 },
  peopleMapPlannerLabel: { color: "#aebed2", fontSize: 11, lineHeight: 13, fontWeight: "900" },
  peopleMapPlannerLabelLight: { color: "#344255" },
  peopleMapPlannerReasons: { flexDirection: "row", gap: 7, marginTop: 5 },
  peopleMapPlannerReason: { minHeight: 39, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 12, borderWidth: 1, borderColor: "rgba(150,177,235,.42)", backgroundColor: "rgba(255,255,255,.08)", paddingHorizontal: 7 },
  peopleMapPlannerReasonLight: { borderColor: "#d4dfef", backgroundColor: "rgba(248,250,255,.84)" },
  peopleMapPlannerReasonSelected: { borderColor: "#20c995", backgroundColor: "rgba(32,201,149,.18)" },
  peopleMapPlannerReasonIcon: { fontSize: 13 },
  peopleMapPlannerReasonText: { color: "#d0d9e8", fontSize: 10, fontWeight: "900" },
  peopleMapPlannerReasonTextLight: { color: "#4b5a70" },
  peopleMapPlannerReasonTextSelected: { color: "#087254" },
  peopleMapPlannerCompanyLabel: { color: "#aebed2", fontSize: 9, fontWeight: "900", letterSpacing: .35, textTransform: "uppercase", marginTop: 10 },
  peopleMapPlannerAction: { minHeight: 39, marginTop: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 13, backgroundColor: "#20c995", shadowColor: "#169a72", shadowOpacity: .22, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  peopleMapPlannerActionIcon: { color: "#073326", fontSize: 13, fontWeight: "900" },
  peopleMapPlannerActionText: { color: "#073326", fontSize: 12, fontWeight: "900" },
  peopleMapPlannerActionArrow: { color: "#073326", fontSize: 20, lineHeight: 21, fontWeight: "700" },
  peopleMapLegend: { position: "absolute", bottom: 24, left: 12, right: 12, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7, borderRadius: 15, backgroundColor: "rgba(255,255,255,.88)", paddingHorizontal: 10, paddingVertical: 6, shadowColor: "#102a21", shadowOpacity: .12, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  peopleMapLegendText: { color: "#316b5a", fontSize: 9, fontWeight: "900" },
  peopleMapLegendHint: { color: "#5e6d83", fontSize: 9, fontWeight: "800" },
  peopleMapListHead: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  peopleMapListTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "900" },
  peopleMapListCount: { color: theme.colors.muted, fontSize: 12, fontWeight: "800" },
  peopleMapList: { padding: 12, gap: 8, paddingBottom: 35 },
  peopleMapPerson: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel, paddingHorizontal: 10 },
  peopleMapPersonLight: { borderColor: "#e2e7ed", backgroundColor: "#ffffff" },
  peopleMapPersonAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#d8f7e8" },
  peopleMapPersonAvatarImage: { borderRadius: 18 },
  peopleMapPersonInitials: { color: "#087254", fontSize: 13, fontWeight: "900" },
  peopleMapPersonCopy: { flex: 1, minWidth: 0 },
  peopleMapPersonName: { color: theme.colors.text, fontSize: 12, fontWeight: "900" },
  peopleMapPersonCity: { color: theme.colors.muted, fontSize: 10, marginTop: 2 },
  peopleMapSource: { color: "#5c74d9", backgroundColor: "rgba(92,116,217,.12)", borderRadius: 999, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 4, fontSize: 8, fontWeight: "900" },
  peopleMapSourceContact: { color: "#087254", backgroundColor: "rgba(32,201,149,.15)" },
  peopleMapNoPeople: { color: theme.colors.muted, textAlign: "center", fontSize: 12, lineHeight: 18, padding: 24 },
  relocationPlannerLink: { minHeight: 42, marginTop: 8, marginHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 11, backgroundColor: "rgba(32, 201, 135, 0.10)", borderWidth: 1, borderColor: "rgba(32, 201, 135, 0.32)" },
  relocationPlannerLinkCopy: { flex: 1, minWidth: 0 },
  relocationPlannerLinkTitle: { color: theme.colors.text, fontSize: 12, fontWeight: "900" },
  relocationPlannerLinkHint: { color: theme.colors.muted, fontSize: 10, lineHeight: 13, marginTop: 1 },
  relocationPlannerLinkChevron: { color: theme.colors.brand, fontSize: 23, lineHeight: 24 },
  contactSuggestionsCopy: { flex: 1, minWidth: 0 },
  contactSuggestionsButton: { minHeight: 32, justifyContent: "center", alignItems: "center", borderRadius: 16, backgroundColor: theme.colors.brand, paddingHorizontal: 11 },
  contactSuggestionsButtonText: { color: "#06291e", fontSize: 10, fontWeight: "900" },
  contactSuggestionReason: { color: "#18a878", fontSize: 11, lineHeight: 15, fontWeight: "800", marginTop: 4 },
  relocationConnectionsHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8, paddingHorizontal: 12 },
  relocationConnectionsTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  relocationConnectionsCopy: { color: theme.colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  relocationConnectionsBadge: { color: "#086946", backgroundColor: "#b8f4d9", borderRadius: 12, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 4, fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },
  relocationConnectionsRail: { gap: 10, paddingHorizontal: 12, paddingTop: 12, paddingRight: 20 },
  relocationConnectionCard: { width: 154, minHeight: 160, borderRadius: 15, borderWidth: 1, borderColor: "rgba(160, 231, 204, 0.34)", backgroundColor: "rgba(6, 42, 30, 0.42)", padding: 10 },
  relocationConnectionCardLight: { backgroundColor: "#ffffff", borderColor: "#d9eee4" },
  peopleDiscoveryCard: { width: 174, minHeight: 183, overflow: "hidden", borderRadius: 18, borderWidth: 1, borderColor: "rgba(174, 223, 207, 0.62)", backgroundColor: "rgba(7, 33, 49, 0.72)", padding: 12, shadowColor: "#081a2d", shadowOpacity: 0.20, shadowRadius: 9, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  peopleDiscoveryCardLight: { borderColor: "#d7e9e0", backgroundColor: "rgba(255,255,255,0.94)", shadowColor: "#5c6d79", shadowOpacity: 0.12 },
  peopleDiscoveryCardGlow: { position: "absolute", width: 112, height: 112, borderRadius: 56, backgroundColor: "rgba(75, 209, 165, 0.12)", right: -46, top: -52 },
  peopleDiscoveryCardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 7 },
  peopleDiscoveryAvatarRing: { width: 46, height: 46, borderRadius: 23, padding: 2, backgroundColor: "#47d7ad", shadowColor: "#20c38a", shadowOpacity: 0.27, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  peopleDiscoveryAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#d8f7e8" },
  peopleDiscoveryAvatarImage: { borderRadius: 21 },
  peopleDiscoveryTag: { maxWidth: 93, overflow: "hidden", color: "#5fe1b6", backgroundColor: "rgba(50, 189, 141, 0.16)", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4, fontSize: 8, lineHeight: 10, fontWeight: "900", letterSpacing: 0.35, textTransform: "uppercase" },
  peopleDiscoveryName: { color: theme.colors.text, fontSize: 14, lineHeight: 18, fontWeight: "900", marginTop: 9 },
  peopleDiscoveryCardFooter: { minHeight: 30, marginTop: "auto", paddingTop: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  peopleDiscoveryRating: { flex: 1, minWidth: 0, color: "#f3b41a", fontSize: 10, fontWeight: "900" },
  peopleDiscoveryNew: { flex: 1, minWidth: 0, color: "#74dabb", fontSize: 10, fontWeight: "800" },
  peopleDiscoveryOpen: { color: "#78d9bd", fontSize: 10, fontWeight: "900", marginTop: "auto", paddingTop: 13 },
  relocationConnectionAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#d8f7e8" },
  relocationConnectionAvatarImage: { borderRadius: 18 },
  relocationConnectionInitials: { color: "#0b6e4f", fontSize: 13, fontWeight: "900" },
  relocationConnectionName: { color: theme.colors.text, fontSize: 13, fontWeight: "900", marginTop: 8 },
  relocationConnectionReason: { color: "#65d8a8", fontSize: 11, lineHeight: 15, fontWeight: "700", marginTop: 3 },
  peopleSuggestionReason: { color: "#91a9ff", fontSize: 11, lineHeight: 15, fontWeight: "700", marginTop: 3 },
  hidePeopleSuggestion: { alignSelf: "flex-start", minHeight: 25, paddingHorizontal: 8, justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.10)" },
  hidePeopleSuggestionText: { color: theme.colors.muted, fontSize: 9, fontWeight: "900" },
  relocationConnectionMonth: { color: theme.colors.muted, fontSize: 10, marginTop: 5 },
  relocationConnectionRating: { color: "#d89800", fontSize: 10, fontWeight: "900", marginTop: 5 },
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
  relocationPlannerBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.48)" }, relocationPlannerSheet: { gap: 11, padding: 20, paddingBottom: 30, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: theme.colors.panel }, relocationPlannerSheetLight: { backgroundColor: "#ffffff" }, relocationPlannerHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }, relocationPlannerHeaderCopy: { flex: 1, minWidth: 0 }, relocationPlannerTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "900" }, relocationPlannerSubtitle: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 }, relocationPlannerClose: { color: theme.colors.soft, fontSize: 29, lineHeight: 31 }, relocationPlannerLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: "900", letterSpacing: .5, textTransform: "uppercase" }, relocationPlannerInput: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel2, color: theme.colors.text, paddingHorizontal: 13, fontSize: 15 }, relocationPlannerInputLight: { backgroundColor: "#f5f7f8" }, relocationPlannerOption: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: theme.colors.line, paddingHorizontal: 5 }, relocationPlannerOptionText: { color: theme.colors.text, fontSize: 13, fontWeight: "800" }, relocationPlannerOptionArrow: { color: theme.colors.brand, fontSize: 21 }, relocationReasonChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, relocationReasonChoice: { minHeight: 33, justifyContent: "center", paddingHorizontal: 10, borderRadius: 17, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel2 }, relocationReasonChoiceSelected: { borderColor: theme.colors.brand, backgroundColor: "rgba(32, 201, 135, 0.16)" }, relocationReasonChoiceText: { color: theme.colors.muted, fontSize: 11, fontWeight: "800" }, relocationReasonChoiceTextSelected: { color: theme.colors.green }, relocationPlannerFields: { flexDirection: "row", gap: 9 }, relocationPlannerField: { flex: 1, minWidth: 0, gap: 5 }, relocationPlannerPrivacy: { color: theme.colors.muted, fontSize: 10, lineHeight: 14 }, relocationPlannerSave: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: theme.colors.brand, marginTop: 3 }, relocationPlannerSaveText: { color: "#06291e", fontSize: 14, fontWeight: "900" },
  housingSearchAction: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel }, housingSearchIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.brand }, housingSearchIconText: { color: "#06291e", fontSize: 28, lineHeight: 31, fontWeight: "800" }, housingSearchCopy: { flex: 1 }, housingSearchTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "900" }, housingSearchBody: { color: theme.colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 }, housingSearchArrow: { color: theme.colors.brand, fontSize: 30, fontWeight: "300" },
  currentLocationCard: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel }, currentLocationPin: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.panel2 }, currentLocationPinText: { color: theme.colors.brand, fontSize: 25, lineHeight: 28, fontWeight: "800" }, currentLocationCopy: { flex: 1 }, currentLocationEyebrow: { color: theme.colors.brand, fontSize: 8, fontWeight: "900", letterSpacing: .8 }, currentLocationCity: { color: theme.colors.text, fontSize: 15, fontWeight: "900", marginTop: 2 }, currentLocationArea: { color: theme.colors.muted, fontSize: 10, lineHeight: 14, marginTop: 2 }, currentLocationArrow: { color: theme.colors.brand, fontSize: 28, lineHeight: 30, fontWeight: "300" },
  inlineCommunities: { marginVertical: 10, paddingVertical: 16, gap: 9, borderRadius: 19, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel, overflow: "hidden" }, inlineCommunityHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 }, inlineCommunityEyebrow: { color: theme.colors.brand, fontSize: 9, fontWeight: "900", letterSpacing: .8 }, inlineCommunityTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900", marginTop: 2 }, inlineCommunitySwipe: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, minHeight: 31, borderRadius: 999, backgroundColor: theme.colors.panel2 }, inlineCommunitySwipeText: { color: theme.colors.muted, fontSize: 10, fontWeight: "800" }, inlineCommunitySwipeArrow: { color: theme.colors.brand, fontSize: 20, fontWeight: "900", marginTop: -1 }, inlineCommunityBody: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 16 }, inlineCommunityRail: { paddingHorizontal: 16, gap: 10 }, inlineCommunityCard: { width: 140, minHeight: 170, padding: 11, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel2, alignItems: "center" }, inlineCommunityPhoto: { width: 54, height: 54, borderRadius: 27, marginBottom: 7, backgroundColor: theme.colors.panel }, inlineCommunityPhotoImage: { borderRadius: 27 }, inlineCommunityPhotoGlyph: { fontSize: 25 }, inlineCommunityName: { color: theme.colors.text, fontSize: 12, lineHeight: 14, fontWeight: "900", minHeight: 28, textAlign: "center" }, inlineCommunityMeta: { color: theme.colors.muted, fontSize: 9, marginTop: 2, maxWidth: "100%" }, inlineCommunityMembers: { color: theme.colors.muted, fontSize: 9, fontWeight: "700", marginTop: 2, marginBottom: 7 }, inlineJoinButton: { width: "100%", minHeight: 31, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: theme.colors.brand, paddingHorizontal: 11 }, inlineJoinedButton: { borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel }, inlineJoinText: { color: "#06291e", fontSize: 11, fontWeight: "900" }, inlineJoinedText: { color: theme.colors.text },
  hero: { minHeight: 136, gap: 11, padding: 16, paddingTop: 23, backgroundColor: "#071e1b", borderWidth: 1, borderColor: "#17604e", borderRadius: 28, overflow: "hidden" }, heroTop: { width: "100%", flexDirection: "row", alignItems: "center", gap: 12 }, heroMark: { width: 92, height: 70, justifyContent: "center" }, askBadge: { width: 82, height: 55, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: "#ef3e42", transform: [{ rotate: "-5deg" }], shadowColor: "#000", shadowOpacity: .25, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } }, askBadgeText: { color: "#fff", fontSize: 29, fontStyle: "italic", fontWeight: "900" }, chatBubbles: { position: "absolute", right: 0, top: -5 }, chatBubbleBlue: { color: "#e8fff7", backgroundColor: "#16a878", borderRadius: 14, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3, fontSize: 9 }, chatBubbleGold: { alignSelf: "flex-end", marginTop: -1, color: "#fff7d1", backgroundColor: "#f0a800", borderRadius: 9, overflow: "hidden", paddingHorizontal: 5, fontSize: 7 }, heroCopy: { flex: 1 }, communityTag: { alignSelf: "flex-start", minWidth: 150, height: 43, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 13, backgroundColor: "#fff5cf", borderWidth: 2, borderColor: "#e9aa20", borderRadius: 10, transform: [{ rotate: "-2deg" }], shadowColor: "#000", shadowOpacity: .22, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }, communityTagTail: { position: "absolute", left: -5, bottom: -4, width: 12, height: 12, backgroundColor: "#fff5cf", borderLeftWidth: 2, borderBottomWidth: 2, borderColor: "#e9aa20", transform: [{ rotate: "-20deg" }] }, communityTagDot: { position: "absolute", right: 6, color: "#e9aa20", fontSize: 7 }, heroCommunity: { color: "#082b62", fontSize: 24, lineHeight: 30, fontFamily: Platform.select({ ios: "Bradley Hand", android: "cursive", default: "serif" }), fontWeight: "700", letterSpacing: -0.4 }, eyebrow: { ...theme.typography.eyebrow, color: "#72d9ae" }, title: { color: "#fff", fontSize: 31, lineHeight: 36, fontWeight: "800" }, subtitle: { width: "100%", color: "#f2faf7", fontSize: 14, lineHeight: 20, marginTop: 2, paddingHorizontal: 4 }, askButton: { backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 14, minHeight: 38, justifyContent: "center" }, askButtonText: { color: "#06291e", fontWeight: "800", fontSize: 14 },
  heroPosterFrame: { width: "100%", height: 78, alignItems: "center", justifyContent: "center" }, heroPoster: { width: "58%", height: 68 },
  actionNoticeOverlay: { position: "absolute", left: 14, right: 14, zIndex: 20 }, actionNotice: { flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 23, borderWidth: 1.5, borderColor: "#9edcc6", backgroundColor: "#ffffff", padding: 13, paddingLeft: 17, paddingRight: 10, overflow: "hidden", shadowColor: "#0a3528", shadowOpacity: .18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 }, actionNoticeLight: { backgroundColor: "#ffffff" }, actionNoticeAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5, backgroundColor: "#14b87a" }, actionNoticeIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "#d9fae9", borderWidth: 1, borderColor: "#b6efd7" }, actionNoticeIconText: { color: "#087052", fontSize: 19, lineHeight: 22, fontWeight: "800" }, actionNoticeCopy: { flex: 1, minWidth: 0, paddingVertical: 2 }, actionNoticeEyebrow: { color: "#087052", fontSize: 9, lineHeight: 11, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" }, actionNoticeTitle: { color: "#10211c", fontSize: 15, lineHeight: 19, fontWeight: "900", marginTop: 2 }, actionNoticeBody: { color: "#526861", fontSize: 11, lineHeight: 15, fontWeight: "700", marginTop: 2 }, actionNoticeActions: { alignSelf: "stretch", justifyContent: "center", paddingTop: 8 }, actionNoticeButton: { minWidth: 78, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: "#16bd82", paddingHorizontal: 10, shadowColor: "#0a6b4b", shadowOpacity: .18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 }, actionNoticeButtonText: { color: "#052c20", fontSize: 10, lineHeight: 12, fontWeight: "900", textAlign: "center" }, actionNoticeClose: { position: "absolute", top: -3, right: -3, width: 23, height: 23, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#eff7f3" }, actionNoticeCloseText: { color: "#46665a", fontSize: 19, lineHeight: 20, fontWeight: "500" },
  topicGrid: { flexDirection: "row", justifyContent: "space-between", gap: 6, paddingTop: 8 }, topicCard: { minHeight: 88, borderRadius: 16, padding: 7, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,.45)" }, topicSelected: { borderColor: theme.colors.brand, transform: [{ scale: 0.98 }] }, topicImage: { width: 38, height: 38, marginBottom: 2 }, topicTitle: { color: "#11181b", fontWeight: "900", fontSize: 12 }, topicSubtitle: { color: "#627078", fontSize: 9, marginTop: 2, textAlign: "center" }, tipCard: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 13, borderRadius: 22, paddingHorizontal: 17, backgroundColor: "#0d4038", borderWidth: 1, borderColor: "#25685b" }, tipIcon: { fontSize: 25 }, tipTitle: { color: "#fff", fontWeight: "900", fontSize: 16 }, tipBody: { color: "#a9cfc5", fontSize: 12, lineHeight: 18, marginTop: 3 }, tipArrow: { color: "#fff", fontSize: 38, fontWeight: "300" },
  needGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 }, needOption: { width: "48%", minHeight: 76, flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel }, needIcon: { fontSize: 22 }, needText: { flex: 1, color: theme.colors.soft, fontWeight: "800", fontSize: 13 },
  searchRow: { flexDirection: "row", gap: 8 }, searchInput: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 15, backgroundColor: theme.colors.panel, color: theme.colors.text, paddingHorizontal: 14 }, searchButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 16, borderRadius: 15, backgroundColor: theme.colors.brand }, searchButtonText: { color: "#06291e", fontWeight: "800" },
  chips: { gap: 8, paddingRight: 12 }, chip: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 999, paddingHorizontal: 14, minHeight: 38, justifyContent: "center", marginRight: 8, backgroundColor: theme.colors.panel }, chipActive: { backgroundColor: "#d8fff0", borderColor: "#d8fff0" }, chipText: { color: theme.colors.soft, fontWeight: "700", fontSize: 13 }, chipTextActive: { color: "#093525" }, sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, sectionTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800" }, manageLink: { color: theme.colors.brand, fontWeight: "800", fontSize: 13 }, groups: { gap: 7, paddingTop: 7, paddingRight: 8 }, groupCard: { width: 96, minHeight: 78, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 14, padding: 9, gap: 3 }, groupActive: { borderColor: theme.colors.brand, backgroundColor: "#14271f" }, groupEmoji: { fontSize: 20 }, groupPhoto: { width: 24, height: 24, borderRadius: 8 }, groupName: { color: theme.colors.text, fontWeight: "800", fontSize: 11 }, groupCount: { color: theme.colors.muted, fontSize: 9 }, feedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }, feedHint: { color: theme.colors.muted, fontSize: 11 }, loader: { marginVertical: 50 },
  postCard: { backgroundColor: theme.colors.panel, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 15, gap: 12, shadowColor: "#000", shadowOpacity: .14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 }, postHead: { flexDirection: "row", alignItems: "center", gap: 10 }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#204538" }, avatarImage: { borderRadius: 22 }, avatarInitials: { color: "#a8ecd1", fontSize: 14, fontWeight: "900" }, postAuthor: { flex: 1, minWidth: 0 }, author: { color: theme.colors.text, fontWeight: "900", fontSize: 15 }, meta: { color: theme.colors.muted, fontSize: 11, marginTop: 2 }, postTitle: { color: theme.colors.text, fontSize: 19, lineHeight: 25, fontWeight: "800" }, postBody: { color: theme.colors.soft, fontSize: 14, lineHeight: 21 }, imageRow: { gap: 5 }, postImage: { width: 255, height: 175, borderRadius: 12, backgroundColor: theme.colors.panel2 }, composerLinkPreview: { gap: 7, paddingTop: 2 }, composerLinkPreviewHead: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, composerLinkPreviewTitle: { color: theme.colors.text, fontSize: 12, fontWeight: "900" }, composerLinkPreviewHint: { color: theme.colors.muted, fontSize: 10, marginTop: 1 }, composerLinkRemove: { color: theme.colors.brand, fontSize: 11, fontWeight: "900", paddingVertical: 6, paddingLeft: 12 }, linkCard: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: "#315945", backgroundColor: "#10291f", borderRadius: 14, padding: 9, overflow: "hidden" }, linkPreviewImage: { width: 74, height: 74, borderRadius: 10, backgroundColor: theme.colors.panel2 }, linkPreviewPlaceholder: { width: 74, height: 74, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#173b2d" }, linkPreviewPlaceholderText: { color: theme.colors.brand, fontSize: 28 }, linkContent: { flex: 1, minWidth: 0, gap: 4 }, linkLabel: { color: theme.colors.text, fontWeight: "800", fontSize: 13, lineHeight: 17 }, linkDescription: { color: theme.colors.muted, fontSize: 10, lineHeight: 14 }, linkSource: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }, linkFavicon: { width: 15, height: 15, borderRadius: 3 }, linkFaviconFallback: { width: 15, height: 15, borderRadius: 3, alignItems: "center", justifyContent: "center", backgroundColor: "#1c4938" }, linkFaviconFallbackText: { color: theme.colors.brand, fontSize: 9 }, linkUrl: { flex: 1, color: "#85caae", fontSize: 10 }, linkChevron: { color: theme.colors.brand, fontSize: 26, marginRight: 2 }, latestComment: { flexDirection: "row", alignItems: "flex-start", gap: 9 }, latestCommentAvatar: { width: 31, height: 31, borderRadius: 16, backgroundColor: "#204538" }, latestCommentInitials: { color: "#a8ecd1", fontSize: 9, fontWeight: "900" }, latestCommentBubble: { flex: 1, minHeight: 46, borderRadius: 13, backgroundColor: theme.colors.panel2, paddingHorizontal: 11, paddingVertical: 8 }, latestCommentAuthor: { color: theme.colors.text, fontSize: 11, fontWeight: "900" }, latestCommentBody: { color: theme.colors.soft, fontSize: 12, lineHeight: 17, marginTop: 2 }, addCommentPrompt: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.line }, addCommentIcon: { color: theme.colors.brand, fontSize: 15 }, addCommentText: { color: theme.colors.muted, fontSize: 12, fontWeight: "700" }, postActions: { position: "relative", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 10, overflow: "visible" }, postActionsCompact: { flexWrap: "nowrap", justifyContent: "space-between", gap: 0 }, compactPostAction: { flex: 1, minWidth: 0, marginLeft: 0, paddingHorizontal: 2, justifyContent: "center" }, reactionDismissLayer: { ...StyleSheet.absoluteFillObject, zIndex: 0, backgroundColor: "transparent" }, reactionControl: { position: "relative", zIndex: 30 }, reactionTray: { position: "absolute", left: 0, bottom: 40, height: 50, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 7, borderRadius: 25, borderWidth: 1, borderColor: "#dedede", backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: .24, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 24, zIndex: 50 }, reactionChoice: { width: 37, height: 42, alignItems: "center", justifyContent: "center" }, reactionChoiceEmoji: { fontSize: 24 }, reactionSummary: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 9 }, compactReactionSummary: { minWidth: 0, justifyContent: "center", gap: 3, paddingHorizontal: 2 }, reactionSummaryEmoji: { fontSize: 16 }, reactionSummaryText: { color: theme.colors.soft, fontSize: 11, fontWeight: "800" }, reactionSummaryTextActive: { color: theme.colors.brand }, reactionTotal: { color: theme.colors.muted, fontSize: 10, fontWeight: "800" }, action: { backgroundColor: "transparent", borderRadius: 9, paddingHorizontal: 7, minHeight: 36, justifyContent: "center" }, iconAction: { width: 34, height: 34, borderRadius: 9, justifyContent: "center", alignItems: "center", backgroundColor: "transparent" }, actionActive: { backgroundColor: "#174c38" }, actionText: { color: theme.colors.soft, fontSize: 11, fontWeight: "700" },
  activitySummary: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(145,145,150,.28)", paddingTop: 8 }, activitySummaryLight: { borderTopColor: "rgba(101,103,107,.16)" }, reactionBreakdown: { flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }, answerReactionStats: { minHeight: 24, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 5 }, activityText: { color: theme.colors.soft, fontSize: 10, fontWeight: "700" }, commentCount: { color: theme.colors.muted, fontSize: 10, fontWeight: "700" }, footerIconAction: { minWidth: 58, height: 34, paddingHorizontal: 6, flexDirection: "row", gap: 4, borderRadius: 9, alignItems: "center", justifyContent: "center" }, footerIcon: { color: theme.colors.soft, fontSize: 20, lineHeight: 23 }, compactFooterIcon: { fontSize: 16, lineHeight: 19 }, footerShareIcon: { color: theme.colors.soft, fontSize: 19, fontWeight: "500", transform: [{ rotate: "-12deg" }] }, footerActionLabel: { color: theme.colors.soft, fontSize: 10, fontWeight: "800", flexShrink: 1 }, compactFooterActionLabel: { fontSize: 9 },
  postOpenArea: { gap: 12 },
  videoUploadCard: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 14, borderWidth: 1, borderColor: "rgba(24,184,132,.42)", backgroundColor: "rgba(24,184,132,.10)", padding: 11 },
  videoUploadCardLight: { borderColor: "rgba(10,142,94,.35)", backgroundColor: "rgba(16,185,129,.10)" },
  videoUploadRing: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, borderWidth: 3, borderColor: theme.colors.brand, backgroundColor: "rgba(255,255,255,.82)" },
  videoUploadPercent: { color: "#063f2d", fontSize: 11, fontWeight: "900" },
  videoUploadCopy: { flex: 1, minWidth: 0 },
  videoUploadTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "900" },
  videoUploadBody: { color: theme.colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  answerAuthorButton: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  postActionsLight: { borderTopColor: "rgba(101,103,107,.16)" },
  // Keep copy comfortably inset, while photographs use the full card width.
  postMediaGrid: { alignSelf: "stretch", marginHorizontal: -16, height: 310, flexDirection: "row", flexWrap: "wrap", gap: 3, borderRadius: 14, overflow: "hidden", backgroundColor: theme.colors.panel2 },
  // Give a standalone clip a predictable, full-width Instagram-style feed
  // frame. `contain` above preserves portrait and landscape video rather than
  // cutting off the edges; the dark frame safely letterboxes either shape.
  postMediaSingle: { alignSelf: "stretch", marginHorizontal: -16, aspectRatio: 4 / 5, borderRadius: 14, overflow: "hidden", backgroundColor: "#050807" },
  postMediaCell: { width: "49.5%", height: "49.5%", overflow: "hidden", backgroundColor: theme.colors.panel2 },
  postMediaCellPressed: { opacity: .78 },
  postMediaCellTwo: { width: "49.5%", height: "100%", flexGrow: 1 },
  postMediaCellThreeHero: { width: "100%", height: "58%" },
  postMediaCellThreeSmall: { width: "49.5%", height: "41%", flexGrow: 1 },
  postMediaCellFour: { width: "49.5%", height: "49.5%", flexGrow: 1 },
  postMediaImage: { width: "100%", height: "100%" },
  postMediaSingleImage: { width: "100%", height: "100%" },
  communityVideoSoundButton: { position: "absolute", top: 10, right: 10, zIndex: 3, width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,.62)", borderWidth: 1, borderColor: "rgba(255,255,255,.36)" },
  communityVideoSoundIcon: { fontSize: 17, lineHeight: 20 },
  photoViewerBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 30, backgroundColor: "#050807" }, photoViewerHeader: { minHeight: 58, paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, photoViewerClose: { minWidth: 64, minHeight: 36, justifyContent: "center" }, photoViewerCloseText: { color: "#fff", fontSize: 16, fontWeight: "800" }, photoViewerCounter: { color: "#fff", fontSize: 14, fontWeight: "800" }, photoViewerHeaderSpacer: { width: 64 }, photoViewerStage: { flex: 1, overflow: "hidden", alignItems: "center", justifyContent: "center" }, photoViewerImage: { width: "100%", height: "100%" }, photoViewerThumbs: { alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 7 }, photoViewerThumb: { width: 58, height: 58, borderRadius: 9, overflow: "hidden", opacity: .55, borderWidth: 2, borderColor: "transparent" }, photoViewerThumbActive: { opacity: 1, borderColor: theme.colors.brand }, photoViewerThumbImage: { width: "100%", height: "100%" }, photoViewerHint: { color: "rgba(255,255,255,.72)", fontSize: 12, fontWeight: "700", textAlign: "center", paddingHorizontal: 20, paddingTop: 5, paddingBottom: 22 },
  postMediaMore: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,.48)" },
  postMediaMoreText: { color: "#fff", fontSize: 28, fontWeight: "900" },
  viewListingButton: { marginLeft: "auto", minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, borderRadius: 9 }, viewListingIcon: { color: theme.colors.brand, fontSize: 18, lineHeight: 20 }, viewListingButtonText: { color: theme.colors.soft, fontSize: 14, lineHeight: 19, fontWeight: "800", flexShrink: 1 }, compactViewListingButtonText: { fontSize: 11, lineHeight: 16 }, viewListingArrow: { color: theme.colors.muted, fontSize: 20, lineHeight: 21, marginTop: -1 }, compactViewListingArrow: { fontSize: 16, lineHeight: 18 },
  footerCommentAction: { minWidth: 42, height: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 7, borderRadius: 9 }, footerCommentCount: { color: theme.colors.soft, fontSize: 12, fontWeight: "800" },
  reactionSummaryIconOnly: { minWidth: 42, paddingHorizontal: 7, justifyContent: "center" },
  empty: { alignItems: "center", backgroundColor: theme.colors.panel, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.line, padding: 30, gap: 8 }, emptyIcon: { fontSize: 36 }, emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800" }, emptyBody: { color: theme.colors.muted, textAlign: "center", lineHeight: 20 }, emptyButton: { marginTop: 8, backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 }, emptyButtonText: { color: "#06291e", fontWeight: "800" },
  loadMore: { alignSelf: "center", borderWidth: 1, borderColor: "#315945", backgroundColor: "#10291f", borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 }, loadMoreText: { color: "#9be8c7", fontWeight: "800" },
  modal: { flex: 1, backgroundColor: theme.colors.bg }, modalHead: { minHeight: 62, borderBottomWidth: 1, borderBottomColor: theme.colors.line, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, cancel: { color: theme.colors.soft, fontSize: 15 }, modalTitle: { color: theme.colors.text, fontWeight: "800", fontSize: 16 }, publish: { color: theme.colors.brand, fontWeight: "800", fontSize: 15 }, danger: { color: theme.colors.accent, fontWeight: "800" }, disabled: { opacity: .45 }, form: { padding: 18, gap: 15, paddingBottom: 40 }, formLabel: { color: theme.colors.soft, fontWeight: "800", fontSize: 12, textTransform: "uppercase", letterSpacing: .5 }, formLabelOptional: { color: theme.colors.muted, fontWeight: "700", textTransform: "none", letterSpacing: 0 }, optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, option: { width: "48%", backgroundColor: theme.colors.panel, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 14, padding: 13 }, optionActive: { backgroundColor: "#173b2d", borderColor: theme.colors.brand }, optionText: { color: theme.colors.soft, fontWeight: "700" }, optionTextActive: { color: "#a9f2d2" }, detailFields: { gap: 7 }, fieldGroup: { gap: 5 }, fieldHeader: { gap: 2 }, fieldLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "900" }, fieldHint: { color: theme.colors.muted, fontSize: 12, lineHeight: 17 }, fieldRequired: { color: theme.colors.brand, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: .2 }, fieldOptional: { color: theme.colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: .2 }, titleInput: { color: theme.colors.text, fontSize: 22, fontWeight: "800", borderBottomWidth: 1, borderBottomColor: theme.colors.line, paddingVertical: 13 }, bodyInput: { minHeight: 150, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 18, padding: 15, color: theme.colors.text, fontSize: 15, lineHeight: 22 }, fieldInputInvalid: { borderColor: "#dc2626", borderBottomColor: "#dc2626" }, fieldError: { color: "#dc2626", fontSize: 12, lineHeight: 16, fontWeight: "800" }, input: { minHeight: 50, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 15, paddingHorizontal: 14, color: theme.colors.text }, counter: { alignItems: "flex-end", marginTop: -10 }, counterText: { color: theme.colors.muted, fontSize: 11 }, attachmentPanel: { gap: 10, padding: 13, borderRadius: 17, borderWidth: 1, borderColor: "#315348", backgroundColor: "#111d19" }, attachmentTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "900" }, attachmentOptional: { color: theme.colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: .2 }, attachmentHint: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 }, previewImage: { width: 105, height: 105, borderRadius: 15 }, removeImage: { position: "absolute", right: 5, top: 5, width: 25, height: 25, borderRadius: 13, backgroundColor: "rgba(0,0,0,.75)", alignItems: "center", justifyContent: "center" }, removeImageText: { color: "#fff", fontSize: 18 }, addPhoto: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "#3f6554", borderRadius: 14, padding: 13 }, addPhotoIcon: { color: theme.colors.brand, fontSize: 24 }, addPhotoCopy: { flex: 1, minWidth: 0 }, addPhotoTitle: { color: theme.colors.text, fontWeight: "800" }, addPhotoBody: { color: theme.colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 }, addPhotoChevron: { color: theme.colors.brand, fontSize: 25 }, safety: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, backgroundColor: "#211f17", borderRadius: 14, padding: 13 },
  previewVideo: { width: 105, height: 105, borderRadius: 15, backgroundColor: "#10291f", alignItems: "center", justifyContent: "center", gap: 6 }, previewVideoIcon: { color: "#9be8c7", fontSize: 28 }, previewVideoText: { color: "#d8f5e7", fontSize: 12, fontWeight: "900" },
  detailContent: { padding: 14, gap: 14, paddingBottom: 45 }, answersTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "800", marginTop: 6 }, answerCard: { backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 18, padding: 15, gap: 11 }, answerAvatar: { width: 36, height: 36, borderRadius: 12, backgroundColor: theme.colors.panel2 }, accepted: { color: "#7ee2b8", fontSize: 12, fontWeight: "800" }, acceptedLight: { color: "#126b4c" }, answerBody: { color: theme.colors.soft, lineHeight: 21 }, answerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, answerAction: { color: theme.colors.muted, fontWeight: "700", fontSize: 12 }, acceptAction: { color: theme.colors.brand, fontWeight: "800", fontSize: 12 }, answerComposer: { backgroundColor: theme.colors.panel, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.line, padding: 12, gap: 10 }, answerInput: { minHeight: 75, color: theme.colors.text, fontSize: 14, textAlignVertical: "top" }, sendAnswer: { alignSelf: "flex-end", backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10 }, sendAnswerText: { color: "#06291e", fontWeight: "800" }, locked: { color: theme.colors.muted, textAlign: "center", padding: 18 },
  signInAnswer: { backgroundColor: "#10291f", borderWidth: 1, borderColor: "#315945", borderRadius: 18, padding: 18, alignItems: "center", gap: 4 }, signInAnswerTitle: { color: "#9be8c7", fontSize: 16, fontWeight: "800" }, signInAnswerBody: { color: theme.colors.muted, fontSize: 12, textAlign: "center" },
  replyLabel: { color: theme.colors.brand, fontSize: 10, fontWeight: "800" }, replyAction: { color: theme.colors.brand, fontWeight: "800", fontSize: 12 }, replyingTo: { minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, borderRadius: 9, backgroundColor: theme.colors.panel2 }, replyingToText: { color: theme.colors.soft, fontSize: 11, fontWeight: "700" }, replyingToClose: { color: theme.colors.muted, fontSize: 20 }, guestAllowance: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, guestAllowanceName: { color: theme.colors.brand, fontSize: 11, fontWeight: "900" }, guestAllowanceCount: { color: theme.colors.muted, fontSize: 10, fontWeight: "700" }, guestSignupHint: { color: theme.colors.brand, fontSize: 11, textAlign: "center", fontWeight: "800", paddingVertical: 3 },
  inlineReplies: { marginTop: 8, marginLeft: 38, borderLeftWidth: 2, borderLeftColor: "rgba(24,184,132,.28)", paddingLeft: 10, gap: 8 }, inlineReply: { paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.line }, inlineReplyHead: { flexDirection: "row", alignItems: "center", gap: 8 }, inlineReplyAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.panel2 }, inlineReplyAuthor: { color: theme.colors.text, fontSize: 12, fontWeight: "900" }, inlineReplyBody: { color: theme.colors.soft, fontSize: 13, lineHeight: 19, marginTop: 7 },
  inlineRepliesNested: { marginLeft: 12, paddingLeft: 8 },
  inlineRepliesDeep: { marginLeft: 0, paddingLeft: 6 },
  inlineReplyNested: { borderTopColor: "rgba(145,145,150,.20)" },
  moreRepliesButton: { alignSelf: "flex-start", paddingVertical: 7, paddingRight: 12 }, moreRepliesText: { color: theme.colors.brand, fontSize: 11, fontWeight: "900" }, inlineReplyComposer: { marginTop: 7, marginLeft: 38, gap: 8, padding: 10, borderRadius: 13, backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: "rgba(24,184,132,.28)" }, inlineReplyInput: { minHeight: 58, maxHeight: 120, color: theme.colors.text, fontSize: 13, lineHeight: 18, textAlignVertical: "top" }, inlineReplySend: { alignSelf: "flex-end", minWidth: 72, alignItems: "center", borderRadius: 999, backgroundColor: theme.colors.brand, paddingHorizontal: 14, paddingVertical: 9 }, inlineGuestAllowance: { color: theme.colors.muted, fontSize: 10, fontWeight: "700" }, answerEditBox: { gap: 8, padding: 10, borderRadius: 13, backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: "rgba(24,184,132,.35)" }, answerEditInput: { minHeight: 72 }, answerEditActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 14 },
  guestBenefitsBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 20, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.64)" }, guestBenefitsCard: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 34, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel, gap: 13 }, guestBenefitsClose: { position: "absolute", right: 17, top: 15, width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: theme.colors.panel2, zIndex: 2 }, guestBenefitsCloseText: { color: theme.colors.soft, fontSize: 23 }, guestBenefitsEyebrow: { color: theme.colors.brand, fontSize: 9, fontWeight: "900", letterSpacing: 1 }, guestBenefitsTitle: { color: theme.colors.text, fontSize: 22, lineHeight: 28, fontWeight: "900", paddingRight: 30 }, guestBenefitsIntro: { color: theme.colors.muted, fontSize: 13, marginBottom: 3 }, guestBenefit: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 5 }, guestBenefitIcon: { width: 36, fontSize: 25 }, guestBenefitTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "900" }, guestBenefitBody: { maxWidth: 290, color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 }, guestBenefitsPrimary: { minHeight: 50, marginTop: 5, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: theme.colors.brand }, guestBenefitsPrimaryText: { color: "#06291e", fontWeight: "900", fontSize: 15 }, guestBenefitsSecondary: { minHeight: 42, alignItems: "center", justifyContent: "center" }, guestBenefitsSecondaryText: { color: theme.colors.soft, fontWeight: "800", fontSize: 13 },
  groupCreate: { backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 20, padding: 15, gap: 12 }, discoverGroup: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 16, padding: 14 }, joined: { color: theme.colors.brand, fontWeight: "800", fontSize: 12 }, joinButton: { backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9 }, joinButtonText: { color: "#06291e", fontWeight: "800" },
  contentLight: { gap: 9 },
  quickComposerLight: { borderColor: "rgba(255,255,255,0.72)", borderRadius: 18, backgroundColor: "rgba(255,255,255,0.90)", shadowColor: "#101828", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 5 },
  composerPromptLight: { borderColor: "rgba(255,255,255,0.62)", backgroundColor: "rgba(240,242,245,0.86)" },
  topicCardLight: { borderColor: "rgba(255,255,255,0.64)", shadowColor: "#101828", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  feedControlsLight: { borderBottomColor: "#e4e6eb" },
  postCardLight: { marginHorizontal: 0, borderColor: "rgba(255,255,255,0.74)", borderRadius: 20, backgroundColor: "rgba(255,255,255,0.92)", shadowColor: "#101828", shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6, paddingHorizontal: 16 },
  inlineCommunitiesLight: { marginHorizontal: 0, borderColor: "rgba(255,255,255,0.72)", borderRadius: 20, backgroundColor: "rgba(255,255,255,0.90)", shadowColor: "#101828", shadowOpacity: 0.13, shadowRadius: 15, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  inlineCommunityCardLight: { borderColor: "rgba(255,255,255,0.62)", backgroundColor: "rgba(240,242,245,0.84)", shadowColor: "#101828", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  textPrimaryLight: { color: "#151719" },
  textBodyLight: { color: "#1c1e21" },
  textSecondaryLight: { color: "#65676b" },
});
