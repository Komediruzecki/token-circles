/**
 * Standardized error handling for the Finance Manager API.
 *
 * Usage:
 *   throw new AppError('Transaction not found', 404);
 *   throw new AppError('Validation failed', 400, { fields: ['name', 'amount'] });
 *
 *   router.get('/api/data', asyncHandler(async (req, res) => {
 *     // errors thrown here automatically go to next(err)
 *   }));
 */

/**
 * Application-level error with HTTP status code.
 * Throwing an AppError in an asyncHandler-wrapped route skips
 * the try/catch boilerplate and goes straight to the global error handler.
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code (default 500)
   * @param {object} [details] - Optional structured details (field names, etc.)
   */
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true; // distinguishes expected errors from programming bugs
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Subclass for 400 Bad Request errors (validation, missing params, etc.)
 */
class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = null) {
    super(message, 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * Subclass for 404 Not Found errors.
 */
class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details = null) {
    super(message, 404, details);
    this.name = 'NotFoundError';
  }
}

/**
 * Subclass for 401 Unauthorized errors.
 */
class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', details = null) {
    super(message, 401, details);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Wraps an async Express route handler so that any thrown error
 * (or rejected promise) is forwarded to `next(err)`, eliminating
 * the need for try/catch in every route handler.
 *
 * Works with both async functions and regular functions that return Promises.
 *
 * @param {Function} fn - The route handler function (req, res, next) => Promise|void
 * @returns {Function} Express middleware that catches errors and calls next(err)
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  asyncHandler,
};
