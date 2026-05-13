/* eslint-disable react/prop-types */
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useLoaderData, useFetcher } from "react-router";
import {
  ActionList,
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Link,
  Page,
  Popover,
  Spinner,
  Text,
  useBreakpoints,
} from "@shopify/polaris";
import { MenuHorizontalIcon, PlusIcon } from "@shopify/polaris-icons";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listDiscounts,
  saveDiscount,
  deleteDiscount,
  toggleDiscountStatus,
  duplicateDiscount,
  upsertShopifyDiscountPublic,
} from "../data/discounts.server";
import { PillTabs } from "../components/PillTabs";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const discounts = await listDiscounts(admin);

  await Promise.all(
    discounts.map((d) => {
      // New discount with no Shopify Discount yet → do a full save to create it.
      if (!d.shopify_discount_id) return saveDiscount(admin, d, shop);
      // Existing discount → re-push fresh rule JSON + live fetch_url metafield
      // so the Function always has the latest data via fetch target.
      return upsertShopifyDiscountPublic(admin, d, shop);
    }),
  );

  // Re-fetch so shopify_discount_id is populated for any newly created ones.
  return { discounts: await listDiscounts(admin) };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = formData.get("id");

  if (intent === "delete") await deleteDiscount(admin, id);
  if (intent === "toggle") await toggleDiscountStatus(admin, id, shop);
  if (intent === "duplicate") await duplicateDiscount(admin, id);

  return null;
};

const TABS = [
  { id: "all", content: "All", status: null },
  { id: "active", content: "Active", status: "active" },
  { id: "inactive", content: "Inactive", status: "inactive" },
];

function buildRuleText(discount) {
  const buyName = discount.buy_products?.[0]?.title ?? "product";
  const getName = discount.get_products?.[0]?.title ?? "product";
  const valueLabel =
    discount.discount_value_type === "percentage"
      ? `${discount.discount_value ?? "?"}% off`
      : discount.discount_value_type === "fixed"
        ? `$${discount.discount_value ?? "?"} off`
        : "free";
  return `Buy ${discount.buy_qty} × ${buyName} → Get ${discount.get_qty} × ${getName} ${valueLabel}`;
}

function RowMenu({ discount }) {
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const loading = fetcher.state !== "idle";

  const submit = useCallback(
    (intent) => {
      setOpen(false);
      fetcher.submit({ intent, id: discount.id }, { method: "post" });
    },
    [fetcher, discount.id],
  );

  return (
    <Popover
      active={open}
      activator={
        loading ? (
          <Box paddingInline="200">
            <Spinner size="small" />
          </Box>
        ) : (
          <Button
            variant="tertiary"
            icon={MenuHorizontalIcon}
            accessibilityLabel={`Actions for ${discount.name}`}
            onClick={() => setOpen((v) => !v)}
            disabled={loading}
          />
        )
      }
      onClose={() => setOpen(false)}
      autofocusTarget="first-node"
      preferredAlignment="right"
    >
      <ActionList
        actionRole="menuitem"
        items={[
          {
            content: "Edit",
            disabled: loading,
            onAction: () => {
              setOpen(false);
              navigate(`/app/discounts/${encodeURIComponent(discount.id)}`);
            },
          },
          {
            content: "Duplicate",
            disabled: loading,
            onAction: () => submit("duplicate"),
          },
          {
            content: discount.status === "active" ? "Deactivate" : "Activate",
            disabled: loading,
            onAction: () => submit("toggle"),
          },
          {
            content: "Delete",
            destructive: true,
            disabled: loading,
            onAction: () => submit("delete"),
          },
        ]}
      />
    </Popover>
  );
}

export default function Index() {
  const { discounts } = useLoaderData();
  const navigate = useNavigate();
  const [selectedTab, setSelectedTab] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const counts = useMemo(
    () => ({
      all: discounts.length,
      active: discounts.filter((d) => d.status === "active").length,
      inactive: discounts.filter((d) => d.status === "inactive").length,
    }),
    [discounts],
  );

  const tabs = TABS.map((tab) => ({
    id: tab.id,
    content: tab.content,
    badge: String(counts[tab.id]),
    status: tab.status,
  }));

  const currentStatus = TABS[selectedTab].status;
  const filtered = useMemo(
    () =>
      currentStatus === null
        ? discounts
        : discounts.filter((d) => d.status === currentStatus),
    [discounts, currentStatus],
  );

  const handleNewDiscount = useCallback(
    () => navigate("/app/discounts/new"),
    [navigate],
  );

  const { mdDown } = useBreakpoints();

  const rowMarkup = filtered.map((discount, index) => (
    <IndexTable.Row id={discount.id} key={discount.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">
          {discount.name || "Untitled"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Box maxWidth={mdDown ? "240px" : "420px"}>
          <Text as="span" truncate>
            {buildRuleText(discount)}
          </Text>
        </Box>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={discount.status === "active" ? "success" : undefined}>
          {discount.status === "active" ? "Active" : "Inactive"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack align="end">
          <RowMenu discount={discount} />
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Buy X, Get Y discounts"
      primaryAction={{
        content: "New discount",
        icon: PlusIcon,
        onAction: handleNewDiscount,
      }}
    >
      <BlockStack gap="400">
        {!bannerDismissed && (
          <Banner
            tone="info"
            title="Set up a Buy X, Get Y offer in under a minute"
            action={{
              content: "New discount",
              icon: PlusIcon,
              onAction: handleNewDiscount,
            }}
            onDismiss={() => setBannerDismissed(true)}
          >
            <p>
              Pick what customers buy, pick what they get, set the price.
              That&apos;s it.
            </p>
          </Banner>
        )}
        <Card padding="0">
          <PillTabs
            tabs={tabs}
            selected={selectedTab}
            onSelect={setSelectedTab}
          />
          <IndexTable
            itemCount={filtered.length}
            selectable={false}
            headings={[
              { title: "Name" },
              { title: "Rule" },
              { title: "Status" },
              { title: "", hidden: true },
            ]}
            emptyState={
              <Box padding="1600">
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" tone="subdued">
                    No discounts yet.{" "}
                    <Link onClick={handleNewDiscount} removeUnderline>
                      Create your first discount
                    </Link>
                    .
                  </Text>
                </BlockStack>
              </Box>
            }
          >
            {rowMarkup}
          </IndexTable>
          <Box
            padding="400"
            borderBlockStartWidth="025"
            borderColor="border"
          >
            <InlineStack align="center">
              <Text as="span" tone="subdued">
                Learn more about{" "}
                <Link
                  url="https://help.shopify.com/manual/discounts"
                  target="_blank"
                >
                  Shopify discounts
                </Link>
              </Text>
            </InlineStack>
          </Box>
        </Card>
      </BlockStack>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
