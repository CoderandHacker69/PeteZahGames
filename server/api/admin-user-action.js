// filepath: server/api/admin-user-action.js
import db from '../db.js';

export async function adminUserActionHandler(req, res) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const admin = db.prepare('SELECT is_admin, email FROM users WHERE id = ?').get(req.session.user.id);
  const ownerEmail = process.env.ADMIN_EMAIL;
  const isOwner = admin && admin.email === ownerEmail;
  if (!admin || (admin.is_admin < 1 && admin.is_admin !== 2)) return res.status(403).json({ error: 'Admin access required' });
  const { userId, action } = req.body;
  if (!userId || !['suspend','staff','delete','ban','promote_admin','demote_admin'].includes(action)) return res.status(400).json({ error: 'Invalid request' });
  if (userId === req.session.user.id) return res.status(400).json({ error: 'Cannot manage yourself' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (["promote_admin", "demote_admin", "staff"].includes(action) && !isOwner) {
    return res.status(403).json({ error: 'Only the owner can manage admin/staff roles.' });
  }
  if (user.email === ownerEmail) return res.status(403).json({ error: 'Cannot manage the owner.' });

  if (action === 'staff') {
    db.prepare('UPDATE users SET is_admin = 2 WHERE id = ?').run(userId); // 2 = staff
    return res.json({ message: 'User promoted to staff.' });
  }
  if (action === 'promote_admin') {
    db.prepare('UPDATE users SET is_admin = 3 WHERE id = ?').run(userId); // 3 = admin
    return res.json({ message: 'User promoted to admin.' });
  }
  if (action === 'demote_admin') {
    db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(userId); // 0 = user
    return res.json({ message: 'Admin demoted to user.' });
  }
  if ([2,3].includes(admin.is_admin) || isOwner) {
    if (action === 'suspend') {
      db.prepare('UPDATE users SET email_verified = 0 WHERE id = ?').run(userId);
      return res.json({ message: 'User suspended.' });
    }
    if (action === 'ban') {
      try { db.prepare('ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0'); } catch {}
      db.prepare('UPDATE users SET banned = 1, email_verified = 0 WHERE id = ?').run(userId);
      return res.json({ message: 'User and IP banned.' });
    }
    if (action === 'delete') {
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      return res.json({ message: 'User deleted.' });
    }
  }
  return res.status(400).json({ error: 'Unknown or unauthorized action' });
}
