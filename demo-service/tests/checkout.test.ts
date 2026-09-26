import { describe, expect, it } from "vitest";
import { calculateCheckout, unpatchedCalculateCheckout } from "../src/pricing.js";

describe("POST /checkout", () => {
  const sampleItems = [{ sku: "A1", qty: 1, price: 90 }];

  it("accepts a cart without a promo code", () => {
    const result = calculateCheckout(sampleItems);
    expect(result.subtotal).toBe(90);
    expect(result.discountTotal).toBe(0);
    expect(result.total).toBe(90);
  });

  it("applies a percentage promo code", () => {
    const result = calculateCheckout(sampleItems, {
      code: "SAVE10",
      discount: { percent: 10 },
    });
    expect(result.subtotal).toBe(90);
    expect(result.discountTotal).toBe(9);
    expect(result.total).toBe(81);
    expect(result.promoApplied).toBe("SAVE10");
  });

  it("rejects an empty cart", () => {
    expect(() => calculateCheckout([])).toThrow("Cart cannot be empty");
  });

  it("reproduces INC-001 regression in unpatched code", () => {
    // Unpatched code throws TypeError when promo is undefined
    expect(() => unpatchedCalculateCheckout(sampleItems, undefined)).toThrow();
  });
});
