import bcrypt from 'bcrypt';
import db from '../db.js';
import dotenv from "dotenv";
import { randomUUID } from 'crypto';

export async function signupHandler(req, res) {
  const { email, password, school, age } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = randomUUID();
    const now = Date.now();

    let ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.connection?.remoteAddress || null;
    if (ip && typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
    if (ip && ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');

    const isFirstUser = db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0;
    const isAdmin = isFirstUser || email === process.env.ADMIN_EMAIL;

    db.prepare(`
      INSERT INTO users (id, email, password_hash, created_at, updated_at, is_admin, email_verified, school, age, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, email, passwordHash, now, now, isAdmin ? 1 : 0, 1, school || null, age || null, ip);

    res.status(201).json({ 
      message: isFirstUser 
        ? 'Admin account created and verified automatically!' 
        : 'Account created successfully! You can now log in.'
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
