import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Google from "expo-auth-session/providers/google";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Easing, Image, InteractionManager, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { BottomTabs, TabKey } from "./src/components/BottomTabs";
import { DateTimeField, todayLocalIso } from "./src/components/DateTimeField";
import { absoluteAssetUrl, bookRentalCar, completeSocialPhone, createMobileHousingPost, getAccommodationLocationOptions, getBootstrap, getCars, getChatConversations, getHousing, getRidePlaceSuggestions, getSiteServices, hydrateAuthToken, isAuthenticationRejection, lookupAccommodationLocation, mobileLogin, mobileLogout, mobileSignup, mobileSocialLogin, MobileHousingPostInput, MobileSocialAuthPayload, registerMobilePushToken, RidePlaceSuggestion, setAuthToken, startRentalCheckout } from "./src/api/client";
import { appAssets } from "./src/assets";
import { syncChatIdentityRecovery } from "./src/utils/chatRecovery";
import type { ServiceKey } from "./src/screens/ServicesScreen";
import { theme } from "./src/theme";
import { BootstrapPayload, Car, HousingPost, RentalSearchInput, RidePost, ServiceItem } from "./src/types";
import { pickCompressedImages } from "./src/utils/imageUpload";
import { NearbyRelayProvider } from "./src/providers/NearbyRelayProvider";
import { getOrCreateDeviceIdentity } from "./src/utils/chatCrypto";
import { AppErrorBoundary } from "./src/components/AppErrorBoundary";

declare const process: {
  env: {
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?: string;
    EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?: string;
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?: string;
  };
};

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "google-ios-client-not-configured";
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "google-android-client-not-configured";
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "google-web-client-not-configured";
const IS_EXPO_GO = Constants.appOwnership === "expo";
const GOOGLE_AUTH_CONFIGURED = Platform.select({
  ios: !GOOGLE_IOS_CLIENT_ID.includes("not-configured"),
  android: !GOOGLE_ANDROID_CLIENT_ID.includes("not-configured"),
  default: !GOOGLE_WEB_CLIENT_ID.includes("not-configured"),
}) ?? false;

const STATIC_IMAGE_SOURCES = [
  ...Object.entries(appAssets)
    .filter(([key]) => key !== "festivals" && key !== "cities")
    .map(([, source]) => source),
  ...Object.values(appAssets.cities),
  ...Object.values(appAssets.festivals),
  require("./assets/launch-cityscape-v2.jpg"),
  require("./assets/launch-car-mobile.png")
];

const DashboardScreen = React.lazy(() => import("./src/screens/DashboardScreen").then((module) => ({ default: module.DashboardScreen })));
const HousingScreen = React.lazy(() => import("./src/screens/HousingScreen").then((module) => ({ default: module.HousingScreen })));
const MessengerScreen = React.lazy(() => import("./src/screens/MessengerScreen").then((module) => ({ default: module.MessengerScreen })));
const ProfileScreen = React.lazy(() => import("./src/screens/ProfileScreen").then((module) => ({ default: module.ProfileScreen })));
const StaffPickupScreen = React.lazy(() => import("./src/screens/StaffPickupScreen").then((module) => ({ default: module.StaffPickupScreen })));
const ServicesScreen = React.lazy(() => import("./src/screens/ServicesScreen").then((module) => ({ default: module.ServicesScreen })));

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

const signupCallingCodes = [
  { label: "United States / Canada", flag: "🇺🇸", code: "+1" },
  { label: "India", flag: "🇮🇳", code: "+91" },
  { label: "United Kingdom", flag: "🇬🇧", code: "+44" },
  { label: "Australia", flag: "🇦🇺", code: "+61" },
  { label: "United Arab Emirates", flag: "🇦🇪", code: "+971" },
  { label: "Singapore", flag: "🇸🇬", code: "+65" }
] as const;

const PENDING_RENTAL_CHECKOUT_KEY = "fairfares.mobile.pendingRentalCheckout";
const RENTAL_CHECKOUT_WINDOW_MS = 10 * 60 * 1000;

type PendingRentalCheckout = {
  url: string;
  bookingId: string;
  paymentOption: "hold" | "full";
  expiresAt: number;
};

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
    <AppErrorBoundary>
      <SafeAreaProvider>
        <FairFaresApp />
      </SafeAreaProvider>
    </AppErrorBoundary>
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
  const [signupCallingCode, setSignupCallingCode] = useState("+1");
  const [signupCountryOpen, setSignupCountryOpen] = useState(false);
  const [signupPhoneDiscoverable, setSignupPhoneDiscoverable] = useState(true);
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [socialContinuation, setSocialContinuation] = useState("");
  const [socialRecoveryEmailHint, setSocialRecoveryEmailHint] = useState("");
  const [showSocialRecoveryEmail, setShowSocialRecoveryEmail] = useState(false);
  const [, googleResponse, promptGoogleSignIn] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
    scopes: ["openid", "profile", "email"],
    selectAccount: true
  });
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
  const [searchCitySuggestions, setSearchCitySuggestions] = useState<string[]>([]);
  const selectedCitySuggestionRef = useRef("");
  const [searchSuggestionsLoading, setSearchSuggestionsLoading] = useState(false);
  const [searchSuggestionMetro, setSearchSuggestionMetro] = useState("");
  const [chitthiSuggestionCity, setChitthiSuggestionCity] = useState("");
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
  const [staffPickupOpen, setStaffPickupOpen] = useState(false);
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
          Notifications.setNotificationChannelAsync("chitthi-messages-v2", {
            name: "Chitthi messages",
            importance: Notifications.AndroidImportance.HIGH,
            sound: "default",
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
          }),
          Notifications.setNotificationChannelAsync("marketing", {
            name: "FairFares ideas and deals",
            importance: Notifications.AndroidImportance.DEFAULT,
            vibrationPattern: [0, 180],
            lightColor: "#4f7cff"
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
      const userId = Number(data?.user?.id || 0);
      const deviceId = userId ? (await getOrCreateDeviceIdentity(userId)).deviceId : "";
      await registerMobilePushToken(token.data, Platform.OS, Device.modelName || Device.deviceName || "Mobile device", true, deviceId);
      pushTokenRef.current = token.data;
      return true;
    } catch {
      return false;
    }
  }

  async function unregisterNotificationsForLogout() {
    if (!pushTokenRef.current || !data?.user) return;
    try {
      const deviceId = (await getOrCreateDeviceIdentity(Number(data.user.id))).deviceId;
      await registerMobilePushToken(pushTokenRef.current, Platform.OS, Device.modelName || Device.deviceName || "Mobile device", false, deviceId);
    } catch {
      // Logout must still succeed if the device is temporarily offline.
    }
    pushTokenRef.current = "";
  }

  async function load(showLoader = true) {
    if (showLoader) setLoading(true);
    try {
      const payload = await getBootstrap(city);
      setData(payload);
      setVisiblePosts(payload.housing);
      const [carResult, serviceResult] = await Promise.allSettled([getCars(), getSiteServices()]);
      setCars(carResult.status === "fulfilled" ? carResult.value : []);
      setServices(serviceResult.status === "fulfilled" ? serviceResult.value : []);
    } catch (error) {
      if (isAuthenticationRejection(error)) {
        await setAuthToken("");
        setData((current) => current ? { ...current, user: null, chat: { unreadCount: 0, conversations: [] } } : current);
      }
      Alert.alert("FairFares", error instanceof Error ? error.message : "Unable to load FairFares.");
    } finally {
      if (showLoader) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function restoreSessionAndCheckout() {
      await hydrateAuthToken();
      if (cancelled) return;
      await load();
      if (Platform.OS === "web" || cancelled) return;
      const saved = await SecureStore.getItemAsync(PENDING_RENTAL_CHECKOUT_KEY).catch(() => null);
      if (!saved || cancelled) return;
      try {
        const pending = JSON.parse(saved) as PendingRentalCheckout;
        if (pending.url && Number(pending.expiresAt) > Date.now()) {
          setPaymentUrl(pending.url);
          setPaymentMessage("Your Stripe payment window is still active. Continue securely before the timer expires.");
        } else {
          await SecureStore.deleteItemAsync(PENDING_RENTAL_CHECKOUT_KEY);
        }
      } catch {
        await SecureStore.deleteItemAsync(PENDING_RENTAL_CHECKOUT_KEY);
      }
    }
    void restoreSessionAndCheckout();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" || typeof Image.resolveAssetSource !== "function") return;
    const task = InteractionManager.runAfterInteractions(() => {
      const metroAssetUris = STATIC_IMAGE_SOURCES
        .map((source) => Image.resolveAssetSource(source)?.uri || "")
        .filter((uri) => /^https?:\/\//i.test(uri));
      void Promise.allSettled([...new Set(metroAssetUris)].map((uri) => Image.prefetch(uri)));
    });
    return () => task.cancel();
  }, []);

  useEffect(() => {
    const firstVisibleImages = [
      ...(data?.housing || []).slice(0, 12).flatMap((post) => post.images?.length ? post.images.slice(0, 2) : post.imageUrl ? [post.imageUrl] : []),
      ...cars.slice(0, 12).map((car) => car.image_url)
    ]
      .map((value) => absoluteAssetUrl(String(value || "")))
      .filter((uri) => /^https?:\/\//i.test(uri));
    if (!firstVisibleImages.length) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void Promise.allSettled([...new Set(firstVisibleImages)].map((uri) => Image.prefetch(uri)));
    });
    return () => task.cancel();
  }, [data?.housing, cars]);

  useEffect(() => {
    if (data?.user) void enableMobileNotifications(true);
  }, [data?.user?.id]);

  useEffect(() => {
    if (googleResponse?.type !== "success") return;
    const response = googleResponse as typeof googleResponse & {
      authentication?: { idToken?: string } | null;
      params?: { id_token?: string };
    };
    const identityToken = response.authentication?.idToken || response.params?.id_token || "";
    if (!identityToken) {
      setAuthMessage("Google did not return a secure identity token. Please try again.");
      return;
    }
    void finishSocialProvider("google", identityToken);
  }, [googleResponse]);

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
      } else if (type === "FAIRFARES_PROMO") {
        const target = String(response?.notification.request.content.data?.target || "");
        setPendingPost(null);
        setPendingRide(null);
        if (target === "rentals") {
          setSelectedService("cars");
          setActiveTab("services");
        } else if (target === "carpool") {
          setActiveTab("activity");
        } else {
          setActiveTab("home");
          setHousingWelcomeFocusKey((current) => current + 1);
        }
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
        const invitePathMatch = parsed.pathname.match(/\/fchat\/invite\/([^/]+)/i);
        const groupCommunity = parsed.searchParams.get("community_id") || "";
        const groupInvite = parsed.searchParams.get("group_invite") || parsed.searchParams.get("token") || (invitePathMatch?.[1] ? decodeURIComponent(invitePathMatch[1]) : "") || (groupCommunity ? `community:${groupCommunity}` : "");
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
        void SecureStore.deleteItemAsync(PENDING_RENTAL_CHECKOUT_KEY);
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
          action: "Continue payment"
        });
      }
    }
    Linking.getInitialURL().then(handleAppUrl).catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => handleAppUrl(event.url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    let cancelled = false;
    const cleanCity = normalizeCityInput(searchCity);
    setSearchSuggestionsLoading(true);
    const timer = setTimeout(() => {
      getAccommodationLocationOptions(cleanCity, searchArea)
        .then((options) => {
          if (cancelled) return;
          const selectedCity = selectedCitySuggestionRef.current.trim().toLowerCase();
          setSearchCitySuggestions(
            selectedCity && selectedCity === cleanCity.trim().toLowerCase()
              ? []
              : (options?.cities || []).filter(Boolean).slice(0, 8)
          );
          const suggested = (options?.suggested || []).filter(Boolean).slice(0, 8);
          setSearchSuggestions(suggested);
          setSearchSuggestionMetro(options?.metro || "");
        })
        .catch(() => {
          if (cancelled) return;
          setSearchCitySuggestions([]);
          setSearchSuggestions([]);
          setSearchSuggestionMetro("");
        })
        .finally(() => { if (!cancelled) setSearchSuggestionsLoading(false); });
    }, 300);
    return () => {
      cancelled = true;
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
        if (Platform.OS !== "web") {
          const pending: PendingRentalCheckout = {
            url: payload.url,
            bookingId,
            paymentOption,
            expiresAt: Date.now() + RENTAL_CHECKOUT_WINDOW_MS
          };
          await SecureStore.setItemAsync(PENDING_RENTAL_CHECKOUT_KEY, JSON.stringify(pending));
        }
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

  async function resumePendingRentalCheckout() {
    const saved = await SecureStore.getItemAsync(PENDING_RENTAL_CHECKOUT_KEY).catch(() => null);
    if (!saved) {
      Alert.alert("Payment window unavailable", "This checkout window has expired. Start payment again from the rental car checkout.");
      return;
    }
    try {
      const pending = JSON.parse(saved) as PendingRentalCheckout;
      if (!pending.url || Number(pending.expiresAt) <= Date.now()) {
        await SecureStore.deleteItemAsync(PENDING_RENTAL_CHECKOUT_KEY);
        Alert.alert("Payment window expired", "Start payment again from the rental car checkout.");
        return;
      }
      setPaymentUrl(pending.url);
      setPaymentMessage("Your Stripe payment window is still active. Continue securely before the timer expires.");
      await Linking.openURL(pending.url);
    } catch {
      Alert.alert("Payment unavailable", "The saved Stripe checkout could not be reopened. Start payment again.");
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
    setChitthiSuggestionCity(resolvedCity);
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
    setChitthiSuggestionCity(resolvedCity);
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

  function runPostLoginTasks(userId: number, authenticatedPassword = "") {
    // Let the modal close and the authenticated screen paint before any key
    // recovery work. InteractionManager also prevents the transition itself
    // from competing with crypto and bootstrap network updates.
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        void load(false);
        if (authenticatedPassword) {
          void syncChatIdentityRecovery(userId, authenticatedPassword).catch(() => undefined);
        }
      }, 250);
    });
  }

  function completeSocialLogin(user: BootstrapPayload["user"]) {
    if (!user) return;
    setData((current) => current ? { ...current, user } : current);
    setSocialContinuation("");
    setSocialRecoveryEmailHint("");
    setShowSocialRecoveryEmail(false);
    setLoginOpen(false);
    setAuthMessage("");
    if (pendingListingAfterLogin) {
      setPendingListingAfterLogin(false);
      openListingFormForUser(user, selectedNeed || "need_place");
    }
    runPostLoginTasks(Number(user.id || 0));
  }

  function acceptSocialAuth(payload: MobileSocialAuthPayload) {
    if (payload.phoneRequired && payload.continuationToken) {
      setSocialContinuation(payload.continuationToken);
      setSocialRecoveryEmailHint("");
      setShowSocialRecoveryEmail(false);
      setLoginOpen(false);
      setAuthMessage("");
      return;
    }
    if (payload.token && payload.user) {
      completeSocialLogin(payload.user);
      return;
    }
    throw new Error("Social sign-in could not be completed.");
  }

  async function finishSocialProvider(provider: "google" | "apple", identityToken: string, name = "") {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthMessage(`Signing in with ${provider === "google" ? "Google" : "Apple"}...`);
    try {
      acceptSocialAuth(await mobileSocialLogin(provider, identityToken, name));
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Social sign-in failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function startGoogleSignIn() {
    if (IS_EXPO_GO && Platform.OS !== "web") {
      setAuthMessage("Google sign-in cannot run inside Expo Go. Install the FairFares development build, start Metro with npm run start:dev, and try again there.");
      return;
    }
    if (!GOOGLE_AUTH_CONFIGURED) {
      setAuthMessage("Google sign-in is not configured for this build yet.");
      return;
    }
    setAuthMessage("");
    await promptGoogleSignIn();
  }

  async function startAppleSignIn() {
    if (authBusy) return;
    setAuthMessage("");
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL
        ]
      });
      if (!credential.identityToken) throw new Error("Apple did not return a secure identity token.");
      const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(" ");
      await finishSocialProvider("apple", credential.identityToken, name);
    } catch (error) {
      if ((error as { code?: string })?.code === "ERR_REQUEST_CANCELED") return;
      setAuthMessage(error instanceof Error ? error.message : "Apple sign-in failed. Please try again.");
    }
  }

  async function saveSocialPhone() {
    if (authBusy || !socialContinuation) return;
    const nationalPhone = signupPhone.replace(/\D/g, "").replace(/^0+/, "");
    const e164Phone = `${signupCallingCode}${nationalPhone}`;
    if (!/^\+[1-9]\d{7,14}$/.test(e164Phone)) {
      setAuthMessage("Choose your country code and enter a valid mobile number.");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("Saving phone number...");
    try {
      const payload = await completeSocialPhone(socialContinuation, nationalPhone, signupCallingCode);
      completeSocialLogin(payload.user);
    } catch (error) {
      const recovery = (error as Error & { fairFaresPayload?: { recoveryEmailHint?: string } })?.fairFaresPayload;
      setSocialRecoveryEmailHint(String(recovery?.recoveryEmailHint || ""));
      setShowSocialRecoveryEmail(false);
      setAuthMessage(error instanceof Error ? error.message : "Could not save the phone number.");
    } finally {
      setAuthBusy(false);
    }
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
      const authenticatedPassword = password;
      setData((current) => current ? { ...current, user: payload.user } : current);
      setAuthMessage("Login successful.");
      setLoginOpen(false);
      setIdentifier("");
      setPassword("");
      if (pendingListingAfterLogin) {
        setPendingListingAfterLogin(false);
        openListingFormForUser(payload.user, selectedNeed || "need_place");
      }
      // Authentication is complete at this point. Refreshing the dashboard and
      // preparing FChat encryption must not keep the login modal blocked.
      runPostLoginTasks(Number(payload.user?.id || 0), authenticatedPassword);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Login failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitSignup() {
    if (authBusy) return;
    setAuthMessage("");
    const cleanName = signupName.trim().replace(/\s+/g, " ");
    const cleanEmail = identifier.trim().toLowerCase();
    const nationalPhone = signupPhone.replace(/\D/g, "").replace(/^0+/, "");
    const callingCodeDigits = signupCallingCode.replace(/\D/g, "");
    const e164Phone = `+${callingCodeDigits}${nationalPhone}`;
    if (cleanName.length < 2) {
      setAuthMessage("Enter your full name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setAuthMessage("Enter a valid email address.");
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(e164Phone)) {
      setAuthMessage("Choose your country code and enter a valid mobile number.");
      return;
    }
    if (password.length < 8) {
      setAuthMessage("Create a password with at least 8 characters.");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("Creating account...");
    try {
      const payload = await mobileSignup(cleanName, cleanEmail, nationalPhone, password, signupPhoneDiscoverable, signupCallingCode);
      const authenticatedPassword = password;
      setAuthMessage(payload.message || "Account created. Please activate your account from email before logging in.");
      setSignupName("");
      setSignupPhone("");
      setIdentifier("");
      setPassword("");
      if (!payload.activationRequired && payload.token) {
        if (payload.user) {
          setData((current) => current ? { ...current, user: payload.user || null } : current);
        }
        setLoginOpen(false);
        if (pendingListingAfterLogin) {
          setPendingListingAfterLogin(false);
          openListingFormForUser(payload.user || data?.user || null, selectedNeed || "need_place");
        }
        runPostLoginTasks(Number(payload.user?.id || 0), authenticatedPassword);
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

  const selectedScreen = staffPickupOpen ? (
      <StaffPickupScreen onClose={() => setStaffPickupOpen(false)} />
    ) : activeTab === "messenger" ? (
      <MessengerScreen
        data={data}
        preferredSuggestionCity={chitthiSuggestionCity}
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
        onOpenStaffPickup={() => setStaffPickupOpen(true)}
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
  const screen = (
    <React.Suspense fallback={(
      <View style={styles.lazyScreenFallback}>
        <ActivityIndicator size="large" color={theme.colors.brand} />
      </View>
    )}>
      {selectedScreen}
    </React.Suspense>
  );

  return (
    <NearbyRelayProvider user={data?.user || null}>
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
          hidden={staffPickupOpen || bottomTabsHidden || (activeTab === "messenger" && Boolean(pendingPost || pendingRide))}
        />
      </Animated.View>
      {launchVisible ? (
        <Animated.View pointerEvents="none" style={[styles.launchOverlay, { opacity: launchOpacity }]}>
          <Image
            source={require("./assets/launch-cityscape-v2.jpg")}
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
              <Image source={require("./assets/fairfares-logo-mobile.png")} style={styles.launchLogo} resizeMode="contain" />
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
              source={require("./assets/launch-car-mobile.png")}
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
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView
            style={styles.authModalScroll}
            contentContainerStyle={styles.modalCard}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.modalTitle}>{authMode === "login" ? "Login to FairFares" : "Create FairFares account"}</Text>
            <Text style={styles.modalCopy}>
              {authMode === "login"
                ? "Email/phone and password are required before messaging posters or joining groups."
                : "Signup needs name, email, phone, and password. You will activate the account from email before login."}
            </Text>
            <View style={styles.socialAuthStack}>
              {Platform.OS === "ios" ? (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
                  cornerRadius={13}
                  style={styles.appleAuthButton}
                  onPress={() => void startAppleSignIn()}
                />
              ) : null}
              <TouchableOpacity
                style={[styles.googleAuthButton, authBusy && styles.disabledButton]}
                onPress={() => void startGoogleSignIn()}
                disabled={authBusy}
                accessibilityRole="button"
                accessibilityLabel="Continue with Google"
              >
                <View style={styles.googleMark}><Text style={styles.googleMarkText}>G</Text></View>
                <Text style={styles.googleAuthButtonText}>Continue with Google</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.authDivider}>
              <View style={styles.authDividerLine} />
              <Text style={styles.authDividerText}>or use email and password</Text>
              <View style={styles.authDividerLine} />
            </View>
            {authMode === "signup" ? (
              <TextInput
                value={signupName}
                onChangeText={setSignupName}
                placeholder="Full name"
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="words"
                autoComplete="name"
                accessibilityLabel="Full name"
                style={styles.input}
              />
            ) : null}
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              placeholder={authMode === "login" ? "Email or phone" : "Email"}
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={authMode === "signup" ? "email-address" : "default"}
              autoComplete={authMode === "signup" ? "email" : "username"}
              accessibilityLabel={authMode === "login" ? "Email or phone" : "Email address"}
              style={styles.input}
            />
            {authMode === "signup" ? (
              <>
                <View style={styles.signupPhoneRow}>
                  <TouchableOpacity
                    style={styles.signupCallingCode}
                    onPress={() => setSignupCountryOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Country calling code ${signupCallingCode}`}
                  >
                    <Text style={styles.signupCallingCodeText}>{signupCallingCode}</Text>
                    <Text style={styles.signupCallingCodeChevron}>⌄</Text>
                  </TouchableOpacity>
                  <TextInput
                    value={signupPhone}
                    onChangeText={setSignupPhone}
                    placeholder="Mobile number"
                    placeholderTextColor={theme.colors.muted}
                    keyboardType="phone-pad"
                    autoComplete="tel-national"
                    accessibilityLabel="Mobile number without country code"
                    style={[styles.input, styles.signupPhoneInput]}
                  />
                </View>
                <Text style={styles.authHint}>Saved securely as {signupCallingCode} followed by your mobile number so Chitthi can match contacts across countries.</Text>
                <View style={styles.signupDiscoveryRow}>
                  <View style={styles.signupDiscoveryCopy}>
                    <Text style={styles.signupDiscoveryTitle}>Let contacts find me</Text>
                    <Text style={styles.signupDiscoveryText}>People who already have your exact number can find you in Chitthi. Your number is never displayed.</Text>
                  </View>
                  <Switch value={signupPhoneDiscoverable} onValueChange={setSignupPhoneDiscoverable} accessibilityLabel="Let contacts find me by exact phone number" />
                </View>
              </>
            ) : null}
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={theme.colors.muted}
              secureTextEntry
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
              accessibilityLabel="Password"
              style={styles.input}
            />
            {authMode === "signup" ? <Text style={styles.authHint}>Use at least 8 characters. You must activate the account from the email we send.</Text> : null}
            {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}
            <TouchableOpacity
              style={[styles.primaryButton, authBusy && styles.disabledButton]}
              onPress={authMode === "login" ? submitLogin : submitSignup}
              disabled={authBusy}
              accessibilityRole="button"
              accessibilityLabel={authMode === "login" ? "Log in" : "Create account"}
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
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={Boolean(socialContinuation)}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => {
          setSocialContinuation("");
          setSocialRecoveryEmailHint("");
          setShowSocialRecoveryEmail(false);
          setAuthMessage("");
        }}
      >
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.socialPhoneCard}>
            <Text style={styles.modalTitle}>Add your mobile number</Text>
            <Text style={styles.modalCopy}>Google or Apple verified your identity. Add a mobile number for booking updates and account contact. No verification code will be sent.</Text>
            <View style={styles.signupPhoneRow}>
              <TouchableOpacity
                style={styles.signupCallingCode}
                onPress={() => setSignupCountryOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Country calling code ${signupCallingCode}`}
              >
                <Text style={styles.signupCallingCodeText}>{signupCallingCode}</Text>
                <Text style={styles.signupCallingCodeChevron}>⌄</Text>
              </TouchableOpacity>
              <TextInput
                value={signupPhone}
                onChangeText={setSignupPhone}
                placeholder="Mobile number"
                placeholderTextColor={theme.colors.muted}
                keyboardType="phone-pad"
                autoComplete="tel-national"
                accessibilityLabel="Mobile number without country code"
                style={[styles.input, styles.signupPhoneInput]}
              />
            </View>
            {authMessage ? <Text style={styles.authMessage}>{authMessage}</Text> : null}
            {socialRecoveryEmailHint ? (
              <View>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowSocialRecoveryEmail((current) => !current)}>
                  <Text style={styles.secondaryButtonText}>Forgot user email ID?</Text>
                </TouchableOpacity>
                {showSocialRecoveryEmail ? (
                  <Text style={styles.authMessage}>Account email hint: {socialRecoveryEmailHint}</Text>
                ) : null}
              </View>
            ) : null}
            <TouchableOpacity
              style={[styles.primaryButton, authBusy && styles.disabledButton]}
              onPress={saveSocialPhone}
              disabled={authBusy}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>{authBusy ? "Please wait..." : "Save and continue"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setSocialContinuation("");
                setSocialRecoveryEmailHint("");
                setShowSocialRecoveryEmail(false);
                setAuthMessage("");
                setLoginOpen(true);
              }}
            >
              <Text style={styles.secondaryButtonText}>Cancel and return to login</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={signupCountryOpen} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setSignupCountryOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.countryPickerCard}>
            <Text style={styles.modalTitle}>Choose country code</Text>
            <Text style={styles.modalCopy}>This makes your phone number unambiguous for login and private Chitthi contact matching.</Text>
            {signupCallingCodes.map((country) => (
              <TouchableOpacity
                key={`${country.label}-${country.code}`}
                style={[styles.countryPickerOption, signupCallingCode === country.code && styles.countryPickerOptionActive]}
                onPress={() => { setSignupCallingCode(country.code); setSignupCountryOpen(false); }}
              >
                <Text style={styles.countryPickerFlag}>{country.flag}</Text>
                <Text style={styles.countryPickerLabel}>{country.label}</Text>
                <Text style={styles.countryPickerCode}>{country.code}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setSignupCountryOpen(false)}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
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
                const shouldResumePayment = paymentStatus?.action === "Continue payment";
                setPaymentStatus(null);
                if (shouldResumePayment) {
                  void resumePendingRentalCheckout();
                } else {
                  setSelectedService("cars");
                  setActiveTab("services");
                }
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
            <View style={styles.modalHeaderRow}>
              <TouchableOpacity style={styles.modalBackButton} onPress={() => setListingOpen(false)} accessibilityRole="button" accessibilityLabel="Back">
                <Text style={styles.modalBackGlyph}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>List room / property</Text>
            </View>
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
              <View style={styles.modalHeaderRow}>
                <TouchableOpacity style={styles.modalBackButton} onPress={() => setSearchOpen(false)} accessibilityRole="button" accessibilityLabel="Back">
                  <Text style={styles.modalBackGlyph}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>Search housing</Text>
              </View>
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
                onChangeText={(value) => { selectedCitySuggestionRef.current = ""; setSearchCity(value); setSearchCitySuggestions([]); }}
                placeholder="City, e.g. Denver, CO"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
              />
              {searchCitySuggestions.length ? (
                <View style={styles.citySuggestionDropdown} accessibilityLabel="City suggestions">
                  {searchCitySuggestions.map((cityOption) => (
                    <TouchableOpacity
                      key={cityOption}
                      style={styles.citySuggestionOption}
                      onPress={() => { selectedCitySuggestionRef.current = cityOption; setSearchCity(cityOption); setSearchArea(""); setSearchCitySuggestions([]); }}
                    >
                      <Text style={styles.citySuggestionPin}>⌖</Text>
                      <Text style={styles.citySuggestionText}>{cityOption}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
              <View style={styles.searchInputWrap}>
                <TextInput
                  value={searchArea}
                  onChangeText={setSearchArea}
                  placeholder="Area, building, campus, landmark"
                  placeholderTextColor={theme.colors.muted}
                  style={[styles.input, styles.searchInputWithClear]}
                />
                {searchArea ? (
                  <TouchableOpacity
                    style={styles.searchInputClear}
                    onPress={() => setSearchArea("")}
                    accessibilityRole="button"
                    accessibilityLabel="Clear area search"
                  >
                    <Text style={styles.searchInputClearText}>×</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
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
    </NearbyRelayProvider>
  );
}

const styles = StyleSheet.create({
  lazyScreenFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.bg,
  },
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
  authModalScroll: { width: "100%", maxWidth: 560, maxHeight: "88%", alignSelf: "center" },
  modalCard: { backgroundColor: theme.colors.panel, borderRadius: 26, padding: 18, gap: 14, borderWidth: 1, borderColor: theme.colors.line, opacity: 1 },
  searchModalCard: { height: "90%", maxHeight: "90%", paddingBottom: theme.spacing.md },
  searchModalScroll: { flex: 1 },
  searchModalContent: { gap: 14, paddingBottom: 20 },
  searchModalActions: { gap: theme.spacing.xs, paddingTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.line },
  listingModalCard: { maxHeight: "94%" },
  listingForm: { width: "100%", maxWidth: "100%", alignSelf: "stretch", gap: theme.spacing.md, paddingBottom: theme.spacing.lg },
  modalTitle: { color: theme.colors.text, fontSize: 20, lineHeight: 25, fontWeight: "700" },
  modalHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 42 },
  modalBackButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: theme.colors.line },
  modalBackGlyph: { color: theme.colors.text, fontSize: 34, lineHeight: 36, fontWeight: "400", marginTop: -2 },
  modalCopy: { color: theme.colors.muted, fontSize: 15, lineHeight: 21 },
  socialAuthStack: { gap: 10 },
  appleAuthButton: { width: "100%", height: 50 },
  googleAuthButton: { minHeight: 50, borderRadius: 13, borderWidth: 1, borderColor: "#747775", backgroundColor: "#ffffff", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 14 },
  googleMark: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#ffffff" },
  googleMarkText: { color: "#4285F4", fontSize: 19, lineHeight: 23, fontWeight: "800" },
  googleAuthButtonText: { color: "#1f1f1f", fontSize: 15, fontWeight: "700" },
  authDivider: { flexDirection: "row", alignItems: "center", gap: 10 },
  authDividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.line },
  authDividerText: { color: theme.colors.muted, fontSize: 11, fontWeight: "600" },
  socialPhoneCard: { width: "100%", maxWidth: 520, alignSelf: "center", backgroundColor: theme.colors.panel, borderRadius: 26, padding: 18, gap: 14, borderWidth: 1, borderColor: theme.colors.line },
  signupDiscoveryRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 14, backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line },
  signupDiscoveryCopy: { flex: 1, minWidth: 0 },
  signupDiscoveryTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  signupDiscoveryText: { color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  signupPhoneRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  signupCallingCode: { minWidth: 86, minHeight: 49, paddingHorizontal: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.panel2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: theme.colors.line },
  signupCallingCodeText: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  signupCallingCodeChevron: { color: theme.colors.muted, fontSize: 16 },
  signupPhoneInput: { flex: 1, minWidth: 0 },
  countryPickerCard: { width: "100%", maxWidth: 520, maxHeight: "86%", alignSelf: "center", backgroundColor: theme.colors.panel, borderRadius: 26, padding: 18, gap: 9, borderWidth: 1, borderColor: theme.colors.line },
  countryPickerOption: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, borderRadius: theme.radius.md, backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line },
  countryPickerOptionActive: { borderColor: theme.colors.blue, backgroundColor: "rgba(70,118,255,0.15)" },
  countryPickerFlag: { fontSize: 22 },
  countryPickerLabel: { flex: 1, color: theme.colors.text, fontSize: 14 },
  countryPickerCode: { color: theme.colors.soft, fontSize: 14, fontWeight: "700" },
  input: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.md, paddingHorizontal: 14, minHeight: 49, fontSize: 15 },
  searchInputWrap: { position: "relative", justifyContent: "center" },
  searchInputWithClear: { paddingRight: 52 },
  searchInputClear: { position: "absolute", right: 8, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: theme.colors.line },
  searchInputClearText: { color: theme.colors.text, fontSize: 25, lineHeight: 27, fontWeight: "500", marginTop: -2 },
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
  authHint: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, marginTop: -6 },
  suggestionPanel: { gap: 6 },
  suggestionList: { maxHeight: 96 },
  suggestionListContent: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 4 },
  suggestionTitle: { width: "100%", color: theme.colors.soft, fontWeight: "900", marginBottom: 2 },
  suggestionHint: { color: theme.colors.muted, fontWeight: "800", lineHeight: 20 },
  citySuggestionDropdown: { marginTop: -10, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 14, backgroundColor: theme.colors.panel, overflow: "hidden" },
  citySuggestionOption: { minHeight: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.line },
  citySuggestionPin: { color: theme.colors.accent, fontSize: 17, fontWeight: "900" },
  citySuggestionText: { color: theme.colors.text, fontSize: 14, fontWeight: "800", flex: 1 },
  switchText: { color: theme.colors.muted, textAlign: "center", fontWeight: "900", paddingVertical: 8 }
});
