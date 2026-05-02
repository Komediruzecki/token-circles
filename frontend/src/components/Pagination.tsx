/**
 * Pagination Component
 * Generic pagination control for lists
 */
import styles from './Pagination.module.css'

interface PaginationProps {
  currentPage: number
  totalPages: number
  itemsPerPage: number
  totalItems?: number
  onPageChange: (page: number) => void
}

export default function Pagination(props: PaginationProps) {
  if (props.totalPages <= 1) return null

  const pages = Array.from({ length: props.totalPages }, (_, i) => i + 1)
  const maxVisible = 5
  let visiblePages: number[] = []

  if (props.totalPages <= maxVisible) {
    visiblePages = pages
  } else {
    const middle = Math.floor(maxVisible / 2)
    let start = Math.min(props.currentPage - middle, props.totalPages - maxVisible)
    let end = Math.min(start + maxVisible, props.totalPages)

    if (start < 1) {
      start = 1
      end = Math.min(maxVisible, props.totalPages)
    }
    if (end > props.totalPages) {
      end = props.totalPages
      start = Math.max(1, end - maxVisible + 1)
    }
    visiblePages = pages.slice(start - 1, end)
  }

  const goToPage = (page: number) => {
    if (page >= 1 && page <= props.totalPages && page !== props.currentPage) {
      props.onPageChange(page)
    }
  }

  return (
    <div class={styles.pagination}>
      <button
        class={`${styles.pageBtn} ${styles.pageBtnPrev}`}
        onClick={() => {
          goToPage(props.currentPage - 1)
        }}
        disabled={props.currentPage === 1}
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {visiblePages[0] > 1 && (
        <>
          <button
            class={styles.pageBtn}
            onClick={() => {
              goToPage(1)
            }}
          >
            1
          </button>
          {visiblePages[0] > 2 && <span class={styles.ellipsis}>...</span>}
        </>
      )}

      {visiblePages.map((page) => (
        <>
          <button
            class={`${styles.pageBtn} ${page === props.currentPage ? styles.pageBtnActive : ''}`}
            onClick={() => {
              goToPage(page)
            }}
          >
            {page}
          </button>
        </>
      ))}

      {visiblePages[visiblePages.length - 1] < props.totalPages && (
        <>
          {visiblePages[visiblePages.length - 1] < props.totalPages - 1 && (
            <span class={styles.ellipsis}>...</span>
          )}
          <button
            class={styles.pageBtn}
            onClick={() => {
              goToPage(props.totalPages)
            }}
          >
            {props.totalPages}
          </button>
        </>
      )}

      <button
        class={`${styles.pageBtn} ${styles.pageBtnNext}`}
        onClick={() => {
          goToPage(props.currentPage + 1)
        }}
        disabled={props.currentPage === props.totalPages}
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  )
}
