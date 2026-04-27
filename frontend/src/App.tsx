/**
 * Main App Component - Root component for the application
 */

import { createMemo, createSignal, onMount, Suspense } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import layoutStyles from './components/Layout.module.css'
import { handlers, receipts, transactions } from './core/handlers.js'
import { pages as allPages } from './router.tsx'
import sidebarStyles from './styles/AppSidebar.module.css'

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
      _setIsLoading(false)
    }
  })

  onMount(() => {
    setActivePage('dashboard')
  })

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <main class={`${layoutStyles.main} ${sidebarStyles.sidebar}`}>
        <nav class={sidebarStyles.sidebar}>
          <div class={sidebarStyles.logo}>
            <h1>Finance Manager</h1>
          </div>
          <ul class={sidebarStyles.nav}>
            {Object.entries(allPages).map(([name, page]) => (
              <li key={name}>
                <a
                  href={`#${name}`}
                  class={activePage() === name ? sidebarStyles.navLinkActive : sidebarStyles.navLink}
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
        <div class={layoutStyles.content}>
          {Object.entries(allPages).map(([name, page]) => (
            <Dynamic
              key={name}
              component={page}
              data-page={name}
              data-testid={`page-${name}`}
              class={{
                [layoutStyles.page]: true,
              }}
            />
          ))}
        </div>
      </main>
    </Suspense>
  )
}
