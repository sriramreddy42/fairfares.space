import { BootstrapPayload, Car, ChatConversation, ChatGroupMember, ChatMessage, Community, HousingActivityPost, HousingPost, RentalBooking, RentalCarListingInput, RentalQuote, RentalSearchInput, RentalServiceBooking, RideDispatchSummary, RideDriverProfile, RideInput, RidePost, RideType, ServiceItem, StaffPickupBooking } from "../types";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { NativeModules, Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

declare const process: {
  env: {
    EXPO_PUBLIC_FAIRFARES_API_URL?: string;
  };
};

const API_PORT = "8010";

function metroHostApiUrl() {
  const scriptURL = String(NativeModules.SourceCode?.scriptURL || "");
  const match = scriptURL.match(/^[a-z]+:\/\/([^/:]+)(?::\d+)?/i);
  const host = match?.[1];
  if (!host || host === "localhost" || host === "127.0.0.1") {
    return "";
  }
  return `http://${host}:${API_PORT}`;
}

function browserLocalApiUrl() {
  const locationLike = (globalThis as unknown as { location?: { hostname?: string } }).location;
  const host = locationLike?.hostname || "";
  if (host === "localhost" || host === "127.0.0.1") {
    return `http://127.0.0.1:${API_PORT}`;
  }
  return "";
}

function uniqueUrls(urls: string[]) {
  return urls.filter((url, index) => url && urls.indexOf(url) === index);
}

function normalizeExplicitApiUrl(value: string | undefined) {
  const clean = (value || "").replace(/\/$/, "").trim();
  if (!clean || clean.includes("something.loca.lt")) {
    return "";
  }
  return clean;
}

const CONFIGURED_APP_API_URL = String(Constants.expoConfig?.extra?.apiUrl || "");
const EXPLICIT_API_URL = normalizeExplicitApiUrl(process.env.EXPO_PUBLIC_FAIRFARES_API_URL || CONFIGURED_APP_API_URL);
const WEB_LOCAL_API_URL = Platform.OS === "web" ? browserLocalApiUrl() : "";
const METRO_HOST_API_URL = metroHostApiUrl();
const DEFAULT_API_URL = EXPLICIT_API_URL || WEB_LOCAL_API_URL || METRO_HOST_API_URL || "http://127.0.0.1:8010";

export const API_URL =
  DEFAULT_API_URL;

const API_CANDIDATES = uniqueUrls(
  EXPLICIT_API_URL
    ? [EXPLICIT_API_URL]
    : Platform.OS === "web"
      ? [WEB_LOCAL_API_URL, "http://127.0.0.1:8010", METRO_HOST_API_URL]
      : [METRO_HOST_API_URL, "http://127.0.0.1:8010"]
);

const AUTH_TOKEN_STORAGE_KEY = "fairfares.mobile.authToken";
const API_REQUEST_TIMEOUT_MS = 10000;
const REMOTE_API_REQUEST_TIMEOUT_MS = 30000;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function browserStorage() {
  return (globalThis as unknown as {
    localStorage?: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
      removeItem: (key: string) => void;
    };
  }).localStorage;
}

let authToken = browserStorage()?.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
let activeApiBase = API_URL;

function diagnosticReference() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function reportApiDiagnostic(kind: "api_5xx" | "network_failure", message: string, requestId = "") {
  const referenceId = requestId || diagnosticReference();
  const cleanMessage = String(message || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .slice(0, 500);
  // If browser networking/CORS is already unavailable, a second request to
  // the same API can only create another console error. Keep the local
  // reference and let the original GET retry instead.
  if (Platform.OS === "web" && kind === "network_failure") return referenceId;
  void fetch(`${API_URL}/api/mobile/diagnostics`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      reference_id: referenceId,
      kind,
      message: cleanMessage,
      request_id: requestId,
      platform: Platform.OS,
      app_version: String(Constants.expoConfig?.version || "unknown"),
      build_version: String(Platform.OS === "ios" ? Constants.expoConfig?.ios?.buildNumber || "unknown" : Constants.expoConfig?.android?.versionCode || "unknown")
    })
  }).catch(() => undefined);
  return referenceId;
}

function currentApiBase() {
  return activeApiBase || API_URL;
}

export async function setAuthToken(token: string) {
  authToken = token;
  const storage = browserStorage();
  if (storage) {
    if (token) {
      storage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      storage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  }
  if (Platform.OS !== "web") {
    if (token) {
      await SecureStore.setItemAsync(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      await SecureStore.deleteItemAsync(AUTH_TOKEN_STORAGE_KEY);
    }
  }
}

export async function hydrateAuthToken() {
  if (authToken || Platform.OS === "web") return authToken;
  const storedToken = await SecureStore.getItemAsync(AUTH_TOKEN_STORAGE_KEY).catch(() => null);
  authToken = storedToken || "";
  return authToken;
}

export function isAuthenticationRejection(error: unknown) {
  const status = Number((error as Error & { fairFaresHttpStatus?: number })?.fairFaresHttpStatus || 0);
  // A 403 means the signed-in member is authenticated but is not allowed to
  // use a particular staff/owner feature. Clearing SecureStore for that case
  // made the whole app appear logged out after a restart. Only a 401 is an
  // authentication rejection.
  return status === 401;
}

export function hasAuthToken() {
  return Boolean(authToken);
}

export async function getStaffPickupBookings() {
  return request<{
    ok: boolean;
    pickups: StaffPickupBooking[];
    deposit: { configured: boolean; amount: number };
  }>("/api/mobile/admin/pickups");
}

export async function createSecurityDepositCheckout(bookingId: number) {
  return request<{
    ok: boolean;
    bookingId: number;
    url: string;
    amount: number;
  }>("/api/mobile/admin/security-deposit-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId })
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined)
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  let lastError = "";
  const isAttachmentUpload = path === "/api/chat/attachments";
  const candidateUrls = isAttachmentUpload ? uniqueUrls([activeApiBase, API_URL]) : API_CANDIDATES;
  for (const baseUrl of candidateUrls) {
    const method = String(init.method || "GET").toUpperCase();
    // Render deploys and upstream gateways may briefly return a proxy-generated
    // 502 without application CORS headers. Browsers surface that as a network
    // TypeError, so remote idempotent GETs need a slightly longer retry window.
    const attempts = method === "GET" ? (EXPLICIT_API_URL ? 4 : 2) : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutMs = isAttachmentUpload ? 45000 : EXPLICIT_API_URL ? REMOTE_API_REQUEST_TIMEOUT_MS : API_REQUEST_TIMEOUT_MS;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal });
        const text = await response.text();
        let payload: T & { error?: string; message?: string };
        try {
          payload = JSON.parse(text) as T & { error?: string; message?: string };
        } catch {
          throw new Error(`FairFares server at ${baseUrl} returned a non-JSON response.`);
        }
        if (!response.ok) {
          const httpError = new Error(payload.error || payload.message || `FairFares request failed: ${response.status}`);
          const requestId = response.headers.get("X-Request-ID") || "";
          const enrichedError = httpError as Error & { fairFaresHttpStatus?: number; fairFaresRequestId?: string; fairFaresPayload?: unknown };
          enrichedError.fairFaresHttpStatus = response.status;
          enrichedError.fairFaresRequestId = requestId;
          enrichedError.fairFaresPayload = payload;
          if ([502, 503, 504].includes(response.status) && attempt + 1 < attempts) {
            lastError = httpError.message;
            await wait([500, 1250, 2500][attempt] || 2500);
            continue;
          }
          if (response.status >= 500) {
            const referenceId = reportApiDiagnostic("api_5xx", `${method} ${path}: ${httpError.message}`, requestId);
            enrichedError.message = `FairFares is temporarily unavailable. Please try again. Reference: ${referenceId}`;
          }
          throw enrichedError;
        }
        activeApiBase = baseUrl;
        return payload;
      } catch (error) {
        const status = (error as Error & { fairFaresHttpStatus?: number }).fairFaresHttpStatus;
        if (status) throw error;
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt + 1 < attempts) await wait([500, 1250, 2500][attempt] || 2500);
      } finally {
        clearTimeout(timeout);
      }
    }
  }
  if (isAttachmentUpload) {
    throw new Error(`The attachment upload did not finish. Check your connection and try again. ${lastError}`.trim());
  }
  const referenceId = reportApiDiagnostic("network_failure", `${String(init.method || "GET").toUpperCase()} ${path}: ${lastError}`);
  if (EXPLICIT_API_URL) {
    throw new Error(`FairFares is temporarily unavailable. Check your internet connection and try again shortly. Reference: ${referenceId}`);
  }
  throw new Error(`Could not connect to the local FairFares API. Reference: ${referenceId}. Last error: ${lastError}. Start the backend with HOST=0.0.0.0 PORT=8010 python3 app.py, then restart Expo with --clear.`);
}

function fallbackBootstrap(city = "Denver, CO"): BootstrapPayload {
  return {
    ok: true,
    user: null,
    location: { city, selected: city, suggested: "Aurora, CO" },
    housing: [],
    communities: [],
    chat: { unreadCount: 0, conversations: [] },
    dashboard: { housingPosts: 0, messages: 0 },
    hasSubmittedHousingExperience: false,
    testimonials: []
  };
}

export function absoluteAssetUrl(value: string) {
  if (!value) return "";
  if (/^(https?:\/\/|data:image\/)/i.test(value)) return value;
  if (value.startsWith("local://uploads/")) {
    const uploadPath = value.replace("local://", "/");
    return `${currentApiBase()}${uploadPath}`;
  }
  return `${currentApiBase()}${value.startsWith("/") ? value : `/${value}`}`;
}

export function authenticatedAssetSource(value: string) {
  const uri = absoluteAssetUrl(value);
  return authToken ? { uri, headers: { Authorization: `Bearer ${authToken}` } } : { uri };
}

export async function getAuthenticatedAssetDataUrl(value: string) {
  const directUrl = absoluteAssetUrl(value);
  if (!directUrl || directUrl.startsWith("data:image/")) return directUrl;
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const response = await fetch(directUrl, { headers });
  if (!response.ok) throw new Error(`Could not load attachment: ${response.status}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not decode attachment."));
    reader.readAsDataURL(blob);
  });
}

export async function getAuthenticatedImagePreviewUri(value: string) {
  if (Platform.OS === "web") return getAuthenticatedAssetDataUrl(value);
  const directUrl = absoluteAssetUrl(value);
  if (!directUrl) throw new Error("Photo URL is missing.");
  if (directUrl.startsWith("data:image/") || directUrl.startsWith("file://")) return directUrl;
  const cacheRoot = FileSystem.cacheDirectory;
  if (!cacheRoot) throw new Error("Photo preview storage is unavailable.");
  const safeKey = value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(-80) || String(Date.now());
  const destination = `${cacheRoot}fchat-preview-${safeKey}.img`;
  const existing = await FileSystem.getInfoAsync(destination);
  if (existing.exists && Number(existing.size || 0) > 0) return destination;
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const result = await FileSystem.downloadAsync(directUrl, destination, { headers });
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
    throw new Error(`Could not load photo preview (${result.status}).`);
  }
  return result.uri;
}

export async function getBootstrap(city = "Denver, CO") {
  try {
    return await request<BootstrapPayload>(`/api/mobile/bootstrap?city=${encodeURIComponent(city)}`);
  } catch (error) {
    if (EXPLICIT_API_URL) throw error;
    return fallbackBootstrap(city);
  }
}

export async function getHousing(
  city: string,
  area: string,
  need: string,
  category = "",
  gender = "",
  budget = "",
  radius = "",
  coordinates: { lat?: number | null; lng?: number | null } = {},
  offset = 0
) {
  const query = new URLSearchParams({ city, area, need, category, gender, budget, radius, limit: "24", offset: String(Math.max(0, offset)) });
  addFiniteParam(query, "lat", coordinates.lat);
  addFiniteParam(query, "lng", coordinates.lng);
  const payload = await request<{ ok: boolean; posts: HousingPost[] }>(`/api/mobile/housing?${query}`);
  return payload.posts;
}

type RideSearchCoordinates = {
  originLat?: number | null;
  originLng?: number | null;
  destinationLat?: number | null;
  destinationLng?: number | null;
};

function addFiniteParam(params: URLSearchParams, key: string, value: number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    params.set(key, String(value));
  }
}

export async function getRides(city: string, origin = "", destination = "", rideType: RideType | "" = "", coordinates: RideSearchCoordinates = {}, offset = 0) {
  const params = new URLSearchParams({ city, origin, destination, limit: "30", offset: String(Math.max(0, offset)) });
  if (rideType) params.set("type", rideType);
  addFiniteParam(params, "originLat", coordinates.originLat);
  addFiniteParam(params, "originLng", coordinates.originLng);
  addFiniteParam(params, "destinationLat", coordinates.destinationLat);
  addFiniteParam(params, "destinationLng", coordinates.destinationLng);
  const payload = await request<{ ok: boolean; rides: RidePost[] }>(`/api/mobile/rides?${params.toString()}`);
  return payload.rides || [];
}

export async function getRideActivity() {
  const payload = await request<{ ok: boolean; rides: RidePost[] }>("/api/mobile/rides/activity");
  return payload.rides || [];
}

export type RidePlaceSuggestion = {
  label: string;
  main: string;
  secondary: string;
  distanceMiles: number | null;
  lat: number;
  lng: number;
  source: string;
};

export async function getRidePlaceSuggestions(city: string, query = "") {
  const params = new URLSearchParams({ city, q: query, limit: "12" });
  const payload = await request<{ ok: boolean; suggestions: RidePlaceSuggestion[] }>(`/api/mobile/ride-places?${params.toString()}`);
  return payload.suggestions || [];
}

export async function reverseGeocodeRideLocation(latitude: number, longitude: number) {
  const params = new URLSearchParams({ lat: String(latitude), lng: String(longitude) });
  const payload = await request<{ ok: boolean; label: string }>(`/api/mobile/reverse-geocode?${params.toString()}`);
  return payload.label || "";
}

export function rideMapUrl(
  city: string,
  origin: string,
  destination: string,
  overlay?: { riderOrigin?: string; riderDestination?: string }
) {
  const params = new URLSearchParams({ city, origin, destination, v: "google-static-20260723-detour" });
  if (overlay?.riderOrigin) params.set("riderOrigin", overlay.riderOrigin);
  if (overlay?.riderDestination) params.set("riderDestination", overlay.riderDestination);
  return `${currentApiBase()}/api/mobile/ride-map?${params.toString()}`;
}

export async function createMobileRide(input: RideInput) {
  const payload = await request<{ ok: boolean; ride: RidePost; dispatch?: RideDispatchSummary }>("/api/mobile/rides", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return { ride: payload.ride, dispatch: payload.dispatch };
}

export async function respondToRideDispatch(rideId: string, action: "ACCEPT" | "DECLINE" | "EN_ROUTE" | "ARRIVED" | "COMPLETED") {
  const payload = await request<{ ok: boolean; ride: RidePost }>("/api/mobile/rides/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rideId, action })
  });
  return payload.ride;
}

export async function updateRideDriverLocation(rideId: string, latitude: number, longitude: number) {
  return request<{ ok: boolean; location: { latitude: number; longitude: number; status: string } }>("/api/mobile/rides/driver-location", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rideId, latitude, longitude })
  });
}

export async function getRideDriverLocation(rideId: string) {
  return request<{ ok: boolean; available: boolean; status: string; location?: { latitude: number; longitude: number; updatedAt: string; ageSeconds: number } }>(`/api/mobile/rides/driver-location?rideId=${encodeURIComponent(rideId)}`);
}

export async function rateCompletedRide(rideId: string, score: number, comment = "") {
  return request<{ ok: boolean; score: number }>("/api/mobile/rides/rating", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rideId, score, comment })
  });
}

export async function getRideDriverProfile() {
  const payload = await request<{ ok: boolean; profile: RideDriverProfile }>("/api/mobile/rides/driver-profile");
  return payload.profile;
}

export async function saveRideDriverProfile(input: Partial<RideDriverProfile>) {
  const payload = await request<{ ok: boolean; profile: RideDriverProfile }>("/api/mobile/rides/driver-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return payload.profile;
}

export type AccommodationLocationLookup = {
  ok: boolean;
  metro: string;
  selectedLocation: string;
  rawLocation: string;
  suggestedLocation: string;
  lat: number;
  lng: number;
  source: string;
};

export type AccommodationLocationOptions = {
  ok: boolean;
  metro: string;
  selectedLocation: string;
  cities: string[];
  suggested: string[];
  zips: string[];
  source: string;
};

export async function lookupAccommodationLocation(query: string) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return null;
  try {
    return await request<AccommodationLocationLookup>(`/api/accommodations/locations?q=${encodeURIComponent(cleanQuery)}`);
  } catch {
    return null;
  }
}

export async function getAccommodationLocationOptions(city: string, area = "") {
  const cleanCity = city.trim();
  const cleanArea = area.trim();
  if (!cleanCity) return null;
  try {
    const params = new URLSearchParams({ city: cleanCity });
    if (cleanArea) params.set("area", cleanArea);
    return await request<AccommodationLocationOptions>(`/api/mobile/location-options?${params.toString()}`);
  } catch {
    return null;
  }
}

export async function getCars(location = "", category = "") {
  const params = new URLSearchParams();
  if (location) params.set("location", location);
  if (category) params.set("category", category);
  const query = params.toString();
  const payload = await request<{ cars: Car[]; cheapest?: Car | null }>(`/api/mobile/rentals${query ? `?${query}` : ""}`);
  return payload.cars || [];
}

export async function getMyRentalCarListings() {
  const payload = await request<{ ok: boolean; cars: Car[] }>("/api/mobile/rentals/owner-listings");
  return payload.cars || [];
}

export async function listRentalCar(details: RentalCarListingInput) {
  return request<{ ok: boolean; car: Car; message: string }>("/api/mobile/rentals/listing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(details)
  });
}

function rentalPayload(carId: number, details?: Partial<RentalSearchInput>) {
  const pickup = details?.pickupDate ? new Date(`${details.pickupDate}T00:00:00`) : null;
  const dropoff = details?.returnDate ? new Date(`${details.returnDate}T00:00:00`) : null;
  const calculatedDays =
    pickup && dropoff
      ? Math.ceil((dropoff.getTime() - pickup.getTime()) / 86400000)
      : 0;
  return {
    carId,
    pickupLocation: details?.pickupLocation || "",
    returnLocation: details?.returnLocation || details?.pickupLocation || "",
    pickupDate: details?.pickupDate || "",
    returnDate: details?.returnDate || "",
    pickupTime: details?.pickupTime || "10:00 AM",
    returnTime: details?.returnTime || "10:00 AM",
    renterAge: details?.renterAge || "25+",
    discountCode: details?.discountCode || "",
    days: calculatedDays > 0 ? calculatedDays : details?.days || 3,
    additionalDriverRequested: Boolean(details?.additionalDriverRequested),
    additionalDriverName: details?.additionalDriverName || "",
    additionalDriverAge: details?.additionalDriverAge || ""
  };
}

export async function quoteRentalCar(carId: number, details: Partial<RentalSearchInput>) {
  const payload = await request<{ ok: boolean; quote: RentalQuote }>("/api/mobile/rentals/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rentalPayload(carId, details))
  });
  return payload.quote;
}

export async function bookRentalCar(carId: number, details?: Partial<RentalSearchInput>) {
  return request<{ ok: boolean; booking: RentalBooking }>("/api/mobile/rentals/book", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rentalPayload(carId, details))
  });
}

export async function startRentalCheckout(
  paymentOption: "hold" | "full" = "hold",
  bookingId = "",
  returnUrls?: { successUrl?: string; cancelUrl?: string }
) {
  let lastError = "";
  for (const baseUrl of API_CANDIDATES) {
    for (const endpoint of ["mobile", "web"] as const) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      const path = endpoint === "mobile" ? "/api/mobile/rentals/checkout-session" : "/payment/stripe-session";
      const body = endpoint === "mobile"
        ? JSON.stringify({ paymentOption, bookingId, successUrl: returnUrls?.successUrl || "", cancelUrl: returnUrls?.cancelUrl || "" })
        : new URLSearchParams({ payment_option: paymentOption, booking_id: bookingId }).toString();
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": endpoint === "mobile" ? "application/json" : "application/x-www-form-urlencoded"
      };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }
      try {
        const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body, signal: controller.signal });
        const text = await response.text();
        let payload: { ok?: boolean; url?: string; error?: string; message?: string; paymentOption?: string; amount?: number };
        try {
          payload = JSON.parse(text);
        } catch {
          lastError = `FairFares server at ${baseUrl}${path} returned a non-JSON response.`;
          continue;
        }
        if (!response.ok) {
          lastError = payload.error || payload.message || `FairFares checkout failed: ${response.status}`;
          continue;
        }
        if (payload.url) {
          return {
            ok: true,
            url: payload.url,
            paymentOption: payload.paymentOption || paymentOption,
            amount: Number(payload.amount || 0)
          };
        }
        lastError = payload.error || payload.message || "Stripe did not return a checkout link.";
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timeout);
      }
    }
  }
  throw new Error(lastError || "Unable to open Stripe checkout.");
}

export async function startRentalSecurityDeposit(bookingId: string) {
  return request<{ ok: boolean; url: string; amount: number; message?: string }>(
    "/api/mobile/rentals/security-deposit-session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId })
    }
  );
}

export async function getHousingActivity() {
  const payload = await request<{ ok: boolean; posts: HousingActivityPost[] }>("/api/mobile/housing/activity");
  return payload.posts || [];
}

export async function getRentalBookings() {
  const payload = await request<{ ok: boolean; bookings: RentalServiceBooking[] }>("/api/mobile/rentals/bookings");
  const visiblePaymentStatuses = new Set(["HOLD_PAID", "PAID", "REFUND_REVIEW", "REFUNDED"]);
  return (payload.bookings || []).filter((booking) => visiblePaymentStatuses.has(String(booking.paymentStatus || "").toUpperCase()));
}

export async function requestRentalCancellation(
  bookingId: string,
  reason = "Customer cancellation request",
  note = "",
  refundMethod = "Original payment method"
) {
  return request<{ ok: boolean; message: string; booking?: RentalServiceBooking }>("/api/mobile/rentals/cancel-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, reason, note, refundMethod })
  });
}

export async function requestRentalModification(
  bookingId: string,
  changes: {
    pickupLocation?: string;
    returnLocation?: string;
    pickupDate?: string;
    returnDate?: string;
    pickupTime?: string;
    returnTime?: string;
    vehicleId?: number;
    additionalDriverRequested?: boolean;
    additionalDriverName?: string;
    additionalDriverAge?: string;
    note?: string;
  }
) {
  return request<{ ok: boolean; message: string; booking?: RentalServiceBooking }>("/api/mobile/rentals/modify-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, ...changes })
  });
}

export async function emailRentalDocuments(bookingId: string, email = "") {
  return request<{ ok: boolean; message: string }>("/api/mobile/rentals/documents-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, email })
  });
}

export async function updateMobileStudentVerification(studentEmail: string, studentId: string) {
  return request<{ ok: boolean; message: string; user?: BootstrapPayload["user"] }>("/api/mobile/student-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentEmail, studentId })
  });
}

export async function createSupportTicket(
  bookingId: string | null,
  topic: string,
  message: string,
  urgent = false
) {
  return request<{ ok: boolean; message: string; ticketId: string; priority: string; sla: string }>("/api/mobile/rentals/support-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId: bookingId || "", topic, message, urgent, preferredContact: "FairFares app" })
  });
}

export async function createRentalSupportTicket(bookingId: string, topic: string, message: string, urgent = false) {
  return createSupportTicket(bookingId, topic, message, urgent);
}

export async function submitAppFeedback(rating: number, message: string, page = "mobile") {
  const body = new URLSearchParams();
  body.set("rating", String(rating));
  body.set("message", message);
  body.set("page", page);
  return request<{ ok: boolean; message: string }>("/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString()
  });
}

export async function getSiteServices() {
  try {
    const payload = await request<{ services: ServiceItem[] }>("/api/site");
    return payload.services || [];
  } catch {
    return [];
  }
}

function formBody(values: Record<string, string>) {
  const body = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => body.set(key, value));
  return body.toString();
}

export async function getChatConversations(offset = 0) {
  const params = new URLSearchParams({ limit: "30", offset: String(Math.max(0, offset)) });
  const payload = await request<{ ok: boolean; conversations: ChatConversation[] }>(`/api/chat/conversations?${params.toString()}`);
  return payload.conversations || [];
}

export async function registerMobilePushToken(token: string, platform: string, deviceLabel: string, enabled = true, deviceId = "") {
  return request<{ ok: boolean; enabled: boolean }>("/api/mobile/push-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform, deviceLabel, enabled, deviceId })
  });
}

export async function getChatCommunities(city = "") {
  const query = city.trim() ? `?city=${encodeURIComponent(city.trim())}` : "";
  const payload = await request<{ ok: boolean; communities: Community[] }>(`/api/chat/communities${query}`);
  return payload.communities || [];
}

export async function getChatMessages(conversationId: string) {
  return request<{ ok: boolean; conversation: ChatConversation; messages: ChatMessage[]; hasMore: boolean; nextBefore: number }>(
    `/api/chat/messages?conversation_id=${encodeURIComponent(conversationId)}`
  );
}

export async function registerChatDeviceKey(deviceId: string, publicKey: string, signingPublicKey = "") {
  return request<{ ok: boolean }>("/api/chat/e2ee/keys", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ deviceId, publicKey, signingPublicKey })
  });
}

export async function relayEncryptedChatMessage(bundle: Record<string, unknown>) {
  return request<{ ok: boolean; messageId: number }>("/api/chat/e2ee/relay", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bundle)
  });
}

export async function getChatDeviceKeys(conversationId: string) {
  return request<{ ok: boolean; keys: Array<{ userId: number; deviceId: string; publicKey: string }>; ready: boolean; warning: string }>(`/api/chat/e2ee/keys?conversation_id=${encodeURIComponent(conversationId)}`);
}

export async function getChatEncryptedEnvelopes(conversationId: string, deviceId: string) {
  return request<{ ok: boolean; envelopes: Array<{ messageId: number; senderPublicKey: string; nonce: string; ciphertext: string }> }>(`/api/chat/e2ee/envelopes?conversation_id=${encodeURIComponent(conversationId)}&device_id=${encodeURIComponent(deviceId)}`);
}

export async function getChatEncryptedPreviewEnvelopes(messageIds: number[], deviceId: string) {
  const uniqueIds = [...new Set(messageIds.filter((messageId) => Number.isInteger(messageId) && messageId > 0))].slice(0, 50);
  const params = new URLSearchParams({
    message_ids: uniqueIds.join(","),
    device_id: deviceId
  });
  return request<{ ok: boolean; envelopes: Array<{ messageId: number; senderPublicKey: string; nonce: string; ciphertext: string }> }>(`/api/chat/e2ee/preview-envelopes?${params.toString()}`);
}

export async function sendEncryptedChatMessage(conversationId: string, envelopes: Array<Record<string, unknown>>, clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2)}`, silent = false) {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/e2ee/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, envelopes, clientMessageId, silent })
  });
}

export async function sendEncryptedChatAttachment(conversationId: string, ciphertextBase64: string, envelopes: Array<Record<string, unknown>>, silent = false) {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/e2ee/attachments", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, ciphertextBase64, envelopes, clientMessageId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, silent })
  });
}

export async function saveChatKeyBackup(encryptedPayload: string) {
  return request<{ ok: boolean }>("/api/chat/e2ee/backup", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ encryptedPayload })
  });
}

export async function getChatKeyBackup() {
  return request<{ ok: boolean; encryptedPayload: string; updatedAt: string }>("/api/chat/e2ee/backup");
}

export async function pollChatEvents(conversationId: string, afterMessageId: number) {
  const query = new URLSearchParams({
    conversation_id: conversationId,
    after: String(Math.max(0, Math.floor(afterMessageId || 0))),
    wait: "7"
  });
  return request<{
    ok: boolean;
    messages: ChatMessage[];
    receipts: Array<{ id: number; deliveredAt: string; readAt: string; status: ChatMessage["status"] }>;
    typing: Array<{ userId: number; name: string }>;
    cursor: number;
  }>(`/api/chat/events?${query}`);
}

export async function updateChatTyping(conversationId: string, active: boolean) {
  return request<{ ok: boolean; active: boolean }>("/api/chat/typing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, active })
  });
}

export async function startChatForPost(postId: string, message: string) {
  return request<{ ok: boolean; conversation: ChatConversation; message: ChatMessage | null }>("/api/chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ post_id: postId, message, client_message_id: `${Date.now()}-${Math.random().toString(36).slice(2)}` })
  });
}

export async function openChatForPost(postId: string) {
  return request<{ ok: boolean; conversation: ChatConversation; message: null }>("/api/chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ post_id: postId, open_only: "1" })
  });
}

export async function startChatForRide(rideId: string, message: string) {
  return request<{ ok: boolean; conversation: ChatConversation; message: ChatMessage | null }>("/api/chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ ride_id: rideId, message, client_message_id: `${Date.now()}-${Math.random().toString(36).slice(2)}` })
  });
}

export async function openChatForRide(rideId: string) {
  return request<{ ok: boolean; conversation: ChatConversation; message: null }>("/api/chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ ride_id: rideId, open_only: "1" })
  });
}

export async function openCommunityChat(communityId: string) {
  return request<{ ok: boolean; conversation: ChatConversation; message: ChatMessage | null }>("/api/chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ community_id: communityId })
  });
}

export async function sendChatRichMessage(conversationId: string, type: "POLL" | "EVENT" | "CONTACT", metadata: Record<string, unknown>) {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/rich-messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, type, metadata, clientMessageId: `${Date.now()}-${Math.random().toString(36).slice(2)}` })
  });
}

export async function voteChatPoll(messageId: number, optionIndex: number) {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/polls/vote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, optionIndex })
  });
}

export async function editChatMessage(conversationId: string, messageId: number, envelopes: Array<Record<string, unknown>>) {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/messages/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, messageId, envelopes })
  });
}

export async function deleteChatMessage(conversationId: string, messageId: number) {
  return request<{ ok: boolean; messageId: number }>("/api/chat/messages/delete", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ conversation_id: conversationId, message_id: String(messageId) })
  });
}

export async function reportChatMessage(conversationId: string, messageId: number, reason: string) {
  return request<{ ok: boolean }>("/api/chat/messages/report", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ conversation_id: conversationId, message_id: String(messageId), reason })
  });
}

export async function markChatRead(conversationId: string, lastMessageId = "") {
  return request<{ ok: boolean }>("/api/chat/read", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ conversation_id: conversationId, last_message_id: lastMessageId })
  });
}

export async function muteChatConversation(conversationId: string, muted: boolean) {
  return request<{ ok: boolean; muted: boolean }>("/api/chat/mute", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ conversation_id: conversationId, muted: muted ? "1" : "0" })
  });
}

export async function blockChatUser(conversationId: string, targetUserId: number, blocked: boolean) {
  return request<{ ok: boolean; blocked: boolean; targetUserId: number }>("/api/chat/block", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ conversation_id: conversationId, target_user_id: targetUserId ? String(targetUserId) : "", blocked: blocked ? "1" : "0" })
  });
}

export async function createChatCommunity(name: string, kind: "GROUP" | "COMMUNITY", description: string, area: string, photo = "") {
  return request<{ ok: boolean; community: Community }>("/api/chat/communities", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ name, kind, description, area, photo })
  });
}

export async function updateChatGroupPhoto(communityId: string, photo: string) {
  return request<{ ok: boolean; community: Community }>("/api/chat/groups/photo", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ community_id: communityId, photo })
  });
}

export async function joinChatCommunity(communityId: string, suggestionCity = "", suggestionPurpose = "") {
  return request<{ ok: boolean; community: Community }>("/api/chat/communities/join", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ community_id: communityId, suggestion_city: suggestionCity, suggestion_purpose: suggestionPurpose })
  });
}

export async function createChatGroupInvite(communityId: string) {
  return request<{ ok: boolean; inviteUrl: string; expiresInDays: number }>("/api/chat/groups/invites", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ community_id: communityId, expires_days: "7" })
  });
}

function groupInviteToken(value: string) {
  const raw = value.trim();
  try {
    const parsed = new URL(raw);
    const fromQuery = parsed.searchParams.get("group_invite") || parsed.searchParams.get("token");
    if (fromQuery) return fromQuery;
    const match = parsed.pathname.match(/\/fchat\/invite\/([^/]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
  } catch {
    // A raw invitation token is also accepted.
  }
  return raw;
}

export async function joinChatGroupInvite(value: string) {
  const token = groupInviteToken(value);
  return request<{ ok: boolean; community: Community }>("/api/chat/groups/join-invite", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ token })
  });
}

export async function previewChatGroupInvite(value: string) {
  const token = groupInviteToken(value);
  return request<{ ok: boolean; group: { id: string; name: string; description: string; area: string; memberCount: number; alreadyMember: boolean } }>(
    `/api/chat/groups/invite-preview?token=${encodeURIComponent(token)}`
  );
}

export async function getChatGroupMembers(communityId: string) {
  return request<{ ok: boolean; members: ChatGroupMember[] }>(`/api/chat/groups/members?community_id=${encodeURIComponent(communityId)}`);
}

export async function updateChatGroupMemberRole(communityId: string, targetUserId: number, role: "ADMIN" | "MEMBER") {
  return request<{ ok: boolean }>("/api/chat/groups/members/role", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ community_id: communityId, target_user_id: String(targetUserId), role })
  });
}

export async function addChatGroupMember(communityId: string, targetUserId: number) {
  return request<{ ok: boolean }>("/api/chat/groups/members/add", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ community_id: communityId, target_user_id: String(targetUserId) })
  });
}

export async function removeChatGroupMember(communityId: string, targetUserId: number) {
  return request<{ ok: boolean }>("/api/chat/groups/members/remove", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ community_id: communityId, target_user_id: String(targetUserId) })
  });
}

export async function transferChatGroupOwnership(communityId: string, targetUserId: number) {
  return request<{ ok: boolean }>("/api/chat/groups/ownership/transfer", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ community_id: communityId, target_user_id: String(targetUserId) })
  });
}

export async function leaveChatGroup(communityId: string) {
  return request<{ ok: boolean }>("/api/chat/groups/leave", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ community_id: communityId })
  });
}

export async function findChatPersonByPhone(phone: string) {
  return request<{ ok: boolean; person: { id: number; name: string } }>(`/api/chat/people/by-phone?phone=${encodeURIComponent(phone)}`);
}

export async function findChatPeopleByContactHashes(phoneHashes: string[]) {
  return request<{ ok: boolean; people: Array<{ id: number; name: string; photoUrl: string; phoneHash: string }> }>("/api/chat/people/by-contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneHashes })
  });
}

export async function openChatWithPerson(targetUserId: number) {
  return request<{ ok: boolean; conversation: ChatConversation; message?: ChatMessage | null }>("/api/chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ target_user_id: String(targetUserId), open_only: "1" })
  });
}

export async function openIssuesAndSuggestionsChat() {
  return request<{ ok: boolean; conversation: ChatConversation }>("/api/chat/feedback-conversation", {
    method: "POST"
  });
}

export async function setChatPhoneDiscoverability(enabled: boolean) {
  return request<{ ok: boolean; enabled: boolean }>("/api/chat/phone-discoverability", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ enabled: enabled ? "1" : "0" })
  });
}

export async function mobileLogin(identifier: string, password: string) {
  const payload = await request<{ ok: boolean; token: string; user: BootstrapPayload["user"] }>(
    "/api/mobile/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password })
    }
  );
  await setAuthToken(payload.token);
  return payload;
}

export type MobileSocialAuthPayload = {
  ok: boolean;
  token?: string;
  user?: BootstrapPayload["user"];
  phoneRequired?: boolean;
  continuationToken?: string;
};

export async function mobileSocialLogin(provider: "google" | "apple", identityToken: string, name = "") {
  const payload = await request<MobileSocialAuthPayload>("/api/mobile/auth/oauth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, identityToken, name })
  });
  if (payload.token) await setAuthToken(payload.token);
  return payload;
}

export async function completeSocialPhone(continuationToken: string, phone: string, countryCode: string) {
  const payload = await request<{ ok: boolean; token: string; user: BootstrapPayload["user"] }>("/api/mobile/auth/phone/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ continuationToken, phone, countryCode })
  });
  await setAuthToken(payload.token);
  return payload;
}

export async function mobileSignup(name: string, email: string, phone: string, password: string, phoneDiscoverable = true, countryCode = "") {
  const payload = await request<{ ok: boolean; activationRequired: boolean; message: string; activationLink?: string; token?: string; user?: BootstrapPayload["user"] }>(
    "/api/mobile/signup",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone, countryCode, password, phoneDiscoverable })
    }
  );
  if (payload.token) {
    await setAuthToken(payload.token);
  }
  return payload;
}

export type MobileHousingPostInput = {
  postMode: "HAVE_PLACE" | "NEED_PLACE";
  category: string;
  title: string;
  description: string;
  city: string;
  streetAddress: string;
  zipCode: string;
  area: string;
  primaryNeighborhood: string;
  apartmentName: string;
  workSchoolLocation: string;
  radiusMiles: string;
  moveInDate: string;
  rentMin: string;
  rentMax: string;
  rentPeriod: string;
  accommodates: string;
  roommateCount: string;
  aboutYou: string;
  bathroomType: string;
  genderPreference: string;
  commutePreference: string;
  leaseTerm: string;
  deposit: string;
  daysAvailable: string;
  vegetarianPreference: string;
  smokingPolicy: string;
  petFriendly: string;
  amenities: string;
  furnished: boolean;
  privateBath: boolean;
  parking: boolean;
  utilitiesIncluded: boolean;
  socialFacebook: string;
  socialX: string;
  socialInstagram: string;
  socialYoutube: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  roommateIntent?: boolean;
  images?: string[];
};

export async function createMobileHousingPost(input: MobileHousingPostInput) {
  return request<{ ok: boolean; post: HousingPost }>("/api/mobile/housing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function mobileLogout() {
  try {
    await request<{ ok: boolean }>("/api/mobile/logout", { method: "POST" });
  } catch {
    // Local logout should still clear the device session if the network is down.
  } finally {
    await setAuthToken("");
  }
}

export type MobileProfileInput = {
  name?: string;
  email?: string;
  phone?: string;
  profilePhoto?: string;
  currentPassword?: string;
};

export async function updateMobileProfile(input: MobileProfileInput) {
  return request<{ ok: boolean; user: BootstrapPayload["user"]; message: string; activationRequired?: boolean; activationLink?: string }>("/api/mobile/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}
