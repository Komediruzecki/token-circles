/**
 * Main App Component - Root component for the application
 */

import { createMemo, createSignal, onMount, Suspense } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { handlers, receipts, transactions } from './core/handlers.js'
import { pages as allPages } from './router.tsx'
import { sidebar } from './styles/AppSidebar.module.css'

// Mount handlers to window for legacy code compatibility
window.receipts = receipts
window.transactions = transactions
window.handlers = handlers

export function App() {
  const [_currentPage, _setCurrentPage] = createSignal<PageName>('dashboard')
  const [_isLoading, _setIsLoading] = createSignal(false)
  const [activePage, setActivePage] = createSignal<PageName>('dashboard')

  createMemo(() => {
    const page = allPages[activePage()]
    if (page) {
      _setIsLoading(page.loading ?? false)
    }
  })

  onMount(() => {
    setActivePage('dashboard')
  })

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <main class={`${styles.main} ${sidebar}`}>
        <nav class={styles.sidebar}>
          <div class={styles.logo}>
            <h1>Finance Manager</h1>
          </div>
          <ul class={styles.nav}>
            {Object.entries(allPages).map(([name, page]) => (
              <li key={name}>
                <a
                  href={`#${name}`}
                  class={activePage() === name ? styles.navLinkActive : styles.navLink}
                  onClick={(e) => {
                    e.preventDefault()
                    setActivePage(name as PageName)
                    window.location.hash = name
                  }}
                >
                  {page.icon} {name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div class={styles.content}>
          {Object.entries(allPages).map(([name, page]) => (
            <Dynamic
              key={name}
              component={page.component}
              data-page={name}
              data-testid={`page-${name}`}
              class={{
                [styles.page]: true,
                [page.className || '']: page.className !== undefined,
              }}
            />
          ))}
        </div>
      </main>
    </Suspense>
  )
}
