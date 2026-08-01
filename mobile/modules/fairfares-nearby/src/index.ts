import { EventEmitter, requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

type NearbyStatus = { running: boolean; peers: number; state: string; detail?: string };
type PayloadEvent = { endpointId: string; payload: string };

const nativeModule = Platform.OS === "android" ? requireOptionalNativeModule("FairFaresNearby") : null;
const emitter: any = nativeModule ? new EventEmitter(nativeModule) : null;

export const FairFaresNearby = {
  available: Platform.OS === "android" && Boolean(nativeModule),
  start: async (displayName: string): Promise<NearbyStatus> => nativeModule?.start(displayName) || { running: false, peers: 0, state: "unsupported" },
  stop: async (): Promise<NearbyStatus> => nativeModule?.stop() || { running: false, peers: 0, state: "unsupported" },
  send: async (payload: string): Promise<{ sent: number }> => nativeModule?.send(payload) || { sent: 0 },
  sendTo: async (endpointId: string, payload: string): Promise<{ sent: number }> => nativeModule?.sendTo(endpointId, payload) || { sent: 0 },
  status: async (): Promise<NearbyStatus> => nativeModule?.status() || { running: false, peers: 0, state: "unsupported" },
  onStatus: (listener: (status: NearbyStatus) => void) => emitter?.addListener("onStatus", listener) || { remove() {} },
  onPayload: (listener: (event: PayloadEvent) => void) => emitter?.addListener("onPayload", listener) || { remove() {} }
};

export type { NearbyStatus, PayloadEvent };
