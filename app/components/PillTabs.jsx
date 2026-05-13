/* eslint-disable react/prop-types */
/**
 * Custom pill tab bar that always renders all tabs in one row.
 *
 * Polaris v13 `<Tabs>` has a container-width measurement bug inside Shopify
 * iframes that causes it to permanently show a "More views" disclosure, so
 * we render the tab strip manually using Polaris CSS tokens.
 *
 * @param {{
 *   tabs: { id: string; content: string; badge?: string }[];
 *   selected: number;
 *   onSelect: (index: number) => void;
 * }} props
 */
export function PillTabs({ tabs, selected, onSelect }) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px",
        overflowX: "auto",
        background: "var(--p-color-bg-surface-secondary)",
        borderBottom:
          "var(--p-border-width-025) solid var(--p-color-border)",
      }}
    >
      {tabs.map((tab, index) => {
        const isSelected = index === selected;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelect(index)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 12px",
              border: "none",
              borderRadius: "var(--p-border-radius-200)",
              cursor: "pointer",
              background: isSelected
                ? "var(--p-color-bg-surface)"
                : "transparent",
              boxShadow: isSelected ? "var(--p-shadow-100)" : "none",
              color: "var(--p-color-text)",
              fontFamily: "inherit",
              fontSize: "var(--p-font-size-325)",
              fontWeight: isSelected
                ? "var(--p-font-weight-semibold)"
                : "var(--p-font-weight-regular)",
              lineHeight: "var(--p-font-line-height-500)",
              whiteSpace: "nowrap",
              transition: "background 0.1s ease, box-shadow 0.1s ease",
            }}
          >
            {tab.content}
            {tab.badge ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: "20px",
                  height: "20px",
                  padding: "0 6px",
                  background: "var(--p-color-bg-fill-secondary)",
                  borderRadius: "var(--p-border-radius-full)",
                  fontSize: "var(--p-font-size-275)",
                  fontWeight: "var(--p-font-weight-medium)",
                  color: "var(--p-color-text-secondary)",
                  lineHeight: 1,
                }}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
