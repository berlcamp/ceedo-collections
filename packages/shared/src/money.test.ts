import { describe, expect, it } from "vitest";
import {
  applyBasisPoints,
  format,
  fromCentavos,
  fromPesos,
  multiply,
  parsePesoInput,
  toDecimalString,
  sum,
} from "./money.js";

describe("fromPesos", () => {
  it("converts whole pesos to centavos", () => {
    expect(fromPesos(120)).toBe(12000);
  });

  it("converts two-decimal pesos exactly", () => {
    expect(fromPesos(123.45)).toBe(12345);
  });

  it("rounds a third decimal half-up", () => {
    expect(fromPesos(1.005)).toBe(101);
  });

  it("rejects a non-finite amount", () => {
    expect(() => fromPesos(Number.NaN)).toThrow(/finite/);
  });
});

describe("multiply", () => {
  it("multiplies by an integer quantity exactly", () => {
    expect(multiply(fromPesos(85), 12)).toBe(102000);
  });

  it("rejects a fractional quantity", () => {
    expect(() => multiply(fromPesos(85), 1.5)).toThrow(/integer/);
  });

  it("rejects a negative quantity", () => {
    expect(() => multiply(fromPesos(85), -1)).toThrow(/negative/);
  });
});

describe("applyBasisPoints", () => {
  it("computes 3% of a round amount", () => {
    expect(applyBasisPoints(fromPesos(120), 300)).toBe(360);
  });

  it("rounds a half-centavo result up rather than down", () => {
    // 8350 centavos x 3% = 250.5 centavos exactly. Half-up gives 251.
    // A float pipeline that floors -- Math.floor(0.03 * 8350) is Math.floor(250.5) -- would
    // give 250. The error is rounding direction, not representation: 0.03 * 8350 is exactly
    // 250.5 in IEEE 754.
    expect(applyBasisPoints(fromCentavos(8350), 300)).toBe(251);
  });

  it("computes 3% of an odd amount", () => {
    expect(applyBasisPoints(fromCentavos(12345), 300)).toBe(370);
  });

  it("returns zero for a zero rate", () => {
    expect(applyBasisPoints(fromPesos(120), 0)).toBe(0);
  });

  it("rejects a fractional basis-point rate", () => {
    expect(() => applyBasisPoints(fromPesos(120), 300.5)).toThrow(/integer/);
  });
});

describe("sum", () => {
  it("adds a list of amounts", () => {
    expect(sum([fromPesos(120), fromPesos(85), fromCentavos(50)])).toBe(20550);
  });

  it("returns zero for an empty list", () => {
    expect(sum([])).toBe(0);
  });
});

describe("format", () => {
  it("formats with a peso sign, thousands separators and two decimals", () => {
    expect(format(fromCentavos(123456))).toBe("₱1,234.56");
  });

  it("formats zero", () => {
    expect(format(fromCentavos(0))).toBe("₱0.00");
  });
});

describe("parsePesoInput", () => {
  it("parses a plain decimal", () => {
    expect(parsePesoInput("123.45")).toBe(12345);
  });

  it("parses input with a peso sign and separators", () => {
    expect(parsePesoInput("₱1,234.56")).toBe(123456);
  });

  it("rejects unparseable input", () => {
    expect(() => parsePesoInput("abc")).toThrow(/amount/);
  });
});

describe("toDecimalString", () => {
  it("renders the wire form, with no sign and no separators", () => {
    expect(toDecimalString(fromCentavos(22550))).toBe("225.50");
    expect(toDecimalString(fromCentavos(0))).toBe("0.00");
    expect(toDecimalString(fromCentavos(5))).toBe("0.05");
    expect(toDecimalString(fromCentavos(123456789))).toBe("1234567.89");
  });

  it("keeps the sign on a negative variance, because over and short differ", () => {
    expect(toDecimalString(fromCentavos(-5000))).toBe("-50.00");
    expect(toDecimalString(fromCentavos(-5))).toBe("-0.05");
  });

  it("produces exactly what the wire contract's `money` accepts", () => {
    const money = /^-?\d+\.\d{2}$/;
    for (const cents of [0, 1, 99, 100, 101, -1, -99, -100, 999999999]) {
      expect(toDecimalString(fromCentavos(cents))).toMatch(money);
    }
  });
});
