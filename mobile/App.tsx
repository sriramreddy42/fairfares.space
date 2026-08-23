import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Google from "expo-auth-session/providers/google";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Easing, Image, InteractionManager, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { BottomTabs, TabKey } from "./src/components/BottomTabs";
import { DateTimeField, todayLocalIso } from "./src/components/DateTimeField";
import { absoluteAssetUrl, acceptCurrentPolicies, bookRentalCar, completeSocialPhone, createMobileHousingPost, getAccommodationLocationOptions, getBootstrap, getCars, getChatConversations, getChatDeviceKeys, getHousing, getHousingListing, getMobileNotificationPreferences, getRideListing, getRidePlaceSuggestions, getSiteServices, hydrateAuthToken, isAuthenticationRejection, lookupAccommodationLocation, mobileLogin, mobileLogout, mobileSignup, mobileSocialLogin, MobileHousingPostInput, MobileSocialAuthPayload, openChatForPost, registerChatDeviceKey, registerMobilePushToken, RidePlaceSuggestion, sendEncryptedChatMessage, setAuthToken, startRentalCheckout, submitAppFeedback, updateMobileNotificationPreferences } from "./src/api/client";
import { appAssets } from "./src/assets";
import { beginChatIdentityRecovery, invalidateChatIdentityRecovery } from "./src/utils/chatRecovery";
import type { ServiceKey } from "./src/screens/ServicesScreen";
import { theme } from "./src/theme";
import { BootstrapPayload, Car, HousingPost, RentalSearchInput, RidePost, ServiceItem } from "./src/types";
import { pickCompressedImages } from "./src/utils/imageUpload";
import { NearbyRelayProvider } from "./src/providers/NearbyRelayProvider";
import { encryptForDevices, getOrCreateDeviceIdentity } from "./src/utils/chatCrypto";
import { AppErrorBoundary } from "./src/components/AppErrorBoundary";
import { UserAvatar } from "./src/components/UserAvatar";
import { logDevelopmentPerformance, setPerformanceContext, startJavaScriptResponsivenessMonitor } from "./src/utils/performanceDiagnostics";
import { shareHousingListing } from "./src/utils/listingShare";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { HousingScreen } from "./src/screens/HousingScreen";
import { MessengerScreen } from "./src/screens/MessengerScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { ServicesScreen } from "./src/screens/ServicesScreen";
import { StaffPickupScreen } from "./src/screens/StaffPickupScreen";
import { CommunityScreen } from "./src/screens/CommunityScreen";

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
const NOTIFICATION_CHANNELS = {
  chitthi: "chitthi-messages-v2",
  carpool: "carpool-v2",
  rentals: "rentals-v2",
  marketing: "marketing-v2"
} as const;
const GOOGLE_AUTH_CONFIGURED = Platform.select({
  ios: !GOOGLE_IOS_CLIENT_ID.includes("not-configured"),
  android: !GOOGLE_ANDROID_CLIENT_ID.includes("not-configured") && !GOOGLE_WEB_CLIENT_ID.includes("not-configured"),
  default: !GOOGLE_WEB_CLIENT_ID.includes("not-configured"),
}) ?? false;

const CRITICAL_BRAND_IMAGE_SOURCES = [
  appAssets.logo,
  appAssets.chittiMascot,
  appAssets.chittiLettersGold,
  appAssets.navHome,
  appAssets.navServices,
  appAssets.navActivity,
  appAssets.profile,
  require("./assets/launch-cityscape-v2.jpg"),
  require("./assets/launch-car-mobile.png")
];
const REVIEW_PROMPT_DELAY_MS = 180_000;
const REVIEW_PROMPT_READY_GRACE_MS = 5 * 60_000;
const reviewPromptStorageKey = (userId: number | string) => `fairfares.mobile.review-prompt.v1.${userId}`;
const promotionalPromptStorageKey = (userId: number | string) => `fairfares.mobile.promotional-prompt.v1.${userId}`;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true
  })
});

function CriticalBrandAssetPreloader() {
  return (
    <View pointerEvents="none" style={styles.criticalAssetPreloader} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {CRITICAL_BRAND_IMAGE_SOURCES.map((source, index) => (
        <Image key={index} source={source} style={styles.criticalAssetImage} resizeMode="contain" />
      ))}
    </View>
  );
}

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

type ListingIntent = "have_place" | "need_place" | "need_roommates";

const listingIntentChoices: Array<{ value: ListingIntent; title: string; description: string }> = [
  { value: "need_place", title: "I need a place", description: "I am searching for a room or property." },
  { value: "have_place", title: "I have a place", description: "I am offering a room or property." },
  { value: "need_roommates", title: "I need roommates", description: "I want to form or fill a roommate group." }
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
  const content = (
    <SafeAreaProvider>
      <FairFaresApp />
    </SafeAreaProvider>
  );
  return (
    <AppErrorBoundary>
      {IS_EXPO_GO || Platform.OS === "web" ? content : <KeyboardProvider preload>{content}</KeyboardProvider>}
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
  const [signupConsentAccepted, setSignupConsentAccepted] = useState(false);
  const [socialConsentAccepted, setSocialConsentAccepted] = useState(false);
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [socialContinuation, setSocialContinuation] = useState("");
  const pendingSocialContinuationRef = useRef("");
  const socialModalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledGoogleResponseRef = useRef("");
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
  const [sentCardPostIds, setSentCardPostIds] = useState<string[]>([]);
  const [sentCardRideIds, setSentCardRideIds] = useState<string[]>([]);
  const [sentCardOwnerUserId, setSentCardOwnerUserId] = useState(0);
  const [pendingGroupInvite, setPendingGroupInvite] = useState("");
  const [linkedHousingPost, setLinkedHousingPost] = useState<HousingPost | null>(null);
  const [linkedCommunityPostId, setLinkedCommunityPostId] = useState("");
  const [linkedCarpoolRide, setLinkedCarpoolRide] = useState<RidePost | null>(null);
  const [notificationConversationId, setNotificationConversationId] = useState("");
  const [pendingListingAfterLogin, setPendingListingAfterLogin] = useState(false);
  const [rideOwnerOpenToken, setRideOwnerOpenToken] = useState(0);
  const [rideOwnerEditId, setRideOwnerEditId] = useState("");
  const [rentalEditBookingId, setRentalEditBookingId] = useState("");
  const [rideOwnerOpenTarget, setRideOwnerOpenTarget] = useState<"workspace" | "requests" | "listings">("workspace");
  const [rideOwnerReturnTab, setRideOwnerReturnTab] = useState<TabKey | null>(null);

  useEffect(() => {
    if (Platform.OS !== "android" || IS_EXPO_GO || !GOOGLE_AUTH_CONFIGURED) return;
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      offlineAccess: false
    });
  }, []);
  const [visiblePosts, setVisiblePosts] = useState<HousingPost[]>([]);
  const [selectedNeed, setSelectedNeed] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedGender, setSelectedGender] = useState("");
  const [selectedBudget, setSelectedBudget] = useState("");
  const [selectedSort, setSelectedSort] = useState<"distanceAsc" | "distanceDesc" | "rentAsc" | "rentDesc">("distanceAsc");
  const [city, setCity] = useState("Denver, CO");
  const [discoveryLocation, setDiscoveryLocation] = useState("");
  const [area, setArea] = useState("");
  const [housingSearchCoordinates, setHousingSearchCoordinates] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [hasSearchedHousingLocation, setHasSearchedHousingLocation] = useState(false);
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

  // This is intentionally session-only. A fresh app process always starts
  // with the short discovery carousel and its fourth-card search prompt.

  const [cars, setCars] = useState<Car[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceKey>("cars");
  const [listingOpen, setListingOpen] = useState(false);
  const [housingListingSuccess, setHousingListingSuccess] = useState<HousingPost | null>(null);
  const [listingForm, setListingForm] = useState<MobileHousingPostInput>(emptyListingForm);
  const [roommatePlaceChoice, setRoommatePlaceChoice] = useState<boolean | null>(null);
  const [listingAddressSuggestions, setListingAddressSuggestions] = useState<RidePlaceSuggestion[]>([]);
  const [listingAddressLoading, setListingAddressLoading] = useState(false);
  const [listingAddressValidated, setListingAddressValidated] = useState(false);
  const [listingValidatedLabel, setListingValidatedLabel] = useState("");
  const [bottomTabsHidden, setBottomTabsHidden] = useState(false);
  const [messengerMediaTransferActive, setMessengerMediaTransferActive] = useState(false);

  useEffect(() => startJavaScriptResponsivenessMonitor(), []);

  useEffect(() => {
    setPerformanceContext(`${activeTab}${bottomTabsHidden ? ":thread" : ""}${loading ? ":loading" : ""}`);
  }, [activeTab, bottomTabsHidden, loading]);
  const [staffPickupOpen, setStaffPickupOpen] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<{ title: string; body: string; action: string } | null>(null);
  const [reviewPromptArmedUserId, setReviewPromptArmedUserId] = useState(0);
  const [reviewPromptReadyAt, setReviewPromptReadyAt] = useState(0);
  const [reviewPromptOpen, setReviewPromptOpen] = useState(false);
  const [reviewPromptRating, setReviewPromptRating] = useState(0);
  const [reviewPromptText, setReviewPromptText] = useState("");
  const [reviewPromptBusy, setReviewPromptBusy] = useState(false);
  const [reviewPromptContext, setReviewPromptContext] = useState<{ name: string; photoUrl: string; listingTitle: string } | null>(null);
  const [profileCompletionOpen, setProfileCompletionOpen] = useState(false);
  const [profileCompletionEditRequested, setProfileCompletionEditRequested] = useState(false);
  const [profileConsentAccepted, setProfileConsentAccepted] = useState(false);
  const [profileConsentBusy, setProfileConsentBusy] = useState(false);
  const profileCompletionPromptedUserRef = useRef(0);
  const [housingWelcomeFocusKey, setHousingWelcomeFocusKey] = useState(0);
  const [carpoolFocusKey, setCarpoolFocusKey] = useState(0);
  const [launchVisible, setLaunchVisible] = useState(true);
  const launchStartedAt = useRef(Date.now());
  const bootstrapGenerationRef = useRef(0);
  const launchOpacity = useRef(new Animated.Value(1)).current;
  const launchScale = useRef(new Animated.Value(0.94)).current;
  const launchCarOpacity = useRef(new Animated.Value(0)).current;
  const launchCarScale = useRef(new Animated.Value(0.56)).current;
  const launchCarOffset = useRef(new Animated.Value(24)).current;
  const launchPromiseOpacity = useRef(new Animated.Value(0)).current;
  const launchPromiseOffset = useRef(new Animated.Value(10)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const pushTokenRef = useRef("");
  const pushRegistrationRunningRef = useRef(false);
  const notificationPermissionPromptShownRef = useRef(false);
  const promotionalPromptRunningRef = useRef(false);
  const listingIntent: ListingIntent = listingForm.roommateIntent
    ? "need_roommates"
    : listingForm.postMode === "HAVE_PLACE"
      ? "have_place"
      : "need_place";
  const listingIsHavePlace = listingIntent === "have_place";
  const listingIsNeedPlace = listingIntent === "need_place";
  const listingIsRoommateSearch = listingIntent === "need_roommates";
  const listingRoommateHasPlace = listingIsRoommateSearch && roommatePlaceChoice === true;
  const listingHasPropertyDetails = listingIsHavePlace || listingRoommateHasPlace;
  const listingLocationInput = listingHasPropertyDetails ? listingForm.streetAddress : listingForm.area;
  async function enableMobileNotifications(requestPermission = true) {
    if (Platform.OS === "web") {
      return false;
    }
    if (pushRegistrationRunningRef.current) return false;
    pushRegistrationRunningRef.current = true;
    try {
      if (Platform.OS === "android") {
        await Promise.all([
          Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.chitthi, {
            name: "Chitthi messages",
            importance: Notifications.AndroidImportance.HIGH,
            sound: "default",
            vibrationPattern: [0, 250, 150, 250],
            lightColor: "#4f7cff"
          }),
          Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.carpool, {
            name: "Carpool activity",
            importance: Notifications.AndroidImportance.HIGH,
            sound: "default",
            vibrationPattern: [0, 250, 150, 250],
            lightColor: "#22c55e"
          }),
          Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.rentals, {
            name: "Rental bookings",
            importance: Notifications.AndroidImportance.HIGH,
            sound: "default",
            vibrationPattern: [0, 250, 150, 250],
            lightColor: "#f59e0b"
          }),
          Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNELS.marketing, {
            name: "FairFares ideas and deals",
            importance: Notifications.AndroidImportance.DEFAULT,
            sound: "default",
            vibrationPattern: [0, 180],
            lightColor: "#4f7cff"
          })
        ]);
      }
      let permission = await Notifications.getPermissionsAsync();
      if (permission.status !== "granted" && requestPermission) {
        permission = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true
          }
        });
      }
      if (permission.status !== "granted") {
        if (requestPermission && !notificationPermissionPromptShownRef.current) {
          notificationPermissionPromptShownRef.current = true;
          Alert.alert(
            "Turn on notifications",
            "Enable notifications in Settings to hear Chitthi messages and receive carpool and rental updates.",
            [
              { text: "Not now", style: "cancel" },
              { text: "Open Settings", onPress: () => void Linking.openSettings() }
            ]
          );
        }
        return false;
      }
      // Simulators can exercise local APNs payloads and the Notification
      // Service Extension, but cannot obtain a real Expo/APNs device token.
      if (!Device.isDevice) return true;
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
    } finally {
      pushRegistrationRunningRef.current = false;
    }
  }

  async function offerPromotionalNotifications() {
    const userId = Number(data?.user?.id || 0);
    if (Platform.OS === "web" || !userId || data?.user?.promotionalNotificationsEnabled || promotionalPromptRunningRef.current) return;
    promotionalPromptRunningRef.current = true;
    try {
      const storageKey = promotionalPromptStorageKey(userId);
      const handled = await AsyncStorage.getItem(storageKey).catch(() => null);
      if (handled) return;
      Alert.alert(
        "Get FairFares opportunities",
        "Rental, housing, and carpool updates.",
        [
          {
            text: "Not now",
            style: "cancel",
            onPress: () => void AsyncStorage.setItem(storageKey, "dismissed")
          },
          {
            text: "Turn On",
            onPress: () => void (async () => {
              try {
                const current = await getMobileNotificationPreferences();
                await updateMobileNotificationPreferences({ ...current.preferences, marketing: true });
                await AsyncStorage.setItem(storageKey, "enabled");
                setData((value) => value?.user ? {
                  ...value,
                  user: { ...value.user, promotionalNotificationsEnabled: true }
                } : value);
              } catch (error) {
                Alert.alert("FairFares opportunities", error instanceof Error ? error.message : "Unable to enable opportunities right now.");
              }
            })()
          }
        ]
      );
    } finally {
      promotionalPromptRunningRef.current = false;
    }
  }

  async function unregisterNotificationsForLogout() {
    if (Platform.OS !== "web") {
      await Notifications.setBadgeCountAsync(0).catch(() => false);
    }
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
    const generation = bootstrapGenerationRef.current + 1;
    bootstrapGenerationRef.current = generation;
    if (showLoader) setLoading(true);
    try {
      const payload = await getBootstrap(city);
      if (bootstrapGenerationRef.current !== generation) return;
      setData(payload);
      setDiscoveryLocation((current) => current || payload.location.city || city);
      setVisiblePosts(payload.housing);
      const [carResult, serviceResult] = await Promise.allSettled([getCars(), getSiteServices()]);
      if (bootstrapGenerationRef.current !== generation) return;
      setCars(carResult.status === "fulfilled" ? carResult.value : []);
      setServices(serviceResult.status === "fulfilled" ? serviceResult.value : []);
    } catch (error) {
      if (bootstrapGenerationRef.current !== generation) return;
      if (isAuthenticationRejection(error)) {
        await setAuthToken("");
        setData((current) => current ? { ...current, user: null, chat: { unreadCount: 0, conversations: [], messagedPostIds: [], messagedRideIds: [] } } : current);
      }
      Alert.alert("FairFares", error instanceof Error ? error.message : "Unable to load FairFares.");
    } finally {
      if (showLoader && bootstrapGenerationRef.current === generation) setLoading(false);
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
    if (data?.user) void (async () => {
      if (await enableMobileNotifications(true)) await offerPromotionalNotifications();
    })();
  }, [data?.user?.id]);

  useEffect(() => {
    if (!data?.user) {
      setSentCardPostIds([]);
      setSentCardRideIds([]);
      setSentCardOwnerUserId(0);
      return;
    }
    setSentCardPostIds(data.chat.messagedPostIds || []);
    setSentCardRideIds(data.chat.messagedRideIds || []);
    setSentCardOwnerUserId(Number(data.user.id || 0));
  }, [data?.user?.id, data?.chat.messagedPostIds, data?.chat.messagedRideIds]);

  useEffect(() => {
    if (Platform.OS === "web" || !data?.user) return;
    const retry = setInterval(() => {
      if (!pushTokenRef.current) void enableMobileNotifications(false);
    }, 60_000);
    return () => clearInterval(retry);
  }, [data?.user?.id]);

  useEffect(() => {
    const user = data?.user;
    const userId = Number(user?.id || 0);
    const profileIncomplete = Boolean(userId && (
      !user?.profilePhotoUrl?.trim()
      || !user?.name?.trim()
      || !user?.email?.trim()
      || !user?.phone?.trim()
      || user?.consentPending
    ));
    if (!profileIncomplete) {
      setProfileCompletionOpen(false);
      return;
    }
    if (
      profileCompletionPromptedUserRef.current === userId
      || loading
      || launchVisible
      || loginOpen
      || searchOpen
      || listingOpen
      || paymentUrl
      || paymentStatus
      || reviewPromptOpen
      || bottomTabsHidden
    ) return;
    const timer = setTimeout(() => {
      profileCompletionPromptedUserRef.current = userId;
      setProfileCompletionOpen(true);
    }, 900);
    return () => clearTimeout(timer);
  }, [bottomTabsHidden, data?.user, launchVisible, listingOpen, loading, loginOpen, paymentStatus, paymentUrl, reviewPromptOpen, searchOpen]);

  useEffect(() => {
    if (Platform.OS === "web" || !data?.user) return;
    const subscription = Notifications.addPushTokenListener(() => {
      // Expo push tokens can rotate after the underlying APNs/FCM token changes.
      // Re-fetch and register the current Expo token immediately.
      void enableMobileNotifications(false);
    });
    return () => subscription.remove();
  }, [data?.user?.id]);

  useEffect(() => {
    const userId = Number(data?.user?.id || 0);
    if (!userId || data?.hasSubmittedMobileReview || reviewPromptArmedUserId !== userId || !reviewPromptReadyAt) return;
    let cancelled = false;
    let promptTimer: ReturnType<typeof setTimeout> | undefined;
    const markReviewPromptHandled = async (action: "dismissed" | "positive" | "feedback") => {
      setReviewPromptArmedUserId(0);
      setReviewPromptReadyAt(0);
      setReviewPromptOpen(false);
      try {
        await AsyncStorage.setItem(reviewPromptStorageKey(userId), JSON.stringify({
          action,
          handledAt: new Date().toISOString()
        }));
      } catch {
        // If local storage is unavailable, still clear this in-memory prompt.
      }
    };
    const schedulePrompt = async () => {
      const existing = await AsyncStorage.getItem(reviewPromptStorageKey(userId)).catch(() => null);
      if (cancelled || existing) return;
      const waitMs = Math.max(0, reviewPromptReadyAt - Date.now());
      promptTimer = setTimeout(() => {
        if (cancelled) return;
        if (loading || launchVisible || loginOpen || authBusy || searchOpen || listingOpen || staffPickupOpen || paymentUrl || paymentStatus || bottomTabsHidden || activeTab !== "housing") {
          if (Date.now() - reviewPromptReadyAt <= REVIEW_PROMPT_READY_GRACE_MS) setReviewPromptReadyAt(Date.now() + 15_000);
          return;
        }
        setReviewPromptRating(0);
        setReviewPromptText("");
        setReviewPromptOpen(true);
      }, waitMs);
    };
    void schedulePrompt();
    return () => {
      cancelled = true;
      if (promptTimer) clearTimeout(promptTimer);
    };
  }, [activeTab, authBusy, bottomTabsHidden, data?.hasSubmittedMobileReview, data?.user?.id, launchVisible, listingOpen, loading, loginOpen, paymentStatus, paymentUrl, reviewPromptArmedUserId, reviewPromptReadyAt, searchOpen, staffPickupOpen]);

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
    const responseKey = identityToken.slice(-48);
    if (handledGoogleResponseRef.current === responseKey) return;
    handledGoogleResponseRef.current = responseKey;
    void finishSocialProvider("google", identityToken);
  }, [googleResponse]);

  useEffect(() => () => {
    if (socialModalTimerRef.current) clearTimeout(socialModalTimerRef.current);
  }, []);

  useEffect(() => {
    const userId = data?.user?.id;
    if (!userId) return;
    let cancelled = false;
    let refreshRunning = false;
    const refreshUnread = async () => {
      if (refreshRunning) return;
      refreshRunning = true;
      try {
        const conversations = await getChatConversations();
        if (cancelled) return;
        const unreadCount = conversations.reduce((total, conversation) => total + Math.max(0, Number(conversation.unread) || 0), 0);
        const nextConversations = conversations.slice(0, 10);
        setData((current) => {
          if (current?.user?.id !== userId) return current;
          const currentConversations = current.chat.conversations || [];
          const conversationsUnchanged = currentConversations.length === nextConversations.length
            && JSON.stringify(currentConversations) === JSON.stringify(nextConversations);
          if (conversationsUnchanged && current.chat.unreadCount === unreadCount && current.dashboard.messages === unreadCount) return current;
          return {
            ...current,
            chat: { ...current.chat, unreadCount, conversations: nextConversations },
            dashboard: { ...current.dashboard, messages: unreadCount }
          };
        });
        if (Platform.OS !== "web") {
          await Notifications.setBadgeCountAsync(unreadCount).catch(() => false);
        }
      } catch {
        // Keep the last confirmed count during short network interruptions.
      } finally {
        refreshRunning = false;
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
      if (type === "CHITTHI_MESSAGE" || type === "FCHAT_MESSAGE" || type === "CHITTHI_REACTION") {
        setNotificationConversationId(String(response?.notification.request.content.data?.conversationId || ""));
        setPendingPost(null);
        setPendingRide(null);
        setActiveTab("messenger");
      } else if (type === "COMMUNITY_ANSWER" || type === "COMMUNITY_ACCEPTED") {
        setPendingPost(null);
        setPendingRide(null);
        setLinkedCommunityPostId(String(response?.notification.request.content.data?.postId || ""));
        setActiveTab("community");
      } else if (type === "CARPOOL_REQUEST" || type === "CARPOOL_STATUS" || type === "CARPOOL_RATING") {
        setPendingPost(null);
        setPendingRide(null);
        setRideOwnerOpenTarget(type === "CARPOOL_REQUEST" ? "requests" : "workspace");
        setRideOwnerReturnTab("activity");
        setSelectedNeed("ride_offer");
        setActiveTab("housing");
        setRideOwnerOpenToken((value) => value + 1);
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
    // Messenger owns tab visibility while it is active. Resetting here when
    // entering Chitthi can run after the thread's hide callback and expose the
    // global navbar over the composer.
    if (activeTab !== "messenger") setBottomTabsHidden(false);
  }, [activeTab]);

  useEffect(() => {
    function handleAppUrl(url: string | null) {
      if (!url) return;
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./i, "");
        const communityPath = parsed.pathname.match(/^\/community\/([^/]+)$/i);
        const opensCommunity = (host === "fairfare.space" && (parsed.pathname === "/community" || Boolean(communityPath))) || (parsed.protocol === "fairfares:" && host === "community");
        if (opensCommunity) {
          setLinkedCommunityPostId(communityPath?.[1] ? decodeURIComponent(communityPath[1]) : parsed.searchParams.get("postId") || "");
          setActiveTab("community");
          return;
        }
        const opensHousing = (host === "fairfare.space" && parsed.pathname === "/accommodations") || (parsed.protocol === "fairfares:" && host === "housing");
        if (opensHousing) {
          const postId = parsed.searchParams.get("ad_id") || parsed.searchParams.get("postId") || "";
          setSelectedNeed("need_place");
          setActiveTab("housing");
          if (postId) {
            void getHousingListing(postId).then((post) => {
              if (!post) {
                Alert.alert("Listing unavailable", "This housing listing has expired or is no longer available.");
                return;
              }
              setVisiblePosts((current) => [post, ...current.filter((item) => item.id !== post.id)]);
              setLinkedHousingPost(post);
            }).catch(() => Alert.alert("Listing unavailable", "This housing listing is no longer available."));
          }
          return;
        }
        const opensCarpool = (host === "fairfare.space" && parsed.pathname === "/carpool") || (parsed.protocol === "fairfares:" && host === "carpool");
        if (opensCarpool) {
          const rideId = parsed.searchParams.get("rideId") || parsed.searchParams.get("ride_id") || "";
          setSelectedNeed("ride_need");
          setActiveTab("housing");
          if (rideId) {
            void getRideListing(rideId).then((ride) => {
              if (!ride) {
                Alert.alert("Ride unavailable", "This carpool listing has expired or is no longer available.");
                return;
              }
              setLinkedCarpoolRide(ride);
            }).catch(() => Alert.alert("Ride unavailable", "This carpool listing is no longer available."));
          }
          return;
        }
        const invitePathMatch = parsed.pathname.match(/\/(?:chitthi|fchat)\/invite\/([^/]+)/i);
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

  async function openPostConversation(post: HousingPost) {
    if (!data?.user) {
      setLoginOpen(true);
      return;
    }
    if (Number(post.posterUserId || 0) === Number(data.user.id || 0)) return;
    try {
      const opened = await openChatForPost(post.id);
      setData((current) => current ? {
        ...current,
        chat: {
          ...current.chat,
          conversations: [opened.conversation, ...current.chat.conversations.filter((item) => item.id !== opened.conversation.id)]
        }
      } : current);
      setPendingPost(null);
      setPendingRide(null);
      setNotificationConversationId(String(opened.conversation.id));
      setActiveTab("messenger");
    } catch (error) {
      Alert.alert("Conversation unavailable", error instanceof Error ? error.message : "Could not open this conversation.");
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

  async function sendPostMessageInline(post: HousingPost, message: string) {
    const userId = Number(data?.user?.id || 0);
    if (!userId) {
      setLoginOpen(true);
      throw new Error("Sign in to message this seller.");
    }
    if (Number(post.posterUserId || 0) === userId) throw new Error("You cannot message your own listing.");
    try {
      const identity = await getOrCreateDeviceIdentity(userId);
      await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey || "");
      const opened = await openChatForPost(post.id);
      const keys = await getChatDeviceKeys(opened.conversation.id);
      if (!keys.ready || !keys.keys.length) throw new Error(keys.warning || "The seller's encrypted chat is not ready yet.");
      const envelopes = encryptForDevices(message, identity, keys.keys);
      await sendEncryptedChatMessage(opened.conversation.id, envelopes, undefined, false, 0, post.id);
      markCardMessageSent({ postId: post.id, name: post.posterName, photoUrl: post.photoUrl, listingTitle: post.title });
    } catch (error) {
      Alert.alert("Message not sent", error instanceof Error ? error.message : "Could not send this message.");
      throw error;
    }
  }

  async function armReviewPromptAfterCardMessage() {
    const userId = Number(data?.user?.id || 0);
    if (!userId || data?.hasSubmittedMobileReview) return;
    const alreadyHandled = await AsyncStorage.getItem(reviewPromptStorageKey(userId)).catch(() => null);
    if (alreadyHandled) return;
    setReviewPromptArmedUserId(userId);
    setReviewPromptReadyAt(Date.now() + REVIEW_PROMPT_DELAY_MS);
  }

  function markCardMessageSent(context: { postId?: string; rideId?: string; name?: string; photoUrl?: string; listingTitle?: string }) {
    const currentUserId = Number(data?.user?.id || 0);
    setSentCardOwnerUserId(currentUserId);
    if (context.postId) {
      setSentCardPostIds((current) => current.includes(context.postId!) ? current : [...current, context.postId!]);
    }
    if (context.rideId) {
      setSentCardRideIds((current) => current.includes(context.rideId!) ? current : [...current, context.rideId!]);
    }
    setData((current) => {
      if (!current?.user || Number(current.user.id || 0) !== currentUserId) return current;
      const postIds = context.postId && !current.chat.messagedPostIds.includes(context.postId)
        ? [...current.chat.messagedPostIds, context.postId]
        : current.chat.messagedPostIds;
      const rideIds = context.rideId && !current.chat.messagedRideIds.includes(context.rideId)
        ? [...current.chat.messagedRideIds, context.rideId]
        : current.chat.messagedRideIds;
      return { ...current, chat: { ...current.chat, messagedPostIds: postIds, messagedRideIds: rideIds } };
    });
    setReviewPromptContext({
      name: context.name?.trim() || "FairFares member",
      photoUrl: absoluteAssetUrl(context.photoUrl || ""),
      listingTitle: context.listingTitle?.trim() || "Marketplace listing"
    });
    void armReviewPromptAfterCardMessage();
  }

  async function dismissReviewPrompt() {
    const userId = Number(data?.user?.id || 0);
    if (!userId) {
      setReviewPromptOpen(false);
      return;
    }
    setReviewPromptArmedUserId(0);
    setReviewPromptReadyAt(0);
    setReviewPromptOpen(false);
    await AsyncStorage.setItem(reviewPromptStorageKey(userId), JSON.stringify({
      action: "dismissed",
      handledAt: new Date().toISOString()
    })).catch(() => undefined);
  }

  async function submitReviewPrompt() {
    const userId = Number(data?.user?.id || 0);
    if (!userId || !reviewPromptRating || reviewPromptBusy) return;
    setReviewPromptBusy(true);
    const cleanText = reviewPromptText.trim();
    try {
      await AsyncStorage.setItem(reviewPromptStorageKey(userId), JSON.stringify({
        action: reviewPromptRating >= 4 ? "positive" : "feedback",
        handledAt: new Date().toISOString()
      })).catch(() => undefined);
      setReviewPromptArmedUserId(0);
      setReviewPromptReadyAt(0);
      setReviewPromptOpen(false);
      await submitAppFeedback(
        reviewPromptRating,
        cleanText || (reviewPromptRating >= 4 ? "Enjoying FairFares mobile experience." : "FairFares mobile review prompt: user said it needs work."),
        "mobile-review-prompt"
      );
      setData((current) => current ? { ...current, hasSubmittedMobileReview: true } : current);
      setReviewPromptText("");
      setReviewPromptRating(0);
    } catch {
      Alert.alert("FairFares", "Could not send your feedback right now.");
    } finally {
      setReviewPromptBusy(false);
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
    const [lookup, options] = await Promise.all([
      lookupAccommodationLocation(nextArea || city),
      getAccommodationLocationOptions(city, nextArea)
    ]);
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
      setHasSearchedHousingLocation(true);
      setData((current) =>
        current
          ? {
              ...current,
              location: {
                ...current.location,
                city: resolvedCity,
                selected: resolvedArea ? `${resolvedCity} · ${resolvedArea}` : resolvedCity,
                suggested: lookup?.suggestedLocation || current.location.suggested,
                suggestedAreas: options?.suggested?.filter(Boolean).slice(0, 12) || current.location.suggestedAreas
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
    const [lookup, options] = await Promise.all([
      lookupAccommodationLocation(cleanArea || cleanCity),
      getAccommodationLocationOptions(cleanCity, cleanArea)
    ]);
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
      setHasSearchedHousingLocation(true);
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
                suggested: lookup?.suggestedLocation || current.location.suggested,
                suggestedAreas: options?.suggested?.filter(Boolean).slice(0, 12) || current.location.suggestedAreas
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

  function resolveListingIntent(intent = selectedNeed): ListingIntent {
    if (intent === "have_place") return "have_place";
    if (intent === "need_roommates") return "need_roommates";
    return "need_place";
  }

  function openListingFormForUser(user: BootstrapPayload["user"], intent = selectedNeed) {
    const resolvedIntent = resolveListingIntent(intent);
    const nextMode: MobileHousingPostInput["postMode"] =
      resolvedIntent === "have_place" ? "HAVE_PLACE" : "NEED_PLACE";
    setListingForm({
      ...emptyListingForm,
      postMode: nextMode,
      roommateIntent: resolvedIntent === "need_roommates",
      category: resolvedIntent === "need_roommates" ? "shared_room" : emptyListingForm.category,
      city,
      contactName: user?.name || "",
      contactEmail: user?.email || "",
      contactPhone: user?.phone || ""
    });
    setListingAddressSuggestions([]);
    setListingAddressValidated(false);
    setListingValidatedLabel("");
    setRoommatePlaceChoice(null);
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

  function updateListingIntent(intent: ListingIntent) {
    setListingForm((current) => {
      const isHavePlace = intent === "have_place";
      const isRoommateSearch = intent === "need_roommates";
      return {
        ...current,
        postMode: isHavePlace ? "HAVE_PLACE" : "NEED_PLACE",
        roommateIntent: isRoommateSearch,
        category: isRoommateSearch ? "shared_room" : current.category || "single_room",
        streetAddress: isHavePlace ? current.streetAddress : "",
        area: isHavePlace ? "" : current.area,
        primaryNeighborhood: isHavePlace ? current.primaryNeighborhood : "",
        apartmentName: isHavePlace ? current.apartmentName : "",
        commutePreference: isHavePlace ? "" : current.commutePreference,
        deposit: isHavePlace ? current.deposit : "",
        daysAvailable: isHavePlace ? current.daysAvailable : "",
        furnished: isHavePlace ? current.furnished : false,
        privateBath: isHavePlace ? current.privateBath : false,
        parking: isHavePlace ? current.parking : false,
        utilitiesIncluded: isHavePlace ? current.utilitiesIncluded : false
      };
    });
    setListingAddressSuggestions([]);
    setListingAddressValidated(false);
    setListingValidatedLabel("");
    setRoommatePlaceChoice(null);
  }

  function updateRoommatePlaceStatus(hasPlace: boolean) {
    setRoommatePlaceChoice(hasPlace);
    setListingForm((current) => ({
      ...current,
      postMode: hasPlace ? "HAVE_PLACE" : "NEED_PLACE",
      roommateIntent: true,
      category: "shared_room",
      streetAddress: hasPlace ? current.streetAddress : "",
      area: hasPlace ? "" : current.area,
      primaryNeighborhood: hasPlace ? current.primaryNeighborhood : "",
      apartmentName: hasPlace ? current.apartmentName : "",
      commutePreference: hasPlace ? "" : current.commutePreference,
      deposit: hasPlace ? current.deposit : "",
      daysAvailable: hasPlace ? current.daysAvailable : "",
      furnished: hasPlace ? current.furnished : false,
      privateBath: hasPlace ? current.privateBath : false,
      parking: hasPlace ? current.parking : false,
      utilitiesIncluded: hasPlace ? current.utilitiesIncluded : false
    }));
    setListingAddressSuggestions([]);
    setListingAddressValidated(false);
    setListingValidatedLabel("");
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
    const query = listingLocationInput.trim();
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
  }, [listingOpen, listingForm.area, listingForm.city, listingForm.streetAddress, listingAddressValidated, listingLocationInput]);

  async function submitListing() {
    const requiredFields = [
      listingIsRoommateSearch && roommatePlaceChoice === null ? "whether you already have a place" : "",
      !listingForm.city.trim() ? "city" : "",
      !listingForm.zipCode.trim() ? "ZIP code" : "",
      !listingForm.title.trim() ? "title" : "",
      !listingForm.description.trim() ? "description" : "",
      !listingForm.moveInDate.trim() ? (listingHasPropertyDetails ? "available from date" : "move-in date") : "",
      !listingForm.rentMin.trim() ? (listingHasPropertyDetails ? "rent" : "budget") : "",
      listingHasPropertyDetails && !listingForm.primaryNeighborhood.trim() ? "neighborhood / locality" : "",
      listingHasPropertyDetails && !listingForm.accommodates.trim() ? "accommodates" : "",
      listingIsNeedPlace && !listingForm.accommodates.trim() ? "people moving" : "",
      listingIsRoommateSearch && !listingForm.roommateCount.trim() ? "roommates needed" : "",
      listingHasPropertyDetails && !(listingForm.images || []).length ? "valid room/property image" : "",
      !listingForm.contactName.trim() ? "contact name" : "",
      !listingForm.contactEmail.trim() ? "contact email" : "",
      !listingForm.contactPhone.trim() ? "contact phone" : ""
    ].filter(Boolean);
    if (requiredFields.length) {
      Alert.alert("Missing details", `Please add: ${requiredFields.join(", ")}.`);
      return;
    }
    if (!listingAddressValidated) {
      Alert.alert(
        listingHasPropertyDetails ? "Validate the address" : "Validate the preferred location",
        listingHasPropertyDetails
          ? "Enter the property address and select the correct suggested address before posting."
          : "Enter your preferred area, campus, building, or landmark and select the correct suggestion before posting."
      );
      return;
    }
    const listingPayload: MobileHousingPostInput = {
      ...listingForm,
      title: listingForm.title.trim(),
      description: listingForm.description.trim(),
      city: normalizeCityInput(listingForm.city),
      postMode: listingHasPropertyDetails ? "HAVE_PLACE" : "NEED_PLACE",
      streetAddress: listingHasPropertyDetails ? listingForm.streetAddress.trim() : "",
      zipCode: listingForm.zipCode.trim(),
      area: listingHasPropertyDetails ? listingForm.primaryNeighborhood.trim() : listingForm.area.trim(),
      primaryNeighborhood: listingHasPropertyDetails ? listingForm.primaryNeighborhood.trim() : "",
      apartmentName: listingHasPropertyDetails ? listingForm.apartmentName.trim() : "",
      workSchoolLocation: listingHasPropertyDetails ? "" : listingForm.workSchoolLocation.trim(),
      roommateIntent: listingIsRoommateSearch,
      category: listingIsRoommateSearch ? "shared_room" : listingForm.category,
      accommodates: listingRoommateHasPlace || !listingIsRoommateSearch ? listingForm.accommodates.trim() : "",
      roommateCount: (listingHasPropertyDetails || listingIsRoommateSearch) ? listingForm.roommateCount.trim() : "",
      commutePreference: listingHasPropertyDetails ? "" : listingForm.commutePreference.trim(),
      deposit: listingHasPropertyDetails ? listingForm.deposit.trim() : "",
      daysAvailable: listingHasPropertyDetails ? listingForm.daysAvailable.trim() : "",
      amenities: listingForm.amenities.trim(),
      aboutYou: listingForm.aboutYou.trim(),
      furnished: listingHasPropertyDetails ? listingForm.furnished : false,
      privateBath: listingHasPropertyDetails ? listingForm.privateBath : false,
      parking: listingHasPropertyDetails ? listingForm.parking : false,
      utilitiesIncluded: listingHasPropertyDetails ? listingForm.utilitiesIncluded : false,
      socialFacebook: listingForm.socialFacebook.trim(),
      socialX: listingForm.socialX.trim(),
      socialInstagram: listingForm.socialInstagram.trim(),
      socialYoutube: listingForm.socialYoutube.trim(),
      contactName: listingForm.contactName.trim(),
      contactEmail: listingForm.contactEmail.trim(),
      contactPhone: listingForm.contactPhone.trim(),
      images: listingIsNeedPlace ? [] : listingForm.images
    };
    try {
      const payload = await createMobileHousingPost(listingPayload);
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
      setHousingListingSuccess(payload.post);
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

  function renderListingIntentChoices() {
    return (
      <View style={styles.listingIntentList}>
        {listingIntentChoices.map(({ value, title, description }) => (
          <TouchableOpacity
            key={value}
            style={[styles.listingIntentCard, listingIntent === value && styles.listingIntentCardActive]}
            onPress={() => updateListingIntent(value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: listingIntent === value }}
          >
            <View style={[styles.listingIntentRadio, listingIntent === value && styles.listingIntentRadioActive]}>
              {listingIntent === value ? <View style={styles.listingIntentRadioDot} /> : null}
            </View>
            <View style={styles.listingIntentCopy}>
              <Text style={[styles.listingIntentTitle, listingIntent === value && styles.listingIntentTitleActive]}>{title}</Text>
              <Text style={styles.listingIntentDescription}>{description}</Text>
            </View>
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

  function runPostLoginTasks(userId: number, recovery?: Promise<void>) {
    // Let the modal close and the authenticated screen paint before any key
    // recovery work. InteractionManager also prevents the transition itself
    // from competing with crypto and bootstrap network updates.
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        void load(false);
        void recovery?.catch(() => undefined);
      }, 250);
    });
  }

  function completeSocialLogin(user: BootstrapPayload["user"]) {
    if (!user) return;
    if (socialModalTimerRef.current) clearTimeout(socialModalTimerRef.current);
    socialModalTimerRef.current = null;
    pendingSocialContinuationRef.current = "";
    bootstrapGenerationRef.current += 1;
    setLoading(false);
    setData((current) => current ? { ...current, user, chat: { unreadCount: 0, conversations: [], messagedPostIds: [], messagedRideIds: [] } } : current);
    setSocialContinuation("");
    setSocialConsentAccepted(false);
    setSocialRecoveryEmailHint("");
    setShowSocialRecoveryEmail(false);
    setLoginOpen(false);
    setAuthMessage("");
    if (activeTab === "profile") setActiveTab("home");
    if (pendingListingAfterLogin) {
      setPendingListingAfterLogin(false);
      openListingFormForUser(user, selectedNeed || "need_place");
    }
    runPostLoginTasks(Number(user.id || 0));
  }

  function acceptSocialAuth(payload: MobileSocialAuthPayload) {
    if (payload.phoneRequired && payload.continuationToken) {
      // Social signup consent is collected only beside the required phone
      // number. Never inherit a checkbox previously used by manual signup.
      setSocialConsentAccepted(false);
      pendingSocialContinuationRef.current = payload.continuationToken;
      setSocialContinuation("");
      setSocialRecoveryEmailHint("");
      setShowSocialRecoveryEmail(false);
      setLoginOpen(false);
      setAuthMessage("");
      if (socialModalTimerRef.current) clearTimeout(socialModalTimerRef.current);
      // iOS must finish dismissing the provider/login modal before another
      // native Modal is presented, otherwise the UI can retain a frozen
      // invisible backdrop. Android benefits from the same deterministic handoff.
      socialModalTimerRef.current = setTimeout(() => {
        const continuation = pendingSocialContinuationRef.current;
        pendingSocialContinuationRef.current = "";
        if (continuation) setSocialContinuation(continuation);
        socialModalTimerRef.current = null;
      }, Platform.OS === "ios" ? 450 : 120);
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
      acceptSocialAuth(await withAuthTimeout(
        mobileSocialLogin(provider, identityToken, name, false),
        35000,
        `${provider === "google" ? "Google" : "Apple"} sign-in took too long. Please try again.`
      ));
    } catch (error) {
      if (provider === "google") handledGoogleResponseRef.current = "";
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
    if (Platform.OS === "android") {
      try {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const response = await GoogleSignin.signIn();
        if (!isSuccessResponse(response)) return;
        if (!response.data.idToken) {
          setAuthMessage("Google did not return a secure identity token. Please try again.");
          return;
        }
        await finishSocialProvider("google", response.data.idToken, response.data.user.name || "");
      } catch (error) {
        setAuthMessage(error instanceof Error ? error.message : "Google sign-in failed. Please try again.");
      }
      return;
    }
    await promptGoogleSignIn();
  }

  function withAuthTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }

  async function startAppleSignIn() {
    if (authBusy) return;
    setAuthMessage("");
    try {
      const credential = await withAuthTimeout(
        AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL
          ]
        }),
        60000,
        "Sign in with Apple did not respond. Please close the sheet and try again."
      );
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
    if (!socialConsentAccepted) {
      setAuthMessage("Agree to the Terms, Community Guidelines, and acknowledge the Privacy Policy to continue.");
      return;
    }
    const nationalPhone = signupPhone.replace(/\D/g, "").replace(/^0+/, "");
    const e164Phone = `${signupCallingCode}${nationalPhone}`;
    if (!/^\+[1-9]\d{7,14}$/.test(e164Phone)) {
      setAuthMessage("Choose your country code and enter a valid mobile number.");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("Saving phone number...");
    try {
      const payload = await completeSocialPhone(socialContinuation, nationalPhone, signupCallingCode, socialConsentAccepted);
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
      // Start recovery before mounting authenticated Chitthi. Messenger waits
      // on this promise and cannot create a competing temporary device key.
      // Registration is a background readiness task, not part of the login
      // transition. The delay is especially important in Expo Go, where the
      // native PBKDF worker is intentionally unavailable.
      const chatRecovery = beginChatIdentityRecovery(Number(payload.user?.id || 0), authenticatedPassword, 1_500);
      bootstrapGenerationRef.current += 1;
      setLoading(false);
      setData((current) => current ? { ...current, user: payload.user, chat: { unreadCount: 0, conversations: [], messagedPostIds: [], messagedRideIds: [] } } : current);
      setAuthMessage("Login successful.");
      setLoginOpen(false);
      setIdentifier("");
      setPassword("");
      if (activeTab === "profile") setActiveTab("home");
      if (pendingListingAfterLogin) {
        setPendingListingAfterLogin(false);
        openListingFormForUser(payload.user, selectedNeed || "need_place");
      }
      // Authentication is complete at this point. Refreshing the dashboard and
      // preparing Chitthi encryption must not keep the login modal blocked.
      runPostLoginTasks(Number(payload.user?.id || 0), chatRecovery);
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
    if (!signupConsentAccepted) {
      setAuthMessage("You must agree to the Terms of Service and Community Guidelines and acknowledge the Privacy Policy.");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("Creating account...");
    try {
      const payload = await mobileSignup(cleanName, cleanEmail, nationalPhone, password, signupCallingCode, signupConsentAccepted);
      const authenticatedPassword = password;
      setAuthMessage(payload.message || "Account created. Please activate your account from email before logging in.");
      setSignupName("");
      setSignupPhone("");
      setIdentifier("");
      setPassword("");
      setSignupConsentAccepted(false);
      if (!payload.activationRequired && payload.token) {
        const chatRecovery = beginChatIdentityRecovery(Number(payload.user?.id || 0), authenticatedPassword, 1_500);
        if (payload.user) {
          bootstrapGenerationRef.current += 1;
          setLoading(false);
          setData((current) => current ? { ...current, user: payload.user || null, chat: { unreadCount: 0, conversations: [], messagedPostIds: [], messagedRideIds: [] } } : current);
        }
        setLoginOpen(false);
        if (activeTab === "profile") setActiveTab("home");
        if (pendingListingAfterLogin) {
          setPendingListingAfterLogin(false);
          openListingFormForUser(payload.user || data?.user || null, selectedNeed || "need_place");
        }
        runPostLoginTasks(Number(payload.user?.id || 0), chatRecovery);
      }
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Signup failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logoutProfile() {
    if (authBusy) return;
    setAuthBusy(true);
    // Cancel all account-scoped crypto/network work before the global auth
    // token can be cleared or replaced by another account.
    invalidateChatIdentityRecovery();
    bootstrapGenerationRef.current += 1;
    setLoading(false);
    // Reset account-scoped UI immediately. Network cleanup must not leave the
    // old Profile screen mounted or permit a second login while logout can
    // still clear the token.
    setData((current) => (current ? { ...current, user: null, chat: { unreadCount: 0, conversations: [], messagedPostIds: [], messagedRideIds: [] } } : current));
    setPendingPost(null);
    setPendingRide(null);
    setBottomTabsHidden(false);
    setActiveTab("home");
    try {
      await unregisterNotificationsForLogout();
      await mobileLogout();
      void load(false);
    } catch (error) {
      Alert.alert("Logout failed", error instanceof Error ? error.message : "Could not log out.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function continueProfileCompletion() {
    const user = data?.user;
    if (!user) return;
    let nextUser = user;
    if (user.consentPending) {
      if (!profileConsentAccepted) {
        Alert.alert("FairFares policies", "Review and accept the Terms, Community Guidelines, and Privacy Policy to continue.");
        return;
      }
      if (profileConsentBusy) return;
      setProfileConsentBusy(true);
      try {
        const payload = await acceptCurrentPolicies();
        if (payload.user) {
          nextUser = payload.user;
          updateLocalUser(payload.user);
        }
        setProfileConsentAccepted(false);
      } catch (error) {
        Alert.alert("Could not save acceptance", error instanceof Error ? error.message : "Please try again.");
        return;
      } finally {
        setProfileConsentBusy(false);
      }
    }
    setProfileCompletionOpen(false);
    const detailsMissing = !nextUser.profilePhotoUrl?.trim() || !nextUser.name?.trim() || !nextUser.email?.trim() || !nextUser.phone?.trim();
    if (detailsMissing) {
      setProfileCompletionEditRequested(true);
      setActiveTab("profile");
    }
  }

  function updateLocalUser(user: BootstrapPayload["user"]) {
    if (!user) return;
    const userId = Number(user.id || 0);
    const profilePhotoUrl = user.profilePhotoUrl || "";
    setData((current) => current ? {
      ...current,
      user,
      housing: current.housing.map((post) => Number(post.posterUserId || 0) === userId
        ? { ...post, posterName: user.name, photoUrl: profilePhotoUrl }
        : post),
      testimonials: current.testimonials.map((testimonial) => Number(testimonial.userId || 0) === userId
        ? { ...testimonial, name: user.name, photoUrl: profilePhotoUrl }
        : testimonial),
      chat: {
        ...current.chat,
        conversations: current.chat.conversations.map((conversation) => Number(conversation.otherUserId || 0) === userId
          ? { ...conversation, otherName: user.name, otherPhotoUrl: profilePhotoUrl }
          : conversation),
      },
    } : current);
    // Replace any projections not already present in the local bootstrap
    // payload (including newly published testimonials and paginated chats)
    // with one authoritative post-save refresh. Starting a new generation
    // also prevents an older in-flight bootstrap from restoring stale fields.
    void load(false);
  }

  function changeTab(tab: TabKey) {
    if (tab === "home" || tab === "housing") {
      setRideOwnerOpenToken(0);
      setRideOwnerReturnTab(null);
    }
    setActiveTab(tab);
  }

  const messengerScreen = (
    <MessengerScreen
      key={`messenger-${Number(data?.user?.id || 0)}`}
      data={data}
      preferredSuggestionCity={chitthiSuggestionCity}
      pendingPost={pendingPost}
      pendingRide={pendingRide}
      pendingGroupInvite={pendingGroupInvite}
      notificationConversationId={notificationConversationId}
      onRequireLogin={() => setLoginOpen(true)}
      onClearPendingPost={() => setPendingPost(null)}
      onClearPendingRide={() => setPendingRide(null)}
      onClearPendingGroupInvite={() => setPendingGroupInvite("")}
      onClearNotificationConversation={() => setNotificationConversationId("")}
      onThreadModeChange={(active) => {
        if (activeTab === "messenger") setBottomTabsHidden(active);
      }}
      onMediaTransferActiveChange={setMessengerMediaTransferActive}
      onUnreadCountChange={(unreadCount) => setData((current) => current ? {
        ...current,
        chat: { ...current.chat, unreadCount },
        dashboard: { ...current.dashboard, messages: unreadCount }
      } : current)}
      onCardMessageSent={markCardMessageSent}
    />
  );

  const selectedScreen = staffPickupOpen ? (
      <StaffPickupScreen onClose={() => setStaffPickupOpen(false)} />
    ) : activeTab === "messenger" ? (
      null
    ) : activeTab === "community" ? (
      <CommunityScreen
        user={data?.user || null}
        city={hasSearchedHousingLocation ? city : (discoveryLocation || data?.location.city || city)}
        onRequireLogin={() => setLoginOpen(true)}
        onOpenHousing={() => setActiveTab("housing")}
        onSearchHousing={() => {
          setActiveTab("housing");
          setSearchCity(city);
          setSearchArea(area);
          setSearchRadius(searchRadius);
          setSearchNeed(selectedNeed || "need_place");
          setSearchOpen(true);
        }}
        onOpenRides={() => {
          setSelectedNeed("ride_need");
          setCarpoolFocusKey((value) => value + 1);
          setActiveTab("housing");
        }}
        onOpenCommunity={(communityId) => {
          setPendingPost(null);
          setPendingRide(null);
          setPendingGroupInvite(`community:${communityId}`);
          setActiveTab("messenger");
        }}
        onBottomTabsHiddenChange={setBottomTabsHidden}
        initialPostId={linkedCommunityPostId}
        onInitialPostOpened={() => setLinkedCommunityPostId("")}
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
        onOpenServices={(bookingId = "") => {
          setRentalEditBookingId(bookingId);
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
        openProfileDetails={profileCompletionEditRequested}
        onProfileDetailsOpened={() => setProfileCompletionEditRequested(false)}
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
        onOpenRide={(target = "workspace", rideId = "") => {
          setRideOwnerOpenTarget(target);
          setRideOwnerEditId(rideId);
          setRideOwnerReturnTab("profile");
          setSelectedNeed("ride_offer");
          setActiveTab("housing");
          setRideOwnerOpenToken((value) => value + 1);
        }}
        onOpenServices={(bookingId = "") => {
          setRentalEditBookingId(bookingId);
          setSelectedService("cars");
          setActiveTab("services");
        }}
        onOpenMessenger={() => setActiveTab("messenger")}
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
        editBookingId={rentalEditBookingId}
        onEditBookingOpened={() => setRentalEditBookingId("")}
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
        sentPostIds={sentCardOwnerUserId === Number(data?.user?.id || 0) ? sentCardPostIds : []}
        sentRideIds={sentCardOwnerUserId === Number(data?.user?.id || 0) ? sentCardRideIds : []}
        onSendPostMessage={sendPostMessageInline}
        onOpenPostConversation={(post) => void openPostConversation(post)}
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
        hasExactLocationSearch={hasSearchedHousingLocation}
        discoveryLocation={discoveryLocation}
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
        carpoolFocusKey={carpoolFocusKey}
        rideOwnerOpenToken={rideOwnerOpenToken}
        rideOwnerOpenTarget={rideOwnerOpenTarget}
        rideOwnerEditId={rideOwnerEditId}
        linkedHousingPost={linkedHousingPost}
        linkedCarpoolRide={linkedCarpoolRide}
        onLinkedHousingPostOpened={() => setLinkedHousingPost(null)}
        onLinkedCarpoolRideOpened={() => setLinkedCarpoolRide(null)}
        onRideOwnerClosed={() => {
          if (rideOwnerReturnTab) setActiveTab(rideOwnerReturnTab);
          setRideOwnerOpenToken(0);
          setRideOwnerEditId("");
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
        sentPostIds={sentCardOwnerUserId === Number(data?.user?.id || 0) ? sentCardPostIds : []}
        sentRideIds={sentCardOwnerUserId === Number(data?.user?.id || 0) ? sentCardRideIds : []}
        onSendPostMessage={sendPostMessageInline}
        onOpenPostConversation={(post) => void openPostConversation(post)}
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
        hasExactLocationSearch={hasSearchedHousingLocation}
        discoveryLocation={discoveryLocation}
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
        carpoolFocusKey={carpoolFocusKey}
        rideOwnerOpenToken={rideOwnerOpenToken}
        rideOwnerOpenTarget={rideOwnerOpenTarget}
        rideOwnerEditId={rideOwnerEditId}
        linkedHousingPost={linkedHousingPost}
        linkedCarpoolRide={linkedCarpoolRide}
        onLinkedHousingPostOpened={() => setLinkedHousingPost(null)}
        onLinkedCarpoolRideOpened={() => setLinkedCarpoolRide(null)}
        onRideOwnerClosed={() => {
          if (rideOwnerReturnTab) setActiveTab(rideOwnerReturnTab);
          setRideOwnerOpenToken(0);
          setRideOwnerEditId("");
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
      <React.Profiler
        id={`screen-${activeTab}`}
        onRender={(id, phase, actualDuration, baseDuration) => {
          if (actualDuration >= 50) logDevelopmentPerformance("slow-react-commit", {
            screen: id,
            phase,
            actualMs: Math.round(actualDuration),
            baseMs: Math.round(baseDuration),
          }, actualDuration >= 250);
        }}
      >
        {activeTab === "messenger" ? null : selectedScreen}
        {(activeTab === "messenger" || messengerMediaTransferActive) ? (
          <View key="retained-messenger" style={activeTab === "messenger" ? styles.retainedMessengerVisible : styles.retainedMessengerHidden}>
            {messengerScreen}
          </View>
        ) : null}
      </React.Profiler>
    </React.Suspense>
  );

  return (
    <NearbyRelayProvider user={data?.user || null}>
    <SafeAreaView
      style={[styles.safe, activeTab === "messenger" && styles.chittiSafe]}
      edges={activeTab === "messenger" && bottomTabsHidden ? ["top", "right", "left"] : ["top", "right", "bottom", "left"]}
    >
      <StatusBar style="light" backgroundColor={activeTab === "messenger" ? "#052017" : theme.colors.bg} translucent={false} />
      <CriticalBrandAssetPreloader />
      <Animated.View style={[styles.appContent, { opacity: contentOpacity }]}>
        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator color={theme.colors.text} />
            <Text style={styles.loaderText}>Loading FairFares</Text>
          </View>
        ) : screen}
        <BottomTabs
          active={activeTab}
          unreadCount={data?.chat.unreadCount || 0}
          user={data?.user || null}
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
                <Text style={styles.authHint}>Saved securely with your country code. Your phone number is never displayed.</Text>
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
            {authMode === "signup" ? (
              <View style={styles.signupConsentRow}>
                <TouchableOpacity
                  style={[styles.signupConsentBox, signupConsentAccepted && styles.signupConsentBoxChecked]}
                  onPress={() => setSignupConsentAccepted((accepted) => !accepted)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: signupConsentAccepted }}
                  accessibilityLabel="Agree to Terms of Service and Community Guidelines and acknowledge Privacy Policy"
                >
                  <Text style={styles.signupConsentCheck}>{signupConsentAccepted ? "✓" : ""}</Text>
                </TouchableOpacity>
                <Text style={styles.signupConsentText}>
                  I agree to the <Text style={styles.signupConsentLink} onPress={() => void Linking.openURL("https://www.fairfare.space/terms")}>Terms of Service</Text> and <Text style={styles.signupConsentLink} onPress={() => void Linking.openURL("https://www.fairfare.space/community-guidelines")}>Community Guidelines</Text> and acknowledge the <Text style={styles.signupConsentLink} onPress={() => void Linking.openURL("https://www.fairfare.space/privacy")}>Privacy Policy</Text>.
                </Text>
              </View>
            ) : null}
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
          if (socialModalTimerRef.current) clearTimeout(socialModalTimerRef.current);
          socialModalTimerRef.current = null;
          pendingSocialContinuationRef.current = "";
          setSocialContinuation("");
          setSocialConsentAccepted(false);
          setSocialRecoveryEmailHint("");
          setShowSocialRecoveryEmail(false);
          setAuthMessage("");
        }}
      >
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView
            style={styles.authModalScroll}
            contentContainerStyle={styles.socialPhoneCard}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
          >
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
            <View style={styles.signupConsentRow}>
              <TouchableOpacity
                style={[styles.signupConsentBox, socialConsentAccepted && styles.signupConsentBoxChecked]}
                onPress={() => setSocialConsentAccepted((accepted) => !accepted)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: socialConsentAccepted }}
                accessibilityLabel="Agree to Terms of Service and Community Guidelines and acknowledge Privacy Policy"
              >
                <Text style={styles.signupConsentCheck}>{socialConsentAccepted ? "✓" : ""}</Text>
              </TouchableOpacity>
              <Text style={styles.signupConsentText}>
                I agree to the <Text style={styles.signupConsentLink} onPress={() => void Linking.openURL("https://www.fairfare.space/terms")}>Terms of Service</Text> and <Text style={styles.signupConsentLink} onPress={() => void Linking.openURL("https://www.fairfare.space/community-guidelines")}>Community Guidelines</Text> and acknowledge the <Text style={styles.signupConsentLink} onPress={() => void Linking.openURL("https://www.fairfare.space/privacy")}>Privacy Policy</Text>.
              </Text>
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
                if (socialModalTimerRef.current) clearTimeout(socialModalTimerRef.current);
                socialModalTimerRef.current = null;
                pendingSocialContinuationRef.current = "";
                setSocialContinuation("");
                setSocialConsentAccepted(false);
                setSocialRecoveryEmailHint("");
                setShowSocialRecoveryEmail(false);
                setAuthMessage("");
                setLoginOpen(true);
              }}
            >
              <Text style={styles.secondaryButtonText}>Cancel and return to login</Text>
            </TouchableOpacity>
          </ScrollView>
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
      <Modal visible={profileCompletionOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setProfileCompletionOpen(false)}>
        <View style={styles.profileCompletionBackdrop}>
          <View style={styles.profileCompletionCard} accessibilityRole="alert">
            <View style={styles.profileCompletionAvatar}>
              <UserAvatar
                photoUrl={data?.user?.profilePhotoUrl}
                imageStyle={styles.profileCompletionAvatarImage}
                fallback={<Text style={styles.profileCompletionAvatarText}>{(data?.user?.name || "F").trim().charAt(0).toUpperCase()}</Text>}
              />
            </View>
            <Text style={styles.profileCompletionEyebrow}>Your FairFares profile</Text>
            <Text style={styles.profileCompletionTitle}>Complete your profile</Text>
            <Text style={styles.profileCompletionCopy}>Add the missing details so members can recognize and trust who they are connecting with.</Text>
            <View style={styles.profileCompletionMissingRow}>
              {!data?.user?.profilePhotoUrl?.trim() ? <Text style={styles.profileCompletionChip}>Profile photo</Text> : null}
              {!data?.user?.name?.trim() ? <Text style={styles.profileCompletionChip}>Full name</Text> : null}
              {!data?.user?.email?.trim() ? <Text style={styles.profileCompletionChip}>Email</Text> : null}
              {!data?.user?.phone?.trim() ? <Text style={styles.profileCompletionChip}>Phone number</Text> : null}
              {data?.user?.consentPending ? <Text style={styles.profileCompletionChip}>Policy acceptance</Text> : null}
            </View>
            {data?.user?.consentPending ? (
              <View style={styles.signupConsentRow}>
                <TouchableOpacity
                  style={[styles.signupConsentBox, profileConsentAccepted && styles.signupConsentBoxChecked]}
                  onPress={() => setProfileConsentAccepted((accepted) => !accepted)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: profileConsentAccepted }}
                  accessibilityLabel="Accept current FairFares policies"
                >
                  <Text style={styles.signupConsentCheck}>{profileConsentAccepted ? "✓" : ""}</Text>
                </TouchableOpacity>
                <Text style={styles.signupConsentText}>
                  I agree to the <Text style={styles.signupConsentLink} onPress={() => void Linking.openURL("https://www.fairfare.space/terms")}>Terms of Service</Text> and <Text style={styles.signupConsentLink} onPress={() => void Linking.openURL("https://www.fairfare.space/community-guidelines")}>Community Guidelines</Text> and acknowledge the <Text style={styles.signupConsentLink} onPress={() => void Linking.openURL("https://www.fairfare.space/privacy")}>Privacy Policy</Text>.
                </Text>
              </View>
            ) : null}
            <TouchableOpacity style={[styles.profileCompletionPrimary, profileConsentBusy && styles.disabledButton]} disabled={profileConsentBusy} onPress={() => void continueProfileCompletion()}>
              <Text style={styles.profileCompletionPrimaryText}>{profileConsentBusy ? "Saving..." : "Complete profile"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.profileCompletionLater} onPress={() => setProfileCompletionOpen(false)}>
              <Text style={styles.profileCompletionLaterText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={reviewPromptOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => void dismissReviewPrompt()}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalCard, styles.reviewPromptCard]}>
            <View style={styles.reviewPromptHeader}>
              <View style={styles.reviewPromptAvatar}>
                <UserAvatar photoUrl={reviewPromptContext?.photoUrl} imageStyle={styles.reviewPromptAvatarImage} fallback={<Text style={styles.reviewPromptAvatarText}>{(reviewPromptContext?.name || "F").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</Text>} />
              </View>
              <View style={styles.reviewPromptHeaderCopy}>
                <Text style={styles.reviewPromptEyebrow}>Quick check</Text>
                <Text style={styles.reviewPromptPerson} numberOfLines={1}>{reviewPromptContext?.name || "FairFares member"}</Text>
                <Text style={styles.reviewPromptListing} numberOfLines={1}>{reviewPromptContext?.listingTitle || "Marketplace listing"}</Text>
              </View>
            </View>
            <Text style={styles.reviewPromptTitle}>How did messaging feel?</Text>
            <Text style={styles.reviewPromptCopy}>Rate your Chitthi experience from this listing.</Text>
            <View style={styles.reviewPromptStars}>
              {[1, 2, 3, 4, 5].map((rating) => (
                <TouchableOpacity key={rating} style={styles.reviewPromptStarButton} onPress={() => setReviewPromptRating(rating)} accessibilityLabel={`${rating} stars`}>
                  <Text style={[styles.reviewPromptStar, rating <= reviewPromptRating && styles.reviewPromptStarActive]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={reviewPromptText}
              onChangeText={(text) => setReviewPromptText(text.slice(0, 300))}
              placeholder="Optional: what should we improve?"
              placeholderTextColor={theme.colors.muted}
              style={styles.reviewPromptInput}
              multiline
              maxLength={300}
              textAlignVertical="top"
            />
            <View style={styles.reviewPromptActions}>
              <TouchableOpacity style={[styles.reviewPromptSubmit, (!reviewPromptRating || reviewPromptBusy) && styles.disabledButton]} disabled={!reviewPromptRating || reviewPromptBusy} onPress={() => void submitReviewPrompt()}>
                <Text style={styles.primaryButtonText}>{reviewPromptBusy ? "Sending…" : "Send feedback"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.reviewPromptDismiss} onPress={() => void dismissReviewPrompt()} disabled={reviewPromptBusy}>
                <Text style={styles.reviewPromptDismissText}>Not now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={Boolean(housingListingSuccess)}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => setHousingListingSuccess(null)}
      >
        <View style={styles.listingSuccessBackdrop}>
          <View style={styles.listingSuccessCard} accessibilityRole="alert">
            <View style={styles.listingSuccessIcon}><Text style={styles.listingSuccessCheck}>✓</Text></View>
            <Text style={styles.listingSuccessEyebrow}>Successfully posted</Text>
            <Text style={styles.listingSuccessTitle}>
              {housingListingSuccess?.roommateIntent
                ? "Your roommate request is live"
                : housingListingSuccess?.mode === "HAVE_PLACE"
                  ? "Your place is now listed"
                  : "Your housing request is live"}
            </Text>
            <Text style={styles.listingSuccessLocation} numberOfLines={2}>
              {housingListingSuccess?.area || housingListingSuccess?.location || city}
            </Text>
            <View style={styles.listingSuccessFacts}>
              <Text style={styles.listingSuccessFact}>{housingListingSuccess?.categoryLabel || "Housing"}</Text>
              {housingListingSuccess?.rent ? <Text style={styles.listingSuccessFact}>{housingListingSuccess.rent}</Text> : null}
              <Text style={styles.listingSuccessFact}>{housingListingSuccess?.expiryLabel || "30 days live"}</Text>
            </View>
            <Text style={styles.listingSuccessCopy}>
              Your post is visible to matching FairFares members. Replies will arrive in Chitthi, and you can edit the current post from Activity.
            </Text>
            <TouchableOpacity
              style={styles.listingSuccessShare}
              onPress={() => housingListingSuccess && void shareHousingListing(housingListingSuccess)}
              accessibilityRole="button"
              accessibilityLabel="Share housing listing"
            >
              <Text style={styles.listingSuccessShareText}>↗ Share listing</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.listingSuccessPrimary}
              onPress={() => {
                setHousingListingSuccess(null);
                setActiveTab("activity");
              }}
            >
              <Text style={styles.listingSuccessPrimaryText}>View my listing</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.listingSuccessSecondary} onPress={() => setHousingListingSuccess(null)}>
              <Text style={styles.listingSuccessSecondaryText}>Done</Text>
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
              <Text style={styles.modalTitle}>
                {listingIsHavePlace ? "List your place" : listingIsRoommateSearch ? "Find roommates" : "Find a place"}
              </Text>
            </View>
            <Text style={styles.modalCopy}>
              {listingIsHavePlace
                ? "Post the room or property details people need before they message you."
                : listingIsRoommateSearch
                  ? listingRoommateHasPlace
                    ? "Post your place and the roommate details people need before they message you."
                    : roommatePlaceChoice === false
                      ? "Share where you want to live, your budget, and the kind of roommates you are looking for."
                      : "First choose whether you already have a place or want to search together."
                  : "Share your preferred area, budget, move-in timing, and room requirements."}
            </Text>
            <Text style={styles.requiredLegend}>* Required to publish</Text>
            {renderFormSection(
              "Post type *",
              <>
                {renderListingIntentChoices()}
                {listingIsRoommateSearch ? (
                  <View style={styles.roommatePathBlock}>
                    <Text style={styles.roommatePathQuestion}>Do you already have the place? *</Text>
                    <View style={styles.choiceRow}>
                      <TouchableOpacity
                        style={[styles.choicePill, styles.roommatePathChoice, roommatePlaceChoice === true && styles.choicePillActive]}
                        onPress={() => updateRoommatePlaceStatus(true)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: roommatePlaceChoice === true }}
                      >
                        <Text style={[styles.choiceText, roommatePlaceChoice === true && styles.choiceTextActive]}>Yes, fill my place</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.choicePill, styles.roommatePathChoice, roommatePlaceChoice === false && styles.choicePillActive]}
                        onPress={() => updateRoommatePlaceStatus(false)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: roommatePlaceChoice === false }}
                      >
                        <Text style={[styles.choiceText, roommatePlaceChoice === false && styles.choiceTextActive]}>No, search together</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
                {!listingIsRoommateSearch ? renderChoiceGroup("category", listingCategories) : null}
              </>
            )}
            {renderFormSection(
              "Location *",
              <>
                <TextInput value={listingForm.city} onChangeText={(text) => updateListingLocationField("city", text)} placeholder="City* eg Denver, CO" placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.zipCode} onChangeText={(text) => updateListingForm("zipCode", text)} placeholder="Zip code*" placeholderTextColor={theme.colors.muted} style={styles.input} keyboardType="number-pad" />
                {listingHasPropertyDetails ? (
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
                    <TextInput value={listingForm.primaryNeighborhood} onChangeText={(text) => updateListingForm("primaryNeighborhood", text)} placeholder="Neighborhood / locality* eg Capitol Hill" placeholderTextColor={theme.colors.muted} style={styles.input} />
                    <TextInput value={listingForm.apartmentName} onChangeText={(text) => updateListingForm("apartmentName", text)} placeholder="Apartment / building name" placeholderTextColor={theme.colors.muted} style={styles.input} />
                  </>
                ) : (
                  <>
                    <TextInput value={listingForm.area} onChangeText={(text) => updateListingLocationField("area", text)} placeholder={listingIsRoommateSearch ? "Preferred area, campus, building, or landmark*" : "Area, campus, building, or landmark*"} placeholderTextColor={theme.colors.muted} style={[styles.input, listingAddressValidated && styles.validatedInput]} autoCorrect={false} />
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
                    <TextInput value={listingForm.workSchoolLocation} onChangeText={(text) => updateListingForm("workSchoolLocation", text)} placeholder="Work / school / commute target optional" placeholderTextColor={theme.colors.muted} style={styles.input} />
                  </>
                )}
              </>
            )}
            {renderFormSection(
              `${listingHasPropertyDetails ? "Place details" : listingIsRoommateSearch ? "Roommate search" : "Room requirements"} *`,
              <>
                <TextInput value={listingForm.title} onChangeText={(text) => updateListingForm("title", text)} placeholder={listingHasPropertyDetails ? "Listing title*" : listingIsRoommateSearch ? "Roommate search title*" : "Request title*"} placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.description} onChangeText={(text) => updateListingForm("description", text)} placeholder={listingHasPropertyDetails ? "Describe the room, property, rules, and who it fits*" : listingIsRoommateSearch ? "Describe your roommate plan, lifestyle, and timing*" : "Describe what kind of place you need*"} placeholderTextColor={theme.colors.muted} style={[styles.input, styles.textArea]} multiline />
                <DateTimeField label={listingHasPropertyDetails ? "Available from*" : "Move-in from*"} value={listingForm.moveInDate} mode="date" minimumDate={todayLocalIso()} onChange={(value) => updateListingForm("moveInDate", value)} />
                <View style={styles.twoCol}>
                  <TextInput value={listingForm.rentMin} onChangeText={(text) => updateListingForm("rentMin", text)} placeholder={listingHasPropertyDetails ? "Rent*" : "Budget min*"} placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                  <TextInput value={listingForm.rentMax} onChangeText={(text) => updateListingForm("rentMax", text)} placeholder={listingHasPropertyDetails ? "Rent max" : "Budget max"} placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                </View>
                {renderChoiceGroup("rentPeriod", rentPeriods)}
                {listingIsRoommateSearch && !listingRoommateHasPlace ? (
                  <TextInput value={listingForm.roommateCount} onChangeText={(text) => updateListingForm("roommateCount", text)} placeholder="Roommates needed*" placeholderTextColor={theme.colors.muted} style={styles.input} keyboardType="number-pad" />
                ) : listingIsNeedPlace ? (
                  <TextInput value={listingForm.accommodates} onChangeText={(text) => updateListingForm("accommodates", text)} placeholder="People moving*" placeholderTextColor={theme.colors.muted} style={styles.input} keyboardType="number-pad" />
                ) : (
                  <View style={styles.twoCol}>
                    <TextInput value={listingForm.accommodates} onChangeText={(text) => updateListingForm("accommodates", text)} placeholder="Accommodates*" placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                    <TextInput value={listingForm.roommateCount} onChangeText={(text) => updateListingForm("roommateCount", text)} placeholder={listingRoommateHasPlace ? "Roommates needed*" : "Current roommates"} placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                  </View>
                )}
                {renderChoiceGroup("bathroomType", bathroomOptions)}
                {renderChoiceGroup("genderPreference", genderOptions)}
                {renderChoiceGroup("leaseTerm", leaseOptions)}
                {!listingHasPropertyDetails ? <TextInput value={listingForm.commutePreference} onChangeText={(text) => updateListingForm("commutePreference", text)} placeholder="Commute preference / transit notes optional" placeholderTextColor={theme.colors.muted} style={styles.input} /> : null}
                {listingHasPropertyDetails ? (
                  <>
                    <TextInput value={listingForm.daysAvailable} onChangeText={(text) => updateListingForm("daysAvailable", text)} placeholder="Showing days / availability optional" placeholderTextColor={theme.colors.muted} style={styles.input} />
                    <TextInput value={listingForm.deposit} onChangeText={(text) => updateListingForm("deposit", text)} placeholder="Deposit optional" placeholderTextColor={theme.colors.muted} style={styles.input} keyboardType="number-pad" />
                  </>
                ) : null}
              </>
            )}
            {listingIsNeedPlace ? renderFormSection(
              "Need a place",
              <Text style={styles.photoHelp}>
                No photos needed here. Add clear details about your preferred area, budget, move-in date, people moving, lease length, and must-have amenities so owners can reply quickly.
              </Text>
            ) : renderFormSection(
              listingHasPropertyDetails ? "Photos *" : "Photos",
              <>
                <Text style={styles.photoHelp}>
                  {listingHasPropertyDetails
                    ? "Upload at least 1 valid room/property image. Add up to 4 clear photos. Note: upload a valid image; otherwise the listing may be rejected."
                    : "Photos are optional for roommate posts. Note: if you upload one, use a valid image; otherwise the listing may be rejected."}
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
              listingHasPropertyDetails ? "Amenities and house preferences" : "Preferences",
              <>
                {listingHasPropertyDetails ? (
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
                ) : null}
                <TextInput value={listingForm.amenities} onChangeText={(text) => updateListingForm("amenities", text)} placeholder={listingHasPropertyDetails ? "Amenities, eg WiFi, gym, laundry, parking" : "Desired amenities optional, eg laundry, parking, near bus"} placeholderTextColor={theme.colors.muted} style={styles.input} />
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
                <TextInput value={listingForm.aboutYou} onChangeText={(text) => updateListingForm("aboutYou", text)} placeholder={listingHasPropertyDetails ? "House rules / ideal tenant or roommate" : "About you / ideal roommates"} placeholderTextColor={theme.colors.muted} style={[styles.input, styles.textAreaSmall]} multiline />
              </>
            )}
            {renderFormSection(
              "Contact * and socials",
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
              <View style={styles.searchInputWrap}>
                <TextInput
                  value={searchCity}
                  onChangeText={(value) => { selectedCitySuggestionRef.current = ""; setSearchCity(value); setSearchCitySuggestions([]); }}
                  placeholder="City or metro"
                  placeholderTextColor={theme.colors.muted}
                  style={[styles.input, styles.searchInputWithClear]}
                />
                {searchCity ? (
                  <TouchableOpacity
                    style={styles.searchInputClear}
                    onPress={() => { selectedCitySuggestionRef.current = ""; setSearchCity(""); setSearchCitySuggestions([]); }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear city search"
                  >
                    <Text style={styles.searchInputClearText}>×</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
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
                  placeholder="Area or landmark"
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
                <TouchableOpacity style={[styles.primaryButton, styles.searchPrimaryButton]} onPress={() => runSearch()}>
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
  retainedMessengerVisible: { flex: 1 },
  retainedMessengerHidden: { display: "none" },
  lazyScreenFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.bg,
  },
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  chittiSafe: { backgroundColor: "#052017" },
  appContent: { flex: 1 },
  criticalAssetPreloader: { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", left: -10, top: -10 },
  criticalAssetImage: { width: 1, height: 1 },
  listingSuccessBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.78)", alignItems: "center", justifyContent: "center", paddingHorizontal: 22 },
  listingSuccessCard: { width: "100%", maxWidth: 420, borderRadius: 28, borderWidth: 1, borderColor: "rgba(34,197,94,0.48)", backgroundColor: "#171a18", paddingHorizontal: 22, paddingVertical: 26, alignItems: "center", gap: 12 },
  listingSuccessIcon: { width: 70, height: 70, borderRadius: 35, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(34,197,94,0.18)", borderWidth: 2, borderColor: theme.colors.green },
  listingSuccessCheck: { color: theme.colors.green, fontSize: 38, lineHeight: 43, fontWeight: "900" },
  listingSuccessEyebrow: { color: theme.colors.green, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.4, marginTop: 2 },
  listingSuccessTitle: { color: theme.colors.text, fontSize: 25, lineHeight: 31, fontWeight: "900", textAlign: "center" },
  listingSuccessLocation: { color: theme.colors.soft, fontSize: 16, lineHeight: 22, fontWeight: "800", textAlign: "center" },
  listingSuccessFacts: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 7 },
  listingSuccessFact: { color: theme.colors.text, fontSize: 12, fontWeight: "900", overflow: "hidden", borderRadius: theme.radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 10, paddingVertical: 6 },
  listingSuccessCopy: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, fontWeight: "700", textAlign: "center", marginVertical: 2 },
  listingSuccessShare: { width: "100%", minHeight: 50, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.blue, alignItems: "center", justifyContent: "center" },
  listingSuccessShareText: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  listingSuccessPrimary: { width: "100%", minHeight: 54, borderRadius: theme.radius.pill, backgroundColor: theme.colors.green, alignItems: "center", justifyContent: "center", marginTop: 3 },
  listingSuccessPrimaryText: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  listingSuccessSecondary: { minHeight: 44, paddingHorizontal: 24, alignItems: "center", justifyContent: "center" },
  listingSuccessSecondaryText: { color: theme.colors.soft, fontSize: 15, fontWeight: "900" },
  profileCompletionBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.82)", alignItems: "center", justifyContent: "center", paddingHorizontal: 22 },
  profileCompletionCard: { width: "100%", maxWidth: 410, borderRadius: 28, borderWidth: 1, borderColor: "rgba(94,196,122,0.42)", backgroundColor: theme.colors.panel, paddingHorizontal: 22, paddingVertical: 24, alignItems: "center", gap: 11 },
  profileCompletionAvatar: { width: 72, height: 72, borderRadius: 36, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#123c27", borderWidth: 2, borderColor: theme.colors.green },
  profileCompletionAvatarImage: { width: "100%", height: "100%" },
  profileCompletionAvatarText: { color: theme.colors.text, fontSize: 27, fontWeight: "900" },
  profileCompletionEyebrow: { color: theme.colors.green, fontSize: 11, lineHeight: 15, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.2, marginTop: 3 },
  profileCompletionTitle: { color: theme.colors.text, fontSize: 25, lineHeight: 31, fontWeight: "900", textAlign: "center" },
  profileCompletionCopy: { color: theme.colors.muted, fontSize: 14, lineHeight: 20, fontWeight: "700", textAlign: "center" },
  profileCompletionMissingRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 7, marginVertical: 4 },
  profileCompletionChip: { color: theme.colors.soft, fontSize: 12, fontWeight: "800", overflow: "hidden", borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel2, paddingHorizontal: 10, paddingVertical: 6 },
  profileCompletionPrimary: { width: "100%", minHeight: 52, borderRadius: theme.radius.pill, backgroundColor: theme.colors.green, alignItems: "center", justifyContent: "center", marginTop: 3 },
  profileCompletionPrimaryText: { color: "#0c1a10", fontSize: 16, fontWeight: "900" },
  profileCompletionLater: { minHeight: 42, paddingHorizontal: 24, alignItems: "center", justifyContent: "center" },
  profileCompletionLaterText: { color: theme.colors.soft, fontSize: 14, fontWeight: "800" },
  reviewPromptCard: { width: "100%", maxWidth: 410, alignSelf: "center", padding: 20, gap: 16, borderRadius: 28 },
  reviewPromptHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  reviewPromptAvatar: { width: 56, height: 56, borderRadius: 28, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#123C27", borderWidth: 1.5, borderColor: "rgba(86,190,100,0.72)" },
  reviewPromptAvatarImage: { width: "100%", height: "100%" },
  reviewPromptAvatarText: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  reviewPromptHeaderCopy: { flex: 1, minWidth: 0, gap: 2 },
  reviewPromptEyebrow: { color: theme.colors.green, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.1 },
  reviewPromptPerson: { color: theme.colors.text, fontSize: 17, lineHeight: 22, fontWeight: "900" },
  reviewPromptListing: { color: theme.colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  reviewPromptTitle: { color: theme.colors.text, fontSize: 25, lineHeight: 31, fontWeight: "900" },
  reviewPromptCopy: { color: theme.colors.muted, fontSize: 14, lineHeight: 20, fontWeight: "700", marginTop: -8 },
  reviewPromptStars: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 1 },
  reviewPromptStarButton: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  reviewPromptStar: { color: "#4B4F55", fontSize: 38, lineHeight: 45 },
  reviewPromptStarActive: { color: "#F5B942" },
  reviewPromptInput: { width: "100%", minHeight: 100, maxHeight: 140, color: theme.colors.text, backgroundColor: theme.colors.panel2, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 13, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  reviewPromptActions: { width: "100%", gap: 5 },
  reviewPromptSubmit: { width: "100%", minHeight: 52, borderRadius: theme.radius.pill, backgroundColor: theme.colors.green, alignItems: "center", justifyContent: "center" },
  reviewPromptDismiss: { width: "100%", minHeight: 44, alignItems: "center", justifyContent: "center" },
  reviewPromptDismissText: { color: theme.colors.soft, fontSize: 15, fontWeight: "900" },
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
  signupConsentRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 4, paddingVertical: 4 },
  signupConsentBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: theme.colors.line, alignItems: "center", justifyContent: "center", marginTop: 1 },
  signupConsentBoxChecked: { backgroundColor: theme.colors.green, borderColor: theme.colors.green },
  signupConsentCheck: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  signupConsentText: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, flex: 1 },
  signupConsentLink: { color: theme.colors.green, fontWeight: "800", textDecorationLine: "underline" },
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
  searchInputWrap: { position: "relative", justifyContent: "center", borderRadius: theme.radius.md, shadowColor: theme.colors.blue, shadowOpacity: 0.07, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  searchInputWithClear: { paddingRight: 52, minHeight: 56, borderWidth: 1.25, borderColor: "rgba(79,124,255,0.42)", fontSize: 16, fontWeight: "700" },
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
  requiredLegend: { color: theme.colors.accent, fontSize: 12, lineHeight: 16, fontWeight: "800" },
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
  listingIntentList: { gap: 10 },
  listingIntentCard: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.md, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: theme.colors.panel2 },
  listingIntentCardActive: { borderColor: theme.colors.accent, backgroundColor: "rgba(215,174,94,0.10)" },
  listingIntentRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.colors.muted, alignItems: "center", justifyContent: "center" },
  listingIntentRadioActive: { borderColor: theme.colors.accent },
  listingIntentRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent },
  listingIntentCopy: { flex: 1, gap: 3 },
  listingIntentTitle: { color: theme.colors.text, fontSize: 15, lineHeight: 20, fontWeight: "900" },
  listingIntentTitleActive: { color: theme.colors.accent },
  listingIntentDescription: { color: theme.colors.muted, fontSize: 13, lineHeight: 18 },
  roommatePathBlock: { gap: 8, marginTop: 2, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.line },
  roommatePathQuestion: { color: theme.colors.soft, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  roommatePathChoice: { flex: 1, minWidth: 130 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choicePill: { minHeight: 42, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 9, alignItems: "center", justifyContent: "center" },
  choicePillActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  choiceText: { color: theme.colors.soft, fontWeight: "900", textAlign: "center" },
  choiceTextActive: { color: theme.colors.bg },
  primaryButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, alignItems: "center", paddingVertical: 13 },
  searchPrimaryButton: { backgroundColor: "rgba(79,124,255,0.68)", borderWidth: 1, borderColor: "rgba(143,174,255,0.34)" },
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
