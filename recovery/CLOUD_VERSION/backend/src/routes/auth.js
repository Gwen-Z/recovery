import express from 'express';
import crypto from 'crypto';
import axios from 'axios';

const clamp = (value, max) => String(value || '').trim().slice(0, max);

const base64Url = (buf) =>
  Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const sha256Hex = (input) => crypto.createHash('sha256').update(String(input)).digest('hex');

const randomToken = (bytes = 32) => base64Url(crypto.randomBytes(bytes));

const getNowIso = () => new Date().toISOString();

const parseCookies = (cookieHeader = '') => {
  const out = {};
  const parts = String(cookieHeader || '')
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean);
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
};

const buildSetCookie = (name, value, options) => {
  const opts = options || {};
  const items = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge != null) items.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.domain) items.push(`Domain=${opts.domain}`);
  if (opts.path) items.push(`Path=${opts.path}`);
  if (opts.expires) items.push(`Expires=${new Date(opts.expires).toUTCString()}`);
  if (opts.httpOnly) items.push('HttpOnly');
  if (opts.secure) items.push('Secure');
  if (opts.sameSite) items.push(`SameSite=${opts.sameSite}`);
  return items.join('; ');
};

const getCookieOptions = () => {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'Lax',
    path: '/'
  };
};

const getFrontendBaseUrl = () => process.env.APP_BASE_URL || 'http://localhost:5173';
// OAuth 回调必须指向“浏览器可访问到 /api 的站点 origin”。
// - 本地开发（Vite 代理 /api）：默认使用 APP_BASE_URL（即 http://localhost:5173）
// - 生产环境：建议显式设置 AUTH_BASE_URL 为公网域名（例如 https://echonotes.com）
const getBackendBaseUrl = () =>
  process.env.AUTH_BASE_URL ||
  getFrontendBaseUrl() ||
  `http://localhost:${process.env.PORT || 3001}`;

const getCookieSecret = () => {
  const secret = process.env.AUTH_COOKIE_SECRET || '';
  if (!secret || secret.length < 16) {
    console.warn('⚠️ AUTH_COOKIE_SECRET 未设置或过短（生产环境必须设置）');
  }
  return secret || 'dev-insecure-secret';
};

const signValue = (raw) => {
  const secret = getCookieSecret();
  const sig = crypto.createHmac('sha256', secret).update(String(raw)).digest();
  return `${raw}.${base64Url(sig)}`;
};

const verifySignedValue = (signed) => {
  const raw = String(signed || '');
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = signValue(payload).slice(payload.length + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try {
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return payload;
};

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const keyLen = 32;
  const N = 16384;
  const r = 8;
  const p = 1;
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLen, { N, r, p }, (err, dk) => {
      if (err) reject(err);
      else resolve(dk);
    });
  });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${Buffer.from(derived).toString('base64')}`;
};

const verifyPassword = async (password, encoded) => {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6) return false;
  const algo = parts[0];
  if (algo !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, { N, r, p }, (err, dk) => {
      if (err) reject(err);
      else resolve(dk);
    });
  });
  try {
    return crypto.timingSafeEqual(Buffer.from(derived), expected);
  } catch {
    return false;
  }
};

const validateEmail = (email) => {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return null;
  if (value.length > 160) return null;
  if (!value.includes('@')) return null;
  return value;
};

const validatePassword = (password) => {
  const value = String(password || '');
  if (value.length < 8) return null;
  if (value.length > 72) return null;
  return value;
};

const sendEmail = async (args) => {
  const to = String(args.to || '').trim();
  const subject = String(args.subject || '').trim();
  const html = String(args.html || '');
  const text = String(args.text || '');
  const from = process.env.RESEND_FROM || '';
  const resendKey = process.env.RESEND_API_KEY || '';

  if (resendKey && from) {
    await axios.post(
      'https://api.resend.com/emails',
      { from, to, subject, html, text },
      { headers: { Authorization: `Bearer ${resendKey}` } }
    );
    return;
  }

  console.log('📧 [dev-mail] 未配置 RESEND_API_KEY/RESEND_FROM，改为控制台输出邮件:');
  console.log({ to, subject, text, html });
};

const createSession = async (db, args) => {
  const rawSid = randomToken(32);
  const sessionHash = sha256Hex(rawSid);
  const id = `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const now = new Date();
  const ttlDays = Number(process.env.AUTH_SESSION_DAYS || 14);
  const expires = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  await db.run(
    `INSERT INTO auth_sessions (id, session_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      sessionHash,
      args.userId,
      now.toISOString(),
      expires.toISOString(),
      now.toISOString(),
      args.ip || null,
      args.userAgent || null
    ]
  );
  return { rawSid, expiresAt: expires.toISOString() };
};

const clearAuthCookie = (res) => {
  const cookieName = process.env.AUTH_COOKIE_NAME || 'sid';
  res.setHeader(
    'Set-Cookie',
    buildSetCookie(cookieName, '', { ...getCookieOptions(), expires: new Date(0), maxAge: 0 })
  );
};

const setAuthCookie = (res, rawSid, expiresAt) => {
  const cookieName = process.env.AUTH_COOKIE_NAME || 'sid';
  const signed = signValue(rawSid);
  res.setHeader(
    'Set-Cookie',
    buildSetCookie(cookieName, signed, {
      ...getCookieOptions(),
      expires: expiresAt
    })
  );
};

const getUserFromRequest = async (db, req) => {
  const cookieName = process.env.AUTH_COOKIE_NAME || 'sid';
  const cookies = parseCookies(req.headers.cookie || '');
  const signed = cookies[cookieName];
  const rawSid = verifySignedValue(signed);
  if (!rawSid) return null;
  const sessionHash = sha256Hex(rawSid);
  const session = await db.get(
    `SELECT * FROM auth_sessions
     WHERE session_hash = ? AND revoked_at IS NULL`,
    [sessionHash]
  );
  if (!session) return null;
  const expiresAt = String(session.expires_at || '');
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return null;
  const user = await db.get(`SELECT id, email, name, email_verified, created_at FROM auth_users WHERE id = ?`, [
    session.user_id
  ]);
  if (!user) return null;
  // touch
  try {
    await db.run(`UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?`, [getNowIso(), session.id]);
  } catch {
    // ignore
  }
  return {
    id: String(user.id),
    email: String(user.email),
    name: user.name ? String(user.name) : null,
    emailVerified: Number(user.email_verified) === 1,
    createdAt: String(user.created_at || '')
  };
};

const upsertUserByEmail = async (db, args) => {
  const email = validateEmail(args.email);
  if (!email) throw new Error('邮箱无效');
  const existing = await db.get(`SELECT * FROM auth_users WHERE email = ?`, [email]);
  if (existing) {
    const nextName = clamp(args.name || existing.name || '', 80) || null;
    await db.run(`UPDATE auth_users SET name = ?, updated_at = ? WHERE id = ?`, [nextName, getNowIso(), existing.id]);
    return { id: String(existing.id), email, name: nextName, emailVerified: Number(existing.email_verified) === 1 };
  }
  const id = `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const name = clamp(args.name || '', 80) || null;
  await db.run(
    `INSERT INTO auth_users (id, email, name, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
    [id, email, name, getNowIso(), getNowIso()]
  );
  return { id, email, name, emailVerified: true };
};

const createToken = async (db, args) => {
  const raw = randomToken(32);
  const tokenHash = sha256Hex(raw);
  const id = `tok_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const now = Date.now();
  const ttlMin =
    args.type === 'password_reset'
      ? Number(process.env.AUTH_RESET_TTL_MIN || 30)
      : Number(process.env.AUTH_VERIFY_TTL_MIN || 60 * 24);
  const expiresAt = new Date(now + ttlMin * 60 * 1000).toISOString();
  await db.run(
    `INSERT INTO auth_tokens (id, user_id, type, token_hash, created_at, expires_at, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, args.userId, args.type, tokenHash, getNowIso(), expiresAt, args.meta ? JSON.stringify(args.meta) : null]
  );
  return { raw, expiresAt };
};

export const initAuthRoutes = (db) => {
  const router = express.Router();

  router.get('/api/auth/me', async (req, res) => {
    try {
      const user = await getUserFromRequest(db, req);
      res.json({ success: true, data: user });
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || 'failed' });
    }
  });

  router.post('/api/auth/register', async (req, res) => {
    try {
      const email = validateEmail(req.body?.email);
      const password = validatePassword(req.body?.password);
      const name = clamp(req.body?.name || '', 80) || null;
      if (!email) return res.status(400).json({ success: false, message: '邮箱无效' });
      if (!password) return res.status(400).json({ success: false, message: '密码至少 8 位' });

      const existing = await db.get(`SELECT id FROM auth_users WHERE email = ?`, [email]);
      if (existing) return res.status(409).json({ success: false, message: '该邮箱已注册' });

      const id = `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const passwordHash = await hashPassword(password);
      const now = getNowIso();
      await db.run(
        `INSERT INTO auth_users (id, email, name, password_hash, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [id, email, name, passwordHash, now, now]
      );

      const token = await createToken(db, { userId: id, type: 'email_verify' });
      const verifyUrl = `${getFrontendBaseUrl()}/auth/verify-email?token=${encodeURIComponent(token.raw)}`;
      await sendEmail({
        to: email,
        subject: '请验证你的邮箱',
        text: `欢迎注册。请打开链接完成邮箱验证：${verifyUrl}`,
        html: `<p>欢迎注册。</p><p>请点击链接完成邮箱验证：</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`
      });

      res.json({ success: true, message: '注册成功，请验证邮箱后登录' });
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || '注册失败' });
    }
  });

  router.post('/api/auth/login', async (req, res) => {
    try {
      const email = validateEmail(req.body?.email);
      const password = String(req.body?.password || '');
      if (!email) return res.status(400).json({ success: false, message: '邮箱无效' });
      if (!password) return res.status(400).json({ success: false, message: '请输入密码' });

      const user = await db.get(`SELECT * FROM auth_users WHERE email = ?`, [email]);
      if (!user?.id) return res.status(401).json({ success: false, message: '邮箱或密码错误' });
      if (!user.password_hash) return res.status(401).json({ success: false, message: '该账号请使用第三方登录' });

      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) return res.status(401).json({ success: false, message: '邮箱或密码错误' });
      if (Number(user.email_verified) !== 1) {
        return res.status(403).json({ success: false, code: 'EMAIL_NOT_VERIFIED', message: '请先验证邮箱' });
      }

      const session = await createSession(db, {
        userId: user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] || ''
      });
      setAuthCookie(res, session.rawSid, session.expiresAt);
      await db.run(`UPDATE auth_users SET last_login_at = ?, updated_at = ? WHERE id = ?`, [
        getNowIso(),
        getNowIso(),
        user.id
      ]);

      res.json({ success: true, data: { id: user.id, email: user.email, name: user.name || null } });
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || '登录失败' });
    }
  });

  router.post('/api/auth/logout', async (req, res) => {
    try {
      const cookieName = process.env.AUTH_COOKIE_NAME || 'sid';
      const cookies = parseCookies(req.headers.cookie || '');
      const signed = cookies[cookieName];
      const rawSid = verifySignedValue(signed);
      if (rawSid) {
        const sessionHash = sha256Hex(rawSid);
        await db.run(`UPDATE auth_sessions SET revoked_at = ? WHERE session_hash = ?`, [getNowIso(), sessionHash]);
      }
    } catch {
      // ignore
    }
    clearAuthCookie(res);
    res.json({ success: true });
  });

  router.post('/api/auth/email/resend', async (req, res) => {
    try {
      const email = validateEmail(req.body?.email);
      if (!email) return res.status(400).json({ success: false, message: '邮箱无效' });
      const user = await db.get(`SELECT id, email_verified FROM auth_users WHERE email = ?`, [email]);
      if (!user?.id) return res.json({ success: true, message: '如果账号存在，验证邮件已发送' });
      if (Number(user.email_verified) === 1) return res.json({ success: true, message: '邮箱已验证' });

      const token = await createToken(db, { userId: user.id, type: 'email_verify' });
      const verifyUrl = `${getFrontendBaseUrl()}/auth/verify-email?token=${encodeURIComponent(token.raw)}`;
      await sendEmail({
        to: email,
        subject: '重新发送：验证你的邮箱',
        text: `请打开链接完成邮箱验证：${verifyUrl}`,
        html: `<p>请点击链接完成邮箱验证：</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`
      });
      res.json({ success: true, message: '验证邮件已发送' });
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || '发送失败' });
    }
  });

  router.post('/api/auth/verify-email', async (req, res) => {
    try {
      const token = String(req.body?.token || '').trim();
      if (!token) return res.status(400).json({ success: false, message: '缺少 token' });
      const tokenHash = sha256Hex(token);
      const row = await db.get(
        `SELECT * FROM auth_tokens WHERE token_hash = ? AND type = 'email_verify' AND used_at IS NULL`,
        [tokenHash]
      );
      if (!row?.id) return res.status(400).json({ success: false, message: '链接无效或已使用' });
      if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
        return res.status(400).json({ success: false, message: '链接已过期，请重新发送' });
      }
      await db.run(`UPDATE auth_tokens SET used_at = ? WHERE id = ?`, [getNowIso(), row.id]);
      await db.run(`UPDATE auth_users SET email_verified = 1, updated_at = ? WHERE id = ?`, [getNowIso(), row.user_id]);
      res.json({ success: true, message: '邮箱验证成功' });
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || '验证失败' });
    }
  });

  router.post('/api/auth/password/request', async (req, res) => {
    try {
      const email = validateEmail(req.body?.email);
      if (!email) return res.status(400).json({ success: false, message: '邮箱无效' });
      const user = await db.get(`SELECT id FROM auth_users WHERE email = ?`, [email]);
      if (!user?.id) return res.json({ success: true, message: '如果账号存在，重置邮件已发送' });

      const token = await createToken(db, { userId: user.id, type: 'password_reset' });
      const resetUrl = `${getFrontendBaseUrl()}/auth/reset-password?token=${encodeURIComponent(token.raw)}`;
      await sendEmail({
        to: email,
        subject: '重置你的密码',
        text: `请打开链接重置密码（30 分钟内有效）：${resetUrl}`,
        html: `<p>请点击链接重置密码（30 分钟内有效）：</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
      });
      res.json({ success: true, message: '重置邮件已发送' });
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || '发送失败' });
    }
  });

  router.post('/api/auth/password/reset', async (req, res) => {
    try {
      const token = String(req.body?.token || '').trim();
      const newPassword = validatePassword(req.body?.newPassword);
      if (!token) return res.status(400).json({ success: false, message: '缺少 token' });
      if (!newPassword) return res.status(400).json({ success: false, message: '新密码至少 8 位' });
      const tokenHash = sha256Hex(token);
      const row = await db.get(
        `SELECT * FROM auth_tokens WHERE token_hash = ? AND type = 'password_reset' AND used_at IS NULL`,
        [tokenHash]
      );
      if (!row?.id) return res.status(400).json({ success: false, message: '链接无效或已使用' });
      if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
        return res.status(400).json({ success: false, message: '链接已过期，请重新发送' });
      }
      const passwordHash = await hashPassword(newPassword);
      await db.run(`UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?`, [
        passwordHash,
        getNowIso(),
        row.user_id
      ]);
      await db.run(`UPDATE auth_tokens SET used_at = ? WHERE id = ?`, [getNowIso(), row.id]);
      await db.run(`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ?`, [getNowIso(), row.user_id]);
      res.json({ success: true, message: '密码已重置，请重新登录' });
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || '重置失败' });
    }
  });

  router.get('/api/auth/oauth/google', async (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const redirectUri = `${getBackendBaseUrl()}/api/auth/oauth/google/callback`;
    if (!clientId) return res.status(500).send('Missing GOOGLE_CLIENT_ID');
    const state = randomToken(24);
    res.setHeader(
      'Set-Cookie',
      buildSetCookie('oauth_state_google', signValue(state), {
        ...getCookieOptions(),
        maxAge: 10 * 60
      })
    );
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  router.get('/api/auth/oauth/google/callback', async (req, res) => {
    try {
      const code = String(req.query?.code || '');
      const state = String(req.query?.state || '');
      const cookies = parseCookies(req.headers.cookie || '');
      const signed = cookies['oauth_state_google'];
      const expectedState = verifySignedValue(signed);
      if (!expectedState || expectedState !== state) {
        return res.redirect(`${getFrontendBaseUrl()}/auth/callback?success=0&provider=google&reason=bad_state`);
      }

      const clientId = process.env.GOOGLE_CLIENT_ID || '';
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
      const redirectUri = `${getBackendBaseUrl()}/api/auth/oauth/google/callback`;
      if (!clientId || !clientSecret) {
        return res.redirect(`${getFrontendBaseUrl()}/auth/callback?success=0&provider=google&reason=missing_config`);
      }
      const tokenResp = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        }).toString(),
        { headers: { 'content-type': 'application/x-www-form-urlencoded' } }
      );
      const accessToken = tokenResp.data?.access_token;
      const userInfoResp = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const providerUserId = String(userInfoResp.data?.sub || '');
      const email = String(userInfoResp.data?.email || '');
      const name = String(userInfoResp.data?.name || '');
      if (!providerUserId) {
        return res.redirect(`${getFrontendBaseUrl()}/auth/callback?success=0&provider=google&reason=no_sub`);
      }

      let user = null;
      const account = await db.get(
        `SELECT * FROM auth_oauth_accounts WHERE provider = 'google' AND provider_user_id = ?`,
        [providerUserId]
      );
      if (account?.user_id) {
        const u = await db.get(`SELECT id, email, name, email_verified FROM auth_users WHERE id = ?`, [account.user_id]);
        if (u?.id) user = { id: u.id };
      }
      if (!user) {
        const upserted = await upsertUserByEmail(db, { email, name });
        user = { id: upserted.id };
        const accountId = `oa_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        await db.run(
          `INSERT OR IGNORE INTO auth_oauth_accounts (id, user_id, provider, provider_user_id, provider_email, provider_name, created_at, updated_at)
           VALUES (?, ?, 'google', ?, ?, ?, ?, ?)`,
          [accountId, user.id, providerUserId, email || null, name || null, getNowIso(), getNowIso()]
        );
      }

      const session = await createSession(db, { userId: user.id, ip: req.ip, userAgent: req.headers['user-agent'] || '' });
      setAuthCookie(res, session.rawSid, session.expiresAt);
      res.redirect(`${getFrontendBaseUrl()}/auth/callback?success=1&provider=google`);
    } catch (e) {
      res.redirect(`${getFrontendBaseUrl()}/auth/callback?success=0&provider=google&reason=exception`);
    }
  });

  router.get('/api/auth/oauth/wechat', async (req, res) => {
    const appId = process.env.WECHAT_APP_ID || '';
    const redirectUri = `${getBackendBaseUrl()}/api/auth/oauth/wechat/callback`;
    if (!appId) return res.status(500).send('Missing WECHAT_APP_ID');
    const state = randomToken(24);
    res.setHeader(
      'Set-Cookie',
      buildSetCookie('oauth_state_wechat', signValue(state), { ...getCookieOptions(), maxAge: 10 * 60 })
    );
    const params = new URLSearchParams({
      appid: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'snsapi_login',
      state
    });
    res.redirect(`https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`);
  });

  router.get('/api/auth/oauth/wechat/callback', async (req, res) => {
    try {
      const code = String(req.query?.code || '');
      const state = String(req.query?.state || '');
      const cookies = parseCookies(req.headers.cookie || '');
      const signed = cookies['oauth_state_wechat'];
      const expectedState = verifySignedValue(signed);
      if (!expectedState || expectedState !== state) {
        return res.redirect(`${getFrontendBaseUrl()}/auth/callback?success=0&provider=wechat&reason=bad_state`);
      }

      const appId = process.env.WECHAT_APP_ID || '';
      const secret = process.env.WECHAT_APP_SECRET || '';
      if (!appId || !secret) {
        return res.redirect(`${getFrontendBaseUrl()}/auth/callback?success=0&provider=wechat&reason=missing_config`);
      }
      const tokenResp = await axios.get('https://api.weixin.qq.com/sns/oauth2/access_token', {
        params: { appid: appId, secret, code, grant_type: 'authorization_code' }
      });
      const accessToken = tokenResp.data?.access_token;
      const openid = tokenResp.data?.openid;
      if (!accessToken || !openid) {
        return res.redirect(`${getFrontendBaseUrl()}/auth/callback?success=0&provider=wechat&reason=no_token`);
      }
      const userInfoResp = await axios.get('https://api.weixin.qq.com/sns/userinfo', {
        params: { access_token: accessToken, openid }
      });
      const providerUserId = String(userInfoResp.data?.openid || openid);
      const nickname = String(userInfoResp.data?.nickname || '');
      // 微信可能拿不到 email，这里用占位 email（用户可后续绑定）
      const pseudoEmail = `${providerUserId}@wechat.local`;

      let user = null;
      const account = await db.get(
        `SELECT * FROM auth_oauth_accounts WHERE provider = 'wechat' AND provider_user_id = ?`,
        [providerUserId]
      );
      if (account?.user_id) {
        const u = await db.get(`SELECT id FROM auth_users WHERE id = ?`, [account.user_id]);
        if (u?.id) user = { id: u.id };
      }
      if (!user) {
        const upserted = await upsertUserByEmail(db, { email: pseudoEmail, name: nickname });
        user = { id: upserted.id };
        const accountId = `oa_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        await db.run(
          `INSERT OR IGNORE INTO auth_oauth_accounts (id, user_id, provider, provider_user_id, provider_email, provider_name, created_at, updated_at)
           VALUES (?, ?, 'wechat', ?, ?, ?, ?, ?)`,
          [accountId, user.id, providerUserId, null, nickname || null, getNowIso(), getNowIso()]
        );
      }

      const session = await createSession(db, { userId: user.id, ip: req.ip, userAgent: req.headers['user-agent'] || '' });
      setAuthCookie(res, session.rawSid, session.expiresAt);
      res.redirect(`${getFrontendBaseUrl()}/auth/callback?success=1&provider=wechat`);
    } catch (e) {
      res.redirect(`${getFrontendBaseUrl()}/auth/callback?success=0&provider=wechat&reason=exception`);
    }
  });

  return router;
};
