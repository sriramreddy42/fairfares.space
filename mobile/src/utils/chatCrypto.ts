import * as SecureStore from "expo-secure-store";
import nacl from "tweetnacl";
import * as util from "tweetnacl-util";

export type DeviceIdentity = { deviceId: string; publicKey: string; secretKey: string };
export type ConversationDeviceKey = { userId: number; deviceId: string; publicKey: string };

const keyName = (userId: number) => `fairfares.fchat.e2ee.${userId}`;

export async function getOrCreateDeviceIdentity(userId: number): Promise<DeviceIdentity> {
  const existing = await SecureStore.getItemAsync(keyName(userId));
  if (existing) return JSON.parse(existing) as DeviceIdentity;
  const pair = nacl.box.keyPair();
  const identity = {
    deviceId: `${Date.now().toString(36)}-${util.encodeBase64(nacl.randomBytes(12)).replace(/[^A-Za-z0-9]/g, "")}`,
    publicKey: util.encodeBase64(pair.publicKey),
    secretKey: util.encodeBase64(pair.secretKey)
  };
  await SecureStore.setItemAsync(keyName(userId), JSON.stringify(identity), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
  });
  return identity;
}

export function encryptForDevices(text: string, identity: DeviceIdentity, keys: ConversationDeviceKey[]) {
  const secretKey = util.decodeBase64(identity.secretKey);
  return keys.map((key) => {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const ciphertext = nacl.box(util.decodeUTF8(text), nonce, util.decodeBase64(key.publicKey), secretKey);
    return {
      recipientUserId: key.userId,
      recipientDeviceId: key.deviceId,
      senderPublicKey: identity.publicKey,
      nonce: util.encodeBase64(nonce),
      ciphertext: util.encodeBase64(ciphertext)
    };
  });
}

export function decryptEnvelope(envelope: { senderPublicKey: string; nonce: string; ciphertext: string }, identity: DeviceIdentity) {
  const opened = nacl.box.open(
    util.decodeBase64(envelope.ciphertext), util.decodeBase64(envelope.nonce),
    util.decodeBase64(envelope.senderPublicKey), util.decodeBase64(identity.secretKey)
  );
  return opened ? util.encodeUTF8(opened) : "";
}
