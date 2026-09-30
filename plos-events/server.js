import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataPath = path.join(__dirname, 'events.json');
const PORT = process.env.PORT || 3000;
const DEFAULT_INVITEE = process.env.DEFAULT_INVITEE || 'sflourentzou@gmail.com';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readEvents() {
  try { return JSON.parse(fs.readFileSync(dataPath, 'utf8')); }
  catch { return []; }
}

function safePublicPath(urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.normalize(path.join(publicDir, rel));
  return full.startsWith(publicDir) ? full : null;
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function ensureDb() {
  if (!pool) return;
  await pool.query(`create table if not exists plos_settings (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
  )`);
}

async function getSetting(key) {
  if (!pool) return null;
  await ensureDb();
  const r = await pool.query('select value from plos_settings where key=$1', [key]);
  return r.rows[0]?.value || null;
}

async function setSetting(key, value) {
  if (!pool) throw new Error('DATABASE_URL is not configured.');
  await ensureDb();
  await pool.query(`insert into plos_settings(key,value,updated_at) values($1,$2,now())
    on conflict(key) do update set value=excluded.value, updated_at=now()`, [key, value]);
}

function publicBase(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers.host}`;
}

async function getRefreshToken() {
  if (process.env.GOOGLE_REFRESH_TOKEN) return process.env.GOOGLE_REFRESH_TOKEN;
  return await getSetting('google_refresh_token');
}

async function getAccessToken() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  const refreshToken = await getRefreshToken();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !refreshToken) {
    throw new Error('Google Calendar OAuth is not connected.');
  }
  const form = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(data.error_description || data.error || 'OAuth refresh failed');
  return data.access_token;
}

async function gcal(pathname, options = {}) {
  const token = await getAccessToken();
  const r = await fetch(`https://www.googleapis.com/calendar/v3${pathname}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.error?.message || `Google Calendar API ${r.status}`);
  return data;
}

function eventToGoogle(e, invitee, sendInvite) {
  const body = {
    summary: e.title,
    location: e.location || '',
    description: [e.description || '', e.originalSource ? `Original source: ${e.originalSource}` : ''].filter(Boolean).join('\n\n'),
    extendedProperties: { private: { PLOS_EVENT_ID: String(e.id) } }
  };
  if (e.allDay) {
    body.start = { date: e.startDate };
    body.end = { date: e.endDate || nextDate(e.startDate) };
  } else {
    body.start = { dateTime: e.startDateTime, timeZone: 'Europe/Nicosia' };
    body.end = { dateTime: e.endDateTime || addHours(e.startDateTime, 2), timeZone: 'Europe/Nicosia' };
  }
  if (sendInvite && e.inviteAllowed !== false && invitee) body.attendees = [{ email: invitee }];
  return body;
}

function nextDate(d) {
  const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0,10);
}
function addHours(dt, hours) { return new Date(new Date(dt).getTime() + hours * 3600000).toISOString(); }

async function findCalendarEventByPlosId(id) {
  const params = new URLSearchParams({ privateExtendedProperty: `PLOS_EVENT_ID=${id}`, maxResults: '10', singleEvents: 'true' });
  const data = await gcal(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`);
  return (data.items || []).find(x => x.status !== 'cancelled') || null;
}

async function addOne(e, sendInvite, invitee) {
  const existing = await findCalendarEventByPlosId(e.id);
  if (existing) return { eventId: existing.id, htmlLink: existing.htmlLink, alreadyExists: true };
  const body = eventToGoogle(e, invitee, sendInvite);
  const q = new URLSearchParams({ sendUpdates: sendInvite && e.inviteAllowed !== false ? 'all' : 'none' });
  const created = await gcal(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${q}`, { method: 'POST', body: JSON.stringify(body) });
  return { eventId: created.id, htmlLink: created.htmlLink, alreadyExists: false };
}

async function deleteOne(e) {
  const found = await findCalendarEventByPlosId(e.id);
  if (!found) return { deleted: false, reason: 'not_found' };
  await gcal(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(found.id)}?sendUpdates=all`, { method: 'DELETE' });
  return { deleted: true };
}

async function inviteOne(e, invitee) {
  if (e.inviteAllowed === false) return { invited: false, reason: 'invite_not_allowed' };
  const found = await findCalendarEventByPlosId(e.id);
  if (!found) return { invited: false, reason: 'not_in_calendar' };
  const attendees = (found.attendees || []).filter(a => (a.email || '').toLowerCase() !== invitee.toLowerCase());
  attendees.push({ email: invitee });
  const patched = await gcal(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(found.id)}?sendUpdates=all`, {
    method: 'PATCH', body: JSON.stringify({ attendees })
  });
  return { invited: true, eventId: patched.id };
}

function getByIds(ids) {
  const map = new Map(readEvents().map(e => [String(e.id), e]));
  return ids.map(id => map.get(String(id))).filter(Boolean);
}

async function oauthStart(req, res) {
  const { GOOGLE_CLIENT_ID } = process.env;
  if (!GOOGLE_CLIENT_ID) return json(res, 503, { ok: false, error: 'GOOGLE_CLIENT_ID is not configured on Render.' });
  const redirectUri = `${publicBase(req)}/oauth/callback`;
  const state = crypto.randomUUID();
  if (pool) await setSetting('oauth_state', state);
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  res.writeHead(302, { location: `https://accounts.google.com/o/oauth2/v2/auth?${p}` });
  res.end();
}

async function oauthCallback(req, res, u) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new Error('Google OAuth client credentials are not configured.');
  if (u.searchParams.get('error')) throw new Error(`Google OAuth error: ${u.searchParams.get('error')}`);
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code) throw new Error('Missing OAuth code.');
  if (pool) {
    const expected = await getSetting('oauth_state');
    if (!expected || expected !== state) throw new Error('OAuth state mismatch.');
  }
  const redirectUri = `${publicBase(req)}/oauth/callback`;
  const form = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error_description || data.error || 'OAuth exchange failed');
  if (data.refresh_token) await setSetting('google_refresh_token', data.refresh_token);
  else if (!(await getRefreshToken())) throw new Error('Google did not return a refresh token. Revoke access and reconnect with consent.');
  res.writeHead(302, { location: '/?connected=1' });
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);

    if (u.pathname === '/oauth/start' && req.method === 'GET') return oauthStart(req, res);
    if (u.pathname === '/oauth/callback' && req.method === 'GET') return oauthCallback(req, res, u);

    if (u.pathname === '/api/events' && req.method === 'GET') return json(res, 200, { events: readEvents(), defaultInvitee: DEFAULT_INVITEE });

    if (u.pathname === '/api/status' && req.method === 'POST') {
      const { ids = [] } = await readBody(req);
      const out = {};
      for (const e of getByIds(ids)) {
        const found = await findCalendarEventByPlosId(e.id);
        out[e.id] = found ? { inCalendar: true, calendarEventId: found.id, htmlLink: found.htmlLink, attendees: found.attendees || [] } : { inCalendar: false };
      }
      return json(res, 200, out);
    }

    if (u.pathname === '/api/add' && req.method === 'POST') {
      const { ids = [], invite = {}, invitee = DEFAULT_INVITEE } = await readBody(req);
      const results = {};
      for (const e of getByIds(ids)) results[e.id] = await addOne(e, Boolean(invite[e.id]), invitee);
      return json(res, 200, { ok: true, results });
    }

    if (u.pathname === '/api/delete' && req.method === 'POST') {
      const { ids = [] } = await readBody(req);
      const results = {};
      for (const e of getByIds(ids)) results[e.id] = await deleteOne(e);
      return json(res, 200, { ok: true, results });
    }

    if (u.pathname === '/api/invite' && req.method === 'POST') {
      const { ids = [], invitee = DEFAULT_INVITEE } = await readBody(req);
      const results = {};
      for (const e of getByIds(ids)) results[e.id] = await inviteOne(e, invitee);
      return json(res, 200, { ok: true, results });
    }

    if (u.pathname === '/api/health') {
      let connected = false;
      try { connected = Boolean(await getRefreshToken()); } catch {}
      return json(res, 200, {
        ok: true,
        databaseConfigured: Boolean(pool),
        oauthClientConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        calendarConnected: connected
      });
    }

    const file = safePublicPath(u.pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    const type = ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    json(res, 500, { ok: false, error: err.message || String(err) });
  }
});

server.listen(PORT, async () => {
  try { await ensureDb(); } catch (e) { console.error('DB init failed:', e.message); }
  console.log(`PLOS Events listening on ${PORT}`);
});
