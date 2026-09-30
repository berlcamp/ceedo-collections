import { describe, expect, it } from "vitest";
import { singleFlight } from "./single-flight";

describe("singleFlight", () => {
  it("shares one run between callers that overlap it", async () => {
    let runs = 0;
    let release!: (v: number) => void;
    const once = singleFlight(() => {
      runs++;
      return new Promise<number>((resolve) => (release = resolve));
    });

    const a = once();
    const b = once();
    release(7);

    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(runs).toBe(1);
  });

  it("starts a fresh run once the last one settled", async () => {
    let runs = 0;
    const once = singleFlight(async () => ++runs);

    expect(await once()).toBe(1);
    expect(await once()).toBe(2);
  });

  it("hands a failure to every waiting caller, then lets the next call run", async () => {
    let runs = 0;
    const once = singleFlight(async () => {
      runs++;
      if (runs === 1) throw new Error("no signal");
      return "ok";
    });

    const [a, b] = await Promise.allSettled([once(), once()]);
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("rejected");
    expect(await once()).toBe("ok");
    expect(runs).toBe(2);
  });
});
