import AsyncStorage from "@react-native-async-storage/async-storage";
import { GasFuelType, GasPriceResponse } from "../types";

const CACHE_VERSION = 2;

type GasCache = {
  version: number;
  savedAt: string;
  response: GasPriceResponse;
};

type Coordinates = { latitude: number; longitude: number };

function coordinateDistanceMiles(left: Coordinates, right: Coordinates) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cacheKey(fuel: GasFuelType) {
  return `fairfares.gas.last-opened.v${CACHE_VERSION}.${fuel}`;
}

export async function readGasCache(fuel: GasFuelType, near?: Coordinates, maxDistanceMiles = 5): Promise<GasPriceResponse | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(fuel));
    if (!raw) return null;
    const cached = JSON.parse(raw) as GasCache;
    if (cached.version !== CACHE_VERSION || !cached.response?.ok) return null;
    if (near && (!cached.response.center || coordinateDistanceMiles(cached.response.center, near) > maxDistanceMiles)) return null;
    return cached.response;
  } catch {
    return null;
  }
}

export async function writeGasCache(fuel: GasFuelType, response: GasPriceResponse) {
  if (!response.ok) return;
  const value: GasCache = {
    version: CACHE_VERSION,
    savedAt: new Date().toISOString(),
    response,
  };
  await AsyncStorage.setItem(cacheKey(fuel), JSON.stringify(value));
}
