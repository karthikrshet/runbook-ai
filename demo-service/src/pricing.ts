export interface CartItem {
  sku: string;
  qty: number;
  price: number;
}

export interface PromoCode {
  code: string;
  discount: {
    percent: number;
  };
}

export interface CheckoutResult {
  items: CartItem[];
  subtotal: number;
  discountTotal: number;
  total: number;
  promoApplied?: string;
}

/**
 * Calculates cart total and applies optional promotional discount.
 *
 * NOTE (INC-001 REGRESSION):
 * Commit 9f3c2ab introduced promo code support but assumed `promo` is always
 * passed as an object. When a customer checks out without a promo code,
 * evaluating `promo.discount.percent` throws a TypeError:
 * "Cannot read properties of undefined (reading 'discount')", resulting in a 500 error.
 */
export function calculateCheckout(items: CartItem[], promo?: PromoCode): CheckoutResult {
  if (items.length === 0) {
    throw new Error("Cart cannot be empty");
  }

  const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);

  let discountTotal = 0;
  let promoApplied: string | undefined;

  // The bug triggers when promo is undefined:
  if (promo !== undefined && typeof promo.discount.percent === "number") {
    discountTotal = (subtotal * promo.discount.percent) / 100;
    promoApplied = promo.code;
  }

  const total = subtotal - discountTotal;

  return {
    items,
    subtotal,
    discountTotal,
    total,
    ...(promoApplied ? { promoApplied } : {}),
  };
}

/**
 * Recreates the exact unpatched bug for sandbox reproduction tests.
 */
export function unpatchedCalculateCheckout(items: CartItem[], promo?: PromoCode): CheckoutResult {
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const unvalidatedPromo = promo as unknown as { discount: { percent: number } };
  const percent = unvalidatedPromo.discount.percent;
  const discountTotal = (subtotal * percent) / 100;
  return {
    items,
    subtotal,
    discountTotal,
    total: subtotal - discountTotal,
  };
}
