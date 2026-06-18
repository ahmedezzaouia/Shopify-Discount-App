/**
 * Server-side CRUD for Buy X Get Y discounts stored as Shopify Metaobjects.
 *
 * Every save also keeps a paired Shopify Discount in sync so the
 * `apply-bxgy` Function is invoked automatically during checkout.
 *
 * Per-store isolation is guaranteed by the admin client scoped to each
 * install's offline access token.
 *
 * Discount shape (JS):
 * {
 *   id                   string | null  — metaobject GID, null for new records
 *   handle               string | null
 *   name                 string
 *   discount_type        "automatic" | "code"
 *   status               "active" | "inactive"
 *   buy_qty              number
 *   get_qty              number
 *   buy_products         Array<{ id: string, title: string, imageUrl: string|null }>
 *   get_products         Array<{ id: string, title: string, imageUrl: string|null }>
 *   discount_value_type  "free" | "percentage" | "fixed"
 *   discount_value       number | null
 *   auto_add             boolean
 *   start_date           string | null  (ISO date "YYYY-MM-DD")
 *   has_end              boolean
 *   end_date             string | null  (ISO date "YYYY-MM-DD")
 *   shopify_discount_id  string | null  — GID of the paired Shopify Discount
 * }
 */

/* ── GraphQL strings ─────────────────────────────────────────────────────── */

const LIST_QUERY = `#graphql
  query ListDiscounts {
    metaobjects(type: "$app:discount", first: 100, sortKey: "updated_at", reverse: true) {
      nodes {
        id
        handle
        fields {
          key
          value
          references(first: 25) {
            nodes {
              ... on Product {
                id
                title
                featuredMedia {
                  preview {
                    image { url }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const GET_QUERY = `#graphql
  query GetDiscount($id: ID!) {
    metaobject(id: $id) {
      id
      handle
      fields {
        key
        value
        references(first: 25) {
          nodes {
            ... on Product {
              id
              title
              featuredMedia {
                preview {
                  image { url }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const GET_BY_HANDLE_QUERY = `#graphql
  query GetDiscountByHandle($handle: MetaobjectHandleInput!) {
    metaobjectByHandle(handle: $handle) {
      id
      handle
      fields {
        key
        value
        references(first: 25) {
          nodes {
            ... on Product {
              id
              title
              featuredMedia {
                preview {
                  image { url }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const UPSERT_MUTATION = `#graphql
  mutation UpsertDiscount(
    $handle: MetaobjectHandleInput!
    $metaobject: MetaobjectUpsertInput!
  ) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message }
    }
  }
`;

const DELETE_MUTATION = `#graphql
  mutation DeleteDiscount($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors { field message }
    }
  }
`;

const GET_FUNCTIONS_QUERY = `#graphql
  query GetFunctions {
    shopifyFunctions(first: 25) {
      nodes {
        id
        title
        apiType
      }
    }
  }
`;

const CREATE_AUTO_DISCOUNT = `#graphql
  mutation CreateAutoDiscount($discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId }
      userErrors { field message }
    }
  }
`;

const UPDATE_AUTO_DISCOUNT = `#graphql
  mutation UpdateAutoDiscount($id: ID!, $discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId }
      userErrors { field message }
    }
  }
`;

const DELETE_AUTO_DISCOUNT = `#graphql
  mutation DeleteAutoDiscount($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors { field message }
    }
  }
`;

const CREATE_CODE_DISCOUNT = `#graphql
  mutation CreateCodeDiscount($discount: DiscountCodeAppInput!) {
    discountCodeAppCreate(codeAppDiscount: $discount) {
      codeAppDiscount { discountId }
      userErrors { field message }
    }
  }
`;

const ADD_DISCOUNT_CODES = `#graphql
  mutation AddDiscountCodes(
    $discountId: ID!
    $codes: [DiscountRedeemCodeInput!]!
  ) {
    discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
      bulkCreation { id }
      userErrors { field message }
    }
  }
`;

const UPDATE_CODE_DISCOUNT = `#graphql
  mutation UpdateCodeDiscount($id: ID!, $discount: DiscountCodeAppInput!) {
    discountCodeAppUpdate(id: $id, codeAppDiscount: $discount) {
      codeAppDiscount { discountId }
      userErrors { field message }
    }
  }
`;

const DELETE_CODE_DISCOUNT = `#graphql
  mutation DeleteCodeDiscount($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      userErrors { field message }
    }
  }
`;

/* ── Enum guards ─────────────────────────────────────────────────────────── */

const VALID_DISCOUNT_TYPE = ["automatic", "code"];
const VALID_STATUS = ["active", "inactive"];
const VALID_DISCOUNT_VALUE_TYPE = ["free", "percentage", "fixed"];

function guardEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/* ── Cached Function GID ─────────────────────────────────────────────────── */

let cachedFunctionId = null;

async function getFunctionId(admin) {
  if (cachedFunctionId) return cachedFunctionId;

  const res = await admin.graphql(GET_FUNCTIONS_QUERY);
  const { data } = await res.json();
  const fn = (data?.shopifyFunctions?.nodes ?? []).find(
    (f) => f.title === "Buy X Get Y",
  );

  if (!fn) return null;

  cachedFunctionId = fn.id;
  return cachedFunctionId;
}

/* ── Date helpers ────────────────────────────────────────────────────────── */

/**
 * Compute the endsAt value to set on the Shopify Discount.
 *
 * - has_end  → the configured end date at end-of-day UTC
 * - else     → null (runs indefinitely)
 *
 * Note: inactive status is handled by the Function itself (rule.status check),
 * NOT by expiring the Shopify Discount. Setting endsAt < startsAt causes a
 * Shopify API error when the start date is today or in the future.
 */
function effectiveEndsAt(discount) {
  if (discount.has_end && discount.end_date) {
    return discount.end_date + "T23:59:59Z";
  }
  return null;
}

/* ── Private helpers ─────────────────────────────────────────────────────── */

/**
 * Convert a raw metaobject node into a JS discount object.
 * Product reference lists are resolved inline (no extra requests).
 */
function fromNode(node) {
  const map = {};

  for (const field of node.fields) {
    if (field.references?.nodes?.length) {
      map[field.key] = field.references.nodes.map((p) => ({
        id: p.id,
        title: p.title,
        imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
      }));
    } else {
      map[field.key] = field.value;
    }
  }

  return {
    id: node.id,
    handle: node.handle,
    name: map.name ?? "",
    discount_type: guardEnum(map.discount_type, VALID_DISCOUNT_TYPE, "automatic"),
    status: guardEnum(map.status, VALID_STATUS, "active"),
    buy_qty: Number(map.buy_qty ?? 1),
    get_qty: Number(map.get_qty ?? 1),
    buy_products: map.buy_products ?? [],
    get_products: map.get_products ?? [],
    discount_value_type: guardEnum(
      map.discount_value_type,
      VALID_DISCOUNT_VALUE_TYPE,
      "free",
    ),
    discount_value:
      map.discount_value != null ? Number(map.discount_value) : null,
    auto_add: map.auto_add === "true",
    start_date: map.start_date ?? null,
    has_end: map.has_end === "true",
    end_date: map.end_date ?? null,
    shopify_discount_id: map.shopify_discount_id ?? null,
  };
}

/**
 * Convert a JS discount object into the `fields` array expected by
 * metaobjectUpsert. Product lists are stored as JSON arrays of GIDs.
 */
function toFields(discount) {
  return [
    { key: "name", value: discount.name ?? "" },
    { key: "discount_type", value: discount.discount_type ?? "automatic" },
    { key: "status", value: discount.status ?? "active" },
    { key: "buy_qty", value: String(discount.buy_qty ?? 1) },
    { key: "get_qty", value: String(discount.get_qty ?? 1) },
    {
      key: "buy_products",
      value: JSON.stringify(
        (discount.buy_products ?? []).map((p) => p.id),
      ),
    },
    {
      key: "get_products",
      value: JSON.stringify(
        (discount.get_products ?? []).map((p) => p.id),
      ),
    },
    {
      key: "discount_value_type",
      value: discount.discount_value_type ?? "free",
    },
    {
      key: "discount_value",
      value:
        discount.discount_value != null ? String(discount.discount_value) : "0",
    },
    { key: "auto_add", value: String(discount.auto_add ?? false) },
    { key: "start_date", value: discount.start_date ?? "" },
    { key: "has_end", value: String(discount.has_end ?? false) },
    { key: "end_date", value: discount.end_date ?? "" },
    {
      key: "shopify_discount_id",
      value: discount.shopify_discount_id ?? "",
    },
  ];
}

/** Generate a URL-safe handle from a discount name. */
function makeHandle(name) {
  return (name || "discount")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/* ── Shopify Discount sync ───────────────────────────────────────────────── */

/**
 * Build the DiscountAutomaticAppInput / DiscountCodeAppInput payload.
 *
 * Two metafields are written to the Shopify Discount so the Function can
 * always use the latest discount data:
 *
 * - `$app:discount/rule`      — cached JSON rule (fallback when fetch fails)
 * - `$app:discount/fetch_url` — live-fetch URL pointing at our API endpoint;
 *                               the Function calls this at checkout time to get
 *                               the current metaobject data without any sync.
 *
 * @param {object} discount
 * @param {string} functionId
 * @param {string|null} shopDomain  e.g. "my-store.myshopify.com"
 */
function buildDiscountPayload(discount, functionId, shopDomain) {
  const rule = JSON.stringify({
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
  });

  const metafields = [
    {
      namespace: "$app:discount",
      key: "rule",
      type: "json",
      value: rule,
    },
  ];

  // Build the live-fetch URL when we know the shop domain and handle.
  // This lets the Function call our API at checkout time, bypassing the need
  // for any webhook sync.
  const appUrl = process.env.SHOPIFY_APP_URL ?? "";
  if (appUrl && shopDomain && discount.handle) {
    const fetchUrl = `${appUrl}/api/discount/${discount.handle}?shop=${shopDomain}`;
    metafields.push({
      namespace: "$app:discount",
      key: "fetch_url",
      type: "single_line_text_field",
      value: fetchUrl,
    });
  }

  const base = {
    title: discount.name || "Buy X Get Y",
    functionId,
    // PRODUCT class is required for app-function-based product discounts
    discountClasses: ["PRODUCT"],
    startsAt: discount.start_date
      ? discount.start_date + "T00:00:00Z"
      : new Date().toISOString(),
    endsAt: effectiveEndsAt(discount),
    metafields,
  };

  return base;
}

/**
 * Upsert the paired Shopify Discount and return its GID.
 * Creates on first save (no existing shopify_discount_id), updates afterwards.
 *
 * @param {object} admin
 * @param {object} discount
 * @param {string|null} shopDomain  e.g. "my-store.myshopify.com" — used to
 *   build the live-fetch URL stored in the Function's metafield.
 */
async function upsertShopifyDiscount(admin, discount, shopDomain = null) {
  const functionId = await getFunctionId(admin);

  // Function not deployed yet — skip silently. Will sync on next save after deploy.
  if (!functionId) return discount.shopify_discount_id ?? null;

  // Normalise discount_type — anything that isn't "code" is treated as automatic
  const discountType = discount.discount_type === "code" ? "code" : "automatic";
  const normalised = { ...discount, discount_type: discountType };
  const payload = buildDiscountPayload(normalised, functionId, shopDomain);
  const isCode = discountType === "code";

  if (!discount.shopify_discount_id) {
    const mutation = isCode ? CREATE_CODE_DISCOUNT : CREATE_AUTO_DISCOUNT;
    const key = isCode ? "discountCodeAppCreate" : "discountAutomaticAppCreate";
    const innerKey = isCode ? "codeAppDiscount" : "automaticAppDiscount";

    const res = await admin.graphql(mutation, {
      variables: { discount: payload },
    });
    const { data } = await res.json();
    const result = data?.[key];
    const errors = result?.userErrors ?? [];

    if (errors.length) {
      throw new Error(errors.map((e) => e.message).join(", "));
    }

    const discountId = result?.[innerKey]?.discountId ?? null;

    // Code discounts: attach the redemption code in a follow-up mutation
    if (isCode && discountId) {
      const code = (discount.code ?? discount.name ?? "BXGY")
        .toUpperCase()
        .replace(/\s+/g, "-")
        .slice(0, 255);

      await admin.graphql(ADD_DISCOUNT_CODES, {
        variables: { discountId, codes: [{ code }] },
      });
    }

    return discountId;
  }

  const mutation = isCode ? UPDATE_CODE_DISCOUNT : UPDATE_AUTO_DISCOUNT;
  const key = isCode ? "discountCodeAppUpdate" : "discountAutomaticAppUpdate";
  const innerKey = isCode ? "codeAppDiscount" : "automaticAppDiscount";

  const res = await admin.graphql(mutation, {
    variables: { id: discount.shopify_discount_id, discount: payload },
  });
  const { data } = await res.json();
  const result = data?.[key];
  const errors = result?.userErrors ?? [];

  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join(", "));
  }

  return result?.[innerKey]?.discountId ?? discount.shopify_discount_id;
}

/** Delete the paired Shopify Discount (best-effort; swallow not-found errors). */
async function deleteShopifyDiscount(admin, discount) {
  if (!discount.shopify_discount_id) return;

  const isCode = discount.discount_type === "code";
  const mutation = isCode ? DELETE_CODE_DISCOUNT : DELETE_AUTO_DISCOUNT;

  const res = await admin.graphql(mutation, {
    variables: { id: discount.shopify_discount_id },
  });
  const { data } = await res.json();
  const errors = isCode
    ? (data?.discountCodeDelete?.userErrors ?? [])
    : (data?.discountAutomaticDelete?.userErrors ?? []);

  const realErrors = errors.filter(
    (e) => !e.message.toLowerCase().includes("not found"),
  );
  if (realErrors.length) {
    throw new Error(realErrors.map((e) => e.message).join(", "));
  }
}

const SHOP_ID_QUERY = `#graphql
  query ShopIdForMetafield {
    shop {
      id
    }
  }
`;

const PRODUCT_FIRST_VARIANT_QUERY = `#graphql
  query ProductFirstVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        variants(first: 1) {
          nodes {
            id
          }
        }
      }
    }
  }
`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Whether a discount should be projected into the storefront rules
 * shop metafield (auto-add and gift widget).
 */
function discountEligibleForStorefrontSync(discount) {
  if (discount.status !== "active") return false;
  if (!(discount.get_products?.length) || !(discount.buy_products?.length)) {
    return false;
  }

  const today = new Date().toISOString().slice(0, 10);
  if (discount.start_date && discount.start_date > today) return false;

  if (discount.has_end && discount.end_date) {
    const end = new Date(`${discount.end_date}T23:59:59Z`);
    if (new Date() > end) return false;
  }

  return true;
}

/**
 * Resolve first variant GID per product GID.
 *
 * @param {object} admin
 * @param {string[]} productGids
 * @returns {Promise<Map<string, string>>} product GID → variant GID
 */
async function fetchFirstVariantByProductIds(admin, productGids) {
  const map = new Map();
  if (!productGids.length) return map;

  const res = await admin.graphql(PRODUCT_FIRST_VARIANT_QUERY, {
    variables: { ids: productGids },
  });
  const { data } = await res.json();
  for (const node of data?.nodes ?? []) {
    if (!node?.id) continue;
    const vid = node.variants?.nodes?.[0]?.id;
    if (vid) map.set(node.id, vid);
  }
  return map;
}

/**
 * Build JSON rules for storefront cart promo (auto-add + gift widget).
 *
 * @param {object} admin
 * @param {object[]|null} discounts optional pre-fetched list
 * @returns {Promise<object[]>}
 */
export async function buildCartAutoAddRules(admin, discounts = null) {
  const list = discounts ?? (await listDiscounts(admin));
  const eligible = list.filter(discountEligibleForStorefrontSync);

  const firstGetProductIds = eligible
    .map((d) => d.get_products[0]?.id)
    .filter(Boolean);
  const uniqueProductIds = [...new Set(firstGetProductIds)];
  const variantByProduct = await fetchFirstVariantByProductIds(
    admin,
    uniqueProductIds,
  );

  const rules = [];
  for (const d of eligible) {
    const firstGet = d.get_products[0];
    if (!firstGet?.id) continue;
    const variantId = variantByProduct.get(firstGet.id);
    if (!variantId) continue;
    rules.push({
      auto_add: !!d.auto_add,
      discount_value_type: d.discount_value_type ?? "free",
      discount_value: d.discount_value ?? 0,
      buy_qty: d.buy_qty ?? 1,
      buy_product_ids: (d.buy_products ?? []).map((p) => p.id),
      get_qty: d.get_qty ?? 1,
      get_product_ids: (d.get_products ?? []).map((p) => p.id),
      get_variant_id: variantId,
      get_title: firstGet.title ?? "",
      get_image_url: firstGet.imageUrl ?? null,
    });
  }
  return rules;
}

/**
 * Write shop metafield `$app:cart_auto_add_rules` (JSON array) for the
 * Theme App Extension. Source of truth remains metaobjects.
 *
 * @param {object} admin
 * @param {object[]|null} discounts optional pre-fetched list
 */
export async function syncCartAutoAddShopMetafield(admin, discounts = null) {
  const rules = await buildCartAutoAddRules(admin, discounts);

  const shopRes = await admin.graphql(SHOP_ID_QUERY);
  const shopJson = await shopRes.json();
  const shopId = shopJson.data?.shop?.id;
  if (!shopId) {
    throw new Error("Could not resolve shop id for cart auto-add sync");
  }

  const setRes = await admin.graphql(METAFIELDS_SET_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId: shopId,
          namespace: "$app",
          key: "cart_auto_add_rules",
          type: "json",
          value: JSON.stringify(rules),
        },
      ],
    },
  });
  const setData = await setRes.json();
  const errs = setData.data?.metafieldsSet?.userErrors ?? [];
  if (errs.length) {
    throw new Error(errs.map((e) => e.message).join(", "));
  }
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/** Return all discounts for this store, newest first. */
export async function listDiscounts(admin) {
  const res = await admin.graphql(LIST_QUERY);
  const { data } = await res.json();
  return (data?.metaobjects?.nodes ?? []).map(fromNode);
}

/** Return a single discount by GID, or null if not found. */
export async function getDiscount(admin, id) {
  const res = await admin.graphql(GET_QUERY, { variables: { id } });
  const { data } = await res.json();
  if (!data?.metaobject) return null;
  return fromNode(data.metaobject);
}

/**
 * Create or update a discount.
 * Pass `discount.id = null` to create a new record.
 * Returns the saved discount (with id and shopify_discount_id populated).
 *
 * @param {object} admin
 * @param {object} discount
 * @param {string|null} shopDomain  e.g. "my-store.myshopify.com"
 */
export async function saveDiscount(admin, discount, shopDomain = null) {
  const handle = discount.handle || makeHandle(discount.name);

  // 1. Upsert the metaobject (without shopify_discount_id yet on first save)
  const res = await admin.graphql(UPSERT_MUTATION, {
    variables: {
      handle: { type: "$app:discount", handle },
      metaobject: { fields: toFields(discount) },
    },
  });
  const { data } = await res.json();
  const errors = data?.metaobjectUpsert?.userErrors ?? [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join(", "));

  const metaobjectId = data.metaobjectUpsert.metaobject.id;
  const metaobjectHandle = data.metaobjectUpsert.metaobject.handle;

  // 2. Upsert the paired Shopify Discount
  // Pass the resolved handle so buildDiscountPayload can construct the fetch_url
  const shopifyDiscountId = await upsertShopifyDiscount(
    admin,
    {
      ...discount,
      handle: metaobjectHandle,
      shopify_discount_id: discount.shopify_discount_id ?? null,
    },
    shopDomain,
  );

  // 3. Write the Shopify Discount GID back to the metaobject
  if (shopifyDiscountId && shopifyDiscountId !== discount.shopify_discount_id) {
    await admin.graphql(UPSERT_MUTATION, {
      variables: {
        handle: { type: "$app:discount", handle },
        metaobject: {
          fields: toFields({ ...discount, shopify_discount_id: shopifyDiscountId }),
        },
      },
    });
  }

  await syncCartAutoAddShopMetafield(admin);

  return getDiscount(admin, metaobjectId);
}

/** Hard-delete a discount and its paired Shopify Discount. */
export async function deleteDiscount(admin, id) {
  const discount = await getDiscount(admin, id);
  if (discount) await deleteShopifyDiscount(admin, discount);

  const res = await admin.graphql(DELETE_MUTATION, { variables: { id } });
  const { data } = await res.json();
  const errors = data?.metaobjectDelete?.userErrors ?? [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join(", "));

  await syncCartAutoAddShopMetafield(admin);
}

/**
 * Toggle active ↔ inactive. Returns the updated discount.
 *
 * @param {object} admin
 * @param {string} id
 * @param {string|null} shopDomain
 */
export async function toggleDiscountStatus(admin, id, shopDomain = null) {
  const discount = await getDiscount(admin, id);
  if (!discount) throw new Error(`Discount ${id} not found`);

  return saveDiscount(
    admin,
    { ...discount, status: discount.status === "active" ? "inactive" : "active" },
    shopDomain,
  );
}

/**
 * Public wrapper around upsertShopifyDiscount used by routes to refresh the
 * Function's metafields (cached rule + live fetch_url) without re-writing
 * the metaobject.
 *
 * @param {object} admin
 * @param {object} discount
 * @param {string|null} shopDomain  e.g. "my-store.myshopify.com"
 */
export async function upsertShopifyDiscountPublic(admin, discount, shopDomain = null) {
  return upsertShopifyDiscount(admin, discount, shopDomain);
}

/**
 * Look up a discount by its metaobject handle.
 * Returns the full discount object or null if not found.
 *
 * @param {object} admin
 * @param {string} handle
 */
export async function getDiscountByHandle(admin, handle) {
  const res = await admin.graphql(GET_BY_HANDLE_QUERY, {
    variables: { handle: { type: "$app:discount", handle } },
  });
  const { data } = await res.json();
  if (!data?.metaobjectByHandle) return null;
  return fromNode(data.metaobjectByHandle);
}

/** Duplicate a discount. The copy starts as inactive with no linked Shopify Discount. */
export async function duplicateDiscount(admin, id) {
  const source = await getDiscount(admin, id);
  if (!source) throw new Error(`Discount ${id} not found`);

  return saveDiscount(admin, {
    ...source,
    id: null,
    handle: null,
    name: `${source.name} (copy)`,
    status: "inactive",
    shopify_discount_id: null,
  });
}
