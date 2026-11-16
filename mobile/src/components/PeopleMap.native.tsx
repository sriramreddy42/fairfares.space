import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
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
        // Give every person breathing room at the default city zoom. These
        // are deterministic city-level offsets, not homes or live locations.
        const radius = .092 + ringIndex * .065;
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
        mapRef.current?.animateToRegion({ ...focus, latitudeDelta: .36, longitudeDelta: .36 }, 300);
        return;
      }
      if (points.length) {
        if (markers.length === 1) {
          const marker = markers[0];
          mapRef.current?.animateToRegion({ latitude: marker.latitude, longitude: marker.longitude, latitudeDelta: .36, longitudeDelta: .36 }, 300);
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
    initialRegion={{ latitude: center.latitude, longitude: center.longitude, latitudeDelta: focus || points.length ? .36 : 100, longitudeDelta: focus || points.length ? .36 : 100 }}
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
  const isExternalContact = member.source === "EXTERNAL_CONTACT" || member.isExternalContact;
  const isContact = member.source === "CONTACT" || member.source === "SAVED_CONTACT" || isExternalContact;
  const hasCompanyMatch = Boolean(member.boosted);
  const demandScale = member.housingIntent === "NEED_PLACE" ? 1.2 : 1;
  const intentStyle = member.housingIntent === "HAVE_PLACE"
    ? { halo: styles.pinHaloHavePlace, marker: styles.markerHavePlace, status: styles.pinStatusHavePlace }
    : member.housingIntent === "NEED_ROOMMATE"
      ? { halo: styles.pinHaloNeedRoommate, marker: styles.markerNeedRoommate, status: styles.pinStatusNeedRoommate }
      : { halo: styles.pinHaloNeedPlace, marker: styles.markerNeedPlace, status: styles.pinStatusNeedPlace };
  const housingLabel = member.housingIntent === "HAVE_PLACE"
    ? "Room available"
    : member.housingIntent === "NEED_ROOMMATE"
      ? "Need roommate"
      : member.housingIntent === "NEED_PLACE" ? "Need place" : "";
  const budget = Number(member.housingBudget || 0);
  const housingCallout = housingLabel ? `${housingLabel}${budget > 0 ? ` · up to $${Math.round(budget)}/mo` : ""}` : "";
  const companyName = String(member.companyName || "").trim();

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
    onPress={() => onPress?.(member)}
    coordinate={{ latitude: member.latitude, longitude: member.longitude }}
    anchor={{ x: .5, y: housingCallout ? .34 : .52 }}
    tracksViewChanges={index < 6}
  >
    <Animated.View style={[styles.pinWrap, { transform: [{ scale: (hasCompanyMatch ? 1.16 : 1) * demandScale }, { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }] }]}>
      <View style={[styles.pinHalo, intentStyle.halo, isContact && styles.pinHaloContact, isExternalContact && styles.pinHaloExternalContact, hasCompanyMatch && styles.pinHaloBoosted]} />
      <View style={[styles.marker, intentStyle.marker, isContact && styles.markerContact, isExternalContact && styles.markerExternalContact, hasCompanyMatch && styles.markerBoosted]}>
        <UserAvatar
          photoUrl={member.photoUrl}
          style={styles.markerImage}
          imageStyle={styles.markerImage}
          fallback={<Text style={styles.markerInitial}>{member.name.slice(0, 1).toUpperCase()}</Text>}
        />
        <View style={[styles.pinStatus, intentStyle.status, isContact && styles.pinStatusContact, isExternalContact && styles.pinStatusExternalContact, hasCompanyMatch && styles.pinStatusBoosted]}><Text style={styles.pinStatusText}>{isExternalContact ? "+" : isContact ? "✓" : "✦"}</Text></View>
      </View>
      {housingCallout ? <View style={[styles.pinHousingCallout, companyName && styles.pinHousingCalloutWithCompany, member.housingIntent === "HAVE_PLACE" ? styles.pinHousingCalloutHavePlace : member.housingIntent === "NEED_ROOMMATE" ? styles.pinHousingCalloutNeedRoommate : styles.pinHousingCalloutNeedPlace]}>{companyName ? <Text style={styles.pinHousingCompanyText} numberOfLines={1}>{companyName}</Text> : null}<Text style={styles.pinHousingCalloutText} numberOfLines={1}>{housingCallout}</Text></View> : null}
    </Animated.View>
  </Marker>;
}

const styles = StyleSheet.create({
  pinWrap: { width: 88, alignItems: "center", paddingVertical: 4 },
  pinHalo: { position: "absolute", top: 0, width: 54, height: 54, borderRadius: 27, backgroundColor: "rgba(114, 137, 255, .18)", borderWidth: 1, borderColor: "rgba(94, 117, 231, .38)" },
  pinHaloContact: { backgroundColor: "rgba(32, 201, 149, .18)", borderColor: "rgba(13, 148, 105, .38)" },
  pinHaloExternalContact: { backgroundColor: "rgba(111, 136, 255, .12)", borderColor: "rgba(96, 121, 239, .36)" },
  pinHaloHavePlace: { backgroundColor: "rgba(32, 201, 149, .18)", borderColor: "rgba(13, 148, 105, .42)" },
  pinHaloNeedPlace: { backgroundColor: "rgba(114, 137, 255, .18)", borderColor: "rgba(94, 117, 231, .42)" },
  pinHaloNeedRoommate: { backgroundColor: "rgba(255, 168, 51, .20)", borderColor: "rgba(218, 126, 17, .44)" },
  pinHaloBoosted: { backgroundColor: "rgba(255, 190, 43, .24)", borderColor: "#e9a810" },
  marker: { width: 45, height: 45, borderRadius: 23, padding: 3, borderWidth: 2.5, borderColor: "#7189ff", backgroundColor: "#ffffff", shadowColor: "#0a1f19", shadowOpacity: .28, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  markerContact: { borderColor: "#20c995" },
  markerExternalContact: { borderColor: "#7189ff", borderStyle: "dashed" },
  markerHavePlace: { borderColor: "#18ad7a" },
  markerNeedPlace: { borderColor: "#7189ff" },
  markerNeedRoommate: { borderColor: "#e18a13" },
  markerBoosted: { borderColor: "#e9a810", borderWidth: 3 },
  markerImage: { width: 33, height: 33, borderRadius: 17, backgroundColor: "#d8f7e8" },
  markerInitial: { flex: 1, color: "#087254", fontSize: 15, fontWeight: "900", textAlign: "center", textAlignVertical: "center" },
  pinStatus: { position: "absolute", right: -4, bottom: -3, minWidth: 18, paddingHorizontal: 4, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#ffffff", backgroundColor: "#6f88ff" },
  pinStatusContact: { backgroundColor: "#12a876" },
  pinStatusExternalContact: { backgroundColor: "#6079ef" },
  pinStatusHavePlace: { backgroundColor: "#12a876" },
  pinStatusNeedPlace: { backgroundColor: "#6079ef" },
  pinStatusNeedRoommate: { backgroundColor: "#d87e0c" },
  pinStatusBoosted: { backgroundColor: "#dc9700" },
  pinStatusText: { color: "#ffffff", fontSize: 10, lineHeight: 12, fontWeight: "900" },
  pinHousingCallout: { maxWidth: 126, minHeight: 19, marginTop: 4, justifyContent: "center", borderRadius: 10, borderWidth: 1, paddingHorizontal: 7, shadowColor: "#102a21", shadowOpacity: .18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  pinHousingCalloutWithCompany: { minHeight: 31, paddingVertical: 3 },
  pinHousingCalloutHavePlace: { borderColor: "#18ad7a", backgroundColor: "rgba(239,255,247,.97)" },
  pinHousingCalloutNeedPlace: { borderColor: "#7189ff", backgroundColor: "rgba(246,248,255,.97)" },
  pinHousingCalloutNeedRoommate: { borderColor: "#e18a13", backgroundColor: "rgba(255,249,238,.97)" },
  pinHousingCalloutText: { color: "#173b31", fontSize: 8, lineHeight: 10, fontWeight: "900", textAlign: "center" },
  pinHousingCompanyText: { color: "#087254", fontSize: 8, lineHeight: 10, fontWeight: "900", textAlign: "center" },
});
