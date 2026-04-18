// ==================== API ====================
// API URL is defined in namespace.js
const API = '/api';

function api(url, options = {}) {
  // Use FM.profile if available, otherwise fall back to window.profile
  const profileRef = FM.profile;
  const headers = {
    'Content-Type': 'application/json',
    'X-Profile-Id': profileRef?.currentId || '',
    ...options.headers,
  };
  // Send multi-profile header if in combined view
  const selectedIds = profileRef?.selectedIds;
  if (selectedIds && selectedIds.length > 0) {
    headers['X-Profile-Ids'] = JSON.stringify(selectedIds);
  }
  if (options.method === 'DELETE' && !options.body) {
    delete headers['Content-Type'];
  }
  return fetch(API + url, {
    credentials: 'include',
    headers,
    ...options,
    body:
      options.body && typeof options.body === 'object'
        ? JSON.stringify(options.body)
        : options.body,
  }).then(async (r) => {
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    return r.json();
  });
}

// Export to window for backward compatibility
window.api = api;
window.FM.api = api;