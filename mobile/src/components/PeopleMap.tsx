import React from "react";
import { Text, View } from "react-native";

export type PeopleMapMember = {
  id: number;
  name: string;
  photoUrl: string;
  city: string;
  latitude: number;
  longitude: number;
  source: "CONTACT" | "MUTUAL";
  areaTotal?: number;
  companyMatchCount?: number;
  boosted?: boolean;
  moving?: boolean;
  fromCity?: string;
  housingIntent?: "HAVE_PLACE" | "NEED_PLACE" | "NEED_ROOMMATE" | "";
};

export type PeopleMapFocus = {
  latitude: number;
  longitude: number;
};

export type PeopleMapRegion = PeopleMapFocus & {
  latitudeDelta: number;
  longitudeDelta: number;
};

export type PeopleMapProps = {
  members: PeopleMapMember[];
  onAreaPress?: () => void;
  // The viewer's own device/city focus. This is never rendered as another
  // member's location and is used only to give an empty map a useful start.
  focus?: PeopleMapFocus | null;
  focusSelected?: boolean;
  onRegionChangeComplete?: (region: PeopleMapRegion) => void;
};

// Typecheck and unsupported-platform fallback. Native builds use
// PeopleMap.native.tsx, which renders the interactive map.
export function PeopleMap({ members }: PeopleMapProps) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}><Text style={{ textAlign: "center" }}>{members.length ? "Friends map is available in the FairFares mobile app." : "No shared city areas yet."}</Text></View>;
}
