// ==================== MODAL ====================
const modal = {
  open(id) {
    document.getElementById(id).classList.add('show');
  },
  close(id) {
    document.getElementById(id).classList.remove('show');
  },
};
