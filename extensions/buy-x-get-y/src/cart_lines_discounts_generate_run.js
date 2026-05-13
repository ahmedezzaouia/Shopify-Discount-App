import { ProductDiscountSelectionStrategy } from "../generated/api";

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

/**
 * Buy X Get Y Discount Function.
 *
 * Rule resolution order:
 *  1. fetchResult.jsonBody  — live data from the app server (always up to date,
 *     even when the metaobject is edited directly in the Shopify admin).
 *  2. discount.metafield.value  — cached JSON rule written the last time the
 *     discount was saved from the app (fallback when the fetch fails or the
 *     fetch_url metafield hasn't been set yet).
 *
 * Rule JSON shape:
 * {
 *   status: "active" | "inactive",
 *   name: string,
 *   buy_qty: number,
 *   get_qty: number,
 *   buy_product_ids: string[],   // Shopify Product GIDs
 *   get_product_ids: string[],   // Shopify Product GIDs
 *   discount_value_type: "free" | "percentage" | "fixed",
 *   discount_value: number
 * }
 *
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const EMPTY = { operations: [] };

  let rule;

  // 1. Prefer live fetch result (always reflects the latest metaobject state)
  const fetch = input.fetchResult;
  if (fetch?.status === 200 && fetch.jsonBody != null) {
    rule = fetch.jsonBody;
  }

  // 2. Fall back to cached rule metafield (set when saved from app)
  if (!rule) {
    const raw = input.discount?.metafield?.value;
    if (!raw) return EMPTY;
    try {
      rule = JSON.parse(raw);
    } catch {
      return EMPTY;
    }
  }

  if (rule.status !== "active") return EMPTY;

  // Treat the discount as inactive if its end date has already passed
  if (rule.end_date) {
    const now = new Date();
    const end = new Date(rule.end_date + "T23:59:59Z");
    if (now > end) return EMPTY;
  }

  const buyQty = Number(rule.buy_qty ?? 1);
  const getQty = Number(rule.get_qty ?? 1);
  const buyIds = new Set(rule.buy_product_ids ?? []);
  const getIds = new Set(rule.get_product_ids ?? []);
  const valueType = rule.discount_value_type ?? "free";
  const valueNum = Number(rule.discount_value ?? 0);
  const label = rule.name || "Discount";

  const cartLines = input.cart.lines;

  const buyInCart = cartLines
    .filter((l) => buyIds.has(l.merchandise?.product?.id))
    .reduce((sum, l) => sum + l.quantity, 0);

  if (buyInCart < buyQty) return EMPTY;

  const getLines = cartLines.filter((l) =>
    getIds.has(l.merchandise?.product?.id),
  );

  if (getLines.length === 0) return EMPTY;

  const targets = getLines.slice(0, getQty).map((l) => ({
    cartLine: {
      id: l.id,
      quantity: Math.min(l.quantity, getQty),
    },
  }));

  const value =
    valueType === "percentage"
      ? { percentage: { value: valueNum } }
      : valueType === "fixed"
        ? { fixedAmount: { amount: valueNum.toFixed(2) } }
        : { percentage: { value: 100 } };

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [{ message: label, targets, value }],
          selectionStrategy: ProductDiscountSelectionStrategy.First,
        },
      },
    ],
  };
}
