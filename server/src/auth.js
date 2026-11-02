// 轻量账号体系：scrypt 口令哈希 + 持久化会话令牌
const crypto = require('crypto');
const store = require('./store');

function hashPassword(pwd, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  return { salt, hash };
}

function verifyPassword(pwd, salt, hash) {
  const h = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}

function usersDb() {
  return store.load('users', { users: [], sessions: {} });
}

function ensureAdmin() {
  const db = usersDb();
  if (!db.users.some(u => u.role === 'admin')) {
    const { salt, hash } = hashPassword('Admin@123');
    db.users.push({
      id: 'u-admin', username: 'admin', role: 'admin', salt, hash,
      displayName: '平台管理员', createdAt: new Date().toISOString()
    });
    store.save('users', db);
  }
}

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, displayName: u.displayName, createdAt: u.createdAt };
}

function createSession(userId) {
  const db = usersDb();
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { userId, expiresAt: Date.now() + 7 * 24 * 3600 * 1000 };
  // 清理过期会话
  for (const [t, s] of Object.entries(db.sessions)) {
    if (s.expiresAt < Date.now()) delete db.sessions[t];
  }
  store.save('users', db);
  return token;
}

function userFromToken(token) {
  if (!token) return null;
  const db = usersDb();
  const sess = db.sessions[token];
  if (!sess || sess.expiresAt < Date.now()) return null;
  return db.users.find(u => u.id === sess.userId) || null;
}

// Express 中间件
function tokenFromReq(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || null);
}
function authOptional(req, _res, next) {
  req.user = userFromToken(tokenFromReq(req));
  next();
}
function authRequired(req, res, next) {
  req.user = userFromToken(tokenFromReq(req));
  if (!req.user) return res.status(401).json({ error: '请先登录账号' });
  next();
}
function adminRequired(req, res, next) {
  req.user = userFromToken(tokenFromReq(req));
  if (!req.user) return res.status(401).json({ error: '请先登录管理员账号' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可访问' });
  next();
}

function registerRoutes(app) {
  app.post('/api/auth/register', (req, res) => {
    const { username, password, displayName } = req.body || {};
    if (!username || !/^[a-zA-Z0-9_\u4e00-\u9fa5]{3,20}$/.test(username)) {
      return res.status(400).json({ error: '用户名须为3~20位字母、数字、下划线或中文' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: '密码长度至少6位' });
    }
    const db = usersDb();
    if (db.users.some(u => u.username === username)) {
      return res.status(400).json({ error: '该用户名已被注册' });
    }
    const { salt, hash } = hashPassword(password);
    const user = {
      id: 'u-' + crypto.randomBytes(8).toString('hex'), username, role: 'user',
      displayName: displayName || username, salt, hash, createdAt: new Date().toISOString()
    };
    db.users.push(user);
    store.save('users', db);
    const token = createSession(user.id);
    res.json({ token, user: publicUser(user) });
  });

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const db = usersDb();
    const user = db.users.find(u => u.username === username);
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      return res.status(400).json({ error: '用户名或密码错误' });
    }
    const token = createSession(user.id);
    res.json({ token, user: publicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = tokenFromReq(req);
    if (token) {
      const db = usersDb();
      delete db.sessions[token];
      store.save('users', db);
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', authOptional, (req, res) => {
    res.json({ user: req.user ? publicUser(req.user) : null });
  });
}

module.exports = { registerRoutes, authOptional, authRequired, adminRequired, ensureAdmin, publicUser };
