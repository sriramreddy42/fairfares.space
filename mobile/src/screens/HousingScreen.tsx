import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Location from "expo-location";
import { BlurView } from "expo-blur";
import { ActivityIndicator, Alert, Image, ImageSourcePropType, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { absoluteAssetUrl, createMobileRide, getCars, getMyRentalCarListings, getRideActivity, getRideDriverProfile, getRides, getRidePlaceSuggestions, listRentalCar, quoteRentalCar, respondToRideDispatch, reverseGeocodeRideLocation, rideMapUrl, RidePlaceSuggestion, saveRideDriverProfile, submitAppFeedback, updateMobileRide } from "../api/client";
import { appAssets } from "../assets";
import { HousingCard } from "../components/HousingCard";
import { DateTimeField } from "../components/DateTimeField";
import { EmbeddedRideMap, RideMapPoint } from "../components/RideMap";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { BootstrapPayload, Car, HousingPost, RentalCarListingInput, RentalQuote, RentalSearchInput, RideDriverProfile, RideInput, RidePost, RideType } from "../types";
import { mapDirectionsUrl, mapSearchUrl, nativeMapProviderName } from "../utils/maps";
import { activeFestivalCampaign } from "../utils/festivals";

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
  onOpenMessenger: () => void;
  onNeedSelect: (need: string) => void;
  onAreaSelect: (area: string) => void;
  onOpenSearch: () => void;
  onCategorySelect: (category: string) => void;
  onGenderSelect: (gender: string) => void;
  onBudgetSelect: (budget: string) => void;
  onSortSelect: (sort: "distanceAsc" | "distanceDesc" | "rentAsc" | "rentDesc") => void;
  onPostNeed: (intent?: string) => void;
  onTopAction: (action: string) => void;
  onRequireLogin?: () => void;
  onBookCar: (car: Car, details?: Partial<RentalSearchInput>, paymentOption?: "hold" | "full") => void;
  onBottomTabsHiddenChange?: (hidden: boolean) => void;
  focusWelcomeKey?: number;
  rideOwnerOpenToken?: number;
  rideOwnerOpenTarget?: "workspace" | "requests" | "listings";
  rideOwnerEditId?: string;
  onRideOwnerClosed?: () => void;
};

type CurrentRideLocation = {
  label: string;
  coords: {
    latitude: number;
    longitude: number;
  };
};

const quickLinks: Array<{
  key: "earn" | "cheapRide" | "carpoolMove";
  title: string;
  accent: string;
}> = [
  {
    key: "earn",
    title: "List anywhere in the USA",
    accent: theme.colors.brand
  },
  {
    key: "cheapRide",
    title: "Get cheap rides anywhere in the USA",
    accent: theme.colors.blue
  },
  {
    key: "carpoolMove",
    title: "Moving to another state? Try carpool",
    accent: "#9b5cff"
  }
];
const quickLinkWords = ["RIDES", "RENTALS", "ROOMMATES", "CARPOOL"];
const rentalPromoSlides = [appAssets.rentalCarouselHowItWorks, appAssets.rentalCarouselPriceMatch];

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

const postActions: Array<{ label: string; sub: string; icon: ImageSourcePropType; intent: string; bg: string; tint: string }> = [
  { label: "I need a place", sub: "Post the room, area, budget, and move-in timing you need.", icon: appAssets.bed, intent: "need_place", bg: "#f5e5ff", tint: "#8f3fe7" },
  { label: "I need roommates", sub: "Find the perfect roommates to share and save.", icon: appAssets.roommates, intent: "need_roommates", bg: "#effcf1", tint: "#18b984" },
  { label: "I have a place", sub: "List your property or room and find the right people.", icon: appAssets.bed, intent: "have_place", bg: "#fff2d9", tint: "#f19a22" }
];

const roomTypes: Array<{ label: string; category: string; icon: ImageSourcePropType }> = [
  { label: "Shared Room", category: "shared_room", icon: appAssets.roommates },
  { label: "Single Room", category: "single_room", icon: appAssets.bed },
  { label: "Paying Guest", category: "paying_guest", icon: appAssets.bed }
];

const housingSearchPhrases = ["Search housing anywhere in the USA", "Search a city, area, or building", "Find roommates near your preferred area"];
const rideSearchPhrases = ["Search your ride here", "Where do you want to go?", "Find carpool options near you"];
const rentalSearchPhrases = ["Search rental cars anywhere in the USA", "Find airport pickup cars", "Compare daily and weekly rates"];
const sortOptions: Array<{ label: string; value: Props["selectedSort"] }> = [
  { label: "Distance ↑", value: "distanceAsc" },
  { label: "Distance ↓", value: "distanceDesc" },
  { label: "Rent ↑", value: "rentAsc" },
  { label: "Rent ↓", value: "rentDesc" }
];
const genderOptions = ["Any", "Female", "Male", "Couple", "Family"];
const demoHousingTestimonials: BootstrapPayload["testimonials"] = [
  {
    id: -1,
    name: "Maya P. · Demo",
    city: "Denver, CO",
    avatarEmoji: "🏡",
    demo: true,
    rating: 5,
    message: "The city search made it easy to compare nearby rooms without losing track of my budget."
  },
  {
    id: -2,
    name: "Jordan K. · Demo",
    city: "Aurora, CO",
    avatarEmoji: "🚗",
    demo: true,
    rating: 4,
    message: "I liked having housing, carpools, and rental options together while planning my move."
  },
  {
    id: -3,
    name: "Sam R. · Demo",
    city: "Dayton, OH",
    avatarEmoji: "🎓",
    demo: true,
    rating: 5,
    message: "The filters helped me narrow the search quickly and understand what was available nearby."
  }
];

function formatDeviceAddress(address: Location.LocationGeocodedAddress | null | undefined) {
  if (!address) return "";
  const streetParts = [address.name, address.street].filter(Boolean);
  const street = streetParts.length
    ? Array.from(new Set(streetParts.map((part) => String(part).trim()).filter(Boolean))).join(" ")
    : "";
  const city = address.city || address.subregion || "";
  const region = address.region || "";
  const postal = address.postalCode || "";
  return [street, city, region, postal]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}
const budgetOptions = ["Any", "$700", "$900", "$1,200", "$1,600", "$2,000"];
const renterAgeOptions = ["21-24", "25+"];
const rideModes: Array<{ type: RideType; title: string; copy: string }> = [
  { type: "GENERAL_REQUEST", title: "Request a ride", copy: "Point-to-point ride for today or later." },
  { type: "SCHEDULED_REQUEST", title: "Scheduled", copy: "Recurring commute with daily ride instances." },
  { type: "CARPOOL_REQUEST", title: "Find carpool", copy: "Match with drivers going your direction." },
  { type: "CARPOOL_OFFER", title: "Offer a ride", copy: "List route, seats, luggage, and contribution." }
];
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
    stat: "Example: Denver to Union Station today at 6:00 PM",
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
    stat: "Example: Denver to Colorado Springs or Denver to Cincinnati",
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
const rideOwnerSteps = [
  "List the route, seats, timing, luggage space, and contribution.",
  "Review matching rider requests with pickup, destination, and distance.",
  "Use Chitthi before accepting; acceptance unlocks the pickup PIN and ride-status updates."
];
const rideOwnerRequestStates = ["Listed", "Request", "Accepted", "Arriving", "Completed"];
const rideDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const blankRideDriverProfile: RideDriverProfile = {
  exists: false,
  vehicleMakeModel: "",
  vehicleYear: "",
  vehicleColor: "",
  licensePlate: "",
  licenseState: "",
  insuranceProvider: "",
  insurancePolicyLast4: "",
  serviceTypes: ["CARPOOL_OFFER"],
  availabilityDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  availabilityStartTime: "7:00 AM",
  availabilityEndTime: "7:00 PM",
  seatCount: 4,
  luggageSpace: "1 small bag",
  maxDetourMinutes: 15,
  maxPickupDistanceMiles: 10,
  reviewStatus: "NOT_STARTED",
  readyForOffers: false,
  missing: []
};
const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  const date = new Date(`2026-01-01T${String(hour).padStart(2, "0")}:${minute}:00`);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
});

function isoDateFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
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
  city: "Denver, CO",
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
  onOpenMessenger,
  onNeedSelect,
  onAreaSelect,
  onOpenSearch,
  onCategorySelect,
  onGenderSelect,
  onBudgetSelect,
  onSortSelect,
  onPostNeed,
  onTopAction,
  onRequireLogin,
  onBookCar,
  onBottomTabsHiddenChange,
  focusWelcomeKey = 0,
  rideOwnerOpenToken = 0,
  rideOwnerOpenTarget = "workspace",
  rideOwnerEditId = "",
  onRideOwnerClosed
}: Props) {
  const safeAreaInsets = useSafeAreaInsets();
  const [festivalCampaign, setFestivalCampaign] = useState(() => activeFestivalCampaign());
  const [mode, setMode] = useState<"housing" | "ride" | "cheapCars">("housing");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailPost, setDetailPost] = useState<HousingPost | null>(null);
  const [detailImageIndex, setDetailImageIndex] = useState(0);
  const [detailPreviewImage, setDetailPreviewImage] = useState("");
  const detailCarouselRef = useRef<ScrollView>(null);
  const [searchPhraseIndex, setSearchPhraseIndex] = useState(0);
  const [homeStoryIndex, setHomeStoryIndex] = useState(0);
  const [homeStoryViewportWidth, setHomeStoryViewportWidth] = useState(0);
  const [homeStoryDragging, setHomeStoryDragging] = useState(false);
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
  const [rideActivityBusy, setRideActivityBusy] = useState(false);
  const [rideBusy, setRideBusy] = useState(false);
  const [ridePosted, setRidePosted] = useState(false);
  const [editingRideId, setEditingRideId] = useState("");
  const [rideListingSuccess, setRideListingSuccess] = useState<RidePost | null>(null);
  const [ridePlannerOpen, setRidePlannerOpen] = useState(false);
  const [ridePlannerStage, setRidePlannerStage] = useState<"plan" | "choices">("plan");
  const [rideFocusedField, setRideFocusedField] = useState<"origin" | "destination">("destination");
  const [rideSuggestions, setRideSuggestions] = useState<RidePlaceSuggestion[]>([]);
  const [rideSuggestionsBusy, setRideSuggestionsBusy] = useState(false);
  const [currentRideLocation, setCurrentRideLocation] = useState<CurrentRideLocation | null>(null);
  const [currentRideLocationBusy, setCurrentRideLocationBusy] = useState(false);
  const [currentRideLocationError, setCurrentRideLocationError] = useState("");
  const [selectedRideChoice, setSelectedRideChoice] = useState("");
  const [selectedRideService, setSelectedRideService] = useState<"scheduled" | "general" | "carpool">("carpool");
  const [rideRequestStatus, setRideRequestStatus] = useState("");
  const [rideOwnerOpen, setRideOwnerOpen] = useState(false);
  const [selectedRideOfferSurface, setSelectedRideOfferSurface] = useState<"scheduled" | "general" | "carpool">("carpool");
  const [rideDriverProfile, setRideDriverProfile] = useState<RideDriverProfile | null>(null);
  const [rideDriverDraft, setRideDriverDraft] = useState<RideDriverProfile>(blankRideDriverProfile);
  const [rideDriverBusy, setRideDriverBusy] = useState(false);
  const [rideOwnerPrompt, setRideOwnerPrompt] = useState("");
  const { width: viewportWidth } = useWindowDimensions();
  const compactHousingHome = viewportWidth < 560;
  const housingCardWidth = compactHousingHome
    ? Math.max(164, Math.min(212, (viewportWidth - 38) / 2))
    : 286;
  const scrollRef = useRef<ScrollView | null>(null);
  const lastScrollYRef = useRef(0);
  const ridePlanSubmittingRef = useRef(false);
  const selectedRideSuggestionRef = useRef("");
  const lastRideOwnerOpenTokenRef = useRef(0);
  const rideOwnerScrollRef = useRef<ScrollView | null>(null);
  const homeStoryScrollRef = useRef<ScrollView | null>(null);
  const [searchIsScrolled, setSearchIsScrolled] = useState(false);
  const [rideOwnerTrackerY, setRideOwnerTrackerY] = useState(0);
  const [welcomeY, setWelcomeY] = useState(0);

  const displayName = data?.user?.name?.split(" ")[0] || "there";
  const cityExperienceLocation = data?.location.city || "Denver, CO";
  const cityExperiencePhoto = data?.user?.profilePhotoUrl ? absoluteAssetUrl(data.user.profilePhotoUrl) : "";
  const cityExperienceInitials = (data?.user?.name || "FairFares member")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const homeTestimonials = data?.testimonials?.length ? data.testimonials : demoHousingTestimonials;
  const homeStorySlideWidth = homeStoryViewportWidth || Math.max(1, viewportWidth - 28 - theme.spacing.md * 2);
  const selectedLocationText = (data?.location.selected || data?.location.city || "").trim();
  const distanceReference = selectedLocationText.includes("·")
    ? selectedLocationText.split("·").pop()?.trim()
    : data?.location.suggested || data?.location.city || "";

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
  const rideDefaultCity = data?.location.city || "Denver, CO";
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
  const sortedPosts = useMemo(() => {
    const compareOptionalNumber = (a: number | null | undefined, b: number | null | undefined, descending = false) => {
      const aKnown = a !== null && a !== undefined && Number.isFinite(Number(a));
      const bKnown = b !== null && b !== undefined && Number.isFinite(Number(b));
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (!aKnown || !bKnown) return 0;
      return descending ? Number(b) - Number(a) : Number(a) - Number(b);
    };
    return [...posts].sort((a, b) => {
      if (Boolean(a.sample) !== Boolean(b.sample)) return a.sample ? 1 : -1;
      if (selectedSort === "distanceDesc") return compareOptionalNumber(a.distanceMiles, b.distanceMiles, true);
      if (selectedSort === "rentAsc") return compareOptionalNumber(a.rentValue || null, b.rentValue || null);
      if (selectedSort === "rentDesc") return compareOptionalNumber(a.rentValue || null, b.rentValue || null, true);
      return compareOptionalNumber(a.distanceMiles, b.distanceMiles);
    });
  }, [posts, selectedSort]);
  const localities = useMemo(() => {
    const groups = new Map<string, { total: number; count: number; offered: number; needed: number }>();
    posts.filter((post) => !post.sample).forEach((post) => {
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
  const rentalRows = rentalSearched ? rentalCars : [];
  const rentalLocationOptions = useMemo(() => {
    const locations = new Set<string>();
    cars.forEach((car) => {
      if (car.location?.trim()) locations.add(car.location.trim());
    });
    if (rentalSearch.pickupLocation.trim()) locations.add(rentalSearch.pickupLocation.trim());
    if (rentalSearch.returnLocation.trim()) locations.add(rentalSearch.returnLocation.trim());
    return Array.from(locations);
  }, [cars, rentalSearch.pickupLocation, rentalSearch.returnLocation]);
  const rentalDayCount = rentalDays(rentalSearch);
  const rentalTier = durationRateTier(rentalDayCount);
  const calendarDates = useMemo(() => dateOptionsFromToday(90), []);
  const detailImages = detailPost
    ? (detailPost.images?.length ? detailPost.images : detailPost.imageUrl ? [detailPost.imageUrl] : []).slice(0, 4)
    : [];
  const detailImageWidth = Math.max(260, Math.min(viewportWidth - theme.spacing.md * 4, 620));

  useEffect(() => {
    setDetailImageIndex(0);
  }, [detailPost?.id]);

  function showNextDetailImage() {
    if (detailImages.length < 2) return;
    const nextIndex = (detailImageIndex + 1) % detailImages.length;
    detailCarouselRef.current?.scrollTo({ x: nextIndex * detailImageWidth, animated: true });
    setDetailImageIndex(nextIndex);
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleMidnightRefresh = () => {
      const now = new Date();
      const nextDay = new Date(now);
      nextDay.setHours(24, 0, 1, 0);
      timer = setTimeout(() => {
        setFestivalCampaign(activeFestivalCampaign());
        scheduleMidnightRefresh();
      }, Math.max(1000, nextDay.getTime() - now.getTime()));
    };
    scheduleMidnightRefresh();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchPhraseIndex((value) => (value + 1) % activeSearchPhrases.length);
    }, 1800);
    return () => clearTimeout(timer);
  }, [activeSearchPhrases.length, searchPhraseIndex]);

  useEffect(() => {
    if (!data?.user || data.hasSubmittedHousingExperience || cityExperienceSubmitted) return;
    const timer = setTimeout(() => {
      setCityExperienceModalOpen(true);
    }, 3 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [cityExperienceSubmitted, data?.hasSubmittedHousingExperience, data?.user?.id]);

  useEffect(() => {
    const storyCount = 1 + homeTestimonials.length;
    if (storyCount <= 1) {
      setHomeStoryIndex(0);
      return;
    }
    if (homeStoryDragging) return;
    const timer = setTimeout(() => {
      setHomeStoryIndex((value) => (value + 1) % storyCount);
    }, 4000);
    return () => clearTimeout(timer);
  }, [homeStoryDragging, homeStoryIndex, homeTestimonials.length]);

  useEffect(() => {
    if (!homeStorySlideWidth) return;
    homeStoryScrollRef.current?.scrollTo({ x: homeStoryIndex * homeStorySlideWidth, animated: true });
  }, [homeStoryIndex, homeStorySlideWidth]);

  useEffect(() => {
    setSearchPhraseIndex(0);
  }, [mode]);

  useEffect(() => {
    const isComplete = quickLinkLetterCount >= currentQuickLinkWord.length;
    const timer = setTimeout(() => {
      if (isComplete) {
        setQuickLinkWordIndex((value) => (value + 1) % quickLinkWords.length);
        setQuickLinkLetterCount(1);
        return;
      }
      setQuickLinkLetterCount((value) => value + 1);
    }, isComplete ? 1200 : 85);
    return () => clearTimeout(timer);
  }, [currentQuickLinkWord.length, quickLinkLetterCount]);

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
    if (selectedNeed === "ride_need" || selectedNeed === "ride_offer") {
      setMode("ride");
      setRideForm((current) => ({
        ...current,
        rideType: selectedNeed === "ride_offer" ? "CARPOOL_OFFER" : "CARPOOL_REQUEST"
      }));
    }
  }, [selectedNeed]);

  useEffect(() => {
    if (!focusWelcomeKey) return;
    setMode("housing");
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(welcomeY - 92, 0), animated: true });
    }, 120);
    return () => clearTimeout(timer);
  }, [focusWelcomeKey, welcomeY]);

  useEffect(() => {
    if (!rideOwnerOpenToken || rideOwnerOpenToken === lastRideOwnerOpenTokenRef.current) return;
    lastRideOwnerOpenTokenRef.current = rideOwnerOpenToken;
    if (rideOwnerEditId) {
      void getRideActivity().then((rows) => {
        const ride = rows.find((item) => item.id === rideOwnerEditId && item.activityRole === "MINE" && !item.isExpired);
        if (!ride) {
          Alert.alert("Ride unavailable", "Only your current ride listings and requests can be edited.");
          return;
        }
        setEditingRideId(ride.id);
        setRideForm({
          rideType: ride.type,
          city: ride.city || data?.location.city || "Denver, CO",
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
          preferences: ride.preferences || "",
          notes: ride.notes || ""
        });
        setMode("ride");
        setSelectedRideService("carpool");
        setRidePlannerStage("plan");
        setRidePlannerOpen(true);
        onBottomTabsHiddenChange?.(true);
      }).catch((error) => Alert.alert("Could not edit ride", error instanceof Error ? error.message : "Please try again."));
      return;
    }
    void openRideOwnerTracker();
  }, [rideOwnerEditId, rideOwnerOpenTarget, rideOwnerOpenToken]);

  useEffect(() => {
    if (!rideOwnerOpen || rideOwnerOpenTarget === "workspace" || !rideOwnerTrackerY) return;
    const timer = setTimeout(() => rideOwnerScrollRef.current?.scrollTo({ y: Math.max(rideOwnerTrackerY - 16, 0), animated: true }), 220);
    return () => clearTimeout(timer);
  }, [rideActivityBusy, rideOwnerOpen, rideOwnerOpenTarget, rideOwnerTrackerY]);

  useEffect(() => {
    if (!ridePlannerOpen || ridePlannerStage !== "plan") return;
    const query = (rideFocusedField === "origin" ? rideForm.origin : rideForm.destination).trim();
    if (!query || query === selectedRideSuggestionRef.current) {
      setRideSuggestions([]);
      setRideSuggestionsBusy(false);
      return;
    }
    const timer = setTimeout(() => {
      setRideSuggestionsBusy(true);
      getRidePlaceSuggestions(rideForm.city || data?.location.city || "Denver, CO", query, rideFocusedField === "origin")
        .then(setRideSuggestions)
        .catch(() => setRideSuggestions([]))
        .finally(() => setRideSuggestionsBusy(false));
    }, 260);
    return () => clearTimeout(timer);
  }, [data?.location.city, rideFocusedField, rideForm.city, rideForm.destination, rideForm.origin, ridePlannerOpen, ridePlannerStage]);

  function updateScrollVisibility(y: number) {
    const nextSearchIsScrolled = y > 8;
    setSearchIsScrolled((current) => current === nextSearchIsScrolled ? current : nextSearchIsScrolled);
    const previous = lastScrollYRef.current;
    if (Math.abs(y - previous) < 18) return;
    onBottomTabsHiddenChange?.(y > previous && y > 80);
    lastScrollYRef.current = y;
  }

  async function resolveCurrentRideLocation() {
    if (currentRideLocation) return currentRideLocation;
    if (currentRideLocationBusy) return null;
    setCurrentRideLocationBusy(true);
    setCurrentRideLocationError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED) {
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
  }

  async function useCurrentRideLocationForOrigin() {
    const location = await resolveCurrentRideLocation();
    if (!location?.label) return;
    selectedRideSuggestionRef.current = location.label;
    setRideForm((current) => ({
      ...current,
      origin: location.label,
      originLat: location.coords.latitude,
      originLng: location.coords.longitude
    }));
  }

  function openRidePlanner() {
    setMode("ride");
    setRidePlannerStage("plan");
    setRideFocusedField("destination");
    setRideSuggestions([]);
    setRideSuggestionsBusy(false);
    setRideRequestStatus("");
    setSelectedRideChoice("");
    setRideForm((current) => ({
      ...current,
      city: rideDefaultCity || current.city || "Denver, CO",
      origin: rideDefaultPickup,
      originLat: currentRideLocation?.coords.latitude ?? current.originLat ?? null,
      originLng: currentRideLocation?.coords.longitude ?? current.originLng ?? null,
      destination: "",
      destinationLat: null,
      destinationLng: null,
      rideType: "CARPOOL_REQUEST"
    }));
    setRidePlannerOpen(true);
    onBottomTabsHiddenChange?.(true);
    void useCurrentRideLocationForOrigin();
  }

  function closeRidePlanner() {
    setRidePlannerOpen(false);
    onBottomTabsHiddenChange?.(false);
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

  async function openRideOwnerTracker() {
    setMode("ride");
    setRideOwnerOpen(true);
    setRideOwnerPrompt("");
    onBottomTabsHiddenChange?.(true);
    if (!data?.user) return;
    setRideDriverBusy(true);
    try {
      const profile = await getRideDriverProfile();
      const carpoolProfile = { ...profile, serviceTypes: ["CARPOOL_OFFER" as RideType] };
      setRideDriverProfile(carpoolProfile);
      setRideDriverDraft({ ...blankRideDriverProfile, ...carpoolProfile });
      if (!carpoolProfile.readyForOffers && carpoolProfile.missing?.length) {
        setRideOwnerPrompt(`Complete and save these driver details first: ${carpoolProfile.missing.join(", ")}.`);
      }
    } catch {
      setRideDriverProfile(null);
      setRideOwnerPrompt("Save your driver profile first. Add vehicle, plate/state, insurance, and carpool service type to list a ride.");
    } finally {
      setRideDriverBusy(false);
    }
    void refreshRideActivity();
  }

  function openQuickLink(key: (typeof quickLinks)[number]["key"]) {
    if (key === "earn") {
      void openRideOwnerTracker();
      return;
    }
    openRidePlanner();
    setSelectedRideService("carpool");
    setRideForm((current) => ({ ...current, rideType: "CARPOOL_REQUEST" }));
  }

  function closeRideOwnerTracker() {
    setRideOwnerOpen(false);
    setRideOwnerPrompt("");
    onBottomTabsHiddenChange?.(false);
    onRideOwnerClosed?.();
  }

  function updateRideDriverDraft<K extends keyof RideDriverProfile>(key: K, value: RideDriverProfile[K]) {
    setRideDriverDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleRideDriverListValue(key: "serviceTypes" | "availabilityDays", value: string) {
    setRideDriverDraft((current) => {
      const currentValues = new Set((current[key] || []) as string[]);
      if (currentValues.has(value)) {
        currentValues.delete(value);
      } else {
        currentValues.add(value);
      }
      return { ...current, [key]: Array.from(currentValues) } as RideDriverProfile;
    });
  }

  function selectRideOfferSurface(surface: (typeof rideOfferSurfaces)[number]) {
    if (!surface.available) {
      Alert.alert("Available soon", `${surface.title} will be available soon. For now, list carpool seats and track rider requests here.`);
      return;
    }
    setSelectedRideOfferSurface(surface.key);
    setRideDriverDraft((current) => {
      const nextTypes = new Set(current.serviceTypes || []);
      nextTypes.add("CARPOOL_OFFER");
      return {
        ...current,
        serviceTypes: Array.from(nextTypes) as RideType[]
      };
    });
  }

  async function saveRideOwnerProfile(openListingAfterSave = false) {
    if (!data?.user) {
      Alert.alert("Login required", "Please login before saving driver details.");
      return;
    }
    setRideDriverBusy(true);
    try {
      const carpoolDraft = { ...rideDriverDraft, serviceTypes: ["CARPOOL_OFFER" as RideType] };
      const profile = await saveRideDriverProfile(carpoolDraft);
      setRideDriverProfile(profile);
      setRideDriverDraft({ ...blankRideDriverProfile, ...profile });
      setRideOwnerPrompt(
        profile.readyForOffers
          ? "Driver profile saved. Opening the route listing form."
          : `Almost there. Add missing details: ${(profile.missing || []).join(", ")}.`
      );
      void refreshRideActivity();
      if (profile.readyForOffers && openListingAfterSave) {
        openRideOfferPlanner(profile);
      } else {
        Alert.alert("Driver profile saved", profile.readyForOffers ? "You can now list route and available seats." : `Add missing details: ${(profile.missing || []).join(", ")}`);
      }
    } catch (error) {
      Alert.alert("Could not save driver profile", error instanceof Error ? error.message : "Try again.");
    } finally {
      setRideDriverBusy(false);
    }
  }

  function openRideOfferPlanner(profile?: RideDriverProfile | null) {
    const offerSurface = rideOfferSurfaces.find((item) => item.key === "carpool") || rideOfferSurfaces[0];
    setMode("ride");
    setRideOwnerOpen(false);
    setSelectedRideService(offerSurface.key);
    setRidePlannerStage("plan");
    setRideFocusedField("destination");
    setRideSuggestions([]);
    setRideSuggestionsBusy(false);
    setRideRequestStatus(profile?.readyForOffers ? "" : "You can plan the route now. Driver profile is checked when you save the listing.");
    setSelectedRideChoice("");
    setRideForm((current) => ({
      ...current,
      city: rideDefaultCity || current.city || "Denver, CO",
      origin: rideDefaultPickup,
      originLat: currentRideLocation?.coords.latitude ?? current.originLat ?? null,
      originLng: currentRideLocation?.coords.longitude ?? current.originLng ?? null,
      destination: "",
      destinationLat: null,
      destinationLng: null,
      rideType: "CARPOOL_OFFER",
      seats: current.seats === "1" ? "4" : current.seats,
      luggage: current.luggage || "1 small bag",
      maxDetourMinutes: current.maxDetourMinutes || "15",
      maxPickupDistanceMiles: "50",
      contributionPerSeat: current.contributionPerSeat || "",
      preferences: current.preferences || offerSurface.title,
      notes: current.notes || offerSurface.note
    }));
    setRidePlannerOpen(true);
    onBottomTabsHiddenChange?.(true);
    void useCurrentRideLocationForOrigin();
  }

  async function startRideOfferListing() {
    if (!data?.user) {
      onRequireLogin?.();
      return;
    }
    let currentProfile = rideDriverProfile;
    if (!currentProfile) {
      setRideDriverBusy(true);
      try {
        const profile = await getRideDriverProfile();
        currentProfile = { ...profile, serviceTypes: ["CARPOOL_OFFER" as RideType] };
        setRideDriverProfile(currentProfile);
        setRideDriverDraft({ ...blankRideDriverProfile, ...currentProfile });
      } catch {
        currentProfile = null;
      } finally {
        setRideDriverBusy(false);
      }
    }
    if (!currentProfile?.readyForOffers) {
      setMode("ride");
      setRideOwnerOpen(true);
      setRidePlannerOpen(false);
      onBottomTabsHiddenChange?.(true);
      setRideDriverDraft({ ...blankRideDriverProfile, ...(currentProfile || {}), serviceTypes: ["CARPOOL_OFFER"] });
      setRideOwnerPrompt("Save your driver profile first. After it is ready, this poster opens the list-your-ride form.");
      return;
    }
    openRideOfferPlanner(currentProfile);
  }

  function selectRidePlace(place: RidePlaceSuggestion) {
    const selectedField = rideFocusedField;
    selectedRideSuggestionRef.current = place.label;
    setRideForm((current) => ({
      ...current,
      [rideFocusedField]: place.label,
      ...(rideFocusedField === "origin"
        ? { originLat: place.lat, originLng: place.lng }
        : { destinationLat: place.lat, destinationLng: place.lng })
    }));
    if (selectedField === "origin") {
      setRideFocusedField("destination");
    } else if (rideForm.rideType !== "CARPOOL_OFFER") {
      setRideSuggestions([]);
      void planRideRoute(place, "CARPOOL_REQUEST");
    }
  }

  function openRidePlannerWithSuggestion(place: RidePlaceSuggestion) {
    selectedRideSuggestionRef.current = place.label;
    setMode("ride");
    setSelectedRideService("carpool");
    setRidePlannerStage("plan");
    setRideFocusedField("destination");
    setRideSuggestions([]);
    setRideSuggestionsBusy(false);
    setRideRequestStatus("");
    setSelectedRideChoice("");
    setRideForm((current) => ({
      ...current,
      city: rideDefaultCity,
      origin: rideDefaultPickup,
      originLat: currentRideLocation?.coords.latitude ?? current.originLat ?? null,
      originLng: currentRideLocation?.coords.longitude ?? current.originLng ?? null,
      destination: place.label,
      destinationLat: place.lat,
      destinationLng: place.lng,
      rideType: "CARPOOL_REQUEST"
    }));
    setRidePlannerOpen(true);
    onBottomTabsHiddenChange?.(true);
    void useCurrentRideLocationForOrigin();
    void planRideRoute(place, "CARPOOL_REQUEST");
  }

  function ridePlanComplete() {
    return Boolean(rideForm.origin.trim() && rideForm.destination.trim());
  }

  function estimateRideMiles(originValue = rideForm.origin, destinationValue = rideForm.destination, rows = rideRows) {
    const matched = rows.find((ride) => ride.distanceMiles !== null);
    if (matched?.distanceMiles !== null && matched?.distanceMiles !== undefined) {
      return Math.max(1, Number(matched.distanceMiles) + 3);
    }
    const origin = originValue.toLowerCase();
    const destination = destinationValue.toLowerCase();
    if (origin.includes("airport") || destination.includes("airport")) return 24;
    if (origin.includes("union") || destination.includes("union")) return 5;
    if (origin.includes("colorado springs") || destination.includes("colorado springs")) return 69;
    if (origin.includes("fort collins") || destination.includes("fort collins")) return 64;
    if (origin.includes("cincinnati") || destination.includes("cincinnati")) return 1180;
    if (origin.includes("indianapolis") || destination.includes("indianapolis")) return 1080;
    if (origin.includes("chicago") || destination.includes("chicago")) return 1000;
    if (origin.includes("dallas") || destination.includes("dallas")) return 790;
    if (origin.includes("salt lake") || destination.includes("salt lake")) return 520;
    if (rows.length) {
      const rowMiles = rows.find((ride) => ride.distanceMiles !== null)?.distanceMiles;
      if (rowMiles !== null && rowMiles !== undefined) return Math.max(1, Number(rowMiles) + 3);
    }
    return 8;
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

  function shouldSuggestCarpool(origin: string, destination: string) {
    return estimateRideMiles(origin, destination, []) >= 50;
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

  async function planRideRoute(selectedDestination?: RidePlaceSuggestion, requestedRideType: RideType = rideForm.rideType) {
    if (ridePlanSubmittingRef.current) return;
    const submittedDestination = selectedDestination?.label || rideForm.destination.trim();
    if (!submittedDestination) {
      Alert.alert("Destination needed", "Enter where you want to go.");
      return;
    }
    ridePlanSubmittingRef.current = true;
    const effectiveOrigin = rideForm.origin.trim() || selectedLocationText || rideForm.city || "Denver, CO";
    let effectiveDestination = submittedDestination;
    const listingRide = requestedRideType === "CARPOOL_OFFER";
    const destinationAlreadyPicked = Boolean(
      selectedDestination ||
        (rideForm.destination.trim() &&
        (rideForm.destinationLat !== null ||
          rideForm.destinationLng !== null ||
          rideForm.destination.trim() === selectedRideSuggestionRef.current))
    );
    setRideBusy(true);
    try {
      let destinationPoint: RidePlaceSuggestion | undefined = selectedDestination;
      if (!destinationAlreadyPicked) {
        const destinationMatches = await getRidePlaceSuggestions(rideForm.city, effectiveDestination);
        destinationPoint = destinationMatches[0];
        if (destinationPoint?.label) {
          effectiveDestination = destinationPoint.label;
        }
      }
      selectedRideSuggestionRef.current = effectiveDestination;
      const nextRideType: RideType = listingRide ? "CARPOOL_OFFER" : "CARPOOL_REQUEST";
      setSelectedRideService("carpool");
      const nextRideForm = {
        ...rideForm,
        origin: effectiveOrigin,
        destination: effectiveDestination,
        destinationLat: destinationPoint?.lat ?? rideForm.destinationLat ?? null,
        destinationLng: destinationPoint?.lng ?? rideForm.destinationLng ?? null,
        rideType: nextRideType
      };
      setRideForm((current) => ({
        ...current,
        origin: effectiveOrigin,
        destination: effectiveDestination,
        destinationLat: destinationPoint?.lat ?? current.destinationLat ?? null,
        destinationLng: destinationPoint?.lng ?? current.destinationLng ?? null,
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
        setRideOwnerPrompt("Ride listed. Requests on the same corridor will appear in your Request tracker with route details, status, pickup PIN, and Chitthi.");
        void refreshRideActivity();
        return;
      }
      const searchRideType: RideType = "CARPOOL_OFFER";
      const rides = await getRides(rideForm.city, effectiveOrigin, effectiveDestination, searchRideType, {
        originLat: rideForm.originLat,
        originLng: rideForm.originLng,
        destinationLat: destinationPoint?.lat ?? rideForm.destinationLat,
        destinationLng: destinationPoint?.lng ?? rideForm.destinationLng
      });
      setRideRows(rides);
      setSelectedRideChoice("");
      setRidePlannerStage("choices");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to search rides.";
      if (listingRide && message.toLowerCase().includes("driver profile")) {
        setRidePlannerOpen(false);
        setRideOwnerOpen(true);
        onBottomTabsHiddenChange?.(true);
        setRideOwnerPrompt(`${message} Save your driver profile, then tap List your ride again.`);
        Alert.alert("Driver profile needed", message);
      } else {
        Alert.alert(listingRide ? "Ride listing failed" : "Ride search failed", message);
      }
    } finally {
      setRideBusy(false);
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
      const result = await createMobileRide({
        ...rideForm,
        rideType: rideForm.rideType === "CARPOOL_OFFER" ? "CARPOOL_REQUEST" : rideForm.rideType,
        notes: [rideForm.notes, `${selectedLabel} selected.`]
          .filter(Boolean)
          .join(" ")
      });
      const ride = result.ride;
      if (!ride) throw new Error("Ride request was not saved.");
      setRideRows((current) => [ride, ...current.filter((item) => item.id !== ride.id)]);
      setRidePosted(true);
      const notifiedCount = Number(result.dispatch?.notifiedCount || 0);
      const radius = Number(result.dispatch?.nearestRadius || 0);
      void refreshRideActivity();
      setRideRequestStatus(
        notifiedCount
          ? `Request sent to ${notifiedCount} nearby driver offer${notifiedCount === 1 ? "" : "s"} within ${radius || 10} miles. You can use Chitthi with a selected listing owner before acceptance; the pickup PIN appears after acceptance.`
          : "Request saved. FairFares will keep checking nearby driver offers. Select a specific driver offer to message in Chitthi before acceptance."
      );
      Alert.alert("Ride request sent", selectedOffer
        ? "You can message this driver in Chitthi now. Acceptance confirms the seat and unlocks the pickup PIN."
        : "When a driver accepts your general request, you can coordinate the pickup, ETA, and PIN in Chitthi.", [
        { text: "Stay here", style: "cancel" },
        { text: "Open Chitthi", onPress: () => selectedOffer ? onRideMessage(selectedOffer) : onOpenMessenger() }
      ]);
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
    const query = post.lat && post.lng ? `${post.lat},${post.lng}` : `${post.title} ${post.location} ${post.area}`.trim();
    void Linking.openURL(mapSearchUrl(query));
  }

  function openRideGoogleMaps() {
    const origin = rideForm.origin || selectedLocationText || rideForm.city || "Denver, CO";
    const destination = rideForm.destination || rideForm.city || "Denver, CO";
    void Linking.openURL(mapDirectionsUrl(origin, destination));
  }

  function renderRideOwnerTracker() {
    const incomingRequestRows = rideActivityRows.filter((ride) => {
      if (ride.activityRole !== "DRIVER_NOTIFICATION" || ride.isExpired) return false;
      const status = String(ride.dispatchStatus || ride.status || "PENDING").toUpperCase();
      return ["PENDING", "REQUESTED", "MATCHING", "ACTIVE", "OPEN"].includes(status);
    }).slice(0, 8);
    const listedRouteRows = rideActivityRows.filter((ride) => ride.activityRole === "MINE" && ride.role === "DRIVER").slice(0, 4);
    const requestRows = rideOwnerOpenTarget === "listings"
      ? listedRouteRows
      : rideOwnerOpenTarget === "requests"
        ? incomingRequestRows
        : incomingRequestRows.length ? incomingRequestRows : listedRouteRows;
    const trackerTitle = rideOwnerOpenTarget === "listings" ? "Your listings" : rideOwnerOpenTarget === "requests" ? "Rider requests" : "Request tracker";
    return (
      <Modal visible={rideOwnerOpen} animationType="slide" onRequestClose={closeRideOwnerTracker}>
        <SafeAreaView style={styles.rideOwnerScreen} edges={["right", "bottom", "left"]}>
          <ScrollView
            ref={rideOwnerScrollRef}
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
                <Text style={styles.rideOwnerEyebrow}>Driver workspace</Text>
                <Text style={styles.rideOwnerTitle}>Offer a ride</Text>
              </View>
            </View>

            <View style={styles.rideOwnerHero}>
              <View style={styles.rideOwnerHeroIcon}><CarpoolOutlineIcon /></View>
              <View style={styles.rideOwnerHeroCopy}>
                <Text style={styles.rideOwnerHeroTitle}>List your route and available seats.</Text>
                <Text style={styles.rideOwnerHeroText}>
                  Add the route, timing, seats and contribution. Matching requests appear below with route fit and Chitthi.
                </Text>
              </View>
            </View>

            <View style={styles.rideOwnerCard}>
              <View style={styles.rideOwnerRequestTop}>
                <View style={styles.rideOwnerSectionHeading}><Image source={appAssets.profile} style={styles.rideOwnerSectionIcon} resizeMode="contain" /><Text style={styles.rideOwnerSectionTitle}>Driver profile</Text></View>
                <Text style={styles.rideOwnerRequestBadge}>
                  {rideDriverProfile?.readyForOffers ? "Ready" : rideDriverProfile?.reviewStatus?.replace(/_/g, " ") || "Not started"}
                </Text>
              </View>
              <Text style={styles.rideOwnerEmptyText}>
                Save your vehicle, insurance, and carpool service details. Route timing, seats, luggage, radius, and contribution are entered when you list a specific trip.
              </Text>
              {rideOwnerPrompt ? <Text style={styles.rideOwnerPrompt}>{rideOwnerPrompt}</Text> : null}
              <TextInput
                style={styles.rideOwnerInput}
                placeholder="Vehicle make/model, e.g. Toyota Camry"
                placeholderTextColor={theme.colors.muted}
                value={rideDriverDraft.vehicleMakeModel || ""}
                onChangeText={(value) => updateRideDriverDraft("vehicleMakeModel", value)}
              />
              <View style={styles.rideOwnerInputRow}>
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Year"
                  placeholderTextColor={theme.colors.muted}
                  value={rideDriverDraft.vehicleYear || ""}
                  onChangeText={(value) => updateRideDriverDraft("vehicleYear", value)}
                />
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Color"
                  placeholderTextColor={theme.colors.muted}
                  value={rideDriverDraft.vehicleColor || ""}
                  onChangeText={(value) => updateRideDriverDraft("vehicleColor", value)}
                />
              </View>
              <View style={styles.rideOwnerInputRow}>
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Plate"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="characters"
                  value={rideDriverDraft.licensePlate || ""}
                  onChangeText={(value) => updateRideDriverDraft("licensePlate", value)}
                />
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="State"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="characters"
                  value={rideDriverDraft.licenseState || ""}
                  onChangeText={(value) => updateRideDriverDraft("licenseState", value)}
                />
              </View>
              <View style={styles.rideOwnerInputRow}>
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Insurance provider"
                  placeholderTextColor={theme.colors.muted}
                  value={rideDriverDraft.insuranceProvider || ""}
                  onChangeText={(value) => updateRideDriverDraft("insuranceProvider", value)}
                />
                <TextInput
                  style={[styles.rideOwnerInput, styles.rideOwnerHalfInput]}
                  placeholder="Policy last 4"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="number-pad"
                  value={rideDriverDraft.insurancePolicyLast4 || ""}
                  onChangeText={(value) => updateRideDriverDraft("insurancePolicyLast4", value)}
                />
              </View>
              <Text style={styles.rideOwnerFieldLabel}>Services you can provide</Text>
              <View style={styles.rideOwnerStatusWrap}>
                {([
                  ["GENERAL_REQUEST", "General rides soon", false],
                  ["SCHEDULED_REQUEST", "Scheduled rides soon", false],
                  ["CARPOOL_OFFER", "Carpool seats", true]
                ] as Array<[RideType, string, boolean]>).filter(([, , enabled]) => enabled).map(([value, label, enabled]) => (
                  <TouchableOpacity
                    key={value}
                    style={[
                      styles.rideOwnerStatusPill,
                      !enabled && styles.rideOwnerStatusPillDisabled,
                      rideDriverDraft.serviceTypes.includes(value as RideType) && styles.rideOwnerStatusPillActive
                    ]}
                    onPress={() => {
                      if (!enabled) {
                        Alert.alert("Available soon", `${label} will be available soon. Carpool seats are open now.`);
                        return;
                      }
                      updateRideDriverDraft("serviceTypes", ["CARPOOL_OFFER"]);
                    }}
                  >
                    <Text style={styles.rideOwnerStatusPillText}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.rideOwnerRouteNote}>
                <Text style={styles.rideOwnerRouteNoteTitle}>Trip details happen when you travel</Text>
                <Text style={styles.rideOwnerRouteNoteText}>
                  After this profile is saved, tap List your ride and enter where you are going, when you leave, seats available, luggage, and contribution for that trip.
                </Text>
              </View>
              <TouchableOpacity style={styles.rideOwnerSaveButton} onPress={() => void saveRideOwnerProfile(true)} disabled={rideDriverBusy}>
                <CarpoolOutlineIcon compact />
                <Text style={styles.rideOwnerSaveText}>{rideDriverBusy ? "Saving..." : "Save and list your ride"}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.rideOwnerCard}>
              <View style={styles.rideOwnerSectionHeading}><Image source={appAssets.serviceModify} style={styles.rideOwnerSectionIcon} resizeMode="contain" /><Text style={styles.rideOwnerSectionTitle}>How it works</Text></View>
              {rideOwnerSteps.map((step, index) => (
                <View key={step} style={styles.rideOwnerStep}>
                  <Text style={styles.rideOwnerStepNumber}>{index + 1}</Text>
                  <Text style={styles.rideOwnerStepText}>{step}</Text>
                </View>
              ))}
            </View>

            <View style={styles.rideOwnerCard} onLayout={(event) => setRideOwnerTrackerY(event.nativeEvent.layout.y)}>
              <View style={styles.rideOwnerSectionHeading}><Image source={appAssets.navActivity} style={styles.rideOwnerSectionIcon} resizeMode="contain" /><Text style={styles.rideOwnerSectionTitle}>{trackerTitle}</Text></View>
              {rideActivityBusy ? <Text style={styles.rideOwnerEmptyText}>Refreshing ride activity...</Text> : null}
              <View style={styles.rideOwnerStatusWrap}>
                {rideOwnerRequestStates.map((state) => (
                  <Text key={state} style={styles.rideOwnerStatusPill}>{state}</Text>
                ))}
              </View>
              {requestRows.length ? (
                requestRows.map((ride) => {
                  const status = String(ride.isExpired ? "EXPIRED" : ride.dispatchStatus || (ride.activityRole === "DRIVER_NOTIFICATION" ? "PENDING" : "LISTED")).toUpperCase();
                  const isIncoming = ride.activityRole === "DRIVER_NOTIFICATION";
                  const canAccept = isIncoming && ["PENDING", "REQUESTED", "MATCHING", "ACTIVE", "OPEN"].includes(status);
                  const canAdvance = isIncoming && ["ACCEPTED", "EN_ROUTE", "ARRIVED"].includes(status);
                  const nextAction = status === "ACCEPTED" ? "EN_ROUTE" : status === "EN_ROUTE" ? "ARRIVED" : status === "ARRIVED" ? "COMPLETED" : null;
                  const nextLabel = status === "ACCEPTED" ? "Mark en route" : status === "EN_ROUTE" ? "Mark arrived" : status === "ARRIVED" ? "Complete ride" : "";
                  return (
                    <View key={ride.id} style={styles.rideOwnerRequestCard}>
                      <View style={styles.rideOwnerRequestTop}>
                        <Text style={styles.rideOwnerRequestTitle} numberOfLines={2}>{ride.title || ride.typeLabel}</Text>
                        <Text style={[styles.rideOwnerRequestBadge, ride.isExpired && styles.rideOwnerRequestBadgeExpired]}>
                          {ride.isExpired ? "Expired" : isIncoming ? status.replace("_", " ") : "Listed"}
                        </Text>
                      </View>
                      <Text style={styles.rideOwnerRequestRoute} numberOfLines={2}>{ride.origin} → {ride.destination}</Text>
                      <View style={styles.rideOwnerRequestFacts}>
                        <Text style={styles.rideOwnerRequestFact}>{formatRidePickupDropDetail(ride) || "Pickup/drop-off calculating"}</Text>
                        <Text style={styles.rideOwnerRequestFact}>{formatRideTotalDetour(ride)}</Text>
                        <Text style={styles.rideOwnerRequestFact}>{ride.seats} seat{ride.seats === 1 ? "" : "s"}</Text>
                        <Text style={styles.rideOwnerRequestFact}>{ride.pickupDate || "Date open"} · {ride.pickupTime || "Time open"}</Text>
                      </View>
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
                        <TouchableOpacity style={styles.rideOwnerChatButton} onPress={() => onRideMessage(ride)}>
                          <Text style={styles.rideOwnerChatText}>Message</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              ) : (
                <View style={styles.rideOwnerEmpty}>
                  <Text style={styles.rideOwnerEmptyTitle}>{rideOwnerOpenTarget === "listings" ? "No listed routes yet." : rideOwnerOpenTarget === "requests" ? "No rider requests yet." : "No ride activity yet."}</Text>
                  <Text style={styles.rideOwnerEmptyText}>
                    {rideOwnerOpenTarget === "listings"
                      ? "Use List your ride above to publish a route and available seats."
                      : rideOwnerOpenTarget === "requests"
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
    setRentalBusy(true);
    try {
      const nextCars = await getCars(rentalSearch.pickupLocation);
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
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{title}</Text>
              <TouchableOpacity style={styles.pickerClose} onPress={() => setRentalPicker(null)}>
                <Text style={styles.pickerCloseText}>X</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={isDatePicker ? styles.calendarGrid : styles.pickerList}>
              {values.map((value) => {
                const disabled = rentalPicker === "returnDate" && value <= rentalSearch.pickupDate;
                const timeDisabled = rentalPicker === "pickupTime"
                  && rentalSearch.pickupDate === todayIsoDate()
                  && timeTextToMinutes(value) < timeTextToMinutes(minimumPickupTimeToday());
                const selected = value === activeValue;
                return (
                  <TouchableOpacity
                    key={value}
                    disabled={disabled || timeDisabled}
                    style={[
                      isDatePicker ? styles.calendarCell : styles.pickerOption,
                      selected && styles.pickerOptionActive,
                      (disabled || timeDisabled) && styles.pickerOptionDisabled
                    ]}
                    onPress={() => selectRentalPickerValue(value)}
                  >
                    <Text style={[styles.pickerOptionText, selected && styles.pickerOptionTextActive, (disabled || timeDisabled) && styles.pickerOptionTextDisabled]}>
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
        <View style={styles.carSearchPanel}>
          <Text style={styles.carSearchTitle}>Search rental cars</Text>
          <Text style={styles.carFieldLabel}>Pickup location</Text>
          <TouchableOpacity style={styles.carSelectInput} onPress={() => setRentalPicker("pickupLocation")}>
            <Text style={styles.carSelectValue} numberOfLines={2}>{rentalSearch.pickupLocation || "Select pickup location"}</Text>
          </TouchableOpacity>
          <Text style={styles.carFieldLabel}>Return location</Text>
          <TouchableOpacity style={styles.carSelectInput} onPress={() => setRentalPicker("returnLocation")}>
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
              <TouchableOpacity style={styles.carSelectInput} onPress={() => setRentalPicker("renterAge")}>
                <Text style={styles.carSelectValue}>{rentalSearch.renterAge || "25+"}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.carTwoColField}>
              <Text style={styles.carFieldLabel}>Rental length</Text>
              <View style={styles.carEstimateBox}>
                <Text style={styles.carEstimateValue}>{rentalLengthText(rentalDayCount)}</Text>
                <Text style={styles.carEstimateMeta}>{rentalTier.label}</Text>
              </View>
            </View>
          </View>
          <View style={styles.carRateNote}>
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
            style={styles.carSearchInput}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.carSearchButton} onPress={searchRentalCars} disabled={rentalBusy}>
            <Text style={styles.carSearchButtonText}>{rentalBusy ? "Searching..." : "Search cars"}</Text>
          </TouchableOpacity>
        </View>
        {rentalRows.length ? (
          <View style={styles.carList} onLayout={(event) => setRentalResultsY(event.nativeEvent.layout.y)}>
            <Modal visible={Boolean(rentalQuote)} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setRentalQuote(null)}>
              <View style={styles.checkoutScreen}>
                <ScrollView contentContainerStyle={styles.checkoutContent} showsVerticalScrollIndicator={false}>
                  <View style={styles.checkoutHeader}>
                    <View>
                      <Text style={styles.reviewEyebrow}>Checkout</Text>
                      <Text style={styles.reviewTitle}>Finalize trip</Text>
                    </View>
                    <TouchableOpacity style={styles.checkoutClose} onPress={() => setRentalQuote(null)}>
                      <Text style={styles.checkoutCloseText}>X</Text>
                    </TouchableOpacity>
                  </View>
            {rentalQuote ? (
              <View style={styles.rentalReviewPanel}>
                <Text style={styles.reviewCarTitle}>{rentalQuote.booking.carName || selectedRentalCar?.name}</Text>
                <Text style={styles.reviewMeta}>{rentalQuote.booking.pickupLocation}</Text>
                <Text style={styles.reviewMeta}>{rentalQuote.booking.pickupDate} {rentalQuote.booking.pickupTime} to {rentalQuote.booking.returnDate} {rentalQuote.booking.returnTime}</Text>
                <View style={styles.reviewInfoCard}>
                  <Text style={styles.reviewInfoTitle}>Your information</Text>
                  <TextInput value={rentalCheckoutInfo.firstName} onChangeText={(text) => setRentalCheckoutInfo((current) => ({ ...current, firstName: text }))} placeholder="First name" placeholderTextColor={theme.colors.muted} style={styles.reviewInput} />
                  <TextInput value={rentalCheckoutInfo.lastName} onChangeText={(text) => setRentalCheckoutInfo((current) => ({ ...current, lastName: text }))} placeholder="Last name" placeholderTextColor={theme.colors.muted} style={styles.reviewInput} />
                  <TextInput value={rentalCheckoutInfo.email} onChangeText={(text) => setRentalCheckoutInfo((current) => ({ ...current, email: text }))} placeholder="Email address" placeholderTextColor={theme.colors.muted} style={styles.reviewInput} autoCapitalize="none" />
                  <TextInput value={rentalCheckoutInfo.phone} onChangeText={(text) => setRentalCheckoutInfo((current) => ({ ...current, phone: text }))} placeholder="Mobile number" placeholderTextColor={theme.colors.muted} style={styles.reviewInput} keyboardType="phone-pad" />
                  <Text style={styles.reviewPolicy}>Used for booking confirmation, pickup coordination, and rental updates.</Text>
                </View>
                <View style={styles.reviewGrid}>
                  <Text style={styles.reviewItem}>Trip: {rentalQuote.booking.days} days</Text>
                  <Text style={styles.reviewItem}>Daily: {dollars(rentalQuote.breakdown.effectiveDaily)}</Text>
                  <Text style={styles.reviewItem}>Taxes/fees: {dollars(rentalQuote.breakdown.taxFeeAmount)}</Text>
                  <Text style={styles.reviewItem}>Due pickup: {dollars(rentalQuote.breakdown.dueAtPickup)}</Text>
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
                <Text style={styles.reviewPolicy}>Deposit: {dollars(rentalQuote.policy.securityDepositAmount)} refundable authorization at pickup.</Text>
                <Text style={styles.reviewPolicy}>{rentalQuote.policy.cancellation.cutoff_copy}</Text>
              </View>
            ) : null}
                </ScrollView>
              </View>
            </Modal>
            {rentalRows.map((car) => {
              const image = absoluteAssetUrl(car.image_url);
              return (
                <TouchableOpacity key={car.id} style={[styles.carMiniCard, selectedRentalCar?.id === car.id && styles.carMiniCardActive]} onPress={() => reviewRentalCar(car)}>
                  {image ? <Image source={{ uri: image }} style={styles.carMiniImage} /> : <Image source={appAssets.carFallback} style={styles.carMiniImage} />}
                  <View style={styles.carMiniBody}>
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
        destinationLng: rideForm.destinationLng
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
    const nativeMapPoints = [mapOriginLat, mapOriginLng, mapDestinationLat, mapDestinationLng]
      .every((value) => typeof value === "number" && Number.isFinite(value))
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
        (rideForm.destinationLat !== null ||
          rideForm.destinationLng !== null ||
          rideForm.destination.trim() === selectedRideSuggestionRef.current)
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
                  <TouchableOpacity style={styles.ridePlannerPill}>
                    <Text style={styles.ridePlannerPillText}>◷ Pickup now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ridePlannerPill}>
                    <Text style={styles.ridePlannerPillText}>♙ For me</Text>
                  </TouchableOpacity>
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
                    value={rideForm.origin}
                    onFocus={() => setRideFocusedField("origin")}
                    onChangeText={(text) => {
                      selectedRideSuggestionRef.current = "";
                      setRideFocusedField("origin");
                      updateRideForm("origin", text);
                    }}
                    placeholder={listingRide ? "Starting point" : "Pickup location"}
                    placeholderTextColor={theme.colors.muted}
                    style={[styles.rideRouteInput, rideFocusedField === "origin" && styles.rideRouteInputActive]}
                  />
                  <TextInput
                    value={rideForm.destination}
                    onFocus={() => setRideFocusedField("destination")}
                    onChangeText={(text) => {
                      selectedRideSuggestionRef.current = "";
                      setRideFocusedField("destination");
                      updateRideForm("destination", text);
                    }}
                    onSubmitEditing={() => void planRideRoute()}
                    placeholder={listingRide ? "Where are you going?" : "Where to?"}
                    placeholderTextColor={theme.colors.muted}
                    style={[styles.rideRouteInput, rideFocusedField === "destination" && styles.rideRouteInputActive]}
                  />
                </View>
                <TouchableOpacity style={styles.rideRoutePlus} onPress={() => setRideFocusedField("destination")}>
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
                        onChange={(value) => updateRideForm("pickupDate", value)}
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
                        placeholderTextColor={theme.colors.muted}
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
                        placeholderTextColor={theme.colors.muted}
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
                        placeholderTextColor={theme.colors.muted}
                        value={rideForm.luggage}
                        onChangeText={(value) => updateRideForm("luggage", value)}
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
                {!listingRide ? (
                  <TouchableOpacity style={styles.rideSavedItem}>
                    <Text style={styles.rideSavedIcon}>☆</Text>
                    <Text style={styles.rideSavedTitle}>Saved places</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={styles.rideSuggestionList}>
                {currentRideLocationError ? <Text style={styles.rideSuggestionHelp}>{currentRideLocationError}</Text> : null}
                {rideSuggestionsBusy ? <Text style={styles.rideSuggestionHelp}>Loading nearby places...</Text> : null}
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
                      }}
                    >
                      <Text style={styles.rideUtilityIcon}>◎</Text>
                      <Text style={styles.rideUtilityText}>Search in a different city</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.rideUtilityRow} onPress={openRideGoogleMaps}>
                      <Text style={styles.rideUtilityIcon}>⌖</Text>
                      <Text style={styles.rideUtilityText}>Set location on map</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </View>

              {listingRide ? (
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
                ) : null}
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
                    : "No live driver offer is selected yet. Send the request and FairFares will notify nearby drivers first, then expand the radius if needed."}
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
                          <Text style={styles.rideChoiceName} numberOfLines={2}>{offer.origin} → {offer.destination}</Text>
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
                            <TouchableOpacity style={[styles.rideChoiceSmallButton, styles.rideChoiceChatButton]} onPress={() => onRideMessage(offer)}>
                              <Image source={appAssets.chittiMascot} style={styles.rideChoiceChatIcon} resizeMode="contain" />
                              <Text style={styles.rideChoiceSmallButtonText}>Chitthi</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <View style={styles.rideChoiceContribution}>
                          <View style={styles.rideChoiceAvailability}>
                            <View style={[styles.rideChoiceAvailabilityDot, expired && styles.rideChoiceAvailabilityDotExpired]} />
                            <Text style={[styles.rideChoicePrice, expired && styles.rideChoicePriceExpired]}>
                              {offer.contributionPerSeat ? `$${Number(offer.contributionPerSeat).toFixed(2)}` : "Open"}
                            </Text>
                          </View>
                          <Text style={[styles.rideChoicePriceMeta, expired && styles.rideChoiceExpiredMeta]}>{offer.contributionPerSeat ? "expected" : "agree in chat"}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  <View style={styles.rideNoOffersCard}>
                    <Text style={styles.rideNoOffersTitle}>No driver offers yet</Text>
                    <Text style={styles.rideNoOffersCopy}>
                      Send your request and nearby registered drivers can accept it. Chitthi needs a specific driver recipient; once a driver accepts, you will also see ETA and the pickup PIN.
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
                    <Text style={styles.rideInlineChatText}>Chitthi</Text>
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
                {!driverOffers.length ? (
                  <TouchableOpacity style={styles.rideChoiceButton} onPress={() => void requestPlannedRide()} disabled={rideBusy}>
                    <Text style={styles.rideChoiceButtonText}>{rideBusy ? "Sending..." : "Send ride request"}</Text>
                  </TouchableOpacity>
                ) : null}
              </ScrollView>
            </View>
          )}
          {ridePlannerStage === "plan" && rideBusy && !listingRide ? (
            <BlurView
              tint="dark"
              intensity={38}
              experimentalBlurMethod="dimezisBlurView"
              style={styles.rideSearchLoadingOverlay}
            >
              <View style={styles.rideSearchLoadingCard}>
                <ActivityIndicator size="large" color={theme.colors.text} />
                <Text style={styles.rideSearchLoadingTitle}>Finding rides</Text>
                <Text style={styles.rideSearchLoadingCopy}>Checking routes and nearby listings for {rideForm.destination || "your destination"}…</Text>
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
  }

  function viewSuccessfulRideListing() {
    setRideListingSuccess(null);
    setRideOwnerOpen(true);
    setRideOwnerPrompt("Your ride is live. Matching rider requests will appear below.");
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
            <Text style={styles.rideListingSuccessRoute} numberOfLines={3}>
              {ride ? `${ride.origin} → ${ride.destination}` : ""}
            </Text>
            <View style={styles.rideListingSuccessFacts}>
              <Text style={styles.rideListingSuccessFact}>{ride?.pickupDate || "Date open"}</Text>
              <Text style={styles.rideListingSuccessFact}>{ride?.pickupTime || "Time open"}</Text>
              <Text style={styles.rideListingSuccessFact}>{ride?.seats || 1} seat{Number(ride?.seats || 1) === 1 ? "" : "s"}</Text>
            </View>
            <Text style={styles.rideListingSuccessCopy}>Matching rider requests will appear in your driver workspace. You can coordinate with accepted riders in Chitthi.</Text>
            <TouchableOpacity style={styles.rideListingSuccessPrimary} onPress={viewSuccessfulRideListing}>
              <Text style={styles.rideListingSuccessPrimaryText}>View my listing</Text>
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
    const rideHomeCities: Array<{ place: RidePlaceSuggestion; image: ImageSourcePropType }> = [
      {
        place: { label: "Denver, CO", main: "Denver, CO", secondary: "", distanceMiles: null, lat: 39.7392, lng: -104.9903, source: "featured" },
        image: appAssets.cities.denver
      },
      {
        place: { label: "Los Angeles, CA", main: "Los Angeles, CA", secondary: "", distanceMiles: null, lat: 34.0522, lng: -118.2437, source: "featured" },
        image: appAssets.cities.losAngeles
      },
      {
        place: { label: "Austin, TX", main: "Austin, TX", secondary: "", distanceMiles: null, lat: 30.2672, lng: -97.7431, source: "featured" },
        image: appAssets.cities.austin
      },
      {
        place: { label: "Miami, FL", main: "Miami, FL", secondary: "", distanceMiles: null, lat: 25.7617, lng: -80.1918, source: "featured" },
        image: appAssets.cities.miami
      }
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
        <View style={styles.ridePopularSection}>
          <View style={styles.ridePopularHeader}>
            <Text style={styles.ridePopularTitle}>Where are you going?</Text>
            <TouchableOpacity onPress={openRidePlanner} activeOpacity={0.75}>
              <Text style={styles.ridePopularViewAll}>View all ›</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ridePopularList}>
            {rideHomeCities.map(({ place, image }) => (
              <TouchableOpacity key={place.label} style={styles.ridePopularCard} activeOpacity={0.84} onPress={() => openRidePlannerWithSuggestion(place)}>
                <Image source={image} style={styles.ridePopularImage} resizeMode="cover" />
                <View style={styles.ridePopularShade} />
                <Text style={styles.ridePopularCity} numberOfLines={1}>{place.main}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.rideMediaCard}>
          <View style={styles.rideVideoHalf}>
            {Platform.OS === "web" ? React.createElement("iframe", {
              src: "https://www.youtube.com/embed/oZr8xoR-_U0?playsinline=1&rel=0",
              title: "FairFares carpool video",
              allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
              allowFullScreen: true,
              frameBorder: "0",
              style: { width: "100%", height: "100%", border: 0, display: "block", backgroundColor: "#000" }
            }) : (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Play FairFares carpool video on YouTube"
                style={styles.rideVideoNativeLink}
                activeOpacity={0.84}
                onPress={() => void Linking.openURL("https://www.youtube.com/watch?v=oZr8xoR-_U0")}
              >
                <Image source={{ uri: "https://img.youtube.com/vi/oZr8xoR-_U0/hqdefault.jpg" }} style={styles.rideVideoThumbnail} resizeMode="cover" />
                <View style={styles.rideVideoPlay}><Text style={styles.rideVideoPlayText}>▶</Text></View>
              </TouchableOpacity>
            )}
            <View pointerEvents="none" style={styles.rideVideoCaptionShade} />
            <Text pointerEvents="none" style={styles.rideVideoCaption}>What is carpooling & ridesharing?</Text>
          </View>
        </View>

        <View style={styles.rideServiceDetail}>
          <View style={styles.rideSimpleHeader}>
            <View>
              <Text style={styles.rideServiceDetailLabel}>CARPOOL</Text>
              <Text style={styles.rideServiceDetailTitle}>How it works</Text>
            </View>
            <Text style={styles.rideSimpleTrust}>✓ Safe · simple · shared</Text>
          </View>
          <View style={styles.rideSimpleSteps}>
            {["Search or list", "Match the route", "Confirm in Chitthi"].map((step, index) => (
              <View key={step} style={styles.rideSimpleStep}>
                <View style={styles.rideServiceStepDot}><Text style={styles.rideServiceStepDotText}>{index + 1}</Text></View>
                <Text style={styles.rideSimpleStepText}>{step}</Text>
              </View>
            ))}
          </View>
          <View style={styles.ridePrimaryActions}>
            <TouchableOpacity style={styles.rideFindButton} activeOpacity={0.84} onPress={openRidePlanner}>
              <Text style={styles.rideFindButtonText}>🔎 Find a ride</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rideOfferButton} activeOpacity={0.84} onPress={startRideOfferListing}>
              <Text style={styles.rideOfferButtonText}>＋ List a ride</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.ridePosterSection}>
          <View style={styles.ridePosterHeader}>
            <View>
              <Text style={styles.rideSectionEyebrow}>COMING SOON</Text>
              <Text style={styles.rideComingSoonTitle}>More ways to ride</Text>
            </View>
            <Text style={styles.ridePosterHint}>Preview ›</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ridePosterCarousel}>
            {rideServicePosters.filter((service) => !service.available).map((service) => (
              <View key={service.key} style={[styles.ridePosterCard, { backgroundColor: service.tint }, styles.ridePosterCardSoon]}>
                <View style={styles.ridePosterCopy}>
                  <Text style={styles.ridePosterTitle}>{service.title}</Text>
                  <Text style={styles.ridePosterSubtitle}>{service.subtitle}</Text>
                  <Text style={styles.ridePosterButton}>Coming soon</Text>
                </View>
                <View style={styles.ridePosterArt}>{renderRideGlyph(service.glyph)}</View>
              </View>
            ))}
          </ScrollView>
        </View>
      </>
    );
  }

  function renderQuickLinks() {
    return (
      <View style={styles.quickHero}>
        <Text style={styles.quickPill}>Quick links</Text>
        <Text style={styles.quickHeaderTitle}>
          Find rides, rentals, and roommate options <Text style={styles.quickTitleAccent}>anywhere</Text> in the USA.
        </Text>
        <Text style={styles.quickAnimatedWord}>
          {quickLinkAnimatedWord}
          <Text style={styles.quickCursor}>|</Text>
        </Text>
        <View style={styles.quickTextList}>
          {quickLinks.map((link) => (
            <TouchableOpacity key={link.key} activeOpacity={0.82} style={styles.quickTextLink} onPress={() => openQuickLink(link.key)}>
              <View style={[styles.quickTextDot, { backgroundColor: link.accent }]} />
              <Text style={styles.quickTextTitle}>{link.title}</Text>
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

  function renderTopNavIcon(item: string, active: boolean) {
    const color = active ? theme.colors.text : "rgba(255,255,255,0.64)";
    if (item === "Home") {
      return renderSegmentIcon("housing", active);
    }
    if (item === "Explorer") {
      return (
        <View style={[styles.topCompassIcon, { borderColor: color }]}>
          <View style={[styles.topCompassNeedle, { borderBottomColor: color }]} />
        </View>
      );
    }
    return (
      <View style={[styles.topTagIcon, { borderColor: color }]}>
        <View style={[styles.topTagHole, { backgroundColor: color }]} />
      </View>
    );
  }

  return (
    <>
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
      style={styles.screen}
      contentContainerStyle={styles.content}
      stickyHeaderIndices={[1]}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(event) => updateScrollVisibility(event.nativeEvent.contentOffset.y)}
    >
        <View style={[styles.brandHeader, mode !== "housing" && styles.brandHeaderHidden]}>
          {mode === "housing" ? (
          <>
          {festivalCampaign ? (
            <View style={styles.festivalHero} accessibilityLabel={`${festivalCampaign.name} FairFares poster`}>
              <Image source={festivalCampaign.poster} style={styles.festivalPoster} resizeMode="cover" />
              <View style={styles.festivalPosterActions}>
                <TouchableOpacity accessibilityLabel="Open Housing" style={styles.festivalPosterAction} onPress={() => setMode("housing")} />
                <TouchableOpacity accessibilityLabel="Open Explorer" style={styles.festivalPosterAction} onPress={() => onTopAction("Explorer")} />
                <TouchableOpacity accessibilityLabel="Open Deals" style={styles.festivalPosterAction} onPress={() => onTopAction("Deals")} />
              </View>
            </View>
          ) : <>
          <View style={styles.freeServicesHero}>
            <View style={styles.freeServicesCopy}>
              <Image source={appAssets.logo} style={styles.freeServicesLogo} resizeMode="contain" />
              <Text style={styles.freeServicesEyebrow}>Free FairFares tools</Text>
              <Text style={styles.freeServicesTitle}>Your Relocation Partner</Text>
              <View style={styles.freeServicesPoweredBy}>
                <Text style={styles.freeServicesPoweredLabel}>Powered by</Text>
                <Image source={appAssets.chittiMascot} style={styles.freeServicesMascot} resizeMode="contain" />
                <Image source={appAssets.chittiLettersGold} style={styles.freeServicesChitthiLogo} resizeMode="contain" />
              </View>
              <Text style={styles.freeServicesMeta}>Housing posts, rental searches, and ride matching across the USA.</Text>
            </View>
            <View style={styles.freeServicesIconRail}>
              {["🛏️", "🔍", "🚘", "🧑‍🤝‍🧑"].map((icon, index) => (
                <View key={`${icon}-${index}`} style={styles.freeServicesIconBubble}>
                  <Text style={styles.freeServicesIconEmoji}>{icon}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.topTabs}>
            {["Home", "Explorer", "Deals"].map((item) => {
              const active = item === "Home";
              return (
                <TouchableOpacity
                  key={item}
                  onPress={() => {
                    if (item === "Home") {
                      setMode("housing");
                      return;
                    }
                    onTopAction(item);
                  }}
                  style={[styles.topTab, active && styles.topTabActive]}
                >
                  {renderTopNavIcon(item, active)}
                  <Text style={[styles.topTabText, active && styles.topTabTextActive]}>{item}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          </>}
          </>
          ) : null}
        </View>

        <View style={[styles.stickySearch, searchIsScrolled && styles.stickySearchRaised]}>
          <BlurView
            pointerEvents="none"
            tint="dark"
            intensity={searchIsScrolled ? 62 : 18}
            experimentalBlurMethod="dimezisBlurView"
            style={styles.stickySearchBlur}
          />
          {searchIsScrolled ? (
            <BlurView
              pointerEvents="none"
              tint="dark"
              intensity={34}
              experimentalBlurMethod="dimezisBlurView"
              style={styles.stickySearchUnderBlur}
            />
          ) : null}
          <TouchableOpacity style={styles.searchBar} onPress={mode === "ride" ? openRidePlanner : onOpenSearch}>
            <Image source={appAssets.search} style={styles.searchIcon} resizeMode="contain" />
            <Text style={styles.searchText} numberOfLines={1}>{searchBarText}</Text>
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
          {renderSegmentIcon("housing", mode === "housing")}
          <Text style={[styles.segmentText, mode === "housing" && styles.segmentTextActive]}>Housing</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentButton, mode === "ride" && styles.segmentActive]}
          onPress={() => {
            setMode("ride");
          }}
        >
          {renderSegmentIcon("ride", mode === "ride")}
          <Text style={[styles.segmentText, mode === "ride" && styles.segmentTextActive]}>Carpool</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentButton, mode === "cheapCars" && styles.segmentActive]}
          onPress={() => {
            setMode("cheapCars");
          }}
        >
          {renderSegmentIcon("rental", mode === "cheapCars")}
          <Text style={[styles.segmentText, mode === "cheapCars" && styles.segmentTextActive]}>Rental Cars</Text>
        </TouchableOpacity>
      </View>

      {mode === "cheapCars" ? renderRentalCarsOnly() : mode === "ride" ? renderRideOnly() : (
        <>

      <View style={styles.homeSectionHeader}>
        <Text style={styles.homeSectionTitle}>Create a post</Text>
        <TouchableOpacity onPress={() => onPostNeed()}>
          <Text style={styles.homeSectionAction}>View all ›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.postActionGrid}>
        {postActions.map((action, index) => (
          <TouchableOpacity
            key={action.intent}
            activeOpacity={0.86}
            style={[
              styles.postActionCard,
              index === 0 ? styles.postActionTiltLeft : index === 1 ? styles.postActionTiltCenter : styles.postActionTiltRight,
              { backgroundColor: action.bg }
            ]}
            onPress={() => onPostNeed(action.intent)}
          >
            <View style={styles.postActionIconTile}>
              <Image source={action.icon} style={styles.postActionIcon} resizeMode="contain" />
            </View>
            <View style={styles.postActionCopy}>
              <Text style={styles.postNeedTitle}>{action.label}</Text>
              <Text style={styles.postNeedMeta}>{action.sub}</Text>
            </View>
            <View style={[styles.postActionArrow, { backgroundColor: action.tint }]}>
              <Text style={styles.postActionArrowText}>›</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View
        style={styles.welcome}
        onLayout={(event) => {
          setWelcomeY(event.nativeEvent.layout.y);
          setHomeStoryViewportWidth(Math.max(1, event.nativeEvent.layout.width - theme.spacing.md * 2));
        }}
      >
        <ScrollView
          ref={homeStoryScrollRef}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.homeStoryScroll}
          decelerationRate="fast"
          onScrollBeginDrag={() => setHomeStoryDragging(true)}
          onMomentumScrollEnd={(event) => {
            const nextIndex = Math.round(event.nativeEvent.contentOffset.x / homeStorySlideWidth);
            setHomeStoryIndex(Math.max(0, Math.min(nextIndex, homeTestimonials.length)));
            setHomeStoryDragging(false);
          }}
        >
          <View style={[styles.homeStorySlide, { width: homeStorySlideWidth }]}>
            <View style={styles.welcomeCopy}>
              <Text style={styles.welcomeTitle}>Hi {displayName}! Welcome back.</Text>
              <Text style={styles.welcomeMeta}>Check recent listings and explore nearby housing or carpool options.</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.stat}>{data?.dashboard.housingPosts || 0} Housing Posts</Text>
              <TouchableOpacity onPress={() => setMode("ride")} accessibilityRole="button" accessibilityLabel="Open carpool">
                <Text style={[styles.stat, styles.carpoolCarouselStat]} numberOfLines={1}>List your ride & earn</Text>
              </TouchableOpacity>
            </View>
          </View>
          {homeTestimonials.map((testimonial) => {
            const testimonialPhoto = testimonial.photoUrl ? absoluteAssetUrl(testimonial.photoUrl) : "";
            const initials = testimonial.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
            return (
              <View key={testimonial.id} style={[styles.homeStorySlide, { width: homeStorySlideWidth }]}>
                <View style={styles.homeTestimonial}>
                  <View style={styles.homeTestimonialAvatar}>
                    {testimonialPhoto ? <Image source={{ uri: testimonialPhoto }} style={styles.cityExperienceAvatarImage} /> : testimonial.avatarEmoji ? <Text style={styles.homeTestimonialEmoji}>{testimonial.avatarEmoji}</Text> : <Text style={styles.cityExperienceAvatarInitials}>{initials || "FF"}</Text>}
                  </View>
                  <View style={styles.homeTestimonialCopy}>
                    <View style={styles.homeTestimonialTopline}>
                      <Text style={styles.homeTestimonialName} numberOfLines={1}>{testimonial.name}</Text>
                      <Text style={styles.homeTestimonialStars}>{"★".repeat(testimonial.rating)}</Text>
                    </View>
                    <Text style={styles.homeTestimonialCity}>📍 {testimonial.city}</Text>
                    <Text style={styles.homeTestimonialMessage} numberOfLines={2}>“{testimonial.message}”</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
        {homeTestimonials.length > 0 ? (
          <View style={styles.homeStoryPager} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {Array.from({ length: 1 + homeTestimonials.length }).map((_, index) => <View key={index} style={[styles.homeStoryDot, index === homeStoryIndex && styles.homeStoryDotActive]} />)}
          </View>
        ) : null}
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
                {cityExperiencePhoto ? <Image source={{ uri: cityExperiencePhoto }} style={styles.cityExperienceAvatarImage} /> : <Text style={styles.cityExperienceAvatarInitials}>{cityExperienceInitials || "FF"}</Text>}
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

      <View style={styles.listingSectionHeader}>
        <Text numberOfLines={2} style={styles.listingSectionTitle}>Rooms for rent in {data?.location.city || "Denver, CO"}</Text>
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
              {budgetOptions.map((option) => {
                const value = option === "Any" ? "" : option.replace(/[$,]/g, "");
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
          sortedPosts.map((post) => <HousingCard key={post.id} post={post} onMessage={onMessage} onOpen={setDetailPost} distanceLabel={distanceReference} width={housingCardWidth} compact={compactHousingHome} />)
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No matching housing posts yet.</Text>
            <Text style={styles.emptyText}>Try Denver, Union Station, DU, Aurora, or create the first post.</Text>
          </View>
        )}
      </ScrollView>

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
      <View style={styles.rentalSectionHeader}>
        <View>
          <Text style={styles.rentalSectionEyebrow}>FairFares car rentals</Text>
          <Text style={styles.rentalSectionTitle}>Book confidently. Pay less.</Text>
        </View>
        <TouchableOpacity style={styles.rentalSectionAction} onPress={() => setMode("cheapCars")}>
          <Text style={styles.rentalSectionActionText}>View cars</Text>
          <Text style={styles.rentalSectionArrow}>→</Text>
        </TouchableOpacity>
      </View>
      <RentalPromoCarousel onPress={() => setMode("cheapCars")} />
      <SectionHeader title="Exports & Imports" />
      <View style={styles.exportsImportsCard}>
        <View style={styles.exportsImportsImageFrame}>
          <Image source={appAssets.exportsImportsPromo} style={styles.exportsImportsImage} resizeMode="contain" />
        </View>
        <View style={styles.exportsImportsCopy}>
          <View style={styles.exportsImportsBadge}>
            <Text style={styles.exportsImportsBadgeText}>Coming soon</Text>
          </View>
          <Text style={styles.exportsImportsTitle}>Move goods between India and the world</Text>
          <Text style={styles.exportsImportsMeta}>Interested in safe import and export support? Show your interest and help us bring this service sooner.</Text>
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
      <Modal visible={Boolean(detailPost)} transparent animationType="fade" onRequestClose={() => setDetailPost(null)}>
        <View style={styles.detailBackdrop}>
          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailEyebrow}>Housing details</Text>
              <TouchableOpacity style={styles.detailClose} onPress={() => setDetailPost(null)}>
                <Text style={styles.detailCloseText}>X</Text>
              </TouchableOpacity>
            </View>
            {detailPost ? (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.detailContent}>
                {detailImages.length ? (
                  <View style={styles.detailCarouselWrap}>
                    <ScrollView
                      ref={detailCarouselRef}
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      style={styles.detailCarousel}
                      onMomentumScrollEnd={(event) => setDetailImageIndex(Math.round(event.nativeEvent.contentOffset.x / detailImageWidth))}
                    >
                      {detailImages.map((image, index) => (
                        <TouchableOpacity key={`${image}-${index}`} activeOpacity={0.92} onPress={() => setDetailPreviewImage(absoluteAssetUrl(image))} accessibilityRole="imagebutton" accessibilityLabel="Open housing photo full screen">
                          <Image source={{ uri: absoluteAssetUrl(image) }} style={[styles.detailImage, { width: detailImageWidth }]} />
                        </TouchableOpacity>
                      ))}
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
                  <View style={styles.detailImageFallback} />
                )}
                <Text style={styles.detailTitle}>{detailPost.title}</Text>
                <Text style={styles.detailMeta}>{detailPost.location}{detailPost.area ? ` · ${detailPost.area}` : ""}</Text>
                <View style={styles.detailSummaryRow}>
                  <Text style={styles.detailSummaryPill}>{detailPost.expiryLabel || `${Math.max(0, detailPost.daysLeft)} days left`}</Text>
                  {detailPost.posterName ? <Text style={styles.detailSummaryPill}>Posted by {detailPost.posterName}</Text> : null}
                  {detailPost.accommodates ? <Text style={styles.detailSummaryPill}>Accommodates {detailPost.accommodates}</Text> : null}
                </View>
                <View style={styles.detailMap}>
                  <Text style={styles.detailMapTitle}>Map view</Text>
                  <Text style={styles.detailMapText}>
                    {detailPost.distanceMiles !== null
                      ? `${detailPost.distanceMiles} mi from ${distanceReference || detailPost.location}`
                      : "Distance opens when location coordinates are available."}
                  </Text>
                  <TouchableOpacity style={styles.detailMapButton} onPress={() => openPostMap(detailPost)}>
                    <Text style={styles.detailMapButtonText}>Open map</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.detailDescription}>{detailPost.description || "No description yet."}</Text>
                <View style={styles.detailGrid}>
                  <Text style={styles.detailFact}>Type: {detailPost.modeLabel}</Text>
                  <Text style={styles.detailFact}>Category: {detailPost.categoryLabel}</Text>
                  <Text style={styles.detailFact}>Rent: {detailPost.rent || "Open"}</Text>
                  <Text style={styles.detailFact}>Move-in: {detailPost.moveIn || "Open"}</Text>
                  <Text style={styles.detailFact}>Bath: {detailPost.bathroomType || "Open"}</Text>
                  <Text style={styles.detailFact}>Lease: {detailPost.leaseTerm || "Flexible"}</Text>
                  <Text style={styles.detailFact}>Gender: {detailPost.genderPreference || "Open"}</Text>
                  <Text style={styles.detailFact}>Roommates: {detailPost.roommateCount || "Open"}</Text>
                  <Text style={styles.detailFact}>Radius: {detailPost.radiusMiles || "Open"} mi</Text>
                  <Text style={styles.detailFact}>Intent: {detailPost.roommateIntent ? "Roommate match" : "Listing"}</Text>
                </View>
                {detailPost.amenities?.length ? (
                  <View style={styles.detailAmenities}>
                    <Text style={styles.detailSectionTitle}>Amenities</Text>
                    <View style={styles.detailGrid}>
                      {detailPost.amenities.slice(0, 12).map((amenity) => <Text key={amenity} style={styles.detailFact}>{amenity}</Text>)}
                    </View>
                  </View>
                ) : null}
                <TouchableOpacity style={[styles.detailMessage, detailPost.sample && styles.detailMessageDisabled]} onPress={() => !detailPost.sample && onMessage(detailPost)} disabled={detailPost.sample}>
                  <Text style={styles.detailMessageText}>{detailPost.sample ? "Sample preview — no poster yet" : "Message"}</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
      <Modal visible={Boolean(detailPreviewImage)} transparent animationType="fade" onRequestClose={() => setDetailPreviewImage("")}>
        <View style={styles.detailPhotoBackdrop}>
          <TouchableOpacity style={styles.detailPhotoClose} onPress={() => setDetailPreviewImage("")} accessibilityLabel="Close housing photo">
            <Text style={styles.detailPhotoCloseText}>×</Text>
          </TouchableOpacity>
          {detailPreviewImage ? <Image source={{ uri: detailPreviewImage }} style={styles.detailPhotoFull} resizeMode="contain" /> : null}
        </View>
      </Modal>
    </ScrollView>
    {renderRidePlannerModal()}
    {renderPickerModal()}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 14, paddingBottom: 112, gap: 20 },
  brandHeader: {
    width: "100%",
    borderRadius: 26,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(46,255,188,0.24)",
    backgroundColor: "#09bf78"
  },
  brandHeaderHidden: { height: 0, borderWidth: 0, backgroundColor: "transparent" },
  festivalHero: { width: "100%", aspectRatio: 2, backgroundColor: "#00472d", position: "relative" },
  festivalPoster: { width: "100%", height: "100%" },
  festivalPosterActions: { position: "absolute", left: 0, right: 0, bottom: 0, height: "20%", flexDirection: "row" },
  festivalPosterAction: { flex: 1 },
  freeServicesHero: {
    width: "100%",
    minHeight: 142,
    padding: 16,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  freeServicesCopy: { flex: 1, minWidth: 0 },
  freeServicesEyebrow: {
    alignSelf: "flex-start",
    color: "#07351f",
    backgroundColor: "rgba(255,255,255,0.36)",
    borderRadius: theme.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
    overflow: "hidden",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0
  },
  freeServicesTitle: { color: "#06130d", fontSize: 17, lineHeight: 21, fontWeight: "800", marginTop: 7, maxWidth: 210 },
  freeServicesTitleAccent: { color: theme.colors.blue, fontWeight: "900" },
  freeServicesMeta: { color: "rgba(6,19,13,0.72)", fontSize: 12, lineHeight: 16, fontWeight: "600", marginTop: 4 },
  freeServicesIconRail: {
    width: 88,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 8
  },
  freeServicesPoweredBy: {
    alignSelf: "flex-start",
    height: 30,
    marginTop: 6,
    paddingLeft: 9,
    paddingRight: 7,
    borderRadius: 15,
    backgroundColor: "rgba(3,49,30,0.88)",
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  freeServicesPoweredLabel: { color: "rgba(255,255,255,0.82)", fontSize: 7.5, lineHeight: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.35 },
  freeServicesMascot: { width: 18, height: 25 },
  freeServicesChitthiLogo: { width: 62, height: 22, marginLeft: -13 },
  freeServicesIconBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center"
  },
  freeServicesIconEmoji: { fontSize: 24, lineHeight: 30, textAlign: "center" },
  freeServicesLogo: { width: 88, height: 29, marginBottom: 4, marginLeft: -2 },
  topTabs: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.18)" },
  topTab: { flex: 1, paddingVertical: 11, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  topTabActive: { borderBottomWidth: 3, borderBottomColor: theme.colors.text },
  topTabText: { color: "rgba(255,255,255,0.64)", fontSize: 14, fontWeight: "700" },
  topTabTextActive: { color: theme.colors.text, fontWeight: "800" },
  topCompassIcon: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "45deg" }]
  },
  topCompassNeedle: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent"
  },
  topTagIcon: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderRadius: 3,
    transform: [{ rotate: "45deg" }],
    justifyContent: "flex-start",
    alignItems: "flex-start",
    padding: 2
  },
  topTagHole: { width: 4, height: 4, borderRadius: 2 },
  stickySearch: { backgroundColor: "rgba(10,10,12,0.68)", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: theme.colors.line, overflow: "visible", zIndex: 20 },
  stickySearchRaised: { borderBottomColor: "rgba(255,255,255,0.12)", shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 9 },
  stickySearchBlur: { ...StyleSheet.absoluteFillObject },
  stickySearchUnderBlur: { position: "absolute", left: 0, right: 0, bottom: -16, height: 18, opacity: 0.72 },
  searchBar: { backgroundColor: "#272729", borderWidth: 1.5, borderColor: "#4a4a4f", borderRadius: theme.radius.pill, minHeight: 60, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.26, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  searchIcon: { width: 25, height: 25 },
  searchText: { color: theme.colors.soft, flex: 1, fontSize: 16, fontWeight: "800" },
  later: { color: theme.colors.text, backgroundColor: "#151517", borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 10, fontWeight: "900", fontSize: 13, overflow: "hidden" },
  segment: {
    backgroundColor: "transparent",
    borderRadius: 0,
    flexDirection: "row",
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.13)"
  },
  segmentButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 5,
    paddingBottom: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
    flexDirection: "row",
    gap: 7
  },
  segmentActive: { backgroundColor: "transparent", borderBottomColor: "#ffffff" },
  segmentText: { color: theme.colors.soft, fontSize: 14, fontWeight: "800" },
  segmentTextActive: { color: theme.colors.text },
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
  quickTitleAccent: { color: "#15e1ba" },
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
  exportsImportsCard: {
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "#071a12"
  },
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
  exportsImportsMeta: { color: theme.colors.soft, fontSize: 14, lineHeight: 20 },
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
  exportsInfoTitle: { color: theme.colors.text, fontSize: 22, lineHeight: 27, fontWeight: "700" },
  exportsInfoClose: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  exportsInfoCloseText: { color: theme.colors.text, fontSize: 28, lineHeight: 30, fontWeight: "400" },
  exportsInfoLead: { color: theme.colors.text, fontSize: 15, lineHeight: 22 },
  exportsInfoSaving: { color: "#ffc329", fontSize: 13, lineHeight: 18, fontWeight: "700" },
  exportsInfoErrorNotice: { borderRadius: 14, padding: 13, gap: 6, backgroundColor: "rgba(185,67,67,0.13)", borderWidth: 1, borderColor: "rgba(255,105,105,0.42)" },
  exportsInfoErrorTitle: { color: "#ff9c9c", fontSize: 14, lineHeight: 18, fontWeight: "700" },
  exportsInfoErrorCopy: { color: theme.colors.soft, fontSize: 12, lineHeight: 17 },
  exportsInfoRetryButton: { alignSelf: "flex-start", borderRadius: theme.radius.pill, backgroundColor: "#ffffff", paddingHorizontal: 14, paddingVertical: 8, marginTop: 2 },
  exportsInfoRetryText: { color: "#161616", fontSize: 13, lineHeight: 16, fontWeight: "800" },
  exportsInfoNotice: { borderRadius: 14, padding: 13, gap: 5, backgroundColor: "rgba(255,190,0,0.10)", borderWidth: 1, borderColor: "rgba(255,190,0,0.38)" },
  exportsInfoNoticeTitle: { color: "#ffc329", fontSize: 15, lineHeight: 19, fontWeight: "700" },
  exportsInfoNoticeCopy: { color: theme.colors.soft, fontSize: 13, lineHeight: 19 },
  exportsInfoSectionTitle: { color: theme.colors.text, fontSize: 15, lineHeight: 19, fontWeight: "700", marginTop: 2 },
  exportsInfoBody: { color: theme.colors.soft, fontSize: 13, lineHeight: 20 },
  exportsInfoFootnote: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)", paddingTop: 12 },
  exportsInfoDoneButton: { minHeight: 46, borderRadius: theme.radius.pill, backgroundColor: "#f3b900", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 2 },
  exportsInfoDoneText: { color: "#07150e", fontSize: 15, lineHeight: 19, fontWeight: "800" },
  homeSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  homeSectionTitle: { color: theme.colors.text, ...theme.typography.sectionTitle },
  homeSectionAction: { color: theme.colors.brand, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  postActionGrid: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: 2, paddingVertical: 5 },
  postActionCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 184,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 11,
    alignItems: "flex-start",
    gap: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)"
  },
  postActionTiltLeft: { transform: [{ rotate: "-1.2deg" }], marginTop: 4 },
  postActionTiltCenter: { transform: [{ rotate: "0.7deg" }] },
  postActionTiltRight: { transform: [{ rotate: "1.2deg" }], marginTop: 4 },
  postActionIconTile: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.72)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 }
  },
  postActionIcon: { width: 27, height: 27 },
  postActionCopy: { flex: 1, minWidth: 0, zIndex: 2 },
  postNeedTitle: { color: "#111827", fontSize: 14, lineHeight: 17, fontWeight: "700" },
  postNeedMeta: { color: "#263143", marginTop: 3, fontSize: 11, lineHeight: 15, fontWeight: "500" },
  postActionScene: {
    position: "absolute",
    right: 42,
    top: 0,
    bottom: 0,
    width: 118,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.42
  },
  postActionSceneCircle: {
    position: "absolute",
    width: 112,
    height: 112,
    borderRadius: 56,
    opacity: 0.16
  },
  postActionSceneIcon: { width: 78, height: 78 },
  postActionArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignSelf: "flex-end",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2
  },
  postActionArrowText: { color: theme.colors.text, fontSize: 24, lineHeight: 26, fontWeight: "600", marginTop: -2 },
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
  welcome: { minHeight: 132, borderWidth: 1, borderColor: theme.colors.brand, borderRadius: theme.radius.md, padding: theme.spacing.md, paddingBottom: 22, backgroundColor: "#10231c", gap: 12, flexDirection: "row", alignItems: "center", overflow: "hidden" },
  welcomeCopy: { flex: 1, minWidth: 0, gap: 7 },
  welcomeTitle: { color: theme.colors.text, fontSize: 17, lineHeight: 21, fontWeight: "700" },
  welcomeMeta: { color: theme.colors.soft, fontSize: 13, lineHeight: 18 },
  statRow: { width: 132, gap: 7 },
  stat: { color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.brand, borderRadius: theme.radius.pill, paddingHorizontal: 9, paddingVertical: 8, overflow: "hidden", fontWeight: "700", fontSize: 11, textAlign: "center" },
  carpoolCarouselStat: { color: "#8ff0c2", minHeight: 34, textAlignVertical: "center" },
  homeStoryScroll: { flex: 1, alignSelf: "stretch" },
  homeStorySlide: { minHeight: 92, flexDirection: "row", alignItems: "center", paddingRight: 1 },
  homeTestimonial: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
  homeTestimonialAvatar: { width: 54, height: 54, borderRadius: 27, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#16885b", borderWidth: 2, borderColor: "rgba(108,235,181,0.62)" },
  homeTestimonialEmoji: { fontSize: 27, lineHeight: 32 },
  homeTestimonialCopy: { flex: 1, minWidth: 0, gap: 3 },
  homeTestimonialTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  homeTestimonialName: { flex: 1, minWidth: 0, color: theme.colors.text, fontSize: 14, lineHeight: 18, fontWeight: "800" },
  homeTestimonialStars: { color: "#f4b51e", fontSize: 12, lineHeight: 16, letterSpacing: 0.5 },
  homeTestimonialCity: { color: "#75d9ad", fontSize: 10, lineHeight: 14, fontWeight: "700" },
  homeTestimonialMessage: { color: theme.colors.soft, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  homeStoryPager: { position: "absolute", left: 0, right: 0, bottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  homeStoryDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.24)" },
  homeStoryDotActive: { width: 18, backgroundColor: "#37d59a" },
  listingSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  listingSectionTitle: { flex: 1, minWidth: 0, color: theme.colors.text, ...theme.typography.sectionTitle },
  housingCardRow: { gap: 10, paddingRight: 2 },
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
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm,
    gap: 12
  },
  rentalSectionEyebrow: { color: theme.colors.accent, fontSize: 11, lineHeight: 14, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  rentalSectionTitle: { color: theme.colors.text, fontSize: 20, lineHeight: 25, fontWeight: "700" },
  rentalSectionAction: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.09)", borderColor: "rgba(255,255,255,0.16)", borderRadius: theme.radius.pill, borderWidth: 1, flexDirection: "row", gap: 6, minHeight: 42, paddingHorizontal: 13 },
  rentalSectionActionText: { color: theme.colors.text, fontSize: 12, fontWeight: "800" },
  rentalSectionArrow: { color: "#6ee7b7", fontSize: 20, lineHeight: 21, fontWeight: "500" },
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
  carSearchTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  carFieldLabel: { color: theme.colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  carSearchInput: { backgroundColor: "rgba(255,255,255,0.08)", color: theme.colors.text, borderRadius: theme.radius.md, minHeight: 45, paddingHorizontal: 12, fontSize: 14, fontWeight: "800" },
  carSelectInput: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: theme.radius.md, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center" },
  carSelectValue: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  carSelectMeta: { color: theme.colors.muted, fontSize: 11, fontWeight: "800", marginTop: 2 },
  carTwoCol: { flexDirection: "row", gap: 10 },
  carTwoColField: { flex: 1 },
  carEstimateBox: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: theme.radius.md, minHeight: 56, paddingHorizontal: 13, paddingVertical: 9, justifyContent: "center" },
  carEstimateValue: { color: theme.colors.text, fontWeight: "900", fontSize: 14 },
  carEstimateMeta: { color: theme.colors.green, fontWeight: "900", fontSize: 12, marginTop: 2 },
  carRateNote: { borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(40,82,255,0.10)", borderRadius: theme.radius.md, padding: 12, gap: 3 },
  carRateNoteTitle: { color: theme.colors.text, fontWeight: "900" },
  carRateNoteText: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  carSearchButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, minHeight: 48, alignItems: "center", justifyContent: "center" },
  carSearchButtonText: { color: theme.colors.text, fontWeight: "900", fontSize: 15 },
  carList: { gap: theme.spacing.md },
  carMiniCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, overflow: "hidden" },
  carMiniCardActive: { borderColor: theme.colors.blue },
  carMiniImage: { width: "100%", height: 150 },
  carMiniBody: { padding: theme.spacing.md, gap: 6 },
  carMiniTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  carMiniMeta: { color: theme.colors.muted, fontSize: 14, fontWeight: "800" },
  carMiniPrice: { color: theme.colors.green, fontSize: 19, fontWeight: "900" },
  carMiniSavings: { color: theme.colors.soft, fontSize: 12, fontWeight: "800" },
  carMiniAction: { color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 8, overflow: "hidden", fontWeight: "900", alignSelf: "flex-start", marginTop: 4 },
  checkoutScreen: { flex: 1, backgroundColor: theme.colors.bg },
  checkoutContent: { padding: theme.spacing.md, paddingTop: 54, paddingBottom: 120, gap: theme.spacing.md },
  checkoutHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  checkoutClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: theme.colors.line, alignItems: "center", justifyContent: "center" },
  checkoutCloseText: { color: theme.colors.text, fontWeight: "900", fontSize: 18 },
  rentalReviewPanel: { backgroundColor: "rgba(17,24,39,0.88)", borderRadius: theme.radius.lg, borderWidth: 1, borderColor: "rgba(80,124,255,0.72)", padding: theme.spacing.md, gap: 10 },
  reviewEyebrow: { color: theme.colors.accent, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  reviewTitle: { color: theme.colors.text, fontSize: 24, fontWeight: "900" },
  reviewCarTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  reviewMeta: { color: theme.colors.muted, fontSize: 13, fontWeight: "800", lineHeight: 18 },
  reviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reviewItem: { width: "48%", color: theme.colors.soft, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontWeight: "800" },
  reviewTotal: { color: theme.colors.green, fontSize: 19, fontWeight: "900" },
  reviewSavings: { color: theme.colors.green, backgroundColor: "rgba(34,197,94,0.12)", borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 10, fontWeight: "900" },
  reviewInfoCard: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", padding: 12, gap: 8 },
  reviewInfoTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  reviewInput: { backgroundColor: "rgba(255,255,255,0.08)", color: theme.colors.text, borderRadius: theme.radius.md, minHeight: 48, paddingHorizontal: 13, fontWeight: "800" },
  reviewActions: { flexDirection: "row", gap: 10 },
  reviewHoldButton: { flex: 1, backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingVertical: 13, alignItems: "center" },
  reviewHoldText: { color: theme.colors.text, fontWeight: "900", textTransform: "uppercase" },
  reviewHoldMeta: { color: theme.colors.text, fontSize: 11, fontWeight: "800", marginTop: 2 },
  reviewFullButton: { flex: 1, backgroundColor: theme.colors.text, borderRadius: theme.radius.md, paddingVertical: 13, alignItems: "center" },
  reviewFullText: { color: theme.colors.bg, fontWeight: "900", textTransform: "uppercase" },
  reviewFullMeta: { color: "#555", fontSize: 11, fontWeight: "900", marginTop: 2 },
  reviewPolicy: { color: theme.colors.soft, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", padding: theme.spacing.md, justifyContent: "center" },
  pickerCard: { maxHeight: "78%", backgroundColor: "rgba(24,24,27,0.96)", borderRadius: 28, borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", padding: theme.spacing.md, gap: theme.spacing.md },
  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pickerTitle: { color: theme.colors.text, fontSize: 21, fontWeight: "900" },
  pickerClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  pickerCloseText: { color: theme.colors.text, fontWeight: "900" },
  pickerList: { gap: 8 },
  pickerOption: { minHeight: 48, borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 14, justifyContent: "center" },
  pickerOptionActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  pickerOptionDisabled: { opacity: 0.35 },
  pickerOptionText: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  pickerOptionTextActive: { color: theme.colors.bg },
  pickerOptionTextDisabled: { color: theme.colors.muted },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  calendarCell: { width: "31%", minHeight: 66, borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.06)", padding: 8, justifyContent: "center" },
  calendarDateText: { color: theme.colors.muted, fontSize: 11, marginTop: 3, fontWeight: "800" },
  roomTypeRow: { flexDirection: "row", justifyContent: "space-between" },
  roomType: { alignItems: "center", gap: 10, flex: 1 },
  roomCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  roomCircleActive: { borderWidth: 2, borderColor: theme.colors.brand },
  roomIcon: { width: 50, height: 50 },
  roomLabel: { color: theme.colors.soft, fontWeight: "700", fontSize: 14 },
  localityCard: { width: 270, borderRadius: theme.radius.lg, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, marginRight: theme.spacing.md, padding: theme.spacing.md, gap: 14 },
  localityTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  localityStats: { flexDirection: "row", gap: 10 },
  localityChip: { color: theme.colors.blue, borderWidth: 1, borderColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 7, overflow: "hidden", fontWeight: "600" },
  avgRent: { color: theme.colors.green, fontSize: 17, fontWeight: "700" },
  detailBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.74)", paddingHorizontal: theme.spacing.sm, paddingTop: Platform.OS === "ios" ? 54 : theme.spacing.md, paddingBottom: theme.spacing.md, justifyContent: "center" },
  detailCard: { maxHeight: "94%", backgroundColor: theme.colors.panel, borderRadius: 28, borderWidth: 1, borderColor: theme.colors.line, overflow: "hidden" },
  detailHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  detailEyebrow: { color: theme.colors.accent, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  detailClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  detailCloseText: { color: theme.colors.text, fontWeight: "900" },
  detailContent: { padding: theme.spacing.md, gap: theme.spacing.md },
  detailCarouselWrap: { borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: "#202a25" },
  detailCarousel: { width: "100%" },
  detailImage: { height: 210, borderRadius: theme.radius.md },
  detailImageDots: { position: "absolute", bottom: 12, alignSelf: "center", flexDirection: "row", gap: 6, backgroundColor: "rgba(0,0,0,0.48)", borderRadius: theme.radius.pill, paddingHorizontal: 9, paddingVertical: 7 },
  detailImageDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.48)" },
  detailImageDotActive: { width: 16, backgroundColor: "#ffffff" },
  detailImageNext: { position: "absolute", right: 12, top: "50%", width: 44, height: 44, marginTop: -22, borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.58)", backgroundColor: "rgba(10,18,15,0.34)" },
  detailImageNextGlass: { flex: 1, alignItems: "center", justifyContent: "center" },
  detailImageNextText: { color: "#ffffff", fontSize: 36, lineHeight: 38, fontWeight: "500", marginTop: -3 },
  detailImageFallback: { width: "100%", height: 190, borderRadius: theme.radius.md, backgroundColor: "#202a25" },
  detailTitle: { color: theme.colors.text, fontSize: 21, lineHeight: 25, fontWeight: "700" },
  detailMeta: { color: theme.colors.muted, fontSize: 14, fontWeight: "600" },
  detailSummaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  detailSummaryPill: { color: theme.colors.text, backgroundColor: "rgba(47,115,78,0.35)", borderWidth: 1, borderColor: "rgba(78,199,119,0.30)", borderRadius: theme.radius.pill, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 7, fontSize: 12, fontWeight: "800" },
  detailMap: { backgroundColor: theme.colors.bg, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.lg, padding: theme.spacing.md, gap: 8 },
  detailMapTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700" },
  detailMapText: { color: theme.colors.green, fontSize: 15, fontWeight: "700" },
  detailMapButton: { alignSelf: "flex-start", borderWidth: 1, borderColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  detailMapButtonText: { color: theme.colors.text, fontWeight: "900" },
  detailDescription: { color: theme.colors.soft, fontSize: 14, lineHeight: 20 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  detailFact: { color: theme.colors.soft, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 7, fontWeight: "600" },
  detailAmenities: { gap: 8 },
  detailSectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  detailMessage: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.pill, alignItems: "center", paddingVertical: 13 },
  detailMessageDisabled: { backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line },
  detailMessageText: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  detailPhotoBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", paddingTop: Platform.OS === "ios" ? 54 : 24, paddingBottom: Platform.OS === "ios" ? 34 : 18, paddingHorizontal: 10 },
  detailPhotoClose: { position: "absolute", top: Platform.OS === "ios" ? 54 : 24, right: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center", zIndex: 3 },
  detailPhotoCloseText: { color: "#fff", fontSize: 30, lineHeight: 32, marginTop: -2 },
  detailPhotoFull: { flex: 1, width: "100%", height: "100%" },
  ridePopularSection: { gap: 12 },
  ridePopularHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  ridePopularTitle: { color: theme.colors.text, ...theme.typography.sectionTitle },
  ridePopularViewAll: { color: theme.colors.green, fontSize: 13, fontWeight: "700" },
  ridePopularList: { gap: 12, paddingRight: 8 },
  ridePopularCard: {
    width: 176,
    height: 108,
    borderRadius: 17,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: theme.colors.panel2
  },
  ridePopularImage: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
  ridePopularShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 36, backgroundColor: "rgba(0,0,0,0.48)" },
  ridePopularCity: { position: "absolute", left: 12, right: 8, bottom: 9, color: "#fff", fontSize: 14, fontWeight: "900" },
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
    borderColor: "rgba(255,255,255,0.14)",
    flexDirection: "row",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 }
  },
  ridePosterCardActive: { borderColor: theme.colors.text, shadowOpacity: 0.42 },
  ridePosterCardSoon: { opacity: 0.58 },
  ridePosterCopy: { flex: 1, padding: 14, justifyContent: "space-between", gap: 8 },
  ridePosterTitle: { color: theme.colors.text, fontSize: 18, lineHeight: 23, fontWeight: "700" },
  ridePosterSubtitle: { color: "rgba(255,255,255,0.78)", fontSize: 12, lineHeight: 16, fontWeight: "600" },
  ridePosterButton: { alignSelf: "flex-start", color: theme.colors.text, backgroundColor: "rgba(0,0,0,0.46)", borderRadius: theme.radius.pill, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 6, fontSize: 11, fontWeight: "900" },
  ridePosterArt: { width: 94, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.12)", transform: [{ scale: 0.9 }] },
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
    padding: 16,
    gap: 14
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
  rideServiceDetailTitle: { color: theme.colors.text, fontSize: 17, lineHeight: 22, fontWeight: "700" },
  rideServiceDetailLabel: { color: theme.colors.accent, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  rideSimpleHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rideSimpleTrust: { color: theme.colors.green, fontSize: 11, fontWeight: "700" },
  rideSimpleSteps: { flexDirection: "row", gap: 10, marginTop: 2 },
  rideSimpleStep: { flex: 1, minHeight: 82, borderRadius: theme.radius.md, backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 9, paddingVertical: 12, alignItems: "center", justifyContent: "center", gap: 8 },
  rideSimpleStepText: { color: theme.colors.soft, fontSize: 12, lineHeight: 16, fontWeight: "600", textAlign: "center" },
  ridePrimaryActions: { flexDirection: "row", gap: 12, marginTop: 2 },
  rideFindButton: { flex: 1, minHeight: 50, borderRadius: theme.radius.pill, backgroundColor: "rgba(10,132,255,0.16)", borderWidth: 1, borderColor: "rgba(10,132,255,0.58)", alignItems: "center", justifyContent: "center" },
  rideFindButtonText: { color: "#64b5ff", fontSize: 14, fontWeight: "700" },
  rideOfferButton: { flex: 1, minHeight: 50, borderRadius: theme.radius.pill, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  rideOfferButtonText: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
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
  rideServiceStepDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center", marginTop: 1 },
  rideServiceStepDotText: { color: theme.colors.text, fontSize: 11, fontWeight: "900" },
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
  rideServicePlanButtonText: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
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
  rideRequestButtonText: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
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
  rideVideoHalf: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  rideVideoNativeLink: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  rideVideoThumbnail: { width: "100%", height: "100%" },
  rideVideoPlay: { position: "absolute", width: 52, height: 38, borderRadius: 11, backgroundColor: "rgba(220,0,0,0.94)", alignItems: "center", justifyContent: "center" },
  rideVideoPlayText: { color: "#fff", fontSize: 19, marginLeft: 3 },
  rideVideoCaptionShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 42, backgroundColor: "rgba(0,0,0,0.52)" },
  rideVideoCaption: { position: "absolute", left: 14, right: 10, bottom: 11, color: "#fff", fontSize: 14, fontWeight: "800" },
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
  rideOwnerEyebrow: { color: theme.colors.accent, fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 },
  rideOwnerTitle: { color: theme.colors.text, fontSize: 24, lineHeight: 28, fontWeight: "600" },
  rideOwnerHero: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(15,23,42,0.78)",
    padding: 12,
    flexDirection: "row",
    gap: 11,
    alignItems: "center"
  },
  rideOwnerHeroIcon: { width: 50, height: 44, borderRadius: 14, backgroundColor: "rgba(59,130,246,0.16)", alignItems: "center", justifyContent: "center" },
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
  rideOwnerHeroTitle: { color: theme.colors.text, fontSize: 18, lineHeight: 22, fontWeight: "600" },
  rideOwnerHeroText: { color: theme.colors.soft, fontSize: 12, lineHeight: 17, fontWeight: "500", marginTop: 3 },
  rideOwnerCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 12,
    gap: 9
  },
  rideOwnerSectionHeading: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 },
  rideOwnerSectionIcon: { width: 22, height: 22, tintColor: theme.colors.soft },
  rideOwnerSectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  rideOwnerInputRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rideOwnerInput: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.09)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    color: theme.colors.text,
    paddingHorizontal: 12,
    fontSize: 13,
    fontWeight: "500"
  },
  rideOwnerHalfInput: { flex: 1, minWidth: 145 },
  rideOwnerFieldLabel: { color: theme.colors.soft, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  rideOwnerStatusPillActive: { borderColor: "rgba(59,130,246,0.9)", backgroundColor: "rgba(59,130,246,0.20)" },
  rideOwnerStatusPillDisabled: { opacity: 0.5 },
  rideOwnerStatusPillText: { color: theme.colors.text, fontSize: 11, fontWeight: "600" },
  rideOwnerPrompt: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.45)",
    backgroundColor: "rgba(59,130,246,0.13)",
    color: "#bfdbfe",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  rideOwnerRouteNote: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.30)",
    backgroundColor: "rgba(34,197,94,0.10)",
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 4
  },
  rideOwnerRouteNoteTitle: { color: theme.colors.green, fontSize: 12, fontWeight: "600" },
  rideOwnerRouteNoteText: { color: theme.colors.soft, fontSize: 12, lineHeight: 17, fontWeight: "500" },
  rideOwnerListTripButton: {
    minHeight: 52,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.82)"
  },
  rideOwnerListTripText: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  rideOwnerMissing: { color: "#fca5a5", fontSize: 12, lineHeight: 16, fontWeight: "600" },
  rideOwnerSaveButton: { minHeight: 44, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" },
  rideOwnerSaveText: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  rideOwnerStep: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  rideOwnerStepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: "hidden",
    textAlign: "center",
    lineHeight: 24,
    backgroundColor: theme.colors.accent,
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: "700"
  },
  rideOwnerStepText: { flex: 1, color: theme.colors.soft, fontSize: 12, lineHeight: 17, fontWeight: "500" },
  rideOwnerStatusWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  rideOwnerStatusPill: {
    color: theme.colors.soft,
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
  rideOwnerRequestTitle: { flex: 1, color: theme.colors.text, fontSize: 15, lineHeight: 19, fontWeight: "600" },
  rideOwnerRequestBadge: { color: theme.colors.green, backgroundColor: "rgba(34,197,94,0.13)", borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden", fontSize: 10, fontWeight: "700" },
  rideOwnerRequestBadgeExpired: { color: "#fecaca", backgroundColor: "rgba(239,68,68,0.18)" },
  rideOwnerRequestRoute: { color: theme.colors.soft, fontSize: 12, lineHeight: 17, fontWeight: "500" },
  rideOwnerRequestFacts: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  rideOwnerRequestFact: { color: theme.colors.text, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden", fontSize: 10, fontWeight: "600" },
  rideOwnerRequestMeta: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, fontWeight: "500" },
  rideOwnerPinBox: { alignSelf: "flex-start", borderRadius: 14, borderWidth: 1, borderColor: "rgba(34,197,94,0.38)", backgroundColor: "rgba(34,197,94,0.12)", paddingHorizontal: 12, paddingVertical: 8 },
  rideOwnerPinLabel: { color: theme.colors.green, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  rideOwnerPinValue: { color: theme.colors.text, fontSize: 22, fontWeight: "700", letterSpacing: 3 },
  rideOwnerRequestActionRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  rideOwnerAcceptButton: { minHeight: 38, borderRadius: theme.radius.pill, backgroundColor: theme.colors.blue, justifyContent: "center", paddingHorizontal: 14 },
  rideOwnerDeclineButton: { minHeight: 38, borderRadius: theme.radius.pill, backgroundColor: "rgba(239,68,68,0.88)", justifyContent: "center", paddingHorizontal: 14 },
  rideOwnerActionText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  rideOwnerChatButton: { alignSelf: "flex-start", minHeight: 38, borderRadius: theme.radius.pill, backgroundColor: "rgba(59,130,246,0.18)", borderWidth: 1, borderColor: "rgba(59,130,246,0.42)", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 11 },
  rideOwnerChatIcon: { width: 22, height: 22 },
  rideOwnerChatText: { color: theme.colors.text, fontSize: 12, fontWeight: "600" },
  rideOwnerEmpty: { borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(0,0,0,0.16)", padding: 12, gap: 4 },
  rideOwnerEmptyTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  rideOwnerEmptyText: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, fontWeight: "500" },
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
  rideListingSuccessCard: { width: "100%", maxWidth: 420, borderRadius: 28, borderWidth: 1, borderColor: "rgba(34,197,94,0.48)", backgroundColor: "#171a18", paddingHorizontal: 22, paddingVertical: 26, alignItems: "center", gap: 12 },
  rideListingSuccessIcon: { width: 70, height: 70, borderRadius: 35, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(34,197,94,0.18)", borderWidth: 2, borderColor: theme.colors.green },
  rideListingSuccessCheck: { color: theme.colors.green, fontSize: 38, lineHeight: 43, fontWeight: "900" },
  rideListingSuccessEyebrow: { color: theme.colors.green, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.4, marginTop: 2 },
  rideListingSuccessTitle: { color: theme.colors.text, fontSize: 25, lineHeight: 31, fontWeight: "900", textAlign: "center" },
  rideListingSuccessRoute: { color: theme.colors.soft, fontSize: 16, lineHeight: 22, fontWeight: "800", textAlign: "center" },
  rideListingSuccessFacts: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 7 },
  rideListingSuccessFact: { color: theme.colors.text, fontSize: 12, fontWeight: "900", overflow: "hidden", borderRadius: theme.radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 10, paddingVertical: 6 },
  rideListingSuccessCopy: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, fontWeight: "700", textAlign: "center", marginVertical: 2 },
  rideListingSuccessPrimary: { width: "100%", minHeight: 54, borderRadius: theme.radius.pill, backgroundColor: theme.colors.green, alignItems: "center", justifyContent: "center", marginTop: 3 },
  rideListingSuccessPrimaryText: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  rideListingSuccessSecondary: { minHeight: 44, paddingHorizontal: 24, alignItems: "center", justifyContent: "center" },
  rideListingSuccessSecondaryText: { color: theme.colors.soft, fontSize: 15, fontWeight: "900" },
  ridePlannerScreen: { flex: 1, backgroundColor: "#111" },
  ridePlannerContent: { paddingTop: 26, paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  ridePlannerHandle: { alignSelf: "center", width: 54, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.20)", marginBottom: 2 },
  ridePlannerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  ridePlannerBack: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  ridePlannerBackText: { color: theme.colors.text, fontSize: 32, lineHeight: 34, fontWeight: "500" },
  ridePlannerTitle: { color: theme.colors.text, fontSize: 24, fontWeight: "900" },
  ridePlannerPillRow: { flexDirection: "row", gap: 10 },
  ridePlannerPill: { backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 10 },
  ridePlannerPillText: { color: theme.colors.soft, fontWeight: "900", fontSize: 15 },
  ridePlannerOwnerHint: { color: theme.colors.soft, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  rideRouteInputCard: { flexDirection: "row", alignItems: "center", borderWidth: 2, borderColor: theme.colors.soft, borderRadius: 14, padding: 10, gap: 10 },
  rideRouteRail: { width: 18, alignItems: "center" },
  rideRouteDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.text },
  rideRouteRailLine: { width: 3, height: 42, backgroundColor: theme.colors.muted },
  rideRouteSquare: { width: 12, height: 12, backgroundColor: theme.colors.text },
  rideRouteInputs: { flex: 1, gap: 2 },
  rideRouteInput: { minHeight: 44, color: theme.colors.text, fontSize: 18, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.10)", paddingHorizontal: 0 },
  rideRouteInputActive: { borderBottomColor: theme.colors.blue },
  rideRoutePlus: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  rideRoutePlusText: { color: theme.colors.text, fontSize: 28, lineHeight: 30 },
  rideTypePrompt: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 12,
    gap: 9
  },
  rideTypePromptTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  rideTypePromptCopy: { color: theme.colors.muted, fontSize: 13, lineHeight: 18, fontWeight: "800" },
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
  rideTypePromptChipActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  rideTypePromptChipDisabled: { opacity: 0.52 },
  rideTypePromptChipTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "900" },
  rideTypePromptChipTitleActive: { color: theme.colors.bg },
  rideTypePromptChipMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 3, fontWeight: "900" },
  rideTypePromptChipMetaActive: { color: theme.colors.bg },
  rideTripDetails: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.32)",
    backgroundColor: "rgba(59,130,246,0.09)",
    padding: 12,
    gap: 10
  },
  rideTripDetailsTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  rideTripHint: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  rideTripDetailsRow: { flexDirection: "row", gap: 10 },
  rideTripField: { flex: 1, minWidth: 0, gap: 5 },
  rideTripFieldFull: { width: "100%", gap: 5 },
  rideTripLabel: { color: theme.colors.soft, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4 },
  rideTripInput: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    color: theme.colors.text,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: "900"
  },
  rideSavedRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rideSavedRowCompact: { flexDirection: "row" },
  rideSavedItem: { flex: 1, minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12 },
  rideSavedIcon: { color: theme.colors.soft, fontSize: 22 },
  rideSavedTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  rideSavedMeta: { color: theme.colors.muted, fontSize: 14 },
  rideSuggestionList: { borderTopWidth: 1, borderTopColor: theme.colors.line },
  rideSuggestionHelp: { color: theme.colors.muted, fontSize: 14, paddingVertical: 12, fontWeight: "800" },
  rideSuggestionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  rideSuggestionDistance: { width: 56, alignItems: "center" },
  rideSuggestionIcon: { color: theme.colors.soft, fontSize: 22 },
  rideSuggestionMiles: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  rideSuggestionCopy: { flex: 1, minWidth: 0 },
  rideSuggestionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  rideSuggestionMeta: { color: theme.colors.muted, fontSize: 14, marginTop: 2 },
  rideUtilityRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  rideUtilityIcon: { color: theme.colors.soft, fontSize: 22, width: 42, textAlign: "center" },
  rideUtilityText: { color: theme.colors.soft, fontSize: 16, fontWeight: "900" },
  ridePlannerSearchButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, minHeight: 58, alignItems: "center", justifyContent: "center", marginTop: 4 },
  ridePlannerSearchText: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  rideSearchLoadingOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 30, backgroundColor: "rgba(8,8,9,0.22)", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  rideSearchLoadingCard: { width: "100%", maxWidth: 378, paddingHorizontal: 12, paddingVertical: 20, alignItems: "center", gap: 10 },
  rideSearchLoadingTitle: { color: theme.colors.text, ...theme.typography.sectionTitle, marginTop: 4 },
  rideSearchLoadingCopy: { color: theme.colors.muted, ...theme.typography.body, textAlign: "center" },
  rideSearchLoadingPromo: { width: 354, height: 237, maxWidth: "100%", borderRadius: theme.radius.sm, marginTop: 6 },
  rideChoiceScreen: { flex: 1, backgroundColor: "#111" },
  rideChoiceMap: { flex: 1, minHeight: 320, backgroundColor: "#202632", overflow: "hidden" },
  rideChoiceMapImage: { ...StyleSheet.absoluteFillObject, opacity: 0.94 },
  rideMapBackButton: { position: "absolute", top: 34, left: 22, width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" },
  rideMapBackText: { color: theme.colors.text, fontSize: 34, lineHeight: 36 },
  rideMapRouteLine: { position: "absolute", left: "24%", right: "18%", top: "31%", height: 6, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.90)", transform: [{ rotate: "42deg" }] },
  rideMapCarDot: { position: "absolute", width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.text, borderWidth: 5, borderColor: theme.colors.green },
  rideMapPickupLabel: { position: "absolute", top: 78, left: 82, right: 80, backgroundColor: "rgba(0,0,0,0.76)", borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8 },
  rideMapDestinationLabel: { position: "absolute", bottom: 78, right: 28, left: 120, backgroundColor: "rgba(0,0,0,0.76)", borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8 },
  rideMapLabelText: { color: theme.colors.text, fontSize: 14, fontWeight: "900" },
  rideMapOpenButton: { position: "absolute", right: 16, top: 34, backgroundColor: "rgba(0,0,0,0.72)", borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  rideMapOpenButtonText: { color: theme.colors.text, fontSize: 12, fontWeight: "900" },
  rideChoiceSheet: { maxHeight: "76%", backgroundColor: "#151515", borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  rideChoiceSheetContent: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 86, gap: 12 },
  rideChoiceTitle: { color: theme.colors.text, textAlign: "center", fontSize: 26, fontWeight: "900" },
  rideDriverNotify: { color: theme.colors.muted, textAlign: "center", fontSize: 12, lineHeight: 17, fontWeight: "800" },
  rideChoiceLifecycle: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 7
  },
  rideChoiceLifecycleTitle: { color: theme.colors.text, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  rideChoiceLifecycleSteps: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  rideChoiceLifecyclePill: {
    color: theme.colors.soft,
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
  rideChoiceRouteBadgeText: { color: theme.colors.text, fontSize: 11, fontWeight: "800" },
  rideChoiceCopy: { flex: 1, minWidth: 0 },
  rideChoiceName: { color: theme.colors.text, fontSize: 16, fontWeight: "800", lineHeight: 20 },
  rideChoiceUserTrip: { color: theme.colors.soft, fontSize: 12, marginTop: 4, lineHeight: 16 },
  rideChoiceLister: { color: theme.colors.brand, fontSize: 12, fontWeight: "800", marginTop: 4, lineHeight: 16 },
  rideChoiceSeats: { color: theme.colors.soft, fontSize: 14 },
  rideChoiceMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 5, lineHeight: 16 },
  rideChoiceChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 7 },
  rideChoiceChip: {
    color: theme.colors.soft,
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
  rideChoiceSmallButtonText: { color: theme.colors.text, fontSize: 10, fontWeight: "800" },
  rideChoiceRequestButton: { backgroundColor: theme.colors.text, borderColor: theme.colors.text, paddingHorizontal: 13 },
  rideChoiceRequestButtonText: { color: theme.colors.bg, fontSize: 11, fontWeight: "900" },
  rideChoiceChatButton: { borderColor: "rgba(66,143,255,0.38)", backgroundColor: "rgba(26,78,169,0.18)" },
  rideChoiceChatIcon: { width: 18, height: 15 },
  rideChoiceContribution: { alignItems: "flex-end", gap: 1 },
  rideChoiceAvailability: { flexDirection: "row", alignItems: "center", gap: 6 },
  rideChoiceAvailabilityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.green },
  rideChoiceAvailabilityDotExpired: { backgroundColor: "#f45380" },
  rideChoicePrice: { color: theme.colors.green, fontSize: 17, fontWeight: "900" },
  rideChoicePriceExpired: { color: "#f77ca1" },
  rideChoicePriceMeta: { color: theme.colors.muted, fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
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
  rideNoOffersTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  rideNoOffersCopy: { color: theme.colors.muted, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  ridePaymentRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, borderRadius: 14, backgroundColor: theme.colors.panel2, paddingHorizontal: 12 },
  ridePaymentIcon: { color: theme.colors.text, fontSize: 22 },
  ridePaymentArrow: { color: theme.colors.soft, fontSize: 28 },
  rideInlineChatButton: { minHeight: 38, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", backgroundColor: "rgba(255,255,255,0.08)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 9 },
  rideInlineChatIcon: { width: 20, height: 20 },
  rideInlineChatText: { color: theme.colors.text, fontSize: 11, fontWeight: "900" },
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
  rideIssueTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "800" },
  rideIssueCopy: { color: theme.colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  rideIssueArrow: { color: theme.colors.soft, fontSize: 25, lineHeight: 28 },
  rideRequestStatus: { backgroundColor: "rgba(34,197,94,0.13)", borderWidth: 1, borderColor: "rgba(34,197,94,0.35)", borderRadius: 14, padding: 12 },
  rideRequestStatusText: { color: theme.colors.green, fontSize: 13, lineHeight: 18, fontWeight: "900" },
  rideChoiceButton: { flex: 1, minHeight: 58, borderRadius: 12, backgroundColor: theme.colors.text, alignItems: "center", justifyContent: "center" },
  rideChoiceButtonText: { color: theme.colors.bg, fontSize: 18, fontWeight: "900" },
});
