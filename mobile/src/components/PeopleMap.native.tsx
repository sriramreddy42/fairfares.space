import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import type { PeopleMapMember, PeopleMapProps } from "./PeopleMap";
import { UserAvatar } from "./UserAvatar";

export function PeopleMap({ members, focus, focusSelected, onMemberPress, onAreaPress, onRegionChangeComplete }: PeopleMapProps) {
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
        const radius = .125 + ringIndex * .085;
        return {
          ...member,
          key: `${member.id}-${cityKey}`,
          latitude: member.latitude + Math.cos(angle) * radius,
          longitude: member.longitude + Math.sin(angle) * radius * .82,
        };
      }));
  }, [points]);
  // An affiliation-only search has no chosen city. At that level, show one
  // marker per city with a member count; individual pins appear after a city
  // is selected. This keeps a nationwide/company result legible.
  const areaMarkers = useMemo(() => [...new Map(points.map((member) => [member.city.trim().toLocaleLowerCase(), member])).entries()].map(([key, representative]) => ({
    key,
    city: representative.city,
    latitude: representative.latitude,
    longitude: representative.longitude,
    count: points.filter((member) => member.city.trim().toLocaleLowerCase() === key).length,
  })), [points]);
  const isAreaOverview = !focusSelected;
  // react-native-maps on iOS can abort inside AIRMap when Fabric reconciles a
  // changing marker child list in place. Remount the native map when the pin
  // dataset/mode actually changes instead of asking AIRMap to insert and move
  // custom marker views in an existing hierarchy.
  const mapContentKey = useMemo(() => `${isAreaOverview ? "areas" : "people"}:${(isAreaOverview ? areaMarkers : markers).map((marker) => marker.key).join("|")}`, [areaMarkers, isAreaOverview, markers]);

  useEffect(() => {
    if (!mapReady) return;
    const timer = setTimeout(() => {
      if (focusSelected && focus && Number.isFinite(focus.latitude) && Number.isFinite(focus.longitude)) {
        mapRef.current?.animateToRegion({ ...focus, latitudeDelta: .36, longitudeDelta: .36 }, 300);
        return;
      }
      if (points.length) {
        if ((isAreaOverview ? areaMarkers : markers).length === 1) {
          const marker = (isAreaOverview ? areaMarkers : markers)[0];
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
  }, [areaMarkers, focus, focusSelected, isAreaOverview, markers, points, mapReady]);

  const center = (focusSelected ? focus : null) || points[0] || focus || { latitude: 20, longitude: 0 };
  return <MapView
    key={mapContentKey}
    ref={mapRef}
    onMapReady={() => setMapReady(true)}
    provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
    // Muted Standard keeps roads and parkland legible on iOS without competing
    // with member pins, housing labels, and the map controls.
    mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
    userInterfaceStyle="light"
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
    {isAreaOverview
      ? areaMarkers.map((area) => <PeopleMapAreaPin key={area.key} city={area.city} latitude={area.latitude} longitude={area.longitude} count={area.count} onPress={onAreaPress} />)
      : markers.map((member) => <PeopleMapPersonPin key={member.key} member={member} onPress={onMemberPress} />)}
  </MapView>;
}

function PeopleMapAreaPin({ city, latitude, longitude, count, onPress }: { city: string; latitude: number; longitude: number; count: number; onPress?: (city: string) => void }) {
  return <Marker coordinate={{ latitude, longitude }} onPress={() => onPress?.(city)} tracksViewChanges={false}>
    <View style={styles.areaPin}><Text style={styles.areaPinCount}>{count}</Text><Text style={styles.areaPinCity} numberOfLines={1}>{city.split(",")[0]}</Text></View>
  </Marker>;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function PeopleMapPersonPin({ member, onPress }: { member: PeopleMapMember & { latitude: number; longitude: number }; onPress?: (member: PeopleMapMember) => void }) {
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
  // The map is a spatial overview. Rent stays in the member/listing card
  // after a tap; repeating it beside every pin makes dense cities unreadable.
  const housingCallout = housingLabel;
  const rawCompanyName = String(member.companyName || "").trim();
  const companyName = rawCompanyName ? (member.isViewer ? `You · ${rawCompanyName}` : rawCompanyName) : "";
  const companyOnLeft = stableHash(`${member.id}:${companyName}`) % 2 === 0;

  return <Marker
    onPress={() => onPress?.(member)}
    coordinate={{ latitude: member.latitude, longitude: member.longitude }}
    anchor={{ x: .5, y: housingCallout ? .34 : .52 }}
    // Custom marker subviews are static. Tracking their React updates is the
    // iOS AIRMap crash path; imagery loads correctly on the next map remount.
    tracksViewChanges={false}
  >
    <View style={[styles.pinWrap, { transform: [{ scale: (hasCompanyMatch ? 1.16 : 1) * demandScale }] }]}>
      <View style={styles.pinMarkerStage}>
        <View style={[styles.pinHalo, intentStyle.halo, isContact && styles.pinHaloContact, isExternalContact && styles.pinHaloExternalContact, hasCompanyMatch && styles.pinHaloBoosted, member.isViewer && styles.pinHaloViewer]} />
        <View style={styles.pinMarkerRow}>
          <View style={[styles.pinCompanySlot, styles.pinCompanySlotLeft]}>{companyName && companyOnLeft ? <View style={[styles.pinCompanySide, member.isViewer && styles.pinCompanySideViewer]}><Text style={[styles.pinCompanySideText, member.isViewer && styles.pinCompanySideTextViewer]} numberOfLines={1}>{companyName}</Text></View> : null}</View>
          <View style={[styles.marker, intentStyle.marker, isContact && styles.markerContact, isExternalContact && styles.markerExternalContact, hasCompanyMatch && styles.markerBoosted, member.isViewer && styles.markerViewer]}>
            <UserAvatar
              photoUrl={member.photoUrl}
              style={styles.markerImage}
              imageStyle={styles.markerImage}
              fallback={<Text style={styles.markerInitial}>{member.name.slice(0, 1).toUpperCase()}</Text>}
            />
            <View style={[styles.pinStatus, intentStyle.status, isContact && styles.pinStatusContact, isExternalContact && styles.pinStatusExternalContact, hasCompanyMatch && styles.pinStatusBoosted, member.isViewer && styles.pinStatusViewer]}><Text style={styles.pinStatusText}>{member.isViewer ? "•" : isExternalContact ? "+" : isContact ? "✓" : "✦"}</Text></View>
          </View>
          <View style={[styles.pinCompanySlot, styles.pinCompanySlotRight]}>{companyName && !companyOnLeft ? <View style={[styles.pinCompanySide, member.isViewer && styles.pinCompanySideViewer]}><Text style={[styles.pinCompanySideText, member.isViewer && styles.pinCompanySideTextViewer]} numberOfLines={1}>{companyName}</Text></View> : null}</View>
        </View>
      </View>
      {housingCallout ? <View style={[styles.pinHousingCallout, member.housingIntent === "HAVE_PLACE" ? styles.pinHousingCalloutHavePlace : member.housingIntent === "NEED_ROOMMATE" ? styles.pinHousingCalloutNeedRoommate : styles.pinHousingCalloutNeedPlace]}><Text style={styles.pinHousingCalloutText} numberOfLines={1}>{housingCallout}</Text></View> : null}
    </View>
  </Marker>;
}

const styles = StyleSheet.create({
  areaPin: { minWidth: 58, paddingHorizontal: 9, paddingVertical: 7, alignItems: "center", borderRadius: 18, borderWidth: 2, borderColor: "#c78300", backgroundColor: "#fff8df", shadowColor: "#573a00", shadowOpacity: .25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  areaPinCount: { color: "#9b6200", fontSize: 20, fontWeight: "900", lineHeight: 22 },
  areaPinCity: { maxWidth: 94, color: "#263e35", fontSize: 9, fontWeight: "900", marginTop: 1 },
  pinWrap: { width: 198, alignItems: "center", paddingVertical: 4 },
  pinMarkerStage: { position: "relative", width: "100%", height: 54, alignItems: "center" },
  pinMarkerRow: { width: "100%", height: 54, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  pinHalo: { position: "absolute", top: 0, width: 54, height: 54, borderRadius: 27, backgroundColor: "rgba(114, 137, 255, .18)", borderWidth: 1, borderColor: "rgba(94, 117, 231, .38)" },
  pinHaloContact: { backgroundColor: "rgba(32, 201, 149, .18)", borderColor: "rgba(13, 148, 105, .38)" },
  pinHaloExternalContact: { backgroundColor: "rgba(111, 136, 255, .12)", borderColor: "rgba(96, 121, 239, .36)" },
  pinHaloHavePlace: { backgroundColor: "rgba(32, 201, 149, .18)", borderColor: "rgba(13, 148, 105, .42)" },
  pinHaloNeedPlace: { backgroundColor: "rgba(114, 137, 255, .18)", borderColor: "rgba(94, 117, 231, .42)" },
  pinHaloNeedRoommate: { backgroundColor: "rgba(255, 168, 51, .20)", borderColor: "rgba(218, 126, 17, .44)" },
  pinHaloBoosted: { backgroundColor: "rgba(255, 190, 43, .24)", borderColor: "#e9a810" },
  pinHaloViewer: { backgroundColor: "rgba(19, 192, 135, .22)", borderColor: "#0da875", borderWidth: 2 },
  marker: { width: 45, height: 45, borderRadius: 23, padding: 3, borderWidth: 2.5, borderColor: "#7189ff", backgroundColor: "#ffffff", shadowColor: "#0a1f19", shadowOpacity: .28, shadowRadius: 7, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  markerContact: { borderColor: "#20c995" },
  markerExternalContact: { borderColor: "#7189ff", borderStyle: "dashed" },
  markerHavePlace: { borderColor: "#18ad7a" },
  markerNeedPlace: { borderColor: "#7189ff" },
  markerNeedRoommate: { borderColor: "#e18a13" },
  markerBoosted: { borderColor: "#e9a810", borderWidth: 3 },
  markerViewer: { borderColor: "#0da875", borderWidth: 3 },
  markerImage: { width: 33, height: 33, borderRadius: 17, backgroundColor: "#d8f7e8" },
  markerInitial: { flex: 1, color: "#087254", fontSize: 15, fontWeight: "900", textAlign: "center", textAlignVertical: "center" },
  pinStatus: { position: "absolute", right: -4, bottom: -3, minWidth: 18, paddingHorizontal: 4, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#ffffff", backgroundColor: "#6f88ff" },
  pinStatusContact: { backgroundColor: "#12a876" },
  pinStatusExternalContact: { backgroundColor: "#6079ef" },
  pinStatusHavePlace: { backgroundColor: "#12a876" },
  pinStatusNeedPlace: { backgroundColor: "#6079ef" },
  pinStatusNeedRoommate: { backgroundColor: "#d87e0c" },
  pinStatusBoosted: { backgroundColor: "#dc9700" },
  pinStatusViewer: { backgroundColor: "#087d59" },
  pinStatusText: { color: "#ffffff", fontSize: 10, lineHeight: 12, fontWeight: "900" },
  pinCompanySlot: { width: 72, height: 54, justifyContent: "center" },
  pinCompanySlotLeft: { alignItems: "flex-end", paddingRight: 4 },
  pinCompanySlotRight: { alignItems: "flex-start", paddingLeft: 4 },
  // Every FairFares member with a saved company or school gets the same
  // readable affiliation pill. Only the viewer adds the “You ·” prefix.
  pinCompanySide: { maxWidth: 76, minHeight: 22, justifyContent: "center", borderRadius: 11, borderWidth: 1, borderColor: "rgba(255,255,255,.92)", paddingHorizontal: 8, backgroundColor: "#075e47", shadowColor: "#102a21", shadowOpacity: .24, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  pinCompanySideText: { color: "#ffffff", fontSize: 9, lineHeight: 11, fontWeight: "900", textAlign: "center" },
  // The member's own affiliation is a useful orientation cue. Give it a
  // stronger treatment than other company labels without changing their map
  // density or prominence.
  // Reserve enough content width for the full “You · Company” string instead
  // of letting the normal compact company slot truncate the member's own tag.
  pinCompanySideViewer: { minWidth: 96, maxWidth: 112, minHeight: 25, paddingHorizontal: 9, borderRadius: 13, borderWidth: 1.5, borderColor: "#ffffff", shadowOpacity: .26, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  pinCompanySideTextViewer: { color: "#ffffff", fontSize: 10, lineHeight: 12, fontWeight: "900" },
  pinHousingCallout: { maxWidth: 96, minHeight: 19, marginTop: 4, justifyContent: "center", borderRadius: 10, borderWidth: 1, paddingHorizontal: 7, shadowColor: "#102a21", shadowOpacity: .18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  pinHousingCalloutHavePlace: { borderColor: "#18ad7a", backgroundColor: "rgba(239,255,247,.97)" },
  pinHousingCalloutNeedPlace: { borderColor: "#7189ff", backgroundColor: "rgba(246,248,255,.97)" },
  pinHousingCalloutNeedRoommate: { borderColor: "#e18a13", backgroundColor: "rgba(255,249,238,.97)" },
  pinHousingCalloutText: { color: "#173b31", fontSize: 8, lineHeight: 10, fontWeight: "900", textAlign: "center" },
});
