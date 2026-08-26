import AsyncStorage from "@react-native-async-storage/async-storage";
import { GasFuelType, GasPriceResponse } from "../types";

const CACHE_VERSION = 2;

type GasCache = {
  version: number;
  savedAt: string;
  response: GasPriceResponse;
};

function cacheKey(fuel: GasFuelType) {
  return `fairfares.gas.last-opened.v${CACHE_VERSION}.${fuel}`;
}

export async function readGasCache(fuel: GasFuelType): Promise<GasPriceResponse | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(fuel));
    if (!raw) return null;
    const cached = JSON.parse(raw) as GasCache;
    if (cached.version !== CACHE_VERSION || !cached.response?.ok) return null;
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
