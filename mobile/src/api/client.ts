import { BootstrapPayload, Car, ChatConversation, ChatGroupMember, ChatMessage, Community, HousingActivityPost, HousingPost, RentalBooking, RentalCarListingInput, RentalQuote, RentalSearchInput, RentalServiceBooking, RideDispatchSummary, RideDriverProfile, RideInput, RidePost, RideType, ServiceItem, StaffPickupBooking } from "../types";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { NativeModules, Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { File, Paths } from "expo-file-system";
import { sha256 } from "@noble/hashes/sha256";
import * as naclUtil from "tweetnacl-util";

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

type RequestOptions = {
  silentNetworkFailure?: boolean;
  silentServerFailure?: boolean;
  attempts?: number;
};

async function request<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined)
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  let lastError = "";
  // Reference forwarding only writes a message row and reuses ciphertext that
  // is already in R2. Do not give it the two-minute transfer timeout (or the
  // upload-specific error copy) used by endpoints that move attachment bytes.
  const isAttachmentUpload = (path === "/api/chat/attachments" || path.startsWith("/api/chat/e2ee/attachments"))
    && path !== "/api/chat/e2ee/attachments/forward";
  const candidateUrls = isAttachmentUpload ? uniqueUrls([activeApiBase, API_URL]) : API_CANDIDATES;
  for (const baseUrl of candidateUrls) {
    const method = String(init.method || "GET").toUpperCase();
    // Render deploys and upstream gateways may briefly return a proxy-generated
    // 502 without application CORS headers. Browsers surface that as a network
    // TypeError, so remote idempotent GETs need a slightly longer retry window.
    const attempts = options.attempts || (method === "GET" ? (EXPLICIT_API_URL ? 4 : 2) : 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      // Multipart completion can legitimately spend time reconciling parts and
      // streaming the completed ciphertext through the backend checksum pass.
      const timeoutMs = isAttachmentUpload ? 120000 : EXPLICIT_API_URL ? REMOTE_API_REQUEST_TIMEOUT_MS : API_REQUEST_TIMEOUT_MS;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal });
        const text = await response.text();
        let payload: T & { error?: string; message?: string };
        try {
          payload = JSON.parse(text) as T & { error?: string; message?: string };
        } catch {
          // An HTML 404/5xx from a proxy is an HTTP response, not a dropped
          // upload. Preserve its status so request() fails immediately instead
          // of retrying it with the long attachment timeout.
          const responseError = new Error(`FairFares server returned an unexpected response (HTTP ${response.status}).`) as Error & {
            fairFaresHttpStatus?: number;
          };
          responseError.fairFaresHttpStatus = response.status;
          throw responseError;
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
          if (response.status >= 500 && !options.silentServerFailure) {
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
  if (options.silentNetworkFailure) {
    throw new Error(lastError || "Background request did not finish.");
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
    chat: { unreadCount: 0, conversations: [], messagedPostIds: [], messagedRideIds: [] },
    features: { chitthi: { maxVideoSizeMb: 12, maxVideoSizeBytes: 12_000_000, enableMultipartUpload: false, cryptoThrottleMs: 10, rolloutCohort: "control" } },
    dashboard: { housingPosts: 0, messages: 0 },
    hasSubmittedHousingExperience: false,
    hasSubmittedMobileReview: false,
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
  const destination = `${cacheRoot}chitthi-preview-${safeKey}.img`;
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

export async function downloadAuthenticatedAssetToFile(value: string, destination: string, onProgress?: (progress: number) => void, includeAuthorization = true) {
  if (Platform.OS === "web") throw new Error("Native attachment storage is unavailable on web.");
  const directUrl = absoluteAssetUrl(value);
  if (!directUrl) throw new Error("Attachment URL is missing.");
  const headers: Record<string, string> = {};
  if (includeAuthorization && authToken) headers.Authorization = `Bearer ${authToken}`;
  await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
  const download = FileSystem.createDownloadResumable(directUrl, destination, { headers }, (event) => {
    const expected = Number(event.totalBytesExpectedToWrite || 0);
    const written = Number(event.totalBytesWritten || 0);
    if (expected > 0) onProgress?.(Math.max(0, Math.min(1, written / expected)));
  });
  const result = await download.downloadAsync();
  if (!result) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
    throw new Error("The attachment download was interrupted.");
  }
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
    throw new Error(`Could not download attachment (${result.status}).`);
  }
  const info = await FileSystem.getInfoAsync(result.uri);
  if (!info.exists || Number(info.size || 0) <= 0) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
    throw new Error("The downloaded attachment is empty.");
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

export async function getRidePlaceSuggestions(city: string, query = "", useCityBias = true) {
  const params = new URLSearchParams({ city, q: query, limit: "12", cityBias: useCityBias ? "1" : "0" });
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

export async function updateMobileRide(rideId: string, input: RideInput) {
  const payload = await request<{ ok: boolean; ride: RidePost }>("/api/mobile/rides", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, rideId })
  });
  return payload.ride;
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

export type AccountDeletionRequest = {
  requestId: string;
  status: string;
  requestedAt: string;
  deletionDueAt: string;
  completedAt?: string;
  retainedDataSummary?: string;
};

export async function requestAccountDeletion(confirmation: string) {
  return request<{ ok: boolean; message: string; request: AccountDeletionRequest }>("/api/mobile/account-deletion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation })
  });
}

export async function getAccountDeletionStatus() {
  return request<{ ok: boolean; request: AccountDeletionRequest | null }>("/api/mobile/account-deletion");
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
  }, { silentNetworkFailure: true, attempts: 1 });
}

export type MobileNotificationPreferences = {
  chitthi: boolean;
  carpool: boolean;
  rentals: boolean;
  housing: boolean;
  support: boolean;
  marketing: boolean;
};

export async function getMobileNotificationPreferences() {
  return request<{ ok: boolean; preferences: MobileNotificationPreferences }>("/api/mobile/notification-preferences");
}

export async function updateMobileNotificationPreferences(preferences: MobileNotificationPreferences) {
  return request<{ ok: boolean; preferences: MobileNotificationPreferences }>("/api/mobile/notification-preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences)
  });
}

export async function getChatCommunities(city = "") {
  const query = city.trim() ? `?city=${encodeURIComponent(city.trim())}` : "";
  const payload = await request<{ ok: boolean; communities: Community[] }>(`/api/chat/communities${query}`);
  return payload.communities || [];
}

export async function getChatMessages(conversationId: string, beforeMessageId = 0, limit = 30, deviceId = "") {
  const params = new URLSearchParams({
    conversation_id: conversationId,
    limit: String(Math.max(1, Math.min(50, Math.floor(limit || 30))))
  });
  if (beforeMessageId > 0) params.set("before", String(Math.floor(beforeMessageId)));
  if (deviceId) params.set("device_id", deviceId);
  return request<{ ok: boolean; conversation: ChatConversation; messages: ChatMessage[]; envelopes: Array<{ messageId: number; senderPublicKey: string; nonce: string; ciphertext: string }>; hasMore: boolean; nextBefore: number }>(
    `/api/chat/messages?${params.toString()}`
  );
}

export type ChatLinkPreview = {
  url: string;
  host: string;
  title: string;
  description: string;
  imageUrl: string;
  faviconUrl: string;
  siteName: string;
};

export async function getChatLinkPreview(url: string) {
  return request<{ ok: boolean; preview: ChatLinkPreview }>(`/api/chat/link-preview?url=${encodeURIComponent(url)}`, {}, {
    silentNetworkFailure: true,
    silentServerFailure: true,
    attempts: 1
  });
}

export async function registerChatDeviceKey(deviceId: string, publicKey: string, signingPublicKey = "") {
  return request<{ ok: boolean }>("/api/chat/e2ee/keys", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formBody({ deviceId, publicKey, signingPublicKey })
  }, {
    // Registration is an idempotent upsert and is retried by the Chitthi
    // initialization loop. Backend deploys and mobile handoffs can briefly
    // return a gateway error, which must not create a diagnostic storm.
    attempts: 4,
    silentNetworkFailure: true,
    silentServerFailure: true
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

export async function sendEncryptedChatMessage(conversationId: string, envelopes: Array<Record<string, unknown>>, clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2)}`, silent = false, replyToMessageId = 0, contextPostId = "") {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/e2ee/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, envelopes, clientMessageId, silent, replyToMessageId, contextPostId })
  });
}

export async function reactToChatMessage(conversationId: string, messageId: number, emoji: string) {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/messages/react", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, messageId, emoji })
  });
}

export async function sendEncryptedChatAttachment(conversationId: string, ciphertextBase64: string, envelopes: Array<Record<string, unknown>>, silent = false) {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/e2ee/attachments", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, ciphertextBase64, envelopes, clientMessageId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, silent })
  });
}

type EncryptedUploadAuthorization = {
  ok: boolean;
  uploadId: string;
  transferMode: "SINGLE" | "MULTIPART";
  uploadUrl?: string;
  headers?: Record<string, string>;
  expiresIn: number;
  partSize?: number;
  partCount?: number;
};

export async function authorizeEncryptedChatAttachment(conversationId: string, encryptedSize: number, ciphertextSha256: string, mediaMimeType: string) {
  return request<EncryptedUploadAuthorization>("/api/chat/e2ee/attachments/authorize", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, encryptedSize, ciphertextSha256, mediaMimeType })
  }, { attempts: 3 });
}

type CompletedMultipartPart = { partNumber: number; etag: string; size?: number };

async function authorizeEncryptedMultipartPart(uploadId: string, partNumber: number, partSize: number, partSha256: string) {
  return request<{ ok: boolean; uploadUrl: string; headers: Record<string, string> }>("/api/chat/e2ee/attachments/multipart/part", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, partNumber, partSize, partSha256 })
  }, { attempts: 3 });
}

async function getEncryptedMultipartStatus(uploadId: string) {
  return request<{ ok: boolean; parts: CompletedMultipartPart[] }>("/api/chat/e2ee/attachments/multipart/status", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId })
  }, { attempts: 3 });
}

async function completeEncryptedMultipartUpload(uploadId: string, parts: CompletedMultipartPart[]) {
  return request<{ ok: boolean; completed: boolean }>("/api/chat/e2ee/attachments/multipart/complete", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, parts })
  }, { attempts: 3 });
}

const multipartStatePrefix = "fairfares.chitthi.multipart.v1.";

type PendingMultipartUpload = {
  authorization: EncryptedUploadAuthorization;
  conversationId: string;
  encryptedUri: string;
  encryptedSize: number;
  ciphertextSha256: string;
  envelopes: Array<Record<string, unknown>>;
  mediaMimeType: string;
  silent: boolean;
  clientMessageId: string;
  uploaded?: boolean;
};

function multipartStateKey(ciphertextSha256: string) {
  return `${multipartStatePrefix}${ciphertextSha256.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

async function uploadEncryptedMultipartFile(authorization: EncryptedUploadAuthorization, encryptedUri: string) {
  const source = new File(encryptedUri);
  const partSize = Number(authorization.partSize || 0);
  const partCount = Number(authorization.partCount || 0);
  if (!source.exists || source.size <= 0 || partSize <= 0 || partCount <= 0) throw new Error("Encrypted multipart upload data is invalid.");
  const remote = await getEncryptedMultipartStatus(authorization.uploadId);
  const completed = new Map(remote.parts.map((part) => [part.partNumber, part]));
  const pendingPartNumbers = Array.from({ length: partCount }, (_, index) => index + 1).filter((partNumber) => {
    const expectedSize = partNumber < partCount ? partSize : source.size - partSize * (partCount - 1);
    const existing = completed.get(partNumber);
    return !existing?.etag || existing.size !== expectedSize;
  });
  let nextPendingIndex = 0;

  async function uploadNextPart() {
    while (nextPendingIndex < pendingPartNumbers.length) {
      const partNumber = pendingPartNumbers[nextPendingIndex];
      nextPendingIndex += 1;
      const expectedSize = partNumber < partCount ? partSize : source.size - partSize * (partCount - 1);
      // Each worker owns its file handle and closes it before network I/O. Two
      // workers therefore cap plaintext-in-memory ciphertext buffers at two
      // parts while allowing R2 transfers to overlap.
      const reader = source.open();
      reader.offset = (partNumber - 1) * partSize;
      let bytes: Uint8Array;
      try {
        bytes = reader.readBytes(expectedSize);
      } finally {
        reader.close();
      }
      if (bytes.byteLength !== expectedSize) throw new Error(`Encrypted upload part ${partNumber} could not be read completely.`);
      const partSha256 = naclUtil.encodeBase64(sha256(bytes));
      const partAuthorization = await authorizeEncryptedMultipartPart(authorization.uploadId, partNumber, expectedSize, partSha256);
      const partFile = new File(Paths.cache, `chitthi-upload-${authorization.uploadId}-${partNumber}.part`);
      partFile.create({ overwrite: true, intermediates: true });
      partFile.write(bytes);
      bytes.fill(0);
      try {
        let uploaded: FileSystem.FileSystemUploadResult | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          uploaded = await FileSystem.uploadAsync(partAuthorization.uploadUrl, partFile.uri, {
            httpMethod: "PUT", headers: partAuthorization.headers,
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT
          });
          if (uploaded.status >= 200 && uploaded.status < 300) break;
          if (attempt < 2) await wait([500, 1250][attempt]);
        }
        if (!uploaded || uploaded.status < 200 || uploaded.status >= 300) throw new Error(`Encrypted upload part ${partNumber} failed (${uploaded?.status || 0}).`);
        const responseHeaders = uploaded.headers || {};
        const etag = String(responseHeaders.etag || responseHeaders.ETag || responseHeaders.Etag || "");
        if (!etag) throw new Error(`Encrypted upload part ${partNumber} did not return an ETag.`);
        completed.set(partNumber, { partNumber, etag, size: expectedSize });
      } finally {
        if (partFile.exists) partFile.delete();
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, pendingPartNumbers.length) }, () => uploadNextPart()));
  const parts = [...completed.values()].sort((left, right) => left.partNumber - right.partNumber);
  await completeEncryptedMultipartUpload(authorization.uploadId, parts);
}

export async function uploadEncryptedBinary(uploadUrl: string, headers: Record<string, string>, ciphertextBase64: string) {
  if (Platform.OS === "web") {
    const binary = atob(ciphertextBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(uploadUrl, { method: "PUT", headers, body: bytes });
        if (response.ok) break;
      } catch {
        response = undefined;
      }
      if (attempt < 2) await wait([500, 1250][attempt]);
    }
    bytes.fill(0);
    if (!response?.ok) throw new Error(`Encrypted upload failed (${response?.status || 0}).`);
    return;
  }
  if (!FileSystem.cacheDirectory) throw new Error("Encrypted upload storage is unavailable.");
  const temporaryPath = `${FileSystem.cacheDirectory}chitthi-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.ffenc`;
  try {
    await FileSystem.writeAsStringAsync(temporaryPath, ciphertextBase64, { encoding: FileSystem.EncodingType.Base64 });
    await uploadEncryptedFile(uploadUrl, headers, temporaryPath);
  } finally {
    await FileSystem.deleteAsync(temporaryPath, { idempotent: true }).catch(() => undefined);
  }
}

export async function uploadEncryptedFile(uploadUrl: string, headers: Record<string, string>, encryptedUri: string) {
  if (Platform.OS === "web") throw new Error("Native encrypted-file upload is unavailable on web.");
  let result: FileSystem.FileSystemUploadResult | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await FileSystem.uploadAsync(uploadUrl, encryptedUri, {
        httpMethod: "PUT", headers, uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT
      });
      if (result.status >= 200 && result.status < 300) return;
    } catch {
      result = undefined;
    }
    if (attempt < 2) await wait([500, 1250][attempt]);
  }
  throw new Error(`Encrypted upload failed (${result?.status || 0}).`);
}

export async function finalizeEncryptedChatAttachment(uploadId: string, envelopes: Array<Record<string, unknown>>, silent = false, clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/e2ee/attachments/finalize", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, envelopes, clientMessageId, silent })
  }, { attempts: 3 });
}

export async function forwardEncryptedChatAttachment(
  sourceMessageId: number,
  conversationId: string,
  envelopes: Array<Record<string, unknown>>,
  silent = false
) {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/e2ee/attachments/forward", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceMessageId,
      conversationId,
      envelopes,
      silent,
      clientMessageId: `${Date.now()}-${Math.random().toString(36).slice(2)}`
    })
  }, { attempts: 3 });
}

export async function sendDirectEncryptedChatAttachment(
  conversationId: string,
  encrypted: { ciphertextBase64?: string; encryptedUri?: string; ciphertextSha256: string; encryptedSize: number; envelopes: Array<Record<string, unknown>> },
  mediaMimeType: string,
  silent = false
) {
  const authorization = await authorizeEncryptedChatAttachment(conversationId, encrypted.encryptedSize, encrypted.ciphertextSha256, mediaMimeType);
  const stateKey = multipartStateKey(encrypted.ciphertextSha256);
  const clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (authorization.transferMode === "MULTIPART") {
    if (!encrypted.encryptedUri || Platform.OS === "web") throw new Error("Multipart encrypted uploads require the native app.");
    const pending: PendingMultipartUpload = {
      authorization, conversationId, encryptedUri: encrypted.encryptedUri,
      encryptedSize: encrypted.encryptedSize, ciphertextSha256: encrypted.ciphertextSha256,
      envelopes: encrypted.envelopes, mediaMimeType, silent, clientMessageId,
    };
    await AsyncStorage.setItem(stateKey, JSON.stringify(pending));
    let multipartError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await uploadEncryptedMultipartFile(authorization, encrypted.encryptedUri);
        multipartError = undefined;
        break;
      } catch (error) {
        multipartError = error;
        if (attempt < 2) await wait([750, 1750][attempt]);
      }
    }
    if (multipartError) throw multipartError;
    pending.uploaded = true;
    await AsyncStorage.setItem(stateKey, JSON.stringify(pending));
  } else {
    try {
      if (encrypted.encryptedUri && authorization.uploadUrl && authorization.headers) await uploadEncryptedFile(authorization.uploadUrl, authorization.headers, encrypted.encryptedUri);
      else if (encrypted.ciphertextBase64 && authorization.uploadUrl && authorization.headers) await uploadEncryptedBinary(authorization.uploadUrl, authorization.headers, encrypted.ciphertextBase64);
      else throw new Error("Encrypted attachment data is missing.");
    } catch (error) {
      // Single PUT is restarted from the original media on the next user retry;
      // it has no resumable state, so its encrypted cache must not be orphaned.
      if (encrypted.encryptedUri && Platform.OS !== "web") {
        const temporary = new File(encrypted.encryptedUri);
        if (temporary.exists) temporary.delete();
      }
      throw error;
    }
  }
  try {
    const finalized = await finalizeEncryptedChatAttachment(authorization.uploadId, encrypted.envelopes, silent, clientMessageId);
    if (authorization.transferMode === "MULTIPART") await AsyncStorage.removeItem(stateKey);
    return finalized;
  } catch (error) {
    if (authorization.transferMode === "SINGLE" && encrypted.encryptedUri && Platform.OS !== "web") {
      const temporary = new File(encrypted.encryptedUri);
      if (temporary.exists) temporary.delete();
    }
    throw error;
  }
}

export async function resumePendingEncryptedChatUploads() {
  if (Platform.OS === "web") return [] as ChatMessage[];
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(multipartStatePrefix));
  const finalized: ChatMessage[] = [];
  for (const key of keys.slice(0, 5)) {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      const pending = JSON.parse(raw) as PendingMultipartUpload;
      const encryptedFile = new File(pending.encryptedUri);
      if (!pending.authorization?.uploadId || !encryptedFile.exists || encryptedFile.size !== pending.encryptedSize) {
        await AsyncStorage.removeItem(key);
        continue;
      }
      if (!pending.uploaded) {
        await uploadEncryptedMultipartFile(pending.authorization, pending.encryptedUri);
        pending.uploaded = true;
        await AsyncStorage.setItem(key, JSON.stringify(pending));
      }
      const result = await finalizeEncryptedChatAttachment(pending.authorization.uploadId, pending.envelopes, pending.silent, pending.clientMessageId);
      finalized.push(result.message);
      await AsyncStorage.removeItem(key);
      encryptedFile.delete();
    } catch {
      // Keep valid state and encrypted ciphertext for the next foreground retry.
    }
  }
  return finalized;
}

export async function getEncryptedChatAttachmentDownloadUrl(messageId: number, deviceId: string) {
  return request<{ ok: boolean; downloadUrl: string; encryptedSize: number; ciphertextSha256: string; mediaMimeType: string }>("/api/chat/e2ee/attachments/download-url", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId, deviceId })
  });
}

export async function downloadEncryptedAssetResumably(
  downloadUrl: string,
  destination: string,
  encryptedSize: number,
  ciphertextSha256: string,
  onProgress?: (progress: number) => void
) {
  if (Platform.OS === "web" || encryptedSize <= 0) throw new Error("Resumable encrypted download is unavailable.");
  const target = new File(destination);
  target.parentDirectory.create({ idempotent: true, intermediates: true });
  if (!target.exists) target.create({ overwrite: false, intermediates: true });
  if (target.size > encryptedSize) target.create({ overwrite: true, intermediates: true });
  const digest = sha256.create();
  if (target.size > 0) {
    const existingReader = target.open();
    try {
      while (existingReader.offset !== null && existingReader.offset < target.size) {
        digest.update(existingReader.readBytes(Math.min(1024 * 1024, target.size - existingReader.offset)));
      }
    } finally {
      existingReader.close();
    }
  }
  const writer = target.open();
  writer.offset = target.size;
  const rangeBytes = 8 * 1024 * 1024;
  type DownloadedRange = { start: number; end: number; uri: string };

  async function downloadRange(start: number, end: number): Promise<DownloadedRange> {
    const partUri = `${destination}.range-${start}`;
    let result: FileSystem.FileSystemDownloadResult | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await FileSystem.deleteAsync(partUri, { idempotent: true }).catch(() => undefined);
      try {
        result = await FileSystem.downloadAsync(downloadUrl, partUri, { headers: { Range: `bytes=${start}-${end}` } });
      } catch {
        result = undefined;
      }
      if (result?.status === 206 || (start === 0 && end + 1 === encryptedSize && result?.status === 200)) break;
      if (attempt < 2) await wait([500, 1250][attempt]);
    }
    if (!result || ![200, 206].includes(result.status)) {
      await FileSystem.deleteAsync(partUri, { idempotent: true }).catch(() => undefined);
      throw new Error(`Encrypted range download failed (${result?.status || 0}).`);
    }
    const part = new File(partUri);
    if (!part.exists || part.size !== end - start + 1) {
      await FileSystem.deleteAsync(partUri, { idempotent: true }).catch(() => undefined);
      throw new Error("Encrypted range download was incomplete.");
    }
    return { start, end, uri: partUri };
  }

  try {
    while (writer.offset !== null && writer.offset < encryptedSize) {
      const batchStart = writer.offset;
      const ranges = Array.from({ length: 2 }, (_, index) => {
        const start = batchStart + index * rangeBytes;
        return start < encryptedSize ? { start, end: Math.min(encryptedSize - 1, start + rangeBytes - 1) } : null;
      }).filter((range): range is { start: number; end: number } => Boolean(range));
      try {
        const settled = await Promise.allSettled(ranges.map(({ start, end }) => downloadRange(start, end)));
        const failed = settled.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
        const downloaded = settled
          .filter((result): result is PromiseFulfilledResult<DownloadedRange> => result.status === "fulfilled")
          .map((result) => result.value);
        downloaded.sort((left, right) => left.start - right.start);
        for (const range of downloaded) {
          const part = new File(range.uri);
          const reader = part.open();
          try {
            while (reader.offset !== null && reader.offset < part.size) {
              const bytes = reader.readBytes(Math.min(1024 * 1024, part.size - reader.offset));
              writer.writeBytes(bytes);
              digest.update(bytes);
            }
          } finally {
            reader.close();
          }
          onProgress?.(Math.max(0, Math.min(1, (writer.offset || 0) / encryptedSize)));
        }
      } finally {
        await Promise.all(ranges.map(({ start }) => FileSystem.deleteAsync(`${destination}.range-${start}`, { idempotent: true }).catch(() => undefined)));
      }
    }
  } finally {
    writer.close();
  }
  const actualChecksum = naclUtil.encodeBase64(digest.digest());
  if (target.size !== encryptedSize || !ciphertextSha256 || actualChecksum !== ciphertextSha256) {
    target.delete();
    throw new Error("Encrypted download checksum verification failed.");
  }
  return target.uri;
}

export async function confirmChatAttachmentDownloaded(messageId: number, deviceId: string) {
  return request<{ ok: boolean; recorded: boolean; deleted: boolean }>("/api/chat/attachments/downloaded", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, deviceId })
  }, { silentServerFailure: true, attempts: 2 });
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
    // Keep the hold comfortably below common mobile/proxy idle thresholds.
    // A completed empty response immediately starts the next poll.
    wait: "5"
  });
  return request<{
    ok: boolean;
    messages: ChatMessage[];
    receipts: Array<{ id: number; deliveredAt: string; readAt: string; status: ChatMessage["status"] }>;
    typing: Array<{ userId: number; name: string }>;
    reactionUpdates: Array<{ messageId: number; reactions: Array<{ emoji: string; count: number; mine: boolean }> }>;
    cursor: number;
  }>(`/api/chat/events?${query}`, {}, {
    // Long polls are background transport. The messenger loop reconnects after
    // transient gateway/network failures, so do not create a critical mobile
    // diagnostic for a recoverable 502/503/504 or brief connection drop.
    silentNetworkFailure: true,
    silentServerFailure: true,
    attempts: 2
  });
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
    const match = parsed.pathname.match(/\/(?:chitthi|fchat)\/invite\/([^/]+)/i);
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

export async function mobileSocialLogin(provider: "google" | "apple", identityToken: string, name = "", consentAccepted = false) {
  const payload = await request<MobileSocialAuthPayload>("/api/mobile/auth/oauth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, identityToken, name, consentAccepted })
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

export async function mobileSignup(name: string, email: string, phone: string, password: string, phoneDiscoverable = true, countryCode = "", consentAccepted = false) {
  const payload = await request<{ ok: boolean; activationRequired: boolean; message: string; activationLink?: string; token?: string; user?: BootstrapPayload["user"] }>(
    "/api/mobile/signup",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone, countryCode, password, phoneDiscoverable, consentAccepted })
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
  dateOfBirth?: string;
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
