/**
 * Unified Discount Create / Edit page.
 *
 * Route:  /app/discounts/new   → create mode  (id param === "new")
 *         /app/discounts/:id   → edit mode    (id param is a URL-encoded GID)
 *
 * Data is stored in Shopify Metaobjects via app/data/discounts.server.js.
 */
/* eslint-disable react/prop-types */
import { useState, useCallback, useEffect } from "react";
import { useParams, useLoaderData, useSubmit, useNavigation, redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  BlockStack,
  Box,
  Card,
  Checkbox,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { Icon } from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PillTabs } from "../components/PillTabs";
import {
  getDiscount,
  saveDiscount,
  toggleDiscountStatus,
  upsertShopifyDiscountPublic,
} from "../data/discounts.server";

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  if (params.id === "new") {
    return { discount: null };
  }

  const discount = await getDiscount(admin, decodeURIComponent(params.id));

  // Refresh the Function's metafields (cached rule + live fetch_url) whenever
  // the merchant opens the edit page, keeping everything in sync.
  if (discount?.shopify_discount_id) {
    await upsertShopifyDiscountPublic(admin, discount, shop);
  }

  return { discount };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle") {
    const id = formData.get("id");
    await toggleDiscountStatus(admin, id, shop);
    return redirect(`/app/discounts/${encodeURIComponent(id)}`);
  }

  const discount = {
    id: formData.get("id") || null,
    handle: formData.get("handle") || null,
    shopify_discount_id: formData.get("shopify_discount_id") || null,
    name: formData.get("name"),
    discount_type: formData.get("discount_type"),
    status: formData.get("status"),
    buy_qty: Number(formData.get("buy_qty")),
    get_qty: Number(formData.get("get_qty")),
    buy_products: JSON.parse(formData.get("buy_products") || "[]"),
    get_products: JSON.parse(formData.get("get_products") || "[]"),
    discount_value_type: formData.get("discount_value_type"),
    discount_value: formData.get("discount_value")
      ? Number(formData.get("discount_value"))
      : null,
    auto_add: formData.get("auto_add") === "true",
    start_date: formData.get("start_date") || null,
    has_end: formData.get("has_end") === "true",
    end_date: formData.get("end_date") || null,
  };

  await saveDiscount(admin, discount, shop);
  return redirect("/app");
};

export const headers = (headersArgs) => boundary.headers(headersArgs);

/* ── Static data ────────────────────────────────────────────────────────── */

const TYPE_TABS = [
  { id: "automatic", content: "Automatic" },
  { id: "code", content: "Discount code" },
];

const TYPE_HELPER = [
  "Applied instantly when the cart qualifies.",
  "Customers enter a code at checkout.",
];

const DISCOUNT_VALUE_OPTIONS = [
  { value: "free", label: "Free", sublabel: "100% off" },
  { value: "percentage", label: "% off", sublabel: "Percentage" },
  { value: "fixed", label: "$ off", sublabel: "Fixed amount" },
];

/* ── Shared styles ──────────────────────────────────────────────────────── */

const accentCardStyle = {
  background: "var(--p-color-bg-surface)",
  border: "1px solid var(--p-color-border)",
  borderRadius: "var(--p-border-radius-300)",
  overflow: "hidden",
};

const stepCircleBase = {
  width: "28px",
  height: "28px",
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  color: "#ffffff",
  fontSize: "var(--p-font-size-300)",
  fontWeight: "var(--p-font-weight-semibold)",
};

/* ── Local helper components ────────────────────────────────────────────── */

function ProductSwatch({ imageUrl, fallbackColor }) {
  const sharedStyle = {
    width: "20px",
    height: "20px",
    borderRadius: "var(--p-border-radius-100)",
    flexShrink: 0,
    objectFit: "cover",
  };
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        aria-hidden="true"
        style={sharedStyle}
      />
    );
  }
  return <div style={{ ...sharedStyle, background: fallbackColor }} />;
}

function ProductChip({ name, imageUrl, fallbackColor, onRemove }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <ProductSwatch imageUrl={imageUrl} fallbackColor={fallbackColor} />
      <Text as="span" variant="bodyMd">
        {name}
      </Text>
      <button
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        style={{
          border: "none",
          background: "none",
          cursor: "pointer",
          padding: "0 2px",
          color: "var(--p-color-text-secondary)",
          fontSize: "16px",
          lineHeight: 1,
          fontFamily: "inherit",
        }}
      >
        ×
      </button>
    </div>
  );
}

function ProductSelector({ products, fallbackColor, onBrowse, onRemove }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
        padding: "6px 12px",
        border: "1px solid var(--p-color-border)",
        borderRadius: "var(--p-border-radius-200)",
        minHeight: "36px",
        background: "var(--p-color-bg-surface)",
      }}
    >
      {products.map((p) => (
        <ProductChip
          key={p.id}
          name={p.title}
          imageUrl={p.imageUrl ?? null}
          fallbackColor={fallbackColor}
          onRemove={() => onRemove(p.id)}
        />
      ))}
      {products.length > 0 && (
        <div
          style={{
            width: "1px",
            height: "20px",
            background: "var(--p-color-border)",
            flexShrink: 0,
          }}
        />
      )}
      <button
        onClick={onBrowse}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          border: "none",
          background: "none",
          cursor: "pointer",
          padding: "2px 4px",
          color: "var(--p-color-text)",
          fontSize: "var(--p-font-size-325)",
          fontFamily: "inherit",
          lineHeight: "var(--p-font-line-height-500)",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M10 3a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H4a1 1 0 1 1 0-2h5V4a1 1 0 0 1 1-1Z" />
        </svg>
        Browse products
      </button>
    </div>
  );
}

function StepCard({ step, color, title, children }) {
  return (
    <div style={accentCardStyle}>
      <div style={{ display: "flex" }}>
        <div style={{ width: "4px", background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, padding: "var(--p-space-500)" }}>
          <BlockStack gap="400">
            <InlineStack gap="300" blockAlign="center">
              <div style={{ ...stepCircleBase, background: color }}>
                {step}
              </div>
              <Text variant="headingSm" as="h2">
                {title}
              </Text>
            </InlineStack>
            {children}
          </BlockStack>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function normalizeProduct(p) {
  return {
    id: p.id,
    title: p.title,
    imageUrl:
      p.imageUrl ??
      p.images?.[0]?.originalSrc ??
      p.images?.[0]?.url ??
      p.featuredImage?.originalSrc ??
      p.featuredImage?.url ??
      null,
  };
}

/* ── Page component ─────────────────────────────────────────────────────── */

export default function DiscountForm() {
  const { id } = useParams();
  const isNew = id === "new";
  const { discount } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const isSaving = navigation.state === "submitting";

  // ── Form state (initialized from loader data) ─────────────────────────
  const [status, setStatus] = useState(discount?.status ?? "active");
  const [typeTab, setTypeTab] = useState(
    discount?.discount_type === "code" ? 1 : 0,
  );
  const [name, setName] = useState(discount?.name ?? "");
  const [buyQty, setBuyQty] = useState(String(discount?.buy_qty ?? 1));
  const [buyProducts, setBuyProducts] = useState(discount?.buy_products ?? []);
  const [getQty, setGetQty] = useState(String(discount?.get_qty ?? 1));
  const [getProducts, setGetProducts] = useState(discount?.get_products ?? []);
  const [discountValueType, setDiscountValueType] = useState(
    discount?.discount_value_type ?? "free",
  );
  const [discountValue, setDiscountValue] = useState(
    discount?.discount_value != null ? String(discount.discount_value) : "",
  );
  const [autoAdd, setAutoAdd] = useState(discount?.auto_add ?? false);
  const [startDate, setStartDate] = useState(
    discount?.start_date ?? new Date().toISOString().slice(0, 10),
  );
  const [hasEnd, setHasEnd] = useState(discount?.has_end ?? false);
  const [endDate, setEndDate] = useState(() => {
    if (discount?.end_date) return discount.end_date;
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().slice(0, 10);
  });

  // Re-sync when the loader returns fresh data (e.g. after toggle redirect)
  useEffect(() => {
    if (!discount) return;
    setStatus(discount.status ?? "active");
    setTypeTab(discount.discount_type === "code" ? 1 : 0);
    setName(discount.name ?? "");
    setBuyQty(String(discount.buy_qty ?? 1));
    setBuyProducts(discount.buy_products ?? []);
    setGetQty(String(discount.get_qty ?? 1));
    setGetProducts(discount.get_products ?? []);
    setDiscountValueType(discount.discount_value_type ?? "free");
    setDiscountValue(
      discount.discount_value != null ? String(discount.discount_value) : "",
    );
    setAutoAdd(discount.auto_add ?? false);
    setStartDate(discount.start_date ?? new Date().toISOString().slice(0, 10));
    setHasEnd(discount.has_end ?? false);
    if (discount.end_date) {
      setEndDate(discount.end_date);
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 15);
      setEndDate(d.toISOString().slice(0, 10));
    }
  }, [discount]);

  // ── Resource picker ───────────────────────────────────────────────────
  const openBuyPicker = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: buyProducts.map((p) => ({ id: p.id })),
    });
    if (selected) setBuyProducts(selected.map(normalizeProduct));
  }, [shopify, buyProducts]);

  const openGetPicker = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: getProducts.map((p) => ({ id: p.id })),
    });
    if (selected) setGetProducts(selected.map(normalizeProduct));
  }, [shopify, getProducts]);

  const removeBuyProduct = useCallback(
    (pid) => setBuyProducts((prev) => prev.filter((p) => p.id !== pid)),
    [],
  );
  const removeGetProduct = useCallback(
    (pid) => setGetProducts((prev) => prev.filter((p) => p.id !== pid)),
    [],
  );

  // ── Save ──────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    submit(
      {
        id: discount?.id ?? "",
        handle: discount?.handle ?? "",
        shopify_discount_id: discount?.shopify_discount_id ?? "",
        name,
        discount_type: typeTab === 0 ? "automatic" : "code",
        status,
        buy_qty: buyQty,
        get_qty: getQty,
        buy_products: JSON.stringify(buyProducts.map(normalizeProduct)),
        get_products: JSON.stringify(getProducts.map(normalizeProduct)),
        discount_value_type: discountValueType,
        discount_value: discountValue,
        auto_add: String(autoAdd),
        start_date: startDate,
        has_end: String(hasEnd),
        end_date: endDate,
      },
      { method: "post" },
    );
  }, [
    submit,
    discount,
    name,
    typeTab,
    status,
    buyQty,
    getQty,
    buyProducts,
    getProducts,
    discountValueType,
    discountValue,
    autoAdd,
    startDate,
    hasEnd,
    endDate,
  ]);

  // ── Toggle active / inactive ──────────────────────────────────────────
  const handleToggleStatus = useCallback(() => {
    if (isNew || !discount?.id) return;
    submit({ intent: "toggle", id: discount.id }, { method: "post" });
  }, [submit, isNew, discount]);

  return (
    <Page
      backAction={{ content: "Discounts", url: "/app" }}
      title={name || "New discount"}
      secondaryActions={
        isNew
          ? []
          : [
              {
                content: status === "active" ? "Deactivate" : "Activate",
                destructive: status === "active",
                onAction: handleToggleStatus,
              },
            ]
      }
      primaryAction={{
        content: "Save",
        onAction: handleSave,
        loading: isSaving,
      }}
    >
      <div style={{ paddingBlockEnd: "var(--p-space-1600)" }}>
        <BlockStack gap="400">
          {/* Card 1: Discount type + name */}
          <Card padding="0">
            <Box padding="400" paddingBlockEnd="300">
              <Text variant="headingSm" as="h2">
                How customers get this discount
              </Text>
            </Box>
            <PillTabs
              tabs={TYPE_TABS}
              selected={typeTab}
              onSelect={setTypeTab}
            />
            <Box padding="400">
              <BlockStack gap="400">
                <Text as="p" tone="subdued">
                  {TYPE_HELPER[typeTab]}
                </Text>
                <TextField
                  label="Discount name"
                  value={name}
                  onChange={setName}
                  helpText="For your own reference. Customers won't see this."
                  autoComplete="off"
                  placeholder="e.g. Free tote with purchase"
                />
              </BlockStack>
            </Box>
          </Card>

          {/* Card 2: Customer buys */}
          <StepCard
            step="1"
            color="var(--p-color-bg-fill-inverse)"
            title="Customer buys"
          >
            <TextField
              label="Quantity"
              type="number"
              min={1}
              value={buyQty}
              onChange={setBuyQty}
              autoComplete="off"
            />
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd">
                Products
              </Text>
              <ProductSelector
                products={buyProducts}
                fallbackColor="#C9B89A"
                onBrowse={openBuyPicker}
                onRemove={removeBuyProduct}
              />
            </BlockStack>
          </StepCard>

          {/* Card 3: Customer gets */}
          <StepCard
            step="2"
            color="var(--p-color-bg-fill-success)"
            title="Customer gets"
          >
            <TextField
              label="Quantity"
              type="number"
              min={1}
              value={getQty}
              onChange={setGetQty}
              autoComplete="off"
            />
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd">
                Products
              </Text>
              <ProductSelector
                products={getProducts}
                fallbackColor="#B8A882"
                onBrowse={openGetPicker}
                onRemove={removeGetProduct}
              />
            </BlockStack>

            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                At a discounted value
              </Text>
              <div style={{ display: "flex" }}>
                {DISCOUNT_VALUE_OPTIONS.map((opt, i) => {
                  const isSelected = discountValueType === opt.value;
                  const isFirst = i === 0;
                  const isLast = i === DISCOUNT_VALUE_OPTIONS.length - 1;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setDiscountValueType(opt.value)}
                      style={{
                        flex: 1,
                        padding: "10px 16px",
                        border: isSelected
                          ? "2px solid var(--p-color-text)"
                          : "1px solid var(--p-color-border)",
                        marginLeft: i > 0 ? (isSelected ? "0" : "-1px") : 0,
                        borderRadius: isFirst
                          ? "var(--p-border-radius-200) 0 0 var(--p-border-radius-200)"
                          : isLast
                            ? "0 var(--p-border-radius-200) var(--p-border-radius-200) 0"
                            : 0,
                        background: "var(--p-color-bg-surface)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "inherit",
                        position: "relative",
                        zIndex: isSelected ? 1 : 0,
                      }}
                    >
                      <Text
                        as="p"
                        variant="bodyMd"
                        fontWeight={isSelected ? "semibold" : "regular"}
                      >
                        {opt.label}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {opt.sublabel}
                      </Text>
                    </button>
                  );
                })}
              </div>
              {discountValueType === "percentage" && (
                <TextField
                  label="Percentage off"
                  labelHidden
                  type="number"
                  min={1}
                  max={100}
                  suffix="%"
                  value={discountValue}
                  onChange={setDiscountValue}
                  autoComplete="off"
                  placeholder="0"
                />
              )}
              {discountValueType === "fixed" && (
                <TextField
                  label="Amount off"
                  labelHidden
                  type="number"
                  min={0}
                  prefix="$"
                  value={discountValue}
                  onChange={setDiscountValue}
                  autoComplete="off"
                  placeholder="0.00"
                />
              )}
            </BlockStack>

            <Box
              background="bg-surface-secondary"
              padding="300"
              borderRadius="200"
            >
              <Checkbox
                label="Automatically add this product to cart"
                helpText="The item is added to the cart automatically when the cart qualifies."
                checked={autoAdd}
                onChange={setAutoAdd}
              />
            </Box>
          </StepCard>

          {/* Card 4: Active dates */}
          <Card>
            <BlockStack gap="400">
              <Text variant="headingSm" as="h2">
                Active dates
              </Text>
              <div
                style={{
                  display: "grid",
                  rowGap: "var(--p-space-200)",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                    columnGap: "var(--p-space-400)",
                    alignItems: "center",
                  }}
                >
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    Starts
                  </Text>
                  <Checkbox
                    label="Set end date"
                    checked={hasEnd}
                    onChange={setHasEnd}
                  />
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                    columnGap: "var(--p-space-400)",
                    alignItems: "start",
                  }}
                >
                  <TextField
                    label="Starts"
                    labelHidden
                    type="date"
                    value={startDate}
                    onChange={setStartDate}
                    autoComplete="off"
                  />
                  <div
                    style={{
                      minWidth: 0,
                      visibility: hasEnd ? "visible" : "hidden",
                    }}
                  >
                    <TextField
                      label="Ends"
                      labelHidden
                      type="date"
                      value={endDate}
                      onChange={setEndDate}
                      autoComplete="off"
                      disabled={!hasEnd}
                    />
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  flexWrap: "nowrap",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  columnGap: "var(--p-space-200)",
                  width: "100%",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    flexShrink: 0,
                  }}
                >
                  <Icon source={InfoIcon} tone="subdued" />
                </span>
                <Text as="span" variant="bodySm" tone="subdued">
                  Starts at 12:00 AM, ends at 11:59 PM in your store timezone.
                </Text>
              </div>
            </BlockStack>
          </Card>
        </BlockStack>
      </div>
    </Page>
  );
}
