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

// Reset zoom to default (for mobile zoom prevention)
function resetZoom() {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    // Temporarily remove restriction to reset zoom
    viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
    setTimeout(() => {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no');
    }, 100);
  }
  toast('Zoom reset to default', 'success');
}

// Global init bootstrap
nav.init();
if (typeof dashboard !== 'undefined') dashboard.init();
if (typeof profile !== 'undefined') profile.init();
if (typeof theme !== 'undefined') theme.init();
if (typeof auth !== 'undefined') auth.checkLogin();
