// ==================== AUTH ====================
// Uses FM.api from app-singleton.js

const auth = {
  async checkLogin() {
    const result = await FM.api('/auth/me');
    if (result) {
      this.updateUI(result.username);
      return result;
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
      const result = await FM.api('/auth/login', {
        method: 'POST',
        body: { username, password },
      });

      if (result.error) {
        errorEl.textContent = result.error;
        errorEl.style.display = 'block';
        return;
      }

      this.updateUI(result.username);
      if (typeof modal !== 'undefined') modal.close('login-modal');
      FM.Utils.toast('Welcome, ' + result.username + '!', 'success');
    } catch (err) {
      errorEl.textContent = 'Login failed. Please try again.';
      errorEl.style.display = 'block';
    }
  },

  async logout() {
    await FM.api('/auth/logout', { method: 'POST' });
    this.updateUI(null);
    FM.Utils.toast('Logged out', 'success');
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
