// Helper to clear rate limit store in test environment
process.env.NODE_ENV = 'test';
global.__rateLimitStore && global.__rateLimitStore.clear();
global.__authRateLimitStore && global.__authRateLimitStore.clear();
console.log('Rate limit stores cleared');
