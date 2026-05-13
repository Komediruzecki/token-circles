/**
 * App Store — shared reactive state using SolidJS createStore
 * Extracts centralized state from App.tsx to enable component-level access
 * without prop drilling.
 */
import { createStore } from 'solid-js/store'
import type { Category, PageName, Profile } from '../types/models'

export interface AppState {
  page: PageName
  loading: boolean
  profiles: Profile[]
  currentProfile: Profile | null
  isAuthenticated: boolean
  showDropdown: boolean
  isLoginModalOpen: boolean
  isProfileModalOpen: boolean
  isQuickAddOpen: boolean
  sidebarCollapsed: boolean
  quickAddCategories: Category[]
}

const initialState: AppState = {
  page: 'dashboard',
  loading: true,
  profiles: [],
  currentProfile: null,
  isAuthenticated: false,
  showDropdown: false,
  isLoginModalOpen: false,
  isProfileModalOpen: false,
  isQuickAddOpen: false,
  sidebarCollapsed: true,
  quickAddCategories: [],
}

const [state, setState] = createStore<AppState>(initialState)

// ── Selectors ──────────────────────────────────────────────────────────────────

export function useAppState() {
  return state
}

// ── Page ──

export function getPage() {
  return state.page
}

export function setPage(page: PageName) {
  setState('page', page)
}

// ── Loading ──

export function getLoading() {
  return state.loading
}

export function setLoading(loading: boolean) {
  setState('loading', loading)
}

// ── Auth ──

export function getIsAuthenticated() {
  return state.isAuthenticated
}

export function setIsAuthenticated(auth: boolean) {
  setState('isAuthenticated', auth)
}

// ── Profiles ──

export function getProfiles() {
  return state.profiles
}

export function setProfiles(profiles: Profile[]) {
  setState('profiles', profiles)
}

export function getCurrentProfile() {
  return state.currentProfile
}

export function setCurrentProfile(profile: Profile | null) {
  setState('currentProfile', profile)
}

// ── Modals ──

export function getShowDropdown() {
  return state.showDropdown
}

export function setShowDropdown(show: boolean) {
  setState('showDropdown', show)
}

export function toggleDropdown() {
  setState('showDropdown', (v) => !v)
}

export function getIsLoginModalOpen() {
  return state.isLoginModalOpen
}

export function setIsLoginModalOpen(open: boolean) {
  setState('isLoginModalOpen', open)
}

export function getIsProfileModalOpen() {
  return state.isProfileModalOpen
}

export function setIsProfileModalOpen(open: boolean) {
  setState('isProfileModalOpen', open)
}

export function getIsQuickAddOpen() {
  return state.isQuickAddOpen
}

export function setIsQuickAddOpen(open: boolean) {
  setState('isQuickAddOpen', open)
}

// ── Sidebar ──

export function getSidebarCollapsed() {
  return state.sidebarCollapsed
}

export function setSidebarCollapsed(collapsed: boolean) {
  setState('sidebarCollapsed', collapsed)
}

export function toggleSidebar() {
  setState('sidebarCollapsed', (v) => !v)
}

// ── Quick Add Categories ──

export function getQuickAddCategories() {
  return state.quickAddCategories
}

export function setQuickAddCategories(categories: Category[]) {
  setState('quickAddCategories', categories)
}
