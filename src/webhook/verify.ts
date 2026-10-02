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

// Constant-time string comparison for shared secrets (admin token, Telegram
// webhook secret). An unset expected value never matches.
export function secretMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected || provided === undefined) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
