/**
 * Authentication module - handles login/logout and auth state
 */

import { api } from './api.js';

/**
 * Auth store - handles authentication state
 */
export class AuthStore {
  private isAuthenticated = false;
  private currentUser: any = null;

  /**
   * Check if user is logged in
   */
  async checkLogin(): Promise<boolean> {
    try {
      await api.checkLogin();
      this.isAuthenticated = true;
      return true;
    } catch {
      this.isAuthenticated = false;
      return false;
    }
  }

  /**
   * Login with username and password
   */
  async login(username: string, password: string): Promise<void> {
    try {
      await api.login(username, password);
      this.isAuthenticated = true;
      await this.checkLogin();
    } catch (error) {
      this.isAuthenticated = false;
      throw error;
    }
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    try {
      await api.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      this.isAuthenticated = false;
      this.currentUser = null;
    }
  }

  /**
   * Get current user info
   */
  getCurrentUser(): any {
    return this.currentUser;
  }

  /**
   * Get auth status
   */
  isLoggedIn(): boolean {
    return this.isAuthenticated;
  }
}

// Export singleton instance
export const auth = new AuthStore();

// Initialize auth on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    await auth.checkLogin();
  });
}