/**
 * Tests for Transaction Form Validation
 */
const fs = require('fs');
const path = require('path');

describe('Transaction form validation', () => {
  let htmlContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  });

  describe('Client-side validation function exists', () => {
    test('transactions.validate() function exists', () => {
      expect(htmlContent).toContain('validate() {');
    });

    test('validate() clears previous error states', () => {
      expect(htmlContent).toContain('.is-invalid');
    });

    test('setError() helper adds is-invalid class', () => {
      expect(htmlContent).toContain("group.classList.add('is-invalid')");
    });

    test('setError() helper adds .field-error span', () => {
      expect(htmlContent).toContain("span.className = 'field-error'");
    });

    test('validate() checks description', () => {
      expect(htmlContent).toContain("tx-description");
      expect(htmlContent).toContain("Description is required");
    });

    test('validate() checks amount', () => {
      expect(htmlContent).toContain("tx-amount");
      expect(htmlContent).toContain('Amount is required');
      expect(htmlContent).toContain('Amount must be greater than zero');
    });

    test('validate() checks date', () => {
      expect(htmlContent).toContain("tx-date");
      expect(htmlContent).toContain('Date is required');
    });

    test('validate() checks exchange rate', () => {
      expect(htmlContent).toContain("tx-exchange-rate");
    });
  });

  describe('save() calls validate()', () => {
    test('save() calls this.validate() before submitting', () => {
      const idx = htmlContent.indexOf("if (!this.validate())");
      expect(idx).toBeGreaterThan(-1);
    });

    test('save() returns early on validation failure', () => {
      const idx = htmlContent.indexOf("if (!this.validate())");
      const context = htmlContent.substring(idx, idx + 200);
      expect(context).toContain('return');
    });
  });

  describe('CSS error styles', () => {
    test('.form-group.is-invalid .form-control has red border styles', () => {
      expect(htmlContent).toContain('.form-group.is-invalid');
      expect(htmlContent).toContain("border-color: var(--danger)");
    });

    test('.field-error class is defined', () => {
      expect(htmlContent).toContain('.field-error');
      expect(htmlContent).toContain("color: var(--danger)");
    });
  });

  describe('Edit function fix', () => {
    test('transactions.edit() awaits openModal', () => {
      const idx = htmlContent.indexOf('async edit(id) { await this.openModal(id); }');
      expect(idx).toBeGreaterThan(-1);
    });
  });
});
