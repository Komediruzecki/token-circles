// ==================== MODAL ====================
const modal = {
  open(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('show');
  },
  close(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  },
};
