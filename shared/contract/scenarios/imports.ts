import { SHEETS } from '../outbound';
import { expectOk, scenario } from '../types';

export const imports = [
  scenario('a shared Google Sheet is read for the mapping step', async (api, expect) => {
    // The Import page's Google Sheets tab sends the link and the tab it last chose.
    const reply = await api.post('/api/import/googlesheet', {
      url: 'https://docs.google.com/spreadsheets/d/contract-sheet/edit#gid=0',
      sheetName: '',
    });
    expectOk(expect, reply, 'POST /api/import/googlesheet');
    expect(reply.body).toMatchObject({
      headers: ['Date', 'Description', 'Amount', 'Category'],
      rows: [
        ['2026-03-01', 'Salary', '2500', 'Salary'],
        ['2026-03-02', 'Groceries', '-45.50', 'Food'],
      ],
      sheetNames: ['Sheet1'],
      selectedSheet: 'Sheet1',
    });
    expect(SHEETS['contract-sheet']).toContain('Groceries');

    expect(
      (await api.post('/api/import/googlesheet', { url: 'https://example.com/not-a-sheet' })).status
    ).toBe(400);
  }),

  scenario('a spreadsheet file is uploaded for the mapping step', async (api, expect) => {
    // The Import page's file tab posts the file as a form (handleFileUpload).
    const form = new FormData();
    form.append(
      'file',
      new File(
        ['Date,Description,Amount\n2026-03-01,Salary,2500\n2026-03-02,Groceries,-45.50\n'],
        'statement.csv',
        { type: 'text/csv' }
      )
    );
    const reply = await api.post('/api/import/upload', form);
    expectOk(expect, reply, 'POST /api/import/upload');
    // DIFFERENCE import-upload-answer
    if (api.runtime === 'worker') {
      expect(reply.body).toEqual({
        headers: ['Date', 'Description', 'Amount'],
        rows: [
          ['2026-03-01', 'Salary', '2500'],
          ['2026-03-02', 'Groceries', '-45.50'],
        ],
        selectedSheet: 'CSV',
        sheetNames: ['CSV'],
      });
    } else {
      expect(reply.body).toMatchObject({ filename: 'statement.csv', row_count: 2 });
      expect(reply.body.sheetNames).toBeUndefined();
      expect(reply.body.rows[0]).toMatchObject({ description: 'Salary' });
    }
  }),
];
