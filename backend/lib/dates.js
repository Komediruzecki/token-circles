/**
 * Shared date-parsing utilities.
 *
 * Extracted from transactions.js and importRoutes.js where the exact same
 * parseDateString function was duplicated verbatim.
 */

/**
 * Creates a parseDateString function that uses the provided spreadsheetService
 * for Excel serial date decoding.
 *
 * @param {{ parseExcelDate: (n: number) => { y: number, m: number, d: number } | null }} spreadsheetService
 * @returns {(dateStr: string | number | null | undefined) => string}
 */
function createParseDateString(spreadsheetService) {
  return function parseDateString(dateStr) {
    if (!dateStr) return new Date().toISOString().split('T')[0];
    if (typeof dateStr === 'number') {
      // Excel serial date code
      const d = spreadsheetService.parseExcelDate(dateStr);
      if (d) return new Date(d.y, d.m - 1, d.d).toISOString().split('T')[0];
    }
    const s = String(dateStr).trim();
    // Try DD/MM/YYYY or DD-MM-YYYY (European)
    const euMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (euMatch) {
      const [, d, m, y] = euMatch;
      return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toISOString().split('T')[0];
    }
    // Try MM/DD/YYYY (US) or ISO
    const date = new Date(s);
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    return new Date().toISOString().split('T')[0];
  };
}

module.exports = { createParseDateString };
