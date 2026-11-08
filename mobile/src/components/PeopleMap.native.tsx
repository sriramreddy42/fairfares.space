import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Callout, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import type { PeopleMapMember, PeopleMapProps } from "./PeopleMap";
import { UserAvatar } from "./UserAvatar";

export function PeopleMap({ members, focus, focusSelected, onMemberPress, onRegionChangeComplete }: PeopleMapProps) {
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  const points = useMemo(() => members.filter((member) => Number.isFinite(member.latitude) && Number.isFinite(member.longitude) && !(member.latitude === 0 && member.longitude === 0)), [members]);
  // Each person gets their own pin, but every pin is deliberately offset around
  // the city centre. This gives a useful visual spread without representing an
  // address, device position, or exact neighbourhood.
  const markers = useMemo(() => {
    const groups = new Map<string, PeopleMapMember[]>();
    points.forEach((member) => {
      const cityKey = member.city.trim().toLocaleLowerCase() || `${member.latitude.toFixed(2)},${member.longitude.toFixed(2)}`;
      groups.set(cityKey, [...(groups.get(cityKey) || []), member]);
    });
    return [...groups.entries()].flatMap(([cityKey, cityMembers]) => cityMembers
      .sort((left, right) => left.id - right.id)
      .map((member, index) => {
        // Space a city's members around concentric city-level rings. The outer
        // ring stays within the general city area and is deliberately unrelated
        // to homes, listings, or live device positions.
        const ringIndex = Math.floor(index / 8);
        const slots = Math.min(8, cityMembers.length - ringIndex * 8);
        const slot = index % 8;
        const angle = ((stableHash(cityKey) % 360) + (slot * 360) / slots) * Math.PI / 180;
        const radius = .030 + ringIndex * .024;
        return {
          ...member,
          key: `${member.id}-${cityKey}`,
          latitude: member.latitude + Math.cos(angle) * radius,
          longitude: member.longitude + Math.sin(angle) * radius * .82,
        };
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
        if (markers.length === 1) {
          const marker = markers[0];
          mapRef.current?.animateToRegion({ latitude: marker.latitude, longitude: marker.longitude, latitudeDelta: .18, longitudeDelta: .18 }, 300);
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
  }, [focus, focusSelected, markers, points, mapReady]);

  const center = (focusSelected ? focus : null) || points[0] || focus || { latitude: 20, longitude: 0 };
  return <MapView
    ref={mapRef}
    onMapReady={() => setMapReady(true)}
    provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
    mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
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
    {markers.map((member, index) => <PeopleMapPersonPin key={member.key} member={member} index={index} onPress={onMemberPress} />)}
  </MapView>;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function PeopleMapPersonPin({ member, index, onPress }: { member: PeopleMapMember & { latitude: number; longitude: number }; index: number; onPress?: (member: PeopleMapMember) => void }) {
  const float = useRef(new Animated.Value(0)).current;
  const isContact = member.source === "CONTACT" || member.source === "SAVED_CONTACT";
  const hasCompanyMatch = Boolean(member.boosted);
  const housingLabel = housingIntentLabel(member.housingIntent);
  const demandScale = member.housingIntent === "NEED_PLACE" ? 1.2 : 1;
  const intentStyle = member.housingIntent === "HAVE_PLACE"
    ? { halo: styles.pinHaloHavePlace, marker: styles.markerHavePlace, status: styles.pinStatusHavePlace }
    : member.housingIntent === "NEED_ROOMMATE"
      ? { halo: styles.pinHaloNeedRoommate, marker: styles.markerNeedRoommate, status: styles.pinStatusNeedRoommate }
      : { halo: styles.pinHaloNeedPlace, marker: styles.markerNeedPlace, status: styles.pinStatusNeedPlace };

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
    coordinate={{ latitude: member.latitude, longitude: member.longitude }}
    title={member.name}
    description={member.city}
    anchor={{ x: .5, y: .52 }}
    tracksViewChanges={index < 6}
  >
    <Animated.View style={[styles.pinWrap, { transform: [{ scale: (hasCompanyMatch ? 1.16 : 1) * demandScale }, { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] }]}>
      <View style={[styles.pinHalo, intentStyle.halo, isContact && styles.pinHaloContact, hasCompanyMatch && styles.pinHaloBoosted]} />
      <View style={[styles.marker, intentStyle.marker, isContact && styles.markerContact, hasCompanyMatch && styles.markerBoosted]}>
        <UserAvatar
          photoUrl={member.photoUrl}
          style={styles.markerImage}
          imageStyle={styles.markerImage}
          fallback={<Text style={styles.markerInitial}>{member.name.slice(0, 1).toUpperCase()}</Text>}
        />
        <View style={[styles.pinStatus, intentStyle.status, isContact && styles.pinStatusContact, hasCompanyMatch && styles.pinStatusBoosted]}><Text style={styles.pinStatusText}>{isContact ? "✓" : "✦"}</Text></View>
      </View>
    </Animated.View>
    <Callout tooltip onPress={() => { if (member.id > 0) onPress?.(member); }}>
      <View style={styles.callout}>
        <Text style={styles.calloutTitle}>{member.name}</Text>
        {hasCompanyMatch ? <Text style={styles.calloutMatch}>Company / school match</Text> : null}
        <Text style={styles.calloutCopy}>{member.savedContactAddress ? "Your contact · saved address, not verified" : housingLabel ? `${housingLabel} in ${member.city}` : member.moving ? `Moving to ${member.city}` : `In ${member.city}`}</Text>
        {!member.savedContactAddress && member.id > 0 ? <Text style={styles.calloutAction}>{member.housingIntent === "NEED_PLACE" ? "Tap to offer a place" : member.housingIntent === "HAVE_PLACE" ? "Tap to ask about the place" : "Tap to connect"}</Text> : null}
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
  pinHaloHavePlace: { backgroundColor: "rgba(32, 201, 149, .18)", borderColor: "rgba(13, 148, 105, .42)" },
  pinHaloNeedPlace: { backgroundColor: "rgba(114, 137, 255, .18)", borderColor: "rgba(94, 117, 231, .42)" },
  pinHaloNeedRoommate: { backgroundColor: "rgba(255, 168, 51, .20)", borderColor: "rgba(218, 126, 17, .44)" },
  pinHaloBoosted: { backgroundColor: "rgba(255, 190, 43, .24)", borderColor: "#e9a810" },
  marker: { width: 45, height: 45, borderRadius: 23, padding: 3, borderWidth: 2.5, borderColor: "#7189ff", backgroundColor: "#ffffff", shadowColor: "#0a1f19", shadowOpacity: .28, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  markerContact: { borderColor: "#20c995" },
  markerHavePlace: { borderColor: "#18ad7a" },
  markerNeedPlace: { borderColor: "#7189ff" },
  markerNeedRoommate: { borderColor: "#e18a13" },
  markerBoosted: { borderColor: "#e9a810", borderWidth: 3 },
  markerImage: { width: 33, height: 33, borderRadius: 17, backgroundColor: "#d8f7e8" },
  markerInitial: { flex: 1, color: "#087254", fontSize: 15, fontWeight: "900", textAlign: "center", textAlignVertical: "center" },
  pinStatus: { position: "absolute", right: -4, bottom: -3, minWidth: 18, paddingHorizontal: 4, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#ffffff", backgroundColor: "#6f88ff" },
  pinStatusContact: { backgroundColor: "#12a876" },
  pinStatusHavePlace: { backgroundColor: "#12a876" },
  pinStatusNeedPlace: { backgroundColor: "#6079ef" },
  pinStatusNeedRoommate: { backgroundColor: "#d87e0c" },
  pinStatusBoosted: { backgroundColor: "#dc9700" },
  pinStatusText: { color: "#ffffff", fontSize: 10, lineHeight: 12, fontWeight: "900" },
  callout: { width: 188, borderRadius: 14, backgroundColor: "#ffffff", paddingHorizontal: 12, paddingVertical: 10, shadowColor: "#0a1f19", shadowOpacity: .25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  calloutTitle: { color: "#102b25", fontSize: 12, fontWeight: "900" },
  calloutCopy: { color: "#526560", fontSize: 10, lineHeight: 14, marginTop: 3 },
  calloutMatch: { color: "#a46700", fontSize: 10, lineHeight: 14, marginTop: 4, fontWeight: "900" },
  calloutAction: { color: "#087254", fontSize: 10, lineHeight: 14, marginTop: 6, fontWeight: "900" },
  calloutPrivacy: { color: "#11865e", fontSize: 9, fontWeight: "900", marginTop: 6 },
});
