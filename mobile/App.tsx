import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Easing, Image, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { BottomTabs, TabKey } from "./src/components/BottomTabs";
import { DateTimeField, todayLocalIso } from "./src/components/DateTimeField";
import { bookRentalCar, createMobileHousingPost, getAccommodationLocationOptions, getBootstrap, getCars, getChatConversations, getHousing, getRidePlaceSuggestions, getSiteServices, lookupAccommodationLocation, mobileLogin, mobileLogout, mobileSignup, MobileHousingPostInput, registerMobilePushToken, RidePlaceSuggestion, startRentalCheckout } from "./src/api/client";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { HousingScreen } from "./src/screens/HousingScreen";
import { MessengerScreen } from "./src/screens/MessengerScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { syncChatIdentityRecovery } from "./src/utils/chatRecovery";
import { ServiceKey, ServicesScreen } from "./src/screens/ServicesScreen";
import { theme } from "./src/theme";
import { BootstrapPayload, Car, HousingPost, RentalSearchInput, RidePost, ServiceItem } from "./src/types";
import { pickCompressedImages } from "./src/utils/imageUpload";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true
  })
});

const emptyListingForm: MobileHousingPostInput = {
  postMode: "HAVE_PLACE",
  category: "single_room",
  title: "",
  description: "",
  city: "Denver, CO",
  streetAddress: "",
  zipCode: "",
  area: "",
  primaryNeighborhood: "",
  apartmentName: "",
  workSchoolLocation: "",
  radiusMiles: "10",
  moveInDate: "",
  rentMin: "",
  rentMax: "",
  rentPeriod: "MONTH",
  accommodates: "",
  roommateCount: "",
  aboutYou: "",
  bathroomType: "shared",
  genderPreference: "open",
  commutePreference: "",
  leaseTerm: "flexible",
  deposit: "",
  daysAvailable: "",
  vegetarianPreference: "",
  smokingPolicy: "",
  petFriendly: "",
  amenities: "",
  furnished: false,
  privateBath: false,
  parking: false,
  utilitiesIncluded: false,
  socialFacebook: "",
  socialX: "",
  socialInstagram: "",
  socialYoutube: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  roommateIntent: false,
  images: []
};

const listingModes: Array<[MobileHousingPostInput["postMode"], string]> = [
  ["HAVE_PLACE", "I have a place"],
  ["NEED_PLACE", "I need a place"]
];

const listingCategories: Array<[string, string]> = [
  ["single_room", "Single"],
  ["shared_room", "Shared"],
  ["paying_guest", "PG"],
  ["apartment", "Apartment"],
  ["single_family_home", "Home"],
  ["condo", "Condo"],
  ["town_house", "Townhouse"],
  ["basement_apartment", "Basement"]
];

const rentPeriods: Array<[string, string]> = [
  ["MONTH", "Monthly"],
  ["WEEK", "Weekly"],
  ["NIGHT", "Nightly"],
  ["FLEXIBLE", "Flexible"]
];

const bathroomOptions: Array<[string, string]> = [
  ["shared", "Shared bath"],
  ["private", "Private bath"],
  ["private_shared", "Private/shared"]
];

const genderOptions: Array<[string, string]> = [
  ["open", "Open"],
  ["female", "Female"],
  ["male", "Male"],
  ["couple", "Couple"],
  ["family", "Family"]
];

const leaseOptions: Array<[string, string]> = [
  ["short_stay", "Short stay"],
  ["one_month", "One month"],
  ["flexible", "Flexible"],
  ["three_to_six", "3-6 months"],
  ["six_to_twelve", "6-12 months"],
  ["year_plus", "12+ months"]
];

const lifestyleOptions: Array<[keyof MobileHousingPostInput, string, string[]]> = [
  ["vegetarianPreference", "Vegetarian", ["Mandatory veg", "Non-veg ok", "Both"]],
  ["smokingPolicy", "Smoking", ["No smoking", "Smoking ok", "Outside only"]],
  ["petFriendly", "Pets", ["No pets", "Only dogs", "Only cats", "Any pet ok"]]
];

const amenityToggles: Array<[keyof MobileHousingPostInput, string]> = [
  ["furnished", "Furnished"],
  ["privateBath", "Private bath"],
  ["parking", "Parking"],
  ["utilitiesIncluded", "Utilities included"]
];

export default function App() {
  return (
    <SafeAreaProvider>
      <FairFaresApp />
    </SafeAreaProvider>
  );
}

function FairFaresApp() {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const wideLaunchLayout = viewportWidth / Math.max(viewportHeight, 1) > 1.05;
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [identifier, setIdentifier] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [pendingPost, setPendingPost] = useState<HousingPost | null>(null);
  const [pendingRide, setPendingRide] = useState<RidePost | null>(null);
  const [pendingGroupInvite, setPendingGroupInvite] = useState("");
  const [pendingListingAfterLogin, setPendingListingAfterLogin] = useState(false);
  const [rideOwnerOpenToken, setRideOwnerOpenToken] = useState(0);
  const [rideOwnerOpenTarget, setRideOwnerOpenTarget] = useState<"workspace" | "requests" | "listings">("workspace");
  const [rideOwnerReturnTab, setRideOwnerReturnTab] = useState<TabKey | null>(null);
  const [visiblePosts, setVisiblePosts] = useState<HousingPost[]>([]);
  const [selectedNeed, setSelectedNeed] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedGender, setSelectedGender] = useState("");
  const [selectedBudget, setSelectedBudget] = useState("");
  const [selectedSort, setSelectedSort] = useState<"distanceAsc" | "distanceDesc" | "rentAsc" | "rentDesc">("distanceAsc");
  const [city, setCity] = useState("Denver, CO");
  const [area, setArea] = useState("");
  const [housingSearchCoordinates, setHousingSearchCoordinates] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchCity, setSearchCity] = useState("Denver, CO");
  const [searchArea, setSearchArea] = useState("");
  const [searchRadius, setSearchRadius] = useState("10");
  const [searchNeed, setSearchNeed] = useState("need_place");
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [searchSuggestionsLoading, setSearchSuggestionsLoading] = useState(false);
  const [searchSuggestionMetro, setSearchSuggestionMetro] = useState("");
  const [cars, setCars] = useState<Car[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceKey>("cars");
  const [listingOpen, setListingOpen] = useState(false);
  const [listingForm, setListingForm] = useState<MobileHousingPostInput>(emptyListingForm);
  const [listingAddressSuggestions, setListingAddressSuggestions] = useState<RidePlaceSuggestion[]>([]);
  const [listingAddressLoading, setListingAddressLoading] = useState(false);
  const [listingAddressValidated, setListingAddressValidated] = useState(false);
  const [listingValidatedLabel, setListingValidatedLabel] = useState("");
  const [bottomTabsHidden, setBottomTabsHidden] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<{ title: string; body: string; action: string } | null>(null);
  const [housingWelcomeFocusKey, setHousingWelcomeFocusKey] = useState(0);
  const [launchVisible, setLaunchVisible] = useState(true);
  const launchStartedAt = useRef(Date.now());
  const launchOpacity = useRef(new Animated.Value(1)).current;
  const launchScale = useRef(new Animated.Value(0.94)).current;
  const launchCarOpacity = useRef(new Animated.Value(0)).current;
  const launchCarScale = useRef(new Animated.Value(0.56)).current;
  const launchCarOffset = useRef(new Animated.Value(24)).current;
  const launchPromiseOpacity = useRef(new Animated.Value(0)).current;
  const launchPromiseOffset = useRef(new Animated.Value(10)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const pushTokenRef = useRef("");
  async function enableMobileNotifications(requestPermission = true) {
    if (Platform.OS === "web" || !Device.isDevice) {
      return false;
    }
    try {
      if (Platform.OS === "android") {
        await Promise.all([
          Notifications.setNotificationChannelAsync("fchat", {
            name: "FChat messages",
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 150, 250],
            lightColor: "#4f7cff"
          }),
          Notifications.setNotificationChannelAsync("carpool", {
            name: "Carpool activity",
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 150, 250],
            lightColor: "#22c55e"
          }),
          Notifications.setNotificationChannelAsync("rentals", {
            name: "Rental bookings",
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 150, 250],
            lightColor: "#f59e0b"
          })
        ]);
      }
      let permission = await Notifications.getPermissionsAsync();
      if (permission.status !== "granted" && requestPermission) permission = await Notifications.requestPermissionsAsync();
      if (permission.status !== "granted") {
        return false;
      }
      const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
      if (!projectId) throw new Error("Expo project ID is unavailable.");
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      if (!token.data) throw new Error("A push token could not be created.");
      await registerMobilePushToken(token.data, Platform.OS, Device.modelName || Device.deviceName || "Mobile device", true);
      pushTokenRef.current = token.data;
      return true;
    } catch {
      return false;
    }
  }

  async function unregisterNotificationsForLogout() {
    if (!pushTokenRef.current || !data?.user) return;
    try {
      await registerMobilePushToken(pushTokenRef.current, Platform.OS, Device.modelName || Device.deviceName || "Mobile device", false);
    } catch {
      // Logout must still succeed if the device is temporarily offline.
    }
    pushTokenRef.current = "";
  }

  async function load() {
    setLoading(true);
    try {
      const payload = await getBootstrap(city);
      setData(payload);
      setVisiblePosts(payload.housing);
      const [carResult, serviceResult] = await Promise.allSettled([getCars(), getSiteServices()]);
      setCars(carResult.status === "fulfilled" ? carResult.value : []);
      setServices(serviceResult.status === "fulfilled" ? serviceResult.value : []);
    } catch (error) {
      Alert.alert("FairFares", error instanceof Error ? error.message : "Unable to load FairFares.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (data?.user) void enableMobileNotifications(true);
  }, [data?.user?.id]);

  useEffect(() => {
    const userId = data?.user?.id;
    if (!userId) return;
    let cancelled = false;
    const refreshUnread = async () => {
      try {
        const conversations = await getChatConversations();
        if (cancelled) return;
        const unreadCount = conversations.reduce((total, conversation) => total + Math.max(0, Number(conversation.unread) || 0), 0);
        setData((current) => current?.user?.id === userId ? {
          ...current,
          chat: { unreadCount, conversations: conversations.slice(0, 10) },
          dashboard: { ...current.dashboard, messages: unreadCount }
        } : current);
      } catch {
        // Keep the last confirmed count during short network interruptions.
      }
    };
    void refreshUnread();
    const interval = setInterval(() => void refreshUnread(), 12_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [data?.user?.id]);

  useEffect(() => {
    const navigateFromNotification = (response: Notifications.NotificationResponse | null) => {
      const type = String(response?.notification.request.content.data?.type || "");
      if (type === "FCHAT_MESSAGE") {
        setPendingPost(null);
        setPendingRide(null);
        setActiveTab("messenger");
      } else if (type === "CARPOOL_REQUEST" || type === "CARPOOL_STATUS") {
        setPendingPost(null);
        setPendingRide(null);
        setRideOwnerOpenToken(0);
        setRideOwnerReturnTab(null);
        setActiveTab("activity");
      } else if (type === "RENTAL_BOOKING") {
        setPendingPost(null);
        setPendingRide(null);
        setSelectedService("cars");
        setActiveTab("services");
      }
    };
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(navigateFromNotification);
    void Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        navigateFromNotification(response);
        if (response) await Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => undefined);
    return () => responseSubscription.remove();
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(launchCarOpacity, {
        toValue: 1,
        duration: 300,
        delay: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true
      }),
      Animated.spring(launchCarScale, {
        toValue: 1,
        delay: 120,
        friction: 7,
        tension: 52,
        useNativeDriver: true
      }),
      Animated.timing(launchCarOffset, {
        toValue: 0,
        duration: 760,
        delay: 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }),
      Animated.timing(launchPromiseOpacity, {
        toValue: 1,
        duration: 520,
        delay: 720,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }),
      Animated.timing(launchPromiseOffset, {
        toValue: 0,
        duration: 520,
        delay: 720,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      })
    ]).start();
  }, [launchCarOffset, launchCarOpacity, launchCarScale, launchPromiseOffset, launchPromiseOpacity]);

  useEffect(() => {
    if (loading || !launchVisible) return;
    const minimumLaunchTime = 1650;
    const delay = Math.max(0, minimumLaunchTime - (Date.now() - launchStartedAt.current));
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        }),
        Animated.timing(launchOpacity, {
          toValue: 0,
          duration: 460,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true
        }),
        Animated.timing(launchScale, {
          toValue: 1.04,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        })
      ]).start(() => setLaunchVisible(false));
    }, delay);
    return () => clearTimeout(timer);
  }, [contentOpacity, launchOpacity, launchScale, launchVisible, loading]);

  useEffect(() => {
    setBottomTabsHidden(false);
  }, [activeTab]);

  useEffect(() => {
    function handleAppUrl(url: string | null) {
      if (!url) return;
      try {
        const parsed = new URL(url);
        const groupInvite = parsed.searchParams.get("group_invite") || "";
        if (groupInvite) {
          setPendingPost(null);
          setPendingRide(null);
          setPendingGroupInvite(groupInvite);
          setActiveTab("messenger");
          return;
        }
      } catch {
        // Ignore malformed external URLs.
      }
      if (url.includes("payment/success")) {
        setPaymentUrl("");
        setPaymentStatus({
          title: "Payment completed",
          body: "Stripe confirmed your payment. Your FairFares booking is being refreshed now.",
          action: "View booking"
        });
        void load();
      }
      if (url.includes("payment/cancel")) {
        setPaymentUrl("");
        setPaymentStatus({
          title: "Payment not completed",
          body: "Stripe checkout was cancelled. Your payment window remains active until the timer expires.",
          action: "Return to checkout"
        });
      }
    }
    Linking.getInitialURL().then(handleAppUrl).catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => handleAppUrl(event.url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const cleanCity = normalizeCityInput(searchCity);
    setSearchSuggestionsLoading(true);
    const timer = setTimeout(() => {
      getAccommodationLocationOptions(cleanCity, searchArea)
        .then((options) => {
          const suggested = (options?.suggested || []).filter(Boolean).slice(0, 8);
          setSearchSuggestions(suggested);
          setSearchSuggestionMetro(options?.metro || "");
        })
        .catch(() => {
          setSearchSuggestions([]);
          setSearchSuggestionMetro("");
        })
        .finally(() => setSearchSuggestionsLoading(false));
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [searchOpen, searchCity, searchArea]);

  function openMessage(post: HousingPost) {
    setPendingPost(post);
    setPendingRide(null);
    setActiveTab("messenger");
    if (!data?.user) {
      setLoginOpen(true);
    }
  }

  function openRideMessage(ride: RidePost) {
    setPendingRide(ride);
    setPendingPost(null);
    setActiveTab("messenger");
    if (!data?.user) {
      setLoginOpen(true);
    }
  }

  async function openRentalCheckout(paymentOption: "hold" | "full", bookingId = "") {
    try {
      const webOrigin = Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "";
      const returnUrls = {
        successUrl: webOrigin ? `${webOrigin}/payment/success` : "fairfares://payment/success",
        cancelUrl: webOrigin ? `${webOrigin}/payment/cancel` : "fairfares://payment/cancel"
      };
      const payload = await startRentalCheckout(paymentOption, bookingId, returnUrls);
      if (payload.url) {
        setPaymentUrl(payload.url);
        setPaymentMessage("Opening secure Stripe checkout. If it does not open automatically, tap Open payment.");
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.location.href = payload.url;
          return true;
        }
        const canOpen = await Linking.canOpenURL(payload.url).catch(() => true);
        if (canOpen) {
          await Linking.openURL(payload.url);
        } else {
          setPaymentMessage("Stripe checkout is ready, but the device did not open it automatically. Tap Open payment to continue.");
          return false;
        }
        return true;
      }
      Alert.alert("Payment unavailable", "Stripe did not return a checkout link.");
      return false;
    } catch (error) {
      Alert.alert("Payment unavailable", error instanceof Error ? error.message : "Unable to open Stripe checkout.");
      return false;
    }
  }

  async function bookCar(car: Car, details?: Partial<RentalSearchInput>, paymentOption?: "hold" | "full") {
    if (!data?.user) {
      setActiveTab("profile");
      setLoginOpen(true);
      return;
    }
    try {
      const payload = await bookRentalCar(Number(car.id), details);
      if (paymentOption) {
        await openRentalCheckout(paymentOption, String(payload.booking.id || ""));
        return;
      } else {
        Alert.alert(
          "Rental checkout started",
          `${payload.booking.carName || car.name}\nHold due: $${payload.booking.holdAmount}\nPickup: ${payload.booking.pickupLocation}`,
          [
            { text: "Pay 10%", onPress: () => openRentalCheckout("hold", String(payload.booking.id || "")) },
            { text: "Pay full", onPress: () => openRentalCheckout("full", String(payload.booking.id || "")) },
            { text: "Later", style: "cancel" }
          ]
        );
      }
      const [payloadData, carRows] = await Promise.all([getBootstrap(city), getCars()]);
      setData(payloadData);
      setCars(carRows);
    } catch (error) {
      Alert.alert("Rental booking failed", error instanceof Error ? error.message : "Unable to start this booking.");
    }
  }

  async function selectNeed(need: string) {
    if (need === "ride_need" || need === "ride_offer") {
      setActiveTab("housing");
      return;
    }
    setSelectedNeed(need);
    setLoading(true);
    try {
      setVisiblePosts(await getHousing(city, area, need, selectedCategory, selectedGender, selectedBudget, searchRadius, housingSearchCoordinates));
    } catch (error) {
      Alert.alert("Housing search", error instanceof Error ? error.message : "Unable to update listings.");
    } finally {
      setLoading(false);
    }
  }

  async function selectArea(nextArea: string) {
    const lookup = await lookupAccommodationLocation(nextArea || city);
    const resolvedArea = nextArea ? lookup?.selectedLocation || nextArea : "";
    const resolvedCity = lookup && !nextArea ? normalizeCityInput(lookup.selectedLocation || city) : city;
    const nextCoordinates = { lat: lookup?.lat ?? null, lng: lookup?.lng ?? null };
    setArea(resolvedArea);
    setCity(resolvedCity);
    setHousingSearchCoordinates(nextCoordinates);
    setLoading(true);
    try {
      const posts = await getHousing(resolvedCity, resolvedArea, selectedNeed, selectedCategory, selectedGender, selectedBudget, searchRadius, nextCoordinates);
      setVisiblePosts(posts);
      setData((current) =>
        current
          ? {
              ...current,
              location: {
                ...current.location,
                city: resolvedCity,
                selected: resolvedArea ? `${resolvedCity} · ${resolvedArea}` : resolvedCity,
                suggested: lookup?.suggestedLocation || current.location.suggested
              },
              housing: posts
            }
          : current
      );
      Alert.alert("Location updated", `Showing listings around ${resolvedArea || resolvedCity}.`);
    } catch (error) {
      Alert.alert("Location search", error instanceof Error ? error.message : "Unable to search this area.");
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(nextCity = searchCity, nextArea = searchArea, nextRadius = searchRadius, nextNeed = searchNeed) {
    const cleanCity = normalizeCityInput(nextCity);
    const cleanArea = nextArea.trim();
    const cleanRadius = String(Math.max(1, Math.min(Number(nextRadius || 10) || 10, 100)));
    const lookup = await lookupAccommodationLocation(cleanArea || cleanCity);
    // Keep the place the user typed or selected. A broad geocoder fallback (for
    // example, Dayton) must not replace a specific query such as Wilmington Pike.
    const resolvedArea = cleanArea;
    const resolvedCity = cleanArea ? cleanCity : normalizeCityInput(lookup?.selectedLocation || cleanCity);
    const nextCoordinates = { lat: lookup?.lat ?? null, lng: lookup?.lng ?? null };
    setCity(resolvedCity);
    setArea(resolvedArea);
    setSearchRadius(cleanRadius);
    setSelectedNeed(nextNeed);
    setHousingSearchCoordinates(nextCoordinates);
    setSearchOpen(false);
    setLoading(true);
    try {
      const posts = await getHousing(resolvedCity, resolvedArea, nextNeed, selectedCategory, selectedGender, selectedBudget, cleanRadius, nextCoordinates);
      setVisiblePosts(posts);
      setActiveTab("housing");
      setHousingWelcomeFocusKey((value) => value + 1);
      setData((current) =>
        current
          ? {
              ...current,
              location: {
                ...current.location,
                city: resolvedCity,
                selected: resolvedArea ? `${resolvedCity} · ${resolvedArea}` : resolvedCity,
                suggested: lookup?.suggestedLocation || current.location.suggested
              },
              housing: posts
            }
          : current
      );
    } catch (error) {
      Alert.alert("Search failed", error instanceof Error ? error.message : "Unable to search this location.");
    } finally {
      setLoading(false);
    }
  }

  function openListingFormForUser(user: BootstrapPayload["user"], intent = selectedNeed) {
    const nextMode: MobileHousingPostInput["postMode"] =
      intent === "need_place" || intent === "need_roommates" ? "NEED_PLACE" : "HAVE_PLACE";
    setListingForm({
      ...emptyListingForm,
      postMode: nextMode,
      roommateIntent: intent === "need_roommates",
      city,
      contactName: user?.name || "",
      contactEmail: user?.email || "",
      contactPhone: user?.phone || ""
    });
    setListingAddressSuggestions([]);
    setListingAddressValidated(false);
    setListingValidatedLabel("");
    setListingOpen(true);
  }

  function postNeed(intent = selectedNeed || "need_place") {
    setSelectedNeed(intent);
    if (!data?.user) {
      setPendingListingAfterLogin(true);
      setLoginOpen(true);
      return;
    }
    openListingFormForUser(data.user, intent);
  }

  function updateListingForm<K extends keyof MobileHousingPostInput>(key: K, value: MobileHousingPostInput[K]) {
    setListingForm((current) => ({ ...current, [key]: value }));
    if (key === "postMode" && value !== listingForm.postMode) {
      setListingAddressSuggestions([]);
      setListingAddressValidated(false);
      setListingValidatedLabel("");
    }
  }

  function updateListingLocationField(key: "city" | "streetAddress" | "area", value: string) {
    setListingForm((current) => ({ ...current, [key]: value }));
    setListingAddressValidated(false);
    setListingValidatedLabel("");
  }

  function selectListingAddress(suggestion: RidePlaceSuggestion) {
    const parts = suggestion.label.split(",").map((part) => part.trim()).filter(Boolean);
    const stateZip = parts.at(-1)?.match(/^([A-Z]{2}|[A-Za-z]+(?:\s+[A-Za-z]+)*)(?:\s+(\d{5}(?:-\d{4})?))?$/);
    const stateLabel = stateZip?.[1].length === 2 ? stateZip[1].toUpperCase() : stateZip?.[1];
    const suggestedCity = stateZip && parts.length >= 3 ? `${parts.at(-2)}, ${stateLabel}` : listingForm.city;
    const streetParts = stateZip && parts.length >= 3 ? parts.slice(0, -2) : parts;
    const streetAddress = streetParts.join(", ") || suggestion.main || suggestion.label;
    const zipCode = stateZip?.[2] || suggestion.label.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] || listingForm.zipCode;
    setListingForm((current) => current.postMode === "HAVE_PLACE"
      ? { ...current, streetAddress, city: suggestedCity, zipCode }
      : { ...current, area: suggestion.label, city: suggestedCity, zipCode });
    setListingAddressSuggestions([]);
    setListingAddressValidated(true);
    setListingValidatedLabel(suggestion.label);
  }

  useEffect(() => {
    if (!listingOpen || listingAddressValidated) {
      setListingAddressSuggestions([]);
      setListingAddressLoading(false);
      return;
    }
    const query = (listingForm.postMode === "HAVE_PLACE" ? listingForm.streetAddress : listingForm.area).trim();
    if (query.length < 3) {
      setListingAddressSuggestions([]);
      setListingAddressLoading(false);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setListingAddressLoading(true);
      void getRidePlaceSuggestions(listingForm.city, query)
        .then((suggestions) => {
          if (active) setListingAddressSuggestions(suggestions.filter((item) => item.label).slice(0, 6));
        })
        .catch(() => {
          if (active) setListingAddressSuggestions([]);
        })
        .finally(() => {
          if (active) setListingAddressLoading(false);
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [listingOpen, listingForm.area, listingForm.city, listingForm.postMode, listingForm.streetAddress, listingAddressValidated]);

  async function submitListing() {
    if (!listingAddressValidated) {
      Alert.alert(
        listingForm.postMode === "HAVE_PLACE" ? "Validate the address" : "Validate the preferred location",
        listingForm.postMode === "HAVE_PLACE"
          ? "Enter the property address and select the correct suggested address before posting."
          : "Enter your preferred area, campus, building, or landmark and select the correct suggestion before posting."
      );
      return;
    }
    try {
      const payload = await createMobileHousingPost(listingForm);
      setListingOpen(false);
      const posts = await getHousing(city, area, selectedNeed, selectedCategory, selectedGender, selectedBudget, searchRadius, housingSearchCoordinates);
      setVisiblePosts(posts.some((post) => post.id === payload.post.id) ? posts : [payload.post, ...posts]);
      setData((current) =>
        current
          ? {
              ...current,
              housing: [payload.post, ...current.housing.filter((post) => post.id !== payload.post.id)],
              dashboard: { ...current.dashboard, housingPosts: current.dashboard.housingPosts + 1 }
            }
          : current
      );
      Alert.alert("Listing posted", "Your housing lead is live for 30 days.");
    } catch (error) {
      Alert.alert("Post failed", error instanceof Error ? error.message : "Unable to post this listing.");
    }
  }

  async function pickListingPhotos() {
    const currentImages = listingForm.images || [];
    const remaining = 4 - currentImages.length;
    if (remaining <= 0) {
      Alert.alert("Photo limit reached", "You can upload up to 4 photos for one post.");
      return;
    }
    try {
      const picked = await pickCompressedImages(remaining);
      if (picked.length) {
        setListingForm((current) => ({ ...current, images: [...(current.images || []), ...picked].slice(0, 4) }));
      }
    } catch (error) {
      Alert.alert("Photos not added", error instanceof Error ? error.message : "Could not add photos.");
    }
  }

  function removeListingPhoto(index: number) {
    setListingForm((current) => ({ ...current, images: (current.images || []).filter((_image, imageIndex) => imageIndex !== index) }));
  }

  async function selectCategory(category: string) {
    setSelectedCategory(category);
    setLoading(true);
    try {
      setVisiblePosts(await getHousing(city, area, selectedNeed, category, selectedGender, selectedBudget, searchRadius, housingSearchCoordinates));
    } catch (error) {
      Alert.alert("Room type", error instanceof Error ? error.message : "Unable to filter room type.");
    } finally {
      setLoading(false);
    }
  }

  async function selectGender(gender: string) {
    setSelectedGender(gender);
    setLoading(true);
    try {
      setVisiblePosts(await getHousing(city, area, selectedNeed, selectedCategory, gender, selectedBudget, searchRadius, housingSearchCoordinates));
    } catch (error) {
      Alert.alert("Gender preference", error instanceof Error ? error.message : "Unable to filter by preference.");
    } finally {
      setLoading(false);
    }
  }

  async function selectBudget(budget: string) {
    setSelectedBudget(budget);
    setLoading(true);
    try {
      setVisiblePosts(await getHousing(city, area, selectedNeed, selectedCategory, selectedGender, budget, searchRadius, housingSearchCoordinates));
    } catch (error) {
      Alert.alert("Budget", error instanceof Error ? error.message : "Unable to filter by budget.");
    } finally {
      setLoading(false);
    }
  }

  function topAction(action: string) {
    if (action === "Housing") {
      setActiveTab("housing");
      void selectNeed("");
    } else if (action === "Ride") {
      setActiveTab("housing");
    } else if (action === "Explorer" || action === "Deals") {
      setSelectedService(action === "Explorer" ? "explorer" : "deals");
      setActiveTab("services");
    }
  }

  function renderChoiceGroup<K extends keyof MobileHousingPostInput>(
    field: K,
    options: Array<[MobileHousingPostInput[K] & string, string]>
  ) {
    return (
      <View style={styles.choiceRow}>
        {options.map(([value, label]) => (
          <TouchableOpacity
            key={value}
            style={[styles.choicePill, listingForm[field] === value && styles.choicePillActive]}
            onPress={() => updateListingForm(field, value as MobileHousingPostInput[K])}
          >
            <Text style={[styles.choiceText, listingForm[field] === value && styles.choiceTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  function renderFormSection(title: string, children: React.ReactNode) {
    return (
      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>{title}</Text>
        {children}
      </View>
    );
  }

  function normalizeCityInput(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "Denver, CO";
    const known: Record<string, string> = {
      denver: "Denver, CO",
      aurora: "Aurora, CO",
      englewood: "Englewood, CO",
      littleton: "Littleton, CO",
      dayton: "Dayton, OH",
      chicago: "Chicago, IL",
      austin: "Austin, TX",
      dallas: "Dallas, TX"
    };
    return known[trimmed.toLowerCase()] || trimmed;
  }

  function searchSuggestionChips() {
    return searchSuggestions
      .map((value) => value.replace(/,\s*(USA|United States)$/i, "").trim())
      .filter((value) => value && value.length <= 48 && !/department|public works|network|stadium|urgent care|health center|convention center|airport|car rental|hertz|tavern|market|mural|city council|mayor|office|pavilion|city o' city|cuernavaca|comedy works|hilton|hotel|improper city/i.test(value))
      .slice(0, 6);
  }

  async function submitLogin() {
    if (authBusy) return;
    setAuthMessage("");
    if (!identifier.trim() || !password) {
      setAuthMessage("Enter your email/phone and password.");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("Signing in...");
    try {
      const payload = await mobileLogin(identifier, password);
      await syncChatIdentityRecovery(Number(payload.user?.id || 0), password).catch(() => undefined);
      setAuthMessage("Login successful.");
      setLoginOpen(false);
      setIdentifier("");
      setPassword("");
      await load();
      if (pendingListingAfterLogin) {
        setPendingListingAfterLogin(false);
        openListingFormForUser(payload.user, selectedNeed || "need_place");
      }
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Login failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitSignup() {
    if (authBusy) return;
    setAuthMessage("");
    setAuthBusy(true);
    setAuthMessage("Creating account...");
    try {
      const payload = await mobileSignup(signupName, identifier, signupPhone, password);
      if (!payload.activationRequired && payload.token && payload.user) {
        await syncChatIdentityRecovery(Number(payload.user.id || 0), password).catch(() => undefined);
      }
      setAuthMessage(payload.message || "Account created. Please activate your account from email before logging in.");
      setSignupName("");
      setSignupPhone("");
      setIdentifier("");
      setPassword("");
      if (!payload.activationRequired && payload.token) {
        setLoginOpen(false);
        await load();
        if (pendingListingAfterLogin) {
          setPendingListingAfterLogin(false);
          openListingFormForUser(payload.user || data?.user || null, selectedNeed || "need_place");
        }
      }
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Signup failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logoutProfile() {
    try {
      await unregisterNotificationsForLogout();
      await mobileLogout();
      setData((current) => (current ? { ...current, user: null, chat: { unreadCount: 0, conversations: [] } } : current));
      setPendingPost(null);
      setPendingRide(null);
      setActiveTab("home");
      await load();
    } catch (error) {
      Alert.alert("Logout failed", error instanceof Error ? error.message : "Could not log out.");
    }
  }

  function updateLocalUser(user: BootstrapPayload["user"]) {
    setData((current) => (current ? { ...current, user } : current));
  }

  function changeTab(tab: TabKey) {
    if (tab === "home" || tab === "housing") {
      setRideOwnerOpenToken(0);
      setRideOwnerReturnTab(null);
    }
    setActiveTab(tab);
  }

  const screen =
    activeTab === "messenger" ? (
      <MessengerScreen
        data={data}
        pendingPost={pendingPost}
        pendingRide={pendingRide}
        pendingGroupInvite={pendingGroupInvite}
        onRequireLogin={() => setLoginOpen(true)}
        onClearPendingPost={() => setPendingPost(null)}
        onClearPendingRide={() => setPendingRide(null)}
        onClearPendingGroupInvite={() => setPendingGroupInvite("")}
        onThreadModeChange={setBottomTabsHidden}
        onUnreadCountChange={(unreadCount) => setData((current) => current ? {
          ...current,
          chat: { ...current.chat, unreadCount },
          dashboard: { ...current.dashboard, messages: unreadCount }
        } : current)}
      />
    ) : activeTab === "activity" ? (
      <DashboardScreen
        data={data}
        onReserveRide={() => {
          setActiveTab("housing");
          setSelectedNeed("ride_need");
        }}
        onRideMessage={openRideMessage}
        onOpenHousing={() => {
          setRideOwnerOpenToken(0);
          setRideOwnerReturnTab(null);
          setSelectedNeed("need_place");
          setActiveTab("housing");
          setHousingWelcomeFocusKey((value) => value + 1);
        }}
        onOpenServices={() => {
          setSelectedService("cars");
          setActiveTab("services");
        }}
        onOpenRideOwner={(target = "workspace") => {
          setRideOwnerOpenTarget(target);
          setRideOwnerReturnTab("activity");
          setSelectedNeed("ride_offer");
          setActiveTab("housing");
          setRideOwnerOpenToken((value) => value + 1);
        }}
        onRequireLogin={() => setLoginOpen(true)}
      />
    ) : activeTab === "profile" ? (
      <ProfileScreen
        data={data}
        onLogin={() => setLoginOpen(true)}
        onLogout={logoutProfile}
        onProfileUpdated={updateLocalUser}
        onOpenHousing={() => {
          setRideOwnerOpenToken(0);
          setRideOwnerReturnTab(null);
          setSelectedNeed("need_place");
          setActiveTab("housing");
          setHousingWelcomeFocusKey((value) => value + 1);
        }}
        onOpenRide={() => {
          setRideOwnerOpenTarget("workspace");
          setRideOwnerReturnTab("profile");
          setSelectedNeed("ride_offer");
          setActiveTab("housing");
          setRideOwnerOpenToken((value) => value + 1);
        }}
        onOpenServices={() => {
          setSelectedService("cars");
          setActiveTab("services");
        }}
        onOpenMessenger={() => setActiveTab("messenger")}
        onOpenActivity={() => setActiveTab("activity")}
      />
    ) : activeTab === "services" ? (
      <ServicesScreen
        cars={cars}
        services={services}
        user={data?.user || null}
        selected={selectedService}
        onSelect={setSelectedService}
        onOpenHousing={() => {
          setRideOwnerOpenToken(0);
          setRideOwnerReturnTab(null);
          setSelectedNeed("need_place");
          setActiveTab("housing");
          setHousingWelcomeFocusKey((value) => value + 1);
        }}
        onOpenRide={() => {
          setSelectedNeed("ride_need");
          setActiveTab("housing");
        }}
        onOpenMessenger={() => setActiveTab("messenger")}
        onOpenActivity={() => setActiveTab("activity")}
        onOpenProfile={() => setActiveTab("profile")}
        onRequireLogin={() => setLoginOpen(true)}
        onBookCar={bookCar}
      />
    ) : activeTab === "housing" || activeTab === "home" ? (
      <HousingScreen
        data={data}
        posts={visiblePosts}
        cars={cars}
        selectedNeed={selectedNeed}
        selectedCategory={selectedCategory}
        selectedGender={selectedGender}
        selectedBudget={selectedBudget}
        selectedSort={selectedSort}
        onMessage={openMessage}
        onRideMessage={openRideMessage}
        onOpenMessenger={() => setActiveTab("messenger")}
        onNeedSelect={selectNeed}
        onAreaSelect={selectArea}
        onOpenSearch={() => {
          setSearchCity(city);
          setSearchArea(area);
          setSearchRadius(searchRadius);
          setSearchNeed(selectedNeed || "need_place");
          setSearchOpen(true);
        }}
        onCategorySelect={selectCategory}
        onGenderSelect={selectGender}
        onBudgetSelect={selectBudget}
        onSortSelect={setSelectedSort}
        onPostNeed={postNeed}
        onTopAction={topAction}
        onRequireLogin={() => setLoginOpen(true)}
        onBookCar={bookCar}
        onBottomTabsHiddenChange={setBottomTabsHidden}
        focusWelcomeKey={housingWelcomeFocusKey}
        rideOwnerOpenToken={rideOwnerOpenToken}
        rideOwnerOpenTarget={rideOwnerOpenTarget}
        onRideOwnerClosed={() => {
          if (rideOwnerReturnTab) setActiveTab(rideOwnerReturnTab);
          setRideOwnerOpenToken(0);
          setRideOwnerReturnTab(null);
        }}
      />
    ) : (
      <HousingScreen
        data={data}
        posts={visiblePosts}
        cars={cars}
        selectedNeed={selectedNeed}
        selectedCategory={selectedCategory}
        selectedGender={selectedGender}
        selectedBudget={selectedBudget}
        selectedSort={selectedSort}
        onMessage={openMessage}
        onRideMessage={openRideMessage}
        onOpenMessenger={() => setActiveTab("messenger")}
        onNeedSelect={selectNeed}
        onAreaSelect={selectArea}
        onOpenSearch={() => {
          setSearchCity(city);
          setSearchArea(area);
          setSearchRadius(searchRadius);
          setSearchNeed(selectedNeed || "need_place");
          setSearchOpen(true);
        }}
        onCategorySelect={selectCategory}
        onGenderSelect={selectGender}
        onBudgetSelect={selectBudget}
        onSortSelect={setSelectedSort}
        onPostNeed={postNeed}
        onTopAction={topAction}
        onRequireLogin={() => setLoginOpen(true)}
        onBookCar={bookCar}
        onBottomTabsHiddenChange={setBottomTabsHidden}
        focusWelcomeKey={housingWelcomeFocusKey}
        rideOwnerOpenToken={rideOwnerOpenToken}
        rideOwnerOpenTarget={rideOwnerOpenTarget}
        onRideOwnerClosed={() => {
          if (rideOwnerReturnTab) setActiveTab(rideOwnerReturnTab);
          setRideOwnerOpenToken(0);
          setRideOwnerReturnTab(null);
        }}
      />
    );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "right", "bottom", "left"]}>
      <StatusBar style="light" backgroundColor={theme.colors.bg} translucent={false} />
      <Animated.View style={[styles.appContent, { opacity: contentOpacity }]}>
        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator color={theme.colors.text} />
            <Text style={styles.loaderText}>Loading FairFares</Text>
          </View>
        ) : (
          screen
        )}
        <BottomTabs
          active={activeTab}
          unreadCount={data?.chat.unreadCount || 0}
          onChange={changeTab}
          hidden={bottomTabsHidden || (activeTab === "messenger" && Boolean(pendingPost || pendingRide))}
        />
      </Animated.View>
      {launchVisible ? (
        <Animated.View pointerEvents="none" style={[styles.launchOverlay, { opacity: launchOpacity }]}>
          <Image
            source={require("./assets/launch-cityscape-v2.png")}
            style={styles.launchBackdrop}
            resizeMode="cover"
          />
          <View style={styles.launchBackdropShade} />
          <Animated.View
            style={[
              styles.launchBrand,
              wideLaunchLayout ? styles.launchBrandWide : styles.launchBrandPortrait,
              { transform: [{ scale: launchScale }] }
            ]}
          >
            <View style={styles.launchLogoFrame}>
              <Image source={require("./assets/fairfares-logo.png")} style={styles.launchLogo} resizeMode="contain" />
            </View>
            <View style={styles.launchTaglineGroup}>
              <Animated.Text
                style={[
                  styles.launchPromise,
                  { opacity: launchPromiseOpacity, transform: [{ translateY: launchPromiseOffset }] }
                ]}
              >
                Your Personal Mobility Partner
              </Animated.Text>
              <Text style={styles.launchTagline}>Stay · Ride · Rent · Explore</Text>
            </View>
          </Animated.View>
          <View style={[styles.launchCarStage, wideLaunchLayout ? styles.launchCarStageWide : styles.launchCarStagePortrait]}>
            <View style={styles.launchCarGlow} />
            <Animated.Image
              source={require("./assets/launch-car-v2.png")}
              resizeMode="contain"
              style={[
                styles.launchCar,
                {
                  opacity: launchCarOpacity,
                  transform: [{ translateY: launchCarOffset }, { scale: launchCarScale }]
                }
              ]}
            />
          </View>
          <ActivityIndicator style={styles.launchSpinner} color={theme.colors.blue} size="small" />
        </Animated.View>
      ) : null}
      <Modal visible={loginOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setLoginOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{authMode === "login" ? "Login to FairFares" : "Create FairFares account"}</Text>
            <Text style={styles.modalCopy}>
              {authMode === "login"
                ? "Email/phone and password are required before messaging posters or joining groups."
                : "Signup needs name, email, phone, and password. You will activate the account from email before login."}
            </Text>
            {authMode === "signup" ? (
              <TextInput
                value={signupName}
                onChangeText={setSignupName}
                placeholder="Full name"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
              />
            ) : null}
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              placeholder={authMode === "login" ? "Email or phone" : "Email"}
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="none"
              style={styles.input}
            />
            {authMode === "signup" ? (
              <TextInput
                value={signupPhone}
                onChangeText={setSignupPhone}
                placeholder="Phone number"
                placeholderTextColor={theme.colors.muted}
                keyboardType="phone-pad"
                style={styles.input}
              />
            ) : null}
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={theme.colors.muted}
              secureTextEntry
              style={styles.input}
            />
            {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}
            <TouchableOpacity
              style={[styles.primaryButton, authBusy && styles.disabledButton]}
              onPress={authMode === "login" ? submitLogin : submitSignup}
              disabled={authBusy}
            >
              <Text style={styles.primaryButtonText}>
                {authBusy ? (authMode === "login" ? "Signing in..." : "Creating...") : authMode === "login" ? "Login" : "Sign up"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setAuthMessage("");
                setAuthMode(authMode === "login" ? "signup" : "login");
              }}
            >
              <Text style={styles.secondaryButtonText}>{authMode === "login" ? "Need an account? Sign up" : "Already have an account? Login"}</Text>
            </TouchableOpacity>
            {authMode === "login" ? (
              <TouchableOpacity style={styles.secondaryButton} onPress={() => void Linking.openURL("https://www.fairfare.space/forgot-password")}>
                <Text style={styles.secondaryButtonText}>Forgot password? Recover account</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setLoginOpen(false)}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={Boolean(paymentUrl)} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setPaymentUrl("")}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Secure payment</Text>
            <Text style={styles.modalCopy}>{paymentMessage || "Stripe checkout is ready."}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                if (paymentUrl) {
                  void Linking.openURL(paymentUrl);
                }
              }}
            >
              <Text style={styles.primaryButtonText}>Open payment</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setPaymentUrl("")}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={Boolean(paymentStatus)} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setPaymentStatus(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{paymentStatus?.title}</Text>
            <Text style={styles.modalCopy}>{paymentStatus?.body}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                setPaymentStatus(null);
                setActiveTab("activity");
              }}
            >
              <Text style={styles.primaryButtonText}>{paymentStatus?.action || "Continue"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setPaymentStatus(null)}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={listingOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setListingOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView style={[styles.modalCard, styles.listingModalCard]} contentContainerStyle={styles.listingForm} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>List room / property</Text>
            <Text style={styles.modalCopy}>This saves to the same FairFares housing database and expires in 30 days.</Text>
            {renderFormSection(
              "Your need",
              <>
                {renderChoiceGroup("postMode", listingModes)}
                {renderChoiceGroup("category", listingCategories)}
                <TouchableOpacity
                  style={[styles.choicePill, listingForm.roommateIntent && styles.choicePillActive]}
                  onPress={() => updateListingForm("roommateIntent", !listingForm.roommateIntent)}
                >
                  <Text style={[styles.choiceText, listingForm.roommateIntent && styles.choiceTextActive]}>Need roommates</Text>
                </TouchableOpacity>
              </>
            )}
            {renderFormSection(
              "Location",
              <>
                <TextInput value={listingForm.city} onChangeText={(text) => updateListingLocationField("city", text)} placeholder="City* eg Denver, CO" placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.zipCode} onChangeText={(text) => updateListingForm("zipCode", text)} placeholder="Zip code*" placeholderTextColor={theme.colors.muted} style={styles.input} keyboardType="number-pad" />
                {listingForm.postMode === "HAVE_PLACE" ? (
                  <>
                    <TextInput value={listingForm.streetAddress} onChangeText={(text) => updateListingLocationField("streetAddress", text)} placeholder="Start typing the property address*" placeholderTextColor={theme.colors.muted} style={[styles.input, listingAddressValidated && styles.validatedInput]} autoCorrect={false} />
                    {listingAddressLoading ? <View style={styles.addressStatusRow}><ActivityIndicator size="small" color={theme.colors.blue} /><Text style={styles.addressStatusText}>Checking address…</Text></View> : null}
                    {listingAddressSuggestions.length ? (
                      <View style={styles.addressSuggestionPanel}>
                        <Text style={styles.addressSuggestionTitle}>Select the correct address</Text>
                        {listingAddressSuggestions.map((suggestion) => (
                          <TouchableOpacity key={`${suggestion.label}-${suggestion.lat}-${suggestion.lng}`} style={styles.addressSuggestion} onPress={() => selectListingAddress(suggestion)}>
                            <Text style={styles.addressSuggestionPin}>⌖</Text>
                            <View style={styles.addressSuggestionCopy}>
                              <Text style={styles.addressSuggestionMain}>{suggestion.main}</Text>
                              <Text style={styles.addressSuggestionSecondary}>{suggestion.secondary}</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                    {listingAddressValidated ? <View style={styles.addressValidated}><Text style={styles.addressValidatedIcon}>✓</Text><Text style={styles.addressValidatedText}>Validated: {listingValidatedLabel}</Text></View> : null}
                    <TextInput value={listingForm.primaryNeighborhood} onChangeText={(text) => updateListingForm("primaryNeighborhood", text)} placeholder="Primary neighborhood" placeholderTextColor={theme.colors.muted} style={styles.input} />
                    <TextInput value={listingForm.apartmentName} onChangeText={(text) => updateListingForm("apartmentName", text)} placeholder="Apartment / building name" placeholderTextColor={theme.colors.muted} style={styles.input} />
                  </>
                ) : (
                  <>
                    <TextInput value={listingForm.area} onChangeText={(text) => updateListingLocationField("area", text)} placeholder="Start typing an area, campus, building, or landmark*" placeholderTextColor={theme.colors.muted} style={[styles.input, listingAddressValidated && styles.validatedInput]} autoCorrect={false} />
                    {listingAddressLoading ? <View style={styles.addressStatusRow}><ActivityIndicator size="small" color={theme.colors.blue} /><Text style={styles.addressStatusText}>Checking location…</Text></View> : null}
                    {listingAddressSuggestions.length ? (
                      <View style={styles.addressSuggestionPanel}>
                        <Text style={styles.addressSuggestionTitle}>Select the correct preferred location</Text>
                        {listingAddressSuggestions.map((suggestion) => (
                          <TouchableOpacity key={`${suggestion.label}-${suggestion.lat}-${suggestion.lng}`} style={styles.addressSuggestion} onPress={() => selectListingAddress(suggestion)}>
                            <Text style={styles.addressSuggestionPin}>⌖</Text>
                            <View style={styles.addressSuggestionCopy}>
                              <Text style={styles.addressSuggestionMain}>{suggestion.main}</Text>
                              <Text style={styles.addressSuggestionSecondary}>{suggestion.secondary}</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                    {listingAddressValidated ? <View style={styles.addressValidated}><Text style={styles.addressValidatedIcon}>✓</Text><Text style={styles.addressValidatedText}>Validated: {listingValidatedLabel}</Text></View> : null}
                    <TextInput value={listingForm.workSchoolLocation} onChangeText={(text) => updateListingForm("workSchoolLocation", text)} placeholder="Work / school / commute target" placeholderTextColor={theme.colors.muted} style={styles.input} />
                  </>
                )}
              </>
            )}
            {renderFormSection(
              listingForm.postMode === "HAVE_PLACE" ? "Room details" : "Room requirements",
              <>
                <TextInput value={listingForm.title} onChangeText={(text) => updateListingForm("title", text)} placeholder="Title*" placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.description} onChangeText={(text) => updateListingForm("description", text)} placeholder="Description*" placeholderTextColor={theme.colors.muted} style={[styles.input, styles.textArea]} multiline />
                <DateTimeField label={listingForm.postMode === "HAVE_PLACE" ? "Available from*" : "Move-in from*"} value={listingForm.moveInDate} mode="date" minimumDate={todayLocalIso()} onChange={(value) => updateListingForm("moveInDate", value)} />
                <View style={styles.twoCol}>
                  <TextInput value={listingForm.rentMin} onChangeText={(text) => updateListingForm("rentMin", text)} placeholder={listingForm.postMode === "HAVE_PLACE" ? "Rent*" : "Budget min*"} placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                  <TextInput value={listingForm.rentMax} onChangeText={(text) => updateListingForm("rentMax", text)} placeholder={listingForm.postMode === "HAVE_PLACE" ? "Rent max" : "Budget max"} placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                </View>
                {renderChoiceGroup("rentPeriod", rentPeriods)}
                <View style={styles.twoCol}>
                  <TextInput value={listingForm.accommodates} onChangeText={(text) => updateListingForm("accommodates", text)} placeholder="Accommodates*" placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                  <TextInput value={listingForm.roommateCount} onChangeText={(text) => updateListingForm("roommateCount", text)} placeholder="Roommates" placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                </View>
                {renderChoiceGroup("bathroomType", bathroomOptions)}
                {renderChoiceGroup("genderPreference", genderOptions)}
                {renderChoiceGroup("leaseTerm", leaseOptions)}
                <TextInput value={listingForm.commutePreference} onChangeText={(text) => updateListingForm("commutePreference", text)} placeholder="Commute preference / transit notes" placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.daysAvailable} onChangeText={(text) => updateListingForm("daysAvailable", text)} placeholder="Days available, eg 7 days / weekdays" placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.deposit} onChangeText={(text) => updateListingForm("deposit", text)} placeholder="Deposit optional" placeholderTextColor={theme.colors.muted} style={styles.input} keyboardType="number-pad" />
              </>
            )}
            {renderFormSection(
              "Photos",
              <>
                <Text style={styles.photoHelp}>
                  {listingForm.postMode === "HAVE_PLACE"
                    ? "Add up to 4 clear room/property photos. FairFares compresses them before upload."
                    : listingForm.roommateIntent
                      ? "Add up to 4 photos that help explain your roommate search or profile. FairFares compresses them before upload."
                      : "Add up to 4 helpful photos for your accommodation post. FairFares compresses them before upload."}
                </Text>
                <View style={styles.photoGrid}>
                  {(listingForm.images || []).map((image, index) => (
                    <View key={`${index}-${image.slice(0, 20)}`} style={styles.photoPreviewWrap}>
                      <Image source={{ uri: image }} style={styles.photoPreview} />
                      <TouchableOpacity style={styles.photoRemove} onPress={() => removeListingPhoto(index)}>
                        <Text style={styles.photoRemoveText}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  {(listingForm.images || []).length < 4 ? (
                    <TouchableOpacity style={styles.photoAdd} onPress={pickListingPhotos}>
                      <Text style={styles.photoAddIcon}>＋</Text>
                      <Text style={styles.photoAddText}>{(listingForm.images || []).length ? "Add more" : "Add photos"}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={styles.photoCount}>{(listingForm.images || []).length}/4 photos selected</Text>
              </>
            )}
            {renderFormSection(
              "Preferences and amenities",
              <>
                <View style={styles.choiceRow}>
                  {amenityToggles.map(([field, label]) => (
                    <TouchableOpacity
                      key={field}
                      style={[styles.choicePill, listingForm[field] && styles.choicePillActive]}
                      onPress={() => updateListingForm(field, !listingForm[field] as MobileHousingPostInput[typeof field])}
                    >
                      <Text style={[styles.choiceText, listingForm[field] && styles.choiceTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput value={listingForm.amenities} onChangeText={(text) => updateListingForm("amenities", text)} placeholder="Amenities, eg WiFi, gym, laundry, parking" placeholderTextColor={theme.colors.muted} style={styles.input} />
                {lifestyleOptions.map(([field, label, options]) => (
                  <View key={field} style={styles.miniGroup}>
                    <Text style={styles.miniLabel}>{label}</Text>
                    <View style={styles.choiceRow}>
                      {options.map((option) => (
                        <TouchableOpacity key={option} style={[styles.choicePill, listingForm[field] === option && styles.choicePillActive]} onPress={() => updateListingForm(field, option as MobileHousingPostInput[typeof field])}>
                          <Text style={[styles.choiceText, listingForm[field] === option && styles.choiceTextActive]}>{option}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
                <TextInput value={listingForm.aboutYou} onChangeText={(text) => updateListingForm("aboutYou", text)} placeholder="About you / ideal roommate" placeholderTextColor={theme.colors.muted} style={[styles.input, styles.textAreaSmall]} multiline />
              </>
            )}
            {renderFormSection(
              "Contact and socials",
              <>
                <TextInput value={listingForm.contactName} onChangeText={(text) => updateListingForm("contactName", text)} placeholder="Contact name*" placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.contactEmail} onChangeText={(text) => updateListingForm("contactEmail", text)} placeholder="Contact email*" placeholderTextColor={theme.colors.muted} style={styles.input} autoCapitalize="none" />
                <TextInput value={listingForm.contactPhone} onChangeText={(text) => updateListingForm("contactPhone", text)} placeholder="Contact phone*" placeholderTextColor={theme.colors.muted} style={styles.input} keyboardType="phone-pad" />
                <TextInput value={listingForm.socialFacebook} onChangeText={(text) => updateListingForm("socialFacebook", text)} placeholder="Facebook URL optional" placeholderTextColor={theme.colors.muted} style={styles.input} autoCapitalize="none" />
                <TextInput value={listingForm.socialInstagram} onChangeText={(text) => updateListingForm("socialInstagram", text)} placeholder="Instagram URL optional" placeholderTextColor={theme.colors.muted} style={styles.input} autoCapitalize="none" />
              </>
            )}
            <TouchableOpacity style={styles.primaryButton} onPress={submitListing}>
              <Text style={styles.primaryButtonText}>Post listing</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setListingOpen(false)}>
              <Text style={styles.switchText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={searchOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setSearchOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalCard, styles.searchModalCard]}>
            <ScrollView style={styles.searchModalScroll} contentContainerStyle={styles.searchModalContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Search housing</Text>
              <Text style={styles.modalCopy}>Enter a metro city, then narrow results by neighborhood, building, campus, or nearby landmark.</Text>
              <View style={styles.miniGroup}>
                <Text style={styles.miniLabel}>What are you looking for?</Text>
                <View style={styles.chipRow}>
                  {[
                    ["need_place", "I need a place"],
                    ["need_roommates", "I need roommates"],
                    ["have_place", "I have a place, need people"]
                  ].map(([value, label]) => (
                    <TouchableOpacity key={value} style={[styles.chip, searchNeed === value && styles.chipActive]} onPress={() => setSearchNeed(value)}>
                      <Text style={[styles.chipText, searchNeed === value && styles.chipTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <TextInput
                value={searchCity}
                onChangeText={setSearchCity}
                placeholder="City, e.g. Denver, CO"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
              />
              <TextInput
                value={searchArea}
                onChangeText={setSearchArea}
                placeholder="Area, building, campus, landmark"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
              />
              <View style={styles.suggestionPanel}>
                <Text style={styles.suggestionTitle}>
                  {searchSuggestionsLoading
                    ? "Loading nearby areas..."
                    : searchSuggestions.length
                      ? `Nearby areas for ${searchSuggestionMetro || normalizeCityInput(searchCity)}`
                      : "Nearby area suggestions"}
                </Text>
                <ScrollView style={styles.suggestionList} contentContainerStyle={styles.suggestionListContent} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {searchSuggestionChips().map((chip) => (
                    <TouchableOpacity key={chip} style={styles.chip} onPress={() => setSearchArea(chip)}>
                      <Text style={styles.chipText}>{chip}</Text>
                    </TouchableOpacity>
                  ))}
                  {!searchSuggestions.length && !searchCity.toLowerCase().includes("denver") ? (
                    <Text style={styles.suggestionHint}>
                      {searchSuggestionsLoading ? "Loading nearby areas..." : "No nearby suggestions loaded yet. Check Google Places keys or type a known city/area."}
                    </Text>
                  ) : null}
                </ScrollView>
              </View>
              <View style={styles.miniGroup}>
                <Text style={styles.miniLabel}>Radius when searching near a place</Text>
                <View style={styles.chipRow}>
                  {["5", "10", "20", "60"].map((chip) => (
                    <TouchableOpacity key={chip} style={[styles.chip, searchRadius === chip && styles.chipActive]} onPress={() => setSearchRadius(chip)}>
                      <Text style={[styles.chipText, searchRadius === chip && styles.chipTextActive]}>{chip} mi</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.searchModalActions}>
                <TouchableOpacity style={styles.primaryButton} onPress={() => runSearch()}>
                  <Text style={styles.primaryButtonText}>Search listings</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setSearchOpen(false)}>
                  <Text style={styles.secondaryButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  appContent: { flex: 1 },
  launchOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg, overflow: "hidden" },
  launchBackdrop: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%", opacity: 0.82 },
  launchBackdropShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(1,8,23,0.18)" },
  launchBrand: { position: "absolute", width: "100%", maxWidth: 360, paddingHorizontal: 12, alignItems: "center", gap: 12, zIndex: 1 },
  launchBrandPortrait: { top: "25%" },
  launchBrandWide: { top: "6%" },
  launchLogoFrame: { width: "100%", height: 116, alignItems: "center", justifyContent: "center" },
  launchLogo: { width: "88%", height: "100%" },
  launchCarStage: { position: "absolute", width: "86%", maxWidth: 410, height: 190, alignItems: "center", justifyContent: "center", zIndex: 2 },
  launchCarStagePortrait: { top: "47%" },
  launchCarStageWide: { top: "70%" },
  launchCarGlow: { position: "absolute", width: "64%", height: 58, bottom: 14, borderRadius: 999, backgroundColor: "rgba(0,128,255,0.16)", shadowColor: "#008cff", shadowOpacity: 0.72, shadowRadius: 28, shadowOffset: { width: 0, height: 0 } },
  launchCar: { width: "100%", height: "100%" },
  launchSpinner: { position: "absolute", bottom: "4%", zIndex: 3 },
  launchTaglineGroup: { alignItems: "center", gap: 7 },
  launchTagline: { color: theme.colors.soft, fontSize: 15, fontWeight: "900", letterSpacing: 0.7 },
  launchPromise: { color: theme.colors.text, fontSize: 16, fontWeight: "900", letterSpacing: 0.35 },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.md },
  loaderText: { color: theme.colors.text, fontWeight: "900" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "flex-start", paddingTop: Platform.OS === "ios" ? 86 : 42, paddingHorizontal: 8 },
  modalCard: { maxHeight: "88%", backgroundColor: theme.colors.panel, borderRadius: 26, padding: 18, gap: 14, borderWidth: 1, borderColor: theme.colors.line, opacity: 1 },
  searchModalCard: { height: "90%", maxHeight: "90%", paddingBottom: theme.spacing.md },
  searchModalScroll: { flex: 1 },
  searchModalContent: { gap: 14, paddingBottom: 20 },
  searchModalActions: { gap: theme.spacing.xs, paddingTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.line },
  listingModalCard: { maxHeight: "94%" },
  listingForm: { width: "100%", maxWidth: "100%", alignSelf: "stretch", gap: theme.spacing.md, paddingBottom: theme.spacing.lg },
  modalTitle: { color: theme.colors.text, fontSize: 20, lineHeight: 25, fontWeight: "700" },
  modalCopy: { color: theme.colors.muted, fontSize: 15, lineHeight: 21 },
  input: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.md, paddingHorizontal: 14, minHeight: 49, fontSize: 15 },
  validatedInput: { borderWidth: 1, borderColor: "#22c55e" },
  addressStatusRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  addressStatusText: { color: theme.colors.muted, fontSize: 12, fontWeight: "700" },
  addressSuggestionPanel: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.md, overflow: "hidden", backgroundColor: theme.colors.panel2 },
  addressSuggestionTitle: { color: theme.colors.soft, fontSize: 12, fontWeight: "800", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  addressSuggestion: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.colors.line },
  addressSuggestionPin: { color: theme.colors.blue, fontSize: 20 },
  addressSuggestionCopy: { flex: 1, gap: 2 },
  addressSuggestionMain: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
  addressSuggestionSecondary: { color: theme.colors.muted, fontSize: 12, lineHeight: 16 },
  addressValidated: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: theme.radius.md, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: "rgba(34,197,94,0.12)", borderWidth: 1, borderColor: "rgba(34,197,94,0.5)" },
  addressValidatedIcon: { color: "#4ade80", fontSize: 15, fontWeight: "900" },
  addressValidatedText: { color: "#86efac", flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  textArea: { minHeight: 96, paddingTop: 13, textAlignVertical: "top" },
  textAreaSmall: { minHeight: 82, paddingTop: 14, textAlignVertical: "top" },
  formSection: { gap: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.lg, padding: theme.spacing.md, backgroundColor: theme.colors.bg },
  formSectionTitle: { color: theme.colors.text, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  photoHelp: { color: theme.colors.muted, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoPreviewWrap: { width: "47%", aspectRatio: 1.25, borderRadius: theme.radius.md, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel2 },
  photoPreview: { width: "100%", height: "100%" },
  photoRemove: { position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center" },
  photoRemoveText: { color: theme.colors.text, fontSize: 16, fontWeight: "900", marginTop: -2 },
  photoAdd: { width: "47%", aspectRatio: 1.25, borderRadius: theme.radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.blue, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: theme.colors.panel2 },
  photoAddIcon: { color: theme.colors.blue, fontSize: 23, fontWeight: "900" },
  photoAddText: { color: theme.colors.text, fontWeight: "900" },
  photoCount: { color: theme.colors.soft, fontWeight: "800", fontSize: 12 },
  miniGroup: { gap: 7 },
  miniLabel: { color: theme.colors.muted, fontWeight: "900" },
  twoCol: { width: "100%", maxWidth: "100%", flexDirection: "row", gap: theme.spacing.sm },
  twoColInput: { flex: 1, minWidth: 0 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choicePill: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 9, alignItems: "center" },
  choicePillActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  choiceText: { color: theme.colors.soft, fontWeight: "900" },
  choiceTextActive: { color: theme.colors.bg },
  primaryButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, alignItems: "center", paddingVertical: 13 },
  disabledButton: { opacity: 0.65 },
  primaryButtonText: { color: theme.colors.text, fontWeight: "900", fontSize: 15 },
  secondaryButton: { alignItems: "center", paddingVertical: 8 },
  secondaryButtonText: { color: theme.colors.muted, fontWeight: "900" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  chipText: { color: theme.colors.text, fontWeight: "800" },
  chipTextActive: { color: theme.colors.bg },
  authMessage: { color: theme.colors.soft, fontWeight: "900", lineHeight: 20 },
  suggestionPanel: { gap: 6 },
  suggestionList: { maxHeight: 96 },
  suggestionListContent: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 4 },
  suggestionTitle: { width: "100%", color: theme.colors.soft, fontWeight: "900", marginBottom: 2 },
  suggestionHint: { color: theme.colors.muted, fontWeight: "800", lineHeight: 20 },
  switchText: { color: theme.colors.muted, textAlign: "center", fontWeight: "900", paddingVertical: 8 }
});
