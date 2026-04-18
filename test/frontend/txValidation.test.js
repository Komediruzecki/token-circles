/**
 * Tests for Transaction Form Validation
 */
const { readFrontendContent } = require('./testUtils');

describe('Transaction form validation', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('Client-side validation function exists', () => {
    test('transactions.validate() function exists', () => {
      expect(combinedContent).toContain('validate() {');
    });

    test('validate() clears previous error states', () => {
      expect(combinedContent).toContain('.is-invalid');
    });

    test('setError() helper adds is-invalid class', () => {
      expect(combinedContent).toContain("group.classList.add('is-invalid')");
    });

    test('setError() helper adds .field-error span', () => {
      expect(combinedContent).toContain("span.className = 'field-error'");
    });

    test('validate() checks description', () => {
      expect(combinedContent).toContain("tx-description");
      expect(combinedContent).toContain("Description is required");
    });

    test('validate() checks amount', () => {
      expect(combinedContent).toContain("tx-amount");
      expect(combinedContent).toContain('Amount is required');
      expect(combinedContent).toContain('Amount must be greater than zero');
    });

    test('validate() checks date', () => {
      expect(combinedContent).toContain("tx-date");
      expect(combinedContent).toContain('Date is required');
    });

    test('validate() checks exchange rate', () => {
      expect(combinedContent).toContain("tx-exchange-rate");
    });
  });

  describe('save() calls validate()', () => {
    test('save() calls this.validate() before submitting', () => {
      const idx = combinedContent.indexOf("if (!this.validate())");
      expect(idx).toBeGreaterThan(-1);
    });

    test('save() returns early on validation failure', () => {
      const idx = combinedContent.indexOf("if (!this.validate())");
      const context = combinedContent.substring(idx, idx + 200);
      expect(context).toContain('return');
    });
  });

  describe('CSS error styles', () => {
    test('.form-group.is-invalid .form-control has red border styles', () => {
      expect(combinedContent).toContain('.form-group.is-invalid');
      expect(combinedContent).toContain("border-color: var(--danger)");
    });

    test('.field-error class is defined', () => {
      expect(combinedContent).toContain('.field-error');
      expect(combinedContent).toContain("color: var(--danger)");
    });
  });

  describe('Edit function fix', () => {
    test('transactions.edit() function exists and is async', () => {
      // Check that edit exists as async function
      expect(combinedContent).toMatch(/edit\s*=\s*async\s+function/);
      // Check that it calls FM.api to fetch data
      expect(combinedContent).toMatch(/FM\.api\(`\/transactions\/\$\{id\}`/);
    });
  });
});
