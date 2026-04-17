// ==================== PROFILE ====================
const profile = {
  currentId: parseInt(localStorage.getItem('currentProfileId') || '1'),
  selectedIds: [], // For multi-select combined view

  async loadProfiles() {
    const profiles = await api('/profiles');
    return Array.isArray(profiles) ? profiles : [];
  },

  async switchTo(id) {
    this.currentId = id;
    this.selectedIds = [id]; // Reset multi-select to single profile
    localStorage.setItem('currentProfileId', id);
    localStorage.setItem('selectedProfileIds', JSON.stringify([id]));
    await this.refreshUI();
    this.updateDropdownDisplay();
    // Reload current page
    const page = window.location.hash.slice(1) || 'dashboard';
    this.navigateToPage(page);
  },

  // Toggle a profile in multi-select
  async toggleProfile(id) {
    const idx = this.selectedIds.indexOf(id);
    if (idx >= 0) {
      this.selectedIds.splice(idx, 1);
    } else {
      this.selectedIds.push(id);
    }

    // Ensure at least one profile is selected
    if (this.selectedIds.length === 0) {
      this.selectedIds = [this.currentId];
    }

    // Update localStorage
    localStorage.setItem('selectedProfileIds', JSON.stringify(this.selectedIds));

    this.updateDropdownDisplay();
    this.navigateToPage(window.location.hash.slice(1) || 'dashboard');
  },

  // Select all profiles for combined view
  async selectAllProfiles() {
    const profiles = await this.loadProfiles();
    this.selectedIds = profiles.map(p => p.id);
    localStorage.setItem('selectedProfileIds', JSON.stringify(this.selectedIds));
    this.updateDropdownDisplay();
    this.navigateToPage(window.location.hash.slice(1) || 'dashboard');
  },

  // Clear multi-select, go back to single profile
  async clearMultiSelect() {
    this.selectedIds = [this.currentId];
    localStorage.setItem('selectedProfileIds', JSON.stringify(this.selectedIds));
    this.updateDropdownDisplay();
    this.navigateToPage(window.location.hash.slice(1) || 'dashboard');
  },

  navigateToPage(page) {
    if (page === 'dashboard') dashboard.load();
    else if (page === 'transactions') transactions.load();
    else if (page === 'budgets') budgets.load();
    else if (page === 'loans') loans.load();
    else if (page === 'categories') categories.load();
    else if (page === 'settings') settings.load();
    else if (page === 'accounts') accounts.load();
    else if (page === 'analytics') analytics.load();
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

    // Check if in multi-select mode
    const isMultiSelect = this.selectedIds.length > 1;

    let html = `
      <div class="profile-dropdown-header">
        <span>${isMultiSelect ? 'Household View' : 'Select Profile'}</span>
        ${this.selectedIds.length > 1
          ? `<button class="profile-dropdown-clear" onclick="profile.clearMultiSelect()">Clear</button>`
          : `<button class="profile-dropdown-all" onclick="profile.selectAllProfiles()">All</button>`
        }
      </div>
    `;

    html += profiles
      .map(
        (p) => `
      <div class="profile-dropdown-item${this.selectedIds.includes(p.id) ? ' active' : ''}"
           onclick="profile.toggleProfile(${p.id})">
        <span class="profile-checkbox">${this.selectedIds.includes(p.id) ? '&#10003;' : ''}</span>
        <span>${this.escapeHtml(p.name)}</span>
        ${p.id !== 1 ? `<button class="delete-profile-btn" onclick="event.stopPropagation(); profile.confirmDelete(${p.id}, '${this.escapeHtml(p.name).replace(/'/g, "\\'")}')">&#10005;</button>` : ''}
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

  updateDropdownDisplay() {
    const btn = document.getElementById('profile-btn-name');
    const profiles = this.loadProfiles().then(profiles => {
      if (this.selectedIds.length > 1) {
        btn.textContent = `${this.selectedIds.length} Profiles`;
        btn.style.fontWeight = '600';
      } else if (this.selectedIds.length === 1) {
        const current = profiles.find((p) => p.id === this.selectedIds[0]);
        btn.textContent = current ? current.name : 'Profile';
        btn.style.fontWeight = '';
      }
    });
  },

  async refreshUI() {
    const btn = document.getElementById('profile-btn-name');
    const profiles = await this.loadProfiles();
    const current = profiles.find((p) => p.id === this.currentId);
    if (btn) btn.textContent = current ? current.name : 'Profile';
  },

  getProfileIds() {
    return this.selectedIds.length > 0 ? this.selectedIds : [this.currentId];
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
        else {
          this.selectedIds = this.selectedIds.filter(i => i !== id);
          this.refreshUI();
          this.updateDropdownDisplay();
        }
        toast('Profile deleted', 'success');
      });
    }
  },

  async init() {
    // Load saved multi-select state
    try {
      const saved = localStorage.getItem('selectedProfileIds');
      if (saved) {
        this.selectedIds = JSON.parse(saved);
      } else {
        this.selectedIds = [this.currentId];
      }
    } catch (e) {
      this.selectedIds = [this.currentId];
    }

    document.addEventListener('click', (e) => {
      const menu = document.getElementById('profile-menu');
      const btn = document.getElementById('profile-btn');
      if (!menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('open');
      }
    });
    await this.refreshUI();
    this.updateDropdownDisplay();
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
