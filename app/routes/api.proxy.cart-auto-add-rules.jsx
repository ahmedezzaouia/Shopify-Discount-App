/**
 * App proxy: GET /apps/customer-discount/cart-auto-add-rules
 * → GET /api/proxy/cart-auto-add-rules (same rules JSON as shop metafield).
 *
 * Requires `write_app_proxy` scope and app proxy config in shopify.app.toml.
 */
import { authenticate, unauthenticated } from "../shopify.server";
import { buildCartAutoAddRules } from "../data/discounts.server";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

/** Resolves Admin API client from app proxy session or offline token. */
async function adminForAppProxy(request) {
  const { admin: proxyAdmin } = await authenticate.public.appProxy(request);
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) {
    return Response.json({ error: "missing shop" }, { status: 400 });
  }
  if (proxyAdmin) {
    return { admin: proxyAdmin };
  }
  try {
    const { admin } = await unauthenticated.admin(shop);
    return { admin };
  } catch {
    return Response.json(
      { error: "Could not load offline session for shop" },
      { status: 401 },
    );
  }
}

export async function loader({ request }) {
  try {
    const resolved = await adminForAppProxy(request);
    if (resolved instanceof Response) {
      return resolved;
    }
    const rules = await buildCartAutoAddRules(resolved.admin);
    return Response.json(rules, { headers: JSON_HEADERS });
  } catch (e) {
    if (e instanceof Response) {
      throw e;
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api.proxy.cart-auto-add-rules]", message, e);
    return Response.json({ error: message }, { status: 500 });
  }
}
