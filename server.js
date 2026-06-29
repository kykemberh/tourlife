const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const url = require("node:url");
const db = require("./db");
const { hashPassword, makeSalt, verifyPassword, makeToken, verifyToken, pickAvatarColor } = require("./auth");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 2_000_000) {
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
    bio: row.bio || "",
    createdAt: row.created_at
  };
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
    createdAt: row.created_at,
    likeCount,
    likedByMe,
    commentCount,
    author: author ? { id: author.id, name: author.name, avatarColor: author.avatar_color, initials: initials(author.name) } : null
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
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  sendJson(res, 201, { token, user: publicUser(user) });
});

route("POST", "/api/login", async (req, res) => {
  const body = await readBody(req);
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return sendJson(res, 401, { error: "Неправильний email або пароль" });
  }
  const token = makeToken(user.id);
  sendJson(res, 200, { token, user: publicUser(user) });
});

route("GET", "/api/me", requireAuth(async (req, res, params, me) => {
  sendJson(res, 200, { user: publicUser(me) });
}));

/* ---------------- POSTS ---------------- */

route("GET", "/api/posts", requireAuth(async (req, res, params, me) => {
  const rows = db.prepare("SELECT * FROM posts ORDER BY created_at DESC").all();
  sendJson(res, 200, { posts: rows.map(r => postWithMeta(r, me.id)) });
}));

route("POST", "/api/posts", requireAuth(async (req, res, params, me) => {
  const body = await readBody(req);
  const text = (body.text || "").trim();
  if (!text) return sendJson(res, 400, { error: "Текст поста не може бути порожнім" });
  const now = Date.now();
  const result = db.prepare("INSERT INTO posts (user_id, text, created_at) VALUES (?, ?, ?)").run(me.id, text, now);
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(result.lastInsertRowid);
  sendJson(res, 201, { post: postWithMeta(row, me.id) });
}));

route("DELETE", "/api/posts/:id", requireAuth(async (req, res, params, me) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(params.id);
  if (!post) return sendJson(res, 404, { error: "Пост не знайдено" });
  if (post.user_id !== me.id) return sendJson(res, 403, { error: "Можна видаляти лише свої пости" });
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
      author: author ? { id: author.id, name: author.name, avatarColor: author.avatar_color, initials: initials(author.name) } : null
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
  sendJson(res, 201, {
    comment: {
      id: result.lastInsertRowid,
      text,
      createdAt: now,
      author: { id: me.id, name: me.name, avatarColor: me.avatar_color, initials: initials(me.name) }
    }
  });
}));

/* ---------------- USERS / MESSAGING ---------------- */

route("GET", "/api/users", requireAuth(async (req, res, params, me) => {
  const rows = db.prepare("SELECT * FROM users WHERE id != ? ORDER BY name ASC").all(me.id);
  sendJson(res, 200, { users: rows.map(publicUser) });
}));

route("GET", "/api/conversations", requireAuth(async (req, res, params, me) => {
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
    conversations.push({
      user: { id: other.id, name: other.name, avatarColor: other.avatar_color, initials: initials(other.name) },
      lastMessage: { text: lastMsg.text, createdAt: lastMsg.created_at, fromMe: lastMsg.sender_id === me.id }
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
  sendJson(res, 200, {
    messages: rows.map(m => ({
      id: m.id,
      text: m.text,
      createdAt: m.created_at,
      fromMe: m.sender_id === me.id
    }))
  });
}));

route("POST", "/api/messages/:userId", requireAuth(async (req, res, params, me) => {
  const otherId = parseInt(params.userId, 10);
  const other = db.prepare("SELECT * FROM users WHERE id = ?").get(otherId);
  if (!other) return sendJson(res, 404, { error: "Користувача не знайдено" });
  const body = await readBody(req);
  const text = (body.text || "").trim();
  if (!text) return sendJson(res, 400, { error: "Повідомлення не може бути порожнім" });
  const now = Date.now();
  const result = db
    .prepare("INSERT INTO messages (sender_id, receiver_id, text, created_at) VALUES (?, ?, ?, ?)")
    .run(me.id, otherId, text, now);
  sendJson(res, 201, { message: { id: result.lastInsertRowid, text, createdAt: now, fromMe: true } });
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
