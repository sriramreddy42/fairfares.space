import * as Location from "expo-location";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from "react-native";
import { getNearbyGasPrices, nearbyGasMapUrl } from "../api/client";
import { GasFuelType, GasStation } from "../types";
import { readGasCache, writeGasCache } from "../utils/gasPriceCache";

type Props = { onBack: () => void };
type Coordinates = { latitude: number; longitude: number };

async function currentLocationWithTimeout(timeoutMs = 15_000) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("location-timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function resolveDeviceCoordinates(): Promise<Coordinates> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error("Allow location access in Settings to compare fuel prices near you.");

  const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!servicesEnabled) throw new Error("Turn on Location Services, then try again.");

  // Gas prices must follow the device, never the independently selected Ask
  // feed city. Always request a fresh GPS fix first. A tightly bounded native
  // last-known fix is only a cold-start fallback and cannot come from the feed
  // city picker (which stores labels, not device coordinates).
  const live = await currentLocationWithTimeout().catch(() => null);
  const recent = live ? null : await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000, requiredAccuracy: 1000 }).catch(() => null);
  const location = live || recent;
  if (!location) throw new Error("We couldn't determine your location. Move near a window, check Location Services, and try again.");
  return { latitude: location.coords.latitude, longitude: location.coords.longitude };
}

const fuelOptions: Array<{ key: GasFuelType; label: string }> = [
  { key: "regular", label: "Regular" },
  { key: "midgrade", label: "Midgrade" },
  { key: "premium", label: "Premium" },
  { key: "diesel", label: "Diesel" },
];

function priceLabel(station: GasStation) {
  return station.price == null ? "No price" : `$${station.price.toFixed(2)}`;
}

async function openMapUrl(nativeUrl: string, fallbackUrl: string) {
  try {
    if (await Linking.canOpenURL(nativeUrl)) {
      await Linking.openURL(nativeUrl);
      return;
    }
  } catch {
    // Continue to the universal HTTPS fallback.
  }
  await Linking.openURL(fallbackUrl);
}

async function openStationDirections(station: GasStation) {
  const destination = `${station.latitude},${station.longitude}`;
  const name = encodeURIComponent(station.name || "Gas station");
  const fallback = station.googleMapsUri || `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  const nativeUrl = Platform.OS === "ios"
    ? `maps://?daddr=${destination}&q=${name}`
    : `geo:${destination}?q=${destination}(${name})`;
  await openMapUrl(nativeUrl, fallback);
}

async function openNearbyGasMaps(position: Coordinates | null) {
  const center = position ? `${position.latitude},${position.longitude}` : "";
  const fallback = `https://www.google.com/maps/search/?api=1&query=gas+stations${center ? `&center=${center}` : ""}`;
  const nativeUrl = Platform.OS === "ios"
    ? `maps://?q=gas%20stations${center ? `&ll=${center}` : ""}`
    : `geo:${center || "0,0"}?q=gas%20stations`;
  await openMapUrl(nativeUrl, fallback);
}

function freshnessLabel(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Update time unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 2) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

export function GasStationsScreen({ onBack }: Props) {
  const isLight = useColorScheme() === "light";
  const [fuel, setFuel] = useState<GasFuelType>("regular");
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [stations, setStations] = useState<GasStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState("");
  const [showingCached, setShowingCached] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const requestGeneration = useRef(0);

  const load = useCallback(async (refresh = false, nextFuel = fuel) => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    refresh ? setRefreshing(true) : setLoading(true);
    setError("");
    setShowingCached(false);
    setMapFailed(false);
    let restoredCache = false;
    try {
      if (!refresh) {
        const cached = await readGasCache(nextFuel);
        if (cached) {
          if (requestGeneration.current !== generation) return;
          setPosition(cached.center);
          setConfigured(cached.configured);
          setStations(cached.stations || []);
          setShowingCached(true);
          restoredCache = true;
        }
      }
      // Entering Cheap Gas is an explicit user request, so always acquire the
      // current device position and refresh the provider data on each visit.
      const coordinates = await resolveDeviceCoordinates();
      setPosition(coordinates);
      const result = await getNearbyGasPrices(coordinates.latitude, coordinates.longitude, 10, nextFuel);
      if (requestGeneration.current !== generation) return;
      await writeGasCache(nextFuel, result).catch(() => undefined);
      setConfigured(result.configured);
      setStations(result.stations || []);
      setShowingCached(false);
    } catch (cause) {
      if (requestGeneration.current !== generation) return;
      if (!restoredCache) setStations([]);
      const message = cause instanceof Error ? cause.message : "Nearby fuel prices are temporarily unavailable.";
      setError(restoredCache
        ? "Fresh prices could not be loaded. Showing the last successful results from this device."
        : message.includes("HTTP 404")
        ? "Nearby fuel prices are being activated. Please try again shortly."
        : message);
    } finally {
      if (requestGeneration.current !== generation) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [fuel, position]);

  useEffect(() => { void load(false, fuel); }, [fuel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { requestGeneration.current += 1; }, []);

  const mapUrl = useMemo(() => position ? nearbyGasMapUrl(position.latitude, position.longitude, stations) : "", [position, stations]);
  const pricedStations = stations.filter((station) => station.price != null);
  const lowestId = pricedStations[0]?.id || "";

  return (
    <View style={[styles.screen, isLight ? styles.screenLight : styles.screenDark]}>
      <View style={[styles.header, isLight ? styles.headerLight : styles.headerDark]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back to Ask Community">
          <Text style={[styles.backGlyph, isLight ? styles.darkText : styles.lightText]}>‹</Text>
        </TouchableOpacity>
        <View style={styles.gasBadge}><Text style={styles.gasGlyph}>⛽</Text></View>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, isLight ? styles.darkText : styles.lightText]}>Cheap gas near you</Text>
          <Text style={styles.muted}>Last reported nearby prices</Text>
        </View>
      </View>

      <View style={styles.fuelRow}>
        {fuelOptions.map((option) => (
          <TouchableOpacity key={option.key} onPress={() => setFuel(option.key)} style={[styles.fuelChip, isLight && styles.fuelChipLight, fuel === option.key && styles.fuelChipActive]}>
            <Text style={[styles.fuelText, fuel === option.key && styles.fuelTextActive]}>{option.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {mapUrl && !mapFailed ? (
        <TouchableOpacity style={[styles.mapFrame, isLight && styles.cardShadow]} activeOpacity={0.9} onPress={() => void openNearbyGasMaps(position)} accessibilityRole="imagebutton" accessibilityLabel={Platform.OS === "ios" ? "Open nearby gas stations in Apple Maps" : "Open nearby gas stations in Maps"}>
          <Image source={{ uri: mapUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setMapFailed(true)} />
        </TouchableOpacity>
      ) : <View style={[styles.mapFrame, styles.mapLoading]}>{loading ? <ActivityIndicator color="#18b981" /> : <><Text style={styles.mapEmptyGlyph}>⛽</Text><Text style={styles.mapEmptyTitle}>{mapFailed ? "Map preview unavailable" : "Location needed for the map"}</Text><Text style={styles.mapEmptyBody}>{mapFailed ? "Station results and directions remain available below." : "Turn on location access, then try again."}</Text></>}</View>}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor="#18b981" />}>
        {loading ? <View style={styles.state}><ActivityIndicator color="#18b981" /><Text style={styles.muted}>Checking nearby stations…</Text></View> : null}
        {!loading && (!configured || error) ? (
          <View style={[styles.notice, isLight ? styles.cardLight : styles.cardDark]}>
            <Text style={[styles.noticeTitle, isLight ? styles.darkText : styles.lightText]}>{showingCached ? "Showing saved prices" : "Prices unavailable right now"}</Text>
            <Text style={styles.muted}>{configured ? error : "Fuel-price service is being configured. You can still open nearby stations in Maps."}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => void load(true)}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
          </View>
        ) : null}
        {!loading && configured && !error && stations.length === 0 ? (
          <View style={[styles.notice, isLight ? styles.cardLight : styles.cardDark]}><Text style={[styles.noticeTitle, isLight ? styles.darkText : styles.lightText]}>No reported prices nearby</Text><Text style={styles.muted}>Try another fuel grade or refresh. Google does not report a price for every station.</Text></View>
        ) : null}
        {stations.map((station) => (
          <TouchableOpacity key={`row-${station.id || station.googleMapsUri}`} activeOpacity={0.78} onPress={() => void openStationDirections(station)} accessibilityRole="button" accessibilityLabel={`Open directions to ${station.name}`} style={[styles.stationCard, isLight ? styles.cardLight : styles.cardDark, isLight && styles.cardShadow]}>
            <View style={[styles.stationIcon, station.id === lowestId && styles.stationIconLowest]}><Text style={styles.stationGlyph}>⛽</Text></View>
            <View style={styles.stationCopy}>
              <Text numberOfLines={1} style={[styles.stationName, isLight ? styles.darkText : styles.lightText]}>{station.name}</Text>
              <Text numberOfLines={2} style={styles.address}>{station.address}</Text>
              {station.id === lowestId ? <Text style={styles.lowestLabel}>LOWEST REPORTED PRICE</Text> : null}
            </View>
            <View style={styles.priceCopy}>
              <Text style={[styles.price, station.price == null && styles.noPrice]}>{priceLabel(station)}</Text>
              <Text style={styles.distance}>{station.distanceMiles.toFixed(1)} mi</Text>
              {station.price != null ? <Text style={styles.updated}>{freshnessLabel(station.updatedAt)}</Text> : null}
              <Text style={styles.chevron}>›</Text>
            </View>
          </TouchableOpacity>
        ))}
        <Text style={styles.googleAttribution}>Station information and prices: Google Maps</Text>
        <Text style={styles.disclaimer}>Prices may be delayed and should be confirmed at the pump. Results cover up to 10 nearby stations and are ordered by reported price, then distance.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, screenLight: { backgroundColor: "#f0f2f5" }, screenDark: { backgroundColor: "#0f1011" },
  header: { minHeight: 68, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth }, headerLight: { backgroundColor: "#fff", borderBottomColor: "#d8dce1" }, headerDark: { backgroundColor: "#17191a", borderBottomColor: "#303335" },
  backButton: { width: 36, height: 44, justifyContent: "center" }, backGlyph: { fontSize: 42, lineHeight: 42, fontWeight: "300" }, gasBadge: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#dff8ec" }, gasGlyph: { fontSize: 24 }, headerCopy: { flex: 1, paddingLeft: 11 }, headerTitle: { fontSize: 20, fontWeight: "800" },
  fuelRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12 }, fuelChip: { flex: 1, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 18, borderWidth: 1, borderColor: "#3b4143", backgroundColor: "#191b1c" }, fuelChipLight: { backgroundColor: "#fff", borderColor: "#d8dce1" }, fuelChipActive: { backgroundColor: "#147a58", borderColor: "#147a58" }, fuelText: { color: "#8b9299", fontSize: 11, fontWeight: "700" }, fuelTextActive: { color: "#fff" },
  mapFrame: { height: 278, marginHorizontal: 12, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: "rgba(19,122,87,0.24)", backgroundColor: "#dce6df" }, mapLoading: { alignItems: "center", justifyContent: "center" },
  mapEmptyGlyph: { fontSize: 38 }, mapEmptyTitle: { color: "#27443a", fontSize: 15, fontWeight: "800", marginTop: 8 }, mapEmptyBody: { color: "#6f827b", fontSize: 11, marginTop: 3 },
  list: { flex: 1 }, listContent: { padding: 12, paddingBottom: 108, gap: 9 }, state: { minHeight: 90, alignItems: "center", justifyContent: "center", gap: 10 }, notice: { padding: 18, borderRadius: 18, gap: 8 }, noticeTitle: { fontSize: 17, fontWeight: "800" }, retryButton: { alignSelf: "flex-start", marginTop: 5, borderRadius: 18, backgroundColor: "#18b981", paddingHorizontal: 18, paddingVertical: 9 }, retryText: { color: "#06291e", fontWeight: "900" },
  stationCard: { minHeight: 92, flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 18, borderWidth: 1 }, cardLight: { backgroundColor: "#fff", borderColor: "rgba(15,23,42,0.06)" }, cardDark: { backgroundColor: "#191b1c", borderColor: "#303335" }, cardShadow: { shadowColor: "#14251f", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  stationIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#fff2dc" }, stationIconLowest: { backgroundColor: "#dff8ec" }, stationGlyph: { fontSize: 25 }, stationCopy: { flex: 1, minWidth: 0, paddingHorizontal: 11 }, stationName: { fontSize: 16, fontWeight: "800" }, address: { color: "#778087", fontSize: 11, lineHeight: 15, marginTop: 3 }, lowestLabel: { color: "#12935f", fontSize: 8, fontWeight: "900", letterSpacing: .5, marginTop: 4 }, priceCopy: { minWidth: 78, alignItems: "flex-end" }, price: { color: "#12935f", fontSize: 18, fontWeight: "900" }, noPrice: { color: "#8b9299", fontSize: 12 }, distance: { color: "#778087", fontSize: 11, marginTop: 2 }, updated: { color: "#92999e", fontSize: 8, marginTop: 2 }, chevron: { color: "#778087", fontSize: 24, lineHeight: 24 },
  muted: { color: "#7f878d", fontSize: 12, lineHeight: 17 }, darkText: { color: "#151719" }, lightText: { color: "#f5f7f6" }, googleAttribution: { color: "#5e5e5e", fontSize: 12, fontWeight: "400", textAlign: "center", paddingTop: 8 }, disclaimer: { color: "#7f878d", fontSize: 10, lineHeight: 15, textAlign: "center", paddingHorizontal: 14, paddingTop: 5 },
});
