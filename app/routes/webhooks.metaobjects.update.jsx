import { authenticate, unauthenticated } from "../shopify.server";
import { getDiscount, upsertShopifyDiscountPublic } from "../data/discounts.server";

/**
 * Webhook: metaobjects/update
 *
 * Fires whenever a metaobject entry of type `$app:discount` is edited —
 * including directly through the Shopify admin.
 *
 * Re-syncs the paired Shopify Discount's JSON metafield so the Function
 * always has the latest rule data without needing to go through the app UI.
 */
export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} received for ${shop}`);
  console.log(`[webhook] payload:`, JSON.stringify(payload));

  // Build a fresh admin client using the stored offline token
  const { admin } = await unauthenticated.admin(shop);

  const numericId = payload?.id;
  if (!numericId) {
    console.warn(`[webhook] No id in payload — skipping`);
    return new Response();
  }

  const gid = `gid://shopify/Metaobject/${numericId}`;

  try {
    const discount = await getDiscount(admin, gid);

    if (!discount) {
      console.warn(`[webhook] No discount found for ${gid} — skipping`);
      return new Response();
    }

    await upsertShopifyDiscountPublic(admin, discount);
    console.log(`[webhook] Synced Shopify Discount for metaobject ${gid} (shop: ${shop})`);
  } catch (err) {
    console.error(`[webhook] Failed to sync discount ${gid}:`, err);
  }

  return new Response();
};
