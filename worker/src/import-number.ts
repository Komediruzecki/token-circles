const SPACE_GROUP = /[ \u00a0\u202f]/;

function isDigits(value: string): boolean {
  if (!value) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function isGroupedInteger(value: string, separator: string | RegExp): boolean {
  const groups = value.split(separator);
  if (groups.length < 2 || !isDigits(groups[0]) || groups[0].length > 3) return false;
  return groups.slice(1).every((group) => group.length === 3 && isDigits(group));
}

export function parseImportNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  let source = value.trim().replace(/\u2212/g, '-');
  if (!source) return null;

  let negative = false;
  let accountingNegative = false;
  if (source.startsWith('(') && source.endsWith(')')) {
    accountingNegative = true;
    negative = true;
    source = source.slice(1, -1).trim();
  }
  if (source.startsWith('+') || source.startsWith('-')) {
    if (accountingNegative) return null;
    negative = source[0] === '-';
    source = source.slice(1);
  }
  if (!source || /[()+-]/.test(source)) return null;

  let normalized: string;
  if (SPACE_GROUP.test(source)) {
    const dots = (source.match(/\./g) || []).length;
    const commas = (source.match(/,/g) || []).length;
    if (dots + commas > 1) return null;
    const decimalIndex = Math.max(source.lastIndexOf('.'), source.lastIndexOf(','));
    const integerPart = decimalIndex === -1 ? source : source.slice(0, decimalIndex);
    const fraction = decimalIndex === -1 ? '' : source.slice(decimalIndex + 1);
    if (
      !isGroupedInteger(integerPart, SPACE_GROUP) ||
      (decimalIndex !== -1 && !isDigits(fraction))
    ) {
      return null;
    }
    normalized = integerPart.split(SPACE_GROUP).join('');
    if (decimalIndex !== -1) normalized += `.${fraction}`;
  } else {
    const dots = (source.match(/\./g) || []).length;
    const commas = (source.match(/,/g) || []).length;

    if (dots > 0 && commas > 0) {
      const isEuropean = source.lastIndexOf(',') > source.lastIndexOf('.');
      const groupingSeparator = isEuropean ? '.' : ',';
      const decimalSeparator = isEuropean ? ',' : '.';
      const decimalIndex = source.lastIndexOf(decimalSeparator);
      const integerPart = source.slice(0, decimalIndex);
      const fraction = source.slice(decimalIndex + 1);
      if (
        (isEuropean ? commas !== 1 : dots !== 1) ||
        !isGroupedInteger(integerPart, groupingSeparator) ||
        !isDigits(fraction)
      ) {
        return null;
      }
      normalized = `${integerPart.split(groupingSeparator).join('')}.${fraction}`;
    } else if (dots > 1 || commas > 1) {
      const separator = dots > 1 ? '.' : ',';
      if (!isGroupedInteger(source, separator)) return null;
      normalized = source.split(separator).join('');
    } else if (dots === 1 || commas === 1) {
      const separator = dots === 1 ? '.' : ',';
      const [whole, fraction] = source.split(separator);
      if (!isDigits(whole) || !isDigits(fraction)) return null;
      if (whole.length <= 3 && fraction.length === 3) return null;
      normalized = `${whole}.${fraction}`;
    } else {
      if (!isDigits(source)) return null;
      normalized = source;
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}
