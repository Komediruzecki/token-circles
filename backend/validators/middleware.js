/**
 * Zod validation middleware for Express routes.
 *
 * Usage:
 *   router.post('/api/transactions', validate(schema), handler);
 *   router.post('/api/transactions', validate(schema, 'body'), handler);  // default
 *   router.get('/api/transactions', validate(schema, 'query'), handler);  // query params
 */

/**
 * Create a validation middleware for the given Zod schema.
 * @param {import('zod').ZodSchema} schema - The Zod schema to validate against
 * @param {'body' | 'query' | 'params'} source - Where to get data to validate
 * @returns {import('express').RequestHandler}
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const errors = result.error.issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    // Replace request data with the parsed (and defaulted/coerced) version
    req[source] = result.data;
    next();
  };
}

/**
 * Validate both body and query in a single middleware.
 * @param {import('zod').ZodSchema} bodySchema
 * @param {import('zod').ZodSchema} querySchema
 */
function validateBoth(bodySchema, querySchema) {
  return (req, res, next) => {
    // Validate body
    if (bodySchema) {
      const bodyResult = bodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        const errors = bodyResult.error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({
          error: 'Validation failed',
          details: errors,
        });
      }
      req.body = bodyResult.data;
    }

    // Validate query
    if (querySchema) {
      const queryResult = querySchema.safeParse(req.query);
      if (!queryResult.success) {
        const errors = queryResult.error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: errors,
        });
      }
      req.query = queryResult.data;
    }

    next();
  };
}

module.exports = { validate, validateBoth };
