import React from "react";
import { Text, View } from "react-native";
import type { PeopleMapProps } from "./PeopleMap";

export function PeopleMap({ members }: PeopleMapProps) {
  const cities = [...new Set(members.filter((member) => member.city).map((member) => member.city))];
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}><Text style={{ textAlign: "center" }}>The friends map is available in the FairFares mobile app.</Text><Text style={{ marginTop: 6, textAlign: "center" }}>{cities.length ? `Shared city areas: ${cities.join(", ")}` : "No shared city areas yet."}</Text></View>;
}
