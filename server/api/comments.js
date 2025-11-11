// filepath: server/api/comments.js
import db from '../db.js';
import { randomUUID } from 'crypto';

export async function addCommentHandler(req, res) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const { type, targetId, content } = req.body;
  if (!['changelog','feedback'].includes(type) || !targetId || !content) return res.status(400).json({ error: 'Invalid request' });
  // no bad words >:(
  const banned = [/\bnigg\w*\b/i, /\bcunt\b/i, /\bchink\b/i, /\bfag\w*\b/i, /\btrann\w*\b/i, /\bspic\b/i, /\bslut\b/i, /\bwhore\b/i, /\bretard\b/i];
  if (banned.some(r => r.test(content))) return res.status(400).json({ error: 'Inappropriate language detected.' });
  const id = randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO comments (id, type, target_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, type, targetId, req.session.user.id, content, now);
  res.json({ message: 'Comment posted.' });
}

export async function getCommentsHandler(req, res) {
  const { type, targetId } = req.query;
  if (!['changelog','feedback'].includes(type) || !targetId) return res.status(400).json({ error: 'Invalid request' });
  const comments = db.prepare('SELECT c.*, u.username, u.avatar_url FROM comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.type = ? AND c.target_id = ? ORDER BY c.created_at ASC').all(type, targetId);
  res.json({ comments });
}
