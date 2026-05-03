// This script sets up the localStorage state that the app needs
async function setupLocalStorage(context) {
  await context.addInitScript(() => {
    localStorage.setItem('currentProfileId', '1')
    localStorage.setItem('darkMode', 'false')
  })
}
module.exports = { setupLocalStorage }
