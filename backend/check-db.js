const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('/tmp/finance-manager-2/db/finance.db');
db.all(
  'SELECT id, username, password_hash FROM users WHERE username = ?',
  ['maff'],
  (err, rows) => {
    if (err) {
      console.log('Error:', err.message);
    } else {
      console.log('Users in database:', rows.length);
      if (rows.length > 0) {
        rows.forEach((r) => {
          console.log('  -', r.id, r.username);
        });
      } else {
        console.log('No users found');
      }
    }
    db.close();
  }
);
