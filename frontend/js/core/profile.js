// ==================== PROFILE ====================
const profile = {
  currentId: parseInt(localStorage.getItem('currentProfileId') || '1'),

  async loadProfiles() {
    const profiles = await api('/profiles');
    return Array.isArray(profiles) ? profiles : [];
  },

  async switchTo(id) {
    this.currentId = id;
    localStorage.setItem('currentProfileId', id);
    await this.refreshUI();
    // Reload current page
    const page = window.location.hash.slice(1) || 'dashboard';
    if (page === 'dashboard') dashboard.load();
    else if (page === 'transactions') transactions.load();
    else if (page === 'budgets') budgets.load();
    else if (page === 'loans') loans.load();
    else if (page === 'categories') categories.load();
    else if (page === 'settings') settings.load();
    else if (page === 'accounts') accounts.load();
  },

  toggleDropdown() {
    const menu = document.getElementById('profile-menu');
    menu.classList.toggle('open');
    if (menu.classList.contains('open')) {
      this.renderDropdown();
    }
  },

  async renderDropdown() {
    const profiles = await this.loadProfiles();
    const menu = document.getElementById('profile-menu');
    const isLoggedIn = auth.isLoggedIn();
    let html = profiles
      .map(
        (p) => `
      <div class="profile-dropdown-item${p.id === this.currentId ? ' active' : ''}"
           onclick="profile.switchTo(${p.id})">
        <span>${profile.escapeHtml(p.name)}</span>
        ${p.id !== 1 ? `<button class="delete-profile-btn" onclick="event.stopPropagation(); profile.confirmDelete(${p.id}, '${profile.escapeHtml(p.name).replace(/'/g, "\\'")}')">✕</button>` : ''}
      </div>
    `
      )
      .join('');
    if (isLoggedIn) {
      html += `<div class="profile-dropdown-divider"></div>
      <div class="profile-dropdown-add" onclick="modal.open('profile-modal'); profile.toggleDropdown()">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
        New Profile
      </div>`;
    }
    menu.innerHTML = html;
    menu.classList.add('open');

    // Close on outside click
    const closeHandler = (e) => {
      if (!menu.parentElement.contains(e.target)) {
        menu.classList.remove('open');
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  },

  async refreshUI() {
    const btn = document.getElementById('profile-btn-name');
    const profiles = await this.loadProfiles();
    const current = profiles.find((p) => p.id === this.currentId);
    if (btn) btn.textContent = current ? current.name : 'Profile';
  },

  async createProfile() {
    const name = document.getElementById('profile-name-input').value.trim();
    if (!name) return toast('Enter a profile name', 'error');
    const data = await api('/profiles', { method: 'POST', body: { name } });
    if (!data.error) {
      await this.switchTo(data.id);
      modal.close('profile-modal');
      toast('Profile created', 'success');
    } else {
      toast(data.error, 'error');
    }
  },

  confirmDelete(id, name) {
    if (confirm(`Delete profile "${name}"? This cannot be undone.`)) {
      api(`/profiles/${id}`, { method: 'DELETE' }).then(() => {
        if (this.currentId === id) this.switchTo(1);
        else this.refreshUI();
        toast('Profile deleted', 'success');
      });
    }
  },

  async init() {
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('profile-menu');
      const btn = document.getElementById('profile-btn');
      if (!menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('open');
      }
    });
    await this.refreshUI();
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
