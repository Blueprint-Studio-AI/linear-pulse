import { describe, it, expect } from "vitest";
import { verifyLinearSignature } from "./verify";

const SECRET = "whs_test_secret_123";

async function sign(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("verifyLinearSignature", () => {
  it("returns true for a valid signature", async () => {
    const body = '{"action":"create","type":"Issue"}';
    const signature = await sign(body, SECRET);
    expect(await verifyLinearSignature(body, signature, SECRET)).toBe(true);
  });

  it("returns false for an invalid signature", async () => {
    const body = '{"action":"create","type":"Issue"}';
    expect(await verifyLinearSignature(body, "bad_signature", SECRET)).toBe(
      false
    );
  });

  it("returns false for a tampered body", async () => {
    const body = '{"action":"create","type":"Issue"}';
    const signature = await sign(body, SECRET);
    expect(await verifyLinearSignature(body + "x", signature, SECRET)).toBe(
      false
    );
  });
});
