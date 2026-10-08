import { addTransaction, listTransactions } from '../helpers';
import { expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

const FIRST = '%PDF-1.4\n% Hardware store, 89.90\n';
const SECOND = '%PDF-1.4\n% Hardware store, corrected\n';

/** The form api.uploadReceipt posts: the file as `receipt`, and the transaction it belongs to. */
function receiptForm(transactionId: number, content = FIRST, name = 'hardware.pdf') {
  const form = new FormData();
  form.append('receipt', new File([content], name, { type: 'application/pdf' }));
  form.append('transaction_id', String(transactionId));
  return form;
}

async function upload(
  api: ContractApi,
  expect: Expect,
  path: string,
  form: FormData
): Promise<Json> {
  const reply = await api.post(path, form);
  expectOk(expect, reply, `POST ${path}`);
  // DIFFERENCE receipt-answers
  expect(reply.status).toBe(api.runtime === 'worker' ? 201 : 200);
  return reply.body;
}

async function transactionRow(api: ContractApi, expect: Expect, id: number): Promise<Json> {
  return (await listTransactions(api, expect)).find((t) => t.id === id);
}

export const receipts = [
  scenario(
    'a receipt is uploaded for a transaction, read back, replaced and deleted',
    async (api, expect) => {
      const tx = await addTransaction(api, expect, { description: 'Hardware store', amount: 89.9 });
      const first = await upload(api, expect, '/api/receipts/upload', receiptForm(tx));
      expect(first).toMatchObject({
        id: expect.any(Number),
        transaction_id: tx,
        original_name: 'hardware.pdf',
        file_type: 'application/pdf',
        file_size: FIRST.length,
      });

      // The transaction list carries it, which is how the page shows the receipt chip.
      expect(await transactionRow(api, expect, tx)).toMatchObject({
        receipt_id: first.id,
        receipt_name: 'hardware.pdf',
      });
      const one = await api.get(`/api/receipts/${first.id}`);
      expectOk(expect, one, 'GET /api/receipts/:id');
      expect(one.body).toMatchObject({ id: first.id, transaction_id: tx, file_size: FIRST.length });

      // The viewer reads the file by the receipt's id.
      const file = await api.get(`/api/receipts/${first.id}/file`);
      expectOk(expect, file, 'GET /api/receipts/:id/file');
      expect(file.body).toBe(FIRST);
      const byName = await api.get(`/api/receipts/file/${encodeURIComponent(first.filename)}`);
      expectOk(expect, byName, 'GET /api/receipts/file/:filename');
      expect(byName.body).toBe(FIRST);

      const forTransaction = await api.get(`/api/receipts/transaction/${tx}`);
      expectOk(expect, forTransaction, 'GET /api/receipts/transaction/:transactionId');
      // DIFFERENCE receipt-answers
      if (api.runtime === 'worker') {
        expect(forTransaction.body).toMatchObject({ id: first.id, transaction_id: tx });
      } else {
        expect(forTransaction.body).toEqual([
          expect.objectContaining({ id: first.id, transaction_id: tx }),
        ]);
      }

      // A second upload for the same transaction replaces the first.
      const second = await upload(
        api,
        expect,
        '/api/receipts',
        receiptForm(tx, SECOND, 'hardware-corrected.pdf')
      );
      expect(second.id).not.toBe(first.id);
      expect((await api.get(`/api/receipts/${first.id}`)).status).toBe(404);
      expect((await api.get(`/api/receipts/${second.id}/file`)).body).toBe(SECOND);
      expect(await transactionRow(api, expect, tx)).toMatchObject({
        receipt_id: second.id,
        receipt_name: 'hardware-corrected.pdf',
      });

      const removed = await api.delete(`/api/receipts/${second.id}`);
      expectOk(expect, removed, 'DELETE /api/receipts/:id');
      // DIFFERENCE receipt-answers
      expect(removed.body).toEqual(
        api.runtime === 'worker' ? { message: 'Receipt deleted successfully' } : { ok: true }
      );
      expect((await api.get(`/api/receipts/${second.id}`)).status).toBe(404);
      expect((await api.get(`/api/receipts/${second.id}/file`)).status).toBe(404);
      expect(await transactionRow(api, expect, tx)).toMatchObject({ receipt_id: null });
      expect((await api.delete(`/api/receipts/${second.id}`)).status).toBe(404);
    }
  ),

  scenario("another profile's receipt is not read or deleted", async (api, expect) => {
    const tx = await addTransaction(api, expect, { description: 'Hardware store', amount: 89.9 });
    const mine = await upload(api, expect, '/api/receipts/upload', receiptForm(tx));
    const other = api.other;
    expect((await other.get(`/api/receipts/${mine.id}`)).status).toBe(404);
    expect((await other.get(`/api/receipts/${mine.id}/file`)).status).toBe(404);
    expect(
      (await other.get(`/api/receipts/file/${encodeURIComponent(mine.filename)}`)).status
    ).toBe(404);
    expect((await other.get(`/api/receipts/transaction/${tx}`)).status).toBe(404);
    expect((await other.delete(`/api/receipts/${mine.id}`)).status).toBe(404);
    // Nor attached to a transaction that is not theirs.
    expect((await other.post('/api/receipts/upload', receiptForm(tx))).status).toBe(404);
    expect((await api.get(`/api/receipts/${mine.id}/file`)).body).toBe(FIRST);
  }),
];
