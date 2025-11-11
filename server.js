import bareServerPkg from "@tomphttp/bare-server-node";
const { createBareServer } = bareServerPkg;
import express from "express";
import { createServer } from "node:http";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import path, { join } from "node:path";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import session from "express-session";
import dotenv from "dotenv";
import fileUpload from "express-fileupload";
import { signupHandler } from "./server/api/signup.js";
import { signinHandler } from "./server/api/signin.js";
import { adminUserActionHandler } from './server/api/admin-user-action.js';
import { addCommentHandler, getCommentsHandler } from './server/api/comments.js';
import { likeHandler, getLikesHandler } from './server/api/likes.js';
import db from "./server/db.js";
import bcrypt from "bcrypt";
import cors from "cors";
import fetch from "node-fetch";
import fs from 'fs';
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import net from "node:net";
import cluster from "node:cluster";
import { randomUUID } from "crypto";

dotenv.config();
const envFile = `.env.${process.env.NODE_ENV || 'production'}`;
if (fs.existsSync(envFile)) { dotenv.config({ path: envFile }); }
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = "public";
const bare = createBareServer("/bare/", {
  requestOptions: {
    agent: false, 
  }
});
const barePremium = createBareServer("/api/bare-premium/");
const app = express();
app.use(cookieParser());

app.use(express.static(publicPath));
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));
app.use("/storage/data", express.static(path.join(__dirname, "storage", "data"), {
  setHeaders: (res, path) => {
    if (path.endsWith(".json")) {
      res.setHeader("Cache-Control", "public, max-age=3600");
    } else if (/\.(png|jpg|jpeg|gif|webp|avif|svg)$/i.test(path)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  }
}));
app.use("/scram/", express.static(scramjetPath));
app.get('/scramjet.all.js', (req, res) => {
  return res.sendFile(path.join(scramjetPath, 'scramjet.all.js'));
});
app.get('/scramjet.sync.js', (req, res) => {
  return res.sendFile(path.join(scramjetPath, 'scramjet.sync.js'));
});
app.get('/scramjet.wasm.wasm', (req, res) => {
  return res.sendFile(path.join(scramjetPath, 'scramjet.wasm.wasm'));
});
app.get('/scramjet.all.js.map', (req, res) => {
  return res.sendFile(path.join(scramjetPath, 'scramjet.all.js.map'));
});
app.use("/baremux/", express.static(baremuxPath));
app.use("/epoxy/", express.static(epoxyPath));

const verifyMiddleware = (req, res, next) => {
  const verified = req.cookies?.verified === "ok" || req.headers["x-bot-token"] === process.env.BOT_TOKEN;
  const ua = req.headers["user-agent"] || "";
  const isBrowser = /Mozilla|Chrome|Safari|Firefox|Edge/i.test(ua);
  const acceptsHtml = req.headers.accept?.includes("text/html");

  if (!isBrowser) return res.status(403).send("Forbidden");
  if (verified && isBrowser) return next();
  if (!acceptsHtml) return next();

  res.cookie("verified", "ok", { maxAge: 86400000, httpOnly: true, sameSite: "Lax" });
  res.status(200).send(`
    <!DOCTYPE html>
    <html><body>
      <script>
        document.cookie = "verified=ok; Max-Age=86400; SameSite=Lax";
        setTimeout(() => window.location.replace(window.location.pathname), 100);
      </script>
      <noscript>Enable JavaScript to continue.</noscript>
    </body></html>
  `);
};

app.use(verifyMiddleware);

const apiLimiter = rateLimit({
  windowMs: 15 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, slow down"
});

app.use("/bare/", apiLimiter);
app.use("/api/", apiLimiter);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));

app.use(
  "/api/gn-math/covers",
  createProxyMiddleware({
    target: "https://cdn.jsdelivr.net/gh/gn-math/covers@main",
    changeOrigin: true,
    pathRewrite: { "^/api/gn-math/covers": "" },
  })
);

app.use(
  "/api/gn-math/html",
  createProxyMiddleware({
    target: "https://cdn.jsdelivr.net/gh/gn-math/html@main",
    changeOrigin: true,
    pathRewrite: { "^/api/gn-math/html": "" },
  })
);

function toIPv4(ip) {
  if (!ip) return '127.0.0.1';
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
  return ip.match(/^(\d{1,3}\.){3}\d{1,3}$/) ? ip : '127.0.0.1';
}

app.get("/ip", (req, res) => {
  res.sendFile(path.join(__dirname, "public/pages/other/roblox/ip.html"));
});

app.get("/results/:query", async (req, res) => {
  try {
    const query = req.params.query.toLowerCase();
    const response = await fetch(`http://api.duckduckgo.com/ac?q=${encodeURIComponent(query)}&format=json`);
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const data = await response.json();
    const suggestions = data.map(item => ({ phrase: item.phrase })).slice(0, 8);
    return res.status(200).json(suggestions);
  } catch (error) {
    console.error("Error generating suggestions:", error.message);
    return res.status(500).json({ error: "Failed to fetch suggestions" });
  }
});

function isOwner(user) {
  return user && user.is_admin === 1 && user.email === process.env.ADMIN_EMAIL;
}

// Add stricter rate limits for signup and profile-pic upload
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 signups per IP per hour
  message: "Too many accounts created from this IP, try again later."
});
app.post("/api/signup", signupLimiter, signupHandler);

const pfpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 uploads per user per hour
  keyGenerator: req => req.session.user?.id || req.ip,
  message: "Too many profile picture uploads, try again later."
});
app.post("/api/upload-profile-pic", pfpLimiter, (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const file = req.files?.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const userId = req.session.user.id;
    const uploadsDir = path.join(__dirname, 'public', 'uploads', 'profile-pics', userId);
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const fileName = `${Date.now()}-${file.name}`;
    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, file.data);
    const avatarUrl = `/uploads/profile-pics/${userId}/${fileName}`;
    const now = Date.now();
    db.prepare('UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?').run(avatarUrl, now, userId);
    req.session.user.avatar_url = avatarUrl;
    return res.status(200).json({ url: avatarUrl });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/signin", signinHandler);
app.post('/api/admin/user-action', adminUserActionHandler);
app.post('/api/comment', addCommentHandler);
app.get('/api/comments', getCommentsHandler);
app.post('/api/like', likeHandler);
app.get('/api/likes', getLikesHandler);
app.get("/api/verify-email", (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send('<html><body><h1>Invalid verification link</h1></body></html>');
  }
  try {
    const user = db.prepare('SELECT id FROM users WHERE verification_token = ?').get(token);
    if (!user) {
      return res.status(400).send('<html><body><h1>Invalid or expired verification link</h1></body></html>');
    }
    const now = Date.now();
    db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL, updated_at = ? WHERE id = ?').run(now, user.id);
    return res.status(200).send('<html><body style="background:#0a1d37;color:#fff;font-family:Arial;text-align:center;padding:50px;"><h1>Email verified successfully!</h1><p>You can now log in to your account.</p><a href="/pages/settings/p.html" style="color:#3b82f6;">Go to Login</a></body></html>');
  } catch (error) {
    console.error('Verification error:', error);
    return res.status(500).send('<html><body><h1>Verification failed</h1></body></html>');
  }
});
app.post("/api/signout", (req, res) => {
  req.session.destroy();
  return res.status(200).json({ message: "Signout successful" });
});
app.get("/api/profile", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = db.prepare('SELECT id, email, username, bio, avatar_url, is_admin, created_at FROM users WHERE id = ?').get(req.session.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    let role = 'User';
    if (user.is_admin === 1 && user.email === process.env.ADMIN_EMAIL) {
      role = 'Owner';
    } else if (user.is_admin === 3) {
      role = 'Admin';
    } else if (user.is_admin === 2) {
      role = 'Staff';
    }
    return res.status(200).json({ user: {
      id: user.id,
      email: user.email,
      user_metadata: {
        name: user.username,
        bio: user.bio,
        avatar_url: user.avatar_url
      },
      app_metadata: {
        provider: 'email',
        is_admin: user.is_admin,
        role
      }
    }});
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/update-profile", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const { username, bio } = req.body;
    const now = Date.now();
    db.prepare('UPDATE users SET username = ?, bio = ?, updated_at = ? WHERE id = ?').run(username || null, bio || null, now, req.session.user.id);
    req.session.user.username = username;
    req.session.user.bio = bio;
    return res.status(200).json({ message: "Profile updated" });
  } catch (error) {
    console.error('Update error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/save-localstorage", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const { data } = req.body;
    const now = Date.now();
    db.prepare(`
      INSERT INTO user_settings (user_id, localstorage_data, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET localstorage_data = ?, updated_at = ?
    `).run(req.session.user.id, data, now, data, now);
    return res.status(200).json({ message: "LocalStorage saved" });
  } catch (error) {
    console.error('Save error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/load-localstorage", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const result = db.prepare('SELECT localstorage_data FROM user_settings WHERE user_id = ?').get(req.session.user.id);
    return res.status(200).json({ data: result?.localstorage_data || '{}' });
  } catch (error) {
    console.error('Load error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.delete("/api/delete-account", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.session.user.id);
    req.session.destroy();
    return res.status(200).json({ message: "Account deleted" });
  } catch (error) {
    console.error('Delete error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/changelog", (req, res) => {
  try {
    const changelogs = db.prepare(`
      SELECT c.*, u.username as author_name
      FROM changelog c
      LEFT JOIN users u ON c.author_id = u.id
      ORDER BY c.created_at DESC
      LIMIT 50
    `).all();
    return res.status(200).json({ changelogs });
  } catch (error) {
    console.error('Changelog error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/feedback", (req, res) => {
  try {
    const feedback = db.prepare(`
      SELECT f.*, u.username, u.email
      FROM feedback f
      LEFT JOIN users u ON f.user_id = u.id
      ORDER BY f.created_at DESC
      LIMIT 100
    `).all();
    return res.status(200).json({ feedback });
  } catch (error) {
    console.error('Feedback list error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/changelog", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.user.id);
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required" });
    }
    const id = randomUUID();
    const now = Date.now();
    db.prepare('INSERT INTO changelog (id, title, content, author_id, created_at) VALUES (?, ?, ?, ?, ?)').run(id, title, content, req.session.user.id, now);
    return res.status(201).json({ message: "Changelog created", id });
  } catch (error) {
    console.error('Changelog create error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/feedback", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const { content } = req.body;
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: "Feedback content is required" });
    }
    const id = randomUUID();
    const now = Date.now();
    db.prepare('INSERT INTO feedback (id, user_id, content, created_at) VALUES (?, ?, ?, ?)').run(id, req.session.user.id, content.trim(), now);
    return res.status(201).json({ message: "Feedback submitted", id });
  } catch (error) {
    console.error('Feedback error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/admin/feedback", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.user.id);
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const feedback = db.prepare(`
      SELECT f.*, u.email, u.username
      FROM feedback f
      LEFT JOIN users u ON f.user_id = u.id
      ORDER BY f.created_at DESC
      LIMIT 100
    `).all();
    return res.status(200).json({ feedback });
  } catch (error) {
    console.error('Admin feedback error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/admin/stats", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.user.id);
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const feedbackCount = db.prepare('SELECT COUNT(*) as count FROM feedback').get().count;
    const changelogCount = db.prepare('SELECT COUNT(*) as count FROM changelog').get().count;
    return res.status(200).json({ 
      userCount, 
      feedbackCount, 
      changelogCount 
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/admin/users", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = db.prepare('SELECT is_admin, email FROM users WHERE id = ?').get(req.session.user.id);
    if (!user || !(user.is_admin === 1 && user.email === process.env.ADMIN_EMAIL || user.is_admin === 2 || user.is_admin === 3)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const users = db.prepare(`
      SELECT id, email, username, created_at, is_admin, avatar_url, bio, school, age
      FROM users
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
    const usersWithExtras = users.map(u => {
      let ip = null;
      if (user.is_admin === 1 && user.email === process.env.ADMIN_EMAIL) {
        ip = u.ip || 'N/A';
      } else {
        ip = 'N/A';
      }
      return {
        ...u,
        ip,
        signup_link: null,
        role: (u.is_admin === 1 && u.email === process.env.ADMIN_EMAIL) ? 'Owner' : (u.is_admin === 3 ? 'Admin' : (u.is_admin === 2 ? 'Staff' : 'User'))
      };
    });
    return res.status(200).json({ users: usersWithExtras });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/change-password", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    const now = Date.now();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(newPasswordHash, now, req.session.user.id);
    return res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.use((req, res) => {
  return res.status(404).sendFile(join(__dirname, publicPath, "404.html"));
});

function parseCookies(header) {
  if (!header) return {};
  return header.split(';').reduce((acc, cookie) => {
    const [name, value] = cookie.trim().split('=');
    acc[name] = value;
    return acc;
  }, {});
}

const isVerified = (req) => {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.verified === "ok" || req.headers["x-bot-token"] === process.env.BOT_TOKEN;
};

const isBrowser = (req) => {
  const ua = req.headers["user-agent"] || "";
  return /Mozilla|Chrome|Safari|Firefox|Edge/i.test(ua);
};

const handleHttpVerification = (req, res, next) => {
  const acceptsHtml = req.headers.accept?.includes("text/html");
  if (!acceptsHtml) return next();
  if (isVerified(req) && isBrowser(req)) return next();
  if (!isBrowser(req)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }
  res.writeHead(200, {
    "Content-Type": "text/html",
    "Set-Cookie": "verified=ok; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax"
  });
  res.end(`
    <!DOCTYPE html>
    <html>
      <body>
        <script>
          document.cookie = "verified=ok; Max-Age=86400; SameSite=Lax";
          setTimeout(() => window.location.replace(window.location.pathname), 100);
        </script>
        <noscript>Enable JavaScript to continue.</noscript>
      </body>
    </html>
  `);
};

const handleUpgradeVerification = (req, socket, next) => {
  const verified = isVerified(req);
  const isWsBrowser = isBrowser(req);
  console.log(`WebSocket Upgrade Attempt: URL=${req.url}, Verified=${verified}, IsBrowser=${isWsBrowser}, Cookies=${req.headers.cookie || 'none'}`);
  if (req.url.startsWith("/wisp/")) {
    return next();
  }
  if (verified && isWsBrowser) {
    return next();
  }
  console.log(`WebSocket Rejected: URL=${req.url}, Reason=${verified ? 'Not a browser' : 'Not verified'}`);
  socket.destroy();
};

const server = createServer((req, res) => {
  if (bare.shouldRoute(req)) {
    handleHttpVerification(req, res, () => {
      bare.routeRequest(req, res);
    });
  } else if (barePremium.shouldRoute(req)) {
    handleHttpVerification(req, res, () => {
      barePremium.routeRequest(req, res);
    });
  } else {
    app.handle(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bare.shouldRoute(req)) {
    handleUpgradeVerification(req, socket, () => {
      bare.routeUpgrade(req, socket, head);
    });
  } else if (barePremium.shouldRoute(req)) {
    handleUpgradeVerification(req, socket, () => {
      barePremium.routeUpgrade(req, socket, head);
    });
  } else if (req.url && (req.url.startsWith("/wisp/") || req.url.startsWith("/api/wisp-premium/"))) {
    handleUpgradeVerification(req, socket, () => {
      if (req.url.startsWith("/api/wisp-premium/")) {
        req.url = req.url.replace("/api/wisp-premium/", "/wisp/");
      }
      wisp.routeRequest(req, socket, head);
    });
  } else {
    socket.destroy();
  }
});
// In my serverside config I rewrite /api/bare-premium/ and /api/wisp-premium/ to go to a bare/wisp servers from non-flagged ip datacenters to allow for cloudflare/google protected sites to work.
// If you are self hosting, this will not apply to you, and google/youtube/cloudflare protected sites will probably not work unless you run this on a non-flagged ip.

const port = parseInt(process.env.PORT || "3000");

server.keepAliveTimeout = 5000;  
server.headersTimeout = 6000;    

server.listen({ port }, () => {
  const address = server.address();
  console.log(`Listening on:`);
  console.log(`\thttp://localhost:${address.port}`);
  console.log(`\thttp://${hostname()}:${address.port}`);
  console.log(`\thttp://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close();
  bare.close();
  process.exit(0);
}
