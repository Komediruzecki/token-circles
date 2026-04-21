/**
 * Categories Component
 * Manages expense and income categories with CRUD operations
 */

import { createSignal, onMount } from 'solid-js'
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
      // expenseCategories is unused - kept for type references if needed
      // setExpenseCategories(_expenseRes)
      // incomeCategories is unused - kept for type references if needed
      // setIncomeCategories(allRes.filter((c: Category) => c.type === 'income'))
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
    <div class="page page-categories page-enter">
      <div class="page-header">
        <div class="header-top">
          <h1>Categories</h1>
          <button class="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Category
          </button>
        </div>
        <p class="page-subtitle">Organize your transactions with expense and income categories</p>
      </div>

      <div class="categories-tabs">
        <button class={`tab ${categories().filter(c => c.type === 'expense').length === 0 ? 'active' : ''}`} onClick={() => loadCategories()}>
          Expenses
        </button>
        <button class={`tab ${categories().filter(c => c.type === 'income').length === 0 ? 'active' : ''}`} onClick={() => {
          setCategories(categories().filter(c => c.type === 'income'))
        }}>
          Income
        </button>
      </div>

      {loading() ? (
        <div class="empty-state">Loading categories...</div>
      ) : categories().length === 0 ? (
        <div class="empty-state">
          <p>No categories yet</p>
          <p>Create your first category to start organizing your transactions.</p>
          <button class="btn btn-primary" onClick={() => setShowAddModal(true)}>
            Add Category
          </button>
        </div>
      ) : (
        <div class="categories-grid">
          {categories().map((category) => {
            const iconClass = getIconClass(category.color)
            const spent = (category as ExpenseCategory).spent || 0
            const budget = (category as ExpenseCategory).budget || 0
            const remaining = (category as ExpenseCategory).remaining ?? (budget - spent)
            const percentUsed = (category as ExpenseCategory).percent_used || 0
            const isOverBudget = percentUsed > 100

            return (
              <div class="category-card">
                <div class="category-header">
                  <div class={`category-icon ${iconClass}`}>
                    {category.icon || '📝'}
                  </div>
                  <div class="category-info">
                    <h3 class="category-name">{category.name}</h3>
                    <span class="category-type">{category.type}</span>
                  </div>
                  <div class="category-actions">
                    <button class="btn btn-sm btn-ghost" onClick={() => openBudgetModal(category)}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Budget
                    </button>
                    <button class="btn btn-sm btn-ghost" onClick={() => editCategory(category)}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button class="btn btn-sm btn-ghost" onClick={() => deleteCategory(category.id)}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div class="category-spending">
                  <div class="spending-header">
                    <span class="spending-label">Spent</span>
                    <span class={`spending-amount ${isOverBudget ? 'over' : ''}`}>
                      {formatCurrency(spent)}
                    </span>
                  </div>
                  {category.type === 'expense' && budget > 0 && (
                    <>
                      <div class="progress-bar">
                        <div
                          class={`progress-fill ${isOverBudget ? 'over' : ''}`}
                          style={{ width: `${Math.min(100, percentUsed)}%` }}
                        />
                      </div>
                      <div class="spending-footer">
                        <span class="budget-limits">{formatCurrency(budget)} limit</span>
                        <span class={`remaining-amount ${isOverBudget ? 'over' : ''}`}>
                          {formatCurrency(remaining)} remaining
                        </span>
                      </div>
                    </>
                  )}
                </div>
                <div class="category-colors">
                  <span class="color-label">Color:</span>
                  {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'].map((color) => (
                    <button
                      key={color}
                      class={`color-btn ${category.color === color ? 'active' : ''}`}
                      style={{ background: color }}
                      onClick={() => updateColor(category.id, color)}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal() && (
        <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) { setShowAddModal(false); setEditingCategory(null); setFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' }) }}}>
          <div class="modal" onclick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h3 class="modal-title">{editingCategory() ? 'Edit Category' : 'Add Category'}</h3>
              <button class="modal-close" onClick={() => { setShowAddModal(false); setEditingCategory(null); setFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' }) }}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class="modal-body" onSubmit={handleSubmit}>
              <div class="form-group">
                <label class="form-label">Category Name</label>
                <input
                  type="text"
                  class="form-control"
                  placeholder="e.g., Food, Rent"
                  value={formData().name}
                  oninput={(e) => setFormData({ ...formData(), name: e.target.value })}
                  required
                />
              </div>
              <div class="form-group">
                <label class="form-label">Category Type</label>
                <select
                  class="form-control"
                  value={formData().type}
                  oninput={(e) => setFormData({ ...formData(), type: e.target.value as any })}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Icon (emoji)</label>
                <input
                  type="text"
                  class="form-control"
                  placeholder="e.g., 🍔, 🏠, 🚗"
                  value={formData().icon}
                  oninput={(e) => setFormData({ ...formData(), icon: e.target.value })}
                  maxlength="2"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Color</label>
                <div class="color-picker">
                  {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'].map((color) => (
                    <button
                      key={color}
                      class={`color-picker-btn ${formData().color === color ? 'active' : ''}`}
                      style={{ background: color }}
                      onClick={() => setFormData({ ...formData(), color })}
                      title={color}
                    />
                  ))}
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onClick={() => { setShowAddModal(false); setEditingCategory(null); setFormData({ name: '', type: 'expense', color: '#3b82f6', icon: '' }) }}>
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary">
                  {editingCategory() ? 'Update' : 'Add'} Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Budget Modal */}
      {showBudgetModal() && selectedCategory() && (
        <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) setShowBudgetModal(false) }}>
          <div class="modal" onclick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h3 class="modal-title">Set Budget</h3>
              <button class="modal-close" onClick={() => setShowBudgetModal(false)}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <p class="modal-text">Set a monthly budget for <strong>{selectedCategory()!.name}</strong></p>
              <div class="form-group">
                <label class="form-label">Monthly Budget Amount</label>
                <input
                  type="number"
                  step="0.01"
                  class="form-control"
                  placeholder="500.00"
                  id="budget-input"
                />
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" onClick={() => setShowBudgetModal(false)}>
                Cancel
              </button>
              <button class="btn btn-primary" onClick={() => {
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