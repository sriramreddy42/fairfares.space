import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";

export type RideMapPoint = {
  latitude: number;
  longitude: number;
};

export function EmbeddedRideMap({ origin, destination }: { origin: RideMapPoint; destination: RideMapPoint }) {
  const mapRef = useRef<MapView>(null);
  const coordinates = [origin, destination];

  const frameRoute = () => mapRef.current?.fitToCoordinates(coordinates, {
    edgePadding: { top: 84, right: 48, bottom: 72, left: 48 },
    animated: false
  });

  useEffect(() => {
    const timer = setTimeout(frameRoute, 120);
    return () => clearTimeout(timer);
  }, [origin.latitude, origin.longitude, destination.latitude, destination.longitude]);

  return (
    <MapView
      ref={mapRef}
      provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
      style={StyleSheet.absoluteFillObject}
      initialRegion={{
        latitude: (origin.latitude + destination.latitude) / 2,
        longitude: (origin.longitude + destination.longitude) / 2,
        latitudeDelta: Math.max(Math.abs(origin.latitude - destination.latitude) * 1.5, 0.08),
        longitudeDelta: Math.max(Math.abs(origin.longitude - destination.longitude) * 1.5, 0.08)
      }}
      onMapReady={frameRoute}
      showsUserLocation
      showsMyLocationButton
      toolbarEnabled={false}
    >
      <Marker coordinate={origin} title="Pickup" pinColor="#14c98b" />
      <Marker coordinate={destination} title="Destination" pinColor="#4d7cff" />
      <Polyline coordinates={coordinates} strokeColor="#4d7cff" strokeWidth={5} lineDashPattern={[12, 8]} />
    </MapView>
  );
}
