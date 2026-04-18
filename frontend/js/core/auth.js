// ==================== AUTH ====================
const API = '/api';

const auth = {
  async checkLogin() {
    const result = await fetch(API + '/auth/me', { credentials: 'include' });
    if (result.ok) {
      const data = await result.json();
      this.updateUI(data.username);
      return data;
    }
    this.updateUI(null);
    return null;
  },

  async login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    if (!username || !password) {
      errorEl.textContent = 'Please enter username and password';
      errorEl.style.display = 'block';
      return;
    }

    try {
      const result = await fetch(API + '/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await result.json();

      if (data.error) {
        errorEl.textContent = data.error;
        errorEl.style.display = 'block';
        return;
      }

      this.updateUI(data.username);
      if (typeof modal !== 'undefined') modal.close('login-modal');
      if (typeof toast !== 'undefined') toast('Welcome, ' + data.username + '!', 'success');
    } catch (err) {
      errorEl.textContent = 'Login failed. Please try again.';
      errorEl.style.display = 'block';
    }
  },

  async logout() {
    await fetch(API + '/auth/logout', { method: 'POST', credentials: 'include' });
    this.updateUI(null);
    if (typeof toast !== 'undefined') toast('Logged out', 'success');
  },

  clearLoginForm() {
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.style.display = 'none';
  },

  isLoggedIn() {
    const userSection = document.getElementById('user-section');
    return userSection && userSection.style.display !== 'none';
  },

  updateUI(username) {
    const loginSection = document.getElementById('login-section');
    const userSection = document.getElementById('user-section');
    const usernameDisplay = document.getElementById('username-display');
    if (username) {
      if (loginSection) loginSection.style.display = 'none';
      if (userSection) userSection.style.display = '';
      if (usernameDisplay) usernameDisplay.textContent = username;
    } else {
      if (loginSection) loginSection.style.display = '';
      if (userSection) userSection.style.display = 'none';
      if (usernameDisplay) usernameDisplay.textContent = '';
    }
    // Refresh profile list when auth state changes
    if (typeof profile !== 'undefined') profile.refreshUI();
  },
};
