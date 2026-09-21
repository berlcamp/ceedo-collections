import { describe, expect, it } from "vitest";
import { encodeEnrollment, decodeEnrollment } from "./enrollment-payload";

describe("the enrollment payload", () => {
  const credentialId = "cred-11111111-2222-3333-4444-555555555555";
  const secret = "a".repeat(64);

  it("round-trips", () => {
    expect(decodeEnrollment(encodeEnrollment(credentialId, secret))).toEqual({
      credentialId,
      secret,
    });
  });

  it("carries a checksum that rejects a single mistyped character", () => {
    /**
     * Manual entry is the MANDATORY fallback (parent §9.4 sets this rule for QR in this
     * system and the reasoning is identical for a camera that fails at 5am). Sixty-four hex
     * characters typed by hand at a desk will sometimes be wrong, and a wrong secret fails
     * at the first sync with `unauthorized` -- indistinguishable from a revoked credential,
     * a wrong gateway key, or a server that is down.
     *
     * The checksum turns that into an immediate, local, unambiguous error.
     */
    const encoded = encodeEnrollment(credentialId, secret);
    const corrupted = encoded.replace(secret, "b" + secret.slice(1));
    expect(decodeEnrollment(corrupted)).toBeNull();
  });

  it("rejects text that is not an enrollment payload at all", () => {
    expect(decodeEnrollment("https://example.com")).toBeNull();
    expect(decodeEnrollment("")).toBeNull();
  });
});
