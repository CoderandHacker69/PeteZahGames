// filepath: server/api/likes.js
import db from '../db.js';
import { randomUUID } from 'crypto';

export async function likeHandler(req, res) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const { type, targetId } = req.body;
  if (!['changelog','feedback'].includes(type) || !targetId) return res.status(400).json({ error: 'Invalid request' });
  const id = randomUUID();
  const now = Date.now();
  try {
    db.prepare('INSERT INTO likes (id, type, target_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, type, targetId, req.session.user.id, now);
    res.json({ message: 'Liked!' });
  } catch {
    db.prepare('DELETE FROM likes WHERE type = ? AND target_id = ? AND user_id = ?')
      .run(type, targetId, req.session.user.id);
    res.json({ message: 'Unliked.' });
  }
}

export async function getLikesHandler(req, res) {
  const { type, targetId } = req.query;
  if (!['changelog','feedback'].includes(type) || !targetId) return res.status(400).json({ error: 'Invalid request' });
  const count = db.prepare('SELECT COUNT(*) as count FROM likes WHERE type = ? AND target_id = ?').get(type, targetId)?.count || 0;
  res.json({ count });
}
