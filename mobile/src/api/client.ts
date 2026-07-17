import { BootstrapPayload, Car, HousingPost, RentalBooking, ServiceItem } from "../types";
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

let authToken = "";

export function setAuthToken(token: string) {
  authToken = token;
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
        throw new Error(payload.error || `FairFares request failed: ${response.status}`);
      }
      return payload;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (EXPLICIT_API_URL) {
        break;
      }
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

export async function getAccommodationLocationOptions(city: string) {
  const cleanCity = city.trim();
  if (!cleanCity) return null;
  try {
    return await request<AccommodationLocationOptions>(`/api/mobile/location-options?city=${encodeURIComponent(cleanCity)}`);
  } catch {
    return null;
  }
}

export async function getCars() {
  const payload = await request<{ cars: Car[] }>("/api/mobile/rentals");
  return payload.cars || [];
}

export async function bookRentalCar(carId: number) {
  return request<{ ok: boolean; booking: RentalBooking }>("/api/mobile/rentals/book", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ carId, days: 3 })
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
};

export async function createMobileHousingPost(input: MobileHousingPostInput) {
  return request<{ ok: boolean; post: HousingPost }>("/api/mobile/housing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}
