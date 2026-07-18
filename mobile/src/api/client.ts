import { BootstrapPayload, Car, ChatConversation, ChatMessage, Community, HousingPost, RentalBooking, RentalQuote, RentalSearchInput, RentalServiceBooking, ServiceItem } from "../types";
import { NativeModules, Platform } from "react-native";

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

const EXPLICIT_API_URL = normalizeExplicitApiUrl(process.env.EXPO_PUBLIC_FAIRFARES_API_URL);
const DEFAULT_API_URL = EXPLICIT_API_URL || metroHostApiUrl() || "http://127.0.0.1:8010";

export const API_URL =
  DEFAULT_API_URL;

const API_CANDIDATES = uniqueUrls(
  Platform.OS === "web"
    ? [EXPLICIT_API_URL, "http://127.0.0.1:8010", metroHostApiUrl()]
    : [EXPLICIT_API_URL, metroHostApiUrl(), "http://127.0.0.1:8010"]
);

const AUTH_TOKEN_STORAGE_KEY = "fairfares.mobile.authToken";

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

export function setAuthToken(token: string) {
  authToken = token;
  const storage = browserStorage();
  if (!storage) return;
  if (token) {
    storage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } else {
    storage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
}

export function hasAuthToken() {
  return Boolean(authToken);
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
  for (const baseUrl of API_CANDIDATES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      const text = await response.text();
      let payload: T & { error?: string };
      try {
        payload = JSON.parse(text) as T & { error?: string };
      } catch {
        throw new Error(`FairFares server at ${baseUrl} returned a non-JSON response.`);
      }
      if (!response.ok) {
        const httpError = new Error(payload.error || `FairFares request failed: ${response.status}`);
        (httpError as Error & { fairFaresHttpStatus?: number }).fairFaresHttpStatus = response.status;
        throw httpError;
      }
      return payload;
    } catch (error) {
      if ((error as Error & { fairFaresHttpStatus?: number }).fairFaresHttpStatus) {
        throw error;
      }
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Could not connect to FairFares API. Tried: ${API_CANDIDATES.join(", ")}. Last error: ${lastError}. Start backend with HOST=0.0.0.0 PORT=8010 python3 app.py, then restart Expo with --clear.`);
}

function fallbackBootstrap(city = "Denver, CO"): BootstrapPayload {
  return {
    ok: true,
    user: null,
    location: { city, selected: city, suggested: "Aurora, CO" },
    housing: [],
    communities: [],
    chat: { unreadCount: 0, conversations: [] },
    dashboard: { housingPosts: 0, messages: 0 }
  };
}

export function absoluteAssetUrl(value: string) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_URL}${value.startsWith("/") ? value : `/${value}`}`;
}

export async function getBootstrap(city = "Denver, CO") {
  try {
    return await request<BootstrapPayload>(`/api/mobile/bootstrap?city=${encodeURIComponent(city)}`);
  } catch {
    return fallbackBootstrap(city);
  }
}

export async function getHousing(city: string, area: string, need: string, category = "", gender = "", budget = "", radius = "") {
  const query = new URLSearchParams({ city, area, need, category, gender, budget, radius, limit: "50" });
  const payload = await request<{ ok: boolean; posts: HousingPost[] }>(`/api/mobile/housing?${query}`);
  return payload.posts;
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

export async function getRentalBookings() {
  const payload = await request<{ ok: boolean; bookings: RentalServiceBooking[] }>("/api/mobile/rentals/bookings");
  return payload.bookings || [];
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

export async function createRentalSupportTicket(
  bookingId: string,
  topic: string,
  message: string,
  urgent = false
) {
  return request<{ ok: boolean; message: string; ticketId: string; priority: string; sla: string }>("/api/mobile/rentals/support-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingId, topic, message, urgent, preferredContact: "FairFares app" })
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

export async function getChatConversations() {
  const payload = await request<{ ok: boolean; conversations: ChatConversation[] }>("/api/chat/conversations");
  return payload.conversations || [];
}

export async function getChatCommunities() {
  const payload = await request<{ ok: boolean; communities: Community[] }>("/api/chat/communities");
  return payload.communities || [];
}

export async function getChatMessages(conversationId: string) {
  return request<{ ok: boolean; conversation: { id: string; subject: string; postId?: string; communityId?: string; kind?: string; status?: string }; messages: ChatMessage[]; hasMore: boolean; nextBefore: number }>(
    `/api/chat/messages?conversation_id=${encodeURIComponent(conversationId)}`
  );
}

export async function startChatForPost(postId: string, message: string) {
  return request<{ ok: boolean; conversation: { id: string; subject: string; communityId?: string }; message: ChatMessage | null }>("/api/chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ post_id: postId, message, client_message_id: `${Date.now()}-${Math.random().toString(36).slice(2)}` })
  });
}

export async function openCommunityChat(communityId: string) {
  return request<{ ok: boolean; conversation: { id: string; subject: string; communityId?: string }; message: ChatMessage | null }>("/api/chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ community_id: communityId })
  });
}

export async function sendChatMessage(conversationId: string, message: string) {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ conversation_id: conversationId, message, client_message_id: `${Date.now()}-${Math.random().toString(36).slice(2)}` })
  });
}

export async function editChatMessage(conversationId: string, messageId: number, message: string) {
  return request<{ ok: boolean; message: ChatMessage }>("/api/chat/messages/edit", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ conversation_id: conversationId, message_id: String(messageId), message })
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

export async function createChatCommunity(name: string, kind: "GROUP" | "COMMUNITY", description: string, area: string) {
  return request<{ ok: boolean; community: Community }>("/api/chat/communities", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ name, kind, description, area })
  });
}

export async function joinChatCommunity(communityId: string) {
  return request<{ ok: boolean; community: Community }>("/api/chat/communities/join", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ community_id: communityId })
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
  setAuthToken(payload.token);
  return payload;
}

export async function mobileSignup(name: string, email: string, phone: string, password: string) {
  const payload = await request<{ ok: boolean; activationRequired: boolean; message: string; activationLink?: string; token?: string; user?: BootstrapPayload["user"] }>(
    "/api/mobile/signup",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone, password })
    }
  );
  if (payload.token) {
    setAuthToken(payload.token);
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
