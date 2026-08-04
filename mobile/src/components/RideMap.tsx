import React from "react";

export type RideMapPoint = {
  latitude: number;
  longitude: number;
};

// TypeScript and non-native platforms resolve this fallback. Metro selects
// RideMap.native.tsx for iOS and Android production builds.
export function EmbeddedRideMap(_: { origin: RideMapPoint; destination: RideMapPoint }) {
  return null;
}
