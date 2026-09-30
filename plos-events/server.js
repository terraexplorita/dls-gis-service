import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataPath = path.join(__dirname, 'events.json');
const PORT = process.env.PORT || 3000;
const DEFAULT_INVITEE = process.env.DEFAULT_INVITEE || 'sflourentzou@gmail.com';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

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

async function getAccessToken() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Google Calendar OAuth is not configured on the server.');
  }
  const form = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: GOOGLE_REFRESH_TOKEN,
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

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
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

    if (u.pathname === '/api/health') return json(res, 200, { ok: true, calendarConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) });

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

server.listen(PORT, () => console.log(`PLOS Events listening on ${PORT}`));
