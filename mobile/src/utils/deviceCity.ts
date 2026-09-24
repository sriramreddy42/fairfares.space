import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { deviceAddressCityLabel } from "./locationRegion";

const DEVICE_CITY_CACHE_KEY = "fairfares.device-city.v1";
const DEFAULT_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LAST_KNOWN_AGE_MS = 24 * 60 * 60 * 1000;
const SAME_CITY_FALLBACK_MILES = 50;

export type DeviceCityResult = {
  city: string;
  latitude: number;
  longitude: number;
  resolvedAt: number;
  source: "live" | "last-known" | "cache";
};

type CachedDeviceCity = Omit<DeviceCityResult, "source">;

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}

function distanceMiles(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const earthRadiusMiles = 3958.8;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export async function readCachedDeviceCity(maxAgeMs = DEFAULT_CACHE_AGE_MS): Promise<DeviceCityResult | null> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_CITY_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<CachedDeviceCity>;
    const city = String(cached.city || "").trim();
    const latitude = Number(cached.latitude);
    const longitude = Number(cached.longitude);
    const resolvedAt = Number(cached.resolvedAt);
    if (!city || !validCoordinate(latitude, longitude) || !Number.isFinite(resolvedAt) || Date.now() - resolvedAt > maxAgeMs) return null;
    return { city, latitude, longitude, resolvedAt, source: "cache" };
  } catch {
    return null;
  }
}

async function livePositionWithTimeout(timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveCurrentDeviceCity(options: {
  liveTimeoutMs?: number;
  lastKnownMaxAgeMs?: number;
  allowCachedFallback?: boolean;
} = {}): Promise<DeviceCityResult | null> {
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) return options.allowCachedFallback ? readCachedDeviceCity() : null;

  const cached = options.allowCachedFallback ? await readCachedDeviceCity() : null;
  const livePosition = await livePositionWithTimeout(options.liveTimeoutMs ?? 8_000);
  const position = livePosition || await Location.getLastKnownPositionAsync({
    // A city feed does not require navigation-grade freshness. Keeping a
    // day-old coarse fix makes the feature reliable indoors and after reboot.
    maxAge: options.lastKnownMaxAgeMs ?? DEFAULT_LAST_KNOWN_AGE_MS,
    requiredAccuracy: 25_000,
  }).catch(() => null);

  if (!position) return cached;
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  if (!validCoordinate(latitude, longitude)) return cached;

  const [address] = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
  const city = deviceAddressCityLabel(address).trim();
  if (city) {
    const result: DeviceCityResult = {
      city,
      latitude,
      longitude,
      resolvedAt: Date.now(),
      source: livePosition ? "live" : "last-known",
    };
    const stored: CachedDeviceCity = { city, latitude, longitude, resolvedAt: result.resolvedAt };
    void AsyncStorage.setItem(DEVICE_CITY_CACHE_KEY, JSON.stringify(stored)).catch(() => undefined);
    return result;
  }

  // Native reverse geocoding occasionally returns no address. Reuse the
  // verified city only when the new coordinate is still in the same metro.
  if (cached && distanceMiles(latitude, longitude, cached.latitude, cached.longitude) <= SAME_CITY_FALLBACK_MILES) {
    return { ...cached, latitude, longitude };
  }
  return null;
}
