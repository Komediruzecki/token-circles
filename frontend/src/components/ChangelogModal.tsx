/**
 * ChangelogModal — displays the CHANGELOG.md contents
 */
import { For } from 'solid-js'
import styles from './ChangelogModal.module.css'

interface ChangelogEntry {
  version: string
  date: string
  sections: { title: string; items: string[] }[]
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '4.0.0',
    date: '2026-05-11',
    sections: [
      {
        title: 'Added',
        items: [
          'Portfolio tracker with real-time Yahoo Finance price lookup and allocation pie chart',
          'Counterparties page showing who-owes-who from beneficiary/payor transaction data',
          'Account balance auto-update when transactions are created/updated/deleted',
          'Starting balance and starting date fields for accounts with dynamic balance computation',
          'Transfer handling between accounts (FROM/TO with balance adjustments on both sides)',
          'Bulk action bar: Change Category and Change Type modals for multi-transaction editing',
          'Auto-categorization modal for bulk-mapping uncategorized transactions',
          'Nuke scripts: nuke-demo.sh (demo profiles only) and nuke-all.sh (all data)',
          'Google Sheets import improvements: auto-populated account inputs, cash account type',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Account types aligned with backend: giro/savings/ib/cash',
          'Import now resolves account_id from Means of Payment (FROM) instead of Category (TO)',
          'Transaction FROM/TO column shows MoP → Category with transfer amounts without prefix',
          'Analytics labels changed from "Monthly" to "Period" to reflect actual data range',
          'Navigation labels simplified: "Loan Calculator" → "Loans", "Housing Calc" → "Housing"',
          'Dropdown UX: category/tag dropdowns auto-close when clicking outside',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Critical import bug: account_id was resolved from Category instead of Means of Payment',
          'Post-import balance recalculation handling all transfer directions',
          'Bulk DELETE sets account balance to starting_balance instead of 0',
          'Import: existing accounts now pre-populated for MoP resolution',
          'Portfolio seed data: tier string passed directly instead of undefined config.tier',
          'Yahoo Finance v3 ESM import: use new YahooFinance() pattern',
          'Mobile overflow on all pages: overflow-x containment, responsive breakpoints',
          'SolidJS anti-patterns: onMount instead of createEffect+isMounted, ChartWrapper reactivity',
        ],
      },
    ],
  },
  {
    version: '3.0.0',
    date: '2026-04-01',
    sections: [
      {
        title: 'Added',
        items: [
          'Serverless mode with full IndexedDB storage adapter',
          'Multi-profile support with demo data (low/mid/high income) spanning 2000-2026',
          'Zero-based budgeting with allocation and rollover',
          'Daily heatmap visualization (D3.js) for spending patterns',
          'Sankey flow diagram for income/expense flow visualization',
          'PDF report generation: monthly spending, annual summary, P&L, tax summary',
          'Reconciliation workflow with bulk toggle and reconciliation summary',
          'Transaction tags with filtering and color coding',
          'Receipt upload and attachment to transactions',
          'Recurring transactions with auto-populate scheduling',
          'Quick Add modal (Ctrl+Shift+T) for rapid transaction entry',
          'Dark/light theme with CSS variables and persistence',
          'PWA support with service worker for offline access',
          'Chart export as images',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Migrated from vanilla JS to SolidJS + TypeScript + Vite',
          'CSS Modules instead of global CSS',
          'Hash-based routing with query parameter support',
        ],
      },
    ],
  },
  {
    version: '2.0.0',
    date: '2026-03-15',
    sections: [
      {
        title: 'Added',
        items: [
          'Savings goals with progress tracking and contributions',
          'Loan calculator with amortization tables, prepayments, and variable rates',
          'Bills tracker with recurring payment scheduling',
          'Housing cost calculator',
          'Retirement calculator with projections',
          'Compound interest calculator',
          'Emergency fund calculator',
          'Rent vs Buy comparison calculator',
          'Budget rollover support',
          'Category auto-mapping from transaction descriptions',
          'Google Sheets CSV/XLSX import with column mapping and preview',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-03-01',
    sections: [
      {
        title: 'Added',
        items: [
          'Initial release: vanilla JS SPA with Express/SQLite backend',
          'Transaction management (CRUD, filtering, search, pagination)',
          'Category management with colors and icons',
          'Account tracking with balances',
          'Dashboard with income/expense charts and metrics',
          'Basic budgeting per category',
          'Analytics with category breakdowns',
          'User authentication (bcrypt + sessions)',
          'Settings management',
          'Data export/import (JSON)',
        ],
      },
    ],
  },
]

export default function ChangelogModal(props: { onClose: () => void }) {
  return (
    <div class={styles.overlay} onClick={props.onClose}>
      <div class={styles.modal} onClick={(e) => { e.stopPropagation() }}>
        <div class={styles.header}>
          <h2>Changelog</h2>
          <button class={styles.closeBtn} onClick={props.onClose}>
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class={styles.body}>
          <For each={CHANGELOG}>
            {(entry) => (
              <div class={styles.entry}>
                <div class={styles.versionHeader}>
                  <span class={styles.version}>{entry.version}</span>
                  <span class={styles.date}>{entry.date}</span>
                </div>
                <For each={entry.sections}>
                  {(section) => (
                    <div class={styles.section}>
                      <h4 class={styles.sectionTitle}>{section.title}</h4>
                      <ul class={styles.itemList}>
                        <For each={section.items}>
                          {(item) => <li class={styles.item}>{item}</li>}
                        </For>
                      </ul>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
