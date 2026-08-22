/**
 * Unit tests for the Yahoo Finance price service.
 *
 * These exist because of a bug that produced no error anywhere: yahoo-finance2 v3
 * exports the class rather than a ready-made singleton, and calling `.quote()` on the
 * class throws. The service catches everything and returns {}, and the portfolio route
 * reads `prices[ticker] || h.purchase_price` — so a total failure to reach Yahoo renders
 * as a portfolio where current price equals cost basis and every gain is exactly 0.00.
 * Nothing logs to the user, and a flat portfolio looks plausible.
 *
 * So the assertion that matters is not "the happy path works" but "a price actually
 * arrives": if the client is ever used as a bare class again, `quote` is undefined, the
 * service swallows the throw, and these expectations fail instead of the app quietly
 * lying to its users.
 */

const QUOTES = [
  { symbol: 'SPY', regularMarketPrice: 613.42 },
  { symbol: 'VTI', regularMarketPrice: 378.24 },
];

let mockConstructed;
let mockQuoteImpl;

jest.mock('yahoo-finance2', () => ({
  default: class YahooFinance {
    constructor() {
      mockConstructed += 1;
    }
    quote(tickers) {
      return mockQuoteImpl(tickers);
    }
  },
}));

describe('yahooFinanceService', () => {
  let service;

  beforeEach(() => {
    jest.resetModules();
    mockConstructed = 0;
    mockQuoteImpl = jest.fn().mockResolvedValue(QUOTES);
    service = require('../../../services/yahooFinanceService');
  });

  describe('fetchPrices()', () => {
    it('returns a symbol → price map', async () => {
      await expect(service.fetchPrices(['SPY', 'VTI'])).resolves.toEqual({
        SPY: 613.42,
        VTI: 378.24,
      });
    });

    it('instantiates the client rather than calling the class', async () => {
      await service.fetchPrices(['SPY']);
      expect(mockConstructed).toBe(1);
    });

    it('reuses one client across calls', async () => {
      await service.fetchPrices(['SPY']);
      await service.fetchPrices(['VTI']);
      expect(mockConstructed).toBe(1);
    });

    it('accepts a single quote object as well as an array', async () => {
      mockQuoteImpl = jest.fn().mockResolvedValue(QUOTES[0]);
      await expect(service.fetchPrices(['SPY'])).resolves.toEqual({ SPY: 613.42 });
    });

    it('skips quotes with no price instead of writing undefined', async () => {
      mockQuoteImpl = jest
        .fn()
        .mockResolvedValue([QUOTES[0], { symbol: 'AMD', regularMarketPrice: null }]);
      await expect(service.fetchPrices(['SPY', 'AMD'])).resolves.toEqual({ SPY: 613.42 });
    });

    it('returns {} without calling Yahoo when there is nothing to look up', async () => {
      await expect(service.fetchPrices([])).resolves.toEqual({});
      await expect(service.fetchPrices(null)).resolves.toEqual({});
      expect(mockQuoteImpl).not.toHaveBeenCalled();
    });

    it('falls back to {} when the lookup fails', async () => {
      mockQuoteImpl = jest.fn().mockRejectedValue(new Error('network down'));
      jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(service.fetchPrices(['SPY'])).resolves.toEqual({});
      console.error.mockRestore();
    });
  });

  /**
   * fetchQuotes() backs POST /api/portfolio/prices and goes through the same getClient(),
   * so it failed in exactly the same way and needs the same guard -- its fallback is an
   * empty array, which the route turns into an empty price map and the page into a
   * "Refresh Prices" button that does nothing.
   */
  describe('fetchQuotes()', () => {
    it('returns the quotes rather than an empty fallback', async () => {
      await expect(service.fetchQuotes(['SPY', 'VTI'])).resolves.toEqual(QUOTES);
    });

    it('instantiates the client rather than calling the class', async () => {
      await service.fetchQuotes(['SPY']);
      expect(mockConstructed).toBe(1);
    });

    it('wraps a single quote object in an array', async () => {
      mockQuoteImpl = jest.fn().mockResolvedValue(QUOTES[0]);
      await expect(service.fetchQuotes(['SPY'])).resolves.toEqual([QUOTES[0]]);
    });

    it('returns [] without calling Yahoo when there is nothing to look up', async () => {
      await expect(service.fetchQuotes([])).resolves.toEqual([]);
      await expect(service.fetchQuotes(null)).resolves.toEqual([]);
      expect(mockQuoteImpl).not.toHaveBeenCalled();
    });

    it('falls back to [] when the lookup fails', async () => {
      mockQuoteImpl = jest.fn().mockRejectedValue(new Error('network down'));
      jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(service.fetchQuotes(['SPY'])).resolves.toEqual([]);
      console.error.mockRestore();
    });

    it('shares one client with fetchPrices', async () => {
      await service.fetchPrices(['SPY']);
      await service.fetchQuotes(['VTI']);
      expect(mockConstructed).toBe(1);
    });
  });
});
