/**
 * @typedef {import("../generated/api").FetchInput} FetchInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateFetchResult} CartLinesDiscountsGenerateFetchResult
 */

/**
 * Fetch target for the Buy X Get Y discount Function.
 *
 * Reads the `fetch_url` metafield from the Shopify Discount and returns
 * an HTTP GET request to the app server. The server reads the metaobject
 * directly and returns the current rule as JSON — so the Function always
 * gets live data, with no sync or webhook required.
 *
 * @param {object} input
 * @returns {CartLinesDiscountsGenerateFetchResult}
 */
export function cartLinesDiscountsGenerateFetch(input) {
  const url = input.discount?.fetchUrl?.value;

  if (!url) return { request: null };

  return {
    request: {
      url,
      method: "GET",
      headers: [],
      policy: { readTimeoutMs: 5000 },
    },
  };
}
