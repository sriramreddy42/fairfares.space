import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, ImageBackground, ImageSourcePropType, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { absoluteAssetUrl, createMobileRide, getCars, getRides, getRidePlaceSuggestions, quoteRentalCar, rideMapUrl, RidePlaceSuggestion } from "../api/client";
import { appAssets } from "../assets";
import { HousingCard } from "../components/HousingCard";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { BootstrapPayload, Car, HousingPost, RentalQuote, RentalSearchInput, RideInput, RidePost, RideType } from "../types";

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
  onBookCar: (car: Car, details?: Partial<RentalSearchInput>, paymentOption?: "hold" | "full") => void;
  onBottomTabsHiddenChange?: (hidden: boolean) => void;
};

const quickActions: Array<{ label: string; icon: ImageSourcePropType; need: string }> = [
  { label: "I need a place", icon: appAssets.bed, need: "need_place" },
  { label: "Need roommates", icon: appAssets.roommates, need: "need_roommates" },
  { label: "I need a ride", icon: appAssets.ride, need: "ride_need" },
  { label: "I provide a ride", icon: appAssets.ride, need: "ride_offer" }
];

const postActions: Array<{ label: string; sub: string; icon: ImageSourcePropType; intent: string }> = [
  { label: "I need a place", sub: "Post the room, area, budget, and move-in timing you need.", icon: appAssets.bed, intent: "need_place" },
  { label: "I need roommates", sub: "Post your roommate search, preferred area, and fit.", icon: appAssets.roommates, intent: "need_roommates" },
  { label: "I have a property", sub: "List a room or rental and find tenants.", icon: appAssets.bed, intent: "have_place" }
];

const roomTypes: Array<{ label: string; category: string; icon: ImageSourcePropType }> = [
  { label: "Shared Room", category: "shared_room", icon: appAssets.roommates },
  { label: "Single Room", category: "single_room", icon: appAssets.bed },
  { label: "Paying Guest", category: "paying_guest", icon: appAssets.bed }
];

const searchPhrases = ["Search city", "Search area", "Search building"];
const sortOptions: Array<{ label: string; value: Props["selectedSort"] }> = [
  { label: "Distance ↑", value: "distanceAsc" },
  { label: "Distance ↓", value: "distanceDesc" },
  { label: "Rent ↑", value: "rentAsc" },
  { label: "Rent ↓", value: "rentDesc" }
];
const genderOptions = ["Any", "Female", "Male", "Couple", "Family"];
const budgetOptions = ["Any", "$700", "$900", "$1,200", "$1,600", "$2,000"];
const renterAgeOptions = ["21-24", "25+"];
const rideModes: Array<{ type: RideType; title: string; copy: string }> = [
  { type: "GENERAL_REQUEST", title: "Request a ride", copy: "Point-to-point ride for today or later." },
  { type: "SCHEDULED_REQUEST", title: "Scheduled", copy: "Recurring commute with daily ride instances." },
  { type: "CARPOOL_REQUEST", title: "Find carpool", copy: "Match with drivers going your direction." },
  { type: "CARPOOL_OFFER", title: "Offer a ride", copy: "List seats, detour, luggage, and contribution." }
];
const rideServicePosters: Array<{
  key: "scheduled" | "general" | "carpool";
  type: RideType;
  title: string;
  subtitle: string;
  stat: string;
  insight: string;
  tint: string;
  icon: ImageSourcePropType;
  register: string;
  works: string[];
  access: string;
}> = [
  {
    key: "scheduled",
    type: "SCHEDULED_REQUEST",
    title: "Scheduled rides",
    subtitle: "Repeat commute, class, or airport pickup",
    stat: "Example: Lone Tree to DU every Mon-Fri at 8:00 AM",
    insight: "Use this when the same ride repeats. Each day still becomes its own ride so one skipped day does not break the whole schedule.",
    tint: "#8a5a00",
    icon: appAssets.ride,
    register: "Tell us pickup, drop-off, days, start date, pickup time, seats, and notes. Example: Lone Tree to DU, Mon-Fri, 8:00 AM.",
    works: ["We create the repeated ride pattern.", "Drivers who fit that route can accept it.", "Every confirmed day appears in Activity with status and chat."],
    access: "After entering pickup and drop-off, choose Scheduled when the trip repeats."
  },
  {
    key: "general",
    type: "GENERAL_REQUEST",
    title: "General rides",
    subtitle: "One pickup and one drop-off",
    stat: "Example: Denver to Union Station today at 6:00 PM",
    insight: "Use this for a normal local ride. FairFares resolves both places with Google, estimates distance, then shows ride options.",
    tint: "#243b73",
    icon: appAssets.ride,
    register: "Enter where you are, where you are going, pickup date/time, seats, luggage, and notes.",
    works: ["Google Places corrects addresses, landmarks, and typos.", "FairFares estimates distance and trip cost.", "Nearby registered drivers are notified first."],
    access: "Choose General for a one-time ride inside or near the city."
  },
  {
    key: "carpool",
    type: "CARPOOL_REQUEST",
    title: "Carpool",
    subtitle: "Shared route, shared cost",
    stat: "Example: Denver to Colorado Springs or Denver to Cincinnati",
    insight: "Use this for long trips or when riders and drivers are already going the same direction. Detour and seats must be visible.",
    tint: "#0f5f4b",
    icon: appAssets.ride,
    register: "Enter route, date/time, seats, luggage, max pickup distance, and contribution per seat.",
    works: ["FairFares matches routes going the same direction.", "Drivers list open seats and detour limits.", "Passengers request a seat and chat before confirmation."],
    access: "Choose Carpool for city-to-city, long-distance, or shared-cost rides."
  }
];
const rideFeatureBadges = ["Safe", "Affordable", "Reliable", "Route based"];
const rideFlowSteps = ["List route", "Match nearby", "Request seat", "Ride together"];
const rideLaunchReadiness = [
  "Approved driver profile, license, insurance, vehicle, and inspection are required before accepting rides.",
  "Every ride needs a clear status trail from requested to completed, cancelled, no-show, or disputed.",
  "Safety controls must include share trip, pickup PIN, report/block, urgent support, and audit history.",
  "Payments are handled directly between rider and driver for now; FairFares only records the agreed trip details."
];
const rideLifecycleStates = ["Requested", "Matching", "Accepted", "En route", "Arrived", "In progress", "Completed"];
const rideSafetyActions = [
  { label: "Share trip", icon: "↗", body: "Send route, driver, vehicle, and status to a trusted contact." },
  { label: "Pickup PIN", icon: "#", body: "Confirm the passenger and vehicle before the ride starts." },
  { label: "Report issue", icon: "!", body: "Flag safety, behavior, pickup, or route concerns." },
  { label: "Urgent support", icon: "☎", body: "Call or message FairFares support during an active ride." }
];
const rideDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const rideChoiceOptions = [
  { key: "electric", title: "FairFares Electric", meta: "Lower-emission ride", multiplier: 0.95, eta: "5 min", seats: 4 },
  { key: "standard", title: "FairFares Ride", meta: "Everyday reliable pickup", multiplier: 1, eta: "2 min", seats: 4 },
  { key: "xl", title: "FairFares XL", meta: "More seats and luggage room", multiplier: 1.58, eta: "4 min", seats: 6 },
];
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

const initialRideForm: RideInput = {
  rideType: "GENERAL_REQUEST",
  city: "Denver, CO",
  origin: "",
  destination: "",
  pickupDate: isoDateFromNow(1),
  pickupTime: "8:00 AM",
  startDate: isoDateFromNow(1),
  endDate: "",
  daysOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  seats: "1",
  luggage: "1 small bag",
  accessibility: "",
  maxDetourMinutes: "15",
  maxPickupDistanceMiles: "5",
  departureFlexMinutes: "30",
  contributionPerSeat: "",
  approvalRequired: true,
  preferences: "No smoking",
  notes: ""
};

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
  onBookCar,
  onBottomTabsHiddenChange
}: Props) {
  const [mode, setMode] = useState<"housing" | "ride" | "cheapCars">("housing");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailPost, setDetailPost] = useState<HousingPost | null>(null);
  const [searchPhraseIndex, setSearchPhraseIndex] = useState(0);
  const [searchLetterCount, setSearchLetterCount] = useState(1);
  const [rentalSearch, setRentalSearch] = useState<RentalSearchInput>(initialRentalSearch);
  const [rentalCars, setRentalCars] = useState<Car[]>(cars);
  const [rentalBusy, setRentalBusy] = useState(false);
  const [rentalSearched, setRentalSearched] = useState(false);
  const [selectedRentalCar, setSelectedRentalCar] = useState<Car | null>(null);
  const [rentalQuote, setRentalQuote] = useState<RentalQuote | null>(null);
  const [rentalCheckoutInfo, setRentalCheckoutInfo] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [rentalPicker, setRentalPicker] = useState<null | "pickupLocation" | "returnLocation" | "pickupDate" | "returnDate" | "pickupTime" | "returnTime" | "renterAge">(null);
  const [rideForm, setRideForm] = useState<RideInput>(initialRideForm);
  const [rideRows, setRideRows] = useState<RidePost[]>([]);
  const [rideBusy, setRideBusy] = useState(false);
  const [ridePosted, setRidePosted] = useState(false);
  const [ridePlannerOpen, setRidePlannerOpen] = useState(false);
  const [ridePlannerStage, setRidePlannerStage] = useState<"plan" | "choices">("plan");
  const [rideFocusedField, setRideFocusedField] = useState<"origin" | "destination">("destination");
  const [rideSuggestions, setRideSuggestions] = useState<RidePlaceSuggestion[]>([]);
  const [rideSuggestionsBusy, setRideSuggestionsBusy] = useState(false);
  const [selectedRideChoice, setSelectedRideChoice] = useState("standard");
  const [selectedRideService, setSelectedRideService] = useState<"scheduled" | "general" | "carpool">("general");
  const [rideRequestStatus, setRideRequestStatus] = useState("");
  const { width: viewportWidth } = useWindowDimensions();
  const lastScrollYRef = useRef(0);
  const ridePlanSubmittingRef = useRef(false);
  const displayName = data?.user?.name?.split(" ")[0] || "there";
  const selectedLocationText = (data?.location.selected || data?.location.city || "").trim();
  const distanceReference = selectedLocationText.includes("·")
    ? selectedLocationText.split("·").pop()?.trim()
    : data?.location.suggested || data?.location.city || "";
  const rideDefaultPickup = selectedLocationText || data?.location.suggested || data?.location.city || "Current location";
  const animatedSearchText = selectedLocationText || searchPhrases[searchPhraseIndex].slice(0, searchLetterCount);
  const cheapestCar = useMemo(
    () =>
      [...(rentalCars.length ? rentalCars : cars)]
        .filter((car) => Number(car.daily_price) > 0)
        .sort((a, b) => Number(a.daily_price) - Number(b.daily_price))[0],
    [cars, rentalCars]
  );
  const sortedPosts = useMemo(() => {
    const distanceValue = (post: HousingPost) => (post.distanceMiles === null ? Number.MAX_SAFE_INTEGER : post.distanceMiles);
    return [...posts].sort((a, b) => {
      if (selectedSort === "distanceDesc") return distanceValue(b) - distanceValue(a);
      if (selectedSort === "rentAsc") return (a.rentValue || Number.MAX_SAFE_INTEGER) - (b.rentValue || Number.MAX_SAFE_INTEGER);
      if (selectedSort === "rentDesc") return (b.rentValue || 0) - (a.rentValue || 0);
      return distanceValue(a) - distanceValue(b);
    });
  }, [posts, selectedSort]);
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
  const cheapestCarImage = absoluteAssetUrl(cheapestCar?.image_url || "");
  const carHeroSource = cheapestCarImage ? { uri: cheapestCarImage } : appAssets.carFallback;
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

  useEffect(() => {
    setRentalCars(cars);
    setRentalSearched(false);
  }, [cars]);

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
        rideType: selectedNeed === "ride_offer" ? "CARPOOL_OFFER" : current.rideType
      }));
    }
  }, [selectedNeed]);

  useEffect(() => {
    if (!ridePlannerOpen || ridePlannerStage !== "plan") return;
    const query = (rideFocusedField === "origin" ? rideForm.origin : rideForm.destination).trim();
    if (!query) {
      setRideSuggestions([]);
      setRideSuggestionsBusy(false);
      return;
    }
    const timer = setTimeout(() => {
      setRideSuggestionsBusy(true);
      getRidePlaceSuggestions(rideForm.city || data?.location.city || "Denver, CO", query)
        .then(setRideSuggestions)
        .catch(() => setRideSuggestions([]))
        .finally(() => setRideSuggestionsBusy(false));
    }, 260);
    return () => clearTimeout(timer);
  }, [data?.location.city, rideFocusedField, rideForm.city, rideForm.destination, rideForm.origin, ridePlannerOpen, ridePlannerStage]);

  function updateScrollVisibility(y: number) {
    const previous = lastScrollYRef.current;
    if (Math.abs(y - previous) < 18) return;
    onBottomTabsHiddenChange?.(y > previous && y > 80);
    lastScrollYRef.current = y;
  }

  function openRidePlanner() {
    setMode("ride");
    setRidePlannerStage("plan");
    setRideFocusedField("destination");
    setRideSuggestions([]);
    setRideSuggestionsBusy(false);
    setRideRequestStatus("");
    setRideForm((current) => ({
      ...current,
      city: data?.location.city || current.city || "Denver, CO",
      origin: rideDefaultPickup,
      destination: "",
      rideType: current.rideType || "GENERAL_REQUEST"
    }));
    setRidePlannerOpen(true);
    onBottomTabsHiddenChange?.(true);
  }

  function closeRidePlanner() {
    setRidePlannerOpen(false);
    onBottomTabsHiddenChange?.(false);
  }

  function selectRidePlace(place: RidePlaceSuggestion) {
    updateRideForm(rideFocusedField, place.label);
    if (rideFocusedField === "origin") {
      setRideFocusedField("destination");
    }
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

  function rideMilesEstimate() {
    return estimateRideMiles();
  }

  function shouldSuggestCarpool(origin: string, destination: string) {
    return estimateRideMiles(origin, destination, []) >= 50;
  }

  function selectRideService(service: (typeof rideServicePosters)[number]) {
    setSelectedRideService(service.key);
    updateRideForm("rideType", service.type);
  }

  function updateRideType(type: RideType) {
    updateRideForm("rideType", type);
    if (type === "SCHEDULED_REQUEST") {
      setSelectedRideService("scheduled");
    } else if (type === "CARPOOL_REQUEST" || type === "CARPOOL_OFFER") {
      setSelectedRideService("carpool");
    } else {
      setSelectedRideService("general");
    }
  }

  function rideChoicePrice(multiplier: number) {
    const miles = rideMilesEstimate();
    return `$${(6.5 + miles * 1.15 * multiplier).toFixed(2)}`;
  }

  async function planRideRoute() {
    if (ridePlanSubmittingRef.current) return;
    if (!rideForm.destination.trim()) {
      Alert.alert("Destination needed", "Enter where you want to go.");
      return;
    }
    ridePlanSubmittingRef.current = true;
    const effectiveOrigin = rideForm.origin.trim() || selectedLocationText || rideForm.city || "Denver, CO";
    let effectiveDestination = rideForm.destination.trim();
    setRideBusy(true);
    try {
      const destinationMatches = await getRidePlaceSuggestions(rideForm.city, effectiveDestination);
      if (destinationMatches[0]?.label) {
        effectiveDestination = destinationMatches[0].label;
      }
      const nextRideType: RideType = shouldSuggestCarpool(effectiveOrigin, effectiveDestination) ? "CARPOOL_REQUEST" : rideForm.rideType;
      if (nextRideType === "CARPOOL_REQUEST") {
        setSelectedRideService("carpool");
      }
      setRideForm((current) => ({
        ...current,
        origin: effectiveOrigin,
        destination: effectiveDestination,
        rideType: nextRideType
      }));
      const rides = await getRides(rideForm.city, effectiveOrigin, effectiveDestination, nextRideType);
      setRideRows(rides);
      setRidePlannerStage("choices");
    } catch (error) {
      Alert.alert("Ride search failed", error instanceof Error ? error.message : "Unable to search rides.");
    } finally {
      setRideBusy(false);
      ridePlanSubmittingRef.current = false;
    }
  }

  async function requestPlannedRide() {
    if (!data?.user) {
      Alert.alert("Login required", "Please login before requesting a ride so drivers can message you.");
      return;
    }
    const selected = rideChoiceOptions.find((option) => option.key === selectedRideChoice) || rideChoiceOptions[1];
    setRideBusy(true);
    try {
      const result = await createMobileRide({
        ...rideForm,
        rideType: rideForm.rideType === "CARPOOL_OFFER" ? "CARPOOL_REQUEST" : rideForm.rideType,
        notes: [rideForm.notes, `${selected.title} selected.`]
          .filter(Boolean)
          .join(" ")
      });
      const ride = result.ride;
      if (!ride) throw new Error("Ride request was not saved.");
      setRideRows((current) => [ride, ...current.filter((item) => item.id !== ride.id)]);
      setRidePosted(true);
      const notifiedCount = Number(result.dispatch?.notifiedCount || 0);
      const radius = Number(result.dispatch?.nearestRadius || 0);
      setRideRequestStatus(
        notifiedCount
          ? `Pilot request saved and queued for ${notifiedCount} registered driver offer${notifiedCount === 1 ? "" : "s"} within ${radius || 10} miles. A ride is not confirmed until an approved driver accepts. Any ride contribution is agreed directly between rider and driver.`
          : "Pilot request saved. No registered driver offers are currently inside 30 miles, so nearby drivers will see it when they come online or list an approved offer."
      );
    } catch (error) {
      Alert.alert("Ride request failed", error instanceof Error ? error.message : "Unable to request this ride.");
    } finally {
      setRideBusy(false);
    }
  }

  function openPostMap(post: HousingPost) {
    const query = post.lat && post.lng ? `${post.lat},${post.lng}` : `${post.title} ${post.location} ${post.area}`.trim();
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`);
  }

  function openRideGoogleMaps() {
    const origin = rideForm.origin || selectedLocationText || rideForm.city || "Denver, CO";
    const destination = rideForm.destination || rideForm.city || "Denver, CO";
    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    void Linking.openURL(url);
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
        <ImageBackground source={carHeroSource} style={styles.carOverview} imageStyle={styles.carOverviewImage}>
          <View style={styles.carShade}>
            <Text style={styles.carEyebrow}>Rental cars</Text>
            <Text style={styles.carTitle}>Today's cheapest rate</Text>
            <Text style={styles.carMeta}>
              {cheapestCar ? `${cheapestCar.name} · ${cheapestCar.location || "Denver pickup"}` : "Toyota Corolla · Denver International Airport"}
            </Text>
            <Text style={styles.carPhone}>Call / text: +1 9372518688</Text>
            <View style={styles.carFeatureRow}>
              <Text style={styles.carFeature}>Airport pickup</Text>
              <Text style={styles.carFeature}>No hidden fees</Text>
              <Text style={styles.carFeature}>24/7 support</Text>
            </View>
            <View style={styles.carBottomRow}>
              <TouchableOpacity style={styles.bookNow} onPress={() => cheapestCar && reviewRentalCar(cheapestCar)}>
                <Text style={styles.bookNowText}>Review trip</Text>
              </TouchableOpacity>
              <View style={styles.carRateBox}>
                <Text style={styles.carRate}>
                  {cheapestCar
                    ? `$${dailyPriceRange(cheapestCar.daily_price, rentalDayCount).low}-${dailyPriceRange(cheapestCar.daily_price, rentalDayCount).high}`
                    : "$29-39"}
                </Text>
                <Text style={styles.carRateMeta}>per day</Text>
              </View>
            </View>
          </View>
        </ImageBackground>
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
            <View style={styles.carTwoColField}>
              <Text style={styles.carFieldLabel}>Pickup date</Text>
              <TouchableOpacity style={styles.carSelectInput} onPress={() => setRentalPicker("pickupDate")}>
                <Text style={styles.carSelectValue}>{formatDateLabel(rentalSearch.pickupDate)}</Text>
                <Text style={styles.carSelectMeta}>{rentalSearch.pickupDate}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.carTwoColField}>
              <Text style={styles.carFieldLabel}>Return date</Text>
              <TouchableOpacity style={styles.carSelectInput} onPress={() => setRentalPicker("returnDate")}>
                <Text style={styles.carSelectValue}>{formatDateLabel(rentalSearch.returnDate)}</Text>
                <Text style={styles.carSelectMeta}>{rentalSearch.returnDate}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.carTwoCol}>
            <View style={styles.carTwoColField}>
              <Text style={styles.carFieldLabel}>Pickup time</Text>
              <TouchableOpacity style={styles.carSelectInput} onPress={() => setRentalPicker("pickupTime")}>
                <Text style={styles.carSelectValue}>{rentalSearch.pickupTime}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.carTwoColField}>
              <Text style={styles.carFieldLabel}>Return time</Text>
              <TouchableOpacity style={styles.carSelectInput} onPress={() => setRentalPicker("returnTime")}>
                <Text style={styles.carSelectValue}>{rentalSearch.returnTime}</Text>
              </TouchableOpacity>
            </View>
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
          <View style={styles.carList}>
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
    setRideForm((current) => ({ ...current, [key]: value }));
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
      const rides = await getRides(rideForm.city, rideForm.origin, rideForm.destination, rideForm.rideType);
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
      const result = await createMobileRide(rideForm);
      const ride = result.ride;
      if (!ride) throw new Error("Ride was not saved.");
      setRideRows((current) => [ride, ...current.filter((item) => item.id !== ride.id)]);
      setRidePosted(true);
      Alert.alert("Ride posted", ride.type === "SCHEDULED_REQUEST" ? "Your recurring ride was created with daily ride instances." : "Your ride is live.");
    } catch (error) {
      Alert.alert("Ride post failed", error instanceof Error ? error.message : "Unable to post this ride.");
    } finally {
      setRideBusy(false);
    }
  }

  function renderRidePlannerModal() {
    const activeInputValue = rideFocusedField === "origin" ? rideForm.origin : rideForm.destination;
    const mapUri = ridePlanComplete() ? rideMapUrl(rideForm.city, rideForm.origin, rideForm.destination) : "";
    const primaryChoice = rideChoiceOptions.find((option) => option.key === selectedRideChoice) || rideChoiceOptions[1];
    const routeButtonWebProps =
      Platform.OS === "web"
        ? ({ onClick: planRideRoute } as React.ComponentProps<typeof Pressable> & { onClick: () => void })
        : {};
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
                <Text style={styles.ridePlannerTitle}>Plan your ride</Text>
                <View style={styles.ridePlannerBack} />
              </View>

              <View style={styles.ridePlannerPillRow}>
                <TouchableOpacity style={styles.ridePlannerPill}>
                  <Text style={styles.ridePlannerPillText}>◷ Pickup now</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ridePlannerPill}>
                  <Text style={styles.ridePlannerPillText}>♙ For me</Text>
                </TouchableOpacity>
              </View>

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
                      setRideFocusedField("origin");
                      updateRideForm("origin", text);
                    }}
                    placeholder="Pickup location"
                    placeholderTextColor={theme.colors.muted}
                    style={[styles.rideRouteInput, rideFocusedField === "origin" && styles.rideRouteInputActive]}
                  />
                  <TextInput
                    value={rideForm.destination}
                    onFocus={() => setRideFocusedField("destination")}
                    onChangeText={(text) => {
                      setRideFocusedField("destination");
                      updateRideForm("destination", text);
                    }}
                    onSubmitEditing={planRideRoute}
                    placeholder="Where to?"
                    placeholderTextColor={theme.colors.muted}
                    style={[styles.rideRouteInput, rideFocusedField === "destination" && styles.rideRouteInputActive]}
                  />
                </View>
                <TouchableOpacity style={styles.rideRoutePlus} onPress={() => setRideFocusedField("destination")}>
                  <Text style={styles.rideRoutePlusText}>+</Text>
                </TouchableOpacity>
              </View>

              {rideForm.destination.trim() ? (
                <View style={styles.rideTypePrompt}>
                  <Text style={styles.rideTypePromptTitle}>What kind of ride is this?</Text>
                  <Text style={styles.rideTypePromptCopy}>
                    Pick General for one trip, Scheduled when it repeats, or Carpool for long-distance and shared-cost rides.
                  </Text>
                  <View style={styles.rideTypePromptGrid}>
                    {rideServicePosters.map((service) => {
                      const selected = service.key === selectedRideService;
                      const shortHint = service.key === "scheduled" ? "Repeats" : service.key === "carpool" ? "Long/shared" : "One-time";
                      return (
                        <TouchableOpacity
                          key={service.key}
                          style={[styles.rideTypePromptChip, selected && styles.rideTypePromptChipActive]}
                          onPress={() => selectRideService(service)}
                        >
                          <Text style={[styles.rideTypePromptChipTitle, selected && styles.rideTypePromptChipTitleActive]}>{service.title}</Text>
                          <Text style={[styles.rideTypePromptChipMeta, selected && styles.rideTypePromptChipMetaActive]}>{shortHint}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <View style={styles.rideSavedRow}>
                <TouchableOpacity style={styles.rideSavedItem}>
                  <Text style={styles.rideSavedIcon}>▣</Text>
                  <View>
                    <Text style={styles.rideSavedTitle}>Work</Text>
                    <Text style={styles.rideSavedMeta}>Starbucks</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rideSavedItem}>
                  <Text style={styles.rideSavedIcon}>☆</Text>
                  <Text style={styles.rideSavedTitle}>Saved places</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.rideSuggestionList}>
                {rideSuggestionsBusy ? <Text style={styles.rideSuggestionHelp}>Loading nearby places...</Text> : null}
                {!rideSuggestionsBusy && !rideSuggestions.length && activeInputValue.trim() ? (
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
              </View>

              <Pressable style={styles.ridePlannerSearchButton} onPress={planRideRoute} onPressIn={planRideRoute} disabled={rideBusy} {...routeButtonWebProps}>
                <Text style={styles.ridePlannerSearchText}>{rideBusy ? "Finding rides..." : "Find rides"}</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <View style={styles.rideChoiceScreen}>
              <View style={styles.rideChoiceMap}>
                {mapUri ? <Image source={{ uri: mapUri }} style={styles.rideChoiceMapImage} resizeMode="cover" /> : null}
                <TouchableOpacity style={styles.rideMapBackButton} onPress={() => setRidePlannerStage("plan")}>
                  <Text style={styles.rideMapBackText}>‹</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rideMapOpenButton} onPress={openRideGoogleMaps}>
                  <Text style={styles.rideMapOpenButtonText}>Open Google Maps</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.rideChoiceSheet}>
                <View style={styles.ridePlannerHandle} />
                <Text style={styles.rideChoiceTitle}>Choose a ride</Text>
                <Text style={styles.rideDriverNotify}>
                  After you request, FairFares checks registered driver offers within 10 miles first, then 20 and 30 miles. No in-app ride payment is collected; any contribution is agreed directly with the driver.
                </Text>
                <View style={styles.rideChoiceLifecycle}>
                  <Text style={styles.rideChoiceLifecycleTitle}>After you request</Text>
                  <View style={styles.rideChoiceLifecycleSteps}>
                    {["Requested", "Matching", "Accepted", "Completed"].map((state) => (
                      <Text key={state} style={styles.rideChoiceLifecyclePill}>{state}</Text>
                    ))}
                  </View>
                </View>
                {rideChoiceOptions.map((option) => {
                  const selected = option.key === selectedRideChoice;
                  return (
                    <TouchableOpacity key={option.key} style={[styles.rideChoiceRow, selected && styles.rideChoiceRowActive]} onPress={() => setSelectedRideChoice(option.key)}>
                      <Image source={appAssets.ride} style={styles.rideChoiceIcon} resizeMode="contain" />
                      <View style={styles.rideChoiceCopy}>
                        <Text style={styles.rideChoiceName}>{option.title} <Text style={styles.rideChoiceSeats}>♟ {option.seats}</Text></Text>
                        <Text style={styles.rideChoiceMeta}>{option.eta} · {rideMilesEstimate()} mi route</Text>
                      </View>
                      <View style={styles.rideChoiceContribution}>
                        <Text style={styles.rideChoicePrice}>{rideChoicePrice(option.multiplier)}</Text>
                        <Text style={styles.rideChoicePriceMeta}>suggested</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                <View style={styles.ridePaymentRow}>
                  <Text style={styles.ridePaymentIcon}>✓</Text>
                  <View style={styles.rideChoiceCopy}>
                    <Text style={styles.rideChoiceName}>Direct agreement</Text>
                    <Text style={styles.rideChoiceMeta}>FairFares does not collect ride payments in this pilot.</Text>
                  </View>
                </View>
                <View style={styles.rideSafetyGrid}>
                  {rideSafetyActions.map((action) => (
                    <View key={action.label} style={styles.rideSafetyChip}>
                      <Text style={styles.rideSafetyIcon}>{action.icon}</Text>
                      <Text style={styles.rideSafetyLabel}>{action.label}</Text>
                    </View>
                  ))}
                </View>
                {rideRequestStatus ? (
                  <View style={styles.rideRequestStatus}>
                    <Text style={styles.rideRequestStatusText}>{rideRequestStatus}</Text>
                  </View>
                ) : null}
                <View style={styles.rideChoiceButtonRow}>
                  <TouchableOpacity style={styles.rideChoiceButton} onPress={requestPlannedRide} disabled={rideBusy}>
                    <Text style={styles.rideChoiceButtonText}>{rideBusy ? "Requesting..." : `Request ${primaryChoice.title.replace("FairFares ", "")}`}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rideLaterButton}>
                    <Text style={styles.rideLaterButtonText}>▣</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  function renderRideOnly() {
    const activeService = rideServicePosters.find((item) => item.key === selectedRideService) || rideServicePosters[1];
    return (
      <>
        <View style={styles.rideHero}>
          <View style={styles.rideBrandRow}>
            <Image source={appAssets.logo} style={styles.rideBrandLogo} resizeMode="contain" />
            <View style={styles.rideOptionPill}>
              <Text style={styles.rideOptionPillText}>3 ride options</Text>
            </View>
          </View>
          <View style={styles.rideHeroTop}>
            <View style={styles.rideHeroCopy}>
              <Text style={styles.rideEyebrow}>FairFares rides</Text>
              <Text style={styles.rideTitle}>Ride together. <Text style={styles.rideTitleAccent}>Save together.</Text></Text>
              <Text style={styles.rideMeta}>Scheduled. Flexible. Together.</Text>
            </View>
            <Image source={appAssets.ride} style={styles.rideHeroIcon} resizeMode="contain" />
          </View>
          <View style={styles.rideFeatureRow}>
            {rideFeatureBadges.map((badge) => (
              <Text key={badge} style={styles.rideFeatureBadge}>{badge}</Text>
            ))}
          </View>
          <View style={styles.ridePilotNote}>
            <Text style={styles.ridePilotNoteText}>
              Controlled pilot: rides require approved drivers, verified documents, lifecycle tracking, and safety controls before public launch.
            </Text>
          </View>
          <TouchableOpacity style={styles.rideHeroPlanButton} onPress={openRidePlanner}>
            <Text style={styles.rideHeroPlanText}>Where to?</Text>
            <Text style={styles.rideHeroPlanMeta}>Plan route with Google places</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.ridePosterSection}>
          <View style={styles.ridePosterHeader}>
            <Text style={styles.rideSectionEyebrow}>Ride services</Text>
            <Text style={styles.ridePosterHint}>Tap a card to learn and start</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ridePosterCarousel}>
            {rideServicePosters.map((service) => {
              const selected = service.key === selectedRideService;
              return (
                <TouchableOpacity
                  key={service.key}
                  activeOpacity={0.88}
                  style={[styles.ridePosterCard, { backgroundColor: service.tint }, selected && styles.ridePosterCardActive]}
                  onPress={() => selectRideService(service)}
                >
                  <View style={styles.ridePosterCopy}>
                    <Text style={styles.ridePosterTitle}>{service.title}</Text>
                    <Text style={styles.ridePosterSubtitle}>{service.subtitle}</Text>
                    <Text style={styles.ridePosterButton}>Learn more</Text>
                  </View>
                  <View style={styles.ridePosterArt}>
                    <Image source={service.icon} style={styles.ridePosterIcon} resizeMode="contain" />
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={styles.rideServiceDetail}>
            <View style={styles.rideServiceDetailHeader}>
              <View style={styles.rideServiceDetailIconWrap}>
                <Image source={activeService.icon} style={styles.rideServiceDetailIcon} resizeMode="contain" />
              </View>
              <View style={styles.rideServiceDetailCopy}>
                <Text style={styles.rideServiceDetailTitle}>{activeService.title} in {data?.location.city || "your city"}</Text>
                <Text style={styles.rideServiceDetailText}>{activeService.insight}</Text>
              </View>
            </View>
            <View style={styles.rideExampleBox}>
              <Text style={styles.rideServiceDetailLabel}>Example</Text>
              <Text style={styles.rideServiceDetailText}>{activeService.stat}</Text>
            </View>
            <Text style={styles.rideServiceDetailLabel}>How it works</Text>
            {activeService.works.map((step, index) => (
              <View key={step} style={styles.rideServiceStep}>
                <View style={styles.rideServiceStepDot}>
                  <Text style={styles.rideServiceStepDotText}>{index + 1}</Text>
                </View>
                <Text style={styles.rideServiceStepText}>{step}</Text>
              </View>
            ))}
            <View style={styles.rideReadinessCard}>
              <Text style={styles.rideServiceDetailLabel}>Pilot readiness</Text>
              <Text style={styles.rideServiceDetailText}>
                This ride flow should stay in controlled pilot mode until these blockers are fully wired and tested.
              </Text>
              {rideLaunchReadiness.map((item) => (
                <View key={item} style={styles.rideReadinessItem}>
                  <Text style={styles.rideReadinessCheck}>✓</Text>
                  <Text style={styles.rideReadinessText}>{item}</Text>
                </View>
              ))}
            </View>
            <View style={styles.rideLifecycleCard}>
              <Text style={styles.rideServiceDetailLabel}>Ride lifecycle</Text>
              <View style={styles.rideLifecycleWrap}>
                {rideLifecycleStates.map((state, index) => (
                  <View key={state} style={styles.rideLifecyclePill}>
                    <Text style={styles.rideLifecycleNumber}>{index + 1}</Text>
                    <Text style={styles.rideLifecycleText}>{state}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.rideSafetyCard}>
              <Text style={styles.rideServiceDetailLabel}>Safety controls</Text>
              {rideSafetyActions.map((action) => (
                <View key={action.label} style={styles.rideSafetyRow}>
                  <Text style={styles.rideSafetyRowIcon}>{action.icon}</Text>
                  <View style={styles.rideSafetyRowCopy}>
                    <Text style={styles.rideSafetyRowTitle}>{action.label}</Text>
                    <Text style={styles.rideSafetyRowBody}>{action.body}</Text>
                  </View>
                </View>
              ))}
            </View>
            <Text style={styles.rideServiceDetailLabel}>What you enter</Text>
            <Text style={styles.rideServiceDetailText}>{activeService.register}</Text>
            <Text style={styles.rideServiceDetailLabel}>Where to start</Text>
            <Text style={styles.rideServiceDetailText}>{activeService.access}</Text>
            <TouchableOpacity style={styles.rideServicePlanButton} onPress={openRidePlanner}>
              <Text style={styles.rideServicePlanButtonText}>Plan this ride</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      stickyHeaderIndices={[2]}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(event) => updateScrollVisibility(event.nativeEvent.contentOffset.y)}
    >
        <View style={styles.brandHeader}>
          <Image source={appAssets.logo} style={styles.logo} resizeMode="contain" />
        </View>

        <View style={styles.topTabs}>
          {["Ride", "Housing", "Explorer", "Deals"].map((item) => (
            <TouchableOpacity
              key={item}
              onPress={() => (item === "Ride" ? setMode("ride") : item === "Housing" ? setMode("housing") : onTopAction(item))}
              style={[styles.topTab, ((item === "Ride" && mode === "ride") || (item === "Housing" && mode !== "ride" && mode !== "cheapCars")) && styles.topTabActive]}
            >
              <Text style={[styles.topTabText, ((item === "Ride" && mode === "ride") || (item === "Housing" && mode !== "ride" && mode !== "cheapCars")) && styles.topTabTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.stickySearch}>
          <TouchableOpacity style={styles.searchBar} onPress={mode === "ride" ? openRidePlanner : onOpenSearch}>
            <Image source={appAssets.search} style={styles.searchIcon} resizeMode="contain" />
            <Text style={styles.searchText} numberOfLines={1}>{mode === "ride" ? (rideForm.destination || `Hi, ${displayName}`) : animatedSearchText}</Text>
            <Text style={styles.later}>{mode === "ride" ? "Later" : "Search"}</Text>
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
          }}
        >
          <Text style={[styles.segmentText, mode === "ride" && styles.segmentTextActive]}>Ride</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentButton, mode === "cheapCars" && styles.segmentActive]}
          onPress={() => {
            setMode("cheapCars");
          }}
        >
          <Text style={[styles.segmentText, mode === "cheapCars" && styles.segmentTextActive]}>Rental Cars</Text>
        </TouchableOpacity>
      </View>

      {mode === "cheapCars" ? renderRentalCarsOnly() : mode === "ride" ? renderRideOnly() : (
        <>

      <SectionHeader title="Create a post" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
        {quickActions.map((action) => (
          <TouchableOpacity key={action.label} style={styles.quickAction} onPress={() => action.need.startsWith("ride") ? setMode("ride") : onNeedSelect(action.need)}>
            <View style={[styles.quickBubble, selectedNeed === action.need && styles.quickBubbleActive]}>
              <Image source={action.icon} style={styles.quickIcon} resizeMode="contain" />
            </View>
            <Text style={[styles.quickLabel, selectedNeed === action.need && styles.quickLabelActive]}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.postActionGrid}>
        {postActions.map((action) => (
          <TouchableOpacity key={action.intent} style={styles.postActionCard} onPress={() => onPostNeed(action.intent)}>
            <Image source={action.icon} style={styles.postActionIcon} resizeMode="contain" />
            <View style={styles.postActionCopy}>
              <Text style={styles.postNeedTitle}>{action.label}</Text>
              <Text style={styles.postNeedMeta}>{action.sub}</Text>
            </View>
          </TouchableOpacity>
        ))}
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
      <View style={styles.filterPanel}>
        <TouchableOpacity style={styles.filterHeader} onPress={() => setFiltersOpen((value) => !value)}>
          <Text style={styles.filterHeaderTitle}>Filters</Text>
          <Text style={styles.filterHeaderMeta}>
            {selectedCategory ? roomTypes.find((type) => type.category === selectedCategory)?.label : "Room type"} · {selectedGender || "Any"} · {selectedBudget ? `$${selectedBudget}` : "Any budget"}
          </Text>
        </TouchableOpacity>
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
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {sortedPosts.length ? (
          sortedPosts.map((post) => <HousingCard key={post.id} post={post} onMessage={onMessage} onOpen={setDetailPost} distanceLabel={distanceReference} />)
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
                    <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.detailCarousel}>
                      {detailImages.map((image, index) => (
                        <Image key={`${image}-${index}`} source={{ uri: absoluteAssetUrl(image) }} style={[styles.detailImage, { width: detailImageWidth }]} />
                      ))}
                    </ScrollView>
                    {detailImages.length > 1 ? (
                      <View style={styles.detailImageDots}>
                        {detailImages.map((image, index) => (
                          <Text key={`${image}-dot-${index}`} style={styles.detailImageDot}>
                            {index + 1}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.detailImageFallback} />
                )}
                <Text style={styles.detailTitle}>{detailPost.title}</Text>
                <Text style={styles.detailMeta}>{detailPost.location}{detailPost.area ? ` · ${detailPost.area}` : ""}</Text>
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
                </View>
                <TouchableOpacity style={styles.detailMessage} onPress={() => onMessage(detailPost)}>
                  <Text style={styles.detailMessageText}>Message</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : null}
          </View>
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
  content: { padding: theme.spacing.md, paddingBottom: 122, gap: theme.spacing.lg },
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
  postActionGrid: { gap: 10 },
  postActionCard: { backgroundColor: "#fff7df", borderRadius: theme.radius.lg, padding: theme.spacing.md, flexDirection: "row", alignItems: "center", gap: 12 },
  postActionIcon: { width: 42, height: 42 },
  postActionCopy: { flex: 1, minWidth: 0 },
  postNeedTitle: { color: "#111", fontSize: 17, lineHeight: 21, fontWeight: "900" },
  postNeedMeta: { color: "#5b5148", marginTop: 4, fontSize: 14 },
  welcome: { borderWidth: 1, borderColor: theme.colors.brand, borderRadius: theme.radius.md, padding: theme.spacing.md, backgroundColor: "#18241d", gap: 8 },
  welcomeTitle: { color: theme.colors.text, fontSize: 21, fontWeight: "900" },
  welcomeMeta: { color: theme.colors.soft, fontSize: 15 },
  statRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  stat: { color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.brand, borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 8, overflow: "hidden", fontWeight: "900" },
  emptyCard: { width: 286, minHeight: 170, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, justifyContent: "center" },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  emptyText: { color: theme.colors.muted, marginTop: 8 },
  filterPanel: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, gap: 10 },
  filterHeader: { gap: 4 },
  filterHeaderTitle: { color: theme.colors.text, fontSize: 22, fontWeight: "900" },
  filterHeaderMeta: { color: theme.colors.muted, fontSize: 13, fontWeight: "800" },
  filterTitle: { color: theme.colors.muted, fontSize: 13, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  filterRow: { gap: 8, paddingRight: theme.spacing.md },
  filterChip: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: theme.colors.bg },
  filterChipActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  filterChipText: { color: theme.colors.soft, fontWeight: "900" },
  filterChipTextActive: { color: theme.colors.bg },
  carOverview: { minHeight: 360, borderRadius: theme.radius.lg, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.line },
  carOverviewImage: { borderRadius: theme.radius.lg },
  carShade: { flex: 1, padding: theme.spacing.lg, justifyContent: "space-between", backgroundColor: "rgba(0,0,0,0.48)", gap: theme.spacing.md },
  carEyebrow: { color: theme.colors.accent, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  carTitle: { color: theme.colors.text, fontSize: 34, lineHeight: 38, fontWeight: "900", maxWidth: 260 },
  carMeta: { color: theme.colors.soft, fontWeight: "900", lineHeight: 20, maxWidth: 280 },
  carPhone: { color: theme.colors.green, fontWeight: "900", fontSize: 18 },
  carFeatureRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  carFeature: { color: theme.colors.text, backgroundColor: "rgba(0,0,0,0.55)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 7, overflow: "hidden", fontWeight: "900", fontSize: 12 },
  carBottomRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: theme.spacing.md },
  bookNow: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingHorizontal: 20, paddingVertical: 13 },
  bookNowText: { color: theme.colors.text, fontWeight: "900", textTransform: "uppercase" },
  carRateBox: { minWidth: 108, borderRadius: theme.radius.md, backgroundColor: theme.colors.text, padding: theme.spacing.sm, alignItems: "center" },
  carRate: { color: theme.colors.bg, fontSize: 25, fontWeight: "900" },
  carRateMeta: { color: "#555", fontWeight: "900" },
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
  carSearchTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "900" },
  carFieldLabel: { color: theme.colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  carSearchInput: { backgroundColor: "rgba(255,255,255,0.08)", color: theme.colors.text, borderRadius: theme.radius.md, minHeight: 48, paddingHorizontal: 13, fontSize: 15, fontWeight: "800" },
  carSelectInput: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: theme.radius.md, minHeight: 56, paddingHorizontal: 13, paddingVertical: 9, justifyContent: "center" },
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
  carSearchButtonText: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  carList: { gap: theme.spacing.md },
  carMiniCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, overflow: "hidden" },
  carMiniCardActive: { borderColor: theme.colors.blue },
  carMiniImage: { width: "100%", height: 170 },
  carMiniBody: { padding: theme.spacing.md, gap: 6 },
  carMiniTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
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
  reviewTitle: { color: theme.colors.text, fontSize: 28, fontWeight: "900" },
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
  pickerTitle: { color: theme.colors.text, fontSize: 24, fontWeight: "900" },
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
  roomCircle: { width: 86, height: 86, borderRadius: 43, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  roomCircleActive: { borderWidth: 2, borderColor: theme.colors.brand },
  roomIcon: { width: 58, height: 58 },
  roomLabel: { color: theme.colors.soft, fontWeight: "900", fontSize: 16 },
  localityCard: { width: 270, borderRadius: theme.radius.lg, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, marginRight: theme.spacing.md, padding: theme.spacing.md, gap: 14 },
  localityTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  localityStats: { flexDirection: "row", gap: 10 },
  localityChip: { color: theme.colors.blue, borderWidth: 1, borderColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 7, overflow: "hidden", fontWeight: "800" },
  avgRent: { color: theme.colors.green, fontSize: 18, fontWeight: "900" },
  detailBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.74)", padding: theme.spacing.md, justifyContent: "center" },
  detailCard: { maxHeight: "88%", backgroundColor: theme.colors.panel, borderRadius: 28, borderWidth: 1, borderColor: theme.colors.line, overflow: "hidden" },
  detailHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  detailEyebrow: { color: theme.colors.accent, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  detailClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  detailCloseText: { color: theme.colors.text, fontWeight: "900" },
  detailContent: { padding: theme.spacing.md, gap: theme.spacing.md },
  detailCarouselWrap: { borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: "#202a25" },
  detailCarousel: { width: "100%" },
  detailImage: { height: 190, borderRadius: theme.radius.md },
  detailImageDots: { position: "absolute", bottom: 10, alignSelf: "center", flexDirection: "row", gap: 6, backgroundColor: "rgba(0,0,0,0.58)", borderRadius: theme.radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  detailImageDot: { color: theme.colors.text, fontSize: 12, fontWeight: "900" },
  detailImageFallback: { width: "100%", height: 190, borderRadius: theme.radius.md, backgroundColor: "#202a25" },
  detailTitle: { color: theme.colors.text, fontSize: 25, lineHeight: 29, fontWeight: "900" },
  detailMeta: { color: theme.colors.muted, fontSize: 16, fontWeight: "800" },
  detailMap: { backgroundColor: theme.colors.bg, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.lg, padding: theme.spacing.md, gap: 8 },
  detailMapTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  detailMapText: { color: theme.colors.green, fontSize: 15, fontWeight: "900" },
  detailMapButton: { alignSelf: "flex-start", borderWidth: 1, borderColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  detailMapButtonText: { color: theme.colors.text, fontWeight: "900" },
  detailDescription: { color: theme.colors.soft, fontSize: 16, lineHeight: 22 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  detailFact: { color: theme.colors.soft, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 7, fontWeight: "800" },
  detailMessage: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.pill, alignItems: "center", paddingVertical: 13 },
  detailMessageText: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  rideHero: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "#090d12",
    padding: 12,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 }
  },
  rideBrandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  rideBrandLogo: { width: 106, height: 38 },
  rideOptionPill: { backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  rideOptionPillText: { color: theme.colors.text, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  rideHeroTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  rideHeroIcon: { width: 62, height: 62 },
  rideHeroCopy: { flex: 1, minWidth: 0 },
  rideEyebrow: { color: theme.colors.accent, fontSize: 11, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  rideTitle: { color: theme.colors.text, fontSize: 29, lineHeight: 31, fontWeight: "900", marginTop: 2, textTransform: "uppercase" },
  rideTitleAccent: { color: theme.colors.accent },
  rideMeta: { color: theme.colors.muted, fontSize: 13, lineHeight: 17, fontWeight: "800", marginTop: 3 },
  rideFeatureRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rideFeatureBadge: { color: theme.colors.soft, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: theme.radius.pill, paddingHorizontal: 9, paddingVertical: 5, overflow: "hidden", fontSize: 12, fontWeight: "900" },
  ridePilotNote: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,193,7,0.24)",
    backgroundColor: "rgba(255,193,7,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  ridePilotNoteText: { color: theme.colors.soft, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  ridePosterSection: { gap: theme.spacing.md },
  ridePosterHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  ridePosterHint: { color: theme.colors.muted, fontSize: 12, fontWeight: "900" },
  ridePosterCarousel: { gap: 12, paddingRight: 18 },
  ridePosterCard: {
    width: 310,
    minHeight: 150,
    borderRadius: 20,
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
  ridePosterCopy: { flex: 1, padding: 16, justifyContent: "space-between", gap: 12 },
  ridePosterTitle: { color: theme.colors.text, fontSize: 24, lineHeight: 28, fontWeight: "900" },
  ridePosterSubtitle: { color: "rgba(255,255,255,0.78)", fontSize: 13, lineHeight: 18, fontWeight: "800" },
  ridePosterButton: { alignSelf: "flex-start", color: theme.colors.text, backgroundColor: "rgba(0,0,0,0.46)", borderRadius: theme.radius.pill, overflow: "hidden", paddingHorizontal: 14, paddingVertical: 8, fontSize: 13, fontWeight: "900" },
  ridePosterArt: { width: 116, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.12)" },
  ridePosterIcon: { width: 78, height: 78 },
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
  rideInsightTitle: { color: theme.colors.text, fontSize: 24, lineHeight: 28, fontWeight: "900" },
  rideInsightMeta: { color: theme.colors.soft, fontSize: 15, lineHeight: 21, fontWeight: "800" },
  rideServiceDetail: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(15,23,42,0.76)",
    padding: theme.spacing.md,
    gap: 9
  },
  rideServiceDetailHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  rideServiceDetailIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center"
  },
  rideServiceDetailIcon: { width: 42, height: 42 },
  rideServiceDetailCopy: { flex: 1, minWidth: 0 },
  rideServiceDetailTitle: { color: theme.colors.text, fontSize: 22, lineHeight: 26, fontWeight: "900" },
  rideServiceDetailLabel: { color: theme.colors.accent, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  rideServiceDetailText: { color: theme.colors.soft, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  rideExampleBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 12,
    gap: 4
  },
  rideServiceStep: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  rideServiceStepDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center", marginTop: 1 },
  rideServiceStepDotText: { color: theme.colors.text, fontSize: 11, fontWeight: "900" },
  rideServiceStepText: { flex: 1, color: theme.colors.soft, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  rideReadinessCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,193,7,0.28)",
    backgroundColor: "rgba(255,193,7,0.08)",
    padding: 12,
    gap: 8
  },
  rideReadinessItem: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  rideReadinessCheck: { color: theme.colors.green, fontSize: 14, lineHeight: 19, fontWeight: "900" },
  rideReadinessText: { flex: 1, color: theme.colors.soft, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  rideLifecycleCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 12,
    gap: 8
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
  rideServicePlanButton: { marginTop: 2, minHeight: 48, borderRadius: theme.radius.pill, backgroundColor: theme.colors.blue, alignItems: "center", justifyContent: "center" },
  rideServicePlanButtonText: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  rideModeSection: { gap: theme.spacing.md },
  rideSectionEyebrow: { color: theme.colors.accent, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  rideModeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  rideModeCard: {
    width: "48%",
    minHeight: 132,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: 12,
    justifyContent: "space-between",
    gap: 8
  },
  rideModeCardActive: { borderColor: theme.colors.accent, backgroundColor: "rgba(255,59,48,0.18)" },
  rideModeIconWrap: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  rideModeIcon: { width: 34, height: 34 },
  rideModeCopyBlock: { gap: 4 },
  rideModeTitle: { color: theme.colors.text, fontSize: 16, lineHeight: 20, fontWeight: "900" },
  rideModeTitleActive: { color: theme.colors.text },
  rideModeCopy: { color: theme.colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "800", marginTop: 7 },
  rideModeCopyActive: { color: theme.colors.soft },
  rideFlowStrip: { flexDirection: "row", flexWrap: "wrap", gap: 8, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", padding: 10, backgroundColor: "rgba(255,255,255,0.04)" },
  rideFlowStep: { width: "48%", flexDirection: "row", alignItems: "center", gap: 8 },
  rideFlowDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" },
  rideFlowDotText: { color: theme.colors.text, fontSize: 12, fontWeight: "900" },
  rideFlowText: { color: theme.colors.soft, flex: 1, fontSize: 12, fontWeight: "800" },
  rideActiveSummary: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.05)", padding: theme.spacing.md },
  rideSummaryTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
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
  rideFormTitle: { color: theme.colors.text, fontSize: 22, fontWeight: "900" },
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
  rideHeroPlanButton: {
    marginTop: theme.spacing.md,
    minHeight: 62,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: theme.spacing.md,
    justifyContent: "center"
  },
  rideHeroPlanText: { color: theme.colors.text, fontSize: 22, fontWeight: "900" },
  rideHeroPlanMeta: { color: theme.colors.muted, fontSize: 13, fontWeight: "800", marginTop: 2 },
  ridePlannerScreen: { flex: 1, backgroundColor: "#111" },
  ridePlannerContent: { paddingTop: 26, paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  ridePlannerHandle: { alignSelf: "center", width: 54, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.20)", marginBottom: 2 },
  ridePlannerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  ridePlannerBack: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  ridePlannerBackText: { color: theme.colors.text, fontSize: 40, lineHeight: 42, fontWeight: "500" },
  ridePlannerTitle: { color: theme.colors.text, fontSize: 24, fontWeight: "900" },
  ridePlannerPillRow: { flexDirection: "row", gap: 10 },
  ridePlannerPill: { backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 10 },
  ridePlannerPillText: { color: theme.colors.soft, fontWeight: "900", fontSize: 15 },
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
  rideTypePromptChipTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "900" },
  rideTypePromptChipTitleActive: { color: theme.colors.bg },
  rideTypePromptChipMeta: { color: theme.colors.muted, fontSize: 11, marginTop: 3, fontWeight: "900" },
  rideTypePromptChipMetaActive: { color: theme.colors.bg },
  rideSavedRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
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
  rideChoiceScreen: { flex: 1, backgroundColor: "#111" },
  rideChoiceMap: { flex: 1, minHeight: 320, backgroundColor: "#202632", overflow: "hidden" },
  rideChoiceMapImage: { ...StyleSheet.absoluteFillObject, opacity: 0.94 },
  rideMapBackButton: { position: "absolute", top: 34, left: 22, width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" },
  rideMapBackText: { color: theme.colors.text, fontSize: 42, lineHeight: 44 },
  rideMapRouteLine: { position: "absolute", left: "24%", right: "18%", top: "31%", height: 6, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.90)", transform: [{ rotate: "42deg" }] },
  rideMapCarDot: { position: "absolute", width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.text, borderWidth: 5, borderColor: theme.colors.green },
  rideMapPickupLabel: { position: "absolute", top: 78, left: 82, right: 80, backgroundColor: "rgba(0,0,0,0.76)", borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8 },
  rideMapDestinationLabel: { position: "absolute", bottom: 78, right: 28, left: 120, backgroundColor: "rgba(0,0,0,0.76)", borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8 },
  rideMapLabelText: { color: theme.colors.text, fontSize: 14, fontWeight: "900" },
  rideMapOpenButton: { position: "absolute", right: 16, top: 34, backgroundColor: "rgba(0,0,0,0.72)", borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  rideMapOpenButtonText: { color: theme.colors.text, fontSize: 12, fontWeight: "900" },
  rideChoiceSheet: { maxHeight: "64%", backgroundColor: "#151515", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24, gap: 12 },
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
  rideChoiceRow: { minHeight: 76, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: "transparent" },
  rideChoiceRowActive: { borderColor: theme.colors.text, backgroundColor: "rgba(255,255,255,0.04)" },
  rideChoiceIcon: { width: 54, height: 42 },
  rideChoiceCopy: { flex: 1, minWidth: 0 },
  rideChoiceName: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  rideChoiceSeats: { color: theme.colors.soft, fontSize: 14 },
  rideChoiceMeta: { color: theme.colors.muted, fontSize: 14, marginTop: 3 },
  rideChoiceContribution: { alignItems: "flex-end", gap: 1 },
  rideChoicePrice: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  rideChoicePriceMeta: { color: theme.colors.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  ridePaymentRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, borderRadius: 14, backgroundColor: theme.colors.panel2, paddingHorizontal: 12 },
  ridePaymentIcon: { color: theme.colors.text, fontSize: 22 },
  ridePaymentArrow: { color: theme.colors.soft, fontSize: 28 },
  rideSafetyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rideSafetyChip: {
    width: "48%",
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  rideSafetyIcon: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  rideSafetyLabel: { flex: 1, color: theme.colors.soft, fontSize: 12, fontWeight: "900" },
  rideRequestStatus: { backgroundColor: "rgba(34,197,94,0.13)", borderWidth: 1, borderColor: "rgba(34,197,94,0.35)", borderRadius: 14, padding: 12 },
  rideRequestStatusText: { color: theme.colors.green, fontSize: 13, lineHeight: 18, fontWeight: "900" },
  rideChoiceButtonRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rideChoiceButton: { flex: 1, minHeight: 58, borderRadius: 12, backgroundColor: theme.colors.text, alignItems: "center", justifyContent: "center" },
  rideChoiceButtonText: { color: theme.colors.bg, fontSize: 18, fontWeight: "900" },
  rideLaterButton: { width: 58, height: 58, borderRadius: 12, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  rideLaterButtonText: { color: theme.colors.text, fontSize: 24 }
});
