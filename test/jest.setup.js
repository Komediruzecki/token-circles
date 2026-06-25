// Jest setup for finance-manager tests
// Suppress console output during tests unless there's a failure
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

// Mock chai to work with CommonJS
global.expect = (function() {
  // Create a minimal mock of expect
  function expect(actual) {
    const assertions = {
      toBe: function(expected) {
        if (actual !== expected) {
          throw new Error(`Expected ${expected} but received ${actual}`);
        }
      },
      toEqual: function(expected) {
        if (actual !== expected) {
          throw new Error(`Expected ${expected} but received ${actual}`);
        }
      },
      toBeDefined: function() {
        if (actual === undefined) {
          throw new Error('Expected value to be defined');
        }
      },
      toBeUndefined: function() {
        if (actual !== undefined) {
          throw new Error('Expected value to be undefined');
        }
      },
      toBeNull: function() {
        if (actual !== null) {
          throw new Error('Expected value to be null');
        }
      },
      toBeTruthy: function() {
        if (!actual) {
          throw new Error('Expected value to be truthy');
        }
      },
      toBeFalsy: function() {
        if (actual) {
          throw new Error('Expected value to be falsy');
        }
      },
      toBeInstanceOf: function(Class) {
        if (!(actual instanceof Class)) {
          throw new Error(`Expected instance of ${Class.name}`);
        }
      },
      toBeGreaterThan: function(amount) {
        if (actual <= amount) {
          throw new Error(`Expected value greater than ${amount}`);
        }
      },
      toBeGreaterThanOrEqual: function(amount) {
        if (actual < amount) {
          throw new Error(`Expected value greater than or equal to ${amount}`);
        }
      },
      toBeLessThan: function(amount) {
        if (actual >= amount) {
          throw new Error(`Expected value less than ${amount}`);
        }
      },
      toBeLessThanOrEqual: function(amount) {
        if (actual > amount) {
          throw new Error(`Expected value less than or equal to ${amount}`);
        }
      },
      // Alias for include (allows .include() syntax via Proxy)
      toInclude: function(expected) {
        if (Array.isArray(actual)) {
          if (!actual.includes(expected)) {
            throw new Error(`Expected array to include ${expected}. Got: ${JSON.stringify(actual)}`);
          }
        } else if (typeof actual === 'string') {
          if (!actual.includes(expected)) {
            throw new Error(`Expected string "${actual}" to include "${expected}"`);
          }
        } else {
          throw new Error(`Expected array or string to include value, got ${typeof actual} (${actual})`);
        }
      },
      // Alias for .include()
      include: function(expected) {
        return this.toInclude(expected);
      },
      // Alias for .to.include.keys()
      toIncludeKeys: function(...keys) {
        const actualKeys = Object.keys(actual);
        const missingKeys = keys.filter(k => !actualKeys.includes(k));
        if (missingKeys.length > 0) {
          throw new Error(`Expected object to include keys: ${missingKeys.join(', ')}`);
        }
      },
      // Alias for .to.not.include()
      toNotInclude: function(expected) {
        if (Array.isArray(actual) && actual.includes(expected)) {
          throw new Error(`Expected array not to include ${expected}`);
        }
        if (typeof actual === 'string' && actual.includes(expected)) {
          throw new Error(`Expected string not to include "${expected}"`);
        }
      },
      // Alias for .to.not.include()
      not: {
        include: function(expected) {
          if (Array.isArray(actual) && actual.includes(expected)) {
            throw new Error(`Expected array not to include ${expected}`);
          }
          if (typeof actual === 'string' && actual.includes(expected)) {
            throw new Error(`Expected string not to include "${expected}"`);
          }
        }
      },
      // Alias for include
      toContain: function(item) {
        if (!Array.isArray(actual) || !actual.includes(item)) {
          throw new Error(`Expected array to contain ${item}`);
        }
      },
      // Chai-compatible .to.be.true
      toBeTrue: function() {
        if (actual !== true) {
          throw new Error(`Expected true but received ${actual}`);
        }
      },
      toBeFalse: function() {
        if (actual !== false) {
          throw new Error(`Expected false but received ${actual}`);
        }
      },
      // Chai-compatible .to.be.undefined
      toBeUndefined: function() {
        if (actual !== undefined) {
          throw new Error(`Expected undefined but received ${actual}`);
        }
      },
      // Chai-compatible .to.be.null
      toBeNull: function() {
        if (actual !== null) {
          throw new Error(`Expected null but received ${actual}`);
        }
      },
      // Chai-compatible .to.be.ok
      toBeOk: function() {
        if (!actual) {
          throw new Error('Expected value to be truthy');
        }
      },
      // Chai-compatible .to.be.not.ok
      toBeNotOk: function() {
        if (actual) {
          throw new Error('Expected value to be falsy');
        }
      },
      // Chai-compatible .to.be.empty
      toBeEmpty: function() {
        if (Array.isArray(actual) && actual.length !== 0) {
          throw new Error(`Expected array to be empty but got length ${actual.length}`);
        }
        if (typeof actual === 'string' && actual.length !== 0) {
          throw new Error(`Expected string to be empty but got length ${actual.length}`);
        }
      },
      // Chai-compatible .to.have.length
      toHaveLength: function(length) {
        if (!Array.isArray(actual) || actual.length !== length) {
          throw new Error(`Expected array to have length ${length}`);
        }
      },
      lengthOf: function(expectedLength) {
        if (actual.length !== expectedLength) {
          throw new Error(`Expected length of ${expectedLength} but got ${actual.length}`);
        }
      },
      // Chai-compatible .to.have.lengthOf (alias)
      toHaveLengthOf: function(expectedLength) {
        if (actual.length !== expectedLength) {
          throw new Error(`Expected length of ${expectedLength} but got ${actual.length}`);
        }
      },
      // Chai-compatible .to.include.keys
      toIncludeKeys: function(...keys) {
        const actualKeys = Object.keys(actual);
        const missingKeys = keys.filter(k => !actualKeys.includes(k));
        if (missingKeys.length > 0) {
          throw new Error(`Expected object to include keys: ${missingKeys.join(', ')}`);
        }
      },
      // Chai-compatible .to.not.include
      toNotInclude: function(expected) {
        if (Array.isArray(actual) && actual.includes(expected)) {
          throw new Error(`Expected array not to include ${expected}`);
        }
        if (typeof actual === 'string' && actual.includes(expected)) {
          throw new Error(`Expected string not to include "${expected}"`);
        }
      },
      deepEqual: function(expected) {
        const jsonActual = JSON.stringify(actual);
        const jsonExpected = JSON.stringify(expected);
        if (jsonActual !== jsonExpected) {
          throw new Error(`Expected ${jsonExpected} but received ${jsonActual}`);
        }
      },
      closeTo: function(expected, precision) {
        const actualNum = Number(actual);
        if (isNaN(actualNum)) {
          throw new Error('Expected a number');
        }
        const diff = Math.abs(actualNum - expected);
        if (diff > Math.pow(10, -precision)) {
          throw new Error(`Expected ${expected} to be close to ${actualNum}`);
        }
      },
      toBeOneOf: function(values) {
        if (!values.includes(actual)) {
          throw new Error(`Expected value to be one of ${values}`);
        }
      },
      toMatch: function(pattern) {
        if (!(pattern instanceof RegExp) || !pattern.test(actual)) {
          throw new Error(`Expected string to match ${pattern}`);
        }
      },
      toSatisfy: function(fn) {
        if (!fn(actual)) {
          throw new Error(`Expected value to satisfy: ${fn.toString()}`);
        }
      },
      toEndWith: function(suffix) {
        if (typeof actual !== 'string' || !actual.endsWith(suffix)) {
          throw new Error(`Expected string to end with ${suffix}`);
        }
      },
      toStartWith: function(prefix) {
        if (typeof actual !== 'string' || !actual.startsWith(prefix)) {
          throw new Error(`Expected string to start with ${prefix}`);
        }
      },
      toBeAbove: function(amount) {
        if (actual <= amount) {
          throw new Error(`Expected value to be above ${amount}`);
        }
      },
      toBeBelow: function(amount) {
        if (actual >= amount) {
          throw new Error(`Expected value to be below ${amount}`);
        }
      },
      toBeAtLeast: function(amount) {
        if (actual < amount) {
          throw new Error(`Expected value to be at least ${amount}`);
        }
      },
      toBeAtMost: function(amount) {
        if (actual > amount) {
          throw new Error(`Expected value to be at most ${amount}`);
        }
      },
      // Alias for .to.have.property()
      toHaveProperty: function(property, expectedValue) {
        if (!(property in actual)) {
          throw new Error(`Expected object to have property ${property}`);
        }
        if (expectedValue !== undefined && actual[property] !== expectedValue) {
          throw new Error(`Expected ${property} to be ${expectedValue}`);
        }
      },
      // Negated property check
      not: {
        toHaveProperty: function(property, expectedValue) {
          if (property in actual) {
            if (expectedValue !== undefined && actual[property] === expectedValue) {
              throw new Error(`Expected property ${property} not to be ${expectedValue}`);
            }
            throw new Error(`Expected object not to have property ${property}`);
          }
        },
        include: function(expected) {
          if (Array.isArray(actual) && actual.includes(expected)) {
            throw new Error(`Expected array not to include ${expected}`);
          }
          if (typeof actual === 'string' && actual.includes(expected)) {
            throw new Error(`Expected string not to include "${expected}"`);
          }
        }
      },
      // Alias for .to.be.string()
      toBeString: function() {
        if (typeof actual !== 'string') {
          throw new Error(`Expected string but received ${typeof actual}`);
        }
      },
      // Alias for .to.be.number()
      toBeNumber: function() {
        if (typeof actual !== 'number') {
          throw new Error(`Expected number but received ${typeof actual}`);
        }
      },
      // Alias for .to.be.object()
      toBeObject: function() {
        if (typeof actual !== 'object' || actual === null) {
          throw new Error(`Expected object but received ${typeof actual}`);
        }
      },
      // Alias for .to.be.array()
      toBeArray: function() {
        if (!Array.isArray(actual)) {
          throw new Error(`Expected array but received ${typeof actual}`);
        }
      },
      // Alias for .to.be.boolean()
      toBeBoolean: function() {
        if (typeof actual !== 'boolean') {
          throw new Error(`Expected boolean but received ${typeof actual}`);
        }
      },
      // Alias for .to.be.function()
      toBeFunction: function() {
        if (typeof actual !== 'function') {
          throw new Error(`Expected function but received ${typeof actual}`);
        }
      },
      // Chai-compatible .to.be.finite
      toBeFinite: function() {
        if (typeof actual !== 'number' || !Number.isFinite(actual)) {
          throw new Error(`Expected finite number but received ${actual}`);
        }
      },
      // Chai-compatible .to.be.closeTo
      toBeCloseTo: function(expected, precision = 2) {
        const actualNum = Number(actual);
        if (isNaN(actualNum)) {
          throw new Error('Expected a number');
        }
        const diff = Math.abs(actualNum - expected);
        if (diff > Math.pow(10, -precision)) {
          throw new Error(`Expected ${expected} to be close to ${actualNum}`);
        }
      },
      // Alias for .to.contain()
      toContain: function(item) {
        if (!Array.isArray(actual) || !actual.includes(item)) {
          throw new Error(`Expected array to contain ${item}`);
        }
      },
      // Alias for .to.not.include()
      toNotInclude: function(expected) {
        if (Array.isArray(actual) && actual.includes(expected)) {
          throw new Error(`Expected array not to include ${expected}`);
        }
        if (typeof actual === 'string' && actual.includes(expected)) {
          throw new Error(`Expected string not to include "${expected}"`);
        }
      },
    };

    // Return both assertions and accessor properties for Chai chaining
    const result = new Proxy(assertions, {
      get(target, prop) {
        // If prop is a method, return it
        if (prop in target) {
          return target[prop];
        }
        // For accessor properties (to, be, have), return the assertions object itself
        // This allows chaining like .to.include()
        return assertions;
      }
    });

    return result;
  }
  return expect;
})();

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

// Also clear after all tests in each file
afterAll(async () => {
  if (global.__rateLimitStore) global.__rateLimitStore.clear();
  if (global.__authRateLimitStore) global.__authRateLimitStore.clear();
  // Reset test user password after each test file to prevent cascading failures
  try {
    const http = require('http');
    const body = JSON.stringify({});
    await new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost', port: 3847, path: '/api/test/reset-password',
        method: 'POST',
        timeout: 1000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
          'X-Skip-RateLimit': 'true'
        }
      }, () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.on('error', () => resolve());
      req.write(body);
      req.end();
    });
  } catch (e) {}
});
