import { BootstrapPayload, Car, HousingPost, ServiceItem } from "../types";

declare const process: {
  env: {
    EXPO_PUBLIC_FAIRFARES_API_URL?: string;
  };
};

const DEFAULT_API_URL = "http://127.0.0.1:8000";

export const API_URL =
  process.env.EXPO_PUBLIC_FAIRFARES_API_URL?.replace(/\/$/, "") || DEFAULT_API_URL;

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
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `FairFares request failed: ${response.status}`);
  }
  return payload;
}

export function absoluteAssetUrl(value: string) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_URL}${value.startsWith("/") ? value : `/${value}`}`;
}

export async function getBootstrap(city = "Denver, CO") {
  return request<BootstrapPayload>(`/api/mobile/bootstrap?city=${encodeURIComponent(city)}`);
}

export async function getHousing(city: string, area: string, need: string, category = "", gender = "", budget = "") {
  const query = new URLSearchParams({ city, area, need, category, gender, budget, limit: "50" });
  const payload = await request<{ ok: boolean; posts: HousingPost[] }>(`/api/mobile/housing?${query}`);
  return payload.posts;
}

export async function getCars() {
  const payload = await request<{ cars: Car[] }>("/api/cars");
  return payload.cars || [];
}

export async function getSiteServices() {
  const payload = await request<{ services: ServiceItem[] }>("/api/site");
  return payload.services || [];
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
