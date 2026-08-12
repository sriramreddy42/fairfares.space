import AsyncStorage from "@react-native-async-storage/async-storage";
import { PermissionsAndroid, Platform } from "react-native";
import { FairFaresNearby, NearbyStatus } from "../../modules/fairfares-nearby/src";
import { isRetryableChatNetworkError } from "./chatOutbox";
import { forwardSignedChatRelayBundle, SignedChatRelayBundle } from "./chatRelay";

type RelayWireMessage =
  | { kind: "FF_RELAY_V1"; bundle: SignedChatRelayBundle }
  | { kind: "FF_RELAY_CUSTODY_V1"; clientMessageId: string };

type CarrierItem = { bundle: SignedChatRelayBundle; receivedAt: string };
const carrierKey = (userId: number) => `fairfares.chitthi.nearby-carrier.${userId}`;
export const nearbyRelayPreferenceKey = (userId: number) => `fairfares.chitthi.nearby-enabled.${userId}`;

function isRelayBundle(value: unknown): value is SignedChatRelayBundle {
  const item = value as SignedChatRelayBundle;
  return Boolean(item && item.version === 1 && item.senderUserId > 0 && item.senderDeviceId && item.conversationId &&
    item.clientMessageId && item.signature?.length >= 80 && Array.isArray(item.envelopes) && item.envelopes.length > 0 &&
    item.expiresAt > Math.floor(Date.now() / 1000));
}

async function readCarrierQueue(userId: number): Promise<CarrierItem[]> {
  try {
    const value = await AsyncStorage.getItem(carrierKey(userId));
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => isRelayBundle(item?.bundle)).slice(-50) : [];
  } catch {
    return [];
  }
}

async function writeCarrierQueue(userId: number, items: CarrierItem[]) {
  if (!items.length) await AsyncStorage.removeItem(carrierKey(userId));
  else await AsyncStorage.setItem(carrierKey(userId), JSON.stringify(items.slice(-50)));
}

async function retainCarrierBundle(userId: number, bundle: SignedChatRelayBundle) {
  const items = await readCarrierQueue(userId);
  if (!items.some((item) => item.bundle.clientMessageId === bundle.clientMessageId && item.bundle.senderUserId === bundle.senderUserId)) {
    items.push({ bundle, receivedAt: new Date().toISOString() });
    await writeCarrierQueue(userId, items);
  }
}

export async function flushNearbyCarrierQueue(userId: number) {
  const items = await readCarrierQueue(userId);
  const remaining: CarrierItem[] = [];
  let forwarded = 0;
  for (const item of items) {
    try {
      await forwardSignedChatRelayBundle(item.bundle);
      forwarded += 1;
    } catch (error) {
      if (isRetryableChatNetworkError(error)) remaining.push(item);
      // Invalid, expired, or unauthorized bundles are deliberately discarded.
    }
  }
  await writeCarrierQueue(userId, remaining);
  return { forwarded, remaining: remaining.length };
}

export async function requestNearbyRelayPermissions() {
  if (Platform.OS !== "android") return false;
  const sdk = Number(Platform.Version || 0);
  const permissions: string[] = [];
  if (sdk >= 31) {
    permissions.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE
    );
  } else {
    permissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  }
  if (sdk >= 33) permissions.push(PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES);
  const result = await PermissionsAndroid.requestMultiple(permissions as never[]) as Record<string, string>;
  return permissions.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
}

export async function startNearbyRelay(options: {
  userId: number;
  displayName: string;
  onStatus: (status: NearbyStatus) => void;
  onCustody: (clientMessageId: string) => void;
}) {
  if (!FairFaresNearby.available) throw new Error("Nearby relay requires the FairFares Android development or Play Store build.");
  const allowed = await requestNearbyRelayPermissions();
  if (!allowed) throw new Error("Nearby devices permission is required for offline relay.");
  const statusSubscription = FairFaresNearby.onStatus(options.onStatus);
  const payloadSubscription = FairFaresNearby.onPayload(async ({ endpointId, payload }) => {
    if (payload.length > 48 * 1024) return;
    let wire: RelayWireMessage;
    try { wire = JSON.parse(payload) as RelayWireMessage; } catch { return; }
    if (wire.kind === "FF_RELAY_CUSTODY_V1" && wire.clientMessageId) {
      options.onCustody(wire.clientMessageId);
      return;
    }
    if (wire.kind !== "FF_RELAY_V1" || !isRelayBundle(wire.bundle)) return;
    try {
      await forwardSignedChatRelayBundle(wire.bundle);
    } catch (error) {
      if (!isRetryableChatNetworkError(error)) return;
      await retainCarrierBundle(options.userId, wire.bundle);
    }
    await FairFaresNearby.sendTo(endpointId, JSON.stringify({ kind: "FF_RELAY_CUSTODY_V1", clientMessageId: wire.bundle.clientMessageId }));
  });
  const status = await FairFaresNearby.start(options.displayName);
  options.onStatus(status);
  return () => {
    statusSubscription.remove();
    payloadSubscription.remove();
    void FairFaresNearby.stop();
  };
}

export async function broadcastNearbyRelayBundle(bundle: SignedChatRelayBundle) {
  return FairFaresNearby.send(JSON.stringify({ kind: "FF_RELAY_V1", bundle } satisfies RelayWireMessage));
}
