import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Rebuild using the bundled Codex runtime, never repository dependencies.
const here = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot =
  process.env.CODEX_ARTIFACT_NODE_MODULES ||
  '/home/maff/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'token-circles-economics-'));
await fs.symlink(moduleRoot, path.join(runtime, 'node_modules'), 'dir');
const require = createRequire(path.join(runtime, 'package.json'));
const { Workbook, SpreadsheetFile } = await import(
  pathToFileURL(require.resolve('@oai/artifact-tool'))
);
const input = JSON.parse(await fs.readFile(path.join(here, 'assumptions.json'), 'utf8'));
const d = input.drivers;
const output = path.resolve(here, '../../outputs');
const previewDir = path.join(runtime, 'previews');
await fs.mkdir(output, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const wb = Workbook.create();
const units = wb.worksheets.add('Unit economics');
const assumptions = wb.worksheets.add('Assumptions');
const monthly = wb.worksheets.add('Monthly model');
const color = {
  ink: '#18372F',
  header: '#234D40',
  pale: '#EFF5F1',
  rule: '#B9C9BF',
  input: '#FFF2CE',
  blue: '#0000FF',
  link: '#008000',
  amber: '#8A5414',
};
const money = '#,##0.00;(#,##0.00);"—"';
const currency = '"€"#,##0.00;("€"#,##0.00);"—"';
const integer = '#,##0;(#,##0);"—"';
const percent = '0.0%;(0.0%);"—"';
const cell = (s, a, value) => {
  s.getRange(a).values = [[value]];
};
const formula = (s, a, value) => {
  s.getRange(a).formulas = [[value]];
};
function base(s, lastCol, lastRow) {
  s.showGridLines = false;
  const area = s.getRange(`A1:${lastCol}${lastRow}`);
  area.format.font = { name: 'Arial', size: 10, color: '#000000' };
  area.format.verticalAlignment = 'center';
  area.format.rowHeight = 23;
  s.getRange(`A1:A${lastRow}`).format.columnWidthPx = 22;
}
function title(s, text, lastCol) {
  cell(s, 'B2', text);
  s.getRange('B2').format.font = { name: 'Arial', size: 16, bold: true, color: color.ink };
  s.getRange(`B3:${lastCol}3`).format.borders = { bottom: { style: 'thin', color: color.rule } };
  s.getRange('B2').format.rowHeight = 30;
}
function header(s, range) {
  s.getRange(range).format = {
    fill: color.header,
    font: { name: 'Arial', size: 10, color: '#FFFFFF', bold: true },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    wrapText: true,
  };
}
function inputCell(s, address, format = money) {
  s.getRange(address).format.fill = color.input;
  s.getRange(address).format.font.color = color.blue;
  s.getRange(address).setNumberFormat(format);
}
function band(s, range) {
  s.getRange(range).format.fill = color.pale;
  s.getRange(range).format.font.bold = true;
  s.getRange(range).format.borders = { bottom: { style: 'thin', color: color.rule } };
}

base(assumptions, 'L', 109);
assumptions.tabColor = '#688976';
assumptions.getRange('B1:B109').format.columnWidthPx = 308;
assumptions.getRange('C1:C109').format.columnWidthPx = 130;
assumptions.getRange('D1:D109').format.columnWidthPx = 76;
assumptions.getRange('E1:E109').format.columnWidthPx = 80;
assumptions.getRange('F1:F109').format.columnWidthPx = 605;
assumptions.getRange('G1:L109').format.columnWidthPx = 100;
title(assumptions, 'Token Circles subscription assumptions', 'F');
cell(assumptions, 'B4', 'Blue values are editable. Yellow blank costs are unknown, not zero.');
cell(assumptions, 'B5', 'Driver');
cell(assumptions, 'C5', 'Value');
cell(assumptions, 'D5', 'Unit');
cell(assumptions, 'F5', 'Basis / source key');
header(assumptions, 'B5:D5');
header(assumptions, 'F5');
const drivers = [
  [
    'Tax rate',
    d.taxRate,
    '%',
    '25% Croatian illustration. Set customer-specific tax. S15',
    percent,
  ],
  [
    'List price includes tax',
    d.taxInclusive,
    '1=yes',
    '1 inclusive; 0 adds tax to the catalog price. Live Stripe setting unknown.',
    '0',
  ],
  [
    'Full-refund rate',
    d.refundRate,
    '%',
    'Illustrative. Proportional sales and transaction-tax reversal.',
    percent,
  ],
  [
    'Native commission refund credit',
    d.nativeCommissionRefundCredit,
    'share',
    '1 reverses all commission on refunded sales. Verify actual settlement.',
    percent,
  ],
  [
    'Alternative commission refund credit',
    d.alternativeCommissionRefundCredit,
    'share',
    '1 reverses all commission on refunded sales. Verify actual settlement.',
    percent,
  ],
  [
    'Processing fee refund credit',
    d.processingFeeRefundCredit,
    'share',
    '0 retains original PSP/fixed fees on refunded payments. Verify contract.',
    percent,
  ],
  [
    'Billing fee refund credit',
    d.billingFeeRefundCredit,
    'share',
    'Conservative zero credit assumption. Confirm invoice treatment.',
    percent,
  ],
  [
    'Tax calculation fee refund credit',
    d.taxCalculationFeeRefundCredit,
    'share',
    'Conservative zero credit assumption. Confirm invoice treatment.',
    percent,
  ],
  [
    'Native reduced / Play recurring',
    d.nativeReducedRate,
    '%',
    'Apple eligible reduced rate or ordinary Play recurring total. S01 S02 S06',
    percent,
  ],
  [
    'Apple EU standard native',
    d.nativeEUStandardRate,
    '%',
    'Announced October 1 EU IAP rate under applicable new terms. S03 S04',
    percent,
  ],
  [
    'Apple ordinary first-year native',
    d.nativeOrdinaryStandardRate,
    '%',
    'Ordinary standard first-year subscription rate outside new EU branch. S01',
    percent,
  ],
  [
    'Alternative reduced / EEA Play',
    d.alternativeReducedRate,
    '%',
    'Apple qualifying EU or current Play EEA recurring service fee. S03 S07',
    percent,
  ],
  [
    'Apple EU alternative in-app standard',
    d.alternativeEUInAppStandardRate,
    '%',
    'Announced October 1 standard commission plus own PSP. S03 S04',
    percent,
  ],
  [
    'Apple EU out-of-app standard',
    d.alternativeEUOutOfAppStandardRate,
    '%',
    'Announced October 1 external offer commission plus own PSP. S03 S04',
    percent,
  ],
  [
    'Play US alternative recurring',
    d.alternativeUSPlayRate,
    '%',
    'October 1 reporting/fee start announced July 22. S08',
    percent,
  ],
  [
    'US iOS external fee sensitivity',
    d.usAppleExternalRateSensitivityOnly,
    '%',
    '0 is a sensitivity only. Final fee terms unverified. Try 5%, 10%, 15%. S05',
    percent,
  ],
  [
    'Stripe standard EEA cards',
    d.stripeStandardEEACardRate,
    '%',
    'Assumed Croatian merchant account. Standard EEA card, not premium. S09',
    percent,
  ],
  [
    'Stripe international cards',
    d.stripeInternationalCardRate,
    '%',
    'Includes US-issued cards at Croatian merchant list pricing. S09',
    percent,
  ],
  [
    'Stripe fixed charge',
    d.stripeFixedFeeEUR,
    'EUR',
    'Per successful payment. Checkout included. S09',
    currency,
  ],
  [
    'Stripe Billing',
    d.stripeBillingRate,
    '% gross',
    'Pay-as-you-go. Gross base is a planning assumption to reconcile. S10',
    percent,
  ],
  [
    'Stripe Tax Basic',
    d.stripeTaxBasicRate,
    '% gross',
    'Gross incl tax where registered; set 0 when not applicable. S11',
    percent,
  ],
  [
    'Extra currency conversion',
    d.extraCurrencyConversionRate,
    '% gross',
    '0 default. Stripe lists an additional 2% when conversion is required. S09',
    percent,
  ],
  [
    'RevenueCat enabled',
    d.revenueCatEnabled,
    '1=yes',
    '0 disables modeled middleware fees. S12',
    '0',
  ],
  [
    'This cohort tracked by RevenueCat',
    d.revenueCatTrackedShare,
    'share',
    '1 means all payments tracked; 0 means none. Includes Stripe only if imported.',
    percent,
  ],
  [
    'RevenueCat free threshold',
    d.revenueCatThresholdUSD,
    'USD MTR',
    'Model switches to paid at threshold; confirm exact boundary wording. S12',
    integer,
  ],
  [
    'RevenueCat paid tier rate',
    d.revenueCatPaidRate,
    '% gross',
    'Paid tier applies to all tracked gross, not just threshold excess. S12 S13',
    percent,
  ],
  [
    'USD per EUR, illustration only',
    d.usdPerEURIllustrativeOnly,
    'USD/EUR',
    '1.00 is not a market quote. Replace before actual threshold decisions.',
    '0.0000',
  ],
  [
    'Other tracked revenue this month',
    d.otherRevenueCatMTRUSD,
    'USD MTR',
    'Other app/cohort gross counted for middleware billing. Scenario, not actual.',
    money,
  ],
  [
    'Example successful charges this month',
    d.illustrativePaymentsInMonth,
    'payments',
    '1,000 is illustrative. Annual payments count fully in the charge month.',
    integer,
  ],
  [
    'Selected catalog row',
    d.selectedPriceIndex,
    '1–6',
    '1 Basic monthly; 2 Basic annual; 3 Advanced monthly; 4 annual; 5/6 Ultimate.',
    '0',
  ],
  [
    'Selected channel row',
    d.selectedChannelIndex,
    '1–10',
    'See channel matrix below. Monthly model uses this single selection.',
    '0',
  ],
  [
    'Variable delivery / support expense',
    d.monthlyVariableDeliverySupportEUR,
    'EUR/month',
    'Missing. Include infrastructure, receipts, support, disputes and related costs.',
    currency,
  ],
  [
    'Allocated fixed operating expense',
    d.monthlyFixedOperatingCostEUR,
    'EUR/month',
    'Missing. Use an explicit share of existing portfolio costs.',
    currency,
  ],
  [
    'Development / design expense',
    d.monthlyDevelopmentDesignExpenseEUR,
    'EUR/month',
    'Missing. Distinguish current expense from capitalized work as appropriate.',
    currency,
  ],
  [
    'Customer acquisition expense',
    d.monthlyAcquisitionExpenseEUR,
    'EUR/month',
    'Missing. Actual spend attributed to the modeled business period.',
    currency,
  ],
  [
    'Recognized net revenue',
    d.recognizedNetRevenueEUR,
    'EUR/month',
    'Missing. Tax-exclusive earned revenue; annual collections are not all earned.',
    currency,
  ],
  [
    'Recognized channel / middleware expense',
    d.recognizedChannelAndMiddlewareExpenseEUR,
    'EUR/month',
    'Missing. Matching-period fees for operating-profit calculation.',
    currency,
  ],
];
drivers.forEach((row, i) => {
  const r = i + 6;
  assumptions.getRange(`B${r}:D${r}`).values = [[row[0], row[1], row[2]]];
  cell(assumptions, `F${r}`, row[3]);
  inputCell(assumptions, `C${r}`, row[4]);
});
assumptions.getRange('C22:C23').setNumberFormat('0.00%;(0.00%);"—"');
for (const r of [7, 28])
  assumptions.getRange(`C${r}`).dataValidation = {
    rule: { type: 'whole', operator: 'between', formula1: 0, formula2: 1 },
  };
assumptions.getRange('C35').dataValidation = {
  rule: { type: 'whole', operator: 'between', formula1: 1, formula2: 6 },
};
assumptions.getRange('C36').dataValidation = {
  rule: { type: 'whole', operator: 'between', formula1: 1, formula2: 10 },
};
assumptions
  .getRange('C37:C42')
  .conditionalFormats.add('containsBlanks', { format: { fill: '#FFE5C2' } });
cell(assumptions, 'B46', 'Catalog prices (EUR)');
band(assumptions, 'B46:D46');
assumptions.getRange('B48:D48').values = [['Plan / interval', 'Months', 'List price EUR']];
header(assumptions, 'B48:D48');
input.prices.forEach((p, i) => {
  assumptions.getRange(`B${i + 49}:D${i + 49}`).values = [
    [`${p.plan} ${p.interval.toLowerCase()}`, p.months, p.listPrice],
  ];
  inputCell(assumptions, `D${i + 49}`, currency);
});
cell(
  assumptions,
  'F49',
  'S14. Display defaults from plans.ts; live Stripe Price IDs control real charges.'
);
cell(assumptions, 'F50', 'Historical “PriceUsd” field names contain EUR amounts.');
cell(assumptions, 'B57', 'Channel fee mapping');
band(assumptions, 'B57:L57');
assumptions.getRange('B59:L59').values = [
  [
    'Channel',
    'Store rate',
    'PSP rate',
    'Fixed EUR',
    'Billing',
    'Tax Basic',
    'Extra FX',
    'Store refund credit',
    'PSP refund credit',
    'Billing refund credit',
    'Tax refund credit',
  ],
];
header(assumptions, 'B59:L59');
assumptions.getRange('B59:L59').format.rowHeight = 44;
const channelDefs = [
  ['Native reduced / Play', 14, null, 9],
  ['Apple EU native standard', 15, null, 9],
  ['Apple ordinary standard', 16, null, 9],
  ['Web Stripe EEA card', null, 22, 10],
  ['Web Stripe international', null, 23, 10],
  ['Alternative reduced EEA', 17, 22, 10],
  ['Apple EU in-app standard', 18, 22, 10],
  ['Apple EU link standard', 19, 22, 10],
  ['Play US alternative', 20, 23, 10],
  ['US iOS link sensitivity', 21, 23, 10],
];
channelDefs.forEach(([name, storeRow, pspRow, creditRow], i) => {
  const r = 60 + i;
  cell(assumptions, `B${r}`, name);
  const f = [
    storeRow ? `=$C$${storeRow}` : '=0',
    pspRow ? `=$C$${pspRow}` : '=0',
    pspRow ? '=$C$24' : '=0',
    pspRow ? '=$C$25' : '=0',
    pspRow ? '=$C$26' : '=0',
    pspRow ? '=$C$27' : '=0',
    `=$C$${creditRow}`,
    '=$C$11',
    '=$C$12',
    '=$C$13',
  ];
  assumptions.getRange(`C${r}:L${r}`).formulas = [f];
});
assumptions.getRange('C60:L69').setNumberFormat(percent);
assumptions.getRange('E60:E69').setNumberFormat(money);
assumptions.getRange('D60:D69').setNumberFormat('0.00%;(0.00%);"—"');
cell(assumptions, 'B72', 'Source inventory');
band(assumptions, 'B72:F72');
const sourceKeys = [
  'appleOrdinary',
  'appleSmallBusiness',
  'appleEU',
  'appleAgreement',
  'appleReview',
  'playFees',
  'playEEA',
  'playUS',
  'stripePayments',
  'stripeBilling',
  'stripeTax',
  'revenueCatPricing',
  'revenueCatMTR',
  'catalog',
  'vat',
];
sourceKeys.forEach((key, i) => {
  cell(assumptions, `B${74 + i}`, `S${String(i + 1).padStart(2, '0')} ${key}`);
  cell(assumptions, `C${74 + i}`, input.sources[key]);
});
cell(
  assumptions,
  'B90',
  'Checked 13 September 2026. Live prices and accepted contracts need recheck.'
);
cell(assumptions, 'B92', 'Model limits');
band(assumptions, 'B92:F92');
const limits = [
  'One tax setting applies to this comparison. Use 0% for a no-sales-tax scenario, not an assumed US rule.',
  'All prices remain EUR. International card cost is not a USD price conversion or a US merchant fee.',
  'US iOS link permission is verified; its zero-fee input is only a sensitivity, not a final contractual quote.',
  'Refunds reverse revenue and transaction tax. Commission/PSP/Billing/Tax credits are editable assumptions.',
  'RevenueCat is estimated on pre-refund gross. Check adjustments and the precise threshold boundary.',
  'Annual charges enter MTR in full. Monthly cash contribution and recognized profit are different measures.',
  'Future EU/US program fees are modeled without enrollment or eligibility assumptions becoming approvals.',
  'Cost cells are intentionally blank until supplied. Enter 0 only when the cost is actually zero.',
];
limits.forEach((t, i) => cell(assumptions, `B${94 + i}`, t));
assumptions.freezePanes.freezeRows(5);

base(units, 'N', 85);
units.tabColor = color.header;
units.getRange('B1:B85').format.columnWidthPx = 170;
units.getRange('C1:C85').format.columnWidthPx = 120;
units.getRange('D1:N85').format.columnWidthPx = 97;
title(units, 'Token Circles subscription proceeds', 'N');
cell(
  units,
  'B4',
  'EUR per successful initial charge. After modeled refunds and transaction tax; before RevenueCat and operating costs.'
);
cell(units, 'B5', 'Tax rate');
formula(units, 'C5', "='Assumptions'!C6");
units.getRange('C5').setNumberFormat(percent);
cell(units, 'E5', 'Tax included');
formula(units, 'F5', "='Assumptions'!C7");
cell(units, 'H5', 'Refund rate');
formula(units, 'I5', "='Assumptions'!C8");
units.getRange('I5').setNumberFormat(percent);
units.getRange('B7:N7').values = [
  [
    'Plan',
    'Interval',
    'Customer total',
    'Native reduced',
    'EU native standard',
    'Ordinary native standard',
    'Stripe EEA card',
    'Stripe international',
    'Alt EEA reduced',
    'EU in-app standard',
    'EU link standard',
    'Play US alternative',
    'US iOS link sensitivity',
  ],
];
header(units, 'B7:N7');
units.getRange('B7:N7').format.rowHeight = 52;
input.prices.forEach((p, i) => {
  const r = i + 8;
  cell(units, `B${r}`, p.plan);
  cell(units, `C${r}`, p.interval);
  formula(units, `D${r}`, `=D${23 + i * 10}`);
  for (let j = 0; j < 10; j++)
    formula(units, `${String.fromCharCode(69 + j)}${r}`, `=M${23 + i * 10 + j}`);
  if (i % 2 === 1) units.getRange(`B${r}:N${r}`).format.fill = color.pale;
});
units.getRange('D8:N13').setNumberFormat(currency);
cell(units, 'B15', 'Platform rate');
for (let j = 0; j < 10; j++)
  formula(units, `${String.fromCharCode(69 + j)}15`, `='Assumptions'!C${60 + j}`);
units.getRange('E15:N15').setNumberFormat(percent);
cell(
  units,
  'B17',
  '15% depends on Apple eligibility/tenure or Play recurring billing. EU 26% and alternatives use the announced October 1 schedule.'
);
cell(
  units,
  'B18',
  'US iOS link column starts at a 0% platform-fee sensitivity. Change Assumptions C21; approval requires a fresh terms check.'
);
cell(
  units,
  'B19',
  'Annual proceeds cover twelve months of service. Divide by twelve for an equivalent month; do not treat that as cash timing.'
);
cell(units, 'B21', 'Payment calculation detail');
band(units, 'B21:M21');
units.getRange('B22:M22').values = [
  [
    'Catalog item',
    'Channel',
    'Gross charged',
    'Gross refund',
    'Net tax',
    'Retained sales ex tax',
    'Store fee',
    'PSP incl fixed',
    'Billing fee',
    'Tax Basic fee',
    'Extra FX',
    'Proceeds',
  ],
];
header(units, 'B22:M22');
units.getRange('B22:M22').format.rowHeight = 44;
input.prices.forEach((p, i) =>
  channelDefs.forEach((channel, j) => {
    const r = 23 + i * 10 + j;
    const a = 49 + i;
    const c = 60 + j;
    formula(units, `B${r}`, `='Assumptions'!B${a}`);
    formula(units, `C${r}`, `='Assumptions'!B${c}`);
    units.getRange(`D${r}:M${r}`).formulas = [
      [
        `=IF('Assumptions'!$C$7=1,'Assumptions'!$D$${a},'Assumptions'!$D$${a}*(1+'Assumptions'!$C$6))`,
        `=D${r}*'Assumptions'!$C$8`,
        `=(D${r}-E${r})*'Assumptions'!$C$6/(1+'Assumptions'!$C$6)`,
        `=D${r}-E${r}-F${r}`,
        `=D${r}/(1+'Assumptions'!$C$6)*'Assumptions'!$C$${c}*(1-'Assumptions'!$C$8*'Assumptions'!$I$${c})`,
        `=(D${r}*'Assumptions'!$D$${c}+'Assumptions'!$E$${c})*(1-'Assumptions'!$C$8*'Assumptions'!$J$${c})`,
        `=D${r}*'Assumptions'!$F$${c}*(1-'Assumptions'!$C$8*'Assumptions'!$K$${c})`,
        `=D${r}*'Assumptions'!$G$${c}*(1-'Assumptions'!$C$8*'Assumptions'!$L$${c})`,
        `=D${r}*'Assumptions'!$H$${c}*(1-'Assumptions'!$C$8*'Assumptions'!$J$${c})`,
        `=G${r}-SUM(H${r}:L${r})`,
      ],
    ];
    if (i % 2 === 1) units.getRange(`B${r}:M${r}`).format.fill = '#F7F9F7';
  })
);
units.getRange('D23:M82').setNumberFormat(money);
units.getRange('B23:C82').format.wrapText = true;
units.getRange('B23:M82').format.rowHeight = 34;
units.getRange('B23:F82').format.font.color = color.link;
units.getRange('H23:L82').format.font.color = color.link;
units.getRange('M23:M82').format.font.bold = true;
units.freezePanes.freezeRows(7);
units.freezePanes.freezeColumns(3);

base(monthly, 'F', 44);
monthly.tabColor = '#91A89A';
monthly.getRange('B1:B44').format.columnWidthPx = 340;
monthly.getRange('C1:C44').format.columnWidthPx = 160;
monthly.getRange('D1:D44').format.columnWidthPx = 18;
monthly.getRange('E1:E44').format.columnWidthPx = 640;
monthly.getRange('F1:F44').format.columnWidthPx = 20;
title(monthly, 'Monthly contribution and profit inputs', 'E');
cell(
  monthly,
  'B4',
  'The 1,000-payment example is illustrative. Missing expenses keep profit unavailable.'
);
const labels = {
  5: 'Selected catalog item',
  6: 'Selected payment channel',
  7: 'Successful payments in month',
  8: 'Months of service per payment',
  10: 'Gross cash collected',
  11: 'Gross refunds',
  12: 'Transaction tax retained for remittance',
  13: 'Retained sales, excluding tax',
  14: 'Store commission',
  15: 'Processing including fixed fees',
  16: 'Stripe Billing',
  17: 'Stripe Tax Basic',
  18: 'Extra currency conversion',
  19: 'Payment proceeds',
  21: 'This cohort gross tracked by RevenueCat',
  22: 'Other tracked revenue (USD)',
  23: 'Total MTR for threshold (USD)',
  24: 'Applied RevenueCat rate',
  25: 'This cohort RevenueCat fee',
  26: 'Cash after payment and middleware fees',
  28: 'Variable delivery / support expense',
  29: 'Contribution after variable costs',
  30: 'Customer acquisition expense',
  31: 'Allocated fixed operating expense',
  32: 'Development / design expense',
  33: 'Cash after modeled costs',
  35: 'Recognized net revenue',
  36: 'Recognized channel / middleware expense',
  37: 'Operating profit before income taxes',
};
Object.entries(labels).forEach(([r, v]) => cell(monthly, `B${r}`, v));
formula(monthly, 'C5', "=INDEX('Assumptions'!$B$49:$B$54,'Assumptions'!$C$35)");
formula(monthly, 'C6', "=INDEX('Assumptions'!$B$60:$B$69,'Assumptions'!$C$36)");
formula(monthly, 'C7', "='Assumptions'!C34");
formula(monthly, 'C8', "=INDEX('Assumptions'!$C$49:$C$54,'Assumptions'!$C$35)");
for (const [row, col] of [
  [10, 'D'],
  [11, 'E'],
  [12, 'F'],
  [13, 'G'],
  [14, 'H'],
  [15, 'I'],
  [16, 'J'],
  [17, 'K'],
  [18, 'L'],
]) {
  formula(
    monthly,
    `C${row}`,
    `=INDEX('Unit economics'!$${col}$23:$${col}$82,('Assumptions'!$C$35-1)*10+'Assumptions'!$C$36)*$C$7`
  );
}
formula(monthly, 'C19', '=C13-SUM(C14:C18)');
formula(monthly, 'C21', "=C10*'Assumptions'!C29");
formula(monthly, 'C22', "='Assumptions'!C33");
formula(monthly, 'C23', "=C21*'Assumptions'!C32+C22");
formula(monthly, 'C24', "=IF('Assumptions'!C28=0,0,IF(C23<'Assumptions'!C30,0,'Assumptions'!C31))");
formula(monthly, 'C25', '=C21*C24');
formula(monthly, 'C26', '=C19-C25');
for (const [target, src] of [
  [28, 37],
  [30, 40],
  [31, 38],
  [32, 39],
  [35, 41],
  [36, 42],
])
  formula(
    monthly,
    `C${target}`,
    `=IF(ISNUMBER('Assumptions'!C${src}),'Assumptions'!C${src},"n.a.")`
  );
formula(monthly, 'C29', '=IF(ISNUMBER(C28),C26-C28,"n.a.")');
formula(monthly, 'C33', '=IF(COUNT(C28,C30:C32)=4,C26-SUM(C28,C30:C32),"n.a.")');
formula(monthly, 'C37', '=IF(COUNT(C28,C30:C32,C35:C36)=6,C35-C36-SUM(C28,C30:C32),"n.a.")');
monthly.getRange('C10:C37').setNumberFormat(currency);
monthly.getRange('C10:C37').format.horizontalAlignment = 'right';
monthly.getRange('C22:C23').setNumberFormat('"$"#,##0.00;("$"#,##0.00);"—"');
monthly.getRange('C24').setNumberFormat(percent);
monthly.getRange('C7:C8').setNumberFormat(integer);
monthly.getRange('C5:C6').format.wrapText = true;
monthly.getRange('B5:C6').format.rowHeight = 38;
for (const r of [19, 26, 29, 33, 37]) band(monthly, `B${r}:C${r}`);
monthly
  .getRange('C28:C37')
  .conditionalFormats.add('containsText', {
    text: 'n.a.',
    format: { font: { color: color.amber } },
  });
cell(monthly, 'E5', 'Change the authoritative selections in Assumptions C35:C36.');
cell(
  monthly,
  'E10',
  'Annual charges enter this month in full; they are not monthly earned revenue.'
);
cell(
  monthly,
  'E19',
  'Payment proceeds exclude middleware, support, infrastructure and acquisition.'
);
cell(
  monthly,
  'E23',
  'USD conversion starts at an illustrative 1.00. Other tracked MTR can trigger the fee.'
);
cell(
  monthly,
  'E24',
  'Paid rate applies to all tracked cohort gross, not just the excess over $2,500.'
);
cell(monthly, 'E26', 'RevenueCat uses pre-refund gross here; verify actual invoice adjustments.');
cell(
  monthly,
  'E29',
  'Missing variable costs. Supply Assumptions C37; zero remains a valid explicit input.'
);
cell(
  monthly,
  'E33',
  'Cash calculation. Annual subscriptions may require service delivery in later months.'
);
cell(monthly, 'E35', 'Supply matching-period recognized revenue and fees in Assumptions C41:C42.');
cell(
  monthly,
  'E37',
  'Operating profit excludes income tax, financing, distributions and owner take-home.'
);
cell(
  monthly,
  'B40',
  'Research date: 13 September 2026. Published terms may change before native billing launches.'
);

// Recalculate and test the same formulas under changes, restoring every driver.
wb.recalculate();
const near = (actual, expected, label) => {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-8)
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
};
const val = (s, a) => s.getRange(a).values[0][0];
near(val(units, 'E8'), 2.04, 'Basic inclusive native 15%');
near(val(units, 'H8'), 2.069, 'Basic EEA Stripe');
near(val(units, 'H13'), 77.05, 'Ultimate annual Stripe');
near(val(monthly, 'C26'), 4020, 'Illustrative Advanced native after RevenueCat');
if (val(monthly, 'C37') !== 'n.a.')
  throw new Error('Unknown operating profit must be unavailable.');
cell(assumptions, 'C7', 0);
wb.recalculate();
near(val(units, 'D8'), 3.75, 'Exclusive tax customer total');
near(val(units, 'E8'), 2.55, 'Exclusive tax native retained proceeds');
cell(assumptions, 'C7', 1);
cell(assumptions, 'C8', 0.1);
wb.recalculate();
near(val(units, 'E8'), 1.836, 'Native proportional refund');
near(val(units, 'H8'), 1.829, 'Stripe refund with retained processing fees');
cell(assumptions, 'C8', 0);
cell(assumptions, 'C34', 400);
wb.recalculate();
near(val(monthly, 'C24'), 0, 'RevenueCat below threshold');
cell(assumptions, 'C34', 500);
wb.recalculate();
near(val(monthly, 'C24'), 0.01, 'RevenueCat above threshold');
near(val(monthly, 'C25'), 30, 'RevenueCat charges all tracked gross');
cell(assumptions, 'C35', 6);
cell(assumptions, 'C36', 4);
cell(assumptions, 'C34', 1);
wb.recalculate();
near(val(monthly, 'C19'), 77.05, 'Catalog and channel selection updates');
near(val(monthly, 'C21'), 100, 'Annual MTR uses full payment');
cell(assumptions, 'C37', 0);
wb.recalculate();
near(val(monthly, 'C29'), 77.05, 'Explicit zero variable cost is valid');
for (const [address, value] of [
  ['C34', d.illustrativePaymentsInMonth],
  ['C35', d.selectedPriceIndex],
  ['C36', d.selectedChannelIndex],
  ['C37', null],
])
  cell(assumptions, address, value);
wb.recalculate();
for (const [address, value] of [
  ['C37', 100],
  ['C38', 200],
  ['C39', 300],
  ['C40', 50],
  ['C41', 4800],
  ['C42', 780],
])
  cell(assumptions, address, value);
wb.recalculate();
near(
  val(monthly, 'C37'),
  3370,
  'Operating profit reconciles supplied recognized revenue and matching expenses'
);
for (let r = 37; r <= 42; r++) cell(assumptions, `C${r}`, null);
wb.recalculate();
const errors = await wb.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
  options: { useRegex: true, maxResults: 100 },
  summary: 'Final formula error scan',
});
await fs.writeFile(path.join(previewDir, 'formula-check.ndjson'), errors.ndjson);
console.log(errors.ndjson);
const summary = await wb.inspect({
  kind: 'region',
  sheetId: 'Unit economics',
  range: 'B7:N15',
  maxChars: 6000,
  tableMaxRows: 10,
  tableMaxCols: 13,
});
await fs.writeFile(path.join(previewDir, 'result-check.ndjson'), summary.ndjson);
console.log(summary.ndjson);
for (const [s, range, name] of [
  [units, 'B2:N19', 'unit-economics'],
  [assumptions, 'B2:F42', 'assumptions'],
  [monthly, 'B2:E40', 'monthly-model'],
  [assumptions, 'B57:L69', 'channel-mapping'],
  [assumptions, 'B46:F54', 'catalog'],
  [assumptions, 'B72:H101', 'sources'],
  [units, 'B21:M33', 'payment-build'],
]) {
  const png = await wb.render({ sheetName: s.name, range, scale: 1, format: 'png' });
  await fs.writeFile(path.join(previewDir, `${name}.png`), new Uint8Array(await png.arrayBuffer()));
}
const xlsx = await SpreadsheetFile.exportXlsx(wb);
const outputPath = path.join(output, 'native-subscription-economics.xlsx');
await xlsx.save(outputPath);
await fs.rm(`${outputPath}.inspect.ndjson`, { force: true });
const calculated = input.prices.map((p, i) => ({
  ...p,
  grossCollected: val(units, `D${i + 8}`),
  proceedsByChannel: Object.fromEntries(
    channelDefs.map((c, j) => [c[0], val(units, `${String.fromCharCode(69 + j)}${i + 8}`)])
  ),
}));
await fs.writeFile(
  path.join(here, 'calculated-example.json'),
  JSON.stringify(
    {
      asOf: input.asOf,
      basis: 'Default editable assumptions, before RevenueCat and operating expenses',
      prices: calculated,
    },
    null,
    2
  ) + '\n'
);
console.log(
  JSON.stringify({
    outputPath,
    previewDir,
    checks:
      'VAT mode, refunds, RevenueCat below/above threshold, all-gross fee, annual charge, selected channel, blank versus zero cost, final formula scan',
  })
);
