import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { registerChatDeviceKey } from "../api/client";
import { BootstrapPayload } from "../types";
import { getOrCreateDeviceIdentity } from "../utils/chatCrypto";
import { readEncryptedOutbox, updateEncryptedOutboxItem } from "../utils/chatOutbox";
import { createSignedChatRelayBundle } from "../utils/chatRelay";
import { broadcastNearbyRelayBundle, flushNearbyCarrierQueue, nearbyRelayPreferenceKey, startNearbyRelay } from "../utils/nearbyRelay";
import { isRetryableChatNetworkError } from "../utils/chatOutbox";

declare const process: {
  env: {
    EXPO_PUBLIC_ENABLE_NEARBY_RELAY?: string;
  };
};

export const NEARBY_RELAY_ENABLED_FOR_BUILD = process.env.EXPO_PUBLIC_ENABLE_NEARBY_RELAY === "true";

type RelayStatus = { running: boolean; peers: number; state: string; detail: string };
type NearbyRelayContextValue = {
  enabled: boolean;
  status: RelayStatus;
  custodyVersion: number;
  toggle: (enabled: boolean) => Promise<void>;
};

const NearbyRelayContext = createContext<NearbyRelayContextValue>({
  enabled: false,
  status: { running: false, peers: 0, state: "off", detail: "" },
  custodyVersion: 0,
  toggle: async () => undefined
});

export function NearbyRelayProvider({ user, children }: { user: BootstrapPayload["user"]; children: ReactNode }) {
  const userId = Number(user?.id || 0);
  const [enabled, setEnabled] = useState(false);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const [custodyVersion, setCustodyVersion] = useState(0);
  const [status, setStatus] = useState<RelayStatus>({ running: false, peers: 0, state: "off", detail: "" });

  useEffect(() => {
    setPreferenceLoaded(false);
    if (!userId || Platform.OS !== "android" || !NEARBY_RELAY_ENABLED_FOR_BUILD) {
      setEnabled(false);
      setPreferenceLoaded(true);
      return;
    }
    void AsyncStorage.getItem(nearbyRelayPreferenceKey(userId)).then((value) => {
      setEnabled(value === "1");
      setPreferenceLoaded(true);
    });
  }, [userId]);

  useEffect(() => {
    if (!preferenceLoaded || !enabled || !userId || Platform.OS !== "android" || !NEARBY_RELAY_ENABLED_FOR_BUILD) return;
    let stopped = false;
    let stopNative: (() => void) | undefined;
    const markCustody = async (clientMessageId: string) => {
      await updateEncryptedOutboxItem(userId, clientMessageId, { relayedAt: new Date().toISOString() });
      if (!stopped) setCustodyVersion((value) => value + 1);
    };
    const relayTick = async () => {
      await flushNearbyCarrierQueue(userId);
      const identity = await getOrCreateDeviceIdentity(userId);
      const ownItems = await readEncryptedOutbox(userId);
      for (const item of ownItems) {
        const bundle = createSignedChatRelayBundle(item, identity);
        await broadcastNearbyRelayBundle(bundle);
      }
    };
    void getOrCreateDeviceIdentity(userId).then(async (identity) => {
      try {
        await registerChatDeviceKey(identity.deviceId, identity.publicKey, identity.signingPublicKey);
      } catch (error) {
        // A previously registered device must still be able to carry sealed bundles offline.
        if (!isRetryableChatNetworkError(error)) throw error;
      }
      return startNearbyRelay({
        userId,
        displayName: `FairFares-${identity.deviceId.slice(-4)}`,
        onStatus: (next) => { if (!stopped) setStatus({ ...next, detail: next.detail || "" }); },
        onCustody: (clientMessageId) => void markCustody(clientMessageId)
      });
    }).then((cleanup) => {
      if (stopped) cleanup();
      else {
        stopNative = cleanup;
        void relayTick();
      }
    }).catch((error) => {
      if (!stopped) {
        setEnabled(false);
        void AsyncStorage.setItem(nearbyRelayPreferenceKey(userId), "0");
        setStatus({ running: false, peers: 0, state: "error", detail: error instanceof Error ? error.message : "Nearby relay could not start." });
      }
    });
    const timer = setInterval(() => void relayTick().catch(() => undefined), 8000);
    return () => {
      stopped = true;
      clearInterval(timer);
      stopNative?.();
    };
  }, [preferenceLoaded, enabled, userId]);

  async function toggle(next: boolean) {
    if (!userId || Platform.OS !== "android" || !NEARBY_RELAY_ENABLED_FOR_BUILD) return;
    setEnabled(next);
    setStatus({ running: false, peers: 0, state: next ? "starting" : "off", detail: "" });
    await AsyncStorage.setItem(nearbyRelayPreferenceKey(userId), next ? "1" : "0");
  }

  return <NearbyRelayContext.Provider value={{ enabled, status, custodyVersion, toggle }}>{children}</NearbyRelayContext.Provider>;
}

export function useNearbyRelay() {
  return useContext(NearbyRelayContext);
}
