import { fromPesos } from "@ceedo/shared";
import { describe, expect, it } from "vitest";
import { closeNotice } from "./close-result";

describe("the notice shown after closing a recovered shift", () => {
  it("reports a balanced close", () => {
    expect(closeNotice(fromPesos(0))).toEqual({
      tone: "success",
      message: "Balanced.",
      shortageLink: false,
    });
  });

  it("reports a short close and points to Shortages", () => {
    const notice = closeNotice(fromPesos(-10));
    expect(notice.tone).toBe("warning");
    expect(notice.message).toBe("Short ₱10.00 — record repayments under Shortages.");
    expect(notice.shortageLink).toBe(true);
  });

  it("reports an over close with no Shortages link", () => {
    const notice = closeNotice(fromPesos(10));
    expect(notice.tone).toBe("warning");
    expect(notice.message).toBe("Over ₱10.00.");
    expect(notice.shortageLink).toBe(false);
  });
});
