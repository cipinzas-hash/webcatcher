const ALLOW = 'https://cipinzas-hash.github.io';
const MAX_BYTES = 1_500_000, MAX_IMG = 8_000_000, MAX_FILE = 40_000_000, TIMEOUT_MS = 8000, MAX_LINKS = 3000, MAX_REDIRECTS = 4;
const UA = 'Mozilla/5.0 (compatible; WebCatcher/1.0)';
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
  const pick = (s) => { const m = (s || '').split(';')[0].match(/\.([a-z0-9]{1,8})$/i); return m ? m[1].toLowerCase() : ''; };
  let seg = u.pathname.split('/').pop() || '';
  try { seg = decodeURIComponent(seg); } catch {}
  let e = pick(seg);
  if (!e) for (const k of ['filename', 'file', 'name']) { e = pick(u.searchParams.get(k)); if (e) break; }
  return e;
}
function best(set) {
  let top = '', w = -1;
  for (const p of (set || '').split(',')) { const [u, d] = p.trim().split(/\s+/); if (!u) continue; const n = parseFloat(d) || 0; if (n >= w) { w = n; top = u; } }
  return top;
}

const FILE_EXT = /^(png|jpe?g|gif|webp|svg|bmp|avif|mp3|epub|pdf)$/;
const fileType = (ct, url) => {
  const t = ct.split(';')[0].trim().toLowerCase(), e = extOf(url);
  if (/^(image|audio)\//.test(t) || t === 'application/pdf' || t === 'application/epub+zip') return t;
  if (/octet-stream|binary/.test(t) && FILE_EXT.test(e)) return { mp3: 'audio/mpeg', pdf: 'application/pdf', epub: 'application/epub+zip' }[e] || 'image/' + e.replace('jpg', 'jpeg');
  return '';
};

async function download(start, { img = false, referer = '' } = {}) {
  let url = start;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const headers = { 'User-Agent': UA, Accept: img ? '*/*' : 'text/html,application/xhtml+xml' };
    if (referer) headers.Referer = referer;
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const res = await fetch(url, { redirect: 'manual', signal: img ? ac.signal : AbortSignal.timeout(TIMEOUT_MS), headers });
    clearTimeout(tm);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      let next; try { next = new URL(res.headers.get('location'), url); } catch { throw 'fetch_failed'; }
      if (!okUrl(next)) throw 'blocked';
      url = next; continue;
    }
    if (!res.ok) throw 'fetch_failed';
    const ct = res.headers.get('content-type') || '';
    if (img) {
      const type = fileType(ct, url);
      if (!type) throw 'not_file';
      const cap = /^image\//.test(type) ? MAX_IMG : MAX_FILE;
      if (+res.headers.get('content-length') > cap) throw 'too_large';
      return { stream: res.body, type, cap, finalUrl: url };
    }
    if (!/html/i.test(ct)) throw 'not_html';
    const cap = MAX_BYTES, reader = res.body.getReader(), chunks = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) { reader.cancel(); throw 'too_large'; }
      chunks.push(value);
    }
    const buf = new Uint8Array(total); let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    const cs = ct.match(/charset=([\w-]+)/i);
    let html; try { html = new TextDecoder(cs ? cs[1] : 'utf-8').decode(buf); } catch { html = new TextDecoder().decode(buf); }
    return { html, finalUrl: url };
  }
  throw 'fetch_failed';
}

async function extract(html, base) {
  const links = new Map();
  const add = (raw, text, kind) => {
    if (!raw || raw.trim().startsWith('#') || raw.trim().startsWith('data:') || links.size >= MAX_LINKS) return null;
    let u; try { u = new URL(raw.trim(), base); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || links.has(u.href)) return null;
    const e = { href: u.href, text: text || '', host: u.hostname.replace(/^www\./, ''), ext: extOf(u) };
    if (kind) e.kind = kind;
    links.set(u.href, e); return e;
  };
  let cur = null;
  await new HTMLRewriter()
    .on('a[href]', {
      element(el) { cur = add(el.getAttribute('href')); el.onEndTag(() => { if (cur) cur.text = cur.text.replace(/\s+/g, ' ').trim().slice(0, 120); cur = null; }); },
      text(t) { if (cur && cur.text.length < 160) cur.text += t.text; },
    })
    .on('video[src],audio[src],source[src],embed[src]', { element(el) { add(el.getAttribute('src')); } })
    .on('img', { element(el) { for (const a of ['src', 'data-src', 'data-original', 'data-lazy-src']) add(el.getAttribute(a), el.getAttribute('alt') || '', 'img'); } })
    .on('img[srcset],img[data-srcset],source[srcset],source[data-srcset]', { element(el) { add(best(el.getAttribute('srcset') || el.getAttribute('data-srcset')), '', 'img'); } })
    .on('meta[property="og:image"]', { element(el) { add(el.getAttribute('content'), '', 'img'); } })
    .on('[style*="url("]', { element(el) { const m = (el.getAttribute('style') || '').match(/url\(\s*['"]?([^'")]+)/i); if (m) add(m[1], '', 'img'); } })
    .transform(new Response(html, { headers: { 'content-type': 'text/html' } })).text();
  const plain = html.replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
  for (const m of plain.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) add(m[0].replace(/[.,;:]+$/, ''));
  return [...links.values()];
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(req.url).pathname;
    if (req.method !== 'POST' || (path !== '/extract' && path !== '/fetch')) return reply({ error: 'not_found' }, 404);
    if (req.headers.get('Origin') !== ALLOW) return reply({ error: 'forbidden_origin' }, 403);
    const img = path === '/fetch', st = img ? 502 : 200;
    const { success } = await (img ? env.RL2 : env.RL).limit({ key: req.headers.get('CF-Connecting-IP') || 'anon' });
    if (!success) return reply({ error: 'rate_limited' }, 429);
    let body = {};
    try { body = await req.json(); } catch {}
    const target = String(body.url || '');
    let u; try { u = new URL(target); } catch { return fail(target, 'invalid_url', st); }
    if (!/^https?:$/.test(u.protocol)) return fail(target, 'invalid_url', st);
    if (blocked(u.hostname)) return fail(target, 'blocked', st);
    let referer = ''; try { const r = new URL(String(body.referer || '')); if (okUrl(r)) referer = r.href; } catch {}
    try {
      if (img) {
        const { stream, type, cap } = await download(u, { img: true, referer });
        let n = 0;
        const body = stream.pipeThrough(new TransformStream({ transform(c, ctl) { n += c.byteLength; n > cap ? ctl.error(new Error('too_large')) : ctl.enqueue(c); } }));
        return new Response(body, { headers: { ...CORS, 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' } });
      }
      const { html, finalUrl } = await download(u);
      return reply({ url: target, finalUrl: finalUrl.href, ok: true, links: await extract(html, finalUrl), error: null });
    } catch (e) {
      if (typeof e === 'string') return fail(target, e, st);
      return fail(target, e && e.name === 'TimeoutError' ? 'timeout' : 'fetch_failed', st);
    }
  },
};
