export async function verifyLinearSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );

    // Convert hex signature to Uint8Array for constant-time comparison
    const sigBytes = hexToBytes(signature);
    if (!sigBytes) return false;

    return crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(rawBody));
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (isNaN(byte)) return null;
    bytes[i / 2] = byte;
  }
  return bytes;
}

export function isTimestampValid(
  webhookTimestamp: number,
  maxDriftMs: number = 60_000
): boolean {
  return Math.abs(Date.now() - webhookTimestamp) <= maxDriftMs;
}
