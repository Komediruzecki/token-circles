import { z } from 'zod';

/**
 * Argument fragments shared by every tool module.
 *
 * These were copied into tools-read/tools-import/tools-write, which meant the profile
 * argument's description -- the text the model reads to decide whether to pass one -- drifted
 * between the three. One definition, one wording.
 */
export const profileArg = {
  profileId: z
    .number()
    .int()
    .optional()
    .describe('Profile to act on. Omit to use the token default, then the first profile.'),
};

/** YYYY-MM-DD. */
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** YYYY-MM. */
export const MONTH = /^\d{4}-\d{2}$/;
