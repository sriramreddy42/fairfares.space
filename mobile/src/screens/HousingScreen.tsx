import React, { useEffect, useMemo, useRef, useState } from "react";
import "react-native-get-random-values";
import * as Location from "expo-location";
import { BlurView } from "expo-blur";
import { ActivityIndicator, Alert, Image, ImageBackground, ImageSourcePropType, KeyboardAvoidingView, LayoutChangeEvent, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { absoluteAssetUrl, createMobileRide, getCachedHousingAreaStats, getCars, getHousingAreaStats, getMyRentalCarListings, getRideActivity, getRideDriverLocation, getRides, getRidePlaceSuggestions, hydrateCachedHousingAreaStats, HousingAreaStat, listRentalCar, quoteRentalCar, respondToRideDispatch, reverseGeocodeRideLocation, rideMapUrl, RidePlaceSuggestion, submitAppFeedback, trackProductEvent, updateMobileRide, updateRideDriverLocation } from "../api/client";
import { appAssets } from "../assets";
import { HousingCard } from "../components/HousingCard";
import { DateTimeField } from "../components/DateTimeField";
import { EmbeddedRideMap, RideMapPoint } from "../components/RideMap";
import { SectionHeader } from "../components/SectionHeader";
import { UserAvatar } from "../components/UserAvatar";
import { theme } from "../theme";
import { useResponsiveLayout } from "../utils/layout";
import { avatarInitials } from "../utils/text";
import { BootstrapPayload, Car, HousingPost, RentalCarListingInput, RentalQuote, RentalSearchInput, RideInput, RidePost, RideType } from "../types";
import { mapDirectionsUrl, mapSearchUrl, nativeMapProviderName } from "../utils/maps";
import { shareCarpoolListing } from "../utils/listingShare";
import { deviceAddressCityLabel, explicitUsState, locationCountryCodeFromLabel } from "../utils/locationRegion";
import { requestUserLocationPermission } from "../utils/locationPermission";

type Props = {
  data: BootstrapPayload | null;
  posts: HousingPost[];
  cars: Car[];
  selectedNeed: string;
  selectedCategory: string;
  selectedGender: string;
  selectedBudget: string;
  selectedSort: "distanceAsc" | "distanceDesc" | "rentAsc" | "rentDesc";
  onMessage: (post: HousingPost) => void;
  onRideMessage: (ride: RidePost) => void;
  sentPostIds?: string[];
  sentRideIds?: string[];
  onSendPostMessage?: (post: HousingPost, message: string) => Promise<void>;
  onOpenPostConversation?: (post: HousingPost) => void;
  onOpenMessenger: () => void;
  onNeedSelect: (need: string) => void;
  onAreaSelect: (area: string) => void;
  onOpenSearch: () => void;
  hasExactLocationSearch?: boolean;
  onCategorySelect: (category: string) => void;
  onGenderSelect: (gender: string) => void;
  onBudgetSelect: (budget: string) => void;
  onSortSelect: (sort: "distanceAsc" | "distanceDesc" | "rentAsc" | "rentDesc") => void;
  onPostNeed: (intent?: string) => void;
  onRequireLogin?: () => void;
  onBookCar: (car: Car, details?: Partial<RentalSearchInput>, paymentOption?: "hold" | "full") => void;
  onBottomTabsHiddenChange?: (hidden: boolean) => void;
  focusWelcomeKey?: number;
  focusListingResultsKey?: number;
  carpoolFocusKey?: number;
  rentalFocusKey?: number;
  rideOwnerOpenToken?: number;
  rideOwnerOpenTarget?: "workspace" | "requests" | "listings";
  rideOwnerEditId?: string;
  rideOwnerFocusId?: string;
  onRideOwnerClosed?: () => void;
  linkedHousingPost?: HousingPost | null;
  linkedCarpoolRide?: RidePost | null;
  onLinkedHousingPostOpened?: () => void;
  onHousingDetailClosed?: () => void;
  onManageHousingListing?: (post: HousingPost) => void;
  onLinkedCarpoolRideOpened?: () => void;
  discoveryLocation?: string;
  showSearchResults?: boolean;
};

type CurrentRideLocation = {
  label: string;
  coords: {
    latitude: number;
    longitude: number;
  };
};

type DriverLocationStatus = {
  available: boolean;
  distanceMiles?: number;
  etaMinutes?: number | null;
  source?: "ROUTED" | "STRAIGHT_LINE";
  ageSeconds?: number;
};

const quickLinks: Array<{
  key: "earn" | "cheapRide" | "carpoolMove";
  title: string;
  accent: string;
}> = [
  {
    key: "earn",
    title: "List a ride in your area",
    accent: theme.colors.brand
  },
  {
    key: "cheapRide",
    title: "Find affordable rides nearby",
    accent: theme.colors.blue
  },
  {
    key: "carpoolMove",
    title: "Traveling farther? Try carpool",
    accent: "#9b5cff"
  }
];

const SEARCH_PHRASE_AUTO_SLIDE_MS = 1800;
const QUICK_LINK_TYPE_MS = 85;
const QUICK_LINK_WORD_PAUSE_MS = 1200;
const quickLinkWords = ["RIDES", "RENTALS", "ROOMMATES", "CARPOOL"];
const rentalPromoSlides = [appAssets.rentalCarouselPriceMatch, appAssets.rentalCarouselHowItWorks];

function RentalCarImage({ uri, name }: { uri: string; name: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [uri]);

  return (
    <Image
      source={!uri || failed ? appAssets.carFallback : { uri }}
      style={styles.carMiniImage}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessibilityLabel={`${name} rental car`}
    />
  );
}

function RentalPromoCarousel({ onPress }: { onPress: () => void }) {
  const { width: viewportWidth } = useWindowDimensions();
  const slideWidth = Math.max(280, viewportWidth - 28);
  const [activeSlide, setActiveSlide] = useState(0);
  return (
    <View style={styles.rentalCarouselShell}>
      <ScrollView
        horizontal
        pagingEnabled
        decelerationRate="fast"
        snapToInterval={slideWidth}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => setActiveSlide(Math.round(event.nativeEvent.contentOffset.x / slideWidth))}
      >
        {rentalPromoSlides.map((source, index) => (
          <TouchableOpacity key={index} activeOpacity={0.9} onPress={onPress} style={[styles.rentalCarouselSlide, { width: slideWidth }]} accessibilityLabel={index === 0 ? "How FairFares car rentals work" : "FairFares price match guarantee"}>
            <Image source={source} style={styles.rentalCarouselImage} resizeMode="cover" />
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.rentalCarouselDots} accessibilityLabel={`Slide ${activeSlide + 1} of ${rentalPromoSlides.length}`}>
        {rentalPromoSlides.map((_, index) => <View key={index} style={[styles.rentalCarouselDot, index === activeSlide && styles.rentalCarouselDotActive]} />)}
      </View>
    </View>
  );
}

const roomTypes: Array<{ label: string; category: string; icon: ImageSourcePropType }> = [
  { label: "Shared Room", category: "shared_room", icon: appAssets.roommates },
  { label: "Single Room", category: "single_room", icon: appAssets.bed },
  { label: "Paying Guest", category: "paying_guest", icon: appAssets.bed }
];
const housingIntentCards = [
  { value: "need_place", icon: "house", preview: appAssets.housingSearchPoster, title: "I need a place", subtitle: "Find rooms, apartments and housing", accent: "#ff9f1c", background: "#fff2d8" },
  { value: "need_roommates", icon: "people", preview: appAssets.housingRentalPromo, title: "I need roommates", subtitle: "Find people to share with", accent: "#14a96b", background: "#dfffee" },
  { value: "have_place", icon: "house", preview: appAssets.housingSearchPoster, title: "I have a place", subtitle: "List a room or property", accent: "#1488ff", background: "#dcf0ff" },
  { value: "ride_need", icon: "car", preview: appAssets.carpoolPoster, title: "I need a ride", subtitle: "Find or offer a ride", accent: "#e53945", background: "#ffe4e6" }
] as const;

const housingSearchPhrases = ["Search housing", "City or area"];
const rideSearchPhrases = ["Where are you going?"];
const rentalSearchPhrases = ["Search rental cars", "Airport pickup"];
const cityLocalityPresets: Record<string, string[]> = {
  "denver, co": ["Downtown Denver", "Capitol Hill", "Cherry Creek", "Five Points", "LoDo", "RiNo", "Highlands", "DU Area", "Aurora", "Lakewood", "Boulder"],
  "los angeles, ca": ["Downtown LA", "Hollywood", "Koreatown", "Santa Monica", "Westwood", "Culver City", "Pasadena", "Glendale", "Long Beach", "Irvine"],
  "austin, tx": ["Downtown Austin", "West Campus", "North Austin", "South Congress", "Riverside", "The Domain", "Round Rock", "Cedar Park"],
  "miami, fl": ["Downtown Miami", "Brickell", "Wynwood", "Coral Gables", "Doral", "Miami Beach", "Aventura", "Kendall"]
};
const sortOptions: Array<{ label: string; value: Props["selectedSort"] }> = [
  { label: "Distance ↑", value: "distanceAsc" },
  { label: "Distance ↓", value: "distanceDesc" },
  { label: "Rent ↑", value: "rentAsc" },
  { label: "Rent ↓", value: "rentDesc" }
];
const genderOptions = ["Any", "Female", "Male", "Couple", "Family"];
function formatDeviceAddress(address: Location.LocationGeocodedAddress | null | undefined) {
  if (!address) return "";
  const streetParts = [address.name, address.street].filter(Boolean);
  const street = streetParts.length
    ? Array.from(new Set(streetParts.map((part) => String(part).trim()).filter(Boolean))).join(" ")
    : "";
  const cityLabel = deviceAddressCityLabel(address);
  const postal = address.postalCode || "";
  return [street, cityLabel, postal]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

function hasRideCoordinates(latitude: number | null | undefined, longitude: number | null | undefined) {
  return typeof latitude === "number"
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && typeof longitude === "number"
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
    // 0,0 is our missing-geocode sentinel. Either coordinate can otherwise
    // legitimately be zero (for example, a route on the equator or prime
    // meridian), so do not reject it individually.
    && !(Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001);
}

function looksLikeBroadRideCityQuery(value: string) {
  const text = value.trim();
  if (text.length < 3) return false;
  if (/[,\d]/.test(text)) return false;
  if (/\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|station|airport|terminal|university|college|mall|hotel|apartments?)\b/i.test(text)) {
    return false;
  }
  return text.split(/\s+/).length <= 3;
}

// A Places session token only correlates the current typing interaction with
// the selected place. It is never an account or authentication credential.
function createRidePlacesSessionToken() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const budgetValues = [700, 900, 1200, 1600, 2000];
const renterAgeOptions = ["21-24", "25+"];
const rideModes: Array<{ type: RideType; title: string; copy: string }> = [
  { type: "GENERAL_REQUEST", title: "Request a ride", copy: "Point-to-point ride for today or later." },
  { type: "SCHEDULED_REQUEST", title: "Scheduled", copy: "Recurring commute with daily ride instances." },
  { type: "CARPOOL_REQUEST", title: "Find carpool", copy: "Match with drivers going your direction." },
  { type: "CARPOOL_OFFER", title: "Offer a ride", copy: "List route, seats, luggage, and contribution." }
];
const indiaRidePopularCities: RidePlaceSuggestion[] = [
  { label: "Bengaluru, Karnataka, India", main: "Bengaluru", secondary: "Karnataka, India", distanceMiles: null, lat: 12.9716, lng: 77.5946, source: "country-fallback" },
  { label: "Chennai, Tamil Nadu, India", main: "Chennai", secondary: "Tamil Nadu, India", distanceMiles: null, lat: 13.0827, lng: 80.4365, source: "country-fallback" },
  { label: "Mumbai, Maharashtra, India", main: "Mumbai", secondary: "Maharashtra, India", distanceMiles: null, lat: 19.0760, lng: 72.8777, source: "country-fallback" },
  { label: "Pune, Maharashtra, India", main: "Pune", secondary: "Maharashtra, India", distanceMiles: null, lat: 18.5204, lng: 73.8567, source: "country-fallback" },
  { label: "Delhi, India", main: "Delhi", secondary: "India", distanceMiles: null, lat: 28.6139, lng: 77.2090, source: "country-fallback" },
  { label: "Vijayawada, Andhra Pradesh, India", main: "Vijayawada", secondary: "Andhra Pradesh, India", distanceMiles: null, lat: 16.5062, lng: 80.6480, source: "country-fallback" },
  { label: "Visakhapatnam, Andhra Pradesh, India", main: "Visakhapatnam", secondary: "Andhra Pradesh, India", distanceMiles: null, lat: 17.6868, lng: 83.2185, source: "country-fallback" },
  { label: "Warangal, Telangana, India", main: "Warangal", secondary: "Telangana, India", distanceMiles: null, lat: 17.9689, lng: 79.5941, source: "country-fallback" },
];
const usRidePopularCities: RidePlaceSuggestion[] = [
  { label: "New York, NY, USA", main: "New York", secondary: "NY, USA", distanceMiles: null, lat: 40.7128, lng: -74.0060, source: "country-fallback" },
  { label: "Los Angeles, CA, USA", main: "Los Angeles", secondary: "CA, USA", distanceMiles: null, lat: 34.0522, lng: -118.2437, source: "country-fallback" },
  { label: "Chicago, IL, USA", main: "Chicago", secondary: "IL, USA", distanceMiles: null, lat: 41.8781, lng: -87.6298, source: "country-fallback" },
  { label: "Denver, CO, USA", main: "Denver", secondary: "CO, USA", distanceMiles: null, lat: 39.7392, lng: -104.9903, source: "country-fallback" },
];

function bundledRideCityImage(place: Pick<RidePlaceSuggestion, "label" | "main">): ImageSourcePropType {
  const location = `${place.main} ${place.label}`.toLowerCase();
  if (location.includes("new york")) return appAssets.cityNewYork;
  if (location.includes("los angeles")) return appAssets.cityLosAngeles;
  if (location.includes("denver")) return appAssets.cityDenver;
  if (location.includes("austin")) return appAssets.cityAustin;
  if (location.includes("miami")) return appAssets.cityMiami;
  if (location.includes("bengaluru") || location.includes("bangalore")) return appAssets.cityBengaluru;
  if (location.includes("mumbai")) return appAssets.cityMumbai;
  return appAssets.launchCityscape;
}
const rideServicePosters: Array<{
  key: "scheduled" | "general" | "carpool";
  type: RideType;
  title: string;
  subtitle: string;
  stat: string;
  insight: string;
  tint: string;
  glyph: "scheduled" | "general" | "carpool";
  register: string;
  works: string[];
  access: string;
  available: boolean;
}> = [
  {
    key: "scheduled",
    type: "SCHEDULED_REQUEST",
    title: "Scheduled rides",
    subtitle: "Available soon",
    stat: "Example: Lone Tree to DU every weekday at 8:00 AM.",
    insight: "Scheduled rides will be available soon. For now, use Carpool to share a route with riders already going the same direction.",
    tint: "#8a5a00",
    glyph: "scheduled",
    register: "Enter pickup, destination, days, time, seats, and notes.",
    works: ["Create the schedule.", "Matched drivers or riders respond.", "Use Activity and Chitthi for each accepted ride."],
    access: "Choose this when the same route repeats.",
    available: false
  },
  {
    key: "general",
    type: "GENERAL_REQUEST",
    title: "General rides",
    subtitle: "Available soon",
    stat: "Example: Downtown to the train station today at 6:00 PM",
    insight: "General rides will be available soon. For now, use Carpool for shared route matching and direct rider-driver agreement.",
    tint: "#243b73",
    glyph: "general",
    register: "Enter pickup, destination, date/time, seats, luggage, and notes.",
    works: ["Search both places with Google Places.", "Review the route and suggested contribution.", "Use Chitthi before requesting or accepting to confirm details."],
    access: "Choose this for one ride inside or near the city.",
    available: false
  },
  {
    key: "carpool",
    type: "CARPOOL_REQUEST",
    title: "Carpool",
    subtitle: "Shared route, shared cost",
    stat: "Example: Your city to a nearby city or a longer interstate route",
    insight: "Best when riders and drivers are already going the same direction. Useful for longer trips, airport runs, or shared commutes.",
    tint: "#0f5f4b",
    glyph: "carpool",
    register: "Enter route, date/time, seats, luggage, and contribution.",
    works: ["Drivers list open seats.", "Riders request seats on matching routes.", "Both sides confirm details in Chitthi."],
    access: "Choose this for city-to-city, long-distance, or shared-cost rides.",
    available: true
  }
];
const rideOfferSurfaces: Array<{
  key: "scheduled" | "general" | "carpool";
  title: string;
  subtitle: string;
  note: string;
  type: RideType;
  symbol: string;
  available: boolean;
}> = [
  {
    key: "scheduled",
    title: "Offer scheduled ride",
    subtitle: "Available soon",
    note: "Driver can offer recurring seats on this schedule. Include weekdays, pickup window, seat count, and contribution.",
    type: "CARPOOL_OFFER",
    symbol: "SOON",
    available: false
  },
  {
    key: "general",
    title: "Offer general ride",
    subtitle: "Available soon",
    note: "Driver can offer a one-time ride. Include pickup area, drop-off area, available time, seats, and contribution.",
    type: "CARPOOL_OFFER",
    symbol: "SOON",
    available: false
  },
  {
    key: "carpool",
    title: "Offer carpool",
    subtitle: "Shared route and seats",
    note: "Driver can offer open seats on a shared route. Include route, seat count, luggage space, timing, and contribution.",
    type: "CARPOOL_OFFER",
    symbol: "POOL",
    available: true
  }
];
const rideFlowSteps = ["List route", "Match nearby", "Request seat", "Ride together"];
const rideLifecycleStates = ["Requested", "Matching", "Accepted", "En route", "Arrived", "In progress", "Completed"];
const rideOwnerRequestStates = ["Listed", "Request", "Accepted", "Arriving", "Completed"];
const rideDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  const date = new Date(`2026-01-01T${String(hour).padStart(2, "0")}:${minute}:00`);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
});

function isoDateFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateOptionsFromToday(count = 90) {
  return Array.from({ length: count }, (_, index) => isoDateFromNow(index));
}

function todayIsoDate() {
  return isoDateFromNow(0);
}

function formatDateLabel(dateText: string) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateText || "Choose date";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function timeTextToMinutes(timeText: string) {
  const match = String(timeText || "10:00 AM").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 600;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function minimumPickupTimeToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() === 0 ? 0 : 60, 0, 0);
  return now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function firstAllowedPickupTime(pickupDate: string) {
  if (pickupDate !== todayIsoDate()) return timeOptions[0];
  const minimum = timeTextToMinutes(minimumPickupTimeToday());
  return timeOptions.find((time) => timeTextToMinutes(time) >= minimum) || timeOptions[timeOptions.length - 1];
}

function ridePickupIsInPast(pickupDate: string, pickupTime: string) {
  if (!pickupDate || !pickupTime) return false;
  const [year, month, day] = pickupDate.split("-").map(Number);
  if (!year || !month || !day) return true;
  const minutes = timeTextToMinutes(pickupTime);
  const pickup = new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, 0);
  return Number.isNaN(pickup.getTime()) || pickup.getTime() < Date.now();
}

function rentalDays(search: RentalSearchInput) {
  const pickup = new Date(`${search.pickupDate}T00:00:00`);
  const dropoff = new Date(`${search.returnDate}T00:00:00`);
  const diff = Math.ceil((dropoff.getTime() - pickup.getTime()) / 86400000);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

function durationRateTier(days: number) {
  if (days >= 30) return { rate: 0.3, label: "Monthly rate" };
  if (days >= 7) return { rate: 0.15, label: "Weekly rate" };
  return { rate: 0, label: "Standard rate" };
}

function rentalLengthText(days: number) {
  if (days <= 0) return "Choose valid dates";
  if (days >= 30) {
    const months = days / 30;
    return `${days} days · about ${Number.isInteger(months) ? months : months.toFixed(1)} months`;
  }
  return `${days} days`;
}

function dailyPriceRange(price: number | string, days: number) {
  const daily = Number(price || 0);
  const average = Math.round(daily);
  const baseLow = Math.max(25, average - 5);
  const baseHigh = Math.max(baseLow, average + 5);
  const tier = durationRateTier(days);
  const low = Math.max(25, Math.round(baseLow * (1 - tier.rate)));
  const high = Math.max(low, Math.round(baseHigh * (1 - tier.rate)));
  return { low, high, tier };
}

function durationSavingsText(price: number | string, days: number) {
  const tier = durationRateTier(days);
  const daily = Number(price || 0);
  const savings = daily > 0 && days > 0 ? daily * days * tier.rate : 0;
  if (!tier.rate || savings <= 0) return "";
  return `${tier.label}: save about $${savings.toFixed(2)} vs daily pricing.`;
}

function dollars(value: unknown) {
  const numeric = Number(value || 0);
  return `$${numeric.toFixed(2)}`;
}

function normalizeLocalityKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/,\s*(co|ca|tx|fl|usa)$/i, "");
}

function isStreetLikeLocality(value: string) {
  const clean = normalizeLocalityKey(value);
  if (!clean) return false;
  if (/^\d{3,}/.test(clean)) return true;
  if (/\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|court|ct|circle|cir|way|place|pl|terrace|ter|parkway|pkwy|highway|hwy)\b\.?/i.test(clean)) return true;
  if (/\b(?:apt|apartment|unit|suite|ste|#)\s*[\w-]+/i.test(clean)) return true;
  if (/\b\d{5}(?:-\d{4})?\b/.test(clean)) return true;
  return false;
}

function cleanLocalityName(value: string, fallbackCity: string) {
  const clean = value
    .replace(/\s+/g, " ")
    .replace(/\b(?:co|ca|tx|fl|usa)\b\.?$/i, "")
    .replace(/[,\s]+$/g, "")
    .trim();
  const cityOnly = normalizeLocalityKey(fallbackCity || "");
  const cleanKey = normalizeLocalityKey(clean);
  if (!clean || cleanKey === cityOnly || cleanKey === "area open") return "";
  if (isStreetLikeLocality(clean)) return "";
  return clean;
}

function localityPresetsForCity(city: string) {
  const cityKey = city.trim().toLowerCase().replace(/\s+/g, " ").replace(/,\s*usa$/i, "");
  return cityLocalityPresets[cityKey] || [];
}

const initialRentalSearch: RentalSearchInput = {
  pickupLocation: "Denver International Airport (DEN)",
  returnLocation: "Denver International Airport (DEN)",
  pickupDate: isoDateFromNow(6),
  returnDate: isoDateFromNow(13),
  pickupTime: "10:00 AM",
  returnTime: "10:00 AM",
  renterAge: "25+",
  discountCode: "",
  days: 7,
  additionalDriverRequested: false,
  additionalDriverName: "",
  additionalDriverAge: ""
};

const initialRentalListingDraft: RentalCarListingInput = {
  name: "",
  brand: "",
  model: "",
  year: "",
  category: "Sedan",
  type: "Economy",
  fuelType: "Gas",
  seats: "5",
  bags: "2",
  doors: "4",
  transmission: "Automatic",
  dailyPrice: "",
  color: "",
  location: "Denver International Airport (DEN)",
  licensePlate: "",
  availableFrom: isoDateFromNow(1),
  availableTo: isoDateFromNow(30),
  features: "Airport pickup, no hidden fees, insured vehicle",
  notes: ""
};

const initialRideForm: RideInput = {
  rideType: "CARPOOL_REQUEST",
  city: "",
  origin: "",
  originLat: null,
  originLng: null,
  destination: "",
  destinationLat: null,
  destinationLng: null,
  pickupDate: isoDateFromNow(1),
  pickupTime: "8:00 AM",
  startDate: isoDateFromNow(1),
  endDate: "",
  daysOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  seats: "1",
  luggage: "1 small bag",
  accessibility: "",
  maxDetourMinutes: "15",
  maxPickupDistanceMiles: "50",
  departureFlexMinutes: "30",
  contributionPerSeat: "",
  approvalRequired: true,
  vehicleMakeModel: "",
  vehicleYear: "",
  vehicleColor: "",
  licensePlate: "",
  licenseState: "",
  preferences: "No smoking",
  notes: ""
};

function CarpoolOutlineIcon({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.carpoolIconCanvas, compact && styles.carpoolIconCanvasCompact]}>
      <View style={[styles.carpoolIconRoof, compact && styles.carpoolIconRoofCompact]} />
      <View style={[styles.carpoolIconBody, compact && styles.carpoolIconBodyCompact]} />
      <View style={[styles.carpoolIconWheel, styles.carpoolIconWheelLeft, compact && styles.carpoolIconWheelCompact]} />
      <View style={[styles.carpoolIconWheel, styles.carpoolIconWheelRight, compact && styles.carpoolIconWheelCompact]} />
    </View>
  );
}

export function HousingScreen({
  data,
  posts,
  cars,
  selectedNeed,
  selectedCategory,
  selectedGender,
  selectedBudget,
  selectedSort,
  onMessage,
  onRideMessage,
  sentPostIds = [],
  sentRideIds = [],
  onSendPostMessage,
  onOpenPostConversation,
  onOpenMessenger,
  onNeedSelect,
  onAreaSelect,
  onOpenSearch,
  onCategorySelect,
  onGenderSelect,
  onBudgetSelect,
  onSortSelect,
  onPostNeed,
  onRequireLogin,
  onBookCar,
  onBottomTabsHiddenChange,
  focusWelcomeKey = 0,
  focusListingResultsKey = 0,
  carpoolFocusKey = 0,
  rentalFocusKey = 0,
  rideOwnerOpenToken = 0,
  rideOwnerOpenTarget = "workspace",
  rideOwnerEditId = "",
  rideOwnerFocusId = "",
  onRideOwnerClosed,
  linkedHousingPost,
  linkedCarpoolRide,
  onLinkedHousingPostOpened,
  onHousingDetailClosed,
  onManageHousingListing,
  onLinkedCarpoolRideOpened,
  discoveryLocation = "",
  hasExactLocationSearch = false,
  showSearchResults = true
}: Props) {
  const isLight = useColorScheme() === "light";
  const safeAreaInsets = useSafeAreaInsets();
  const [mode, setMode] = useState<"housing" | "ride" | "cheapCars">("housing");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // A listing opened from Ask must be present on the very first render. Waiting
  // for the synchronization effect caused the Housing page to flash before the
  // details modal appeared.
  const [detailPost, setDetailPost] = useState<HousingPost | null>(() => linkedHousingPost || null);
  const linkedDetailPresentation = useRef(Boolean(linkedHousingPost)).current;
  const [detailImageIndex, setDetailImageIndex] = useState(0);
  const [detailPreviewImage, setDetailPreviewImage] = useState("");
  const [detailPreviewImageIndex, setDetailPreviewImageIndex] = useState(0);
  const [detailPhotoScales, setDetailPhotoScales] = useState<Record<number, number>>({});
  const [detailCarouselWidth, setDetailCarouselWidth] = useState(0);
  const [detailImageErrors, setDetailImageErrors] = useState<Record<string, boolean>>({});
  const detailCarouselRef = useRef<ScrollView>(null);
  const detailPreviewCarouselRef = useRef<ScrollView>(null);
  const detailScrollRef = useRef<ScrollView>(null);
  const detailScrollOffsetRef = useRef(0);
  const [detailCanScrollMore, setDetailCanScrollMore] = useState(false);
  const [searchPhraseIndex, setSearchPhraseIndex] = useState(0);
  const [quickLinkWordIndex, setQuickLinkWordIndex] = useState(0);
  const [quickLinkLetterCount, setQuickLinkLetterCount] = useState(1);
  const [exportsInterestBusy, setExportsInterestBusy] = useState(false);
  const [exportsInterestSent, setExportsInterestSent] = useState(false);
  const [exportsInterestError, setExportsInterestError] = useState("");
  const [exportsInfoOpen, setExportsInfoOpen] = useState(false);
  const [cityExperienceRating, setCityExperienceRating] = useState(0);
  const [cityExperienceText, setCityExperienceText] = useState("");
  const [cityExperienceBusy, setCityExperienceBusy] = useState(false);
  const [cityExperienceStatus, setCityExperienceStatus] = useState("");
  const [cityExperienceSubmitted, setCityExperienceSubmitted] = useState(false);
  const [cityExperienceModalOpen, setCityExperienceModalOpen] = useState(false);
  const [rentalSearch, setRentalSearch] = useState<RentalSearchInput>(initialRentalSearch);
  const [rentalCars, setRentalCars] = useState<Car[]>(cars);
  const [rentalBusy, setRentalBusy] = useState(false);
  const [rentalSearched, setRentalSearched] = useState(false);
  const [rentalResultsY, setRentalResultsY] = useState(0);
  const [selectedRentalCar, setSelectedRentalCar] = useState<Car | null>(null);
  const [rentalQuote, setRentalQuote] = useState<RentalQuote | null>(null);
  const [rentalCheckoutInfo, setRentalCheckoutInfo] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [rentalPicker, setRentalPicker] = useState<null | "pickupLocation" | "returnLocation" | "pickupDate" | "returnDate" | "pickupTime" | "returnTime" | "renterAge">(null);
  const [rentalOwnerOpen, setRentalOwnerOpen] = useState(false);
  const [rentalOwnerBusy, setRentalOwnerBusy] = useState(false);
  const [rentalOwnerCars, setRentalOwnerCars] = useState<Car[]>([]);
  const [rentalListingDraft, setRentalListingDraft] = useState<RentalCarListingInput>(initialRentalListingDraft);
  const [rideForm, setRideForm] = useState<RideInput>(initialRideForm);
  const [rideRows, setRideRows] = useState<RidePost[]>([]);
  const [rideActivityRows, setRideActivityRows] = useState<RidePost[]>([]);
  const [driverLocationByRideId, setDriverLocationByRideId] = useState<Record<string, DriverLocationStatus>>({});
  const [rideActivityBusy, setRideActivityBusy] = useState(false);
  const [rideBusy, setRideBusy] = useState(false);
  const [ridePlanBusy, setRidePlanBusy] = useState(false);
  const [ridePosted, setRidePosted] = useState(false);
  const [editingRideId, setEditingRideId] = useState("");
  const [rideListingSuccess, setRideListingSuccess] = useState<RidePost | null>(null);
  const [ridePlannerOpen, setRidePlannerOpen] = useState(false);
  const [ridePlannerStage, setRidePlannerStage] = useState<"plan" | "choices">("plan");
  const [rideFocusedField, setRideFocusedField] = useState<"origin" | "destination">("destination");
  const [rideSuggestions, setRideSuggestions] = useState<RidePlaceSuggestion[]>([]);
  const [rideSuggestionsBusy, setRideSuggestionsBusy] = useState(false);
  const [rideSuggestionsEnabled, setRideSuggestionsEnabled] = useState(false);
  const [rideEditorLoading, setRideEditorLoading] = useState(false);
  const [ridePopularPlaces, setRidePopularPlaces] = useState<RidePlaceSuggestion[]>([]);
  const [failedRidePopularImages, setFailedRidePopularImages] = useState<Record<string, boolean>>({});
  const [currentRideLocation, setCurrentRideLocation] = useState<CurrentRideLocation | null>(null);
  const [currentRideLocationBusy, setCurrentRideLocationBusy] = useState(false);
  const currentRideLocationRequestRef = useRef<Promise<CurrentRideLocation | null> | null>(null);
  const [currentRideLocationError, setCurrentRideLocationError] = useState("");
  const [selectedRideChoice, setSelectedRideChoice] = useState("");
  const [selectedRideService, setSelectedRideService] = useState<"scheduled" | "general" | "carpool">("carpool");
  const [rideRequestStatus, setRideRequestStatus] = useState("");
  const [savedUnmatchedRideId, setSavedUnmatchedRideId] = useState("");
  const [rideOwnerOpen, setRideOwnerOpen] = useState(false);
  const [rideOwnerRequestsAfterListing, setRideOwnerRequestsAfterListing] = useState(false);
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const layout = useResponsiveLayout();
  const compactHousingHome = viewportWidth < 560;
  const housingCardWidth = compactHousingHome
    ? Math.max(288, viewportWidth - 68)
    : 328;
  const housingPosterWidth = Math.max(
    housingCardWidth,
    (typeof layout.contentMaxWidth === "number" ? layout.contentMaxWidth : viewportWidth) - 28
  );
  const housingCardHeight = compactHousingHome ? 558 : 638;
  const scrollRef = useRef<ScrollView | null>(null);
  const rideOriginInputRef = useRef<TextInput | null>(null);
  const rideDestinationInputRef = useRef<TextInput | null>(null);
  const ridePlanSubmittingRef = useRef(false);
  const rideOwnerPlannerEntryRef = useRef(false);
  const rideAutoOriginRef = useRef("");
  const selectedRideSuggestionRef = useRef("");
  const selectedRideLabelsRef = useRef({ origin: "", destination: "" });
  const selectedRidePlaceIdsRef = useRef({ origin: "", destination: "" });
  const ridePlacesSessionTokensRef = useRef({ origin: "", destination: "" });
  const lastRideOwnerOpenTokenRef = useRef(0);
  const rideEditorRequestRef = useRef(0);
  const rideOwnerLocationSubscription = useRef<Location.LocationSubscription | null>(null);
  const rideOwnerLocationRideId = useRef("");
  const [searchIsScrolled, setSearchIsScrolled] = useState(false);
  const [welcomeY, setWelcomeY] = useState(0);
  const [listingResultsY, setListingResultsY] = useState(0);
  const [housingAreaStats, setHousingAreaStats] = useState<HousingAreaStat[]>([]);
  const topOverscrollBackground = mode === "cheapCars" ? theme.colors.bg : "#dff3ff";

  useEffect(() => {
    let cancelled = false;
    const city = data?.location.city || discoveryLocation;
    if (!city) {
      setHousingAreaStats([]);
      return () => { cancelled = true; };
    }
    const cached = getCachedHousingAreaStats(city);
    if (cached) setHousingAreaStats(cached);
    else setHousingAreaStats([]);
    void hydrateCachedHousingAreaStats(city).then((areas) => {
      if (!cancelled && areas) setHousingAreaStats(areas);
    });
    void getHousingAreaStats(city).then((areas) => {
      if (!cancelled) setHousingAreaStats(areas);
    });
    return () => { cancelled = true; };
  }, [data?.location.city, discoveryLocation]);

  const liveRideOwnerRequest = useMemo(
    () => rideActivityRows.find((ride) => ride.activityRole === "DRIVER_NOTIFICATION" && ["EN_ROUTE", "ARRIVED"].includes((ride.dispatchStatus || "").toUpperCase())) || null,
    [rideActivityRows]
  );

  useEffect(() => {
    if (ridePlannerOpen || rideOwnerOpen || rideListingSuccess) return;
    onBottomTabsHiddenChange?.(false);
  }, [onBottomTabsHiddenChange, rideListingSuccess, rideOwnerOpen, ridePlannerOpen]);

  useEffect(() => {
    let cancelled = false;
    async function maintainRideOwnerLocation() {
      if (!liveRideOwnerRequest) {
        rideOwnerLocationSubscription.current?.remove();
        rideOwnerLocationSubscription.current = null;
        rideOwnerLocationRideId.current = "";
        return;
      }
      if (rideOwnerLocationRideId.current === liveRideOwnerRequest.id && rideOwnerLocationSubscription.current) return;
      const permission = await Location.getForegroundPermissionsAsync();
      if (cancelled || permission.status !== "granted") return;
      rideOwnerLocationSubscription.current?.remove();
      rideOwnerLocationRideId.current = liveRideOwnerRequest.id;
      rideOwnerLocationSubscription.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 20 },
        (position) => void updateRideDriverLocation(liveRideOwnerRequest.id, position.coords.latitude, position.coords.longitude).catch(() => undefined)
      );
    }
    void maintainRideOwnerLocation();
    return () => { cancelled = true; };
  }, [liveRideOwnerRequest?.id]);

  useEffect(() => () => {
    rideOwnerLocationSubscription.current?.remove();
    rideOwnerLocationSubscription.current = null;
  }, []);

  useEffect(() => {
    if (!rideOwnerOpen) return;
    const activeRiderRideIds = rideActivityRows
      .filter((ride) => ride.activityRole === "MINE" && ride.role === "RIDER" && ["EN_ROUTE", "ARRIVED"].includes(String(ride.dispatchStatus || "").toUpperCase()))
      .map((ride) => ride.id)
      .filter(Boolean);
    if (!activeRiderRideIds.length) {
      setDriverLocationByRideId({});
      return;
    }
    let cancelled = false;
    const refreshDriverLocations = async () => {
      const results = await Promise.all(activeRiderRideIds.map(async (rideId) => {
        try {
          const response = await getRideDriverLocation(rideId);
          return [rideId, {
            available: response.available,
            distanceMiles: response.trip?.distanceMiles,
            etaMinutes: response.trip?.etaMinutes,
            source: response.trip?.source,
            ageSeconds: response.location?.ageSeconds,
          }] as const;
        } catch {
          return [rideId, { available: false }] as const;
        }
      }));
      if (!cancelled) setDriverLocationByRideId(Object.fromEntries(results));
    };
    void refreshDriverLocations();
    const interval = setInterval(() => void refreshDriverLocations(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [rideActivityRows, rideOwnerOpen]);

  useEffect(() => {
    if (!linkedHousingPost) return;
    setMode("housing");
    setDetailPost(linkedHousingPost);
    onLinkedHousingPostOpened?.();
  }, [linkedHousingPost, onLinkedHousingPostOpened]);

  function closeHousingDetail() {
    setDetailPost(null);
    onHousingDetailClosed?.();
  }

  useEffect(() => {
    if (!linkedCarpoolRide) return;
    ridePlanSubmittingRef.current = false;
    rideEditorRequestRef.current += 1;
    selectedRideSuggestionRef.current = "";
    selectedRideLabelsRef.current = { origin: "", destination: "" };
    selectedRidePlaceIdsRef.current = { origin: "", destination: "" };
    ridePlacesSessionTokensRef.current = { origin: "", destination: "" };
    setEditingRideId("");
    setRidePosted(false);
    setRideBusy(false);
    setRidePlanBusy(false);
    setRideEditorLoading(false);
    setRideSuggestionsEnabled(false);
    setRideSuggestions([]);
    setRideSuggestionsBusy(false);
    setRideRequestStatus("");
    setRideOwnerOpen(false);
    setMode("ride");
    setRideRows([linkedCarpoolRide]);
    setRideForm({
      ...initialRideForm,
      city: linkedCarpoolRide.city || rideDefaultCity,
      origin: linkedCarpoolRide.origin,
      originLat: linkedCarpoolRide.originLat ?? null,
      originLng: linkedCarpoolRide.originLng ?? null,
      destination: linkedCarpoolRide.destination,
      destinationLat: linkedCarpoolRide.destinationLat ?? null,
      destinationLng: linkedCarpoolRide.destinationLng ?? null,
      pickupDate: linkedCarpoolRide.pickupDate,
      pickupTime: linkedCarpoolRide.pickupTime,
      rideType: "CARPOOL_REQUEST"
    });
    setSelectedRideChoice(`offer:${linkedCarpoolRide.id}`);
    setRidePlannerStage("choices");
    setRidePlannerOpen(true);
    onBottomTabsHiddenChange?.(true);
    onLinkedCarpoolRideOpened?.();
  }, [linkedCarpoolRide, onBottomTabsHiddenChange, onLinkedCarpoolRideOpened]);

  const displayName = data?.user?.name?.split(" ")[0] || "there";
  const cityExperienceLocation = data?.location.city || discoveryLocation || "your current city";
  const cityExperienceInitials = avatarInitials(data?.user?.name || "FairFares member", "FF");
  const selectedLocationText = (data?.location.selected || data?.location.city || "").trim();
  const distanceReference = selectedLocationText.includes("·")
    ? selectedLocationText.split("·").pop()?.trim()
    : selectedLocationText || data?.location.city || "";

  async function showExportsInterest() {
    setExportsInfoOpen(true);
    if (exportsInterestSent) {
      return;
    }
    if (exportsInterestBusy) return;
    setExportsInterestError("");
    setExportsInterestBusy(true);
    try {
      await submitAppFeedback(5, "Interested in FairFares Exports & Imports service.", "mobile-home-exports-imports");
      setExportsInterestSent(true);
    } catch (error) {
      setExportsInterestError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setExportsInterestBusy(false);
    }
  }

  async function shareCityExperience() {
    if (!data?.user) {
      onRequireLogin?.();
      return;
    }
    if (!cityExperienceRating) {
      setCityExperienceStatus("Choose a star rating first.");
      return;
    }
    const reviewText = cityExperienceText.trim();
    if (reviewText.length < 8) {
      setCityExperienceStatus("Tell us a little more about your experience.");
      return;
    }
    if (cityExperienceBusy) return;
    setCityExperienceBusy(true);
    setCityExperienceStatus("");
    try {
      await submitAppFeedback(
        cityExperienceRating,
        `${cityExperienceLocation}: ${reviewText}`,
        "mobile-housing-city-experience"
      );
      setCityExperienceSubmitted(true);
      setCityExperienceStatus("Thanks! Your experience was sent for review.");
      setCityExperienceModalOpen(false);
    } catch (error) {
      setCityExperienceStatus(error instanceof Error ? error.message : "Could not send your experience. Please try again.");
    } finally {
      setCityExperienceBusy(false);
    }
  }
  const rideDefaultCity = data?.location.city || discoveryLocation || "";
  const rideDefaultPickup = currentRideLocation?.label || selectedLocationText || data?.location.suggested || rideDefaultCity || "Your location";
  const activeSearchPhrases =
    mode === "ride"
      ? rideSearchPhrases
      : mode === "cheapCars"
        ? rentalSearchPhrases
        : housingSearchPhrases;
  const activeSearchPhrase = activeSearchPhrases[searchPhraseIndex % activeSearchPhrases.length] || activeSearchPhrases[0];
  const searchBarText = activeSearchPhrase;
  const currentQuickLinkWord = quickLinkWords[quickLinkWordIndex % quickLinkWords.length] || quickLinkWords[0];
  const quickLinkAnimatedWord = currentQuickLinkWord.slice(0, quickLinkLetterCount);
  const locationScopedPosts = useMemo(() => {
    if (!hasExactLocationSearch) return posts;
    const selectedState = explicitUsState(data?.location.city || "");
    if (!selectedState) return posts;
    return posts.filter((post) => {
      const listingStates = [post.city, post.addressLabel, post.location]
        .map((value) => explicitUsState(value || ""))
        .filter(Boolean);
      return listingStates.every((state) => state === selectedState);
    });
  }, [data?.location.city, hasExactLocationSearch, posts]);
  const sortedPosts = useMemo(() => {
    const compareOptionalNumber = (a: number | null | undefined, b: number | null | undefined, descending = false) => {
      const aKnown = a !== null && a !== undefined && Number.isFinite(Number(a));
      const bKnown = b !== null && b !== undefined && Number.isFinite(Number(b));
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (!aKnown || !bKnown) return 0;
      return descending ? Number(b) - Number(a) : Number(a) - Number(b);
    };
    return [...locationScopedPosts].sort((a, b) => {
      if (Boolean(a.sample) !== Boolean(b.sample)) return a.sample ? 1 : -1;
      if (selectedSort === "distanceDesc") return compareOptionalNumber(a.distanceMiles, b.distanceMiles, true);
      if (selectedSort === "rentAsc") return compareOptionalNumber(a.rentValue || null, b.rentValue || null);
      if (selectedSort === "rentDesc") return compareOptionalNumber(a.rentValue || null, b.rentValue || null, true);
      return compareOptionalNumber(a.distanceMiles, b.distanceMiles);
    });
  }, [locationScopedPosts, selectedSort]);
  const housingCurrencySymbol = locationScopedPosts.find((post) => post.currencySymbol)?.currencySymbol || "$";
  const renderHousingPostCard = (post: HousingPost) => (
    <HousingCard
      key={post.id}
      post={post}
      onMessage={onMessage}
      onOpen={setDetailPost}
      distanceLabel={distanceReference}
      width={housingCardWidth}
      height={housingCardHeight}
      compact={compactHousingHome}
      messageSent={sentPostIds.includes(post.id)}
      onSendMessage={onSendPostMessage}
      onSeeConversation={onOpenPostConversation}
      ownListing={Boolean(data?.user?.id && Number(post.posterUserId) === Number(data.user.id))}
    />
  );
  const neighborhoodBars = useMemo(() => {
    return housingAreaStats.slice(0, 6).map((locality, index) => {
      return {
        ...locality,
        rentLabel: `${locality.currencySymbol || housingCurrencySymbol}${locality.averageRent.toLocaleString()}`,
        height: [66, 52, 78, 62, 46, 40][index % 6],
        color: ["#249cff", "#38c98f", "#ff9639", "#8b5cf6", "#f45b9a", "#47d4d4"][index % 6],
        image: appAssets.housingNeighborhoodCity
      };
    });
  }, [housingAreaStats, housingCurrencySymbol]);
  const neighborhoodCityName = (data?.location.city || discoveryLocation || "Denver").split(",")[0]?.trim() || "Denver";
  const rentalRows = rentalSearched ? rentalCars : [];
  const lowestRentalDailyPrice = useMemo(() => {
    const validRates = rentalCars
      .map((car) => Number(car.daily_price || 0))
      .filter((rate) => Number.isFinite(rate) && rate > 0);
    return validRates.length ? Math.min(...validRates) : null;
  }, [rentalCars]);
  const rentalLocationOptions = useMemo(() => {
    const locations = new Map<string, string>();
    const addLocation = (raw: string) => {
      raw.split(/[\n;|]+/).forEach((part) => {
        const location = part.trim();
        if (!location) return;
        const key = location.toLowerCase().replace(/[^a-z0-9]/g, "");
        const existing = locations.get(key);
        if (!existing || (location.match(/,/g) || []).length > (existing.match(/,/g) || []).length) {
          locations.set(key, location);
        }
      });
    };
    cars.forEach((car) => {
      if (car.location) addLocation(car.location);
    });
    if (!locations.size) {
      addLocation(rentalSearch.pickupLocation);
      addLocation(rentalSearch.returnLocation);
    }
    return Array.from(locations.values());
  }, [cars, rentalSearch.pickupLocation, rentalSearch.returnLocation]);
  const rentalDayCount = rentalDays(rentalSearch);
  const rentalTier = durationRateTier(rentalDayCount);
  const calendarDates = useMemo(() => dateOptionsFromToday(90), []);
  const detailImages = detailPost
    ? (detailPost.images?.length ? detailPost.images : detailPost.imageUrl ? [detailPost.imageUrl] : []).slice(0, 4)
    : [];
  const detailPhotoScale = detailPhotoScales[detailPreviewImageIndex] || 1;
  const detailImageWidth = Math.max(260, detailCarouselWidth || viewportWidth - theme.spacing.md * 4);
  const detailPhotoHeight = Math.max(360, viewportHeight - (Platform.OS === "ios" ? 112 : 58));

  useEffect(() => {
    setDetailImageIndex(0);
    setDetailPreviewImage("");
    setDetailPreviewImageIndex(0);
    setDetailCarouselWidth(0);
    setDetailImageErrors({});
    detailScrollOffsetRef.current = 0;
    setDetailCanScrollMore(false);
  }, [detailPost?.id]);

  function markDetailImageError(uri: string) {
    setDetailImageErrors((current) => ({ ...current, [uri]: true }));
  }

  function handleDetailCarouselLayout(event: LayoutChangeEvent) {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setDetailCarouselWidth(width);
  }

  function showNextDetailImage() {
    if (detailImages.length < 2) return;
    const nextIndex = (detailImageIndex + 1) % detailImages.length;
    detailCarouselRef.current?.scrollTo({ x: nextIndex * detailImageWidth, animated: true });
    setDetailImageIndex(nextIndex);
  }

  function openDetailPreviewImage(index: number) {
    const image = detailImages[index];
    if (!image) return;
    setDetailPreviewImageIndex(index);
    setDetailPreviewImage(absoluteAssetUrl(image));
    requestAnimationFrame(() => detailPreviewCarouselRef.current?.scrollTo({ x: index * viewportWidth, animated: false }));
    setTimeout(() => detailPreviewCarouselRef.current?.scrollTo({ x: index * viewportWidth, animated: false }), 80);
  }

  function showDetailPreviewImage(index: number) {
    if (!detailImages.length) return;
    const nextIndex = (index + detailImages.length) % detailImages.length;
    setDetailPreviewImageIndex(nextIndex);
    setDetailPreviewImage(absoluteAssetUrl(detailImages[nextIndex]));
    detailPreviewCarouselRef.current?.scrollTo({ x: nextIndex * viewportWidth, animated: true });
  }

  function renderDetailImageFallback(post: HousingPost) {
    const title = post.roommateIntent
      ? "Need roommate"
      : post.mode === "NEED_PLACE"
        ? "Need a place"
        : "Place photos coming soon";
    const copy = post.roommateIntent
      ? "Photos are optional for roommate searches. Use the description and preferences to decide if it is a fit."
      : post.mode === "NEED_PLACE"
        ? "No photos needed for place requests. Check the preferred area, budget, move-in date, and requirements below."
        : "The owner has not added photos yet. Review the description and listing details below.";
    return (
      <View style={styles.detailImageFallback}>
        <Text style={styles.detailImageFallbackIcon}>{post.roommateIntent ? "👥" : post.mode === "NEED_PLACE" ? "🏠" : "🛏️"}</Text>
        <Text style={styles.detailImageFallbackTitle}>{title}</Text>
        <Text style={styles.detailImageFallbackCopy}>{copy}</Text>
      </View>
    );
  }

  useEffect(() => {
    if (!data?.user || data.hasSubmittedHousingExperience || cityExperienceSubmitted) return;
    const timer = setTimeout(() => {
      setCityExperienceModalOpen(true);
    }, 3 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [cityExperienceSubmitted, data?.hasSubmittedHousingExperience, data?.user?.id]);

  useEffect(() => {
    if (activeSearchPhrases.length < 2) return;
    const timer = setTimeout(() => {
      setSearchPhraseIndex((value) => (value + 1) % activeSearchPhrases.length);
    }, SEARCH_PHRASE_AUTO_SLIDE_MS);
    return () => clearTimeout(timer);
  }, [activeSearchPhrases.length, searchPhraseIndex]);

  useEffect(() => {
    setSearchPhraseIndex(0);
  }, [mode]);

  useEffect(() => {
    if (quickLinkWords.length < 2) return;
    const isComplete = quickLinkLetterCount >= currentQuickLinkWord.length;
    const timer = setTimeout(() => {
      if (isComplete) {
        setQuickLinkWordIndex((value) => (value + 1) % quickLinkWords.length);
        setQuickLinkLetterCount(1);
        return;
      }
      setQuickLinkLetterCount((value) => value + 1);
    }, isComplete ? QUICK_LINK_WORD_PAUSE_MS : QUICK_LINK_TYPE_MS);
    return () => clearTimeout(timer);
  }, [currentQuickLinkWord.length, quickLinkLetterCount]);

  useEffect(() => {
    setQuickLinkLetterCount(1);
  }, [quickLinkWordIndex]);

  useEffect(() => {
    setRentalCars(cars);
    setRentalSearched(false);
  }, [cars]);

  useEffect(() => {
    if (!rentalSearched || !rentalResultsY) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(rentalResultsY - 92, 0), animated: true });
    }, 120);
    return () => clearTimeout(timer);
  }, [rentalResultsY, rentalSearched]);

  useEffect(() => {
    setRideForm((current) => ({
      ...current,
      city: data?.location.city || current.city
    }));
  }, [data?.location.city]);

  useEffect(() => {
    if (selectedNeed === "rental_cars") {
      setMode("cheapCars");
      setRentalSearched(false);
      return;
    }
    if (selectedNeed === "ride_need" || selectedNeed === "ride_offer") {
      setMode("ride");
      setRideForm((current) => ({
        ...current,
        rideType: selectedNeed === "ride_offer" ? "CARPOOL_OFFER" : "CARPOOL_REQUEST"
      }));
    }
  }, [selectedNeed]);

  useEffect(() => {
    if (!carpoolFocusKey || (selectedNeed !== "ride_need" && selectedNeed !== "ride_offer")) return;
    setMode("ride");
    setSelectedRideService("carpool");
  }, [carpoolFocusKey, selectedNeed]);

  useEffect(() => {
    if (!rentalFocusKey || selectedNeed !== "rental_cars") return;
    // A Stripe return can arrive while the native full-screen quote modal is
    // still mounted. Reset every transient rental surface before showing the
    // car list again; changing selectedNeed alone is a no-op when rentals were
    // already selected and leaves the stale modal owning the touch responder.
    setRentalQuote(null);
    setSelectedRentalCar(null);
    setRentalPicker(null);
    setRentalBusy(false);
    setMode("cheapCars");
    setRentalSearched(false);
  }, [rentalFocusKey, selectedNeed]);

  useEffect(() => {
    if (!focusWelcomeKey) return;
    if (selectedNeed === "rental_cars" || selectedNeed === "ride_need" || selectedNeed === "ride_offer") return;
    setMode("housing");
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(welcomeY - 92, 0), animated: true });
    }, 120);
    return () => clearTimeout(timer);
  }, [focusWelcomeKey, selectedNeed, welcomeY]);

  useEffect(() => {
    if (!focusListingResultsKey) return;
    if (selectedNeed === "rental_cars" || selectedNeed === "ride_need" || selectedNeed === "ride_offer") return;
    setMode("housing");
    const scrollToListingResults = () => {
      scrollRef.current?.scrollTo({ y: Math.max(listingResultsY - 18, 0), animated: true });
    };
    const timer = setTimeout(() => {
      scrollToListingResults();
    }, 160);
    const settleTimer = setTimeout(() => {
      scrollToListingResults();
    }, 520);
    return () => {
      clearTimeout(timer);
      clearTimeout(settleTimer);
    };
  }, [focusListingResultsKey, listingResultsY, selectedNeed]);

  useEffect(() => {
    if (!rideOwnerOpenToken || rideOwnerOpenToken === lastRideOwnerOpenTokenRef.current) return;
    lastRideOwnerOpenTokenRef.current = rideOwnerOpenToken;
    if (rideOwnerEditId) {
      const requestId = rideEditorRequestRef.current + 1;
      rideEditorRequestRef.current = requestId;
      setRideEditorLoading(true);
      setRideSuggestionsEnabled(false);
      setRideSuggestions([]);
      onBottomTabsHiddenChange?.(true);
      void getRideActivity().then((rows) => {
        if (rideEditorRequestRef.current !== requestId) return;
        const ride = rows.find((item) => item.id === rideOwnerEditId && item.activityRole === "MINE" && !item.isExpired);
        if (!ride) {
          onBottomTabsHiddenChange?.(false);
          Alert.alert("Ride unavailable", "Only your current ride listings and requests can be edited.");
          return;
        }
        setEditingRideId(ride.id);
        rideAutoOriginRef.current = "";
        selectedRideLabelsRef.current = { origin: "", destination: "" };
        selectedRidePlaceIdsRef.current = { origin: "", destination: "" };
        ridePlacesSessionTokensRef.current = { origin: "", destination: "" };
        setRideForm({
          rideType: ride.type,
          city: ride.city || data?.location.city || discoveryLocation || "",
          origin: ride.origin,
          originLat: ride.originLat ?? null,
          originLng: ride.originLng ?? null,
          destination: ride.destination,
          destinationLat: ride.destinationLat ?? null,
          destinationLng: ride.destinationLng ?? null,
          pickupDate: ride.pickupDate || ride.startDate,
          pickupTime: ride.pickupTime,
          startDate: ride.startDate,
          endDate: ride.endDate,
          daysOfWeek: ride.daysOfWeek || [],
          seats: String(ride.seats || 1),
          luggage: ride.luggage || "",
          accessibility: ride.accessibility || "",
          maxDetourMinutes: String(ride.maxDetourMinutes || 0),
          maxPickupDistanceMiles: String(ride.maxPickupDistanceMiles || 0),
          departureFlexMinutes: String(ride.departureFlexMinutes || 0),
          contributionPerSeat: String(ride.contributionPerSeat || 0),
          approvalRequired: ride.approvalRequired,
          vehicleMakeModel: ride.vehicleMakeModel || "",
          vehicleYear: ride.vehicleYear || "",
          vehicleColor: ride.vehicleColor || "",
          licensePlate: ride.licensePlate || "",
          licenseState: ride.licenseState || "",
          preferences: ride.preferences || "",
          notes: ride.notes || ""
        });
        setMode("ride");
        setSelectedRideService("carpool");
        setRidePlannerStage("plan");
        setRidePlannerOpen(true);
        onBottomTabsHiddenChange?.(true);
      }).catch((error) => {
        if (rideEditorRequestRef.current !== requestId) return;
        onBottomTabsHiddenChange?.(false);
        Alert.alert("Could not edit ride", error instanceof Error ? error.message : "Please try again.");
      }).finally(() => {
        if (rideEditorRequestRef.current === requestId) setRideEditorLoading(false);
      });
      return;
    }
    void openRideOwnerTracker();
  }, [rideOwnerEditId, rideOwnerOpenTarget, rideOwnerOpenToken]);

  useEffect(() => {
    let cancelled = false;
    if (!ridePlannerOpen || ridePlannerStage !== "plan" || !rideSuggestionsEnabled) {
      setRideSuggestions([]);
      setRideSuggestionsBusy(false);
      return;
    }
    const query = (rideFocusedField === "origin" ? rideForm.origin : rideForm.destination).trim();
    // Google recommends waiting for at least three characters. It prevents
    // one- and two-letter abandoned sessions while people get the same
    // meaningful suggestions as soon as the query identifies a place.
    if (query.length < 3 || query === selectedRideSuggestionRef.current) {
      setRideSuggestions([]);
      setRideSuggestionsBusy(false);
      return;
    }
    const timer = setTimeout(() => {
      setRideSuggestionsBusy(true);
      void (async () => {
        const cityBias = rideForm.city || data?.location.city || discoveryLocation || "";
        const sessionToken = ridePlacesSessionTokensRef.current[rideFocusedField]
          || createRidePlacesSessionToken();
        ridePlacesSessionTokensRef.current[rideFocusedField] = sessionToken;
        const biasedPlaces = await getRidePlaceSuggestions(
          cityBias,
          query,
          Boolean(cityBias),
          false,
          false,
          "",
          sessionToken
        );
        if (biasedPlaces.length || query.length < 3) return biasedPlaces;
        const exactPlace = await getRidePlaceSuggestions("", query, false, false, true, "", sessionToken);
        return exactPlace;
      })()
        .then((places) => { if (!cancelled) setRideSuggestions(places); })
        .catch(() => { if (!cancelled) setRideSuggestions([]); })
        .finally(() => { if (!cancelled) setRideSuggestionsBusy(false); });
    }, 260);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [data?.location.city, rideFocusedField, rideForm.city, rideForm.destination, rideForm.origin, ridePlannerOpen, ridePlannerStage, rideSuggestionsEnabled]);

  useEffect(() => {
    // Popular cities belong to the user's current country. Housing and ride
    // searches must never retarget this discovery rail.
    const selectedCity = currentRideLocation?.label || discoveryLocation || data?.location.city || "";
    if (!selectedCity) {
      return;
    }
    const selectedCountry = locationCountryCodeFromLabel(selectedCity);
    let cancelled = false;
    getRidePlaceSuggestions(selectedCity, "", true, true)
      .then((places) => {
        if (cancelled) return;
        const usablePlaces = places.filter((place) => {
          const placeCountry = locationCountryCodeFromLabel(`${place.label} ${place.main || ""} ${place.secondary || ""}`);
          return !selectedCountry || placeCountry === selectedCountry;
        });
        const countryFallback = selectedCountry === "IN" ? indiaRidePopularCities : selectedCountry === "US" ? usRidePopularCities : [];
        setRidePopularPlaces(usablePlaces.length ? usablePlaces.slice(0, 8) : countryFallback);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentRideLocation?.label, data?.location.city, discoveryLocation]);

  useEffect(() => {
    let cancelled = false;
    async function hydratePermittedCurrentLocation() {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED || cancelled) return;
      // Prefer a live fix for country-scoped rails. Last-known can be a stale
      // simulator/device coordinate (for example San Francisco after moving
      // the simulator to Hyderabad), which makes the ride screen show U.S.
      // destination names for an India user.
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .catch(() => Location.getLastKnownPositionAsync({ maxAge: 60 * 1000, requiredAccuracy: 1000 }));
      if (cancelled || !position) return;
      let label = "";
      try {
        label = await reverseGeocodeRideLocation(position.coords.latitude, position.coords.longitude);
      } catch {
        label = "";
      }
      if (!label) {
        const [address] = await Location.reverseGeocodeAsync(position.coords).catch(() => []);
        label = formatDeviceAddress(address);
      }
      if (!cancelled && label) {
        setCurrentRideLocation({
          label,
          coords: { latitude: position.coords.latitude, longitude: position.coords.longitude }
        });
      }
    }
    void hydratePermittedCurrentLocation().catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  function updateScrollVisibility(y: number) {
    const nextSearchIsScrolled = y > 8;
    setSearchIsScrolled((current) => current === nextSearchIsScrolled ? current : nextSearchIsScrolled);
  }

  async function resolveCurrentRideLocation() {
    if (currentRideLocation) return currentRideLocation;
    if (currentRideLocationRequestRef.current) return currentRideLocationRequestRef.current;
    const request = (async (): Promise<CurrentRideLocation | null> => {
      setCurrentRideLocationBusy(true);
      setCurrentRideLocationError("");
      try {
        const hasLocationPermission = await requestUserLocationPermission({
          title: "Location permission is off",
          requestMessage: "Allow location access, or type your pickup address manually.",
          settingsMessage: "Enable location for FairFares in Settings, or type your pickup address manually."
        });
        if (!hasLocationPermission) {
          setCurrentRideLocationError("Location permission is off. Type a pickup address or enable location access.");
          return null;
        }
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        let label = "";
        try {
          label = await reverseGeocodeRideLocation(coords.latitude, coords.longitude);
        } catch {
          label = "";
        }
        try {
          if (!label) {
            const [address] = await Location.reverseGeocodeAsync(coords);
            label = formatDeviceAddress(address);
          }
        } catch {
          label = "";
        }
        const fallbackLocationName = selectedLocationText || data?.location.suggested || rideDefaultCity || "your selected city";
        const nextLocation = {
          label: label || `Current location near ${fallbackLocationName}`,
          coords
        };
        setCurrentRideLocation(nextLocation);
        return nextLocation;
      } catch {
        setCurrentRideLocationError("Could not detect your current location. Type a pickup address instead.");
        return null;
      } finally {
        setCurrentRideLocationBusy(false);
      }
    })();
    currentRideLocationRequestRef.current = request;
    try {
      return await request;
    } finally {
      if (currentRideLocationRequestRef.current === request) currentRideLocationRequestRef.current = null;
    }
  }

  async function useCurrentRideLocationForOrigin(onlyIfOriginIs?: string) {
    const location = await resolveCurrentRideLocation();
    if (!location?.label) return;
    selectedRideSuggestionRef.current = location.label;
    setRideForm((current) => {
      // Automatic location hydration may finish after the user has started
      // typing. Never replace that newer route input with the device location.
      if (onlyIfOriginIs !== undefined && current.origin !== onlyIfOriginIs) return current;
      return {
        ...current,
        city: location.label,
        origin: location.label,
        originLat: location.coords.latitude,
        originLng: location.coords.longitude
      };
    });
  }

  function openRidePlanner() {
    const initialOrigin = rideDefaultPickup;
    rideAutoOriginRef.current = initialOrigin;
    ridePlanSubmittingRef.current = false;
    rideEditorRequestRef.current += 1;
    selectedRideSuggestionRef.current = "";
    selectedRideLabelsRef.current = { origin: "", destination: "" };
    selectedRidePlaceIdsRef.current = { origin: "", destination: "" };
    ridePlacesSessionTokensRef.current = { origin: "", destination: "" };
    setEditingRideId("");
    setRidePosted(false);
    setRideBusy(false);
    setRidePlanBusy(false);
    setRideEditorLoading(false);
    setRideSuggestionsEnabled(false);
    setMode("ride");
    setRidePlannerStage("plan");
    setRideFocusedField("destination");
    setRideSuggestions([]);
    setRideSuggestionsBusy(false);
    setRideRequestStatus("");
    setSelectedRideChoice("");
    setRideForm({
      ...initialRideForm,
      city: rideDefaultCity || "",
      origin: initialOrigin,
      originLat: currentRideLocation?.coords.latitude ?? null,
      originLng: currentRideLocation?.coords.longitude ?? null,
      rideType: "CARPOOL_REQUEST"
    });
    setRidePlannerOpen(true);
    onBottomTabsHiddenChange?.(true);
    void useCurrentRideLocationForOrigin(initialOrigin);
  }

  function closeRidePlanner() {
    ridePlanSubmittingRef.current = false;
    rideAutoOriginRef.current = "";
    rideEditorRequestRef.current += 1;
    selectedRideSuggestionRef.current = "";
    selectedRideLabelsRef.current = { origin: "", destination: "" };
    selectedRidePlaceIdsRef.current = { origin: "", destination: "" };
    ridePlacesSessionTokensRef.current = { origin: "", destination: "" };
    setEditingRideId("");
    setRidePosted(false);
    setRideBusy(false);
    setRidePlanBusy(false);
    setRideEditorLoading(false);
    setRideSuggestionsEnabled(false);
    setRideSuggestions([]);
    setRideSuggestionsBusy(false);
    setRideRequestStatus("");
    setSelectedRideChoice("");
    setRidePlannerOpen(false);
    onBottomTabsHiddenChange?.(false);
    if (rideOwnerPlannerEntryRef.current) {
      rideOwnerPlannerEntryRef.current = false;
      onRideOwnerClosed?.();
    }
  }

  async function refreshRideActivity() {
    if (!data?.user) {
      setRideActivityRows([]);
      return;
    }
    setRideActivityBusy(true);
    try {
      const activity = await getRideActivity();
      setRideActivityRows(activity);
    } catch {
      setRideActivityRows([]);
    } finally {
      setRideActivityBusy(false);
    }
  }

  function openRideOwnerTracker() {
    if (rideOwnerOpenTarget === "workspace") {
      startRideOfferListing(true);
      return;
    }
    setMode("ride");
    setRideOwnerRequestsAfterListing(false);
    setRideOwnerOpen(true);
    onBottomTabsHiddenChange?.(true);
    void refreshRideActivity();
  }

  function openQuickLink(key: (typeof quickLinks)[number]["key"]) {
    if (key === "earn") {
      startRideOfferListing();
      return;
    }
    openRidePlanner();
    setSelectedRideService("carpool");
    setRideForm((current) => ({ ...current, rideType: "CARPOOL_REQUEST" }));
  }

  function closeRideOwnerTracker() {
    setRideOwnerOpen(false);
    setRideOwnerRequestsAfterListing(false);
    rideOwnerPlannerEntryRef.current = false;
    onBottomTabsHiddenChange?.(false);
    onRideOwnerClosed?.();
  }

  function openRideOfferPlanner() {
    const offerSurface = rideOfferSurfaces.find((item) => item.key === "carpool") || rideOfferSurfaces[0];
    ridePlanSubmittingRef.current = false;
    rideAutoOriginRef.current = rideDefaultPickup;
    rideEditorRequestRef.current += 1;
    selectedRideSuggestionRef.current = "";
    selectedRideLabelsRef.current = { origin: "", destination: "" };
    selectedRidePlaceIdsRef.current = { origin: "", destination: "" };
    setEditingRideId("");
    setRidePosted(false);
    setRideBusy(false);
    setRidePlanBusy(false);
    setRideEditorLoading(false);
    setRideSuggestionsEnabled(false);
    setMode("ride");
    setRideOwnerOpen(false);
    setSelectedRideService(offerSurface.key);
    setRidePlannerStage("plan");
    setRideFocusedField("destination");
    setRideSuggestions([]);
    setRideSuggestionsBusy(false);
    setRideRequestStatus("");
    setSelectedRideChoice("");
    setRideForm({
      ...initialRideForm,
      city: rideDefaultCity || "",
      origin: rideDefaultPickup,
      originLat: currentRideLocation?.coords.latitude ?? null,
      originLng: currentRideLocation?.coords.longitude ?? null,
      rideType: "CARPOOL_OFFER",
      seats: "4",
      luggage: "1 small bag",
      maxDetourMinutes: "15",
      maxPickupDistanceMiles: "50",
      contributionPerSeat: "",
      preferences: offerSurface.title,
      notes: offerSurface.note
    });
    setRidePlannerOpen(true);
    onBottomTabsHiddenChange?.(true);
    // Do not asynchronously force the device's current location into a route
    // listing. Drivers may be publishing a future route in another country.
  }

  function startRideOfferListing(fromOwnerEntry = false) {
    if (!data?.user) {
      onRequireLogin?.();
      return;
    }
    rideOwnerPlannerEntryRef.current = fromOwnerEntry;
    openRideOfferPlanner();
  }

  function selectRidePlace(place: RidePlaceSuggestion) {
    const selectedField = rideFocusedField;
    const sessionToken = ridePlacesSessionTokensRef.current[selectedField];
    ridePlacesSessionTokensRef.current[selectedField] = "";
    if (selectedField === "origin") rideAutoOriginRef.current = "";
    const trustedCoordinates = hasRideCoordinates(place.lat, place.lng) && !place.placeId;
    const startRequest = selectedField === "destination" && rideForm.rideType !== "CARPOOL_OFFER" && !editingRideId;
    selectedRideSuggestionRef.current = place.label;
    selectedRideLabelsRef.current[selectedField] = place.label;
    selectedRidePlaceIdsRef.current[selectedField] = place.placeId || "";
    setRideSuggestionsEnabled(false);
    setRideSuggestions([]);
    setRideForm((current) => ({
      ...current,
      [selectedField]: place.label,
      ...(selectedField === "origin"
        ? {
            city: place.label,
            originLat: trustedCoordinates ? place.lat : null,
            originLng: trustedCoordinates ? place.lng : null
          }
        : {
            destinationLat: trustedCoordinates ? place.lat : null,
            destinationLng: trustedCoordinates ? place.lng : null
          })
    }));
    // Cached coordinates attached to a Google prediction may belong to its
    // enclosing city. Its place ID must be resolved before a route is saved.
    if (!trustedCoordinates) {
      const selectedLabel = place.label;
      void getRidePlaceSuggestions("", selectedLabel, false, false, true, place.placeId || "", sessionToken)
        .then(([resolved]) => {
          if (!resolved || !hasRideCoordinates(resolved.lat, resolved.lng)) {
            if (selectedRideLabelsRef.current[selectedField] === selectedLabel && selectedRidePlaceIdsRef.current[selectedField] === (place.placeId || "")) {
              Alert.alert("Place not found", "Choose the place again or enter a fuller address.");
            }
            return;
          }
          if (selectedRideLabelsRef.current[selectedField] !== selectedLabel || selectedRidePlaceIdsRef.current[selectedField] !== (place.placeId || "")) return;
          setRideForm((current) => {
            if (current[selectedField] !== selectedLabel || selectedRideLabelsRef.current[selectedField] !== selectedLabel || selectedRidePlaceIdsRef.current[selectedField] !== (place.placeId || "")) return current;
            return selectedField === "origin"
              ? { ...current, origin: selectedLabel, city: selectedLabel, originLat: resolved.lat, originLng: resolved.lng }
              : { ...current, destination: selectedLabel, destinationLat: resolved.lat, destinationLng: resolved.lng };
          });
          if (startRequest) void planRideRoute({ ...place, placeId: "", lat: resolved.lat, lng: resolved.lng }, "CARPOOL_REQUEST");
        })
        .catch(() => {
          if (selectedRideLabelsRef.current[selectedField] === selectedLabel && selectedRidePlaceIdsRef.current[selectedField] === (place.placeId || "")) {
            Alert.alert("Place not found", "Choose the place again or enter a fuller address.");
          }
        });
    }
    if (selectedField === "origin") {
      setRideFocusedField("destination");
    } else if (startRequest && trustedCoordinates) {
      setRideSuggestions([]);
      void planRideRoute(place, "CARPOOL_REQUEST");
    }
  }

  function openRidePlannerWithSuggestion(place: RidePlaceSuggestion) {
    ridePlanSubmittingRef.current = false;
    rideAutoOriginRef.current = rideDefaultPickup;
    rideEditorRequestRef.current += 1;
    selectedRideSuggestionRef.current = place.label;
    selectedRideLabelsRef.current = { origin: "", destination: place.label };
    selectedRidePlaceIdsRef.current = { origin: "", destination: place.placeId || "" };
    ridePlacesSessionTokensRef.current = { origin: "", destination: "" };
    setEditingRideId("");
    setRidePosted(false);
    setRideBusy(false);
    setRidePlanBusy(false);
    setRideEditorLoading(false);
    setRideSuggestionsEnabled(false);
    setMode("ride");
    setSelectedRideService("carpool");
    setRidePlannerStage("plan");
    setRideFocusedField("destination");
    setRideSuggestions([]);
    setRideSuggestionsBusy(false);
    setRideRequestStatus("");
    setSelectedRideChoice("");
    const plannedForm: RideInput = {
      ...initialRideForm,
      city: rideDefaultCity,
      origin: rideDefaultPickup,
      originLat: currentRideLocation?.coords.latitude ?? null,
      originLng: currentRideLocation?.coords.longitude ?? null,
      destination: place.label,
      destinationLat: place.placeId ? null : place.lat,
      destinationLng: place.placeId ? null : place.lng,
      rideType: "CARPOOL_REQUEST"
    };
    setRideForm(plannedForm);
    setRidePlannerOpen(true);
    onBottomTabsHiddenChange?.(true);
    void useCurrentRideLocationForOrigin(rideDefaultPickup);
    if (place.placeId) {
      void getRidePlaceSuggestions("", place.label, false, false, true, place.placeId)
        .then(([resolved]) => {
          if (!resolved || !hasRideCoordinates(resolved.lat, resolved.lng)) {
            Alert.alert("Place not found", "Choose the place again or enter a fuller address.");
            return;
          }
          if (selectedRideLabelsRef.current.destination !== place.label || selectedRidePlaceIdsRef.current.destination !== place.placeId) return;
          void planRideRoute({ ...place, placeId: "", lat: resolved.lat, lng: resolved.lng }, "CARPOOL_REQUEST", plannedForm);
        })
        .catch(() => {
          if (selectedRideLabelsRef.current.destination === place.label && selectedRidePlaceIdsRef.current.destination === place.placeId) {
            Alert.alert("Place not found", "Choose the place again or enter a fuller address.");
          }
        });
    } else {
      void planRideRoute(place, "CARPOOL_REQUEST", plannedForm);
    }
  }

  function ridePlanComplete() {
    return Boolean(rideForm.origin.trim() && rideForm.destination.trim());
  }

  function formatRideMiles(value: number | string | null | undefined) {
    if (value === null || value === undefined) return "";
    const miles = Number(value);
    if (!Number.isFinite(miles)) return "";
    return `${miles.toFixed(miles % 1 ? 1 : 0)} mi`;
  }

  function formatRideTotalDetour(ride: RidePost) {
    const miles = formatRideMiles(ride.routeDeviationMiles);
    if (!miles) return "Total detour: road check pending";
    const minutes = ride.routeDeviationMinutes === null || ride.routeDeviationMinutes === undefined ? null : Number(ride.routeDeviationMinutes);
    return Number.isFinite(minutes)
      ? `Total detour: ${Math.max(0, Math.round(minutes || 0))} min · ${miles} added`
      : `Total detour: ${miles} added · time pending`;
  }

  function formatRidePickupDropDetail(ride: RidePost) {
    const pickup = formatRideMiles(ride.pickupDistanceMiles ?? ride.distanceMiles);
    const dropoff = formatRideMiles(ride.dropoffDistanceMiles);
    return [
      pickup ? `${pickup} from pickup` : "",
      dropoff ? `${dropoff} from drop-off` : ""
    ].filter(Boolean).join(" · ");
  }

  function formatLiveDriverStatus(location?: DriverLocationStatus) {
    if (!location?.available) return "Driver location will appear after the driver starts sharing it.";
    const distance = formatRideMiles(location.distanceMiles);
    const eta = location.source === "ROUTED" && location.etaMinutes
      ? `${location.etaMinutes === 1 ? "1 min" : `${location.etaMinutes} mins`} away`
      : "Driver location shared";
    return [eta, distance ? `${distance}${location.source === "ROUTED" ? " by road" : " direct"}` : ""].filter(Boolean).join(" · ");
  }

  function selectRideService(service: (typeof rideServicePosters)[number]) {
    if (!service.available) {
      Alert.alert("Available soon", `${service.title} will be available soon. Carpool is open now for shared route matching.`);
      return;
    }
    setSelectedRideService(service.key);
    updateRideForm("rideType", service.type);
  }

  function updateRideType(type: RideType) {
    if (type === "GENERAL_REQUEST" || type === "SCHEDULED_REQUEST") {
      Alert.alert("Available soon", "General and scheduled rides will be available soon. For now, use carpool.");
      updateRideForm("rideType", "CARPOOL_REQUEST");
      setSelectedRideService("carpool");
      return;
    }
    updateRideForm("rideType", type);
    if (type === "CARPOOL_REQUEST" || type === "CARPOOL_OFFER") {
      setSelectedRideService("carpool");
    }
  }

  async function saveUnmatchedRideRequest(input: RideInput): Promise<RidePost> {
    const matchesTrip = (ride: RidePost) => ride.type === "CARPOOL_REQUEST"
      && !ride.isExpired
      && ride.status.toUpperCase() === "ACTIVE"
      && ride.origin.trim().toLowerCase() === input.origin.trim().toLowerCase()
      && ride.destination.trim().toLowerCase() === input.destination.trim().toLowerCase()
      && ride.pickupDate === input.pickupDate
      && ride.pickupTime === input.pickupTime;
    const activity = await getRideActivity().catch(() => [] as RidePost[]);
    const existing = activity.find(matchesTrip);
    if (existing) return existing;
    try {
      const result = await createMobileRide({ ...input, rideType: "CARPOOL_REQUEST" });
      if (!result.ride) throw new Error("The ride request was not saved.");
      return result.ride;
    } catch (error) {
      // A repeat search may race another save or meet the server's recent-post
      // guard. Confirm the existing request before claiming a failed save.
      if (error instanceof Error && error.message.toLowerCase().includes("already posted recently")) {
        const latest = await getRideActivity().catch(() => [] as RidePost[]);
        const saved = latest.find(matchesTrip);
        if (saved) return saved;
      }
      throw error;
    }
  }

  async function planRideRoute(selectedDestination?: RidePlaceSuggestion, requestedRideType: RideType = rideForm.rideType, formSnapshot: RideInput = rideForm) {
    if (ridePlanSubmittingRef.current) return;
    if (ridePickupIsInPast(formSnapshot.pickupDate, formSnapshot.pickupTime)) {
      Alert.alert("Choose a future pickup", "Pickup date and time must be later than the current time.");
      return;
    }
    const submittedDestination = selectedDestination?.label || formSnapshot.destination.trim();
    if (!submittedDestination) {
      Alert.alert("Destination needed", "Enter where you want to go.");
      return;
    }
    ridePlanSubmittingRef.current = true;
    let effectiveOrigin = formSnapshot.origin.trim() || selectedLocationText || formSnapshot.city || discoveryLocation;
    if (!effectiveOrigin) {
      ridePlanSubmittingRef.current = false;
      Alert.alert("Current location needed", "Allow location access or enter your pickup location.");
      return;
    }
    let effectiveDestination = submittedDestination;
    const listingRide = requestedRideType === "CARPOOL_OFFER";
    const destinationAlreadyPicked = Boolean(
      selectedDestination && hasRideCoordinates(selectedDestination.lat, selectedDestination.lng)
    ) || Boolean(
      formSnapshot.destination.trim() && hasRideCoordinates(formSnapshot.destinationLat, formSnapshot.destinationLng)
    );
    if (listingRide && destinationAlreadyPicked) {
      if (!String(formSnapshot.vehicleMakeModel || "").trim()) {
        ridePlanSubmittingRef.current = false;
        Alert.alert("Vehicle needed", "Enter the car make/model for this ride.");
        return;
      }
      if (!String(formSnapshot.licensePlate || "").trim() || !String(formSnapshot.licenseState || "").trim()) {
        ridePlanSubmittingRef.current = false;
        Alert.alert("Plate needed", "Enter the license plate and state for this ride.");
        return;
      }
    }
    if (!listingRide) {
      setSavedUnmatchedRideId("");
      setRideRequestStatus("");
    }
    setRideBusy(true);
    setRidePlanBusy(true);
    try {
      let originPoint: RidePlaceSuggestion | undefined;
      const originAlreadyPicked = Boolean(
        formSnapshot.origin.trim() && hasRideCoordinates(formSnapshot.originLat, formSnapshot.originLng)
      );
      if (!originAlreadyPicked) {
        // The planner starts detecting the current pickup in the background.
        // If Find rides wins that race, share the same location request rather
        // than trying to geocode the placeholder text as an address.
        if (rideAutoOriginRef.current && formSnapshot.origin.trim() === rideAutoOriginRef.current && !selectedRideLabelsRef.current.origin) {
          const location = await resolveCurrentRideLocation();
          if (location && hasRideCoordinates(location.coords.latitude, location.coords.longitude)) {
            effectiveOrigin = location.label;
            originPoint = {
              label: location.label,
              main: location.label,
              secondary: "",
              distanceMiles: null,
              lat: location.coords.latitude,
              lng: location.coords.longitude,
              source: "device"
            };
          }
        }
        // Resolve manually typed origins without the device/current-city bias.
        // Otherwise an international route such as Hyderabad -> Chennai can
        // be geocoded against a previous US discovery location.
        if (!originPoint) {
          const originMatches = await getRidePlaceSuggestions(formSnapshot.city, effectiveOrigin, false, false, true, selectedRideLabelsRef.current.origin === effectiveOrigin ? selectedRidePlaceIdsRef.current.origin : "");
          originPoint = originMatches[0];
          if (originPoint?.label && selectedRideLabelsRef.current.origin !== effectiveOrigin) effectiveOrigin = originPoint.label;
        }
      }
      const routeCity = effectiveOrigin;
      let destinationPoint: RidePlaceSuggestion | undefined = selectedDestination;
      if (!destinationAlreadyPicked) {
        const selectedDestinationPlaceId = selectedRideLabelsRef.current.destination === effectiveDestination
          ? selectedRidePlaceIdsRef.current.destination
          : "";
        const broadDestination = looksLikeBroadRideCityQuery(effectiveDestination);
        let destinationMatches = await getRidePlaceSuggestions(
          broadDestination ? "" : routeCity,
          effectiveDestination,
          false,
          false,
          true,
          selectedDestinationPlaceId
        );
        if (!destinationMatches.length && !selectedDestinationPlaceId && broadDestination) {
          destinationMatches = await getRidePlaceSuggestions(routeCity, effectiveDestination, false, false, true);
        } else if (!destinationMatches.length && !selectedDestinationPlaceId) {
          destinationMatches = await getRidePlaceSuggestions("", effectiveDestination, false, false, true);
        }
        destinationPoint = destinationMatches[0];
        if (destinationPoint?.label && selectedRideLabelsRef.current.destination !== effectiveDestination) {
          effectiveDestination = destinationPoint.label;
        }
      }
      selectedRideSuggestionRef.current = effectiveDestination;
      const nextRideType: RideType = listingRide ? "CARPOOL_OFFER" : "CARPOOL_REQUEST";
      setSelectedRideService("carpool");
      const nextRideForm = {
        ...formSnapshot,
        city: routeCity,
        origin: effectiveOrigin,
        originLat: originPoint?.lat ?? (originAlreadyPicked ? formSnapshot.originLat : null),
        originLng: originPoint?.lng ?? (originAlreadyPicked ? formSnapshot.originLng : null),
        destination: effectiveDestination,
        destinationLat: destinationPoint?.lat ?? (destinationAlreadyPicked ? formSnapshot.destinationLat : null),
        destinationLng: destinationPoint?.lng ?? (destinationAlreadyPicked ? formSnapshot.destinationLng : null),
        rideType: nextRideType
      };
      if (!hasRideCoordinates(nextRideForm.originLat, nextRideForm.originLng)) {
        throw new Error("We couldn't locate your pickup. Use current location or choose a pickup suggestion.");
      }
      if (!hasRideCoordinates(nextRideForm.destinationLat, nextRideForm.destinationLng)) {
        throw new Error("We couldn't locate your destination. Choose a suggestion or enter a fuller address.");
      }
      setRideForm((current) => ({
        ...current,
        city: routeCity,
        origin: effectiveOrigin,
        originLat: nextRideForm.originLat,
        originLng: nextRideForm.originLng,
        destination: effectiveDestination,
        destinationLat: nextRideForm.destinationLat,
        destinationLng: nextRideForm.destinationLng,
        rideType: nextRideType
      }));
      if (listingRide && !destinationAlreadyPicked) {
        return;
      }
      if (nextRideType === "CARPOOL_OFFER" || editingRideId) {
        const result = editingRideId ? null : await createMobileRide(nextRideForm);
        const ride = editingRideId ? await updateMobileRide(editingRideId, nextRideForm) : result?.ride;
        if (!ride) throw new Error("Ride listing was not saved.");
        const wasEditing = Boolean(editingRideId);
        setEditingRideId("");
        setRideRows((current) => [ride, ...current.filter((item) => item.id !== ride.id)]);
        setRideActivityRows((current) => [ride, ...current.filter((item) => item.id !== ride.id)]);
        setRidePosted(true);
        setRideRequestStatus(wasEditing ? "Ride updated." : "Ride listed. Matching rider requests will show in your driver workspace, and accepted riders can coordinate in Chitthi.");
        setRidePlannerOpen(false);
        setRideOwnerOpen(false);
        if (!wasEditing) setRideListingSuccess(ride);
        void refreshRideActivity();
        return;
      }
      const searchRideType: RideType = "CARPOOL_OFFER";
      const rides = await getRides(nextRideForm.city, nextRideForm.origin, nextRideForm.destination, searchRideType, {
        originLat: nextRideForm.originLat,
        originLng: nextRideForm.originLng,
        destinationLat: nextRideForm.destinationLat,
        destinationLng: nextRideForm.destinationLng,
        pickupDate: nextRideForm.pickupDate
      });
      setRideRows(rides);
      setSelectedRideChoice("");
      setRidePlannerStage("choices");
      setSavedUnmatchedRideId("");
      if (!rides.length) {
        if (!data?.user) {
          setRideRequestStatus("No rides found. Sign in to save your request and get match alerts.");
          Alert.alert("No rides found", "Sign in to save your ride request. We'll notify you when a matching ride is listed.", [
            { text: "Not now", style: "cancel" },
            { text: "Sign in", onPress: () => onRequireLogin?.() }
          ]);
        } else {
          try {
            const saved = await saveUnmatchedRideRequest(nextRideForm);
            setSavedUnmatchedRideId(saved.id);
            setRideActivityRows((current) => [saved, ...current.filter((ride) => ride.id !== saved.id)]);
            setRidePosted(true);
            setRideRequestStatus("Your ride request is saved. We'll notify you when a matching ride is listed.");
            Alert.alert("Ride request saved", "No rides are available yet. We'll notify you when a matching ride is listed.");
          } catch (saveError) {
            setRideRequestStatus("No rides found. Your request was not saved.");
            Alert.alert("Request not saved", saveError instanceof Error ? saveError.message : "Please try saving your ride request again.");
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to search rides.";
      Alert.alert(listingRide ? "Ride listing failed" : "Ride search failed", message);
    } finally {
      setRideBusy(false);
      setRidePlanBusy(false);
      ridePlanSubmittingRef.current = false;
    }
  }

  async function requestPlannedRide(offer?: RidePost) {
    if (!data?.user) {
      Alert.alert("Login required", "Please login before requesting a ride so drivers can message you.");
      return;
    }
    const selectedOffer = offer || (selectedRideChoice.startsWith("offer:")
      ? rideRows.find((ride) => `offer:${ride.id}` === selectedRideChoice)
      : null);
    if (selectedOffer?.isExpired) {
      Alert.alert("Ride expired", "This ride date has passed. It remains visible for history, but cannot be requested.");
      return;
    }
    const selectedLabel = selectedOffer?.title || "Ride request";
    setRideBusy(true);
    try {
      const result = selectedOffer
        ? await createMobileRide({
            ...rideForm,
            rideType: "CARPOOL_REQUEST",
            notes: [rideForm.notes, `${selectedLabel} selected.`].filter(Boolean).join(" ")
          })
        : { ride: await saveUnmatchedRideRequest(rideForm), dispatch: undefined };
      const ride = result.ride;
      if (!ride) throw new Error("Ride request was not saved.");
      if (selectedOffer) setRideRows((current) => [ride, ...current.filter((item) => item.id !== ride.id)]);
      else setSavedUnmatchedRideId(ride.id);
      setRidePosted(true);
      const notifiedCount = Number(result.dispatch?.notifiedCount || 0);
      const radius = Number(result.dispatch?.nearestRadius || 0);
      void refreshRideActivity();
      setRideRequestStatus(
        notifiedCount
          ? `Request sent to ${notifiedCount} nearby driver offer${notifiedCount === 1 ? "" : "s"} within ${radius || 10} miles. You can use Chitthi with a selected listing owner before acceptance; the pickup PIN appears after acceptance.`
          : "Your ride request is saved. We'll notify you when a matching ride is listed."
      );
      if (selectedOffer) {
        Alert.alert("Ride request sent", "You can message this driver in Chitthi now. Acceptance confirms the seat and unlocks the pickup PIN.", [
          { text: "Stay here", style: "cancel" },
          { text: "Open Chitthi", onPress: () => onRideMessage(selectedOffer) }
        ]);
      } else {
        Alert.alert("Ride request saved", "We'll notify you when a matching ride is listed.");
      }
    } catch (error) {
      Alert.alert("Ride request failed", error instanceof Error ? error.message : "Unable to request this ride.");
    } finally {
      setRideBusy(false);
    }
  }

  function reportRideIssue() {
    const selectedOffer = selectedRideChoice.startsWith("offer:")
      ? rideRows.find((ride) => `offer:${ride.id}` === selectedRideChoice)
      : null;
    const route = selectedOffer
      ? `${selectedOffer.origin} to ${selectedOffer.destination}`
      : `${rideForm.origin || "Pickup not selected"} to ${rideForm.destination || "Destination not selected"}`;
    const subject = encodeURIComponent("FairFares carpool issue");
    const body = encodeURIComponent(`Please describe the issue below.\n\nRide: ${route}\nRide ID: ${selectedOffer?.id || "Not assigned"}\n\nIssue details:\n`);
    void Linking.openURL(`mailto:hello@fairfare.space?subject=${subject}&body=${body}`);
  }

  async function updateRideDispatch(ride: RidePost, action: "ACCEPT" | "DECLINE" | "EN_ROUTE" | "ARRIVED" | "COMPLETED") {
    const actionLabels: Record<typeof action, string> = {
      ACCEPT: "accepted",
      DECLINE: "declined",
      EN_ROUTE: "marked en route",
      ARRIVED: "marked arrived",
      COMPLETED: "completed"
    };
    setRideActivityBusy(true);
    try {
      if (action === "EN_ROUTE") {
        const hasLocationPermission = await requestUserLocationPermission({
          title: "Location permission required",
          requestMessage: "Allow location while using FairFares so the matched rider can see the driver's live location.",
          settingsMessage: "Enable location for FairFares in Settings so the matched rider can see the driver's live location."
        });
        if (!hasLocationPermission) {
          return;
        }
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        await updateRideDriverLocation(ride.id, position.coords.latitude, position.coords.longitude);
      }
      const updated = await respondToRideDispatch(ride.id, action);
      await refreshRideActivity();
      if (action === "ACCEPT") {
        Alert.alert(
          "Ride request accepted",
          `Pickup PIN ${updated.pickupPin || "will appear after refresh"}. Chitthi is ready for pickup notes and ETA.`,
          [
            { text: "Stay here", style: "cancel" },
            { text: "Open Chitthi", onPress: () => onRideMessage(updated) }
          ]
        );
      } else if (action === "EN_ROUTE") {
        Alert.alert(
          "Rider notified",
          `The rider has been notified that you are on the way.${cleanRideRoutePoint(updated.origin || ride.origin) ? `\n\nPickup: ${cleanRideRoutePoint(updated.origin || ride.origin)}` : ""}`,
          [
            { text: "Later", style: "cancel" },
            { text: "Open map", onPress: () => void openRiderPickupNavigation({ ...ride, ...updated }) }
          ]
        );
      } else if (action === "ARRIVED") {
        Alert.alert(
          "Rider notified",
          `The rider has been notified that you have arrived.${cleanRideRoutePoint(updated.destination || ride.destination) ? `\n\nNext: ${cleanRideRoutePoint(updated.destination || ride.destination)}` : ""}`,
          [
            { text: "Later", style: "cancel" },
            { text: "Open destination", onPress: () => void openRiderDestinationNavigation({ ...ride, ...updated }) }
          ]
        );
      } else {
        Alert.alert("Ride updated", `This request was ${actionLabels[action]}.`);
      }
    } catch (error) {
      Alert.alert("Ride update failed", error instanceof Error ? error.message : "Unable to update this ride request.");
    } finally {
      setRideActivityBusy(false);
    }
  }

  function openPostMap(post: HousingPost) {
    const preciseAddress = post.addressLabel || [post.streetAddress, post.city || post.location, post.zipCode]
      .map((value) => String(value || "").trim())
      .filter((value, index, values) => value && values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index)
      .join(", ");
    const hasExactCoordinates = !post.locationApproximate
      && Number.isFinite(post.lat)
      && Number.isFinite(post.lng)
      && Math.abs(post.lat) > 0.0001
      && Math.abs(post.lng) > 0.0001;
    const query = hasExactCoordinates
      ? `${post.lat},${post.lng}`
      : preciseAddress || `${post.title} ${post.location} ${post.area}`.trim();
    void Linking.openURL(mapSearchUrl(query));
  }

  function openRideGoogleMaps() {
    const origin = rideForm.origin || selectedLocationText || rideForm.city || discoveryLocation;
    const destination = rideForm.destination || rideForm.city;
    if (!origin || !destination) {
      Alert.alert("Route needed", "Allow location access or enter both route locations.");
      return;
    }
    void Linking.openURL(mapDirectionsUrl(origin, destination));
  }

  function cleanRideRoutePoint(value?: string) {
    const raw = String(value || "").replace(/\s+/g, " ").trim();
    if (!raw || /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(raw)) return "";
    if (/^current location$/i.test(raw)) return "Current location";
    return raw;
  }

  async function openRiderPickupNavigation(ride: RidePost) {
    const pickup = cleanRideRoutePoint(ride.origin);
    if (!pickup) {
      Alert.alert("Pickup unavailable", "The rider pickup location is still being confirmed.");
      return;
    }
    const coordinateDestination = ride.originLat && ride.originLng ? `${ride.originLat},${ride.originLng}` : "";
    const destination = coordinateDestination || pickup;
    const url = Platform.OS === "ios"
      ? `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&q=${encodeURIComponent(pickup)}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Map unavailable", "The rider pickup route could not be opened on this device.");
    }
  }

  async function openRiderDestinationNavigation(ride: RidePost) {
    const dropoff = cleanRideRoutePoint(ride.destination);
    if (!dropoff) {
      Alert.alert("Destination unavailable", "The rider destination is still being confirmed.");
      return;
    }
    const coordinateDestination = ride.destinationLat && ride.destinationLng ? `${ride.destinationLat},${ride.destinationLng}` : "";
    const destination = coordinateDestination || dropoff;
    const url = Platform.OS === "ios"
      ? `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&q=${encodeURIComponent(dropoff)}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Map unavailable", "The rider destination route could not be opened on this device.");
    }
  }

  function renderRideOwnerTracker() {
    const ownerTarget = rideOwnerRequestsAfterListing || rideOwnerOpenTarget === "workspace" ? "requests" : rideOwnerOpenTarget;
    const incomingRequestRows = rideActivityRows.filter((ride) => {
      if (ride.activityRole !== "DRIVER_NOTIFICATION" || ride.isExpired) return false;
      const status = String(ride.dispatchStatus || ride.status || "PENDING").toUpperCase();
      return ["PENDING", "REQUESTED", "MATCHING", "ACTIVE", "OPEN", "ACCEPTED", "EN_ROUTE", "ARRIVED"].includes(status);
    }).slice(0, 8);
    const listedRouteRows = rideActivityRows.filter((ride) => ride.activityRole === "MINE" && ride.role === "DRIVER");
    const riderTripRows = rideActivityRows.filter((ride) => {
      if (ride.activityRole !== "MINE" || ride.role !== "RIDER") return false;
      const status = String(ride.dispatchStatus || ride.status || "PENDING").toUpperCase();
      return !ride.isExpired || ["ACCEPTED", "DECLINED", "EN_ROUTE", "ARRIVED", "COMPLETED"].includes(status);
    });
    const requestRows = ownerTarget === "listings"
      ? listedRouteRows
      : ownerTarget === "requests"
        ? [...incomingRequestRows, ...riderTripRows]
        : incomingRequestRows.length ? incomingRequestRows : listedRouteRows;
    const focusedRequestRows = rideOwnerFocusId
      ? requestRows.filter((ride) => ride.id === rideOwnerFocusId)
      : requestRows;
    const visibleRequestRows = focusedRequestRows.length ? focusedRequestRows : requestRows;
    const focusedRide = focusedRequestRows[0];
    const trackerTitle = rideOwnerFocusId && focusedRide
      ? focusedRide.activityRole === "DRIVER_NOTIFICATION" ? "Carpool request" : "Your carpool ride"
      : ownerTarget === "listings" ? "Your listings" : ownerTarget === "requests" ? "Carpool activity" : "Request tracker";
    return (
      <Modal visible={rideOwnerOpen} animationType="slide" onRequestClose={closeRideOwnerTracker}>
        <SafeAreaView style={styles.rideOwnerScreen} edges={["right", "bottom", "left"]}>
          <ScrollView
            contentContainerStyle={[
              styles.rideOwnerContent,
              {
                paddingTop: Math.max(
                  safeAreaInsets.top,
                  Platform.OS === "ios" ? 47 : 32
                ) + 12
              }
            ]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.rideOwnerHeader}>
              <TouchableOpacity style={styles.ridePlannerBack} onPress={closeRideOwnerTracker}>
                <Text style={styles.ridePlannerBackText}>‹</Text>
              </TouchableOpacity>
              <View style={styles.rideOwnerHeaderCopy}>
                <Text style={styles.rideOwnerEyebrow}>Carpool activity</Text>
                <Text style={styles.rideOwnerTitle}>{trackerTitle}</Text>
              </View>
            </View>

            {rideActivityBusy && !rideActivityRows.length ? (
              <View style={styles.rideOwnerLoadingCard} accessibilityRole="progressbar">
                <ActivityIndicator size="large" color={theme.colors.brand} />
                <Text style={styles.rideOwnerLoadingTitle}>Loading your carpool…</Text>
                <Text style={styles.rideOwnerLoadingCopy}>{ownerTarget === "requests" ? "Checking your rider requests." : "Checking your carpool activity."}</Text>
              </View>
            ) : null}


            <View style={styles.rideOwnerCard}>
              <View style={styles.rideOwnerSectionHeading}><Image source={appAssets.navActivity} style={styles.rideOwnerSectionIcon} resizeMode="contain" /><Text style={styles.rideOwnerSectionTitle}>{trackerTitle}</Text></View>
              {rideActivityBusy ? <Text style={styles.rideOwnerEmptyText}>Refreshing ride activity...</Text> : null}
              {ownerTarget !== "requests" ? (
                <View style={styles.rideOwnerStatusWrap}>
                  {rideOwnerRequestStates.map((state) => (
                    <Text key={state} style={styles.rideOwnerStatusPill}>{state}</Text>
                  ))}
                </View>
              ) : null}
              {visibleRequestRows.length ? (
                visibleRequestRows.map((ride) => {
                  const status = String(ride.isExpired ? "EXPIRED" : ride.dispatchStatus || (ride.activityRole === "DRIVER_NOTIFICATION" ? "PENDING" : "LISTED")).toUpperCase();
                  const isIncoming = ride.activityRole === "DRIVER_NOTIFICATION";
                  const isRiderTrip = ride.activityRole === "MINE" && ride.role === "RIDER";
                  const driverLocation = isRiderTrip ? driverLocationByRideId[ride.id] : undefined;
                  const canAccept = isIncoming && ["PENDING", "REQUESTED", "MATCHING", "ACTIVE", "OPEN"].includes(status);
                  const canAdvance = isIncoming && ["ACCEPTED", "EN_ROUTE", "ARRIVED"].includes(status);
                  const nextAction = status === "ACCEPTED" ? "EN_ROUTE" : status === "EN_ROUTE" ? "ARRIVED" : status === "ARRIVED" ? "COMPLETED" : null;
                  const nextLabel = status === "ACCEPTED" ? "Start trip" : status === "EN_ROUTE" ? "I've arrived" : status === "ARRIVED" ? "Complete ride" : "";
                  return (
                    <View key={ride.id} style={styles.rideOwnerRequestCard}>
                      <View style={styles.rideOwnerRequestTop}>
                        <Text style={styles.rideOwnerRequestTitle} numberOfLines={2}>{ride.title || ride.typeLabel}</Text>
                        <Text style={[styles.rideOwnerRequestBadge, ride.isExpired && styles.rideOwnerRequestBadgeExpired]}>
                          {ride.isExpired ? "Expired" : isIncoming || isRiderTrip ? status.replace("_", " ") : "Listed"}
                        </Text>
                      </View>
                      <Text style={styles.rideOwnerRequestRoute}>{ride.origin} → {ride.destination}</Text>
                      <View style={styles.rideOwnerRequestFacts}>
                        <Text style={styles.rideOwnerRequestFact}>{formatRidePickupDropDetail(ride) || "Pickup/drop-off calculating"}</Text>
                        <Text style={styles.rideOwnerRequestFact}>{formatRideTotalDetour(ride)}</Text>
                        <Text style={styles.rideOwnerRequestFact}>{ride.seats} seat{ride.seats === 1 ? "" : "s"}</Text>
                        <Text style={styles.rideOwnerRequestFact}>{ride.pickupDate || "Date open"} · {ride.pickupTime || "Time open"}</Text>
                      </View>
                      {isRiderTrip ? (
                        <View style={styles.rideOwnerLiveLocation}>
                          <Text style={styles.rideOwnerLiveLocationTitle}>● Driver location</Text>
                          <Text style={styles.rideOwnerLiveLocationCopy}>{formatLiveDriverStatus(driverLocation)}</Text>
                        </View>
                      ) : null}
                      {isIncoming && ["ACCEPTED", "EN_ROUTE", "ARRIVED"].includes(status) ? (
                        <Text style={styles.rideOwnerPickupLabel}>Rider pickup: {cleanRideRoutePoint(ride.origin) || "Location being confirmed"}</Text>
                      ) : null}
                      {ride.pickupPin ? (
                        <View style={styles.rideOwnerPinBox}>
                          <Text style={styles.rideOwnerPinLabel}>Pickup PIN</Text>
                          <Text style={styles.rideOwnerPinValue}>{ride.pickupPin}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.rideOwnerRequestMeta}>
                        {isIncoming
                          ? ["PENDING", "REQUESTED", "MATCHING", "ACTIVE", "OPEN"].includes(status)
                            ? `Matched within a ${ride.dispatchNearestRadius || 10} mi route band. Messaging is available now; accept to confirm the seat and unlock the pickup PIN.`
                            : "Message the rider about ETA, pickup notes, route changes, and arrival updates."
                          : isRiderTrip
                            ? status === "ARRIVED"
                              ? "Your driver has arrived at the pickup point. Confirm the pickup PIN before starting the trip."
                              : "Live location refreshes while the driver is en route. The ETA appears only when road routing is available."
                          : ride.isExpired
                            ? "This ride date has passed. It remains visible here as expired."
                            : "Your route is listed. Matching rider requests will appear here with route distance, status, and Chitthi."}
                      </Text>
                      <View style={styles.rideOwnerRequestActionRow}>
                        {canAccept ? (
                          <>
                            <TouchableOpacity style={styles.rideOwnerAcceptButton} onPress={() => updateRideDispatch(ride, "ACCEPT")} disabled={rideActivityBusy}>
                              <Text style={styles.rideOwnerActionText}>✓ Accept</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.rideOwnerDeclineButton} onPress={() => updateRideDispatch(ride, "DECLINE")} disabled={rideActivityBusy}>
                              <Text style={styles.rideOwnerActionText}>× Decline</Text>
                            </TouchableOpacity>
                          </>
                        ) : null}
                        {canAdvance && nextAction ? (
                          <TouchableOpacity style={styles.rideOwnerAcceptButton} onPress={() => updateRideDispatch(ride, nextAction)} disabled={rideActivityBusy}>
                            <Text style={styles.rideOwnerActionText}>{nextLabel}</Text>
                          </TouchableOpacity>
                        ) : null}
                        {isIncoming && status === "EN_ROUTE" ? (
                          <TouchableOpacity style={styles.rideOwnerChatButton} onPress={() => void openRiderPickupNavigation(ride)}>
                            <Text style={styles.rideOwnerChatText}>Navigate pickup</Text>
                          </TouchableOpacity>
                        ) : null}
                        {isIncoming && status === "ACCEPTED" ? (
                          <TouchableOpacity style={styles.rideOwnerChatButton} onPress={() => void openRiderPickupNavigation(ride)}>
                            <Text style={styles.rideOwnerChatText}>Open pickup map</Text>
                          </TouchableOpacity>
                        ) : null}
                        {isIncoming && ["ARRIVED", "IN_PROGRESS"].includes(status) ? (
                          <TouchableOpacity style={styles.rideOwnerChatButton} onPress={() => void openRiderDestinationNavigation(ride)}>
                            <Text style={styles.rideOwnerChatText}>Navigate destination</Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity style={styles.rideOwnerChatButton} onPress={() => onRideMessage(ride)}>
                          <Text style={styles.rideOwnerChatText}>{sentRideIds.includes(ride.id) ? "✓ Sent" : "Message"}</Text>
                        </TouchableOpacity>
                        {!isIncoming ? (
                          <TouchableOpacity style={styles.rideOwnerChatButton} onPress={() => void shareCarpoolListing(ride)} accessibilityRole="button" accessibilityLabel={`Share carpool from ${ride.origin} to ${ride.destination}`}>
                            <Text style={styles.rideOwnerChatText}>↗ Share</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  );
                })
              ) : (
                <View style={styles.rideOwnerEmpty}>
                  <Text style={styles.rideOwnerEmptyTitle}>{ownerTarget === "listings" ? "No listed routes yet." : ownerTarget === "requests" ? "No rider requests yet." : "No ride activity yet."}</Text>
                  <Text style={styles.rideOwnerEmptyText}>
                    {ownerTarget === "listings"
                      ? "Use List your ride above to publish a route and available seats."
                      : ownerTarget === "requests"
                        ? "New matching rider requests will appear here with route fit, status, and Chitthi."
                        : "List a route first. When riders match or request your seats, this tracker shows route details, status, and Chitthi."}
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    );
  }

  function updateRentalListingDraft<K extends keyof RentalCarListingInput>(key: K, value: RentalCarListingInput[K]) {
    setRentalListingDraft((current) => ({ ...current, [key]: value }));
  }

  async function openRentalOwnerForm() {
    if (!data?.user) {
      Alert.alert("Login required", "Please login before listing a rental car.");
      return;
    }
    setRentalOwnerOpen(true);
    setRentalOwnerBusy(true);
    try {
      const ownerCars = await getMyRentalCarListings();
      setRentalOwnerCars(ownerCars);
    } catch {
      setRentalOwnerCars([]);
    } finally {
      setRentalOwnerBusy(false);
    }
  }

  function closeRentalOwnerForm() {
    setRentalOwnerOpen(false);
  }

  async function submitRentalListing() {
    if (!data?.user) {
      Alert.alert("Login required", "Please login before listing a rental car.");
      return;
    }
    const missing = [
      !rentalListingDraft.name?.trim() && !(`${rentalListingDraft.brand || ""} ${rentalListingDraft.model || ""}`.trim()) ? "vehicle name" : "",
      !rentalListingDraft.dailyPrice?.trim() ? "daily price" : "",
      !rentalListingDraft.location?.trim() ? "pickup location" : "",
      !rentalListingDraft.licensePlate?.trim() ? "license plate" : "",
      !rentalListingDraft.availableFrom?.trim() ? "available from date" : ""
    ].filter(Boolean);
    if (missing.length) {
      Alert.alert("More details needed", `Add ${missing.join(", ")} before submitting for review.`);
      return;
    }
    setRentalOwnerBusy(true);
    try {
      const payload = await listRentalCar({
        ...rentalListingDraft,
        name: rentalListingDraft.name?.trim() || `${rentalListingDraft.brand || ""} ${rentalListingDraft.model || ""}`.trim(),
        dailyPrice: String(rentalListingDraft.dailyPrice || "").replace(/[^0-9.]/g, "")
      });
      if (payload.car) {
        setRentalOwnerCars((current) => [payload.car, ...current.filter((car) => car.id !== payload.car.id)]);
        setRentalCars((current) => [payload.car, ...current.filter((car) => car.id !== payload.car.id)]);
        setRentalSearched(true);
      }
      setRentalListingDraft(initialRentalListingDraft);
      Alert.alert("Car submitted", payload.message || "Your rental car listing was submitted for review.");
    } catch (error) {
      Alert.alert("Could not list car", error instanceof Error ? error.message : "Try again.");
    } finally {
      setRentalOwnerBusy(false);
    }
  }

  function renderRentalOwnerModal() {
    const categoryOptions = ["Sedan", "SUV", "Minivan", "Compact"];
    const fuelOptions = ["Gas", "Hybrid", "Electric"];
    return (
      <Modal visible={rentalOwnerOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={closeRentalOwnerForm}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.rentalOwnerScreen}>
          <ScrollView contentContainerStyle={styles.rentalOwnerContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.rentalOwnerHeader}>
              <TouchableOpacity style={styles.ridePlannerBack} onPress={closeRentalOwnerForm}>
                <Text style={styles.ridePlannerBackText}>‹</Text>
              </TouchableOpacity>
              <View style={styles.rentalOwnerHeaderCopy}>
                <Text style={styles.rideOwnerEyebrow}>Car owner</Text>
                <Text style={styles.rideOwnerTitle}>List your car</Text>
              </View>
            </View>

            <View style={styles.rentalOwnerHero}>
              <Image source={appAssets.carFallback} style={styles.rentalOwnerHeroIcon} resizeMode="contain" />
              <View style={styles.rideOwnerHeroCopy}>
                <Text style={styles.rideOwnerHeroTitle}>Submit vehicle, docs, availability, and pickup details.</Text>
                <Text style={styles.rideOwnerHeroText}>
                  FairFares reviews owner listings before they appear in rental search. Keep pickup notes and document readiness clear.
                </Text>
              </View>
            </View>

            {rentalOwnerCars.length ? (
              <View style={styles.rentalOwnerCard}>
                <Text style={styles.rideOwnerSectionTitle}>Your rental cars</Text>
                {rentalOwnerCars.slice(0, 4).map((car) => (
                  <View key={car.id} style={styles.rentalOwnerSavedCar}>
                    <Text style={styles.rentalOwnerSavedTitle} numberOfLines={1}>{car.name}</Text>
                    <Text style={styles.rentalOwnerSavedMeta}>{car.location || "Pickup location open"} · ${Number(car.daily_price || 0).toFixed(2)}/day</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.rentalOwnerCard}>
              <Text style={styles.rideOwnerSectionTitle}>Vehicle details</Text>
              <TextInput
                style={styles.rideOwnerInput}
                placeholder="Listing title, e.g. Nissan Versa near DEN"
                placeholderTextColor={theme.colors.muted}
                value={rentalListingDraft.name || ""}
                onChangeText={(value) => updateRentalListingDraft("name", value)}
              />
              <View style={styles.rideOwnerInputRow}>
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Brand"
                  placeholderTextColor={theme.colors.muted}
                  value={rentalListingDraft.brand || ""}
                  onChangeText={(value) => updateRentalListingDraft("brand", value)}
                />
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Model"
                  placeholderTextColor={theme.colors.muted}
                  value={rentalListingDraft.model || ""}
                  onChangeText={(value) => updateRentalListingDraft("model", value)}
                />
              </View>
              <View style={styles.rideOwnerInputRow}>
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Year"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="number-pad"
                  value={rentalListingDraft.year || ""}
                  onChangeText={(value) => updateRentalListingDraft("year", value)}
                />
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Color"
                  placeholderTextColor={theme.colors.muted}
                  value={rentalListingDraft.color || ""}
                  onChangeText={(value) => updateRentalListingDraft("color", value)}
                />
              </View>
              <Text style={styles.rideOwnerFieldLabel}>Category</Text>
              <View style={styles.rideOwnerStatusWrap}>
                {categoryOptions.map((category) => (
                  <TouchableOpacity
                    key={category}
                    style={[styles.rideOwnerStatusPill, rentalListingDraft.category === category && styles.rideOwnerStatusPillActive]}
                    onPress={() => updateRentalListingDraft("category", category)}
                  >
                    <Text style={styles.rideOwnerStatusPillText}>{category}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.rideOwnerFieldLabel}>Fuel type</Text>
              <View style={styles.rideOwnerStatusWrap}>
                {fuelOptions.map((fuel) => (
                  <TouchableOpacity
                    key={fuel}
                    style={[styles.rideOwnerStatusPill, rentalListingDraft.fuelType === fuel && styles.rideOwnerStatusPillActive]}
                    onPress={() => updateRentalListingDraft("fuelType", fuel)}
                  >
                    <Text style={styles.rideOwnerStatusPillText}>{fuel}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.rideOwnerInputRow}>
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Seats"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="number-pad"
                  value={rentalListingDraft.seats || ""}
                  onChangeText={(value) => updateRentalListingDraft("seats", value)}
                />
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Bags"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="number-pad"
                  value={rentalListingDraft.bags || ""}
                  onChangeText={(value) => updateRentalListingDraft("bags", value)}
                />
              </View>
              <View style={styles.rideOwnerInputRow}>
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Doors"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="number-pad"
                  value={rentalListingDraft.doors || ""}
                  onChangeText={(value) => updateRentalListingDraft("doors", value)}
                />
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Transmission"
                  placeholderTextColor={theme.colors.muted}
                  value={rentalListingDraft.transmission || ""}
                  onChangeText={(value) => updateRentalListingDraft("transmission", value)}
                />
              </View>
            </View>

            <View style={styles.rentalOwnerCard}>
              <Text style={styles.rideOwnerSectionTitle}>Availability and pricing</Text>
              <TextInput
                style={styles.rideOwnerInput}
                placeholder="Pickup location, e.g. DEN or 1665 Logan St Denver"
                placeholderTextColor={theme.colors.muted}
                value={rentalListingDraft.location || ""}
                onChangeText={(value) => updateRentalListingDraft("location", value)}
              />
              <View style={styles.rideOwnerInputRow}>
                <DateTimeField
                  style={styles.rideOwnerHalfInput}
                  label="Available from"
                  mode="date"
                  minimumDate={todayIsoDate()}
                  value={rentalListingDraft.availableFrom || ""}
                  onChange={(value) => updateRentalListingDraft("availableFrom", value)}
                />
                <DateTimeField
                  style={styles.rideOwnerHalfInput}
                  label="Available to"
                  mode="date"
                  minimumDate={rentalListingDraft.availableFrom || todayIsoDate()}
                  value={rentalListingDraft.availableTo || ""}
                  onChange={(value) => updateRentalListingDraft("availableTo", value)}
                />
              </View>
              <View style={styles.rideOwnerInputRow}>
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Daily price"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="decimal-pad"
                  value={rentalListingDraft.dailyPrice}
                  onChangeText={(value) => updateRentalListingDraft("dailyPrice", value)}
                />
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="License plate"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="characters"
                  value={rentalListingDraft.licensePlate || ""}
                  onChangeText={(value) => updateRentalListingDraft("licensePlate", value)}
                />
              </View>
              <TextInput
                style={styles.rideOwnerInput}
                placeholder="Features, e.g. airport pickup, child seat, snow tires"
                placeholderTextColor={theme.colors.muted}
                value={rentalListingDraft.features || ""}
                onChangeText={(value) => updateRentalListingDraft("features", value)}
              />
              <TextInput
                style={[styles.rideOwnerInput, styles.rentalOwnerNotes]}
                placeholder="Documents, insurance, pickup instructions, restrictions, and owner notes"
                placeholderTextColor={theme.colors.muted}
                value={rentalListingDraft.notes || ""}
                onChangeText={(value) => updateRentalListingDraft("notes", value)}
                multiline
              />
              <TouchableOpacity style={styles.rentalOwnerSubmit} onPress={submitRentalListing} disabled={rentalOwnerBusy}>
                <Text style={styles.rentalOwnerSubmitText}>{rentalOwnerBusy ? "Submitting..." : "Submit car for review"}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  function updateRentalSearch(key: keyof RentalSearchInput, value: string | boolean) {
    setRentalSearch((current) => {
      const next = { ...current, [key]: value };
      if (key === "pickupLocation" && !current.returnLocation) {
        next.returnLocation = String(value);
      }
      if (key === "pickupDate" && typeof value === "string" && current.returnDate <= value) {
        next.returnDate = addDays(value, 1);
      }
      if ((key === "pickupDate" || key === "pickupTime") && next.pickupDate === todayIsoDate()) {
        const minimum = firstAllowedPickupTime(next.pickupDate);
        if (timeTextToMinutes(String(next.pickupTime)) < timeTextToMinutes(minimum)) {
          next.pickupTime = minimum;
        }
      }
      if (key === "returnDate" && typeof value === "string" && value <= current.pickupDate) {
        next.returnDate = addDays(current.pickupDate, 1);
      }
      return next;
    });
  }

  async function searchRentalCars() {
    const today = todayIsoDate();
    if (!rentalSearch.pickupDate || rentalSearch.pickupDate < today) {
      const pickupDate = today;
      const returnDate = rentalSearch.returnDate > pickupDate ? rentalSearch.returnDate : addDays(pickupDate, 1);
      setRentalSearch((current) => ({
        ...current,
        pickupDate,
        returnDate,
        pickupTime: firstAllowedPickupTime(pickupDate)
      }));
      Alert.alert("Choose a current pickup date", "Past rental dates are unavailable. Select today or a future date.");
      return;
    }
    if (!rentalSearch.returnDate || rentalSearch.returnDate <= rentalSearch.pickupDate) {
      setRentalSearch((current) => ({ ...current, returnDate: addDays(current.pickupDate, 1) }));
      Alert.alert("Choose a valid return date", "Return must be at least one day after pickup.");
      return;
    }
    if (rentalSearch.pickupDate === today && timeTextToMinutes(rentalSearch.pickupTime) < timeTextToMinutes(firstAllowedPickupTime(today))) {
      setRentalSearch((current) => ({ ...current, pickupTime: firstAllowedPickupTime(today) }));
      Alert.alert("Choose a current pickup time", `Today's earliest available pickup is ${firstAllowedPickupTime(today)}.`);
      return;
    }
    setRentalBusy(true);
    try {
      const nextCars = await getCars(rentalSearch.pickupLocation, "", rentalSearch);
      void trackProductEvent("rental_search", { resultCount: nextCars.length, source: "rental_search" });
      setRentalCars(nextCars);
      setRentalSearched(true);
      setSelectedRentalCar(null);
      setRentalQuote(null);
    } catch (error) {
      Alert.alert("Rental search failed", error instanceof Error ? error.message : "Could not search rental cars.");
    } finally {
      setRentalBusy(false);
    }
  }

  async function reviewRentalCar(car: Car) {
    void trackProductEvent("rental_car_view", { carId: car.id, source: "rental_results" });
    setSelectedRentalCar(car);
    setRentalBusy(true);
    try {
      const nextQuote = await quoteRentalCar(Number(car.id), rentalSearch);
      setRentalQuote(nextQuote);
    } catch (error) {
      setRentalQuote(null);
      Alert.alert("Quote failed", error instanceof Error ? error.message : "Could not quote this rental.");
    } finally {
      setRentalBusy(false);
    }
  }

  function selectRentalPickerValue(value: string) {
    if (!rentalPicker) return;
    updateRentalSearch(rentalPicker, value);
    setRentalPicker(null);
  }

  function renderPickerModal() {
    const isDatePicker = rentalPicker === "pickupDate" || rentalPicker === "returnDate";
    const isTimePicker = rentalPicker === "pickupTime" || rentalPicker === "returnTime";
    const isLocationPicker = rentalPicker === "pickupLocation" || rentalPicker === "returnLocation";
    const title =
      rentalPicker === "pickupLocation" ? "Pickup location" :
      rentalPicker === "returnLocation" ? "Return location" :
      rentalPicker === "pickupDate" ? "Pick-up date" :
      rentalPicker === "returnDate" ? "Return date" :
      rentalPicker === "pickupTime" ? "Pick-up time" :
      rentalPicker === "returnTime" ? "Return time" :
      rentalPicker === "renterAge" ? "Renter age" : "";
    const values = isLocationPicker ? rentalLocationOptions : isDatePicker ? calendarDates : isTimePicker ? timeOptions : renterAgeOptions;
    const activeValue = rentalPicker ? String(rentalSearch[rentalPicker] || "") : "";

    return (
      <Modal visible={Boolean(rentalPicker)} transparent animationType="fade" onRequestClose={() => setRentalPicker(null)}>
        <View style={styles.pickerBackdrop}>
          <View style={[styles.pickerCard, isLight && styles.pickerCardLight]}>
            <View style={styles.pickerHeader}>
              <Text style={[styles.pickerTitle, isLight && styles.pickerTitleLight]}>{title}</Text>
              <TouchableOpacity style={[styles.pickerClose, isLight && styles.pickerCloseLight]} onPress={() => setRentalPicker(null)}>
                <Text style={[styles.pickerCloseText, isLight && styles.pickerCloseTextLight]}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={isDatePicker ? styles.calendarGrid : styles.pickerList}>
              {values.map((value) => {
                const disabled = rentalPicker === "returnDate" && value <= rentalSearch.pickupDate;
                const timeDisabled = rentalPicker === "pickupTime"
                  && rentalSearch.pickupDate === todayIsoDate()
                  && timeTextToMinutes(value) < timeTextToMinutes(minimumPickupTimeToday());
                const selected = isLocationPicker
                  ? value.toLowerCase().replace(/[^a-z0-9]/g, "") === activeValue.toLowerCase().replace(/[^a-z0-9]/g, "")
                  : value === activeValue;
                return (
                  <TouchableOpacity
                    key={value}
                    disabled={disabled || timeDisabled}
                    style={[
                      isDatePicker ? styles.calendarCell : styles.pickerOption,
                      isLight && (isDatePicker ? styles.calendarCellLight : styles.pickerOptionLight),
                      selected && styles.pickerOptionActive,
                      (disabled || timeDisabled) && styles.pickerOptionDisabled
                    ]}
                    onPress={() => selectRentalPickerValue(value)}
                  >
                    <Text style={[styles.pickerOptionText, isLight && styles.pickerOptionTextLight, selected && styles.pickerOptionTextActive, (disabled || timeDisabled) && styles.pickerOptionTextDisabled]}>
                      {isDatePicker ? formatDateLabel(value) : value}
                    </Text>
                    {isDatePicker ? <Text style={styles.calendarDateText}>{value.slice(5)}</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  function renderRentalCarsOnly() {
    return (
      <>
        <RentalPromoCarousel onPress={searchRentalCars} />
        <View style={[styles.carSearchPanel, isLight && styles.carSearchPanelLight]}>
          <Text style={styles.carSearchTitle}>Search rental cars</Text>
          <Text style={styles.carFieldLabel}>Pickup location</Text>
          <TouchableOpacity style={[styles.carSelectInput, isLight && styles.carInputLight]} onPress={() => setRentalPicker("pickupLocation")}>
            <Text style={styles.carSelectValue} numberOfLines={2}>{rentalSearch.pickupLocation || "Select pickup location"}</Text>
          </TouchableOpacity>
          <Text style={styles.carFieldLabel}>Return location</Text>
          <TouchableOpacity style={[styles.carSelectInput, isLight && styles.carInputLight]} onPress={() => setRentalPicker("returnLocation")}>
            <Text style={styles.carSelectValue} numberOfLines={2}>{rentalSearch.returnLocation || "Select return location"}</Text>
          </TouchableOpacity>
          <View style={styles.carTwoCol}>
            <DateTimeField style={styles.carTwoColField} label="Pickup date" value={rentalSearch.pickupDate} mode="date" minimumDate={todayIsoDate()} onChange={(value) => updateRentalSearch("pickupDate", value)} />
            <DateTimeField style={styles.carTwoColField} label="Return date" value={rentalSearch.returnDate} mode="date" minimumDate={addDays(rentalSearch.pickupDate, 1)} onChange={(value) => updateRentalSearch("returnDate", value)} />
          </View>
          <View style={styles.carTwoCol}>
            <DateTimeField style={styles.carTwoColField} label="Pickup time" value={rentalSearch.pickupTime} mode="time" onChange={(value) => updateRentalSearch("pickupTime", value)} />
            <DateTimeField style={styles.carTwoColField} label="Return time" value={rentalSearch.returnTime} mode="time" onChange={(value) => updateRentalSearch("returnTime", value)} />
          </View>
          <View style={styles.carTwoCol}>
            <View style={styles.carTwoColField}>
              <Text style={styles.carFieldLabel}>Renter age</Text>
              <TouchableOpacity style={[styles.carSelectInput, isLight && styles.carInputLight]} onPress={() => setRentalPicker("renterAge")}>
                <Text style={styles.carSelectValue}>{rentalSearch.renterAge || "25+"}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.carTwoColField}>
              <Text style={styles.carFieldLabel}>Rental length</Text>
              <View style={[styles.carEstimateBox, isLight && styles.carInputLight]}>
                <Text style={styles.carEstimateValue}>{rentalLengthText(rentalDayCount)}</Text>
                <Text style={styles.carEstimateMeta}>{rentalTier.label}</Text>
              </View>
            </View>
          </View>
          <View style={[styles.carRateNote, isLight && styles.carRateNoteLight]}>
            <Text style={styles.carRateNoteTitle}>{rentalTier.label}</Text>
            <Text style={styles.carRateNoteText}>
              {rentalTier.rate > 0
                ? `${Math.round(rentalTier.rate * 100)}% duration savings are reflected in the daily ranges below.`
                : "Daily ranges apply for 1-6 day rentals. Weekly starts at 7 days; monthly starts at 30 days."}
            </Text>
          </View>
          <Text style={styles.carFieldLabel}>Promo / referral / student code</Text>
          <TextInput
            value={rentalSearch.discountCode}
            onChangeText={(text) => updateRentalSearch("discountCode", text.toUpperCase())}
            placeholder="Enter promo, referral, or student code"
            placeholderTextColor={theme.colors.muted}
            style={[styles.carSearchInput, isLight && styles.carSearchInputLight]}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.carSearchButton} onPress={searchRentalCars} disabled={rentalBusy}>
            <Text style={styles.carSearchButtonText}>{rentalBusy ? "Searching..." : "Search cars"}</Text>
          </TouchableOpacity>
        </View>
        {rentalRows.length ? (
          <View style={styles.carList} onLayout={(event) => setRentalResultsY(event.nativeEvent.layout.y)}>
            <Modal visible={Boolean(rentalQuote)} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setRentalQuote(null)}>
              <View style={[styles.checkoutScreen, isLight && styles.checkoutScreenLight]}>
                <ScrollView contentContainerStyle={styles.checkoutContent} showsVerticalScrollIndicator={false}>
                  <View style={styles.checkoutHeader}>
                    <View>
                      <Text style={styles.reviewEyebrow}>Checkout</Text>
                      <Text style={styles.reviewTitle}>Finalize trip</Text>
                    </View>
                    <TouchableOpacity style={[styles.checkoutClose, isLight && styles.checkoutCloseLight]} onPress={() => setRentalQuote(null)}>
                      <Text style={styles.checkoutCloseText}>X</Text>
                    </TouchableOpacity>
                  </View>
            {rentalQuote ? (
              <View style={[styles.rentalReviewPanel, isLight && styles.rentalReviewPanelLight]}>
                <Text style={styles.reviewCarTitle}>{rentalQuote.booking.carName || selectedRentalCar?.name}</Text>
                <Text style={[styles.reviewMeta, isLight && styles.reviewMetaLight]}>{rentalQuote.booking.pickupLocation}</Text>
                <Text style={[styles.reviewMeta, isLight && styles.reviewMetaLight]}>{rentalQuote.booking.pickupDate} {rentalQuote.booking.pickupTime} to {rentalQuote.booking.returnDate} {rentalQuote.booking.returnTime}</Text>
                <View style={[styles.reviewInfoCard, isLight && styles.reviewInfoCardLight]}>
                  <Text style={styles.reviewInfoTitle}>Your information</Text>
                  <TextInput value={rentalCheckoutInfo.firstName} onChangeText={(text) => setRentalCheckoutInfo((current) => ({ ...current, firstName: text }))} placeholder="First name" placeholderTextColor={theme.colors.muted} style={[styles.reviewInput, isLight && styles.reviewInputLight]} />
                  <TextInput value={rentalCheckoutInfo.lastName} onChangeText={(text) => setRentalCheckoutInfo((current) => ({ ...current, lastName: text }))} placeholder="Last name" placeholderTextColor={theme.colors.muted} style={[styles.reviewInput, isLight && styles.reviewInputLight]} />
                  <TextInput value={rentalCheckoutInfo.email} onChangeText={(text) => setRentalCheckoutInfo((current) => ({ ...current, email: text }))} placeholder="Email address" placeholderTextColor={theme.colors.muted} style={[styles.reviewInput, isLight && styles.reviewInputLight]} autoCapitalize="none" />
                  <TextInput value={rentalCheckoutInfo.phone} onChangeText={(text) => setRentalCheckoutInfo((current) => ({ ...current, phone: text }))} placeholder="Mobile number" placeholderTextColor={theme.colors.muted} style={[styles.reviewInput, isLight && styles.reviewInputLight]} keyboardType="phone-pad" />
                  <Text style={[styles.reviewPolicy, isLight && styles.reviewPolicyLight]}>Used for booking confirmation, pickup coordination, and rental updates.</Text>
                </View>
                <View style={styles.reviewGrid}>
                  <Text style={[styles.reviewItem, isLight && styles.reviewItemLight]}>Trip: {rentalQuote.booking.days} days</Text>
                  <Text style={[styles.reviewItem, isLight && styles.reviewItemLight]}>Daily: {dollars(rentalQuote.breakdown.effectiveDaily)}</Text>
                  <Text style={[styles.reviewItem, isLight && styles.reviewItemLight]}>Taxes/fees: {dollars(rentalQuote.breakdown.taxFeeAmount)}</Text>
                  <Text style={[styles.reviewItem, isLight && styles.reviewItemLight]}>Due pickup: {dollars(rentalQuote.breakdown.dueAtPickup)}</Text>
                </View>
                <Text style={styles.reviewTotal}>Total {dollars(rentalQuote.breakdown.total)}</Text>
                {rentalQuote.breakdown.savings > 0 ? <Text style={styles.reviewSavings}>You save {dollars(rentalQuote.breakdown.savings)} vs standard rental pricing.</Text> : null}
                <View style={styles.reviewActions}>
                  <TouchableOpacity style={styles.reviewHoldButton} onPress={() => selectedRentalCar && onBookCar(selectedRentalCar, rentalSearch, "hold")}>
                    <Text style={styles.reviewHoldText}>Pay 10% hold</Text>
                    <Text style={styles.reviewHoldMeta}>{dollars(rentalQuote.breakdown.holdAmount)} due now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.reviewFullButton} onPress={() => selectedRentalCar && onBookCar(selectedRentalCar, rentalSearch, "full")}>
                    <Text style={styles.reviewFullText}>Pay in full</Text>
                    <Text style={styles.reviewFullMeta}>{dollars(rentalQuote.breakdown.fullPaymentTotal)} today</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.reviewPolicy, isLight && styles.reviewPolicyLight]}>Deposit: {dollars(rentalQuote.policy.securityDepositAmount)} refundable authorization at pickup.</Text>
                <Text style={[styles.reviewPolicy, isLight && styles.reviewPolicyLight]}>{rentalQuote.policy.cancellation.cutoff_copy}</Text>
              </View>
            ) : null}
                </ScrollView>
              </View>
            </Modal>
            {rentalRows.map((car) => {
              const image = absoluteAssetUrl(car.image_url);
              const carDailyPrice = Number(car.daily_price || 0);
              const isLowestDailyRate = lowestRentalDailyPrice !== null && carDailyPrice === lowestRentalDailyPrice;
              return (
                <TouchableOpacity
                  key={car.id}
                  style={[styles.carMiniCard, isLight && styles.carMiniCardLight, isLowestDailyRate && styles.carMiniCardLowest, selectedRentalCar?.id === car.id && styles.carMiniCardActive]}
                  onPress={() => reviewRentalCar(car)}
                  accessibilityLabel={`${car.name}. ${isLowestDailyRate ? "Lowest daily rental rate. " : ""}${dailyPriceRange(car.daily_price, rentalDayCount).low} to ${dailyPriceRange(car.daily_price, rentalDayCount).high} dollars per day`}
                >
                  <RentalCarImage uri={image} name={car.name} />
                  <View style={styles.carMiniBody}>
                    {isLowestDailyRate ? <Text style={styles.carMiniLowestLabel}>Lowest car rental</Text> : null}
                    <Text style={styles.carMiniTitle}>{car.name}</Text>
                    <Text style={styles.carMiniMeta}>{car.location || "Denver pickup"}</Text>
                    <Text style={styles.carMiniPrice}>${dailyPriceRange(car.daily_price, rentalDayCount).low}-${dailyPriceRange(car.daily_price, rentalDayCount).high}/day</Text>
                    {durationSavingsText(car.daily_price, rentalDayCount) ? (
                      <Text style={styles.carMiniSavings}>{durationSavingsText(car.daily_price, rentalDayCount)}</Text>
                    ) : null}
                    <Text style={styles.carMiniAction}>Review trip</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </>
    );
  }

  function updateRideForm<K extends keyof RideInput>(key: K, value: RideInput[K]) {
    if (key === "origin") {
      rideAutoOriginRef.current = "";
      selectedRideLabelsRef.current.origin = "";
      selectedRidePlaceIdsRef.current.origin = "";
    }
    if (key === "destination") {
      selectedRideLabelsRef.current.destination = "";
      selectedRidePlaceIdsRef.current.destination = "";
    }
    setRideForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "origin") {
        next.originLat = null;
        next.originLng = null;
      }
      if (key === "destination") {
        next.destinationLat = null;
        next.destinationLng = null;
      }
      return next;
    });
  }

  function toggleRideDay(day: string) {
    setRideForm((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(day)
        ? current.daysOfWeek.filter((item) => item !== day)
        : [...current.daysOfWeek, day]
    }));
  }

  async function searchRides() {
    setRideBusy(true);
    try {
      const rides = await getRides(rideForm.city, rideForm.origin, rideForm.destination, "CARPOOL_OFFER", {
        originLat: rideForm.originLat,
        originLng: rideForm.originLng,
        destinationLat: rideForm.destinationLat,
        destinationLng: rideForm.destinationLng,
        pickupDate: rideForm.pickupDate
      });
      setRideRows(rides);
    } catch (error) {
      Alert.alert("Ride search failed", error instanceof Error ? error.message : "Unable to search rides.");
    } finally {
      setRideBusy(false);
    }
  }

  async function postRide() {
    if (!data?.user) {
      Alert.alert("Login required", "Please login before posting or offering a ride.");
      return;
    }
    setRideBusy(true);
    try {
      const result = await createMobileRide({
        ...rideForm,
        rideType: rideForm.rideType === "CARPOOL_OFFER" ? "CARPOOL_OFFER" : "CARPOOL_REQUEST"
      });
      const ride = result.ride;
      if (!ride) throw new Error("Ride was not saved.");
      setRideRows((current) => [ride, ...current.filter((item) => item.id !== ride.id)]);
      setRideActivityRows((current) => [ride, ...current.filter((item) => item.id !== ride.id)]);
      setRidePosted(true);
      setRideListingSuccess(ride);
      onBottomTabsHiddenChange?.(true);
      void refreshRideActivity();
    } catch (error) {
      Alert.alert("Ride post failed", error instanceof Error ? error.message : "Unable to post this ride.");
    } finally {
      setRideBusy(false);
    }
  }

  function renderRidePlannerModal() {
    const activeInputValue = rideFocusedField === "origin" ? rideForm.origin : rideForm.destination;
    const selectedSuggestionSettled = activeInputValue.trim() === selectedRideSuggestionRef.current;
    const driverOffers = rideRows.filter((ride) => ride.role === "DRIVER");
    const selectedDriverOffer = driverOffers.find((ride) => `offer:${ride.id}` === selectedRideChoice) || null;
    const mapRouteOrigin = selectedDriverOffer?.origin || rideForm.origin;
    const mapRouteDestination = selectedDriverOffer?.destination || rideForm.destination;
    const mapOriginLat = selectedDriverOffer?.originLat ?? rideForm.originLat;
    const mapOriginLng = selectedDriverOffer?.originLng ?? rideForm.originLng;
    const mapDestinationLat = selectedDriverOffer?.destinationLat ?? rideForm.destinationLat;
    const mapDestinationLng = selectedDriverOffer?.destinationLng ?? rideForm.destinationLng;
    const validRideMapPoint = (latitude: unknown, longitude: unknown) =>
      typeof latitude === "number"
      && Number.isFinite(latitude)
      && latitude >= -90
      && latitude <= 90
      && typeof longitude === "number"
      && Number.isFinite(longitude)
      && longitude >= -180
      && longitude <= 180
      // A missing geocode has historically been serialized as 0,0. Rendering
      // it makes Apple Maps frame the Gulf of Guinea as an empty blue map.
      && !(Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001);
    const nativeMapPoints = validRideMapPoint(mapOriginLat, mapOriginLng)
      && validRideMapPoint(mapDestinationLat, mapDestinationLng)
      ? {
          origin: { latitude: mapOriginLat as number, longitude: mapOriginLng as number },
          destination: { latitude: mapDestinationLat as number, longitude: mapDestinationLng as number }
        }
      : null;
    const mapUri = ridePlanComplete()
      ? rideMapUrl(
          rideForm.city,
          mapRouteOrigin,
          mapRouteDestination,
          selectedDriverOffer
            ? { riderOrigin: rideForm.origin, riderDestination: rideForm.destination }
            : undefined
        )
      : "";
    const listingRide = rideForm.rideType === "CARPOOL_OFFER";
    const rideDestinationPicked = Boolean(
      rideForm.destination.trim() &&
        hasRideCoordinates(rideForm.destinationLat, rideForm.destinationLng)
    );
    const plannerActionText = editingRideId ? "Save changes" : listingRide ? (rideDestinationPicked ? "List ride" : "Continue") : "Find rides";
    return (
      <Modal visible={ridePlannerOpen} animationType="slide" onRequestClose={closeRidePlanner}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.ridePlannerScreen}>
          {ridePlannerStage === "plan" ? (
            <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={styles.ridePlannerContent}>
              <View style={styles.ridePlannerHandle} />
              <View style={styles.ridePlannerHeader}>
                <TouchableOpacity style={styles.ridePlannerBack} onPress={closeRidePlanner}>
                  <Text style={styles.ridePlannerBackText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.ridePlannerTitle}>{editingRideId ? "Edit your ride" : listingRide ? "List your ride" : "Plan your ride"}</Text>
                <View style={styles.ridePlannerBack} />
              </View>

              {!listingRide ? (
                <View style={styles.ridePlannerPillRow}>
                  <DateTimeField
                    darkSurface
                    style={styles.rideRequestScheduleField}
                    label="Pickup date"
                    mode="date"
                    minimumDate={todayIsoDate()}
                    value={rideForm.pickupDate}
                    onChange={(value) => setRideForm((current) => ({
                      ...current,
                      pickupDate: value,
                      pickupTime: ridePickupIsInPast(value, current.pickupTime) ? firstAllowedPickupTime(value) : current.pickupTime
                    }))}
                  />
                  <DateTimeField
                    darkSurface
                    style={styles.rideRequestScheduleField}
                    label="Pickup time"
                    mode="time"
                    value={rideForm.pickupTime}
                    onChange={(value) => updateRideForm("pickupTime", value)}
                  />
                </View>
              ) : (
                <Text style={styles.ridePlannerOwnerHint}>Enter where you are going first. Trip time, seats, luggage, and contribution come next.</Text>
              )}

              <View style={styles.rideRouteInputCard}>
                <View style={styles.rideRouteRail}>
                  <View style={styles.rideRouteDot} />
                  <View style={styles.rideRouteRailLine} />
                  <View style={styles.rideRouteSquare} />
                </View>
                <View style={styles.rideRouteInputs}>
                  <TextInput
                    ref={rideOriginInputRef}
                    value={rideForm.origin}
                    onFocus={() => { setRideFocusedField("origin"); setRideSuggestionsEnabled(true); }}
                    onChangeText={(text) => {
                      selectedRideSuggestionRef.current = "";
                      setRideFocusedField("origin");
                      setRideSuggestionsEnabled(true);
                      updateRideForm("origin", text);
                    }}
                    placeholder={listingRide ? "Starting point" : "Pickup location"}
                    placeholderTextColor="#9da1a8"
                    style={[styles.rideRouteInput, rideFocusedField === "origin" && styles.rideRouteInputActive]}
                  />
                  <TextInput
                    ref={rideDestinationInputRef}
                    value={rideForm.destination}
                    onFocus={() => { setRideFocusedField("destination"); setRideSuggestionsEnabled(true); }}
                    onChangeText={(text) => {
                      selectedRideSuggestionRef.current = "";
                      setRideFocusedField("destination");
                      setRideSuggestionsEnabled(true);
                      updateRideForm("destination", text);
                    }}
                    onSubmitEditing={() => void planRideRoute()}
                    placeholder={listingRide ? "Where are you going?" : "Where to?"}
                    placeholderTextColor="#9da1a8"
                    style={[styles.rideRouteInput, rideFocusedField === "destination" && styles.rideRouteInputActive]}
                  />
                </View>
                <TouchableOpacity
                  style={styles.rideRoutePlus}
                  accessibilityRole="button"
                  accessibilityLabel="Enter destination"
                  onPress={() => {
                    setRideFocusedField("destination");
                    setRideSuggestionsEnabled(true);
                    rideDestinationInputRef.current?.focus();
                  }}
                >
                  <Text style={styles.rideRoutePlusText}>+</Text>
                </TouchableOpacity>
              </View>

              {listingRide && rideDestinationPicked ? (
                <View style={styles.rideTripDetails}>
                  <Text style={styles.rideTripDetailsTitle}>When are you traveling?</Text>
                  <Text style={styles.rideTripHint}>These details are for this route listing. Change them each time you offer seats.</Text>
                  <View style={styles.rideTripDetailsRow}>
                    <View style={styles.rideTripField}>
                      <DateTimeField
                        label="Date"
                        mode="date"
                        minimumDate={todayIsoDate()}
                        value={rideForm.pickupDate}
                        onChange={(value) => setRideForm((current) => ({
                          ...current,
                          pickupDate: value,
                          pickupTime: ridePickupIsInPast(value, current.pickupTime) ? firstAllowedPickupTime(value) : current.pickupTime
                        }))}
                      />
                    </View>
                    <View style={styles.rideTripField}>
                      <DateTimeField
                        label="Time"
                        mode="time"
                        value={rideForm.pickupTime}
                        onChange={(value) => updateRideForm("pickupTime", value)}
                      />
                    </View>
                  </View>
                  <View style={styles.rideTripDetailsRow}>
                    <View style={styles.rideTripField}>
                      <Text style={styles.rideTripLabel}>Seats available</Text>
                      <TextInput
                        style={styles.rideTripInput}
                        placeholder="4"
                        placeholderTextColor="#8f949b"
                        keyboardType="number-pad"
                        value={rideForm.seats}
                        onChangeText={(value) => updateRideForm("seats", value)}
                      />
                    </View>
                    <View style={styles.rideTripField}>
                      <Text style={styles.rideTripLabel}>Contribution</Text>
                      <TextInput
                        style={styles.rideTripInput}
                        placeholder="Optional $"
                        placeholderTextColor="#8f949b"
                        keyboardType="number-pad"
                        value={rideForm.contributionPerSeat}
                        onChangeText={(value) => updateRideForm("contributionPerSeat", value)}
                      />
                    </View>
                  </View>
                  <View style={styles.rideTripDetailsRow}>
                    <View style={styles.rideTripFieldFull}>
                      <Text style={styles.rideTripLabel}>Luggage</Text>
                      <TextInput
                        style={styles.rideTripInput}
                        placeholder="1 small bag"
                        placeholderTextColor="#8f949b"
                        value={rideForm.luggage}
                        onChangeText={(value) => updateRideForm("luggage", value)}
                      />
                    </View>
                  </View>
                  <Text style={styles.rideTripDetailsTitle}>Vehicle for this ride</Text>
                  <Text style={styles.rideTripHint}>Confirm the car for this listing. You can change it each time you offer seats.</Text>
                  <View style={styles.rideTripDetailsRow}>
                    <View style={styles.rideTripFieldFull}>
                      <Text style={styles.rideTripLabel}>Vehicle make/model</Text>
                      <TextInput
                        style={styles.rideTripInput}
                        placeholder="Toyota Camry"
                        placeholderTextColor="#8f949b"
                        value={rideForm.vehicleMakeModel || ""}
                        onChangeText={(value) => updateRideForm("vehicleMakeModel", value)}
                      />
                    </View>
                  </View>
                  <View style={styles.rideTripDetailsRow}>
                    <View style={styles.rideTripField}>
                      <Text style={styles.rideTripLabel}>Year</Text>
                      <TextInput
                        style={styles.rideTripInput}
                        placeholder="2022"
                        placeholderTextColor="#8f949b"
                        keyboardType="number-pad"
                        value={rideForm.vehicleYear || ""}
                        onChangeText={(value) => updateRideForm("vehicleYear", value)}
                      />
                    </View>
                    <View style={styles.rideTripField}>
                      <Text style={styles.rideTripLabel}>Color</Text>
                      <TextInput
                        style={styles.rideTripInput}
                        placeholder="White"
                        placeholderTextColor="#8f949b"
                        value={rideForm.vehicleColor || ""}
                        onChangeText={(value) => updateRideForm("vehicleColor", value)}
                      />
                    </View>
                  </View>
                  <View style={styles.rideTripDetailsRow}>
                    <View style={styles.rideTripField}>
                      <Text style={styles.rideTripLabel}>Plate</Text>
                      <TextInput
                        style={styles.rideTripInput}
                        placeholder="ABC123"
                        placeholderTextColor="#8f949b"
                        autoCapitalize="characters"
                        value={rideForm.licensePlate || ""}
                        onChangeText={(value) => updateRideForm("licensePlate", value)}
                      />
                    </View>
                    <View style={styles.rideTripField}>
                      <Text style={styles.rideTripLabel}>State</Text>
                      <TextInput
                        style={styles.rideTripInput}
                        placeholder="CO"
                        placeholderTextColor="#8f949b"
                        autoCapitalize="characters"
                        value={rideForm.licenseState || ""}
                        onChangeText={(value) => updateRideForm("licenseState", value)}
                      />
                    </View>
                  </View>
                </View>
              ) : null}

              <View style={listingRide ? styles.rideSavedRowCompact : styles.rideSavedRow}>
                <TouchableOpacity
                  style={styles.rideSavedItem}
                  onPress={() => {
                    setRideFocusedField("origin");
                    updateRideForm("origin", rideDefaultPickup);
                    void useCurrentRideLocationForOrigin();
                  }}
                >
                  <Text style={styles.rideSavedIcon}>⌖</Text>
                  <View>
                    <Text style={styles.rideSavedTitle}>Your location</Text>
                    <Text style={styles.rideSavedMeta} numberOfLines={1}>
                      {currentRideLocationBusy ? "Detecting current address..." : rideDefaultPickup}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              <View style={styles.rideSuggestionList}>
                {currentRideLocationError ? <Text style={styles.rideSuggestionHelp}>{currentRideLocationError}</Text> : null}
                {rideSuggestionsBusy ? <View style={styles.rideSuggestionLoading} accessibilityRole="progressbar"><ActivityIndicator size="small" color={theme.colors.brand} /><Text style={styles.rideSuggestionHelp}>Loading nearby places…</Text></View> : null}
                {!rideSuggestionsBusy && !rideSuggestions.length && activeInputValue.trim() && !selectedSuggestionSettled ? (
                  <Text style={styles.rideSuggestionHelp}>No exact places yet. Try a landmark like Union Station or an address.</Text>
                ) : null}
                {rideSuggestions.map((place) => (
                  <TouchableOpacity key={`${place.label}-${place.source}`} style={styles.rideSuggestionRow} onPress={() => selectRidePlace(place)}>
                    <View style={styles.rideSuggestionDistance}>
                      <Text style={styles.rideSuggestionIcon}>
                        {place.source === "recent" ? "◷" : place.main.toLowerCase().includes("airport") ? "✈" : place.main.toLowerCase().includes("station") ? "▤" : "⌖"}
                      </Text>
                      <Text style={styles.rideSuggestionMiles}>{place.distanceMiles !== null ? `${place.distanceMiles} mi` : ""}</Text>
                    </View>
                    <View style={styles.rideSuggestionCopy}>
                      <Text style={styles.rideSuggestionTitle}>{place.main}</Text>
                      <Text style={styles.rideSuggestionMeta} numberOfLines={1}>{place.secondary}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {!listingRide ? (
                  <>
                    <TouchableOpacity
                      style={styles.rideUtilityRow}
                      onPress={() => {
                        updateRideForm("city", "");
                        setRideFocusedField("origin");
                        setRideSuggestionsEnabled(true);
                        rideOriginInputRef.current?.focus();
                      }}
                    >
                      <Text style={styles.rideUtilityIcon}>◎</Text>
                      <Text style={styles.rideUtilityText}>Search in a different city</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.rideUtilityRow} onPress={openRideGoogleMaps}>
                      <Text style={styles.rideUtilityIcon}>⌖</Text>
                      <Text style={styles.rideUtilityText}>Preview route in Maps</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </View>

              {listingRide || editingRideId ? (
                <Pressable style={styles.ridePlannerSearchButton} onPress={() => void planRideRoute()} disabled={rideBusy}>
                  <Text style={styles.ridePlannerSearchText}>{rideBusy ? (editingRideId ? "Saving..." : "Listing ride...") : plannerActionText}</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          ) : (
            <View style={styles.rideChoiceScreen}>
              <View style={styles.rideChoiceMap}>
                {Platform.OS === "ios" && nativeMapPoints ? (
                  <EmbeddedRideMap origin={nativeMapPoints.origin} destination={nativeMapPoints.destination} />
                ) : mapUri ? (
                  <Image source={{ uri: mapUri }} style={styles.rideChoiceMapImage} resizeMode="cover" />
                ) : (
                  <View style={styles.rideChoiceMapFallback}><Text style={styles.rideChoiceMapFallbackIcon}>⌖</Text><Text style={styles.rideChoiceMapFallbackText}>Route preview unavailable</Text></View>
                )}
                <TouchableOpacity style={styles.rideMapBackButton} onPress={() => setRidePlannerStage("plan")}>
                  <Text style={styles.rideMapBackText}>‹</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rideMapOpenButton} onPress={openRideGoogleMaps}>
                  <Text style={styles.rideMapOpenButtonText}>Open {nativeMapProviderName}</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.rideChoiceSheet} contentContainerStyle={styles.rideChoiceSheetContent} showsVerticalScrollIndicator={false}>
                <View style={styles.ridePlannerHandle} />
                <Text style={styles.rideChoiceTitle}>Choose a ride</Text>
                <Text style={styles.rideDriverNotify}>
                  {driverOffers.length
                    ? "These driver offers match your route. You can use Chitthi before requesting or accepting; acceptance confirms the seat and unlocks the pickup PIN."
                    : "No rides are available for this route yet. Save your request to get an alert when a matching ride is listed."}
                </Text>
                {driverOffers.length ? (
                  driverOffers.map((offer) => {
                    const selected = selectedRideChoice === `offer:${offer.id}`;
                    const expired = Boolean(offer.isExpired);
                    const riderTrip = [rideForm.origin, rideForm.destination].filter(Boolean).join(" → ");
                    const matchFacts = [
                      formatRidePickupDropDetail(offer),
                      offer.pickupDate || "",
                      offer.pickupTime || ""
                    ].filter(Boolean);
                    return (
                      <TouchableOpacity
                        key={offer.id}
                        style={[styles.rideChoiceRow, expired && styles.rideChoiceRowExpired, selected && styles.rideChoiceRowActive]}
                        onPress={() => {
                          if (expired) {
                            Alert.alert("Ride expired", "This ride date has passed. It remains visible for history, but cannot be requested.");
                            return;
                          }
                          setSelectedRideChoice(`offer:${offer.id}`);
                        }}
                      >
                        <View style={styles.rideChoiceRouteBadge}>
                          <Text style={styles.rideChoiceRouteBadgeText}>A→B</Text>
                        </View>
                        <View style={styles.rideChoiceCopy}>
                          <Text style={styles.rideChoiceName}>{offer.origin} → {offer.destination}</Text>
                          <Text style={styles.rideChoiceLister} numberOfLines={1}>Listed by {offer.ownerName?.trim() || "FairFares member"}</Text>
                          {riderTrip ? <Text style={styles.rideChoiceUserTrip} numberOfLines={2}>Your trip: {riderTrip}</Text> : null}
                          <View style={styles.rideChoiceChipRow}>
                            <Text style={[styles.rideChoiceChip, expired && styles.rideChoiceChipExpired]}>{expired ? "Expired" : "Driver offer"}</Text>
                            <Text style={styles.rideChoiceChip}>{offer.seats} seat{offer.seats === 1 ? "" : "s"}</Text>
                            <Text style={styles.rideChoiceChip}>{formatRideTotalDetour(offer)}</Text>
                          </View>
                          <Text style={styles.rideChoiceMeta} numberOfLines={2}>{matchFacts.join(" · ") || "Route fit will show after matching."}</Text>
                          <View style={styles.rideChoiceActionRow}>
                            <TouchableOpacity
                              style={[styles.rideChoiceSmallButton, styles.rideChoiceRequestButton]}
                              disabled={rideBusy || expired}
                              onPress={() => {
                                if (expired) {
                                  Alert.alert("Ride expired", "This ride date has passed. It remains visible for history, but cannot be requested.");
                                  return;
                                }
                                setSelectedRideChoice(`offer:${offer.id}`);
                                void requestPlannedRide(offer);
                              }}
                            >
                              <Text style={styles.rideChoiceRequestButtonText}>{rideBusy && selected ? "Sending..." : expired ? "Expired" : "Send ride request"}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.rideChoiceSmallButton} onPress={openRideGoogleMaps}>
                              <Text style={styles.rideChoiceSmallButtonText}>View route</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.rideChoiceSmallButton} onPress={() => void shareCarpoolListing(offer)} accessibilityRole="button" accessibilityLabel={`Share carpool from ${offer.origin} to ${offer.destination}`}>
                              <Text style={styles.rideChoiceSmallButtonText}>↗ Share</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.rideChoiceSmallButton, styles.rideChoiceChatButton]} onPress={() => onRideMessage(offer)}>
                              <Image source={appAssets.chittiMascot} style={styles.rideChoiceChatIcon} resizeMode="contain" />
                              <Text style={styles.rideChoiceSmallButtonText}>{sentRideIds.includes(offer.id) ? "✓ Sent" : "Chitthi"}</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <View style={styles.rideChoiceContribution}>
                          <View style={styles.rideChoiceAvailability}>
                            <View style={[styles.rideChoiceAvailabilityDot, expired && styles.rideChoiceAvailabilityDotExpired]} />
                            <Text style={[styles.rideChoicePrice, expired && styles.rideChoicePriceExpired]}>
                              {offer.contributionPerSeat ? `${offer.currencySymbol || ""}${Number(offer.contributionPerSeat).toFixed(2)}` : "Open"}
                            </Text>
                          </View>
                          <Text style={[styles.rideChoicePriceMeta, expired && styles.rideChoiceExpiredMeta]}>{offer.contributionPerSeat ? "expected" : "agree in chat"}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  <View style={styles.rideNoOffersCard}>
                    <Text style={styles.rideNoOffersTitle}>No matching rides yet</Text>
                    <Text style={styles.rideNoOffersCopy}>
                      {savedUnmatchedRideId
                        ? "Your request is saved. We'll notify you when a matching ride is listed."
                        : "Save this trip to get an alert when a matching ride is listed."}
                    </Text>
                  </View>
                )}
                <View style={styles.ridePaymentRow}>
                  <Text style={styles.ridePaymentIcon}>✓</Text>
                  <View style={styles.rideChoiceCopy}>
                    <Text style={styles.rideChoiceName}>Direct agreement</Text>
                    <Text style={styles.rideChoiceMeta}>Arrange any carpool contribution directly with the driver. FairFares does not collect or process this payment.</Text>
                  </View>
                  <TouchableOpacity style={styles.rideInlineChatButton} onPress={() => selectedDriverOffer ? onRideMessage(selectedDriverOffer) : onOpenMessenger()}>
                    <Image source={appAssets.chittiMascot} style={styles.rideInlineChatIcon} resizeMode="contain" />
                    <Text style={styles.rideInlineChatText}>{selectedDriverOffer && sentRideIds.includes(selectedDriverOffer.id) ? "✓ Sent" : "Chitthi"}</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.rideIssueButton} onPress={reportRideIssue}>
                  <Text style={styles.rideIssueIcon}>!</Text>
                  <View style={styles.rideChoiceCopy}>
                    <Text style={styles.rideIssueTitle}>Report a problem with this ride</Text>
                    <Text style={styles.rideIssueCopy}>Send FairFares details about a safety, driver, pickup, route, or behavior concern.</Text>
                  </View>
                  <Text style={styles.rideIssueArrow}>›</Text>
                </TouchableOpacity>
                {rideRequestStatus ? (
                  <View style={styles.rideRequestStatus}>
                    <Text style={styles.rideRequestStatusText}>{rideRequestStatus}</Text>
                  </View>
                ) : null}
                {!driverOffers.length && !savedUnmatchedRideId ? (
                  <TouchableOpacity style={styles.rideChoiceButton} onPress={() => data?.user ? void requestPlannedRide() : onRequireLogin?.()} disabled={rideBusy}>
                    <Text style={styles.rideChoiceButtonText}>{rideBusy ? "Saving..." : data?.user ? "Save ride request" : "Sign in to save request"}</Text>
                  </TouchableOpacity>
                ) : null}
              </ScrollView>
            </View>
          )}
          {ridePlannerStage === "plan" && ridePlanBusy ? (
            <BlurView
              tint="dark"
              intensity={38}
              experimentalBlurMethod="dimezisBlurView"
              style={styles.rideSearchLoadingOverlay}
            >
              <View style={styles.rideSearchLoadingCard}>
                <ActivityIndicator size="large" color="#f7f7f8" />
                <Text style={styles.rideSearchLoadingTitle}>{editingRideId ? "Saving ride changes" : listingRide ? (rideDestinationPicked ? "Listing your ride" : "Checking route") : "Finding rides"}</Text>
                <Text style={styles.rideSearchLoadingCopy}>{editingRideId ? "Updating your pickup, destination, and schedule…" : listingRide ? `Preparing ${rideForm.origin || "your starting point"} to ${rideForm.destination || "your destination"}…` : `Checking routes and nearby listings for ${rideForm.destination || "your destination"}…`}</Text>
                <Image source={appAssets.rideEarnLoading} style={styles.rideSearchLoadingPromo} resizeMode="contain" />
              </View>
            </BlurView>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  function closeRideListingSuccess() {
    setRideListingSuccess(null);
    onBottomTabsHiddenChange?.(false);
    if (rideOwnerPlannerEntryRef.current) {
      rideOwnerPlannerEntryRef.current = false;
      onRideOwnerClosed?.();
    }
  }

  function viewSuccessfulRideListing() {
    setRideListingSuccess(null);
    setRideOwnerRequestsAfterListing(true);
    setRideOwnerOpen(true);
    onBottomTabsHiddenChange?.(true);
    void refreshRideActivity();
  }

  function renderRideListingSuccess() {
    const ride = rideListingSuccess;
    return (
      <Modal visible={Boolean(ride)} transparent animationType="fade" onRequestClose={closeRideListingSuccess}>
        <View style={styles.rideListingSuccessBackdrop}>
          <View style={styles.rideListingSuccessCard} accessibilityRole="alert">
            <View style={styles.rideListingSuccessIcon}><Text style={styles.rideListingSuccessCheck}>✓</Text></View>
            <Text style={styles.rideListingSuccessEyebrow}>Successfully listed</Text>
            <Text style={styles.rideListingSuccessTitle}>Your carpool ride is live</Text>
            <Text style={styles.rideListingSuccessRoute}>
              {ride ? `${ride.origin} → ${ride.destination}` : ""}
            </Text>
            <View style={styles.rideListingSuccessFacts}>
              <Text style={styles.rideListingSuccessFact}>{ride?.pickupDate || "Date open"}</Text>
              <Text style={styles.rideListingSuccessFact}>{ride?.pickupTime || "Time open"}</Text>
              <Text style={styles.rideListingSuccessFact}>{ride?.seats || 1} seat{Number(ride?.seats || 1) === 1 ? "" : "s"}</Text>
            </View>
            <Text style={styles.rideListingSuccessCopy}>Your route is ready. Check matching rider requests, share the listing, or coordinate accepted riders in Chitthi.</Text>
            {ride ? (
              <TouchableOpacity style={styles.rideListingSuccessShare} onPress={() => void shareCarpoolListing(ride)} accessibilityRole="button" accessibilityLabel="Share carpool listing">
                <Text style={styles.rideListingSuccessShareText}>↗ Share listing</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.rideListingSuccessPrimary} onPress={viewSuccessfulRideListing}>
              <Text style={styles.rideListingSuccessPrimaryText}>Search matching riders</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rideListingSuccessSecondary} onPress={closeRideListingSuccess}>
              <Text style={styles.rideListingSuccessSecondaryText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  function renderRideOnly() {
    const activeService = rideServicePosters.find((item) => item.key === selectedRideService && item.available) || rideServicePosters.find((item) => item.key === "carpool") || rideServicePosters[0];
    const rideActiveLocation = currentRideLocation?.label || discoveryLocation || data?.location.city || "";
    const rideActiveCountry = locationCountryCodeFromLabel(rideActiveLocation);
    const rideHomeCities = rideActiveCountry
      ? ridePopularPlaces.filter((place) => {
          const placeCountry = locationCountryCodeFromLabel(`${place.label} ${place.main || ""} ${place.secondary || ""}`);
          return placeCountry === rideActiveCountry;
        })
      : ridePopularPlaces;
    const visibleRideHomeCities = rideHomeCities.length
      ? rideHomeCities
      : rideActiveCountry === "IN" ? indiaRidePopularCities
      : rideActiveCountry === "US" ? usRidePopularCities
      : [];
    const ridePopularCardWidth = Math.max(
      108,
      Math.min(132, (viewportWidth - 28 - 20) / 3)
    );
    const rideHowItWorks = [
      { title: "Search or list", copy: "Find a ride or post your trip", icon: appAssets.carpoolStepMapPin, tint: "#ffdddd" },
      { title: "Match the route", copy: "Connect with verified users", icon: appAssets.carpoolStepPeopleCheck, tint: "#dcecff" },
      { title: "Confirm in Chitthi", copy: "Chat, plan and ride together", icon: appAssets.carpoolStepChat, tint: "#dff7ea" }
    ];
    const renderRideGlyph = (glyph: (typeof rideServicePosters)[number]["glyph"], small = false) => (
      <View style={[styles.rideGlyphWrap, small && styles.rideGlyphWrapSmall]}>
        {glyph === "scheduled" ? (
          <>
            <View style={[styles.rideGlyphCalendar, small && styles.rideGlyphCalendarSmall]}>
              <View style={styles.rideGlyphCalendarTop} />
              <View style={styles.rideGlyphGrid}>
                {[0, 1, 2, 3].map((dot) => (
                  <View key={dot} style={styles.rideGlyphDot} />
                ))}
              </View>
            </View>
            <View style={[styles.rideGlyphClock, small && styles.rideGlyphClockSmall]} />
          </>
        ) : (
          <>
            {glyph === "carpool" ? (
              <View style={styles.rideGlyphPeople}>
                {[0, 1, 2].map((dot) => (
                  <View key={dot} style={[styles.rideGlyphPerson, small && styles.rideGlyphPersonSmall]} />
                ))}
              </View>
            ) : null}
            <View style={[styles.rideGlyphCarTop, small && styles.rideGlyphCarTopSmall]} />
            <View style={[styles.rideGlyphCarBody, small && styles.rideGlyphCarBodySmall]} />
            <View style={styles.rideGlyphWheelRow}>
              <View style={[styles.rideGlyphWheel, small && styles.rideGlyphWheelSmall]} />
              <View style={[styles.rideGlyphWheel, small && styles.rideGlyphWheelSmall]} />
            </View>
          </>
        )}
      </View>
    );
    return (
      <>
        <View style={[styles.rideTopShowcase, isLight && styles.rideTopShowcaseLight, { marginTop: -14, marginHorizontal: -14 }]}>
          <Image source={appAssets.carpoolWideHero} style={styles.rideTravelHero} resizeMode="cover" />
          <View style={[styles.rideDriverCta, isLight && styles.rideDriverCtaLight]}>
          <View style={styles.rideDriverCtaHeader}>
            <View style={styles.rideDriverCtaCopy}>
              <Text style={styles.rideDriverCtaTitle} numberOfLines={1}>Find or offer a ride</Text>
              <Text style={styles.rideDriverCtaText} numberOfLines={1}>Choose how you want to carpool</Text>
            </View>
            <Image source={appAssets.carpoolHeroRiders} style={styles.rideDriverCtaPeople} resizeMode="contain" />
          </View>
          <View style={styles.ridePrimaryActions}>
            <TouchableOpacity style={[styles.rideFindButton, isLight && styles.rideActionLight, Platform.OS === "android" && styles.rideFindButtonAndroid]} activeOpacity={0.84} onPress={openRidePlanner}>
              {Platform.OS === "android" ? <Text style={styles.rideActionEmojiAndroid}>🔎</Text> : <Image source={appAssets.carpoolFindRide} style={styles.rideActionIcon} resizeMode="contain" />}
              <View style={[styles.rideActionCopy, Platform.OS === "android" && styles.rideActionCopyAndroid, Platform.OS === "android" && styles.rideFindActionCopyAndroid]}>
                <Text style={styles.rideFindButtonText} numberOfLines={1}>Find a ride</Text>
                <Text style={styles.rideActionSubtext}>Travel smarter</Text>
              </View>
              <Text style={styles.rideFindArrow}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.rideOfferButton, isLight && styles.rideActionLight, Platform.OS === "android" && styles.rideOfferButtonAndroid]} activeOpacity={0.84} onPress={() => startRideOfferListing()}>
              {Platform.OS === "android" ? <Text style={styles.rideActionEmojiAndroid}>🚗</Text> : <Image source={appAssets.carpoolOfferRide} style={styles.rideActionIcon} resizeMode="contain" />}
              <View style={[styles.rideActionCopy, Platform.OS === "android" && styles.rideActionCopyAndroid, Platform.OS === "android" && styles.rideOfferActionCopyAndroid]}>
                <Text style={styles.rideOfferButtonText} numberOfLines={1}>Offer a ride</Text>
                <Text style={[styles.rideActionSubtext, styles.rideOfferSubtext]} numberOfLines={1}>Share your journey</Text>
              </View>
              <Text style={styles.rideOfferArrow}>›</Text>
            </TouchableOpacity>
          </View>
          </View>
        </View>

        <View style={styles.ridePopularSection}>
          <View style={styles.ridePopularHeader}>
            <Text style={styles.ridePopularTitle}>Popular destinations</Text>
            <TouchableOpacity onPress={openRidePlanner} activeOpacity={0.75}>
              <Text style={styles.ridePopularViewAll}>View all ›</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ridePopularList}>
            {visibleRideHomeCities.map((place, index) => (
              <TouchableOpacity key={place.label} style={[styles.ridePopularCard, isLight && styles.ridePopularCardLight, styles.ridePopularCityTile, { width: ridePopularCardWidth, backgroundColor: ["#123c31", "#1d3048", "#3b2f22", "#2d2945"][index % 4] }]} activeOpacity={0.84} onPress={() => openRidePlannerWithSuggestion(place)}>
                {place.imageUrl && !failedRidePopularImages[place.imageUrl] ? (
                  <Image
                    source={{ uri: absoluteAssetUrl(place.imageUrl) }}
                    style={styles.ridePopularImage}
                    resizeMode="cover"
                    onError={() => setFailedRidePopularImages((current) => ({ ...current, [place.imageUrl || place.label]: true }))}
                  />
                ) : (
                  <Image source={bundledRideCityImage(place)} style={styles.ridePopularImage} resizeMode="cover" />
                )}
                <View style={styles.ridePopularShade} />
                <View style={styles.ridePopularCityRow}>
                  <Image source={appAssets.carpoolDestinationPin} style={styles.ridePopularPin} resizeMode="contain" />
                  <Text style={styles.ridePopularCity} numberOfLines={1}>{place.main}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={[styles.rideServiceDetail, isLight && styles.rideServiceDetailLight]}>
          <View style={styles.rideSimpleHeader}>
            <View>
              <Text style={styles.rideServiceDetailLabel}>CARPOOL</Text>
              <Text style={styles.rideServiceDetailTitle}>How it works</Text>
            </View>
            <View style={styles.rideSimpleTrustPill}>
              <Image source={appAssets.carpoolTrustLeaf} style={styles.rideSimpleTrustIcon} resizeMode="contain" />
              <Text style={styles.rideSimpleTrust}>Safe · Simple · Shared</Text>
            </View>
          </View>
          <View style={styles.rideSimpleSteps}>
            {rideHowItWorks.map((step, index) => (
              <View key={step.title} style={[styles.rideSimpleStep, isLight && styles.rideSimpleStepLight]}>
                <View style={[styles.rideServiceStepDot, { backgroundColor: step.tint }]}><Text style={styles.rideServiceStepDotText}>{index + 1}</Text></View>
                <Image source={step.icon} style={styles.rideSimpleStepIcon} resizeMode="contain" />
                <Text style={styles.rideSimpleStepText}>{step.title}</Text>
                <Text style={styles.rideSimpleStepCopy}>{step.copy}</Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity style={[styles.rideSharingBanner, isLight && styles.rideSharingBannerLight]} activeOpacity={0.86} onPress={openRidePlanner}>
          <Image source={appAssets.carpoolRideSharingBanner} style={styles.rideSharingBannerImage} resizeMode="stretch" />
        </TouchableOpacity>
      </>
    );
  }

  function renderQuickLinks() {
    return (
      <View style={[styles.quickHero, isLight && styles.quickHeroLight]}>
        <Text style={styles.quickPill}>Quick links</Text>
        <Text style={[styles.quickHeaderTitle, isLight && styles.quickHeaderTitleLight]}>
          Find rides, rentals, and roommate options <Text style={[styles.quickTitleAccent, isLight && styles.quickTitleAccentLight]}>wherever you are.</Text>
        </Text>
        <Text style={styles.quickAnimatedWord}>
          {quickLinkAnimatedWord}
          <Text style={styles.quickCursor}>|</Text>
        </Text>
        <View style={styles.quickTextList}>
          {quickLinks.map((link) => (
            <TouchableOpacity key={link.key} activeOpacity={0.82} style={styles.quickTextLink} onPress={() => openQuickLink(link.key)}>
              <View style={[styles.quickTextDot, { backgroundColor: link.accent }]} />
              <Text style={[styles.quickTextTitle, isLight && styles.quickTextTitleLight]}>{link.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  function renderSegmentIcon(kind: "housing" | "ride" | "rental", active: boolean) {
    const color = active ? theme.colors.text : kind === "rental" ? "#f4aa2f" : theme.colors.soft;
    if (kind === "housing") {
      return (
        <View style={styles.segmentHouseIcon}>
          <View style={[styles.segmentHouseRoof, { borderColor: color }]} />
          <View style={[styles.segmentHouseBody, { borderColor: color }]}>
            <View style={[styles.segmentHouseDoor, { backgroundColor: color }]} />
          </View>
        </View>
      );
    }
    return (
      <View style={styles.segmentCarIcon}>
        <View style={[styles.segmentCarCabin, { borderColor: color }]} />
        <View style={[styles.segmentCarBody, { borderColor: color }]} />
        <View style={styles.segmentCarWheels}>
          <View style={[styles.segmentCarWheel, { backgroundColor: color }]} />
          <View style={[styles.segmentCarWheel, { backgroundColor: color }]} />
        </View>
      </View>
    );
  }

  function renderHousingIntentIcon(type: "house" | "people" | "car", color: string) {
    if (type === "people") {
      return (
        <View style={styles.intentPeopleIcon}>
          <View style={[styles.intentPersonHead, styles.intentPersonHeadLeft, { backgroundColor: color }]} />
          <View style={[styles.intentPersonHead, styles.intentPersonHeadRight, { backgroundColor: color }]} />
          <View style={[styles.intentPersonBody, styles.intentPersonBodyLeft, { backgroundColor: color }]} />
          <View style={[styles.intentPersonBody, styles.intentPersonBodyRight, { backgroundColor: color }]} />
        </View>
      );
    }
    if (type === "car") {
      return (
        <View style={styles.intentCarSolidIcon}>
          <View style={[styles.intentCarSolidTop, { borderBottomColor: color }]} />
          <View style={[styles.intentCarSolidBody, { backgroundColor: color }]} />
          <View style={[styles.intentCarSolidLight, styles.intentCarSolidLightLeft]} />
          <View style={[styles.intentCarSolidLight, styles.intentCarSolidLightRight]} />
          <View style={[styles.intentCarSolidWheel, styles.intentCarSolidWheelLeft]} />
          <View style={[styles.intentCarSolidWheel, styles.intentCarSolidWheelRight]} />
        </View>
      );
    }
    return (
      <View style={styles.intentHouseIcon}>
        <View style={[styles.intentHouseRoof, { borderBottomColor: color }]} />
        <View style={[styles.intentHouseBody, { backgroundColor: color }]}>
          <View style={styles.intentHouseDoor} />
        </View>
      </View>
    );
  }

  return (
    <>
    <Modal visible={rideEditorLoading} transparent animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
      <View style={styles.rideEditorLoadingBackdrop} accessibilityRole="progressbar">
        <View style={styles.rideEditorLoadingCard}>
          <ActivityIndicator size="large" color={theme.colors.brand} />
          <Text style={styles.rideEditorLoadingTitle}>Opening your ride…</Text>
          <Text style={styles.rideEditorLoadingCopy}>Loading the latest route and trip details.</Text>
        </View>
      </View>
    </Modal>
    {renderRideListingSuccess()}
    {renderRideOwnerTracker()}
    {renderRentalOwnerModal()}
    <Modal visible={exportsInfoOpen} transparent animationType="fade" onRequestClose={() => setExportsInfoOpen(false)}>
      <View style={styles.exportsInfoBackdrop}>
        <View style={styles.exportsInfoModal}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.exportsInfoContent}>
            <View style={styles.exportsInfoHeader}>
              <View style={[styles.exportsInfoIcon, exportsInterestError && styles.exportsInfoIconError]}><Text style={styles.exportsInfoIconText}>{exportsInterestError ? "!" : exportsInterestSent ? "✓" : "↻"}</Text></View>
              <View style={styles.exportsInfoHeadingCopy}>
                <Text style={[styles.exportsInfoEyebrow, exportsInterestError && styles.exportsInfoEyebrowError]}>{exportsInterestError ? "Interest not recorded" : exportsInterestSent ? "Interest recorded" : "Recording your interest"}</Text>
                <Text style={styles.exportsInfoTitle}>Exports &amp; Imports</Text>
              </View>
              <TouchableOpacity accessibilityLabel="Close export and import information" style={styles.exportsInfoClose} onPress={() => setExportsInfoOpen(false)}>
                <Text style={styles.exportsInfoCloseText}>×</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.exportsInfoLead}>Thank you for your interest. We are exploring secure air, sea, and land shipping between India and international destinations.</Text>

            {exportsInterestError ? (
              <View style={styles.exportsInfoErrorNotice}>
                <Text style={styles.exportsInfoErrorTitle}>We could not save your interest yet</Text>
                <Text style={styles.exportsInfoErrorCopy}>{exportsInterestError}</Text>
                <TouchableOpacity style={styles.exportsInfoRetryButton} onPress={showExportsInterest}>
                  <Text style={styles.exportsInfoRetryText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : exportsInterestBusy ? <Text style={styles.exportsInfoSaving}>Saving your interest…</Text> : null}

            <View style={styles.exportsInfoNotice}>
              <Text style={styles.exportsInfoNoticeTitle}>Customs-accepted items only</Text>
              <Text style={styles.exportsInfoNoticeCopy}>Every shipment would require item details and may need invoices, identity documents, permits, duties, or destination-specific paperwork. Final acceptance depends on customs, the carrier, and the destination country.</Text>
            </View>

            <Text style={styles.exportsInfoSectionTitle}>Items commonly considered</Text>
            <Text style={styles.exportsInfoBody}>• Clothing, books, household goods and personal belongings{`\n`}• Documents, gifts and packaged non-perishable products{`\n`}• Business samples, spare parts and approved commercial goods</Text>

            <Text style={styles.exportsInfoSectionTitle}>Restricted or prohibited examples</Text>
            <Text style={styles.exportsInfoBody}>Weapons, explosives, illegal substances, undeclared cash, hazardous chemicals, counterfeit goods, certain batteries, medicines, foods, plants, seeds and animal products may be restricted or prohibited. Some items require special permits or specialist carriers.</Text>

            <Text style={styles.exportsInfoFootnote}>This is an early service preview—not a shipping quote or acceptance guarantee. FairFares will publish supported routes, item rules, pricing, insurance and customs requirements before launch.</Text>

            <TouchableOpacity style={styles.exportsInfoDoneButton} onPress={() => setExportsInfoOpen(false)}>
              <Text style={styles.exportsInfoDoneText}>Got it</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
    <ScrollView
      ref={scrollRef}
      style={[styles.screen, { backgroundColor: topOverscrollBackground }]}
      contentContainerStyle={[
        styles.content,
        { backgroundColor: theme.colors.bg },
        { paddingBottom: layout.navClearance },
        layout.isTablet && { maxWidth: layout.contentMaxWidth, width: "100%", alignSelf: "center" }
      ]}
      stickyHeaderIndices={mode === "cheapCars" ? [0] : []}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={32}
      onScroll={(event) => updateScrollVisibility(event.nativeEvent.contentOffset.y)}
    >
        {mode === "cheapCars" ? <View style={[styles.stickySearch, isLight && styles.stickySearchLight, searchIsScrolled && styles.stickySearchRaised, isLight && searchIsScrolled && styles.stickySearchRaisedLight]}>
          {Platform.OS === "ios" ? (
            <BlurView
              pointerEvents="none"
              tint={isLight ? "light" : "dark"}
              intensity={searchIsScrolled ? 62 : 18}
              style={styles.stickySearchBlur}
            />
          ) : null}
          {Platform.OS === "ios" && searchIsScrolled ? (
            <BlurView
              pointerEvents="none"
              tint={isLight ? "light" : "dark"}
              intensity={34}
              style={styles.stickySearchUnderBlur}
            />
          ) : null}
          <TouchableOpacity style={[styles.searchBar, isLight && styles.searchBarLight]} onPress={onOpenSearch}>
            <Image source={appAssets.search} style={styles.searchIcon} resizeMode="contain" />
            <Text style={[styles.searchText, isLight && styles.searchTextLight]} numberOfLines={1}>{searchBarText}</Text>
            <View style={[styles.searchAction, isLight && styles.searchActionLight]}>
              <Text style={[styles.searchActionText, isLight && styles.searchActionTextLight]}>Search</Text>
            </View>
          </TouchableOpacity>
        </View> : null}

      {mode === "cheapCars" ? renderRentalCarsOnly() : mode === "ride" ? renderRideOnly() : (
        <>

      <View
        style={styles.housingLanding}
        onLayout={(event) => {
          setWelcomeY(event.nativeEvent.layout.y);
        }}
      >
        <ImageBackground source={appAssets.housingWideHero} style={styles.housingHero} imageStyle={styles.housingHeroImage} resizeMode="cover">
          <TouchableOpacity style={styles.housingHeroSearchHotspot} onPress={onOpenSearch} activeOpacity={0.82} accessibilityRole="button" accessibilityLabel="Search housing by city or area">
            <View style={styles.housingHeroSearchPin}><Text style={styles.housingHeroSearchPinText}>⌖</Text></View>
            <Text style={styles.housingHeroSearchText} numberOfLines={1}>Where do you want to live?</Text>
            <View style={styles.housingHeroSearchButton}><Text style={styles.housingHeroSearchButtonText}>⌕ Search</Text></View>
          </TouchableOpacity>
          <View style={styles.housingHeroReviewPanel} pointerEvents="none">
            <View style={styles.housingHeroReviewIcon}><Text style={styles.housingHeroReviewIconText}>🤝</Text></View>
            <View style={styles.housingHeroReviewCopy}>
              <Text style={styles.housingHeroReviewTitle}>Renters & owners</Text>
              <Text style={styles.housingHeroReviewRating}>Rate each other</Text>
              <Text style={styles.housingHeroReviewMeta}>See ratings before you connect.</Text>
            </View>
            <View style={styles.housingHeroRatingGroup}>
              <Text style={styles.housingHeroRatingLabel}>Renter rating</Text>
              <Text style={styles.housingHeroRatingValue}>⭐ 4.7</Text>
              <Text style={styles.housingHeroRatingReviews}>(320 reviews)</Text>
            </View>
            <View style={styles.housingHeroRatingGroup}>
              <Text style={styles.housingHeroRatingLabel}>Owner rating</Text>
              <Text style={styles.housingHeroRatingValue}>🏠 4.8</Text>
              <Text style={styles.housingHeroRatingReviews}>(440 reviews)</Text>
            </View>
          </View>
        </ImageBackground>
        <View style={styles.housingIntentHeader}>
          <Text style={styles.housingIntentHeading}>What would you like to do?</Text>
          <TouchableOpacity style={styles.housingIntentViewAll} onPress={onOpenSearch} accessibilityRole="button" accessibilityLabel="View all housing listings">
            <Text style={styles.housingIntentViewAllText}>View all</Text>
            <Text style={styles.housingIntentViewAllArrow}>›</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.housingIntentGrid}>
          {housingIntentCards.map((item) => {
            const active = selectedNeed === item.value;
            return (
              <TouchableOpacity
                key={item.value}
                style={[styles.housingIntentCard, { backgroundColor: item.background }, active && styles.housingIntentCardActive, active && { borderColor: item.accent }]}
                activeOpacity={0.82}
                onPress={() => {
                  if (item.value === "ride_need") {
                    onNeedSelect("ride_need");
                    setMode("ride");
                    return;
                  }
                  onNeedSelect(item.value);
                  onPostNeed(item.value);
                }}
                accessibilityRole="button"
                accessibilityLabel={item.title}
              >
                <Image source={item.preview} style={styles.housingIntentPreview} resizeMode="cover" />
                <View style={[styles.housingIntentWash, { backgroundColor: item.background }]} />
                <View style={[styles.housingIntentIconBubble, { backgroundColor: `${item.accent}20` }]}>
                  {renderHousingIntentIcon(item.icon, item.accent)}
                </View>
                <View style={styles.housingIntentCopy}>
                  <Text style={styles.housingIntentTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.housingIntentSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                </View>
                <View style={styles.housingIntentArrow}><Text style={styles.housingIntentArrowText}>›</Text></View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Modal visible={cityExperienceModalOpen} transparent animationType="fade" onRequestClose={() => setCityExperienceModalOpen(false)}>
        <KeyboardAvoidingView style={styles.cityExperienceModalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCityExperienceModalOpen(false)} />
          <View style={styles.cityExperienceModalCard}>
            <View style={styles.cityExperienceModalHeader}>
              <View>
                <Text style={styles.cityExperienceEyebrow}>Community experience</Text>
                <Text style={styles.cityExperienceModalTitle}>Rate your search</Text>
              </View>
              <TouchableOpacity style={styles.cityExperienceModalClose} onPress={() => setCityExperienceModalOpen(false)} accessibilityLabel="Close review">
                <Text style={styles.cityExperienceModalCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.cityExperienceProfileRow}>
              <View style={styles.cityExperienceAvatar}>
                {data?.user?.profilePhotoUrl ? (
                  <UserAvatar photoUrl={data.user.profilePhotoUrl} imageStyle={styles.cityExperienceAvatarImage} fallback={<Text style={styles.cityExperienceAvatarInitials}>{cityExperienceInitials || "FF"}</Text>} />
                ) : <Text style={styles.cityExperienceAvatarInitials}>{cityExperienceInitials || "FF"}</Text>}
              </View>
              <View style={styles.cityExperienceProfileCopy}>
                <Text style={styles.cityExperienceName}>{data?.user?.name || "FairFares member"}</Text>
                <Text style={styles.cityExperienceCity}>📍 {cityExperienceLocation}</Text>
              </View>
            </View>
            <View style={styles.cityExperienceStars}>
              {[1, 2, 3, 4, 5].map((rating) => (
                <TouchableOpacity key={rating} style={styles.cityExperienceStarButton} onPress={() => { setCityExperienceRating(rating); setCityExperienceStatus(""); }} accessibilityLabel={`${rating} stars`}>
                  <Text style={[styles.cityExperienceStar, rating <= cityExperienceRating && styles.cityExperienceStarActive]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput value={cityExperienceText} onChangeText={(value) => { setCityExperienceText(value.slice(0, 300)); setCityExperienceStatus(""); }} placeholder={`What was searching in ${cityExperienceLocation} like?`} placeholderTextColor="#718096" multiline maxLength={300} style={styles.cityExperienceInput} textAlignVertical="top" />
            {cityExperienceStatus ? <Text style={styles.cityExperienceStatus}>{cityExperienceStatus}</Text> : null}
            <View style={styles.cityExperienceSubmitRow}>
              <Text style={styles.cityExperienceCount}>{cityExperienceText.length}/300</Text>
              <TouchableOpacity style={[styles.cityExperienceSubmit, cityExperienceBusy && styles.cityExperienceSubmitDisabled]} onPress={shareCityExperience} disabled={cityExperienceBusy}>
                <Text style={styles.cityExperienceSubmitText}>{cityExperienceBusy ? "Sharing…" : "Share experience"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {showSearchResults ? <>
      <View style={styles.listingSectionHeader} onLayout={(event) => {
        const nextY = event.nativeEvent.layout.y;
        setListingResultsY((current) => Math.abs(current - nextY) > 1 ? nextY : current);
      }}>
        <Text numberOfLines={2} style={styles.listingSectionTitle}>Rooms for rent in {data?.location.city || discoveryLocation || "your current city"}</Text>
        <TouchableOpacity style={styles.filterHeader} onPress={() => setFiltersOpen((value) => !value)}>
          <Text style={styles.filterGlyph}>☷</Text>
          <Text style={styles.filterHeaderTitle}>Filters</Text>
        </TouchableOpacity>
      </View>
      {filtersOpen ? <View style={styles.filterPanel}>
        <Text style={styles.filterHeaderMeta}>
          {selectedCategory ? roomTypes.find((type) => type.category === selectedCategory)?.label : "Room type"} · {selectedGender || "Any"} · {selectedBudget ? `$${selectedBudget}` : "Any budget"}
        </Text>
        {filtersOpen ? (
          <>
            <Text style={styles.filterTitle}>Sort by</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {sortOptions.map((option) => (
                <TouchableOpacity key={option.value} style={[styles.filterChip, selectedSort === option.value && styles.filterChipActive]} onPress={() => onSortSelect(option.value)}>
                  <Text style={[styles.filterChipText, selectedSort === option.value && styles.filterChipTextActive]}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.filterTitle}>Room type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              <TouchableOpacity style={[styles.filterChip, !selectedCategory && styles.filterChipActive]} onPress={() => onCategorySelect("")}>
                <Text style={[styles.filterChipText, !selectedCategory && styles.filterChipTextActive]}>Any</Text>
              </TouchableOpacity>
              {roomTypes.map((type) => (
                <TouchableOpacity key={type.category} style={[styles.filterChip, selectedCategory === type.category && styles.filterChipActive]} onPress={() => onCategorySelect(selectedCategory === type.category ? "" : type.category)}>
                  <Text style={[styles.filterChipText, selectedCategory === type.category && styles.filterChipTextActive]}>{type.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.filterTitle}>Preference</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {genderOptions.map((option) => {
                const value = option === "Any" ? "" : option;
                return (
                  <TouchableOpacity key={option} style={[styles.filterChip, selectedGender === value && styles.filterChipActive]} onPress={() => onGenderSelect(value)}>
                    <Text style={[styles.filterChipText, selectedGender === value && styles.filterChipTextActive]}>{option}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.filterTitle}>Budget</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {[null, ...budgetValues].map((amount) => {
                const option = amount === null ? "Any" : `${housingCurrencySymbol}${amount.toLocaleString()}`;
                const value = amount === null ? "" : String(amount);
                return (
                  <TouchableOpacity key={option} style={[styles.filterChip, selectedBudget === value && styles.filterChipActive]} onPress={() => onBudgetSelect(value)}>
                    <Text style={[styles.filterChipText, selectedBudget === value && styles.filterChipTextActive]}>{option}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        ) : null}
      </View> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.housingCardRow} snapToInterval={housingCardWidth + 10} decelerationRate="fast">
        {sortedPosts.length ? (
          <>
            {(hasExactLocationSearch ? sortedPosts : sortedPosts.slice(0, 3)).map(renderHousingPostCard)}
            {sortedPosts.length >= 3 && !hasExactLocationSearch ? (
              <TouchableOpacity
                activeOpacity={0.88}
                style={[styles.exactLocationCard, { width: housingPosterWidth, height: housingCardHeight }]}
                onPress={onOpenSearch}
                accessibilityRole="button"
                accessibilityLabel="Search housing listings for an exact location"
              >
                <Image source={appAssets.housingSearchPoster} style={styles.exactLocationPoster} resizeMode="cover" />
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No matching housing posts yet.</Text>
            <Text style={styles.emptyText}>Try another area near {data?.location.city || discoveryLocation || "your current city"}, or create the first post.</Text>
          </View>
        )}
      </ScrollView>
      {neighborhoodBars.length ? (
        <View style={styles.neighborhoodPanel}>
          <View style={styles.neighborhoodHeader}>
            <View style={styles.neighborhoodHeaderCopy}>
              <Text style={styles.neighborhoodTitle}>Average rents in {neighborhoodCityName} neighborhoods</Text>
              <Text style={styles.neighborhoodMeta}>Typical monthly rent · Updated Sep 2026</Text>
            </View>
            <TouchableOpacity style={styles.neighborhoodViewAll} onPress={onOpenSearch} accessibilityRole="button" accessibilityLabel="View all neighborhoods">
              <Text style={styles.neighborhoodViewAllText}>View all</Text>
              <Text style={styles.neighborhoodViewAllArrow}>›</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.neighborhoodGraphRow}>
            {neighborhoodBars.map((locality, index) => (
              <TouchableOpacity key={`${locality.name}-${index}`} style={styles.neighborhoodGraphItem} onPress={() => onAreaSelect(locality.name)} activeOpacity={0.86}>
                <Text style={[styles.neighborhoodRent, { color: locality.color }]}>{locality.rentLabel}</Text>
                <View style={styles.neighborhoodBarWrap}>
                  <View style={[styles.neighborhoodBar, { height: locality.height, backgroundColor: locality.color }]}>
                    <Image source={locality.image} style={styles.neighborhoodBarImage} resizeMode="cover" />
                  </View>
                </View>
                <Text style={styles.neighborhoodName} numberOfLines={2}>{cleanLocalityName(locality.name, neighborhoodCityName) || locality.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.neighborhoodFindCard} onPress={onOpenSearch} activeOpacity={0.86}>
              <Text style={styles.neighborhoodFindText}>Find your neighborhood</Text>
              <Text style={styles.neighborhoodFindIcon}>⌕</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      ) : null}
      </> : null}

      <View style={styles.rentalSectionHeader}>
        <View style={styles.rentalSectionCopy}>
          <Text style={styles.rentalSectionEyebrow}>FairFares car rentals</Text>
          <Text style={styles.rentalSectionTitle}>Cheap car rentals</Text>
        </View>
        <TouchableOpacity style={styles.rentalSectionAction} onPress={() => setMode("cheapCars")} activeOpacity={0.78} accessibilityRole="button" accessibilityLabel="View rental cars">
          <Text style={styles.rentalSectionActionText}>View cars</Text>
          <Text style={styles.rentalSectionArrow}>→</Text>
        </TouchableOpacity>
      </View>
      <RentalPromoCarousel onPress={() => setMode("cheapCars")} />
      <SectionHeader title="Exports & Imports" />
      <View style={[styles.exportsImportsCard, isLight && styles.exportsImportsCardLight]}>
        <View style={styles.exportsImportsImageFrame}>
          <Image source={appAssets.exportsImportsPromo} style={styles.exportsImportsImage} resizeMode="contain" />
        </View>
        <View style={styles.exportsImportsCopy}>
          <View style={styles.exportsImportsBadge}>
            <Text style={styles.exportsImportsBadgeText}>Coming soon</Text>
          </View>
          <Text style={[styles.exportsImportsTitle, isLight && styles.exportsImportsTitleLight]}>Move goods between India and the world</Text>
          <Text style={[styles.exportsImportsMeta, isLight && styles.exportsImportsMetaLight]}>Interested in safe import and export support? Show your interest and help us bring this service sooner.</Text>
          <TouchableOpacity
            activeOpacity={0.84}
            style={[styles.exportsImportsButton, exportsInterestSent && styles.exportsImportsButtonSent]}
            onPress={showExportsInterest}
            disabled={exportsInterestBusy}
          >
            <Text style={[styles.exportsImportsButtonText, exportsInterestSent && styles.exportsImportsButtonTextSent]}>
              {exportsInterestSent ? "✓ Interest recorded · View details" : exportsInterestBusy ? "Recording..." : "I'm interested"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      {renderQuickLinks()}
        </>
      )}
      <Modal visible={Boolean(detailPost)} transparent animationType={linkedDetailPresentation ? "none" : "fade"} onRequestClose={closeHousingDetail}>
        <View style={styles.detailBackdrop}>
          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailEyebrow}>Housing details</Text>
              <TouchableOpacity style={styles.detailClose} onPress={closeHousingDetail} accessibilityRole="button" accessibilityLabel="Close housing details">
                <Text style={styles.detailCloseText}>X</Text>
              </TouchableOpacity>
            </View>
            {detailPost ? (
              <ScrollView
                ref={detailScrollRef}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.detailContent}
                scrollEventThrottle={64}
                onContentSizeChange={(_width, height) => setDetailCanScrollMore(height > 560)}
                onScroll={(event) => {
                  const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
                  detailScrollOffsetRef.current = Math.max(0, contentOffset.y);
                  const nextCanScrollMore = contentOffset.y + layoutMeasurement.height < contentSize.height - 36;
                  setDetailCanScrollMore((current) => current === nextCanScrollMore ? current : nextCanScrollMore);
                }}
              >
                <Text style={styles.detailTitle}>{detailPost.title}</Text>
                <Text style={styles.detailMeta}>{detailPost.addressLabel || detailPost.location}</Text>
                <View style={styles.detailDescriptionCard}>
                  <Text style={styles.detailSectionTitle}>Description</Text>
                  <Text style={styles.detailDescription}>{detailPost.description || "No description yet."}</Text>
                </View>
                {detailImages.length ? (
                  <View style={styles.detailCarouselWrap} onLayout={handleDetailCarouselLayout}>
                    <ScrollView
                      ref={detailCarouselRef}
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      style={styles.detailCarousel}
                      onMomentumScrollEnd={(event) => setDetailImageIndex(Math.round(event.nativeEvent.contentOffset.x / detailImageWidth))}
                    >
                      {detailImages.map((image, index) => {
                        const uri = absoluteAssetUrl(image);
                        const loadError = Boolean(detailImageErrors[uri]);
                        return (
                          <TouchableOpacity key={`${image}-${index}`} activeOpacity={0.92} onPress={() => openDetailPreviewImage(index)} accessibilityRole="imagebutton" accessibilityLabel="Open housing photo full screen">
                            <View style={[styles.detailImageFrame, { width: detailImageWidth }]}>
                              <Image
                                source={{ uri }}
                                style={styles.detailImage}
                                resizeMode="cover"
                                onError={() => markDetailImageError(uri)}
                              />
                              {loadError ? (
                                <View pointerEvents="none" style={styles.detailImageLoading}>
                                  <Text style={styles.detailImageErrorText}>Photo unavailable</Text>
                                </View>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    {detailImages.length > 1 ? (
                      <>
                        <View style={styles.detailImageDots}>
                          {detailImages.map((image, index) => (
                            <View key={`${image}-dot-${index}`} style={[styles.detailImageDot, index === detailImageIndex && styles.detailImageDotActive]} />
                          ))}
                        </View>
                        <TouchableOpacity
                          style={styles.detailImageNext}
                          onPress={showNextDetailImage}
                          activeOpacity={0.78}
                          accessibilityRole="button"
                          accessibilityLabel="Show next housing photo"
                        >
                          <BlurView intensity={55} tint="dark" style={styles.detailImageNextGlass}>
                            <Text style={styles.detailImageNextText}>›</Text>
                          </BlurView>
                        </TouchableOpacity>
                      </>
                    ) : null}
                  </View>
                ) : (
                  renderDetailImageFallback(detailPost)
                )}
                <TouchableOpacity style={[styles.detailMapCompact, isLight && styles.detailMapCompactLight]} onPress={() => openPostMap(detailPost)} activeOpacity={0.78} accessibilityRole="button" accessibilityLabel="Open housing location map">
                  <View style={[styles.detailMapIcon, isLight && styles.detailMapIconLight]}>
                    <Text style={styles.detailMapIconText}>⌖</Text>
                  </View>
                  <View style={styles.detailMapCopy}>
                    <Text style={[styles.detailMapTitle, isLight && styles.detailMapTitleLight]}>View on map</Text>
                    <Text style={[styles.detailMapText, isLight && styles.detailMapTextLight]} numberOfLines={1}>
                      {detailPost.locationApproximate
                        ? `Open ${detailPost.addressLabel || detailPost.streetAddress || detailPost.location} in maps`
                        : detailPost.distanceMiles !== null
                        ? `${detailPost.distanceMiles} mi from ${distanceReference || detailPost.location}`
                        : "Open location in maps"}
                    </Text>
                  </View>
                  <View style={[styles.detailMapArrow, isLight && styles.detailMapArrowLight]}><Text style={[styles.detailMapChevron, isLight && styles.detailMapChevronLight]}>›</Text></View>
                </TouchableOpacity>
                <View style={styles.detailInfoCard}>
                  <View style={styles.detailInfoRow}><Text style={styles.detailInfoLabel}>Type</Text><Text style={styles.detailInfoValue}>{detailPost.modeLabel}</Text></View>
                  <View style={styles.detailInfoRow}><Text style={styles.detailInfoLabel}>Category</Text><Text style={styles.detailInfoValue}>{detailPost.categoryLabel}</Text></View>
                  <View style={styles.detailInfoRow}><Text style={styles.detailInfoLabel}>Rent</Text><Text style={styles.detailInfoValue}>{detailPost.rent || "Open"}</Text></View>
                  <View style={styles.detailInfoRow}><Text style={styles.detailInfoLabel}>Move-in</Text><Text style={styles.detailInfoValue}>{detailPost.moveIn || "Open"}</Text></View>
                  <View style={styles.detailInfoRow}><Text style={styles.detailInfoLabel}>Bath</Text><Text style={styles.detailInfoValue}>{detailPost.bathroomType || "Open"}</Text></View>
                  <View style={styles.detailInfoRow}><Text style={styles.detailInfoLabel}>Lease</Text><Text style={styles.detailInfoValue}>{detailPost.leaseTerm || "Flexible"}</Text></View>
                  <View style={styles.detailInfoRow}><Text style={styles.detailInfoLabel}>Gender</Text><Text style={styles.detailInfoValue}>{detailPost.genderPreference || "Open"}</Text></View>
                  <View style={styles.detailInfoRow}><Text style={styles.detailInfoLabel}>Roommates</Text><Text style={styles.detailInfoValue}>{detailPost.roommateCount || "Open"}</Text></View>
                  {detailPost.accommodates ? <View style={styles.detailInfoRow}><Text style={styles.detailInfoLabel}>Accommodates</Text><Text style={styles.detailInfoValue}>{detailPost.accommodates}</Text></View> : null}
                  {detailPost.posterName ? <View style={styles.detailInfoRow}><Text style={styles.detailInfoLabel}>Posted by</Text><Text style={styles.detailInfoValue}>{detailPost.posterName}</Text></View> : null}
                </View>
                {detailPost.amenities?.length ? (
                  <View style={styles.detailAmenities}>
                    <Text style={styles.detailSectionTitle}>Amenities</Text>
                    <View style={styles.detailGrid}>
                      {detailPost.amenities.slice(0, 12).map((amenity) => <Text key={amenity} style={styles.detailFact}>{amenity}</Text>)}
                    </View>
                  </View>
                ) : null}
                <TouchableOpacity style={[styles.detailMessage, sentPostIds.includes(detailPost.id) && styles.detailMessageSent, detailPost.sample && styles.detailMessageDisabled, Number(detailPost.posterUserId) === Number(data?.user?.id || 0) && styles.detailManage]} onPress={() => Number(detailPost.posterUserId) === Number(data?.user?.id || 0) ? onManageHousingListing?.(detailPost) : !detailPost.sample && onMessage(detailPost)} disabled={detailPost.sample}>
                  <Text style={[styles.detailMessageText, Number(detailPost.posterUserId) === Number(data?.user?.id || 0) && styles.detailManageText]}>{detailPost.sample ? "Sample preview — no poster yet" : Number(detailPost.posterUserId) === Number(data?.user?.id || 0) ? "Edit listing" : sentPostIds.includes(detailPost.id) ? "✓ Message sent" : "Message"}</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : null}
            {detailPost && detailCanScrollMore ? (
              <TouchableOpacity
                style={styles.detailScrollHint}
                onPress={() => detailScrollRef.current?.scrollTo({ y: detailScrollOffsetRef.current + 280, animated: true })}
                accessibilityRole="button"
                accessibilityLabel="Scroll housing details down"
              >
                <Text style={styles.detailScrollHintText}>⌄</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {detailPreviewImage ? (
        <View style={styles.detailPhotoBackdrop}>
          <TouchableOpacity style={styles.detailPhotoClose} onPress={() => { setDetailPhotoScales({}); setDetailPreviewImage(""); }} accessibilityLabel="Close housing photo">
            <Text style={styles.detailPhotoCloseText}>×</Text>
          </TouchableOpacity>
          {detailPreviewImage ? (
            <>
              <ScrollView
                ref={detailPreviewCarouselRef}
                horizontal
                pagingEnabled
                scrollEnabled={detailPhotoScale === 1}
                style={styles.detailPhotoPager}
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(event) => {
                  const nextIndex = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, viewportWidth));
                  setDetailPreviewImageIndex(nextIndex);
                  if (detailImages[nextIndex]) setDetailPreviewImage(absoluteAssetUrl(detailImages[nextIndex]));
                }}
              >
                {detailImages.map((image, index) => (
                  <View
                    key={`${image}-preview-${index}`}
                    style={[styles.detailPhotoPage, { width: viewportWidth, height: detailPhotoHeight }]}
                  >
                      <Image
                        source={{ uri: absoluteAssetUrl(image) }}
                        style={[styles.detailPhotoFull, { width: viewportWidth, height: detailPhotoHeight, transform: [{ scale: detailPhotoScales[index] || 1 }] }]}
                        resizeMode="contain"
                      />
                  </View>
                ))}
              </ScrollView>
              <View style={styles.detailPhotoZoomControls}>
                <TouchableOpacity
                  style={[styles.detailPhotoZoomButton, detailPhotoScale <= 1 && styles.detailPhotoZoomButtonDisabled]}
                  disabled={detailPhotoScale <= 1}
                  onPress={() => setDetailPhotoScales((values) => ({ ...values, [detailPreviewImageIndex]: Math.max(1, (values[detailPreviewImageIndex] || 1) - 0.5) }))}
                  accessibilityLabel="Zoom housing photo out"
                >
                  <Text style={styles.detailPhotoZoomButtonText}>−</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.detailPhotoZoomValue} onPress={() => setDetailPhotoScales((values) => ({ ...values, [detailPreviewImageIndex]: 1 }))} accessibilityLabel="Reset housing photo zoom">
                  <Text style={styles.detailPhotoZoomValueText}>{Math.round(detailPhotoScale * 100)}%</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.detailPhotoZoomButton, detailPhotoScale >= 3 && styles.detailPhotoZoomButtonDisabled]}
                  disabled={detailPhotoScale >= 3}
                  onPress={() => setDetailPhotoScales((values) => ({ ...values, [detailPreviewImageIndex]: Math.min(3, (values[detailPreviewImageIndex] || 1) + 0.5) }))}
                  accessibilityLabel="Zoom housing photo in"
                >
                  <Text style={styles.detailPhotoZoomButtonText}>+</Text>
                </TouchableOpacity>
              </View>
              {detailImages.length > 1 ? (
                <>
                  <TouchableOpacity style={[styles.detailPhotoNav, styles.detailPhotoNavLeft]} onPress={() => showDetailPreviewImage(detailPreviewImageIndex - 1)} accessibilityLabel="Previous housing photo"><Text style={styles.detailPhotoNavText}>‹</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.detailPhotoNav, styles.detailPhotoNavRight]} onPress={() => showDetailPreviewImage(detailPreviewImageIndex + 1)} accessibilityLabel="Next housing photo"><Text style={styles.detailPhotoNavText}>›</Text></TouchableOpacity>
                  <View style={styles.detailPhotoDots}>
                    {detailImages.map((image, index) => <View key={`${image}-preview-dot-${index}`} style={[styles.detailPhotoDot, index === detailPreviewImageIndex && styles.detailPhotoDotActive]} />)}
                  </View>
                </>
              ) : null}
            </>
          ) : null}
        </View>
          ) : null}
        </View>
      </Modal>
    </ScrollView>
    {renderRidePlannerModal()}
    {renderPickerModal()}
    </>
  );
}

const styles = StyleSheet.create({
  rideEditorLoadingBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.68)", padding: 24 },
  rideEditorLoadingCard: { width: "100%", maxWidth: 360, minHeight: 170, alignItems: "center", justifyContent: "center", gap: 10, padding: 24, borderRadius: 24, borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", backgroundColor: "#111827" },
  rideEditorLoadingTitle: { color: "#f7f7f8", fontSize: 18, fontWeight: "900" },
  rideEditorLoadingCopy: { color: "#b6bac0", fontSize: 13, lineHeight: 18, textAlign: "center" },
  rideSuggestionLoading: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  rideOwnerLoadingCard: { minHeight: 160, alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.06)", padding: 20 },
  rideOwnerLoadingTitle: { color: "#f7f7f8", fontSize: 17, fontWeight: "900" },
  rideOwnerLoadingCopy: { color: "#b6bac0", fontSize: 13, lineHeight: 18, textAlign: "center" },
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 14, paddingBottom: 112, gap: 20 },
  stickySearch: { backgroundColor: "rgba(10,10,12,0.68)", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.line, overflow: "visible", zIndex: 20 },
  stickySearchLight: { backgroundColor: "#f3f4f6", borderBottomColor: "transparent" },
  stickySearchRaised: { borderBottomColor: "rgba(255,255,255,0.12)", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 9 },
  stickySearchRaisedLight: { borderBottomColor: "rgba(15,23,42,0.06)", shadowOpacity: 0.06, elevation: 2 },
  stickySearchBlur: { ...StyleSheet.absoluteFillObject },
  stickySearchUnderBlur: { position: "absolute", left: 0, right: 0, bottom: -16, height: 18, opacity: 0.72 },
  searchBar: { backgroundColor: "#222522", borderWidth: 1, borderColor: "rgba(239,189,104,0.4)", borderRadius: 26, minHeight: 52, paddingLeft: 15, paddingRight: 6, flexDirection: "row", alignItems: "center", gap: 10, shadowColor: "#efbd68", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  searchBarLight: { backgroundColor: "#ffffff", borderColor: "rgba(15,23,42,0.07)", shadowColor: "#14251f", shadowOpacity: 0.09, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: Platform.OS === "android" ? 0 : 3 },
  searchIcon: { width: 23, height: 23 },
  searchText: { color: "#ffffff", flex: 1, fontSize: 15, fontWeight: "800" },
  searchTextLight: { color: "#344054", fontWeight: "600" },
  searchAction: { minWidth: 88, minHeight: 40, backgroundColor: "rgba(239,189,104,0.18)", borderWidth: 1, borderColor: "rgba(239,189,104,0.3)", borderRadius: 20, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  searchActionLight: { backgroundColor: "#43d3a2", borderColor: "#43d3a2" },
  searchActionText: { color: "#f4dfb7", fontWeight: "800", fontSize: 12 },
  searchActionTextLight: { color: "#063f2f" },
  segmentHouseIcon: { width: 20, height: 20, alignItems: "center", justifyContent: "flex-end" },
  segmentHouseRoof: {
    position: "absolute",
    top: 2,
    width: 13,
    height: 13,
    borderLeftWidth: 2,
    borderTopWidth: 2,
    transform: [{ rotate: "45deg" }]
  },
  segmentHouseBody: {
    width: 15,
    height: 12,
    borderWidth: 2,
    borderTopWidth: 0,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    alignItems: "center",
    justifyContent: "flex-end"
  },
  segmentHouseDoor: { width: 4, height: 6, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  segmentCarIcon: { width: 22, height: 18, alignItems: "center", justifyContent: "flex-end" },
  segmentCarCabin: {
    width: 12,
    height: 7,
    borderWidth: 2,
    borderBottomWidth: 0,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4
  },
  segmentCarBody: { width: 19, height: 8, borderWidth: 2, borderRadius: 4, marginTop: -1 },
  segmentCarWheels: { width: 15, flexDirection: "row", justifyContent: "space-between", marginTop: -2 },
  segmentCarWheel: { width: 4, height: 4, borderRadius: 2 },
  quickHero: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(3,8,18,0.96)",
    padding: 14,
    gap: 9,
    overflow: "hidden"
  },
  quickHeroLight: { backgroundColor: "rgba(255,255,255,0.94)", borderColor: "rgba(255,255,255,0.8)", shadowColor: "#1c2735", shadowOpacity: 0.12, shadowRadius: 15, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  quickPill: {
    alignSelf: "flex-start",
    color: theme.colors.brand,
    backgroundColor: "rgba(24,184,132,0.18)",
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: "hidden",
    fontSize: 11,
    textTransform: "uppercase",
    fontWeight: "800"
  },
  quickHeaderTitle: { color: theme.colors.text, fontSize: 16, lineHeight: 21, fontWeight: "600", maxWidth: 300 },
  quickHeaderTitleLight: { color: "#111827" },
  quickTitleAccent: { color: "#15e1ba" },
  quickTitleAccentLight: { color: "#078a72" },
  quickAnimatedWord: { color: "#ff3d6e", fontSize: 20, lineHeight: 25, fontWeight: "700", letterSpacing: 0 },
  quickCursor: { color: theme.colors.text, fontWeight: "400" },
  quickTextList: { gap: 4, paddingTop: 0 },
  quickTextLink: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.22)",
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 9
  },
  quickTextDot: { width: 8, height: 8, borderRadius: 4 },
  quickTextTitle: { color: theme.colors.text, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  quickTextTitleLight: { color: "#1f2937" },
  exportsImportsCard: {
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "#071a12"
  },
  exportsImportsCardLight: { backgroundColor: "rgba(255,255,255,0.96)", borderColor: "rgba(255,255,255,0.8)", shadowColor: "#1c2735", shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 9 }, elevation: 6 },
  exportsImportsImageFrame: { width: "100%", aspectRatio: 1936 / 813, backgroundColor: "#06351f" },
  exportsImportsImage: { width: "100%", height: "100%" },
  exportsImportsCopy: { padding: 15, gap: 8 },
  exportsImportsBadge: {
    alignSelf: "flex-start",
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(255,190,0,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,190,0,0.46)",
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  exportsImportsBadgeText: { color: "#ffc329", fontSize: 11, lineHeight: 14, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  exportsImportsTitle: { color: theme.colors.text, fontSize: 19, lineHeight: 24, fontWeight: "700" },
  exportsImportsTitleLight: { color: "#111827" },
  exportsImportsMeta: { color: theme.colors.soft, fontSize: 14, lineHeight: 20 },
  exportsImportsMetaLight: { color: "#5f6672" },
  exportsImportsButton: {
    minHeight: 46,
    marginTop: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: "#f3b900",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18
  },
  exportsImportsButtonSent: { backgroundColor: "#168455" },
  exportsImportsButtonText: { color: "#07150e", fontSize: 15, lineHeight: 19, fontWeight: "800" },
  exportsImportsButtonTextSent: { color: "#ffffff" },
  exportsInfoBackdrop: { flex: 1, backgroundColor: "#020805", padding: 18, alignItems: "center", justifyContent: "center" },
  exportsInfoModal: {
    width: "100%",
    maxWidth: 560,
    height: "88%",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "#071a12"
  },
  exportsInfoContent: { padding: 18, gap: 13 },
  exportsInfoHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  exportsInfoIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#168455", alignItems: "center", justifyContent: "center" },
  exportsInfoIconError: { backgroundColor: "#b94343" },
  exportsInfoIconText: { color: "#ffffff", fontSize: 22, fontWeight: "800" },
  exportsInfoHeadingCopy: { flex: 1, minWidth: 0 },
  exportsInfoEyebrow: { color: "#54d58b", fontSize: 11, lineHeight: 14, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  exportsInfoEyebrowError: { color: "#ff8d8d" },
  exportsInfoTitle: { color: "#f8fafc", fontSize: 22, lineHeight: 27, fontWeight: "700" },
  exportsInfoClose: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  exportsInfoCloseText: { color: "#f8fafc", fontSize: 28, lineHeight: 30, fontWeight: "400" },
  exportsInfoLead: { color: "#f8fafc", fontSize: 15, lineHeight: 22 },
  exportsInfoSaving: { color: "#ffc329", fontSize: 13, lineHeight: 18, fontWeight: "700" },
  exportsInfoErrorNotice: { borderRadius: 14, padding: 13, gap: 6, backgroundColor: "rgba(185,67,67,0.13)", borderWidth: 1, borderColor: "rgba(255,105,105,0.42)" },
  exportsInfoErrorTitle: { color: "#ff9c9c", fontSize: 14, lineHeight: 18, fontWeight: "700" },
  exportsInfoErrorCopy: { color: "#cbd5e1", fontSize: 12, lineHeight: 17 },
  exportsInfoRetryButton: { alignSelf: "flex-start", borderRadius: theme.radius.pill, backgroundColor: "#ffffff", paddingHorizontal: 14, paddingVertical: 8, marginTop: 2 },
  exportsInfoRetryText: { color: "#161616", fontSize: 13, lineHeight: 16, fontWeight: "800" },
  exportsInfoNotice: { borderRadius: 14, padding: 13, gap: 5, backgroundColor: "rgba(255,190,0,0.10)", borderWidth: 1, borderColor: "rgba(255,190,0,0.38)" },
  exportsInfoNoticeTitle: { color: "#ffc329", fontSize: 15, lineHeight: 19, fontWeight: "700" },
  exportsInfoNoticeCopy: { color: "#cbd5e1", fontSize: 13, lineHeight: 19 },
  exportsInfoSectionTitle: { color: "#f8fafc", fontSize: 15, lineHeight: 19, fontWeight: "700", marginTop: 2 },
  exportsInfoBody: { color: "#cbd5e1", fontSize: 13, lineHeight: 20 },
  exportsInfoFootnote: { color: "#94a3b8", fontSize: 12, lineHeight: 18, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)", paddingTop: 12 },
  exportsInfoDoneButton: { minHeight: 46, borderRadius: theme.radius.pill, backgroundColor: "#f3b900", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 2 },
  exportsInfoDoneText: { color: "#07150e", fontSize: 15, lineHeight: 19, fontWeight: "800" },
  cityExperienceEyebrow: { color: "#56d99c", fontSize: 10, lineHeight: 14, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  cityExperienceProfileRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  cityExperienceAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#1a8f61", borderWidth: 3, borderColor: "#c9f5df", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  cityExperienceAvatarImage: { width: "100%", height: "100%" },
  cityExperienceAvatarInitials: { color: "#ffffff", fontSize: 16, lineHeight: 20, fontWeight: "900" },
  cityExperienceProfileCopy: { flex: 1, minWidth: 0, gap: 2 },
  cityExperienceName: { color: "#10231c", fontSize: 14, lineHeight: 18, fontWeight: "800" },
  cityExperienceCity: { color: "#52645d", fontSize: 11, lineHeight: 15, fontWeight: "600" },
  cityExperienceStars: { flexDirection: "row", alignItems: "center", gap: 4 },
  cityExperienceStarButton: { width: 36, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: "#edf2ef" },
  cityExperienceStar: { color: "#b8c2bd", fontSize: 22, lineHeight: 25 },
  cityExperienceStarActive: { color: "#f4b51e" },
  cityExperienceInput: { minHeight: 78, borderRadius: 14, borderWidth: 1, borderColor: "#d6e2dc", backgroundColor: "#ffffff", color: "#10231c", fontSize: 13, lineHeight: 18, paddingHorizontal: 12, paddingVertical: 10 },
  cityExperienceSubmitRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  cityExperienceCount: { color: "#718078", fontSize: 10, lineHeight: 14 },
  cityExperienceSubmit: { borderRadius: 999, backgroundColor: "#16885b", paddingHorizontal: 15, paddingVertical: 10 },
  cityExperienceSubmitDisabled: { opacity: 0.55 },
  cityExperienceSubmitText: { color: "#ffffff", fontSize: 12, lineHeight: 15, fontWeight: "800" },
  cityExperienceStatus: { color: "#51645b", fontSize: 11, lineHeight: 16, fontWeight: "600" },
  cityExperienceModalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  cityExperienceModalCard: { width: "100%", maxWidth: 440, borderRadius: 24, backgroundColor: "#f7fbf8", padding: 18, gap: 14, borderWidth: 1, borderColor: "rgba(53,211,147,0.42)" },
  cityExperienceModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  cityExperienceModalTitle: { color: "#10231c", fontSize: 22, lineHeight: 27, fontWeight: "800", marginTop: 2 },
  cityExperienceModalClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#e6efea", alignItems: "center", justifyContent: "center" },
  cityExperienceModalCloseText: { color: "#263b33", fontSize: 27, lineHeight: 29, fontWeight: "500", marginTop: -2 },
  housingLanding: { gap: 16 },
  housingHero: { width: "auto", height: 370, marginTop: -14, marginHorizontal: -14, overflow: "hidden", backgroundColor: "#dff3ff" },
  housingHeroImage: { opacity: 1 },
  housingHeroReviewPanel: { position: "absolute", left: 78, right: 78, top: 294, minHeight: 40, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.80)", borderWidth: 1, borderColor: "rgba(255,255,255,0.56)", flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 3, gap: 5, shadowColor: "#07153f", shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  housingHeroReviewIcon: { width: 27, height: 27, borderRadius: 14, backgroundColor: "rgba(231,255,242,0.92)", alignItems: "center", justifyContent: "center" },
  housingHeroReviewIconText: { fontSize: 14 },
  housingHeroReviewCopy: { flex: 1.1, minWidth: 0 },
  housingHeroReviewTitle: { color: "#07153f", fontSize: 8, lineHeight: 10, fontWeight: "900" },
  housingHeroReviewRating: { color: "#07153f", fontSize: 9, lineHeight: 11, fontWeight: "900" },
  housingHeroReviewMeta: { color: "#516078", fontSize: 6, lineHeight: 8, fontWeight: "700" },
  housingHeroRatingGroup: { flex: 0.88, minWidth: 0, alignItems: "center" },
  housingHeroRatingLabel: { color: "#56657b", fontSize: 6, lineHeight: 8, fontWeight: "800" },
  housingHeroRatingValue: { color: "#07153f", fontSize: 10, lineHeight: 12, fontWeight: "900" },
  housingHeroRatingReviews: { color: "#6b7487", fontSize: 6, lineHeight: 8, fontWeight: "700" },
  housingHeroSearchHotspot: { position: "absolute", left: "11%", top: 178, width: "78%", height: 52, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(255,255,255,0.97)", paddingLeft: 13, paddingRight: 5, shadowColor: "#07153f", shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  housingHeroSearchPin: { width: 27, height: 27, borderRadius: 14, backgroundColor: "#e8fff5", alignItems: "center", justifyContent: "center", marginRight: 6 },
  housingHeroSearchPinText: { color: "#0aac74", fontSize: 19, lineHeight: 21, fontWeight: "900" },
  housingHeroSearchText: { flex: 1, color: "#627083", fontSize: 12, lineHeight: 15, fontWeight: "800" },
  housingHeroSearchButton: { height: 42, minWidth: 104, paddingHorizontal: 13, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "#00a86b" },
  housingHeroSearchButtonText: { color: "#ffffff", fontSize: 14, lineHeight: 17, fontWeight: "900" },
  housingHeroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.72)" },
  housingHeroCopy: { maxWidth: "65%", zIndex: 1 },
  housingHeroTitle: { color: "#07153f", fontSize: 34, lineHeight: 37, fontWeight: "900", letterSpacing: -1.1 },
  housingHeroBadge: { position: "absolute", top: 18, right: 18, zIndex: 1, transform: [{ rotate: "-6deg" }], alignItems: "flex-end" },
  housingHeroBadgeText: { color: "#07153f", fontSize: 18, lineHeight: 21, fontWeight: "900", fontFamily: Platform.select({ ios: "Marker Felt", android: "sans-serif-condensed", default: undefined }) },
  housingHeroScribble: { width: 86, height: 5, borderRadius: 999, backgroundColor: "#14c9c8", marginTop: 5, transform: [{ rotate: "-3deg" }] },
  housingHeroTestimonialsViewport: { position: "absolute", left: 18, right: 18, bottom: 18, height: 74, zIndex: 2, overflow: "hidden" },
  housingHeroTestimonialsScroll: { flex: 1 },
  housingHeroTestimonialCard: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 6 },
  housingHeroTestimonialAvatar: { width: 42, height: 42, borderRadius: 21, overflow: "hidden", backgroundColor: "#12355b", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.78)" },
  housingHeroTestimonialInitials: { color: "#fff", fontSize: 10, lineHeight: 12, fontWeight: "900" },
  housingHeroTestimonialEmoji: { fontSize: 18, lineHeight: 22 },
  housingHeroTestimonialCopy: { flex: 1, minWidth: 0, gap: 1 },
  housingHeroTestimonialTopline: { flexDirection: "row", alignItems: "center", gap: 6 },
  housingHeroTestimonialName: { flex: 1, minWidth: 0, color: "#07153f", fontSize: 12, lineHeight: 15, fontWeight: "900" },
  housingHeroTestimonialCity: { maxWidth: 105, color: "#4f5f77", fontSize: 10, lineHeight: 13, fontWeight: "800" },
  housingHeroTestimonialStars: { flexDirection: "row", alignItems: "center", gap: 1, marginTop: 1 },
  housingHeroTestimonialStar: { color: "rgba(79,95,119,0.26)", fontSize: 11, lineHeight: 13, fontWeight: "900" },
  housingHeroTestimonialStarActive: { color: "#f59e0b" },
  housingHeroTestimonialText: { color: "#3e4a63", fontSize: 11, lineHeight: 14, fontWeight: "800" },
  housingHeroReviewDots: { position: "absolute", left: 52, bottom: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  housingHeroReviewDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "rgba(7,21,63,0.20)" },
  housingHeroReviewDotActive: { width: 13, backgroundColor: "#14c9c8" },
  housingIntentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  housingIntentHeading: { flex: 1, color: theme.colors.text, fontSize: 22, lineHeight: 27, fontWeight: "900", letterSpacing: -0.35 },
  housingIntentViewAll: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: "rgba(7,21,63,0.14)", backgroundColor: "rgba(255,255,255,0.86)" },
  housingIntentViewAllText: { color: "#07153f", fontSize: 13, fontWeight: "800" },
  housingIntentViewAllArrow: { color: "#07153f", fontSize: 24, lineHeight: 25, fontWeight: "600", marginTop: -2 },
  housingIntentGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  housingIntentCard: { width: "48.3%", height: 90, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.78)", padding: 8, overflow: "hidden", shadowColor: "#101828", shadowOpacity: Platform.OS === "android" ? 0 : 0.10, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  housingIntentCardActive: { transform: [{ scale: 0.985 }] },
  housingIntentPreview: { position: "absolute", right: -18, top: 0, bottom: 0, width: "62%", opacity: 0.42 },
  housingIntentWash: { ...StyleSheet.absoluteFillObject, opacity: 0.86 },
  housingIntentIconBubble: { position: "absolute", left: 8, top: 7, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", transform: [{ scale: 0.72 }], zIndex: 1 },
  intentHouseIcon: { width: 37, height: 36, alignItems: "center", justifyContent: "flex-end" },
  intentHouseRoof: { position: "absolute", top: 1, width: 0, height: 0, borderLeftWidth: 15, borderRightWidth: 15, borderBottomWidth: 14, borderLeftColor: "transparent", borderRightColor: "transparent" },
  intentHouseBody: { width: 23, height: 17, borderTopLeftRadius: 3, borderTopRightRadius: 3, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, alignItems: "center", justifyContent: "flex-end" },
  intentHouseDoor: { width: 7, height: 10, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: "rgba(255,255,255,0.75)" },
  intentPeopleIcon: { width: 40, height: 35 },
  intentPersonHead: { position: "absolute", top: 1, width: 12, height: 12, borderRadius: 6 },
  intentPersonHeadLeft: { left: 4 },
  intentPersonHeadRight: { right: 4 },
  intentPersonBody: { position: "absolute", bottom: 1, width: 17, height: 15, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  intentPersonBodyLeft: { left: 1 },
  intentPersonBodyRight: { right: 1 },
  intentCarSolidIcon: { width: 42, height: 31 },
  intentCarSolidTop: { position: "absolute", left: 8, top: 1, width: 18, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 9, borderLeftColor: "transparent", borderRightColor: "transparent" },
  intentCarSolidBody: { position: "absolute", left: 2, right: 2, top: 9, height: 12, borderRadius: 4 },
  intentCarSolidLight: { position: "absolute", top: 13, width: 4, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.82)" },
  intentCarSolidLightLeft: { left: 6 },
  intentCarSolidLightRight: { right: 6 },
  intentCarSolidWheel: { position: "absolute", bottom: 0, width: 6, height: 6, borderRadius: 3, backgroundColor: "#07153f" },
  intentCarSolidWheelLeft: { left: 7 },
  intentCarSolidWheelRight: { right: 7 },
  housingIntentCopy: { position: "absolute", left: 8, right: 40, bottom: 7, zIndex: 1 },
  housingIntentTitle: { color: "#07153f", fontSize: 13, lineHeight: 16, fontWeight: "900", letterSpacing: -0.2 },
  housingIntentSubtitle: { color: "#4c5871", fontSize: 10, lineHeight: 12, marginTop: 1, fontWeight: "700" },
  housingIntentArrow: { position: "absolute", right: 8, bottom: 9, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", zIndex: 1 },
  housingIntentArrowText: { color: "#07153f", fontSize: 23, lineHeight: 24, fontWeight: "700", marginTop: -3 },
  listingSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  listingSectionTitle: { flex: 1, minWidth: 0, color: theme.colors.text, ...theme.typography.sectionTitle },
  housingCardRow: { gap: 12, paddingLeft: 10, paddingRight: 20, paddingTop: 4, paddingBottom: 22, alignItems: "flex-start" },
  exactLocationCard: { borderRadius: theme.radius.lg, backgroundColor: "#0b241d", overflow: "hidden" },
  exactLocationPoster: { width: "100%", height: "100%" },
  emptyCard: { width: 286, minHeight: 170, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, justifyContent: "center" },
  emptyTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  emptyText: { color: theme.colors.muted, marginTop: 8 },
  filterPanel: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, padding: 10, gap: 7 },
  filterHeader: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: theme.colors.panel },
  filterGlyph: { color: "#8b5cff", fontSize: 17, lineHeight: 18, fontWeight: "800" },
  filterHeaderTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  filterHeaderMeta: { color: theme.colors.muted, fontSize: 11, fontWeight: "500" },
  filterTitle: { color: theme.colors.muted, fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8 },
  filterRow: { gap: 6, paddingRight: theme.spacing.md },
  filterChip: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: theme.colors.bg },
  filterChipActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  filterChipText: { color: theme.colors.soft, fontSize: 12, fontWeight: "600" },
  filterChipTextActive: { color: theme.colors.bg },
  housingRentalPromo: {
    width: "100%",
    aspectRatio: 1522 / 440,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "#fff7ee"
  },
  housingRentalPromoImage: {
    width: "100%",
    height: "100%"
  },
  rentalSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm,
    gap: 12
  },
  rentalSectionCopy: { flex: 1, minWidth: 0 },
  rentalSectionEyebrow: { color: theme.colors.accent, fontSize: 11, lineHeight: 14, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  rentalSectionTitle: { color: theme.colors.text, fontSize: 20, lineHeight: 25, fontWeight: "700", flexShrink: 1 },
  rentalSectionAction: { alignItems: "center", justifyContent: "center", backgroundColor: "#117a58", borderColor: "#0d684b", borderRadius: theme.radius.pill, borderWidth: 1, flexDirection: "row", gap: 5, minHeight: 44, minWidth: 104, paddingHorizontal: 15, shadowColor: "#0b5b42", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  rentalSectionActionText: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
  rentalSectionArrow: { color: "#ffffff", fontSize: 18, lineHeight: 20, fontWeight: "700" },
  rentalCarouselShell: {
    width: "100%",
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#07090d",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6
  },
  rentalCarouselSlide: {
    aspectRatio: 2.8,
    overflow: "hidden",
    backgroundColor: "#07090d"
  },
  rentalCarouselImage: { width: "100%", height: "100%" },
  rentalCarouselDots: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(7,29,73,0.82)",
    borderRadius: 999,
    bottom: 8,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    position: "absolute"
  },
  rentalCarouselDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.45)" },
  rentalCarouselDotActive: { width: 18, backgroundColor: "#ffffff" },
  rentalPromoPoster: {
    width: "100%",
    aspectRatio: 1522 / 440,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "#fff7ee"
  },
  rentalPromoImage: {
    width: "100%",
    height: "100%"
  },
  carOverview: { minHeight: 360, borderRadius: theme.radius.lg, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.line },
  carOverviewImage: { borderRadius: theme.radius.lg },
  carShade: { flex: 1, padding: theme.spacing.lg, justifyContent: "space-between", backgroundColor: "rgba(0,0,0,0.48)", gap: theme.spacing.md },
  carTitle: { color: theme.colors.text, fontSize: 29, lineHeight: 33, fontWeight: "900", maxWidth: 250 },
  carMeta: { color: theme.colors.soft, fontWeight: "900", lineHeight: 20, maxWidth: 280 },
  carPhone: { color: theme.colors.green, fontWeight: "900", fontSize: 16 },
  carFeatureRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  carFeature: { color: theme.colors.text, backgroundColor: "rgba(0,0,0,0.55)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 7, overflow: "hidden", fontWeight: "900", fontSize: 12 },
  carBottomRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: theme.spacing.md },
  bookNow: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingHorizontal: 20, paddingVertical: 13 },
  bookNowText: { color: theme.colors.text, fontWeight: "900", textTransform: "uppercase" },
  carSearchPanel: {
    backgroundColor: "rgba(24,24,27,0.72)",
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    padding: theme.spacing.md,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.36,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 }
  },
  carSearchPanelLight: { backgroundColor: "rgba(255,255,255,0.92)", borderColor: "rgba(255,255,255,0.72)", shadowColor: "#101828", shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  carSearchTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  carFieldLabel: { color: theme.colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  carSearchInput: { backgroundColor: "rgba(255,255,255,0.1)", color: theme.colors.text, borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(239,189,104,0.34)", minHeight: 50, paddingHorizontal: 13, fontSize: 14, fontWeight: "800" },
  carSearchInputLight: { backgroundColor: "rgba(248,250,252,0.94)", borderColor: "rgba(15,23,42,0.12)" },
  carSelectInput: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: theme.radius.md, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center" },
  carInputLight: { backgroundColor: "rgba(240,242,245,0.82)", borderColor: "rgba(255,255,255,0.58)" },
  carSelectValue: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  carSelectMeta: { color: theme.colors.muted, fontSize: 11, fontWeight: "800", marginTop: 2 },
  carTwoCol: { flexDirection: "row", gap: 10 },
  carTwoColField: { flex: 1 },
  carEstimateBox: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: theme.radius.md, minHeight: 56, paddingHorizontal: 13, paddingVertical: 9, justifyContent: "center" },
  carEstimateValue: { color: theme.colors.text, fontWeight: "900", fontSize: 14 },
  carEstimateMeta: { color: theme.colors.green, fontWeight: "900", fontSize: 12, marginTop: 2 },
  carRateNote: { borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(40,82,255,0.10)", borderRadius: theme.radius.md, padding: 12, gap: 3 },
  carRateNoteLight: { backgroundColor: "rgba(232,240,255,0.88)", borderColor: "rgba(37,99,235,0.18)" },
  carRateNoteTitle: { color: theme.colors.text, fontWeight: "900" },
  carRateNoteText: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  carSearchButton: { backgroundColor: "rgba(79,124,255,0.68)", borderWidth: 1, borderColor: "rgba(143,174,255,0.34)", borderRadius: theme.radius.pill, minHeight: 48, alignItems: "center", justifyContent: "center" },
  carSearchButtonText: { color: "#ffffff", fontWeight: "900", fontSize: 15 },
  carList: { gap: theme.spacing.md },
  carMiniCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, overflow: "hidden" },
  carMiniCardLight: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderColor: "rgba(255,255,255,0.92)",
    shadowColor: "#172033",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 7
  },
  carMiniCardLowest: { borderColor: "#d99a18", borderWidth: 1.5 },
  carMiniCardActive: { borderColor: theme.colors.blue },
  carMiniImage: { width: "100%", height: 150 },
  carMiniBody: { padding: theme.spacing.md, gap: 6 },
  carMiniLowestLabel: { color: "#e8a617", fontSize: 11, lineHeight: 14, fontWeight: "900", letterSpacing: 1.1, textTransform: "uppercase" },
  carMiniTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  carMiniMeta: { color: theme.colors.muted, fontSize: 14, fontWeight: "800" },
  carMiniPrice: { color: theme.colors.green, fontSize: 19, fontWeight: "900" },
  carMiniSavings: { color: theme.colors.soft, fontSize: 12, fontWeight: "800" },
  carMiniAction: { color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 8, overflow: "hidden", fontWeight: "900", alignSelf: "flex-start", marginTop: 4 },
  checkoutScreen: { flex: 1, backgroundColor: theme.colors.bg },
  checkoutScreenLight: { backgroundColor: "#f4f6f8" },
  checkoutContent: { padding: theme.spacing.md, paddingTop: 54, paddingBottom: 120, gap: theme.spacing.md },
  checkoutHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  checkoutClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: theme.colors.line, alignItems: "center", justifyContent: "center" },
  checkoutCloseLight: { backgroundColor: "#ffffff", borderColor: "#d9dee5" },
  checkoutCloseText: { color: theme.colors.text, fontWeight: "900", fontSize: 18 },
  rentalReviewPanel: { backgroundColor: "rgba(17,24,39,0.88)", borderRadius: theme.radius.lg, borderWidth: 1, borderColor: "rgba(80,124,255,0.72)", padding: theme.spacing.md, gap: 10 },
  rentalReviewPanelLight: { backgroundColor: "#ffffff", borderColor: "#d9e1ed", shadowColor: "#172033", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 4 },
  reviewEyebrow: { color: theme.colors.accent, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  reviewTitle: { color: theme.colors.text, fontSize: 24, fontWeight: "900" },
  reviewCarTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  reviewMeta: { color: theme.colors.muted, fontSize: 13, fontWeight: "800", lineHeight: 18 },
  reviewMetaLight: { color: "#667085" },
  reviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reviewItem: { width: "48%", color: theme.colors.soft, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontWeight: "800" },
  reviewItemLight: { color: "#344054", backgroundColor: "#f2f4f7", borderWidth: 1, borderColor: "#e4e7ec" },
  reviewTotal: { color: theme.colors.green, fontSize: 19, fontWeight: "900" },
  reviewSavings: { color: theme.colors.green, backgroundColor: "rgba(34,197,94,0.12)", borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 10, fontWeight: "900" },
  reviewInfoCard: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", padding: 12, gap: 8 },
  reviewInfoCardLight: { backgroundColor: "#f8fafb", borderColor: "#dfe4ea" },
  reviewInfoTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  reviewInput: { backgroundColor: "rgba(255,255,255,0.08)", color: theme.colors.text, borderRadius: theme.radius.md, minHeight: 48, paddingHorizontal: 13, fontWeight: "800" },
  reviewInputLight: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#d9dee5", color: "#101828" },
  reviewActions: { flexDirection: "row", gap: 10 },
  reviewHoldButton: { flex: 1, backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingVertical: 13, alignItems: "center" },
  reviewHoldText: { color: "#ffffff", fontWeight: "900", textTransform: "uppercase" },
  reviewHoldMeta: { color: "#ffffff", fontSize: 11, fontWeight: "800", marginTop: 2 },
  reviewFullButton: { flex: 1, backgroundColor: theme.colors.text, borderRadius: theme.radius.md, paddingVertical: 13, alignItems: "center" },
  reviewFullText: { color: theme.colors.bg, fontWeight: "900", textTransform: "uppercase" },
  reviewFullMeta: { color: "#555", fontSize: 11, fontWeight: "900", marginTop: 2 },
  reviewPolicy: { color: theme.colors.soft, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  reviewPolicyLight: { color: "#667085" },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.48)", padding: theme.spacing.md, justifyContent: "center" },
  pickerCard: { maxHeight: "78%", backgroundColor: "#202329", borderRadius: 24, borderWidth: 1, borderColor: "#414750", padding: theme.spacing.md, gap: theme.spacing.md },
  pickerCardLight: { backgroundColor: "#ffffff", borderColor: "#e1e6ea" },
  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pickerTitle: { color: "#f7f9fa", fontSize: 20, fontWeight: "800" },
  pickerTitleLight: { color: "#14202a" },
  pickerClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#343a43", alignItems: "center", justifyContent: "center" },
  pickerCloseLight: { backgroundColor: "#eff2f4" },
  pickerCloseText: { color: "#f7f9fa", fontSize: 24, lineHeight: 28, fontWeight: "600" },
  pickerCloseTextLight: { color: "#344454" },
  pickerList: { gap: 8 },
  pickerOption: { minHeight: 48, borderRadius: theme.radius.md, borderWidth: 1, borderColor: "#4a515b", backgroundColor: "#2b3038", paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" },
  pickerOptionLight: { borderColor: "#dfe6e9", backgroundColor: "#f7f9fa" },
  pickerOptionActive: { backgroundColor: "#0b9c74", borderColor: "#0b9c74" },
  pickerOptionDisabled: { opacity: 0.35 },
  pickerOptionText: { color: "#f7f9fa", fontSize: 15, lineHeight: 20, fontWeight: "700" },
  pickerOptionTextLight: { color: "#20303c" },
  pickerOptionTextActive: { color: "#ffffff" },
  pickerOptionTextDisabled: { color: theme.colors.muted },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  calendarCell: { width: "31%", minHeight: 66, borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.06)", padding: 8, justifyContent: "center" },
  calendarCellLight: { borderColor: "#dfe6e9", backgroundColor: "#f7f9fa" },
  calendarDateText: { color: theme.colors.muted, fontSize: 11, marginTop: 3, fontWeight: "800" },
  roomTypeRow: { flexDirection: "row", justifyContent: "space-between" },
  roomType: { alignItems: "center", gap: 10, flex: 1 },
  roomCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  roomCircleActive: { borderWidth: 2, borderColor: theme.colors.brand },
  roomIcon: { width: 50, height: 50 },
  roomLabel: { color: theme.colors.soft, fontWeight: "700", fontSize: 14 },
  neighborhoodPanel: { borderRadius: 20, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#e7ecf3", paddingTop: 12, paddingBottom: 14, shadowColor: "#0f172a", shadowOpacity: 0.10, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4, overflow: "hidden" },
  neighborhoodHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 14, marginBottom: 8 },
  neighborhoodHeaderCopy: { flex: 1, minWidth: 0 },
  neighborhoodTitle: { color: "#07153f", fontSize: 16, lineHeight: 19, fontWeight: "900", letterSpacing: -0.2 },
  neighborhoodMeta: { color: "#667085", fontSize: 10, lineHeight: 13, fontWeight: "800", marginTop: 1 },
  neighborhoodViewAll: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#d9e1ed", paddingHorizontal: 12 },
  neighborhoodViewAllText: { color: "#07153f", fontSize: 12, lineHeight: 14, fontWeight: "900" },
  neighborhoodViewAllArrow: { color: "#07153f", fontSize: 22, lineHeight: 24, fontWeight: "700", marginTop: -2 },
  neighborhoodGraphRow: { alignItems: "flex-end", gap: 9, paddingLeft: 12, paddingRight: 14, paddingTop: 2 },
  neighborhoodGraphItem: { width: 64, alignItems: "center", justifyContent: "flex-end" },
  neighborhoodRent: { fontSize: 12, lineHeight: 15, fontWeight: "900", marginBottom: 5 },
  neighborhoodBarWrap: { height: 96, justifyContent: "flex-end", alignItems: "center" },
  neighborhoodBar: { width: 48, borderTopLeftRadius: 12, borderTopRightRadius: 12, overflow: "hidden", justifyContent: "flex-end", shadowColor: "#07153f", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  neighborhoodBarImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%", opacity: 0.70 },
  neighborhoodName: { color: "#07153f", fontSize: 9, lineHeight: 10.5, fontWeight: "900", textAlign: "center", marginTop: 4, minHeight: 22 },
  neighborhoodFindCard: { width: 66, height: 128, borderRadius: 16, borderWidth: 1, borderColor: "#e5eaf2", backgroundColor: "#f7fbff", alignItems: "center", justifyContent: "center", paddingHorizontal: 7, gap: 5, marginLeft: 2 },
  neighborhoodFindText: { color: "#07153f", fontSize: 9, lineHeight: 11, fontWeight: "900", textAlign: "center", transform: [{ rotate: "-8deg" }] },
  neighborhoodFindIcon: { color: "#16a37a", fontSize: 26, lineHeight: 28, fontWeight: "900" },
  detailBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.74)", paddingHorizontal: theme.spacing.sm, paddingTop: Platform.OS === "ios" ? 54 : theme.spacing.md, paddingBottom: theme.spacing.md, justifyContent: "center" },
  detailCard: { maxHeight: "94%", backgroundColor: theme.colors.panel, borderRadius: 28, borderWidth: 1, borderColor: theme.colors.line, overflow: "hidden" },
  detailHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  detailEyebrow: { color: theme.colors.accent, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  detailClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  detailCloseText: { color: theme.colors.text, fontWeight: "900" },
  detailContent: { padding: theme.spacing.md, paddingBottom: 48, gap: theme.spacing.md },
  detailCarouselWrap: { width: "100%", borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: "#202a25" },
  detailCarousel: { width: "100%" },
  detailImageFrame: { height: 210, borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: "#202a25" },
  detailImage: { width: "100%", height: "100%" },
  detailImageLoading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(12,18,17,0.48)" },
  detailImageErrorText: { color: theme.colors.soft, fontSize: 13, fontWeight: "800" },
  detailImageDots: { position: "absolute", bottom: 12, alignSelf: "center", flexDirection: "row", gap: 6, backgroundColor: "rgba(0,0,0,0.48)", borderRadius: theme.radius.pill, paddingHorizontal: 9, paddingVertical: 7 },
  detailImageDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.48)" },
  detailImageDotActive: { width: 16, backgroundColor: "#ffffff" },
  detailImageNext: { position: "absolute", right: 12, top: "50%", width: 44, height: 44, marginTop: -22, borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.58)", backgroundColor: "rgba(10,18,15,0.34)" },
  detailImageNextGlass: { flex: 1, alignItems: "center", justifyContent: "center" },
  detailImageNextText: { color: "#ffffff", fontSize: 36, lineHeight: 38, fontWeight: "500", marginTop: -3 },
  detailImageFallback: { width: "100%", minHeight: 190, borderRadius: theme.radius.md, backgroundColor: "#202a25", alignItems: "center", justifyContent: "center", padding: 22, gap: 8 },
  detailImageFallbackIcon: { fontSize: 38, lineHeight: 42 },
  detailImageFallbackTitle: { color: "#ffffff", fontSize: 22, lineHeight: 27, fontWeight: "900", textAlign: "center" },
  detailImageFallbackCopy: { color: "#c7d0cb", fontSize: 14, lineHeight: 20, fontWeight: "700", textAlign: "center", maxWidth: 420 },
  detailTitle: { color: theme.colors.text, fontSize: 21, lineHeight: 25, fontWeight: "700" },
  detailMeta: { color: theme.colors.muted, fontSize: 14, fontWeight: "600" },
  detailDescriptionCard: { backgroundColor: "rgba(255,255,255,0.045)", borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.lg, padding: theme.spacing.md, gap: 8 },
  detailMapCompact: { minHeight: 70, backgroundColor: "rgba(13,31,26,0.82)", borderWidth: 1, borderColor: "rgba(64,201,148,0.28)", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 11, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  detailMapCompactLight: { backgroundColor: "rgba(255,255,255,0.96)", borderColor: "#dce7e2", shadowColor: "#173c30", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  detailMapIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(31,201,139,0.15)" },
  detailMapIconLight: { backgroundColor: "#e1f8ee" },
  detailMapIconText: { color: theme.colors.green, fontSize: 27, lineHeight: 30, fontWeight: "800" },
  detailMapCopy: { flex: 1, minWidth: 0 },
  detailMapTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "800" },
  detailMapTitleLight: { color: "#17231f" },
  detailMapText: { color: theme.colors.green, fontSize: 12.5, fontWeight: "700", marginTop: 3 },
  detailMapTextLight: { color: "#16865f" },
  detailMapArrow: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  detailMapArrowLight: { backgroundColor: "#f0f4f2" },
  detailMapChevron: { color: theme.colors.text, fontSize: 25, lineHeight: 27, fontWeight: "500", marginTop: -2 },
  detailMapChevronLight: { color: "#356052" },
  detailDescription: { color: theme.colors.soft, fontSize: 15, lineHeight: 22, fontWeight: "500" },
  detailInfoCard: { backgroundColor: "rgba(255,255,255,0.055)", borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.lg, overflow: "hidden" },
  detailInfoRow: { minHeight: 43, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.08)" },
  detailInfoLabel: { flexShrink: 0, color: theme.colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  detailInfoValue: { flex: 1, color: theme.colors.soft, fontSize: 14, fontWeight: "700", textAlign: "right" },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  detailFact: { color: theme.colors.soft, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 7, fontWeight: "600" },
  detailAmenities: { gap: 8 },
  detailSectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  detailMessage: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.pill, alignItems: "center", paddingVertical: 13 },
  detailMessageSent: { backgroundColor: theme.colors.green },
  detailMessageDisabled: { backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line },
  detailManage: { backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.brand },
  detailManageText: { color: theme.colors.text },
  detailMessageText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  detailScrollHint: { position: "absolute", bottom: 10, alignSelf: "center", width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(9,13,18,0.88)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 12 },
  detailScrollHintText: { color: "#fff", fontSize: 30, lineHeight: 32, fontWeight: "900", marginTop: -7 },
  detailPhotoBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50, backgroundColor: "rgba(0,0,0,0.96)", paddingTop: Platform.OS === "ios" ? 54 : 24, paddingBottom: Platform.OS === "ios" ? 34 : 18, paddingHorizontal: 10 },
  detailPhotoClose: { position: "absolute", top: Platform.OS === "ios" ? 54 : 24, right: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center", zIndex: 3 },
  detailPhotoCloseText: { color: "#fff", fontSize: 30, lineHeight: 32, marginTop: -2 },
  detailPhotoPager: { flex: 1, marginHorizontal: -10 },
  detailPhotoPage: { alignItems: "center", justifyContent: "center" },
  detailPhotoFull: { maxWidth: "100%" },
  detailPhotoZoomControls: { position: "absolute", top: Platform.OS === "ios" ? 58 : 28, alignSelf: "center", zIndex: 4, flexDirection: "row", alignItems: "center", gap: 6, padding: 5, borderRadius: theme.radius.pill, backgroundColor: "rgba(20,24,23,0.76)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  detailPhotoZoomButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  detailPhotoZoomButtonDisabled: { opacity: 0.34 },
  detailPhotoZoomButtonText: { color: "#fff", fontSize: 24, lineHeight: 27, fontWeight: "700" },
  detailPhotoZoomValue: { minWidth: 54, height: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  detailPhotoZoomValueText: { color: "#fff", fontSize: 12, lineHeight: 16, fontWeight: "900" },
  detailPhotoNav: { position: "absolute", top: "50%", width: 48, height: 48, marginTop: -24, borderRadius: 24, backgroundColor: "rgba(22,22,24,0.72)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", zIndex: 2 },
  detailPhotoNavLeft: { left: 14 },
  detailPhotoNavRight: { right: 14 },
  detailPhotoNavText: { color: "#fff", fontSize: 42, lineHeight: 44, fontWeight: "300", marginTop: -4 },
  detailPhotoDots: { position: "absolute", bottom: Platform.OS === "ios" ? 44 : 26, alignSelf: "center", flexDirection: "row", gap: 6, backgroundColor: "rgba(0,0,0,0.46)", borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 7 },
  detailPhotoDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.48)" },
  detailPhotoDotActive: { width: 18, backgroundColor: "#fff" },
  rideTopShowcase: { borderTopLeftRadius: 0, borderTopRightRadius: 0, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: "hidden", backgroundColor: "#dff3ff", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  rideTopShowcaseLight: { backgroundColor: "#ffffff", shadowColor: "#172033", shadowOpacity: 0.13 },
  rideTravelHero: { width: "100%", height: 275, backgroundColor: "#dff3ff" },
  rideDriverCta: { marginTop: -26, marginHorizontal: 14, marginBottom: 14, minHeight: 124, borderRadius: 26, paddingHorizontal: 14, paddingTop: 15, paddingBottom: 14, gap: 12, backgroundColor: "rgba(18,24,22,0.96)" },
  rideDriverCtaLight: { backgroundColor: "#ffffff" },
  rideDriverCtaHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rideDriverCtaIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  rideDriverCtaEmoji: { fontSize: 25, lineHeight: 30 },
  rideDriverCtaCopy: { flex: 1, minWidth: 0, gap: 2 },
  rideDriverCtaPeople: { width: 128, height: 42, borderRadius: 15 },
  rideDriverCtaTitle: { color: theme.colors.text, fontSize: 18, lineHeight: 22, fontWeight: "900" },
  rideDriverCtaText: { color: theme.colors.muted, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  rideDriverCtaButton: { borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "rgba(55,213,154,0.16)", borderWidth: 1, borderColor: "rgba(94,224,166,0.38)" },
  rideDriverCtaButtonText: { color: "#8ff0c2", fontSize: 12, lineHeight: 15, fontWeight: "900" },
  ridePopularSection: { gap: 12 },
  ridePopularHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  ridePopularTitle: { color: theme.colors.text, fontSize: 22, lineHeight: 27, fontWeight: "900" },
  ridePopularViewAll: { color: theme.colors.green, fontSize: 15, fontWeight: "900" },
  ridePopularList: { gap: 10, paddingRight: 8 },
  ridePopularCard: {
    width: 118,
    height: 90,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: theme.colors.panel2
  },
  ridePopularCardLight: {
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#172033",
    shadowOpacity: 0.15,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5
  },
  ridePopularCityTile: { justifyContent: "center", alignItems: "center" },
  ridePopularImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  ridePopularCityIcon: { fontSize: 38, lineHeight: 46, marginBottom: 8 },
  ridePopularShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 34, backgroundColor: "rgba(0,0,0,0.58)" },
  ridePopularCityRow: { position: "absolute", left: 8, right: 7, bottom: 8, flexDirection: "row", alignItems: "center", gap: 4 },
  ridePopularPin: { width: 14, height: 14 },
  ridePopularCity: { flex: 1, color: "#fff", fontSize: 13, lineHeight: 16, fontWeight: "900" },
  rideHero: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "#090d12",
    padding: 7,
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 }
  },
  rideBrandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  rideBrandLogo: { width: 96, height: 34 },
  rideOptionPill: { backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  rideOptionPillText: { color: theme.colors.text, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  rideHeroTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  rideHeroCopy: { flex: 1, minWidth: 0 },
  rideEyebrow: { color: theme.colors.accent, fontSize: 11, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  rideTitle: { color: theme.colors.text, fontSize: 25, lineHeight: 28, fontWeight: "800", marginTop: 2, textTransform: "uppercase" },
  rideTitleAccent: { color: theme.colors.accent },
  rideMeta: { color: theme.colors.muted, fontSize: 13, lineHeight: 17, fontWeight: "800", marginTop: 3 },
  rideFeatureRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rideFeatureBadge: { color: theme.colors.soft, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: theme.radius.pill, paddingHorizontal: 9, paddingVertical: 5, overflow: "hidden", fontSize: 12, fontWeight: "900" },
  rideShareStrip: {
    width: "100%",
    height: 25,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
    backgroundColor: "rgba(15,23,42,0.72)"
  },
  ridePosterSection: { gap: 12 },
  ridePosterHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  ridePosterHint: { color: theme.colors.muted, fontSize: 12, fontWeight: "900" },
  rideComingSoonTitle: { color: theme.colors.text, fontSize: 17, lineHeight: 22, fontWeight: "700", marginTop: 3 },
  ridePosterCarousel: { gap: 12, paddingRight: 18 },
  ridePosterImageCard: {
    width: 330,
    height: 172,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "#f8f0e2",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 }
  },
  ridePosterImage: { flex: 1 },
  ridePosterImageRadius: { borderRadius: 20 },
  ridePosterCard: {
    width: 270,
    minHeight: 126,
    borderRadius: 19,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.panel,
    flexDirection: "row",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 }
  },
  ridePosterAccent: { width: 5 },
  ridePosterCardActive: { borderColor: theme.colors.text, shadowOpacity: 0.42 },
  ridePosterCopy: { flex: 1, padding: 14, justifyContent: "space-between", gap: 8 },
  ridePosterTitle: { color: theme.colors.text, fontSize: 18, lineHeight: 23, fontWeight: "700" },
  ridePosterSubtitle: { color: theme.colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  ridePosterButton: { alignSelf: "flex-start", color: theme.colors.text, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 6, fontSize: 11, fontWeight: "900" },
  ridePosterArt: { width: 94, alignItems: "center", justifyContent: "center", transform: [{ scale: 0.9 }] },
  rideGlyphWrap: { width: 78, height: 78, alignItems: "center", justifyContent: "center" },
  rideGlyphWrapSmall: { width: 42, height: 42 },
  rideGlyphCalendar: { width: 48, height: 46, borderRadius: 8, borderWidth: 3, borderColor: theme.colors.text, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.04)" },
  rideGlyphCalendarSmall: { width: 30, height: 28, borderRadius: 6, borderWidth: 2 },
  rideGlyphCalendarTop: { height: 10, backgroundColor: theme.colors.accent },
  rideGlyphGrid: { flexDirection: "row", flexWrap: "wrap", gap: 5, padding: 7 },
  rideGlyphDot: { width: 6, height: 6, borderRadius: 2, backgroundColor: theme.colors.text },
  rideGlyphClock: { position: "absolute", right: 8, bottom: 9, width: 23, height: 23, borderRadius: 12, borderWidth: 3, borderColor: theme.colors.text, backgroundColor: "#111827" },
  rideGlyphClockSmall: { right: 4, bottom: 4, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  rideGlyphPeople: { position: "absolute", top: 5, flexDirection: "row", gap: 5 },
  rideGlyphPerson: { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.text },
  rideGlyphPersonSmall: { width: 7, height: 7, borderRadius: 4 },
  rideGlyphCarTop: { width: 44, height: 20, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderWidth: 3, borderBottomWidth: 0, borderColor: theme.colors.text, marginTop: 12 },
  rideGlyphCarTopSmall: { width: 28, height: 12, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderWidth: 2, borderBottomWidth: 0, marginTop: 8 },
  rideGlyphCarBody: { width: 64, height: 24, borderRadius: 10, backgroundColor: theme.colors.text, marginTop: -1 },
  rideGlyphCarBodySmall: { width: 38, height: 15, borderRadius: 7 },
  rideGlyphWheelRow: { width: 54, flexDirection: "row", justifyContent: "space-between", marginTop: -5 },
  rideGlyphWheel: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#05070a", borderWidth: 2, borderColor: theme.colors.text },
  rideGlyphWheelSmall: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  rideInsightCard: {
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)"
  },
  rideInsightImageWrap: { height: 112, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  rideInsightImage: { width: 116, height: 78 },
  rideInsightCopy: { padding: theme.spacing.md, gap: 5 },
  rideInsightTitle: { color: theme.colors.text, fontSize: 21, lineHeight: 25, fontWeight: "900" },
  rideInsightMeta: { color: theme.colors.soft, fontSize: 14, lineHeight: 19, fontWeight: "800" },
  rideServiceDetail: {
    ...theme.depth.card,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10
  },
  rideServiceDetailLight: {
    backgroundColor: "rgba(255,255,255,0.94)",
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#172033",
    shadowOpacity: 0.13,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5
  },
  rideServiceDetailHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  rideServiceDetailIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center"
  },
  rideServiceDetailCopy: { flex: 1, minWidth: 0 },
  rideServiceDetailTitle: { color: theme.colors.text, fontSize: 16, lineHeight: 20, fontWeight: "800" },
  rideServiceDetailLabel: { color: theme.colors.accent, fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  rideSimpleHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  rideSimpleTrustPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(55,213,154,0.12)", borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 5 },
  rideSimpleTrustIcon: { width: 15, height: 15 },
  rideSimpleTrust: { color: theme.colors.green, fontSize: 11, fontWeight: "900" },
  rideSimpleSteps: { flexDirection: "row", gap: 8, marginTop: 1 },
  rideSimpleStep: { flex: 1, minHeight: 124, borderRadius: 16, backgroundColor: "transparent", borderWidth: 0, paddingHorizontal: 3, paddingVertical: 3, alignItems: "center", justifyContent: "flex-start", gap: 4 },
  rideSimpleStepLight: { backgroundColor: "rgba(244,247,251,0.9)", borderColor: "rgba(15,23,42,0.08)" },
  rideSimpleStepIcon: { width: 58, height: 45, marginTop: -2 },
  rideSimpleStepText: { color: theme.colors.text, fontSize: 12, lineHeight: 15, fontWeight: "900", textAlign: "center" },
  rideSimpleStepCopy: { color: theme.colors.muted, fontSize: 10, lineHeight: 13, fontWeight: "700", textAlign: "center" },
  ridePrimaryActions: { flexDirection: "row", gap: 10, marginTop: 1 },
  rideFindButton: { flex: 1, minHeight: 58, borderRadius: 18, backgroundColor: "rgba(55,213,154,0.14)", borderWidth: 1, borderColor: "rgba(55,213,154,0.18)", flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 28, gap: 4, position: "relative" },
  rideFindButtonAndroid: { backgroundColor: "#C4E6DE", borderColor: "#A5D9CD" },
  rideFindButtonText: { color: "#0d8f75", fontSize: 14, lineHeight: 17, fontWeight: "900", backgroundColor: "transparent", includeFontPadding: false },
  rideOfferButton: { flex: 1, minHeight: 58, borderRadius: 18, backgroundColor: "rgba(255,191,105,0.22)", borderWidth: 1, borderColor: "rgba(239,189,104,0.18)", flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 27, gap: 4, position: "relative" },
  rideOfferButtonAndroid: { backgroundColor: "#F0DCC4", borderColor: "#E7C89E" },
  rideActionLight: { shadowColor: "#101828", shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  rideActionIcon: { width: 25, height: 25 },
  rideActionEmojiAndroid: { width: 28, fontSize: 20, lineHeight: 24, textAlign: "center", includeFontPadding: false, backgroundColor: "transparent" },
  rideActionCopy: { flex: 1, minWidth: 0, backgroundColor: "transparent" },
  rideActionCopyAndroid: { justifyContent: "center", backgroundColor: "transparent" },
  rideFindActionCopyAndroid: { backgroundColor: "#C4E6DE" },
  rideOfferActionCopyAndroid: { backgroundColor: "#F0DCC4" },
  rideActionSubtext: { color: "#6b7a90", fontSize: 10, lineHeight: 13, fontWeight: "700", backgroundColor: "transparent", includeFontPadding: false },
  rideOfferSubtext: { color: "#d04400" },
  rideFindArrow: { position: "absolute", right: 9, color: "#0d8f75", fontSize: 25, lineHeight: 27, fontWeight: "700", marginTop: -2 },
  rideOfferArrow: { position: "absolute", right: 9, color: "#d04400", fontSize: 25, lineHeight: 27, fontWeight: "700", marginTop: -2 },
  rideOfferButtonText: { color: "#c2410c", fontSize: 11, lineHeight: 14, fontWeight: "900", backgroundColor: "transparent", includeFontPadding: false },
  rideServiceDetailText: { color: theme.colors.soft, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  rideExampleBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 9,
    gap: 3
  },
  rideExampleLabel: { color: theme.colors.accent, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  rideExampleText: { color: theme.colors.text, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  rideServiceStep: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  rideServiceStepDot: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginTop: -2 },
  rideServiceStepDotText: { color: "#08224a", fontSize: 18, fontWeight: "900" },
  rideServiceStepText: { flex: 1, color: theme.colors.soft, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  rideLifecycleCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 9,
    gap: 6
  },
  rideLifecycleWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  rideLifecyclePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 9,
    paddingVertical: 7
  },
  rideLifecycleNumber: {
    width: 18,
    height: 18,
    borderRadius: 9,
    overflow: "hidden",
    color: theme.colors.text,
    backgroundColor: theme.colors.accent,
    textAlign: "center",
    fontSize: 10,
    lineHeight: 18,
    fontWeight: "900"
  },
  rideLifecycleText: { color: theme.colors.soft, fontSize: 12, fontWeight: "900" },
  rideSafetyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.22)",
    backgroundColor: "rgba(59,130,246,0.08)",
    padding: 12,
    gap: 9
  },
  rideSafetyRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  rideSafetyRowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.12)",
    color: theme.colors.text,
    textAlign: "center",
    lineHeight: 28,
    fontWeight: "900"
  },
  rideSafetyRowCopy: { flex: 1, minWidth: 0 },
  rideSafetyRowTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "900" },
  rideSafetyRowBody: { color: theme.colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "800", marginTop: 2 },
  rideServiceActionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rideServicePlanButton: { flex: 1, marginTop: 2, minHeight: 48, borderRadius: theme.radius.pill, backgroundColor: theme.colors.blue, alignItems: "center", justifyContent: "center" },
  rideServicePlanButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "900" },
  rideServiceChatButton: { minWidth: 94, minHeight: 48, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.06)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10 },
  rideServiceChatIcon: { width: 24, height: 24 },
  rideServiceChatText: { color: theme.colors.text, fontSize: 13, fontWeight: "900" },
  rideModeSection: { gap: theme.spacing.md },
  rideSectionEyebrow: { color: theme.colors.accent, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  rideModeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  rideModeCard: {
    width: "48%",
    minHeight: 118,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: 12,
    justifyContent: "space-between",
    gap: 8
  },
  rideModeCardActive: { borderColor: theme.colors.accent, backgroundColor: "rgba(255,59,48,0.18)" },
  rideModeIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  rideModeIcon: { width: 30, height: 30 },
  rideModeCopyBlock: { gap: 4 },
  rideModeTitle: { color: theme.colors.text, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  rideModeTitleActive: { color: theme.colors.text },
  rideModeCopy: { color: theme.colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "800", marginTop: 7 },
  rideModeCopyActive: { color: theme.colors.soft },
  rideFlowStrip: { flexDirection: "row", flexWrap: "wrap", gap: 8, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", padding: 10, backgroundColor: "rgba(255,255,255,0.04)" },
  rideFlowStep: { width: "48%", flexDirection: "row", alignItems: "center", gap: 8 },
  rideFlowDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" },
  rideFlowDotText: { color: theme.colors.text, fontSize: 12, fontWeight: "900" },
  rideFlowText: { color: theme.colors.soft, flex: 1, fontSize: 12, fontWeight: "800" },
  rideActiveSummary: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.05)", padding: theme.spacing.md },
  rideSummaryTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  rideSummaryCopy: { color: theme.colors.muted, maxWidth: 220, marginTop: 4, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  rideSummaryStatus: { color: theme.colors.green, backgroundColor: "rgba(34,197,94,0.12)", borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 7, overflow: "hidden", fontSize: 12, fontWeight: "900" },
  rideForm: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(24,24,27,0.78)",
    padding: theme.spacing.md,
    gap: 10
  },
  rideFormTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  rideInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.radius.md,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden"
  },
  rideInputIconWrap: { width: 50, alignItems: "center", justifyContent: "center" },
  rideInputIcon: { width: 27, height: 27 },
  rideInput: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    backgroundColor: "rgba(255,255,255,0.08)",
    color: theme.colors.text,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: "800"
  },
  rideInlineInput: { flex: 1, backgroundColor: "transparent", borderRadius: 0 },
  rideHalfInput: { flex: 1 },
  rideChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rideChip: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  rideChipActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  rideChipText: { color: theme.colors.soft, fontWeight: "900" },
  rideChipTextActive: { color: theme.colors.bg },
  rideNotes: { minHeight: 86, paddingTop: 12, textAlignVertical: "top" },
  rideActions: { flexDirection: "row", gap: 10 },
  rideSecondaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.blue,
    alignItems: "center",
    justifyContent: "center"
  },
  rideSecondaryText: { color: theme.colors.text, fontWeight: "900", fontSize: 15 },
  ridePrimaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center"
  },
  ridePrimaryText: { color: theme.colors.text, fontWeight: "900", fontSize: 15 },
  rideResults: { gap: theme.spacing.md },
  rideResultCard: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(17,24,39,0.78)",
    padding: theme.spacing.md,
    gap: 9
  },
  rideMapPreview: { height: 132, borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: "#18202a", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", marginBottom: 4 },
  rideMapGridA: { position: "absolute", left: -20, right: -20, top: 42, height: 1, backgroundColor: "rgba(255,255,255,0.13)", transform: [{ rotate: "-8deg" }] },
  rideMapGridB: { position: "absolute", left: -20, right: -20, top: 88, height: 1, backgroundColor: "rgba(255,255,255,0.10)", transform: [{ rotate: "12deg" }] },
  rideRouteLine: { position: "absolute", left: 50, right: 50, top: 62, height: 5, borderRadius: 5, backgroundColor: theme.colors.blue, transform: [{ rotate: "-10deg" }] },
  rideMapPin: { position: "absolute", width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: theme.colors.text },
  rideMapPinStart: { left: 44, top: 64, backgroundColor: theme.colors.green },
  rideMapPinEnd: { right: 44, top: 42, backgroundColor: theme.colors.accent },
  rideMapDistance: { position: "absolute", right: 10, bottom: 10, color: theme.colors.text, backgroundColor: "rgba(0,0,0,0.58)", borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 6, overflow: "hidden", fontSize: 12, fontWeight: "900" },
  rideResultTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  rideResultType: { color: theme.colors.accent, fontSize: 11, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  rideScore: { color: theme.colors.bg, backgroundColor: theme.colors.text, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 5, overflow: "hidden", fontWeight: "900" },
  rideResultTitle: { color: theme.colors.text, fontSize: 20, lineHeight: 24, fontWeight: "900" },
  rideRoute: { color: theme.colors.soft, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  rideFactRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  rideFact: { color: theme.colors.soft, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 6, overflow: "hidden", fontSize: 12, fontWeight: "900" },
  rideFactGreen: { color: theme.colors.green, backgroundColor: "rgba(34,197,94,0.12)", borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 6, overflow: "hidden", fontSize: 12, fontWeight: "900" },
  rideSmall: { color: theme.colors.muted, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  rideRequestButton: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.pill, minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 4 },
  rideRequestButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "900" },
  rideHeroActionRow: { flexDirection: "row", gap: 10 },
  rideHeroOwnerButton: {
    flex: 1,
    minHeight: 74,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.52)",
    backgroundColor: "rgba(59,130,246,0.16)",
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  rideHeroOwnerCopy: { flex: 1, minWidth: 0 },
  rideHeroOwnerTitle: { color: theme.colors.text, fontSize: 18, lineHeight: 22, fontWeight: "900" },
  rideHeroOwnerMeta: { color: theme.colors.soft, fontSize: 12, lineHeight: 16, fontWeight: "800", marginTop: 2 },
  rideHeroOwnerArrow: { color: theme.colors.text, fontSize: 24, fontWeight: "600" },
  rideMediaCard: {
    height: 184,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "#000",
    flexDirection: "row"
  },
  rideMediaCardLight: {
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#172033",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6
  },
  rideVideoHalf: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  rideVideoNativeLink: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  rideVideoThumbnail: { width: "100%", height: "100%" },
  rideVideoPlay: { position: "absolute", width: 52, height: 38, borderRadius: 11, backgroundColor: "rgba(220,0,0,0.94)", alignItems: "center", justifyContent: "center" },
  rideVideoPlayText: { color: "#fff", fontSize: 19, marginLeft: 3 },
  rideVideoCaptionShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 42, backgroundColor: "rgba(0,0,0,0.52)" },
  rideVideoCaption: { position: "absolute", left: 14, right: 10, bottom: 11, color: "#fff", fontSize: 14, fontWeight: "800" },
  rideSharingBanner: { height: 108, borderRadius: 20, overflow: "hidden", backgroundColor: "#dff3ff", shadowColor: "#172033", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 4 },
  rideSharingBannerLight: { borderWidth: 1, borderColor: "rgba(255,255,255,0.9)" },
  rideSharingBannerImage: { width: "100%", height: "100%" },
  rideListBannerButton: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  rideListBanner: { width: "100%", height: "100%" },
  rideOwnerOfferGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  rideOwnerOfferCard: {
    width: "100%",
    minHeight: 76,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 11,
    flexDirection: "row",
    alignItems: "center"
  },
  rideOwnerOfferCardActive: { borderColor: theme.colors.blue, backgroundColor: "rgba(59,130,246,0.18)" },
  rideOwnerOfferCardDisabled: { opacity: 0.55 },
  rideOwnerOfferIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  rideOwnerOfferIconActive: { backgroundColor: theme.colors.blue },
  rideOwnerOfferImage: { width: 31, height: 31 },
  rideOwnerOfferCopy: { flex: 1, minWidth: 0 },
  rideOwnerOfferIconText: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
  rideOwnerOfferTitle: { color: theme.colors.text, fontSize: 15, lineHeight: 18, fontWeight: "700" },
  rideOwnerOfferSubtitle: { color: theme.colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "500", marginTop: 2 },
  rideOwnerScreen: { flex: 1, backgroundColor: "#101010" },
  rideOwnerContent: { width: "100%", maxWidth: 920, alignSelf: "center", paddingHorizontal: 14, paddingBottom: 40, gap: 11 },
  rideOwnerHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  rideOwnerHeaderCopy: { flex: 1, minWidth: 0 },
  rideOwnerEyebrow: { color: "#fb7185", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  rideOwnerTitle: { color: "#f7f7f8", fontSize: 24, lineHeight: 28, fontWeight: "800" },
  carpoolIconCanvas: { width: 32, height: 26, position: "relative" },
  carpoolIconCanvasCompact: { width: 23, height: 19 },
  carpoolIconRoof: { position: "absolute", left: 7, top: 1, width: 20, height: 12, borderWidth: 2, borderColor: "#60a5fa", borderBottomWidth: 0, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  carpoolIconRoofCompact: { left: 5, width: 15, height: 9, borderWidth: 1.5 },
  carpoolIconBody: { position: "absolute", left: 1, top: 10, width: 31, height: 12, borderWidth: 2, borderColor: "#60a5fa", borderRadius: 5 },
  carpoolIconBodyCompact: { top: 7, width: 23, height: 9, borderWidth: 1.5, borderRadius: 4 },
  carpoolIconWheel: { position: "absolute", top: 20, width: 6, height: 6, borderRadius: 3, backgroundColor: "#60a5fa" },
  carpoolIconWheelCompact: { top: 14, width: 5, height: 5, borderRadius: 3 },
  carpoolIconWheelLeft: { left: 6 },
  carpoolIconWheelRight: { right: 1 },
  rideOwnerHeroCopy: { flex: 1, minWidth: 0 },
  rideOwnerHeroTitle: { color: "#f7f7f8", fontSize: 18, lineHeight: 22, fontWeight: "700" },
  rideOwnerHeroText: { color: "#b6bac0", fontSize: 12, lineHeight: 17, fontWeight: "500", marginTop: 3 },
  rideOwnerCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 12,
    gap: 9
  },
  rideOwnerSectionHeading: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 },
  rideOwnerSectionIcon: { width: 22, height: 22, tintColor: "#c7c9cc" },
  rideOwnerSectionTitle: { color: "#f7f7f8", fontSize: 17, fontWeight: "700" },
  rideOwnerInputRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rideOwnerInput: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.09)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    color: "#f7f7f8",
    paddingHorizontal: 12,
    fontSize: 13,
    fontWeight: "500"
  },
  rideOwnerHalfInput: { flex: 1, minWidth: 145 },
  rideOwnerFieldLabel: { color: "#c7c9cc", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  rideOwnerStatusPillActive: { borderColor: "rgba(59,130,246,0.9)", backgroundColor: "rgba(59,130,246,0.20)" },
  rideOwnerStatusPillText: { color: "#e8eaed", fontSize: 11, fontWeight: "700" },
  rideOwnerStatusWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  rideOwnerStatusPill: {
    color: "#c7c9cc",
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(0,0,0,0.20)",
    paddingHorizontal: 9,
    paddingVertical: 6,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "600"
  },
  rideOwnerRequestCard: { borderRadius: 14, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", padding: 11, gap: 7 },
  rideOwnerRequestTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  rideOwnerRequestTitle: { flex: 1, color: "#f7f7f8", fontSize: 15, lineHeight: 19, fontWeight: "700" },
  rideOwnerRequestBadge: { color: theme.colors.green, backgroundColor: "rgba(34,197,94,0.13)", borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden", fontSize: 10, fontWeight: "700" },
  rideOwnerRequestBadgeExpired: { color: "#fecaca", backgroundColor: "rgba(239,68,68,0.18)" },
  rideOwnerRequestRoute: { color: "#c7c9cc", fontSize: 12, lineHeight: 17, fontWeight: "500" },
  rideOwnerRequestFacts: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  rideOwnerRequestFact: { color: "#f7f7f8", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden", fontSize: 10, fontWeight: "600" },
  rideOwnerLiveLocation: { gap: 2, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(0,201,151,0.14)", borderWidth: 1, borderColor: "rgba(0,201,151,0.32)" },
  rideOwnerLiveLocationTitle: { color: "#63e3b0", fontSize: 11, fontWeight: "800" },
  rideOwnerLiveLocationCopy: { color: "#e1f8ed", fontSize: 11, lineHeight: 16, fontWeight: "600" },
  rideOwnerPickupLabel: { color: "#d8e6e0", fontSize: 11, lineHeight: 16, fontWeight: "600" },
  rideOwnerRequestMeta: { color: "#aeb2b8", fontSize: 11, lineHeight: 16, fontWeight: "500" },
  rideOwnerPinBox: { alignSelf: "flex-start", borderRadius: 14, borderWidth: 1, borderColor: "rgba(34,197,94,0.38)", backgroundColor: "rgba(34,197,94,0.12)", paddingHorizontal: 12, paddingVertical: 8 },
  rideOwnerPinLabel: { color: theme.colors.green, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  rideOwnerPinValue: { color: "#f7f7f8", fontSize: 22, fontWeight: "700", letterSpacing: 3 },
  rideOwnerRequestActionRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  rideOwnerAcceptButton: { minHeight: 38, borderRadius: theme.radius.pill, backgroundColor: theme.colors.blue, justifyContent: "center", paddingHorizontal: 14 },
  rideOwnerDeclineButton: { minHeight: 38, borderRadius: theme.radius.pill, backgroundColor: "rgba(239,68,68,0.88)", justifyContent: "center", paddingHorizontal: 14 },
  rideOwnerActionText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  rideOwnerChatButton: { alignSelf: "flex-start", minHeight: 38, borderRadius: theme.radius.pill, backgroundColor: "rgba(59,130,246,0.18)", borderWidth: 1, borderColor: "rgba(59,130,246,0.42)", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 11 },
  rideOwnerChatIcon: { width: 22, height: 22 },
  rideOwnerChatText: { color: "#f7f7f8", fontSize: 12, fontWeight: "600" },
  rideOwnerEmpty: { borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(0,0,0,0.16)", padding: 12, gap: 4 },
  rideOwnerEmptyTitle: { color: "#f7f7f8", fontSize: 15, fontWeight: "700" },
  rideOwnerEmptyText: { color: "#aeb2b8", fontSize: 12, lineHeight: 17, fontWeight: "500" },
  rentalOwnerScreen: { flex: 1, backgroundColor: "#101010" },
  rentalOwnerContent: { paddingTop: 28, paddingHorizontal: 20, paddingBottom: 72, gap: 16 },
  rentalOwnerHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  rentalOwnerHeaderCopy: { flex: 1, minWidth: 0 },
  rentalOwnerHero: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(15,23,42,0.78)",
    padding: 16,
    flexDirection: "row",
    gap: 14,
    alignItems: "center"
  },
  rentalOwnerHeroIcon: { width: 62, height: 46 },
  rentalOwnerCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 14,
    gap: 12
  },
  rentalOwnerSavedCar: { borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", padding: 12, gap: 3 },
  rentalOwnerSavedTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  rentalOwnerSavedMeta: { color: theme.colors.muted, fontSize: 12, fontWeight: "800" },
  rentalOwnerNotes: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  rentalOwnerSubmit: { minHeight: 52, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" },
  rentalOwnerSubmitText: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  rideListingSuccessBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.78)", alignItems: "center", justifyContent: "center", paddingHorizontal: 22 },
  rideListingSuccessCard: { width: "100%", maxWidth: 420, borderRadius: 28, borderWidth: 1, borderColor: "rgba(34,197,94,0.48)", backgroundColor: "#1b221f", paddingHorizontal: 22, paddingTop: 26, paddingBottom: 30, alignItems: "center", gap: 13 },
  rideListingSuccessIcon: { width: 70, height: 70, borderRadius: 35, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(34,197,94,0.18)", borderWidth: 2, borderColor: theme.colors.green },
  rideListingSuccessCheck: { color: theme.colors.green, fontSize: 38, lineHeight: 43, fontWeight: "900" },
  rideListingSuccessEyebrow: { color: theme.colors.green, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.4, marginTop: 2 },
  rideListingSuccessTitle: { color: "#f7f7f8", fontSize: 25, lineHeight: 31, fontWeight: "900", textAlign: "center" },
  rideListingSuccessRoute: { color: "#d5ddd8", fontSize: 16, lineHeight: 22, fontWeight: "800", textAlign: "center" },
  rideListingSuccessFacts: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 7 },
  rideListingSuccessFact: { color: "#f7f7f8", fontSize: 12, fontWeight: "900", overflow: "hidden", borderRadius: theme.radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.08)", paddingHorizontal: 10, paddingVertical: 6 },
  rideListingSuccessCopy: { color: "#c2cec8", fontSize: 13, lineHeight: 19, fontWeight: "700", textAlign: "center", marginTop: 1, marginBottom: 7 },
  rideListingSuccessShare: { width: "100%", minHeight: 50, borderRadius: theme.radius.pill, borderWidth: 1.4, borderColor: "rgba(65,141,255,0.82)", alignItems: "center", justifyContent: "center", marginTop: 1, backgroundColor: "rgba(65,141,255,0.08)" },
  rideListingSuccessShareText: { color: "#f4f8ff", fontSize: 14, fontWeight: "900" },
  rideListingSuccessPrimary: { width: "100%", minHeight: 66, borderRadius: theme.radius.pill, backgroundColor: theme.colors.green, alignItems: "center", justifyContent: "center", marginTop: 8, shadowColor: theme.colors.green, shadowOpacity: 0.30, shadowRadius: 16, shadowOffset: { width: 0, height: 9 }, elevation: 5 },
  rideListingSuccessPrimaryText: { color: "#06140d", fontSize: 18, fontWeight: "900" },
  rideListingSuccessSecondary: { minHeight: 48, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", marginTop: 2 },
  rideListingSuccessSecondaryText: { color: "#dce7e2", fontSize: 14, fontWeight: "900" },
  ridePlannerScreen: { flex: 1, backgroundColor: "#111" },
  ridePlannerContent: { paddingTop: 26, paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  ridePlannerHandle: { alignSelf: "center", width: 54, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.20)", marginBottom: 2 },
  ridePlannerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  ridePlannerBack: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  ridePlannerBackText: { color: "#f7f7f8", fontSize: 32, lineHeight: 34, fontWeight: "500" },
  ridePlannerTitle: { color: "#f7f7f8", fontSize: 24, fontWeight: "900" },
  ridePlannerPillRow: { flexDirection: "row", gap: 10 },
  rideRequestScheduleField: { flex: 1, minWidth: 0 },
  ridePlannerPill: { backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 10 },
  ridePlannerPillText: { color: "#202124", fontWeight: "900", fontSize: 15 },
  ridePlannerOwnerHint: { color: "#c7c9cc", fontSize: 14, lineHeight: 20, fontWeight: "800" },
  rideRouteInputCard: { flexDirection: "row", alignItems: "center", borderWidth: 2, borderColor: "#35383d", borderRadius: 14, padding: 10, gap: 10 },
  rideRouteRail: { width: 18, alignItems: "center" },
  rideRouteDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#f7f7f8" },
  rideRouteRailLine: { width: 3, height: 42, backgroundColor: "#8d9299" },
  rideRouteSquare: { width: 12, height: 12, backgroundColor: "#f7f7f8" },
  rideRouteInputs: { flex: 1, minWidth: 0, gap: 2 },
  rideRouteInput: { minHeight: 44, color: "#f7f7f8", fontSize: 17, lineHeight: 22, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.14)", paddingHorizontal: 0, paddingRight: 6 },
  rideRouteInputActive: { borderBottomColor: theme.colors.blue },
  rideRoutePlus: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  rideRoutePlusText: { color: "#202124", fontSize: 28, lineHeight: 30 },
  rideTypePrompt: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 12,
    gap: 9
  },
  rideTypePromptTitle: { color: "#f7f7f8", fontSize: 16, fontWeight: "900" },
  rideTypePromptCopy: { color: "#b6bac0", fontSize: 13, lineHeight: 18, fontWeight: "700" },
  rideTypePromptGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rideTypePromptChip: {
    flexGrow: 1,
    minWidth: "30%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  rideTypePromptChipActive: { backgroundColor: "#f7f7f8", borderColor: "#f7f7f8" },
  rideTypePromptChipDisabled: { opacity: 0.52 },
  rideTypePromptChipTitle: { color: "#f7f7f8", fontSize: 13, fontWeight: "900" },
  rideTypePromptChipTitleActive: { color: "#111214" },
  rideTypePromptChipMeta: { color: "#aeb2b8", fontSize: 11, marginTop: 3, fontWeight: "800" },
  rideTypePromptChipMetaActive: { color: "#34373b" },
  rideTripDetails: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.32)",
    backgroundColor: "rgba(59,130,246,0.09)",
    padding: 12,
    gap: 10
  },
  rideTripDetailsTitle: { color: "#f7f7f8", fontSize: 16, fontWeight: "900" },
  rideTripHint: { color: "#b6bac0", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  rideTripDetailsRow: { flexDirection: "row", gap: 10 },
  rideTripField: { flex: 1, minWidth: 0, gap: 5 },
  rideTripFieldFull: { width: "100%", gap: 5 },
  rideTripLabel: { color: "#c7c9cc", fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4 },
  rideTripInput: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    color: "#f7f7f8",
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: "900"
  },
  rideSavedRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rideSavedRowCompact: { flexDirection: "row" },
  rideSavedItem: { flex: 1, minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12 },
  rideSavedIcon: { color: "#c7c9cc", fontSize: 22 },
  rideSavedTitle: { color: "#f7f7f8", fontSize: 16, fontWeight: "900" },
  rideSavedMeta: { color: "#9da1a8", fontSize: 14 },
  rideSuggestionList: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.16)" },
  rideSuggestionHelp: { color: "#9da1a8", fontSize: 14, paddingVertical: 12, fontWeight: "800" },
  rideSuggestionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  rideSuggestionDistance: { width: 56, alignItems: "center" },
  rideSuggestionIcon: { color: "#c7c9cc", fontSize: 22 },
  rideSuggestionMiles: { color: "#9da1a8", fontSize: 12, marginTop: 2 },
  rideSuggestionCopy: { flex: 1, minWidth: 0 },
  rideSuggestionTitle: { color: "#f7f7f8", fontSize: 17, fontWeight: "900" },
  rideSuggestionMeta: { color: "#9da1a8", fontSize: 14, marginTop: 2 },
  rideUtilityRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  rideUtilityIcon: { color: "#c7c9cc", fontSize: 22, width: 42, textAlign: "center" },
  rideUtilityText: { color: "#f0f1f2", fontSize: 16, fontWeight: "900" },
  ridePlannerSearchButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, minHeight: 58, alignItems: "center", justifyContent: "center", marginTop: 4 },
  ridePlannerSearchText: { color: "#ffffff", fontSize: 17, fontWeight: "900" },
  rideSearchLoadingOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 30, backgroundColor: "rgba(8,8,9,0.22)", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  rideSearchLoadingCard: { width: "100%", maxWidth: 378, paddingHorizontal: 12, paddingVertical: 20, alignItems: "center", gap: 10 },
  rideSearchLoadingTitle: { color: "#f7f7f8", ...theme.typography.sectionTitle, marginTop: 4 },
  rideSearchLoadingCopy: { color: "#b6bac0", ...theme.typography.body, textAlign: "center" },
  rideSearchLoadingPromo: { width: 354, height: 237, maxWidth: "100%", borderRadius: theme.radius.sm, marginTop: 6 },
  rideChoiceScreen: { flex: 1, backgroundColor: "#111" },
  rideChoiceMap: { flex: 1, minHeight: 320, backgroundColor: "#202632", overflow: "hidden" },
  rideChoiceMapImage: { ...StyleSheet.absoluteFillObject, opacity: 0.94 },
  rideChoiceMapFallback: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#202632" },
  rideChoiceMapFallbackIcon: { color: theme.colors.accent, fontSize: 34, fontWeight: "900" },
  rideChoiceMapFallbackText: { color: theme.colors.soft, fontSize: 13, fontWeight: "800" },
  rideMapBackButton: { position: "absolute", top: 34, left: 22, width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" },
  rideMapBackText: { color: "#f7f7f8", fontSize: 34, lineHeight: 36 },
  rideMapRouteLine: { position: "absolute", left: "24%", right: "18%", top: "31%", height: 6, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.90)", transform: [{ rotate: "42deg" }] },
  rideMapCarDot: { position: "absolute", width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.text, borderWidth: 5, borderColor: theme.colors.green },
  rideMapPickupLabel: { position: "absolute", top: 78, left: 82, right: 80, backgroundColor: "rgba(0,0,0,0.76)", borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8 },
  rideMapDestinationLabel: { position: "absolute", bottom: 78, right: 28, left: 120, backgroundColor: "rgba(0,0,0,0.76)", borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8 },
  rideMapLabelText: { color: "#f7f7f8", fontSize: 14, fontWeight: "900" },
  rideMapOpenButton: { position: "absolute", right: 16, top: 34, backgroundColor: "rgba(0,0,0,0.72)", borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  rideMapOpenButtonText: { color: "#f7f7f8", fontSize: 12, fontWeight: "900" },
  rideChoiceSheet: { maxHeight: "76%", backgroundColor: "#151515", borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  rideChoiceSheetContent: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 86, gap: 12 },
  rideChoiceTitle: { color: "#f7f7f8", textAlign: "center", fontSize: 26, fontWeight: "900" },
  rideDriverNotify: { color: "#b6bac0", textAlign: "center", fontSize: 12, lineHeight: 17, fontWeight: "700" },
  rideChoiceLifecycle: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 7
  },
  rideChoiceLifecycleTitle: { color: "#f7f7f8", fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  rideChoiceLifecycleSteps: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  rideChoiceLifecyclePill: {
    color: "#c7c9cc",
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(0,0,0,0.22)",
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: "hidden",
    fontSize: 11,
    fontWeight: "900"
  },
  rideChoiceRow: {
    minHeight: 132,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "rgba(58,139,255,0.30)",
    backgroundColor: "rgba(8,24,52,0.92)",
    shadowColor: theme.colors.blue,
    shadowOpacity: 0.15,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 }
  },
  rideChoiceRowActive: { borderColor: theme.colors.blue, backgroundColor: "rgba(12,38,82,0.96)", shadowOpacity: 0.32 },
  rideChoiceRowExpired: { borderColor: "rgba(244,83,128,0.46)", backgroundColor: "rgba(50,14,31,0.66)", shadowColor: "#f45380", shadowOpacity: 0.12 },
  rideChoiceIcon: { width: 46, height: 36 },
  rideChoiceRouteBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(62,145,255,0.58)",
    backgroundColor: "rgba(39,112,245,0.20)"
  },
  rideChoiceRouteBadgeText: { color: "#f7f7f8", fontSize: 11, fontWeight: "800" },
  rideChoiceCopy: { flex: 1, minWidth: 0 },
  rideChoiceName: { color: "#f7f7f8", fontSize: 16, fontWeight: "800", lineHeight: 20 },
  rideChoiceUserTrip: { color: "#c7c9cc", fontSize: 12, marginTop: 4, lineHeight: 16 },
  rideChoiceLister: { color: theme.colors.brand, fontSize: 12, fontWeight: "800", marginTop: 4, lineHeight: 16 },
  rideChoiceSeats: { color: "#c7c9cc", fontSize: 14 },
  rideChoiceMeta: { color: "#b6bac0", fontSize: 12, marginTop: 5, lineHeight: 16 },
  rideChoiceChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 7 },
  rideChoiceChip: {
    color: "#c7c9cc",
    fontSize: 10,
    fontWeight: "800",
    overflow: "hidden",
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  rideChoiceChipExpired: { color: "#fecaca", borderColor: "rgba(248,113,113,0.35)", backgroundColor: "rgba(239,68,68,0.12)" },
  rideChoiceActionRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  rideChoiceSmallButton: {
    minHeight: 30,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 9,
    flexDirection: "row",
    gap: 5
  },
  rideChoiceSmallButtonText: { color: "#f7f7f8", fontSize: 10, fontWeight: "800" },
  rideChoiceRequestButton: { backgroundColor: "#f7f7f8", borderColor: "#f7f7f8", paddingHorizontal: 13 },
  rideChoiceRequestButtonText: { color: "#111214", fontSize: 11, fontWeight: "900" },
  rideChoiceChatButton: { borderColor: "rgba(66,143,255,0.38)", backgroundColor: "rgba(26,78,169,0.18)" },
  rideChoiceChatIcon: { width: 18, height: 15 },
  rideChoiceContribution: { alignItems: "flex-end", gap: 1 },
  rideChoiceAvailability: { flexDirection: "row", alignItems: "center", gap: 6 },
  rideChoiceAvailabilityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.green },
  rideChoiceAvailabilityDotExpired: { backgroundColor: "#f45380" },
  rideChoicePrice: { color: theme.colors.green, fontSize: 17, fontWeight: "900" },
  rideChoicePriceExpired: { color: "#f77ca1" },
  rideChoicePriceMeta: { color: "#aeb2b8", fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
  rideChoiceExpiredMeta: { color: "#fecaca" },
  rideNoOffersCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 16,
    paddingVertical: 15,
    gap: 6
  },
  rideNoOffersTitle: { color: "#f7f7f8", fontSize: 18, fontWeight: "900" },
  rideNoOffersCopy: { color: "#b6bac0", fontSize: 13, lineHeight: 18, fontWeight: "700" },
  ridePaymentRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.08)", paddingHorizontal: 12 },
  ridePaymentIcon: { color: "#f7f7f8", fontSize: 22 },
  ridePaymentArrow: { color: "#c7c9cc", fontSize: 28 },
  rideInlineChatButton: { minHeight: 38, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", backgroundColor: "rgba(255,255,255,0.08)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 9 },
  rideInlineChatIcon: { width: 20, height: 20 },
  rideInlineChatText: { color: "#f7f7f8", fontSize: 11, fontWeight: "900" },
  rideIssueButton: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 13,
    paddingVertical: 11
  },
  rideIssueIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    color: "#fca5a5",
    backgroundColor: "rgba(239,68,68,0.14)",
    textAlign: "center",
    lineHeight: 28,
    fontSize: 16,
    fontWeight: "900"
  },
  rideIssueTitle: { color: "#f7f7f8", fontSize: 13, fontWeight: "800" },
  rideIssueCopy: { color: "#b6bac0", fontSize: 11, lineHeight: 15, marginTop: 2 },
  rideIssueArrow: { color: "#c7c9cc", fontSize: 25, lineHeight: 28 },
  rideRequestStatus: { backgroundColor: "rgba(34,197,94,0.13)", borderWidth: 1, borderColor: "rgba(34,197,94,0.35)", borderRadius: 14, padding: 12 },
  rideRequestStatusText: { color: theme.colors.green, fontSize: 13, lineHeight: 18, fontWeight: "900" },
  rideChoiceButton: { flex: 1, minHeight: 58, borderRadius: 12, backgroundColor: "#f7f7f8", alignItems: "center", justifyContent: "center" },
  rideChoiceButtonText: { color: "#111214", fontSize: 18, fontWeight: "900" },
});
