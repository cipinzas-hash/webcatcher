const ALLOW = 'https://cipinzas-hash.github.io';
const MAX_BYTES = 1_500_000, TIMEOUT_MS = 8000, MAX_LINKS = 2000, MAX_REDIRECTS = 4;
const CORS = { 'Access-Control-Allow-Origin': ALLOW, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (url, error, status = 200) => reply({ url, finalUrl: null, ok: false, links: [], error }, status);

function blocked(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || /\.(localhost|local|internal|lan)$/.test(h)) return true;
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) { const a = +m[1], b = +m[2]; return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127); }
  return !h.includes('.');
}
const okUrl = (u) => /^https?:$/.test(u.protocol) && !blocked(u.hostname);

function extOf(u) {
  const pick = (s) => { const m = (s || '').match(/\.([a-z0-9]{1,8})$/i); return m ? m[1].toLowerCase() : ''; };
  let seg = u.pathname.split('/').pop() || '';
  try { seg = decodeURIComponent(seg); } catch {}
  let e = pick(seg);
  if (!e) for (const k of ['filename', 'file', 'name']) { e = pick(u.searchParams.get(k)); if (e) break; }
  return e;
}

async function download(start) {
  let url = start;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WebCatcher/1.0)', Accept: 'text/html,application/xhtml+xml' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      let next; try { next = new URL(res.headers.get('location'), url); } catch { throw 'fetch_failed'; }
      if (!okUrl(next)) throw 'blocked';
      url = next; continue;
    }
    if (!res.ok) throw 'fetch_failed';
    if (!/html/i.test(res.headers.get('content-type') || '')) throw 'not_html';
    const reader = res.body.getReader(), chunks = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) { reader.cancel(); throw 'too_large'; }
      chunks.push(value);
    }
    const buf = new Uint8Array(total); let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    const cs = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i);
    let html; try { html = new TextDecoder(cs ? cs[1] : 'utf-8').decode(buf); } catch { html = new TextDecoder().decode(buf); }
    return { html, finalUrl: url };
  }
  throw 'fetch_failed';
}

async function extract(html, base) {
  const links = new Map();
  const add = (raw, text) => {
    if (!raw || raw.trim().startsWith('#') || links.size >= MAX_LINKS) return null;
    let u; try { u = new URL(raw.trim(), base); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || links.has(u.href)) return null;
    const e = { href: u.href, text: text || '', host: u.hostname.replace(/^www\./, ''), ext: extOf(u) };
    links.set(u.href, e); return e;
  };
  let cur = null;
  await new HTMLRewriter()
    .on('a[href]', {
      element(el) { cur = add(el.getAttribute('href')); el.onEndTag(() => { if (cur) cur.text = cur.text.replace(/\s+/g, ' ').trim().slice(0, 120); cur = null; }); },
      text(t) { if (cur && cur.text.length < 160) cur.text += t.text; },
    })
    .on('video[src],audio[src],source[src],embed[src]', { element(el) { add(el.getAttribute('src')); } })
    .transform(new Response(html, { headers: { 'content-type': 'text/html' } })).text();
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) add(m[0].replace(/&amp;/g, '&').replace(/[.,;:]+$/, ''));
  return [...links.values()];
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(req.url).pathname;
    if (req.method !== 'POST' || path !== '/extract') return reply({ error: 'not_found' }, 404);
    if (req.headers.get('Origin') !== ALLOW) return reply({ error: 'forbidden_origin' }, 403);
    const { success } = await env.RL.limit({ key: req.headers.get('CF-Connecting-IP') || 'anon' });
    if (!success) return reply({ error: 'rate_limited' }, 429);
    let target = '';
    try { target = String((await req.json()).url || ''); } catch {}
    let u; try { u = new URL(target); } catch { return fail(target, 'invalid_url'); }
    if (!/^https?:$/.test(u.protocol)) return fail(target, 'invalid_url');
    if (blocked(u.hostname)) return fail(target, 'blocked');
    try {
      const { html, finalUrl } = await download(u);
      return reply({ url: target, finalUrl: finalUrl.href, ok: true, links: await extract(html, finalUrl), error: null });
    } catch (e) {
      if (typeof e === 'string') return fail(target, e);
      return fail(target, e && e.name === 'TimeoutError' ? 'timeout' : 'fetch_failed');
    }
  },
};
