import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Callout, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import type { PeopleMapMember, PeopleMapProps } from "./PeopleMap";

export function PeopleMap({ members, focus, focusSelected, onAreaPress, onRegionChangeComplete }: PeopleMapProps) {
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  const points = useMemo(() => members.filter((member) => Number.isFinite(member.latitude) && Number.isFinite(member.longitude) && !(member.latitude === 0 && member.longitude === 0)), [members]);
  // A city is an area, not a precise location. Members in the same city share a
  // single friendly cluster, so dense places remain readable and never expose a
  // street-level position.
  const areas = useMemo(() => {
    const grouped = new Map<string, PeopleMapMember[]>();
    for (const member of points) {
      const key = member.city.trim().toLocaleLowerCase() || `${member.latitude.toFixed(2)},${member.longitude.toFixed(2)}`;
      grouped.set(key, [...(grouped.get(key) || []), member]);
    }
    return [...grouped.values()].map((areaMembers) => ({
      key: `${areaMembers[0].city}-${areaMembers[0].latitude}-${areaMembers[0].longitude}`,
      city: areaMembers[0].city || "Nearby",
      latitude: areaMembers.reduce((total, member) => total + member.latitude, 0) / areaMembers.length,
      longitude: areaMembers.reduce((total, member) => total + member.longitude, 0) / areaMembers.length,
      members: areaMembers,
      total: Math.max(areaMembers.length, ...areaMembers.map((member) => Number(member.areaTotal || 1))),
      companyMatches: Math.max(...areaMembers.map((member) => Number(member.companyMatchCount || 0))),
    }));
  }, [points]);

  useEffect(() => {
    if (!mapReady) return;
    const timer = setTimeout(() => {
      if (focusSelected && focus && Number.isFinite(focus.latitude) && Number.isFinite(focus.longitude)) {
        mapRef.current?.animateToRegion({ ...focus, latitudeDelta: .18, longitudeDelta: .18 }, 300);
        return;
      }
      if (points.length) {
        if (areas.length === 1) {
          const area = areas[0];
          mapRef.current?.animateToRegion({ latitude: area.latitude, longitude: area.longitude, latitudeDelta: .18, longitudeDelta: .18 }, 300);
          return;
        }
        mapRef.current?.fitToCoordinates(points.map((member) => ({ latitude: member.latitude, longitude: member.longitude })), {
          edgePadding: { top: 70, right: 42, bottom: 74, left: 42 },
          animated: false,
        });
        return;
      }
      if (focus && Number.isFinite(focus.latitude) && Number.isFinite(focus.longitude)) {
        mapRef.current?.animateToRegion({ latitude: focus.latitude, longitude: focus.longitude, latitudeDelta: .34, longitudeDelta: .34 }, 250);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [areas, focus, focusSelected, points, mapReady]);

  const center = (focusSelected ? focus : null) || points[0] || focus || { latitude: 20, longitude: 0 };
  return <MapView
    ref={mapRef}
    onMapReady={() => setMapReady(true)}
    provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
    style={StyleSheet.absoluteFillObject}
    initialRegion={{ latitude: center.latitude, longitude: center.longitude, latitudeDelta: focus || points.length ? .18 : 100, longitudeDelta: focus || points.length ? .18 : 100 }}
    toolbarEnabled={false}
    showsCompass={false}
    scrollEnabled
    zoomEnabled
    rotateEnabled
    pitchEnabled
    zoomTapEnabled
    moveOnMarkerPress={false}
    onRegionChangeComplete={onRegionChangeComplete}
  >
    {areas.map((area, index) => <PeopleMapAreaPin key={area.key} area={area} index={index} onPress={onAreaPress} />)}
  </MapView>;
}

function PeopleMapAreaPin({ area, index, onPress }: { onPress?: () => void; area: { city: string; latitude: number; longitude: number; members: PeopleMapMember[]; total: number; companyMatches: number }; index: number }) {
  const float = useRef(new Animated.Value(0)).current;
  const primary = area.members[0];
  const isContact = area.members.some((member) => member.source === "CONTACT");
  const count = area.total;
  const hasCompanyMatch = area.companyMatches > 0;
  const firstName = primary.name.trim().split(/\s+/)[0] || "Friend";
  const label = count === 1 ? firstName : area.city.replace(/,\s*[A-Z]{2}$/i, "");
  const housingLabel = housingIntentLabel(primary.housingIntent);

  useEffect(() => {
    // Keep the map alive without a storm of animated markers on a dense map.
    // The first few visible people get a gentle offset; all others stay still.
    if (index > 5) return undefined;
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(index * 180),
      Animated.timing(float, { toValue: 1, duration: 1500 + index * 90, useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 1500 + index * 90, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [float, index]);

  return <Marker
    onPress={onPress}
    coordinate={{ latitude: area.latitude, longitude: area.longitude }}
    title={count === 1 ? primary.name : `${count} people in ${area.city}`}
    description={area.city}
    anchor={{ x: .5, y: .52 }}
    tracksViewChanges={index < 6}
  >
    <Animated.View style={[styles.pinWrap, { transform: [{ scale: hasCompanyMatch ? 1.15 + Math.min(.35, Math.log2(area.companyMatches + 1) * .07) : 1 }, { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] }]}>
      <View style={[styles.pinHalo, isContact && styles.pinHaloContact, hasCompanyMatch && styles.pinHaloBoosted]} />
      <View style={[styles.marker, isContact && styles.markerContact, hasCompanyMatch && styles.markerBoosted]}>
        {primary.photoUrl ? <Image source={{ uri: primary.photoUrl }} style={styles.markerImage} /> : <Text style={styles.markerInitial}>{primary.name.slice(0, 1).toUpperCase()}</Text>}
        <View style={[styles.pinStatus, isContact && styles.pinStatusContact, hasCompanyMatch && styles.pinStatusBoosted]}><Text style={styles.pinStatusText}>{count > 1 ? count : isContact ? "✓" : "✦"}</Text></View>
      </View>
      <View style={styles.pinNameTag}><Text style={styles.pinName} numberOfLines={1}>{label}</Text><View style={[styles.pinDot, isContact && styles.pinDotContact]} /></View>
      {housingLabel ? <View style={styles.pinIntentTag}><Text style={styles.pinIntent}>{housingLabel}</Text></View> : null}
    </Animated.View>
    <Callout tooltip>
      <View style={styles.callout}>
        <Text style={styles.calloutTitle}>{count === 1 ? primary.name : `${count} people around ${area.city}`}</Text>
        {hasCompanyMatch ? <Text style={styles.calloutMatch}>{area.companyMatches} company / school match{area.companyMatches === 1 ? "" : "es"}</Text> : null}
        <Text style={styles.calloutCopy} numberOfLines={3}>{area.members.map((member) => `${member.name} · ${housingIntentLabel(member.housingIntent) || (member.moving ? `Moving to ${area.city}` : "Living here")}`).join("\n")}</Text>
        <Text style={styles.calloutPrivacy}>City area only</Text>
      </View>
    </Callout>
  </Marker>;
}

function housingIntentLabel(intent?: string) {
  if (intent === "HAVE_PLACE") return "I have a place";
  if (intent === "NEED_PLACE") return "I need a place";
  if (intent === "NEED_ROOMMATE") return "Need roommates";
  return "";
}

const styles = StyleSheet.create({
  pinWrap: { width: 88, alignItems: "center", paddingVertical: 4 },
  pinHalo: { position: "absolute", top: 0, width: 54, height: 54, borderRadius: 27, backgroundColor: "rgba(114, 137, 255, .18)", borderWidth: 1, borderColor: "rgba(94, 117, 231, .38)" },
  pinHaloContact: { backgroundColor: "rgba(32, 201, 149, .18)", borderColor: "rgba(13, 148, 105, .38)" },
  pinHaloBoosted: { backgroundColor: "rgba(255, 190, 43, .24)", borderColor: "#e9a810" },
  marker: { width: 45, height: 45, borderRadius: 23, padding: 3, borderWidth: 2.5, borderColor: "#7189ff", backgroundColor: "#ffffff", shadowColor: "#0a1f19", shadowOpacity: .28, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  markerContact: { borderColor: "#20c995" },
  markerBoosted: { borderColor: "#e9a810", borderWidth: 3 },
  markerImage: { width: 33, height: 33, borderRadius: 17, backgroundColor: "#d8f7e8" },
  markerInitial: { flex: 1, color: "#087254", fontSize: 15, fontWeight: "900", textAlign: "center", textAlignVertical: "center" },
  pinStatus: { position: "absolute", right: -4, bottom: -3, minWidth: 18, paddingHorizontal: 4, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#ffffff", backgroundColor: "#6f88ff" },
  pinStatusContact: { backgroundColor: "#12a876" },
  pinStatusBoosted: { backgroundColor: "#dc9700" },
  pinStatusText: { color: "#ffffff", fontSize: 10, lineHeight: 12, fontWeight: "900" },
  pinNameTag: { maxWidth: 86, minHeight: 20, marginTop: 3, flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 10, borderWidth: 1, borderColor: "rgba(20, 39, 63, .14)", backgroundColor: "rgba(255,255,255,.96)", paddingHorizontal: 6, shadowColor: "#173a32", shadowOpacity: .14, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  pinName: { maxWidth: 58, color: "#18322d", fontSize: 9, lineHeight: 11, fontWeight: "900" },
  pinIntentTag: { maxWidth: 88, marginTop: 2, borderRadius: 8, backgroundColor: "rgba(16,43,37,.90)", paddingHorizontal: 5, paddingVertical: 2 },
  pinIntent: { color: "#ffffff", fontSize: 8, lineHeight: 10, fontWeight: "900" },
  pinDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#7189ff" },
  pinDotContact: { backgroundColor: "#20c995" },
  callout: { width: 188, borderRadius: 14, backgroundColor: "#ffffff", paddingHorizontal: 12, paddingVertical: 10, shadowColor: "#0a1f19", shadowOpacity: .25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  calloutTitle: { color: "#102b25", fontSize: 12, fontWeight: "900" },
  calloutCopy: { color: "#526560", fontSize: 10, lineHeight: 14, marginTop: 3 },
  calloutMatch: { color: "#a46700", fontSize: 10, lineHeight: 14, marginTop: 4, fontWeight: "900" },
  calloutPrivacy: { color: "#11865e", fontSize: 9, fontWeight: "900", marginTop: 6 },
});
