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
    ? [EXPLICIT_API_URL, "http://127.0.0.1:8010", metroHostApiUrl(), "http://172.20.10.6:8010"]
    : [EXPLICIT_API_URL, metroHostApiUrl(), "http://172.20.10.6:8010", "http://127.0.0.1:8010"]
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

const fallbackHousing: HousingPost[] = [
  {
    id: "FFH-OFFLINE-HAVE-PLACE",
    title: "Furnished private room available near DU",
    description: "Private furnished room in a quiet shared home near University of Denver. Good for students or professionals looking for a clean month-to-month place with parking and light rail nearby.",
    mode: "HAVE_PLACE",
    modeLabel: "Place available",
    category: "single_room",
    categoryLabel: "Single Room",
    location: "Denver, CO",
    area: "DU, University Park",
    workLocation: "University of Denver",
    moveIn: "08/01/2026",
    rent: "$900-$1,100 / monthly",
    rentValue: 900,
    radiusMiles: 10,
    distanceMiles: 4.5,
    lat: 39.6781,
    lng: -104.9618,
    imageUrl: "",
    daysLeft: 30,
    expiryLabel: "30 days left",
    roommateIntent: false,
    genderPreference: "Open",
    leaseTerm: "Flexible",
    bathroomType: "Shared Bath",
    accommodates: 1,
    roommateCount: 0,
    amenities: ["Parking", "Utilities", "Light rail"]
  }
];

const fallbackCars: Car[] = [
  { id: 1, name: "Toyota Corolla", brand: "Toyota", model: "Corolla", year: 2025, category: "Economy", type: "Sedan", fuel_type: "Gasoline", seats: 5, bags: 2, doors: 4, transmission: "Automatic", daily_price: 29.99, badge: "Great Price", features: "Free Cancellation|Unlimited Mileage|Fuel Efficient", location: "Denver International Airport (DEN)", image_url: "/static/img/toyota-corolla-sedan-denver-rental.png", booked_until_date: "", booked_until_time: "" },
  { id: 2, name: "Nissan Sentra", brand: "Nissan", model: "Sentra", year: 2025, category: "Compact", type: "Sedan", fuel_type: "Gasoline", seats: 5, bags: 2, doors: 4, transmission: "Automatic", daily_price: 34.99, badge: "Student Deal", features: "Free Cancellation|Unlimited Mileage|Hybrid Option", location: "Denver International Airport (DEN)", image_url: "/static/img/nissan-sentra-sedan-denver-rental.png", booked_until_date: "", booked_until_time: "" },
  { id: 3, name: "Honda Civic", brand: "Honda", model: "Civic", year: 2025, category: "Midsize", type: "Sedan", fuel_type: "Gasoline", seats: 5, bags: 2, doors: 4, transmission: "Automatic", daily_price: 39.99, badge: "Popular", features: "Unlimited Mileage|Safe & Reliable|Fuel Efficient", location: "Denver International Airport (DEN)", image_url: "/static/img/honda-civic-sedan-denver-rental.png", booked_until_date: "", booked_until_time: "" }
];

function fallbackBootstrap(city = "Denver, CO"): BootstrapPayload {
  return {
    ok: true,
    user: null,
    location: { city, selected: city, suggested: "Aurora, CO" },
    housing: fallbackHousing,
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

export async function getHousing(city: string, area: string, need: string, category = "", gender = "", budget = "") {
  const query = new URLSearchParams({ city, area, need, category, gender, budget, limit: "50" });
  try {
    const payload = await request<{ ok: boolean; posts: HousingPost[] }>(`/api/mobile/housing?${query}`);
    return payload.posts;
  } catch {
    return fallbackHousing.filter((post) => !category || post.category === category);
  }
}

export async function getCars() {
  try {
    const payload = await request<{ cars: Car[] }>("/api/mobile/rentals");
    return payload.cars || [];
  } catch {
    return fallbackCars;
  }
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
  return request<{ ok: boolean; activationRequired: boolean; message: string; activationLink?: string }>(
    "/api/mobile/signup",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone, password })
    }
  );
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
