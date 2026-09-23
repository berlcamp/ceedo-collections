import { describe, expect, it } from "vitest";
import { decodeLeaseCard, encodeLeaseCard } from "./lease-card";
import { encodeEnrollment } from "./enrollment-payload";

describe("the lease card payload", () => {
  const leaseId = "33333333-3333-4333-8333-333333333333";

  it("is exactly CEEDO:1:<lease-uuid>, and nothing else", () => {
    // §9.2: no name, no balance -- the card hangs in a public market.
    expect(encodeLeaseCard(leaseId)).toBe(`CEEDO:1:${leaseId}`);
  });

  it("round-trips", () => {
    expect(decodeLeaseCard(encodeLeaseCard(leaseId))).toBe(leaseId);
  });

  it("is byte-identical on reprint, whatever case the id arrived in", () => {
    expect(encodeLeaseCard(leaseId.toUpperCase())).toBe(encodeLeaseCard(leaseId));
  });

  it("reads a scanner that upper-cased the text, and normalises the id", () => {
    expect(decodeLeaseCard(`ceedo:1:${leaseId.toUpperCase()}`)).toBe(leaseId);
    expect(decodeLeaseCard(`  CEEDO:1:${leaseId}\n`)).toBe(leaseId);
  });

  it("refuses an enrollment code, so the two screens cannot misread each other", () => {
    expect(decodeLeaseCard(encodeEnrollment("cred-1", "a".repeat(64)))).toBeNull();
  });

  it("refuses other versions, malformed ids and unrelated text", () => {
    expect(decodeLeaseCard(`CEEDO:2:${leaseId}`)).toBeNull();
    expect(decodeLeaseCard("CEEDO:1:not-a-uuid")).toBeNull();
    expect(decodeLeaseCard(`CEEDO:1:${leaseId}:extra`)).toBeNull();
    expect(decodeLeaseCard("https://example.com")).toBeNull();
    expect(decodeLeaseCard("")).toBeNull();
  });

  it("will not encode something that is not a lease id", () => {
    expect(() => encodeLeaseCard("Dry Goods-01")).toThrow();
  });
});
