/**
 * Fail fast on Render (or any host) with a clear message when required env is missing.
 */
const required = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
];

const missing = required.filter((key) => !process.env[key]?.trim());

if (missing.length) {
  console.error(
    "[customer-discount] Missing required environment variables:",
    missing.join(", "),
  );
  console.error(
    "Set them in Render → Environment (SHOPIFY_APP_URL must be your public https URL).",
  );
  process.exit(1);
}

if (!process.env.SHOPIFY_APP_URL.startsWith("https://")) {
  console.error(
    "[customer-discount] SHOPIFY_APP_URL must start with https:// (got:",
    process.env.SHOPIFY_APP_URL,
    ")",
  );
  process.exit(1);
}

if (!process.env.HOST) {
  process.env.HOST = "0.0.0.0";
}
