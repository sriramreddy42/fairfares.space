import { sha256 } from "@noble/hashes/sha256";
import nacl from "tweetnacl";
import * as util from "tweetnacl-util";
import { relayEncryptedChatMessage } from "../api/client";
import { DeviceIdentity } from "./chatCrypto";
import { EncryptedEnvelope, EncryptedOutboxItem } from "./chatOutbox";

export type SignedChatRelayBundle = {
  version: 1;
  senderUserId: number;
  senderDeviceId: string;
  conversationId: string;
  clientMessageId: string;
  createdAt: number;
  expiresAt: number;
  envelopes: EncryptedEnvelope[];
  signature: string;
};

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function normalizedEnvelopeJson(envelopes: EncryptedEnvelope[]) {
  return JSON.stringify(envelopes.map((item) => ({
    ciphertext: String(item.ciphertext || ""),
    nonce: String(item.nonce || ""),
    recipientDeviceId: String(item.recipientDeviceId || ""),
    recipientUserId: Number(item.recipientUserId || 0),
    senderPublicKey: String(item.senderPublicKey || "")
  })));
}

export function chatRelaySignaturePayload(bundle: Omit<SignedChatRelayBundle, "signature">) {
  const envelopeHash = hex(sha256(util.decodeUTF8(normalizedEnvelopeJson(bundle.envelopes))));
  return [
    "FFRELAY1", String(bundle.senderUserId), bundle.senderDeviceId, bundle.conversationId,
    bundle.clientMessageId, String(bundle.createdAt), String(bundle.expiresAt), envelopeHash
  ].join("\n");
}

export function createSignedChatRelayBundle(item: EncryptedOutboxItem, identity: DeviceIdentity, lifetimeSeconds = 600): SignedChatRelayBundle {
  if (item.userId <= 0 || !identity.signingSecretKey || !identity.signingPublicKey) {
    throw new Error("Secure nearby relay is not initialized on this device.");
  }
  const createdAt = Math.floor(Date.now() / 1000);
  const unsigned = {
    version: 1 as const,
    senderUserId: item.userId,
    senderDeviceId: identity.deviceId,
    conversationId: item.conversationId,
    clientMessageId: item.clientMessageId,
    createdAt,
    expiresAt: createdAt + Math.min(900, Math.max(60, lifetimeSeconds)),
    envelopes: item.envelopes
  };
  const signature = nacl.sign.detached(util.decodeUTF8(chatRelaySignaturePayload(unsigned)), util.decodeBase64(identity.signingSecretKey));
  return { ...unsigned, signature: util.encodeBase64(signature) };
}

// The nearby transport passes this opaque object unchanged. The relay device
// never receives the sender's private keys or plaintext.
export async function forwardSignedChatRelayBundle(bundle: SignedChatRelayBundle) {
  return relayEncryptedChatMessage(bundle as unknown as Record<string, unknown>);
}
