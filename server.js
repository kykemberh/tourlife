const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const url = require("node:url");
const crypto = require("node:crypto");
const db = require("./db");
const { hashPassword, makeSalt, verifyPassword, makeToken, verifyToken, pickAvatarColor } = require("./auth");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

const ALLOWED_IMAGE_TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp"
};
const MAX_IMAGE_BYTES = 6_000_000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 9_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

// Accepts a data URL like "data:image/png;base64,AAAA..." and saves it to
// the uploads folder. Returns the public URL path, or null if invalid.
function saveImageFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/s);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = ALLOWED_IMAGE_TYPES[mime];
  if (!ext) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;
  const filename = crypto.randomUUID() + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return "/uploads/" + filename;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url || null,
    bio: row.bio || "",
    isAdmin: !!row.is_admin,
    emailVerified: !!row.email_verified,
    createdAt: row.created_at
  };
}

/* ---------------- FRIENDS ---------------- */

function getFriendRequestRow(aId, bId) {
  return db.prepare("SELECT * FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(aId, bId, bId, aId);
}

function friendStatus(meId, otherId) {
  if (meId === otherId) return "self";
  const fr = getFriendRequestRow(meId, otherId);
  if (!fr) return "none";
  if (fr.status === "accepted") return "friends";
  if (fr.status === "pending") return fr.from_id === meId ? "request_sent" : "request_received";
  return "none";
}

function friendsCount(userId) {
  return db.prepare("SELECT COUNT(*) AS c FROM friend_requests WHERE status = 'accepted' AND (from_id = ? OR to_id = ?)").get(userId, userId).c;
}

function friendsList(userId) {
  const rows = db.prepare("SELECT * FROM friend_requests WHERE status = 'accepted' AND (from_id = ? OR to_id = ?)").all(userId, userId);
  return rows
    .map(r => db.prepare("SELECT * FROM users WHERE id = ?").get(r.from_id === userId ? r.to_id : r.from_id))
    .filter(Boolean);
}

function briefUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url || null,
    initials: initials(row.name),
    isAdmin: !!row.is_admin
  };
}

function notify(userId, actorId, type, postId) {
  if (userId === actorId) return; // don't notify yourself
  db.prepare("INSERT INTO notifications (user_id, actor_id, type, post_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, actorId, type, postId || null, Date.now());
}

// If a user's email matches ADMIN_EMAIL, make sure they're flagged as admin.
function syncAdminFlag(user) {
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (adminEmail && user.email === adminEmail && !user.is_admin) {
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(user.id);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  }
  return user;
}

function initials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p[0])
    .join("")
    .toUpperCase();
}

function getAuthUser(req) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const data = verifyToken(token);
  if (!data) return null;
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(data.userId);
  return row || null;
}

function deleteImageFile(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith("/uploads/")) return;
  const filePath = path.join(PUBLIC_DIR, imageUrl);
  fs.unlink(filePath, () => {});
}

function postWithMeta(row, meId) {
  const likeCount = db.prepare("SELECT COUNT(*) AS c FROM likes WHERE post_id = ?").get(row.id).c;
  const likedByMe = meId
    ? !!db.prepare("SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?").get(row.id, meId)
    : false;
  const commentCount = db.prepare("SELECT COUNT(*) AS c FROM comments WHERE post_id = ?").get(row.id).c;
  const author = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  return {
    id: row.id,
    text: row.text,
    imageUrl: row.image_url || null,
    createdAt: row.created_at,
    likeCount,
    likedByMe,
    commentCount,
    author: briefUser(author)
  };
}

const routes = [];
function route(method, pattern, handler) {
  // pattern supports :param segments
  const paramNames = [];
  const regexStr = pattern
    .split("/")
    .map(seg => {
      if (seg.startsWith(":")) {
        paramNames.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg;
    })
    .join("/");
  routes.push({ method, regex: new RegExp(`^${regexStr}$`), paramNames, handler });
}

function requireAuth(handler) {
  return async (req, res, params) => {
    const user = getAuthUser(req);
    if (!user) return sendJson(res, 401, { error: "Не авторизовано" });
    return handler(req, res, params, user);
  };
}

function requireAdmin(handler) {
  return requireAuth(async (req, res, params, me) => {
    if (!me.is_admin) return sendJson(res, 403, { error: "Доступно лише адміністратору" });
    return handler(req, res, params, me);
  });
}

/* ---------------- AUTH ---------------- */

route("POST", "/api/register", async (req, res) => {
  const body = await readBody(req);
  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!name || !email || !password) {
    return sendJson(res, 400, { error: "Заповніть ім'я, email і пароль" });
  }
  if (password.length < 6) {
    return sendJson(res, 400, { error: "Пароль має містити мінімум 6 символів" });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return sendJson(res, 409, { error: "Користувач із цим email вже існує" });
  }
  const salt = makeSalt();
  const hash = hashPassword(password, salt);
  const now = Date.now();
  const avatarColor = pickAvatarColor();
  const result = db
    .prepare("INSERT INTO users (name, email, password_hash, salt, avatar_color, bio, created_at) VALUES (?, ?, ?, ?, ?, '', ?)")
    .run(name, email, hash, salt, avatarColor, now);
  const userId = result.lastInsertRowid;
  const token = makeToken(userId);
  let user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  user = syncAdminFlag(user);
  sendJson(res, 201, { token, user: publicUser(user) });
});

route("POST", "/api/login", async (req, res) => {
  const body = await readBody(req);
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return sendJson(res, 401, { error: "Неправильний email або пароль" });
  }
  user = syncAdminFlag(user);
  const token = makeToken(user.id);
  sendJson(res, 200, { token, user: publicUser(user) });
});

route("GET", "/api/me", requireAuth(async (req, res, params, me) => {
  sendJson(res, 200, { user: publicUser(me) });
}));

route("PUT", "/api/me", requireAuth(async (req, res, params, me) => {
  const body = await readBody(req);
  const updates = [];
  const values = [];

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return sendJson(res, 400, { error: "Ім'я не може бути порожнім" });
    updates.push("name = ?");
    values.push(name);
  }
  if (typeof body.bio === "string") {
    updates.push("bio = ?");
    values.push(body.bio.trim().slice(0, 280));
  }
  if (body.avatar) {
    const avatarUrl = saveImageFromDataUrl(body.avatar);
    if (!avatarUrl) {
      return sendJson(res, 400, { error: "Не вдалося завантажити фото профілю (до 6 МБ, png/jpg/gif/webp)" });
    }
    deleteImageFile(me.avatar_url);
    updates.push("avatar_url = ?");
    values.push(avatarUrl);
  }
  if (!updates.length) {
    return sendJson(res, 400, { error: "Немає змін для збереження" });
  }
  values.push(me.id);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(me.id);
  sendJson(res, 200, { user: publicUser(updated) });
}));

/* ---------------- ADMIN ---------------- */

route("GET", "/api/admin/stats", requireAdmin(async (req, res, params, me) => {
  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  const postCount = db.prepare("SELECT COUNT(*) AS c FROM posts").get().c;
  const commentCount = db.prepare("SELECT COUNT(*) AS c FROM comments").get().c;
  const messageCount = db.prepare("SELECT COUNT(*) AS c FROM messages").get().c;
  sendJson(res, 200, { stats: { userCount, postCount, commentCount, messageCount } });
}));

route("GET", "/api/admin/users", requireAdmin(async (req, res, params, me) => {
  const rows = db.prepare("SELECT * FROM users ORDER BY created_at DESC").all();
  sendJson(res, 200, { users: rows.map(publicUser) });
}));

route("DELETE", "/api/admin/posts/:id", requireAdmin(async (req, res, params, me) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(params.id);
  if (!post) return sendJson(res, 404, { error: "Пост не знайдено" });
  deleteImageFile(post.image_url);
  db.prepare("DELETE FROM posts WHERE id = ?").run(params.id);
  db.prepare("DELETE FROM likes WHERE post_id = ?").run(params.id);
  db.prepare("DELETE FROM comments WHERE post_id = ?").run(params.id);
  sendJson(res, 200, { ok: true });
}));

route("DELETE", "/api/admin/users/:id", requireAdmin(async (req, res, params, me) => {
  const targetId = parseInt(params.id, 10);
  if (targetId === me.id) return sendJson(res, 400, { error: "Не можна видалити власний акаунт" });
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
  if (!target) return sendJson(res, 404, { error: "Користувача не знайдено" });
  const postIds = db.prepare("SELECT id FROM posts WHERE user_id = ?").all(targetId).map(p => p.id);
  for (const pid of postIds) {
    db.prepare("DELETE FROM likes WHERE post_id = ?").run(pid);
    db.prepare("DELETE FROM comments WHERE post_id = ?").run(pid);
  }
  db.prepare("DELETE FROM posts WHERE user_id = ?").run(targetId);
  db.prepare("DELETE FROM comments WHERE user_id = ?").run(targetId);
  db.prepare("DELETE FROM likes WHERE user_id = ?").run(targetId);
  db.prepare("DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?").run(targetId, targetId);
  db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
  sendJson(res, 200, { ok: true });
}));

/* ---------------- NOTIFICATIONS ---------------- */

route("GET", "/api/notifications", requireAuth(async (req, res, params, me) => {
  const rows = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(me.id);
  const notifications = rows.map(n => {
    const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(n.actor_id);
    let post = null;
    if (n.post_id) {
      const p = db.prepare("SELECT * FROM posts WHERE id = ?").get(n.post_id);
      if (p) post = { id: p.id, text: p.text };
    }
    return { id: n.id, type: n.type, actor: briefUser(actor), post, read: !!n.read_flag, createdAt: n.created_at };
  });
  const unreadCount = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_flag = 0").get(me.id).c;
  sendJson(res, 200, { notifications, unreadCount });
}));

route("POST", "/api/notifications/read", requireAuth(async (req, res, params, me) => {
  db.prepare("UPDATE notifications SET read_flag = 1 WHERE user_id = ?").run(me.id);
  sendJson(res, 200, { ok: true });
}));

/* ---------------- FRIEND REQUESTS ---------------- */

route("POST", "/api/friends/:id/request", requireAuth(async (req, res, params, me) => {
  const otherId = parseInt(params.id, 10);
  if (otherId === me.id) return sendJson(res, 400, { error: "Не можна додати себе в друзі" });
  const other = db.prepare("SELECT * FROM users WHERE id = ?").get(otherId);
  if (!other) return sendJson(res, 404, { error: "Користувача не знайдено" });

  const existing = getFriendRequestRow(me.id, otherId);
  if (existing) {
    if (existing.status === "accepted") return sendJson(res, 400, { error: "Ви вже друзі" });
    if (existing.status === "pending") {
      if (existing.from_id === me.id) return sendJson(res, 400, { error: "Запит вже надіслано" });
      db.prepare("UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?").run(Date.now(), existing.id);
      notify(otherId, me.id, "friend_accept", null);
      return sendJson(res, 200, { status: "friends" });
    }
    db.prepare("DELETE FROM friend_requests WHERE id = ?").run(existing.id);
  }
  db.prepare("INSERT INTO friend_requests (from_id, to_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(me.id, otherId, Date.now());
  notify(otherId, me.id, "friend_request", null);
  sendJson(res, 201, { status: "request_sent" });
}));

route("POST", "/api/friends/:id/accept", requireAuth(async (req, res, params, me) => {
  const otherId = parseInt(params.id, 10);
  const fr = db.prepare("SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'").get(otherId, me.id);
  if (!fr) return sendJson(res, 404, { error: "Запит не знайдено" });
  db.prepare("UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?").run(Date.now(), fr.id);
  notify(otherId, me.id, "friend_accept", null);
  sendJson(res, 200, { status: "friends" });
}));

route("POST", "/api/friends/:id/decline", requireAuth(async (req, res, params, me) => {
  const otherId = parseInt(params.id, 10);
  const fr = db.prepare("SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'").get(otherId, me.id);
  if (!fr) return sendJson(res, 404, { error: "Запит не знайдено" });
  db.prepare("DELETE FROM friend_requests WHERE id = ?").run(fr.id);
  sendJson(res, 200, { status: "none" });
}));

route("DELETE", "/api/friends/:id", requireAuth(async (req, res, params, me) => {
  const otherId = parseInt(params.id, 10);
  db.prepare("DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").run(me.id, otherId, otherId, me.id);
  sendJson(res, 200, { status: "none" });
}));

route("GET", "/api/friends/requests", requireAuth(async (req, res, params, me) => {
  const rows = db.prepare("SELECT * FROM friend_requests WHERE to_id = ? AND status = 'pending' ORDER BY created_at DESC").all(me.id);
  const requests = rows.map(r => ({
    id: r.id,
    from: briefUser(db.prepare("SELECT * FROM users WHERE id = ?").get(r.from_id)),
    createdAt: r.created_at
  }));
  sendJson(res, 200, { requests });
}));

route("GET", "/api/users/:id/friends", requireAuth(async (req, res, params, me) => {
  const targetId = parseInt(params.id, 10);
  sendJson(res, 200, { friends: friendsList(targetId).map(briefUser) });
}));

/* ---------------- EMAIL VERIFICATION (no real SMTP — code shown directly) ---------------- */

route("POST", "/api/me/send-verification", requireAuth(async (req, res, params, me) => {
  if (me.email_verified) return sendJson(res, 400, { error: "Email вже підтверджено" });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare("UPDATE users SET verification_code = ? WHERE id = ?").run(code, me.id);
  sendJson(res, 200, { code, note: "Демо-режим: лист не надсилається на реальну пошту, код показано прямо тут" });
}));

route("POST", "/api/me/verify-email", requireAuth(async (req, res, params, me) => {
  const body = await readBody(req);
  const code = (body.code || "").trim();
  const row = db.prepare("SELECT verification_code FROM users WHERE id = ?").get(me.id);
  if (!row.verification_code || row.verification_code !== code) {
    return sendJson(res, 400, { error: "Невірний код підтвердження" });
  }
  db.prepare("UPDATE users SET email_verified = 1, verification_code = NULL WHERE id = ?").run(me.id);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(me.id);
  sendJson(res, 200, { user: publicUser(updated) });
}));

/* ---------------- POSTS ---------------- */

route("GET", "/api/posts", requireAuth(async (req, res, params, me) => {
  const rows = db.prepare("SELECT * FROM posts ORDER BY created_at DESC").all();
  sendJson(res, 200, { posts: rows.map(r => postWithMeta(r, me.id)) });
}));

route("POST", "/api/posts", requireAuth(async (req, res, params, me) => {
  const body = await readBody(req);
  const text = (body.text || "").trim();

  let imageUrl = null;
  if (body.image) {
    imageUrl = saveImageFromDataUrl(body.image);
    if (!imageUrl) {
      return sendJson(res, 400, { error: "Не вдалося завантажити зображення (перевірте формат і розмір — до 6 МБ)" });
    }
  }

  if (!text && !imageUrl) {
    return sendJson(res, 400, { error: "Текст поста не може бути порожнім" });
  }
  const now = Date.now();
  const result = db
    .prepare("INSERT INTO posts (user_id, text, image_url, created_at) VALUES (?, ?, ?, ?)")
    .run(me.id, text, imageUrl, now);
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(result.lastInsertRowid);
  sendJson(res, 201, { post: postWithMeta(row, me.id) });
}));

route("DELETE", "/api/posts/:id", requireAuth(async (req, res, params, me) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(params.id);
  if (!post) return sendJson(res, 404, { error: "Пост не знайдено" });
  if (post.user_id !== me.id && !me.is_admin) return sendJson(res, 403, { error: "Можна видаляти лише свої пости" });
  deleteImageFile(post.image_url);
  db.prepare("DELETE FROM posts WHERE id = ?").run(params.id);
  db.prepare("DELETE FROM likes WHERE post_id = ?").run(params.id);
  db.prepare("DELETE FROM comments WHERE post_id = ?").run(params.id);
  sendJson(res, 200, { ok: true });
}));

route("POST", "/api/posts/:id/like", requireAuth(async (req, res, params, me) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(params.id);
  if (!post) return sendJson(res, 404, { error: "Пост не знайдено" });
  const existing = db.prepare("SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?").get(params.id, me.id);
  if (existing) {
    db.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?").run(params.id, me.id);
  } else {
    db.prepare("INSERT INTO likes (post_id, user_id) VALUES (?, ?)").run(params.id, me.id);
    notify(post.user_id, me.id, "like", post.id);
  }
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(params.id);
  sendJson(res, 200, { post: postWithMeta(row, me.id) });
}));

route("GET", "/api/posts/:id/comments", requireAuth(async (req, res, params) => {
  const rows = db.prepare("SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC").all(params.id);
  const comments = rows.map(c => {
    const author = db.prepare("SELECT * FROM users WHERE id = ?").get(c.user_id);
    return {
      id: c.id,
      text: c.text,
      createdAt: c.created_at,
      author: briefUser(author)
    };
  });
  sendJson(res, 200, { comments });
}));

route("POST", "/api/posts/:id/comments", requireAuth(async (req, res, params, me) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(params.id);
  if (!post) return sendJson(res, 404, { error: "Пост не знайдено" });
  const body = await readBody(req);
  const text = (body.text || "").trim();
  if (!text) return sendJson(res, 400, { error: "Коментар не може бути порожнім" });
  const now = Date.now();
  const result = db.prepare("INSERT INTO comments (post_id, user_id, text, created_at) VALUES (?, ?, ?, ?)").run(params.id, me.id, text, now);
  notify(post.user_id, me.id, "comment", post.id);
  sendJson(res, 201, {
    comment: {
      id: result.lastInsertRowid,
      text,
      createdAt: now,
      author: briefUser(me)
    }
  });
}));

/* ---------------- USERS / MESSAGING ---------------- */

route("GET", "/api/users", requireAuth(async (req, res, params, me) => {
  const parsed = url.parse(req.url, true);
  const q = (parsed.query.q || "").toString().trim().toLowerCase();
  let rows = db.prepare("SELECT * FROM users WHERE id != ? ORDER BY name ASC").all(me.id);
  if (q) {
    rows = rows.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }
  sendJson(res, 200, { users: rows.map(u => Object.assign(publicUser(u), { friendStatus: friendStatus(me.id, u.id) })) });
}));

route("GET", "/api/users/:id", requireAuth(async (req, res, params, me) => {
  const targetId = parseInt(params.id, 10);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
  if (!user) return sendJson(res, 404, { error: "Користувача не знайдено" });
  const postCount = db.prepare("SELECT COUNT(*) AS c FROM posts WHERE user_id = ?").get(targetId).c;
  sendJson(res, 200, {
    user: Object.assign(publicUser(user), {
      postCount,
      friendsCount: friendsCount(targetId),
      friendStatus: friendStatus(me.id, targetId)
    })
  });
}));

route("GET", "/api/users/:id/posts", requireAuth(async (req, res, params, me) => {
  const targetId = parseInt(params.id, 10);
  const rows = db.prepare("SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC").all(targetId);
  sendJson(res, 200, { posts: rows.map(r => postWithMeta(r, me.id)) });
}));

route("GET", "/api/conversations", requireAuth(async (req, res, params, me) => {
  const parsed = url.parse(req.url, true);
  const q = (parsed.query.q || "").toString().trim().toLowerCase();
  const rows = db
    .prepare(
      `SELECT * FROM messages WHERE sender_id = ? OR receiver_id = ? ORDER BY created_at DESC`
    )
    .all(me.id, me.id);

  const seen = new Map();
  for (const m of rows) {
    const otherId = m.sender_id === me.id ? m.receiver_id : m.sender_id;
    if (!seen.has(otherId)) {
      seen.set(otherId, m);
    }
  }
  const conversations = [];
  for (const [otherId, lastMsg] of seen.entries()) {
    const other = db.prepare("SELECT * FROM users WHERE id = ?").get(otherId);
    if (!other) continue;
    if (q && !other.name.toLowerCase().includes(q)) continue;
    const previewText = lastMsg.text || (lastMsg.image_url ? "📷 Фото" : "");
    conversations.push({
      user: briefUser(other),
      lastMessage: { text: previewText, createdAt: lastMsg.created_at, fromMe: lastMsg.sender_id === me.id }
    });
  }
  conversations.sort((a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt);
  sendJson(res, 200, { conversations });
}));

route("GET", "/api/messages/:userId", requireAuth(async (req, res, params, me) => {
  const otherId = parseInt(params.userId, 10);
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at ASC`
    )
    .all(me.id, otherId, otherId, me.id);

  const messages = rows.map(m => {
    const fromMe = m.sender_id === me.id;
    let imageUrl = m.image_url || null;
    let viewOnceConsumed = false;
    if (m.view_once && imageUrl && !fromMe) {
      if (m.viewed_at) {
        imageUrl = null;
        viewOnceConsumed = true;
      } else {
        db.prepare("UPDATE messages SET viewed_at = ? WHERE id = ?").run(Date.now(), m.id);
      }
    }
    return {
      id: m.id,
      text: m.text,
      imageUrl,
      viewOnce: !!m.view_once,
      viewOnceConsumed,
      createdAt: m.created_at,
      fromMe
    };
  });
  sendJson(res, 200, { messages });
}));

route("POST", "/api/messages/:userId", requireAuth(async (req, res, params, me) => {
  const otherId = parseInt(params.userId, 10);
  const other = db.prepare("SELECT * FROM users WHERE id = ?").get(otherId);
  if (!other) return sendJson(res, 404, { error: "Користувача не знайдено" });
  const body = await readBody(req);
  const text = (body.text || "").trim();
  let imageUrl = null;
  if (body.image) {
    imageUrl = saveImageFromDataUrl(body.image);
    if (!imageUrl) return sendJson(res, 400, { error: "Не вдалося завантажити зображення (до 6 МБ, png/jpg/gif/webp)" });
  }
  if (!text && !imageUrl) return sendJson(res, 400, { error: "Повідомлення не може бути порожнім" });
  const viewOnce = body.viewOnce ? 1 : 0;
  const now = Date.now();
  const result = db
    .prepare("INSERT INTO messages (sender_id, receiver_id, text, image_url, view_once, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(me.id, otherId, text, imageUrl, viewOnce, now);
  sendJson(res, 201, {
    message: {
      id: result.lastInsertRowid,
      text,
      imageUrl,
      viewOnce: !!viewOnce,
      viewOnceConsumed: false,
      createdAt: now,
      fromMe: true
    }
  });
}));

/* ---------------- STATIC FILE SERVING ---------------- */

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (err2, fallback) => {
        if (err2) {
          res.writeHead(404);
          return res.end("Not found");
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fallback);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url, true);
    const pathname = decodeURIComponent(parsed.pathname);

    if (pathname.startsWith("/api/")) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = pathname.match(r.regex);
        if (!match) continue;
        const params = {};
        r.paramNames.forEach((name, i) => (params[name] = match[i + 1]));
        try {
          await r.handler(req, res, params);
        } catch (err) {
          console.error(err);
          sendJson(res, 500, { error: "Внутрішня помилка сервера" });
        }
        return;
      }
      return sendJson(res, 404, { error: "Маршрут не знайдено" });
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end("Internal error");
  }
});

server.listen(PORT, () => {
  console.log(`TourLife server running on http://localhost:${PORT}`);
});
