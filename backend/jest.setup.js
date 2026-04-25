// Jest setup for finance-manager tests
// Suppress console output during tests unless there's a failure
/* eslint-disable no-undef */
if (process.env.NODE_ENV === 'test') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// Set up test environment
process.env.NODE_ENV = 'test';

// Initialize shared rate limit stores to prevent cross-test pollution
if (typeof global.__rateLimitStore === 'undefined') {
  global.__rateLimitStore = new Map();
}
if (typeof global.__authRateLimitStore === 'undefined') {
  global.__authRateLimitStore = new Map();
}

// Clear rate limit stores before each test file
beforeEach(() => {
  if (global.__rateLimitStore) global.__rateLimitStore.clear();
  if (global.__authRateLimitStore) global.__authRateLimitStore.clear();
});

// Also clear after all tests
afterAll(() => {
  if (global.__rateLimitStore) global.__rateLimitStore.clear();
  if (global.__authRateLimitStore) global.__authRateLimitStore.clear();
});
