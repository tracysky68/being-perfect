const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error("Invalid PAYUNi encrypted value");
  return new Uint8Array(hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

function base64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function importKey(hashKey: string) {
  if (encoder.encode(hashKey.trim()).length !== 32) throw new Error("PAYUNi Hash Key must be 32 bytes");
  return crypto.subtle.importKey("raw", encoder.encode(hashKey.trim()), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptPayuni(data: Record<string, string>, hashKey: string, hashIv: string) {
  const key = await importKey(hashKey);
  const iv = encoder.encode(hashIv.trim());
  if (iv.length !== 16) throw new Error("PAYUNi IV must be 16 bytes");
  const plaintext = new URLSearchParams(data).toString();
  const combined = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, encoder.encode(plaintext)));
  const ciphertext = combined.slice(0, -16);
  const tag = combined.slice(-16);
  return bytesToHex(encoder.encode(`${base64(ciphertext)}:::${base64(tag)}`));
}

export async function decryptPayuni(encryptedHex: string, hashKey: string, hashIv: string) {
  const [ciphertextBase64, tagBase64] = decoder.decode(hexToBytes(encryptedHex)).split(":::");
  if (!ciphertextBase64 || !tagBase64) throw new Error("Malformed PAYUNi encrypted value");
  const ciphertext = fromBase64(ciphertextBase64);
  const tag = fromBase64(tagBase64);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext); combined.set(tag, ciphertext.length);
  const key = await importKey(hashKey);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: encoder.encode(hashIv.trim()), tagLength: 128 }, key, combined);
  return Object.fromEntries(new URLSearchParams(decoder.decode(decrypted)).entries());
}

export async function payuniHash(encryptedHex: string, hashKey: string, hashIv: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${hashKey.trim()}${encryptedHex}${hashIv.trim()}`));
  return bytesToHex(new Uint8Array(digest)).toUpperCase();
}

export function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
