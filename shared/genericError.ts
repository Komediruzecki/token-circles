/**
 * What a client is told when a request fails in a way nobody wrote words for: by the Worker
 * (worker/src/error-response.ts), by the local-first router (localApiRouter.ts), and by the page
 * for a 500 that brought no words of its own (core/apiError.ts statusMessage).
 *
 * The error itself goes to the Worker's logs or the browser's console: its text names tables,
 * columns and code, and the person reading it in a toast cannot act on any of it.
 */
export const GENERIC_ERROR = 'Something went wrong on our side. Try again in a moment.';
