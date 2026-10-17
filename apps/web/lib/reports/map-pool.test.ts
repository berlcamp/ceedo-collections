// apps/web/lib/reports/map-pool.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServerClient: vi.fn() }));
vi.mock("@/lib/ledger/queries", () => ({ recoveredCollectionIds: vi.fn() }));

const { mapPool } = await import("./data");

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("mapPool", () => {
  it("keeps input order and never has more than the limit in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapPool([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      for (let i = 0; i < n; i++) await tick();
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70]);
    expect(peak).toBe(3);
  });

  it("rejects when any call rejects", async () => {
    await expect(mapPool([1, 2], 2, async (n) => { if (n === 2) throw new Error("day 2"); return n; }))
      .rejects.toThrow("day 2");
  });

  it("returns nothing for nothing", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});
