/**
 * Categories Component
 * Manages expense and income categories with CRUD operations
 */
import { createSignal, onMount } from 'solid-js'
import styles from '../components/CategoriesPage.module.css'
import { formatCurrency } from '../core/api'

interface Category {
  id: number
  name: string
  type: 'expense' | 'income'
  color: string
  icon: string | null
  profile_id: number
  budget?: number
}

interface ExpenseCategory extends Category {
  spent: number
  remaining?: number
  percent_used: number
}

export default function Categories() {
  const [categories, setCategories] = createSignal<Category[]>([])
  const [loading, setLoading] = createSignal(true)
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [showBudgetModal, setShowBudgetModal] = createSignal(false)
  const [editingCategory, setEditingCategory] = createSignal<Category | null>(null)
  const [selectedCategory, setSelectedCategory] = createSignal<Category | null>(null)
  const [formData, setFormData] = createSignal({
    name: '',
    type: 'expense' as 'expense' | 'income',
    color: '#3b82f6',
    icon: '',
  })

  // Load categories
  const loadCategories = async () => {
    setLoading(true)
    try {
      const [allRes, _expenseRes] = await Promise.all([
        fetch('/api/categories').then(r => r.json()),
        fetch('/api/categories?type=expense').then(r => r.json()),
      ])
      setCategories(allRes)
    } catch {
      console.error('Failed to load categories')
    } finally {
      setLoading(false)
    }
  }

  // Handle form submit
  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const data = {
      name: formData().name,
      type: formData().type,
      color: formData().color,
      icon: formData().icon || null,
    }

    try {
      await fetch('/api/categories', {
        method: editingCategory() ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setShowAddModal(false)
      setEditingCategory(null)
      setFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' })
      loadCategories()
    } catch (error) {
      console.error('Failed to save category', error)
    }
  }

  // Delete category
  const deleteCategory = async (id: number) => {
    if (!confirm('Are you sure you want to delete this category?')) return
    try {
      await fetch(`/api/categories/${id}`, { method: 'DELETE' })
      loadCategories()
    } catch (error) {
      console.error('Failed to delete category', error)
    }
  }

  // Update category color
  const updateColor = async (id: number, color: string) => {
    try {
      await fetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color }),
      })
      loadCategories()
    } catch (error) {
      console.error('Failed to update category color', error)
    }
  }

  // Open edit modal
  const editCategory = (category: Category) => {
    setEditingCategory(category)
    setFormData({
      name: category.name,
      type: category.type,
      color: category.color,
      icon: category.icon || '',
    })
    setShowAddModal(true)
  }

  // Open budget modal
  const openBudgetModal = (category: Category) => {
    setSelectedCategory(category)
    setShowBudgetModal(true)
  }

  // Update budget
  const updateBudget = async (amount: number) => {
    if (!selectedCategory()) return
    try {
      await fetch('/api/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: selectedCategory()!.id,
          amount,
          period: 'monthly',
        }),
      })
      setShowBudgetModal(false)
      setSelectedCategory(null)
      loadCategories()
    } catch (error) {
      console.error('Failed to set budget', error)
    }
  }

  // OnMount
  onMount(() => {
    loadCategories()
  })

  const categoryIconColors: Record<string, string> = {
    '#ef4444': 'bg-red-100 text-red-600',
    '#f97316': 'bg-orange-100 text-orange-600',
    '#eab308': 'bg-yellow-100 text-yellow-600',
    '#22c55e': 'bg-green-100 text-green-600',
    '#3b82f6': 'bg-blue-100 text-blue-600',
    '#8b5cf6': 'bg-violet-100 text-violet-600',
    '#ec4899': 'bg-pink-100 text-pink-600',
    '#6b7280': 'bg-gray-100 text-gray-600',
  }

  const getIconClass = (color: string): string => {
    return categoryIconColors[color] || 'bg-blue-100 text-blue-600'
  }

  return (
    <div class={`page page-categories page-enter ${styles.categoriesPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1>Categories</h1>
          <button class={styles.addCategoryBtn} onClick={() => setShowAddModal(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Category
          </button>
        </div>
        <p class={styles.pageSubtitle}>Organize your transactions with expense and income categories</p>
      </div>

      <div class={styles.categoriesTabs}>
        <button class={`${styles.tab} ${categories().filter(c => c.type === 'expense').length === 0 ? styles.active : ''}`} onClick={() => loadCategories()}>
          Expenses
        </button>
        <button class={`${styles.tab} ${categories().filter(c => c.type === 'income').length === 0 ? styles.active : ''}`} onClick={() => {
          setCategories(categories().filter(c => c.type === 'income'))
        }}>
          Income
        </button>
      </div>

      {loading() ? (
        <div class={styles.emptyState}>Loading categories...</div>
      ) : categories().length === 0 ? (
        <div class={styles.emptyState}>
          <p>No categories yet</p>
          <p>Create your first category to start organizing your transactions.</p>
          <button class={styles.addCategoryBtn} onClick={() => setShowAddModal(true)}>
            Add Category
          </button>
        </div>
      ) : (
        <div class={styles.categoriesGrid}>
          {categories().map((category) => {
            const iconClass = getIconClass(category.color)
            const spent = (category as ExpenseCategory).spent || 0
            const budget = (category as ExpenseCategory).budget || 0
            const remaining = (category as ExpenseCategory).remaining ?? (budget - spent)
            const percentUsed = (category as ExpenseCategory).percent_used || 0
            const isOverBudget = percentUsed > 100

            return (
              <div class={styles.categoryCard}>
                <div class={styles.categoryHeader}>
                  <div class={`${styles.categoryIcon} ${iconClass}`}>
                    {category.icon || '📝'}
                  </div>
                  <div class={styles.categoryInfo}>
                    <h3 class={styles.categoryName}>{category.name}</h3>
                    <span class={styles.categoryType}>{category.type}</span>
                  </div>
                  <div class={styles.categoryActions}>
                    <button class={`${styles.btnSm} ${styles.btnGhost}`} onClick={() => { openBudgetModal(category); }}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Budget
                    </button>
                    <button class={`${styles.btnSm} ${styles.btnGhost}`} onClick={() => { editCategory(category); }}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button class={`${styles.btnSm} ${styles.btnGhost}`} onClick={() => deleteCategory(category.id)}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div class={styles.categorySpending}>
                  <div class={styles.spendingHeader}>
                    <span class={styles.spendingLabel}>Spent</span>
                    <span class={`${styles.spendingAmount} ${isOverBudget ? styles.over : ''}`}>
                      {formatCurrency(spent)}
                    </span>
                  </div>
                  {category.type === 'expense' && budget > 0 && (
                    <>
                      <div class={styles.progressBar}>
                        <div
                          class={`${styles.progressFill} ${isOverBudget ? styles.over : ''}`}
                          style={{ width: `${Math.min(100, percentUsed)}%` }}
                        />
                      </div>
                      <div class={styles.spendingFooter}>
                        <span class={styles.budgetLimits}>{formatCurrency(budget)} limit</span>
                        <span class={`${styles.remainingAmount} ${isOverBudget ? styles.over : ''}`}>
                          {formatCurrency(remaining)} remaining
                        </span>
                      </div>
                    </>
                  )}
                </div>
                <div class={styles.categoryColors}>
                  <span class={styles.colorLabel}>Color:</span>
                  <div class={styles.colorPicker}>
                    {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'].map((color) => (
                      <button
                        class={`${styles.colorBtn} ${category.color === color ? styles.active : ''}`}
                        style={{ background: color }}
                        onClick={() => updateColor(category.id, color)}
                        title={color}
                      >
                        {color}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal() && (
        <div class={styles.modalOverlay} onclick={(e) => { if (e.target === e.currentTarget) { setShowAddModal(false); setEditingCategory(null); setFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' }) }}}>
          <div class={styles.modal} onclick={(e) => { e.stopPropagation(); }}>
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>{editingCategory() ? 'Edit Category' : 'Add Category'}</h3>
              <button class={styles.modalClose} onClick={() => { setShowAddModal(false); setEditingCategory(null); setFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' }) }}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onSubmit={handleSubmit}>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Category Name</label>
                <input
                  type="text"
                  class={styles.formControl}
                  placeholder="e.g., Food, Rent"
                  value={formData().name}
                  oninput={(e) => setFormData({ ...formData(), name: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Category Type</label>
                <select
                  class={styles.formControl}
                  value={formData().type}
                  oninput={(e) => setFormData({ ...formData(), type: e.target.value as any })}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Icon (emoji)</label>
                <input
                  type="text"
                  class={styles.formControl}
                  placeholder="e.g., 🍔, 🏠, 🚗"
                  value={formData().icon}
                  oninput={(e) => setFormData({ ...formData(), icon: e.target.value })}
                  maxlength="2"
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Color</label>
                <div class={styles.colorPicker}>
                  {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'].map((color) => (
                    <button
                      class={`${styles.colorPickerBtn} ${formData().color === color ? styles.active : ''}`}
                      style={{ background: color }}
                      onClick={() => setFormData({ ...formData(), color })}
                      title={color}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>
              <div class={styles.modalFooter}>
                <button type="button" class={styles.btnSecondary} onClick={() => { setShowAddModal(false); setEditingCategory(null); setFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' }) }}>
                  Cancel
                </button>
                <button type="submit" class={styles.btnPrimary}>
                  {editingCategory() ? 'Update' : 'Add'} Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Budget Modal */}
      {showBudgetModal() && selectedCategory() && (
        <div class={styles.modalOverlay} onclick={(e) => { if (e.target === e.currentTarget) setShowBudgetModal(false) }}>
          <div class={styles.modal} onclick={(e) => { e.stopPropagation(); }}>
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>Set Budget</h3>
              <button class={styles.modalClose} onClick={() => setShowBudgetModal(false)}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class={styles.modalBody}>
              <p class={styles.modalText}>Set a monthly budget for <strong>{selectedCategory()!.name}</strong></p>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Monthly Budget Amount</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  placeholder="500.00"
                  id="budget-input"
                />
              </div>
            </div>
            <div class={styles.modalFooter}>
              <button class={styles.btnSecondary} onClick={() => setShowBudgetModal(false)}>
                Cancel
              </button>
              <button class={styles.btnPrimary} onClick={() => {
                const input = document.getElementById('budget-input') as HTMLInputElement
                updateBudget(parseFloat(input?.value) || 0)
              }}>
                Save Budget
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}