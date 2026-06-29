const crypto = require("node:crypto");

const SECRET = process.env.TOURLIFE_SECRET || "tourlife-dev-secret-change-me";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const AVATAR_COLORS = [
  "#7c3aed", "#10b981", "#ef4444", "#f59e0b", "#3b82f6", "#ec4899", "#14b8a6"
];

function pickAvatarColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}

function makeSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function verifyPassword(password, salt, hash) {
  const candidate = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input) {
  input = input.replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) input += "=";
  return Buffer.from(input, "base64").toString("utf8");
}

function sign(payloadObj) {
  const payload = base64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expectedSig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  if (sig !== expectedSig) return null;
  try {
    const data = JSON.parse(base64urlDecode(payload));
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function makeToken(userId) {
  return sign({ userId, exp: Date.now() + TOKEN_TTL_MS });
}

module.exports = {
  hashPassword,
  makeSalt,
  verifyPassword,
  makeToken,
  verifyToken: verify,
  pickAvatarColor
};
