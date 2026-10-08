/**
 * The services the Worker calls out to, answered here so that no contract scenario reaches the
 * network. The Worker runner routes the Worker's own `fetch` through `outbound`; local-first
 * calls none of these services. A request to anything not listed fails the scenario.
 */

/** Quotes the price service knows: anything else is a ticker it has never heard of. */
export const QUOTES: Readonly<
  Record<string, { price: number; previousClose: number; currency: string; name: string }>
> = {
  ACME: { price: 12.5, previousClose: 12, currency: 'USD', name: 'Acme Corp' },
};

/** The answer to one outbound request the Worker makes, by its URL. */
export async function outbound(url: string): Promise<Response> {
  // Yahoo's chart endpoint (worker/src/routes/portfolio.ts, fetchYahooQuote).
  const chart = /^https:\/\/query[12]\.finance\.yahoo\.com\/v8\/finance\/chart\/([^?]+)/.exec(url);
  if (chart) {
    const symbol = decodeURIComponent(chart[1]);
    const quote = QUOTES[symbol];
    if (!quote) {
      return new Response(JSON.stringify({ chart: { result: null, error: 'Not Found' } }), {
        status: 404,
      });
    }
    const meta = {
      symbol,
      regularMarketPrice: quote.price,
      chartPreviousClose: quote.previousClose,
      currency: quote.currency,
      shortName: quote.name,
    };
    return new Response(JSON.stringify({ chart: { result: [{ meta }] } }), { status: 200 });
  }
  throw new Error(`a contract scenario reached the network: ${url}`);
}
