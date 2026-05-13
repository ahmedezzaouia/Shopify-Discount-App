/**
 * Public API endpoint called by the buy-x-get-y Shopify Function fetch target.
 *
 * GET /api/discount/:handle?shop=<shop-domain>
 *
 * Returns the current discount rule as JSON, read live from the metaobject.
 * This ensures the Function always uses the latest data, even if the
 * metaobject was edited directly in the Shopify admin without going through
 * the app.
 *
 * Authentication: none (discount rules are not sensitive). The shop domain
 * is used to look up the offline access token stored during app installation.
 */

import { unauthenticated } from "../shopify.server";
import { getDiscountByHandle } from "../data/discounts.server";

export async function loader({ request, params }) {
  const { handle } = params;
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop || !handle) {
    return Response.json(
      { error: "Missing required params: shop, handle" },
      { status: 400 },
    );
  }

  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch {
    return Response.json(
      { error: "Could not authenticate for shop" },
      { status: 401 },
    );
  }

  const discount = await getDiscountByHandle(admin, handle);

  if (!discount) {
    return Response.json({ error: "Discount not found" }, { status: 404 });
  }

  return Response.json(
    {
      status: discount.status ?? "active",
      name: discount.name || "Buy X Get Y",
      buy_qty: discount.buy_qty ?? 1,
      get_qty: discount.get_qty ?? 1,
      buy_product_ids: (discount.buy_products ?? []).map((p) => p.id),
      get_product_ids: (discount.get_products ?? []).map((p) => p.id),
      discount_value_type: discount.discount_value_type ?? "free",
      discount_value: discount.discount_value ?? 0,
      has_end: discount.has_end ?? false,
      end_date: discount.end_date ?? null,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    },
  );
}
