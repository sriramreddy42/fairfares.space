import * as Location from "expo-location";
import { Alert, Linking } from "react-native";

type LocationPermissionCopy = {
  title?: string;
  requestMessage: string;
  settingsMessage?: string;
};

export async function requestUserLocationPermission(copy: LocationPermissionCopy): Promise<boolean> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status === Location.PermissionStatus.GRANTED || permission.granted) return true;

  const title = copy.title || "Location permission needed";
  if (permission.canAskAgain) {
    Alert.alert(title, copy.requestMessage);
    return false;
  }

  Alert.alert(
    title,
    copy.settingsMessage || "Enable location for FairFares in Settings to use this feature.",
    [
      { text: "Not now", style: "cancel" },
      { text: "Open Settings", onPress: () => void Linking.openSettings() }
    ]
  );
  return false;
}
