import React from "react";

export type RideMapPoint = {
  latitude: number;
  longitude: number;
};

export function EmbeddedRideMap(_: { origin: RideMapPoint; destination: RideMapPoint }) {
  return null;
}
