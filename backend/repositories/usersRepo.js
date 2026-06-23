const { BaseRepository } = require('./baseRepo');

class UsersRepository extends BaseRepository {
  getById(userId) {
    return this.get('SELECT * FROM users WHERE id = ?', userId);
  }

  getByUsername(username) {
    return this.get('SELECT * FROM users WHERE username = ?', username);
  }

  updatePassword(userId, passwordHash) {
    return this.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, userId);
  }

  updateEmail(userId, email) {
    return this.run('UPDATE users SET email = ? WHERE id = ?', email, userId);
  }
}

module.exports = { UsersRepository };
