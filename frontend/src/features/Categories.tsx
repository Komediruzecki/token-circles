/**
 * Categories Component - EARS Specification
 *
 * GIVEN: A user is viewing the Categories page
 * WHEN: The page loads
 * THEN: The header displays "Categories" and shows all expense and income categories
 *
 * GIVEN: A user wants to create a new category
 * WHEN: They click the "Create Category" button
 * THEN: A category creation modal opens with fields for name, type (expense/income), and color
 *
 * GIVEN: A user creates a category
 * WHEN: They enter a name, select a type, and choose a color
 * THEN: The new category appears in the list with its chosen color
 *
 * GIVEN: A user wants to edit a category
 * WHEN: They click the edit button on a category
 * THEN: The category details populate the edit form with existing values
 *
 * GIVEN: A user modifies a category
 * WHEN: They change the name or color and save
 * THEN: The category is updated throughout the application with the new values
 *
 * GIVEN: A user wants to delete a category
 * WHEN: They select a category and confirm deletion
 * THEN: The category is removed from the list
 */

/**
 * Categories Component
 * Manages expense and income categories with CRUD operations
 */
import { createMemo, createResource, createSignal, For } from 'solid-js'
import CategoryIcon, { getCategorySvg } from '../components/CategoryIcon'
import ConfirmButton from '../components/ConfirmButton'
import { Field, FormNotice, SubmitButton } from '../components/form'
import IconPicker from '../components/IconPicker'
import { formatCurrency } from '../core/api'
import { apiDelete, apiHouseholdGet, apiPost, apiPut, showToast } from '../core/api'
import { plainMessage } from '../core/apiError'
import { useAppState } from '../core/appStore'
import { CATEGORY_PALETTE } from '../core/brandPalette'
import { entityVersion } from '../core/dataVersions'
import { gatedSource } from '../core/pageVisibility'
import styles from './CategoriesPage.module.css'
import { createCategoryForm } from './categoryForm'
import type { CategoryFormValues } from './categoryForm'

/** Brand "constellation" swatches offered when picking a category color. */
const COLOR_CHOICES = CATEGORY_PALETTE
const DEFAULT_COLOR = CATEGORY_PALETTE[0]

interface Category {
  id: number
  name: string
  type: 'expense' | 'income'
  color: string
  icon: string | null
  profile_id: number
  budget?: number
}

export default function Categories() {
  const state = useAppState()

  // Categories resource — fetches categories + budget summary
  const [categoriesResource] = createResource(
    // Gated on visibility: a profile switch, or a category or budget write anywhere, refetches
    // now only while this page is visible; hidden, it is marked stale and refetches once on the
    // next show. This also drives the initial load, replacing the old onMount + profileVersion
    // effect. The budget summary counts spending, which transaction writes reach through the
    // `budgets` fan-out. This page's own writes bump both counters through apiFetch, so none of
    // them refetches by hand.
    gatedSource('categories', () =>
      [state.profileVersion, entityVersion('categories'), entityVersion('budgets')].join('|')
    ),
    async () => {
      const [allRes, budgetRes] = await Promise.all([
        apiHouseholdGet<Category[]>('/api/categories'),
        apiHouseholdGet<any[]>('/api/budgets/summary').catch(() => [] as any[]),
      ])
      const summary: Record<
        number,
        { spent: number; budget: number; remaining: number; percent_used: number }
      > = {}
      if (Array.isArray(budgetRes)) {
        for (const b of budgetRes) {
          summary[b.category_id] = {
            spent: b.spent || 0,
            budget: b.amount || 0,
            remaining: b.remaining || 0,
            percent_used: b.percentage || 0,
          }
        }
      }
      return { categories: allRes, budgetSummary: summary }
    }
  )
  // `.latest` keeps the previous value during a refetch and never re-triggers the page-level
  // <Suspense>, so period/profile changes update in place instead of flashing the fallback.
  const loading = () => categoriesResource.loading && !categoriesResource.latest
  const categories = () => categoriesResource.latest?.categories ?? []
  const budgetSummary = () => categoriesResource.latest?.budgetSummary ?? {}

  const [showAddModal, setShowAddModal] = createSignal(false)
  const [showBudgetModal, setShowBudgetModal] = createSignal(false)
  const [editingCategory, setEditingCategory] = createSignal<Category | null>(null)
  const [selectedCategory, setSelectedCategory] = createSignal<Category | null>(null)
  const [budgetAmount, setBudgetAmount] = createSignal('')
  const [filterType, setFilterType] = createSignal<'all' | 'expense' | 'income'>('all')

  // The add/edit dialog. What a save does, and what it says when the save is refused, is
  // categoryForm.ts, shared with the category dialogs in Budgets, Bills and Goals.
  const closeCategoryModal = () => {
    setShowAddModal(false)
    setShowIconPicker(false)
    setEditingCategory(null)
  }
  const categoryForm = createCategoryForm({
    color: DEFAULT_COLOR,
    editing: editingCategory,
    onSaved: closeCategoryModal,
  })
  const openCategoryModal = (category: Category | null) => {
    setEditingCategory(category)
    categoryForm.open(category)
    setShowAddModal(true)
  }

  // Delete category
  const deleteCategory = async (id: number) => {
    try {
      await apiDelete(`/api/categories/${id}`)
      showToast('Category deleted successfully', 'success')
    } catch (err) {
      console.error('Failed to delete category:', err)
      showToast('Failed to delete category', 'error')
    }
  }

  // Update category color
  const updateColor = async (id: number, color: string) => {
    try {
      await apiPut(`/api/categories/${id}`, { color })
    } catch (err) {
      console.error('Failed to update color:', err)
      showToast(plainMessage(err, "Couldn't change the color. Try again."), 'error')
    }
  }

  // Open edit modal
  const editCategory = (category: Category) => {
    openCategoryModal(category)
  }

  // Open budget modal
  const openBudgetModal = (category: Category) => {
    setSelectedCategory(category)
    setBudgetAmount('')
    setShowBudgetModal(true)
  }

  // Update budget
  const updateBudget = async (amount: number) => {
    if (!selectedCategory()) return
    try {
      const now = new Date()
      const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      await apiPost('/api/budgets', {
        category_id: selectedCategory()!.id,
        amount,
        period: 'monthly',
        start_date: startDate,
      })
      showToast('Budget set successfully', 'success')
      setShowBudgetModal(false)
      setSelectedCategory(null)
    } catch (err) {
      console.error('Failed to set budget', err)
      showToast('Failed to set budget', 'error')
    }
  }

  // Tint the icon chip with the category's own color (a translucent wash of
  // the color behind a matching glyph), so every category reads in its hue.
  const iconStyle = (color: string) => ({
    background: `color-mix(in oklab, ${color} 20%, transparent)`,
    color,
  })

  // Live preview of the icon the typed keyword resolves to. This has to be a memo: a Solid
  // component body runs once, so <CategoryIcon icon={categoryForm.values.icon}> would render
  // whatever the field held at mount and never update. The memo re-reads the store per keystroke.
  const iconPreview = createMemo(() =>
    getCategorySvg(categoryForm.values.name, 18, categoryForm.values.icon)
  )

  // The gallery is a helper for the icon field, so it opens over the category modal rather
  // than replacing it — the half-filled form behind it has to still be there afterwards.
  const [showIconPicker, setShowIconPicker] = createSignal(false)

  return (
    <div class={`page page-categories page-enter ${styles.categoriesPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="categories-header" data-tour="categories-header">
            Categories
          </h1>
          <button
            data-test-id="add-category-btn"
            data-tour="categories-add"
            class={styles.addCategoryBtn}
            onClick={() => {
              openCategoryModal(null)
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Category
          </button>
        </div>
        <p data-test-id="categories-subtitle" class={styles.pageSubtitle}>
          Organize your transactions with expense and income categories
        </p>
      </div>

      <div data-test-id="category-tabs" class={styles.categoriesTabs}>
        <button
          data-test-id="tab-all"
          class={`${styles.tab} ${filterType() === 'all' ? styles.active : ''}`}
          onClick={() => setFilterType('all')}
        >
          All Categories
        </button>
        <button
          data-test-id="tab-expense"
          class={`${styles.tab} ${filterType() === 'expense' ? styles.active : ''}`}
          onClick={() => setFilterType('expense')}
        >
          Expenses
        </button>
        <button
          data-test-id="tab-income"
          class={`${styles.tab} ${filterType() === 'income' ? styles.active : ''}`}
          onClick={() => setFilterType('income')}
        >
          Income
        </button>
      </div>

      <div data-tour="categories-list">
        {loading() ? (
          <div data-test-id="loading-state" class={styles.emptyState}>
            Loading categories...
          </div>
        ) : categories().length === 0 ? (
          <div class={styles.emptyState}>
            <p>No categories yet</p>
            <p>Create your first category to start organizing your transactions.</p>
            <button
              class={styles.addCategoryBtn}
              onClick={() => {
                openCategoryModal(null)
              }}
            >
              Add Category
            </button>
          </div>
        ) : (
          <div data-test-id="categories-grid" class={styles.categoriesGrid}>
            <For
              each={categories().filter((c) =>
                filterType() === 'all' ? true : c.type === filterType()
              )}
            >
              {(category) => {
                const summary = budgetSummary()[category.id]
                const spent = summary?.spent || 0
                const budget = summary?.budget || 0
                const remaining = summary?.remaining ?? budget - spent
                const percentUsed = summary?.percent_used || 0
                const isOverBudget = percentUsed > 100

                return (
                  <div data-test-id="category-card" class={styles.categoryCard}>
                    <div class={styles.categoryHeader}>
                      <div
                        data-test-id="category-color"
                        class={styles.categoryIcon}
                        style={iconStyle(category.color)}
                      >
                        <CategoryIcon name={category.name} icon={category.icon} size={18} />
                      </div>
                      <div class={styles.categoryInfo}>
                        <h3 data-test-id="category-name" class={styles.categoryName}>
                          {category.name}
                        </h3>
                        <span class={styles.categoryType}>{category.type}</span>
                      </div>
                      <div class={styles.categoryActions}>
                        <button
                          class={`${styles.btnSm} ${styles.btnGhost}`}
                          onClick={() => {
                            openBudgetModal(category)
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Budget
                        </button>
                        <button
                          data-test-id="edit-category-btn"
                          class={`${styles.btnSm} ${styles.btnGhost}`}
                          onClick={() => {
                            editCategory(category)
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <ConfirmButton
                          class={`${styles.btnSm} ${styles.btnGhost}`}
                          onConfirm={() => deleteCategory(category.id)}
                          message="Delete this category? This can’t be undone."
                          aria-label="Delete category"
                          label={
                            <svg
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          }
                        />
                      </div>
                    </div>
                    <div data-test-id="category-spending" class={styles.categorySpending}>
                      {/* Two rows, not four. The limit rides along with the amount it bounds, and
                          what is left rides along with the bar that shows it — so a budgeted
                          category costs the card one line more than an unbudgeted one, instead of
                          three. */}
                      <div class={styles.spendingHeader}>
                        <span class={styles.spendingLabel}>Spent</span>
                        <span class={`${styles.spendingAmount} ${isOverBudget ? styles.over : ''}`}>
                          {formatCurrency(spent)}
                          {category.type === 'expense' && budget > 0 && (
                            <span class={styles.spendingOf}>of {formatCurrency(budget)}</span>
                          )}
                        </span>
                      </div>
                      {category.type === 'expense' && budget > 0 && (
                        <div class={styles.meterRow}>
                          <div
                            class={styles.meter}
                            role="img"
                            aria-label={`${formatCurrency(spent)} spent of a ${formatCurrency(budget)} budget`}
                          >
                            <div
                              class={`${styles.meterFill} ${isOverBudget ? styles.over : ''}`}
                              style={{ width: `${Math.min(100, percentUsed)}%` }}
                            />
                          </div>
                          <span
                            class={`${styles.meterNote} ${isOverBudget ? styles.over : ''}`}
                            data-test-id="category-remaining"
                          >
                            {isOverBudget
                              ? `${formatCurrency(Math.abs(remaining))} over`
                              : `${formatCurrency(remaining)} left`}
                          </span>
                        </div>
                      )}
                    </div>
                    <div class={styles.categoryColors}>
                      <span class={styles.colorLabel}>Color:</span>
                      <div class={styles.colorPicker}>
                        <For each={COLOR_CHOICES}>
                          {(color) => (
                            <button
                              class={`${styles.colorBtn} ${category.color === color ? styles.active : ''}`}
                              style={{ background: color }}
                              onClick={() => updateColor(category.id, color)}
                              title={color}
                            >
                              {category.color === color && (
                                <svg
                                  width="12"
                                  height="12"
                                  fill="none"
                                  stroke="white"
                                  stroke-width="3"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                              )}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal() && (
        <div
          class={styles.modalOverlay}
          data-test-id="category-modal-overlay"
          onclick={(e) => {
            if (e.target === e.currentTarget) closeCategoryModal()
          }}
        >
          <div
            class={styles.modal}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle} data-test-id="category-modal-title">
                {editingCategory() ? 'Edit Category' : 'Add Category'}
              </h3>
              <button class={styles.modalClose} onClick={closeCategoryModal}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} {...categoryForm.attrs}>
              <FormNotice form={categoryForm} />
              <Field
                form={categoryForm}
                name="name"
                label="Category Name"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    class={styles.formControl}
                    placeholder="e.g., Food, Rent"
                    value={categoryForm.values.name}
                    onInput={(e) => categoryForm.set('name', e.currentTarget.value)}
                    required
                  />
                )}
              </Field>
              <Field
                form={categoryForm}
                name="type"
                label="Category Type"
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <select
                    {...control}
                    class={styles.formControl}
                    value={categoryForm.values.type}
                    onInput={(e) =>
                      categoryForm.set('type', e.currentTarget.value as CategoryFormValues['type'])
                    }
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                )}
              </Field>
              <Field
                form={categoryForm}
                name="icon"
                label="Icon"
                class={styles.formGroup}
                labelClass={styles.formLabel}
                hintClass={styles.fieldHint}
                hint="Type a keyword and we pick the matching icon, or browse the gallery. Leave it blank to choose one from the category name."
              >
                {(control) => (
                  <div class={styles.iconField}>
                    <input
                      {...control}
                      type="text"
                      class={styles.formControl}
                      placeholder="e.g., food, home, car"
                      value={categoryForm.values.icon}
                      onInput={(e) => categoryForm.set('icon', e.currentTarget.value)}
                      maxlength="32"
                    />
                    <span class={styles.iconPreview} aria-hidden="true">
                      {iconPreview()}
                    </span>
                    <button
                      type="button"
                      class={styles.iconBrowseBtn}
                      data-test-id="category-icon-browse"
                      aria-label="Browse icons"
                      title="Browse icons"
                      onClick={() => setShowIconPicker(true)}
                    >
                      <svg
                        width="18"
                        height="18"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        viewBox="0 0 24 24"
                      >
                        <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z" />
                      </svg>
                    </button>
                  </div>
                )}
              </Field>
              <Field
                form={categoryForm}
                name="color"
                label="Color"
                group
                class={styles.formGroup}
                labelClass={styles.formLabel}
              >
                {(control) => (
                  <div {...control} class={styles.colorPicker}>
                    <For each={COLOR_CHOICES}>
                      {(color) => (
                        <button
                          type="button"
                          data-test-id="category-color-swatch"
                          class={`${styles.colorPickerBtn} ${categoryForm.values.color === color ? styles.active : ''}`}
                          style={{ background: color }}
                          onClick={() => categoryForm.set('color', color)}
                          title={color}
                        >
                          {categoryForm.values.color === color && (
                            <svg
                              width="14"
                              height="14"
                              fill="none"
                              stroke="white"
                              stroke-width="3"
                              viewBox="0 0 24 24"
                            >
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          )}
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </Field>
              <div class={styles.modalFooter}>
                <button type="button" class={styles.btnSecondary} onClick={closeCategoryModal}>
                  Cancel
                </button>
                <SubmitButton
                  class={styles.btnPrimary}
                  busy={categoryForm.submitting()}
                  busyLabel={editingCategory() ? 'Updating…' : 'Adding…'}
                >
                  {editingCategory() ? 'Update' : 'Add'} Category
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddModal() && showIconPicker() && (
        <IconPicker
          value={categoryForm.values.icon}
          onPick={(name) => {
            // Straight into the same field the user could have typed into. Closing afterwards is
            // the point of a picker: one click, and you are looking at your form again.
            categoryForm.set('icon', name)
            setShowIconPicker(false)
          }}
          onClose={() => setShowIconPicker(false)}
        />
      )}

      {/* Budget Modal */}
      {showBudgetModal() && selectedCategory() && (
        <div
          class={styles.modalOverlay}
          onclick={(e) => {
            if (e.target === e.currentTarget) setShowBudgetModal(false)
          }}
        >
          <div
            class={styles.modal}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>Set Budget</h3>
              <button class={styles.modalClose} onClick={() => setShowBudgetModal(false)}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class={styles.modalBody}>
              <p class={styles.modalText}>
                Set a monthly budget for <strong>{selectedCategory()!.name}</strong>
              </p>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Monthly Budget Amount</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  placeholder="500.00"
                  value={budgetAmount()}
                  oninput={(e) => setBudgetAmount((e.target as HTMLInputElement).value)}
                />
              </div>
            </div>
            <div class={styles.modalFooter}>
              <button class={styles.btnSecondary} onClick={() => setShowBudgetModal(false)}>
                Cancel
              </button>
              <button
                class={styles.btnPrimary}
                onClick={() => {
                  updateBudget(parseFloat(budgetAmount()) || 0)
                }}
              >
                Save Budget
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
