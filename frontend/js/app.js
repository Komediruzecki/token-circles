// ==================== INIT BOOTSTRAP ====================
// Drag and drop for import
const dz = document.getElementById('import-dropzone');
if (dz) {
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && typeof dataImport !== 'undefined') dataImport.handleFile(file);
  });
}

// Global init bootstrap
nav.init();
if (typeof dashboard !== 'undefined') dashboard.init();
if (typeof profile !== 'undefined') profile.refreshUI();
if (typeof theme !== 'undefined') theme.init();
if (typeof auth !== 'undefined') auth.checkLogin();
