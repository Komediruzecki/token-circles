/**
 * The services the runtimes call out to, answered here so that no contract scenario reaches the
 * network. Each runner routes its runtime's own `fetch` through `outbound`. A request to anything
 * not listed fails the scenario.
 */

/** Quotes the price service knows: anything else is a ticker it has never heard of. */
export const QUOTES: Readonly<
  Record<string, { price: number; previousClose: number; currency: string; name: string }>
> = {
  ACME: { price: 12.5, previousClose: 12, currency: 'USD', name: 'Acme Corp' },
};

/** Spreadsheets shared as "anyone with the link", by id, as their CSV export reads. */
export const SHEETS: Readonly<Record<string, string>> = {
  'contract-sheet':
    'Date,Description,Amount,Category\n2026-03-01,Salary,2500,Salary\n2026-03-02,Groceries,-45.50,Food\n',
};

/** The answer to one outbound request a runtime makes, by its URL. */
export async function outbound(url: string): Promise<Response> {
  // A Google Sheet's CSV export (worker/src/routes/imports.ts, fetchGoogleSheetRows, and the
  // strategies of local-first's importGoogleSheet). Its other endpoints answer 404 here.
  const sheet =
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([^/]+)\/(export\?format=csv)?/.exec(url);
  if (sheet) {
    const csv = SHEETS[sheet[1]];
    if (csv && sheet[2]) return new Response(csv, { status: 200 });
    return new Response('<!DOCTYPE html><html>Not found</html>', { status: 404 });
  }

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
