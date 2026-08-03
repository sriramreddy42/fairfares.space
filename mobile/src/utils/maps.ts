import { Platform } from "react-native";

export const nativeMapProviderName = Platform.OS === "ios" ? "Apple Maps" : "Google Maps";

export function mapSearchUrl(query: string) {
  const encodedQuery = encodeURIComponent(query.trim());
  if (Platform.OS === "ios") {
    return `https://maps.apple.com/?q=${encodedQuery}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;
}

export function mapDirectionsUrl(origin: string, destination: string) {
  const encodedOrigin = encodeURIComponent(origin.trim());
  const encodedDestination = encodeURIComponent(destination.trim());
  if (Platform.OS === "ios") {
    return `https://maps.apple.com/?saddr=${encodedOrigin}&daddr=${encodedDestination}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&origin=${encodedOrigin}&destination=${encodedDestination}&travelmode=driving`;
}

export function mapCoordinatesUrl(latitude: number, longitude: number) {
  return mapSearchUrl(`${latitude},${longitude}`);
}
