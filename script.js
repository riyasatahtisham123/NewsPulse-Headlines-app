/* ============================================================
   NewsPulse — script.js
   News  =  /api/news (server-side keys: NewsAPI → newsdata.io)
   Plus  =  public RSS feeds (rss2json) — dono parallel me fetch hote
            hain aur result merge ho kar ek grid banta hai.
   Local file:// par API nahi chalti, wahan sirf RSS chalta hai.
   ============================================================ */

const TTL = 3 * 60 * 1000;      // cache life per category
const PAGE = 12;                // cards per page (RSS mode)
const RSS_API = 'https://api.rss2json.com/v1/api.json?rss_url=';
const PROXY = 'api/news';       // relative → same host, kaam karta hai Vercel par bhi
const USE_PROXY = location.protocol !== 'file:';

const CATS = [
  { id: 'top', label: 'Top Stories', feeds: [
    ['NDTV', 'https://feeds.feedburner.com/ndtvnews-top-stories'],
    ['Times of India', 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms'],
    ['BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml'] ] },
  { id: 'india', label: 'India', feeds: [
    ['NDTV India', 'https://feeds.feedburner.com/ndtvnews-india-news'],
    ['BBC India', 'https://feeds.bbci.co.uk/news/world/asia/india/rss.xml'] ] },
  { id: 'world', label: 'World', feeds: [
    ['BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
    ['Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'] ] },
  { id: 'tech', label: 'Technology', feeds: [
    ['BBC Tech', 'https://feeds.bbci.co.uk/news/technology/rss.xml'],
    ['TechCrunch', 'https://techcrunch.com/feed/'] ] },
  { id: 'business', label: 'Business', feeds: [
    ['Economic Times', 'https://economictimes.indiatimes.com/rssfeedstopstories.cms'],
    ['BBC Business', 'https://feeds.bbci.co.uk/news/business/rss.xml'] ] },
  { id: 'sports', label: 'Sports', feeds: [
    ['BBC Sport', 'https://feeds.bbci.co.uk/sport/rss.xml'] ] },
  { id: 'science', label: 'Science', feeds: [
    ['NASA', 'https://www.nasa.gov/rss/dyn/breaking_news.rss'],
    ['BBC Science', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'] ] },
  { id: 'entertainment', label: 'Entertainment', feeds: [
    ['BBC Showbiz', 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'] ] },
  { id: 'saved', label: 'Saved', feeds: [] }
];

const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt !== undefined) n.textContent = txt;
  return n;
};

const S = { cat: 'top', items: [], shown: 0, q: '', loading: false, provider: 'rss', meta: '' };
const STORE = {
  read(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
  write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
};
let saved = STORE.read('np_saved', {});

/* ---------- helpers ---------- */
const clean = html => html
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

const clip = (t, n) => t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, '') + '…';
const bigImg = u => u.replace(/\/standard\/(240|304|66)\//, '/standard/768/');
const key = it => it.link.split('#')[0].replace(/[^a-z0-9]/gi, '').slice(-40) || it.title;

function relTime(d) {
  if (!d || isNaN(d)) return '';
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

function notice(msg) { const n = $('#notice'); n.textContent = msg; n.hidden = false; }

const SOURCE_LABEL = { newsapi: 'NewsAPI', newsdata: 'newsdata.io' };
function sourceText() {
  return S.provider === 'rss' ? 'public feeds' : (SOURCE_LABEL[S.provider] || 'news API') + ' + feeds';
}
function paintMeta(n, label, at) {
  S.meta = `${n} headlines · ${label} · ${sourceText()} · updated ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  $('#meta').textContent = S.meta;
}

/* ---------- fetching ---------- */
async function fetchProxy(catId) {
  const res = await fetch(`${PROXY}?cat=${encodeURIComponent(catId)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!data.ok) throw new Error(data.message || 'api error');
  return { items: data.items || [], provider: data.provider || 'api' };
}

async function fetchFeed(name, url, attempt = 0) {
  const res = await fetch(RSS_API + encodeURIComponent(url), { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.status !== 'ok') {
    // rss2json throttles brand-new feeds; one quiet retry usually clears it
    if (attempt < 1) { await new Promise(r => setTimeout(r, 1600)); return fetchFeed(name, url, attempt + 1); }
    throw new Error(data.message || 'feed failed');
  }
  return (data.items || []).map(it => {
    const date = new Date(it.pubDate).getTime();
    const encl = it.enclosure || {};
    const raw = it.thumbnail || encl.link || encl.thumbnail || (it.image && (it.image.url || it.image)) || '';
    const img = typeof raw === 'string' && raw.startsWith('http') ? bigImg(raw) : '';
    return {
      title: clean(it.title),
      link: it.link,
      desc: clip(clean(it.description || ''), 220),
      img,
      src: name,
      tag: name,
      date: isNaN(date) ? 0 : date
    };
  });
}

async function gather(cat, onFail) {
  const all = [];
  for (const [name, url] of cat.feeds) {
    try { all.push(...await fetchFeed(name, url)); }
    catch (e) { onFail(name); }
    await new Promise(r => setTimeout(r, 700));       // stay under the free rate limit
  }
  return all;
}

function dedupe(list) {
  const seen = new Set();
  return list.sort((a, b) => (b.date || 0) - (a.date || 0))
    .filter(it => { const k = key(it); if (!it.title || seen.has(k)) return false; seen.add(k); return true; });
}

async function load(catId, force = false) {
  const cat = CATS.find(c => c.id === catId);
  S.cat = catId; S.q = '';
  $('#q').value = ''; $('#qclear').hidden = true;
  paintCats();
  $('#catTitle').textContent = cat.label;
  $('#catTitle').classList.remove('in'); void $('#catTitle').offsetWidth; $('#catTitle').classList.add('in');

  if (catId === 'saved') return renderSaved();

  const ck = 'np_cache_' + catId;
  const cache = STORE.read(ck, null);
  if (!force && cache && Date.now() - cache.t < TTL && cache.items.length) {
    S.items = cache.items; S.provider = cache.provider || 'rss';
    paintMeta(cache.items.length, cat.label, new Date(cache.t));
    return render();
  }

  S.loading = true;
  $('#refreshBtn').classList.add('go');
  skeletons();
  $('#empty').hidden = true;
  $('#notice').hidden = true;

  const skipped = [];
  let apiItems = [], apiOk = false;

  // API aur feeds parallel me — grid hamesha bhara rahe
  const feedsP = gather(cat, name => skipped.push(name));
  if (USE_PROXY) {
    try { const p = await fetchProxy(catId); apiItems = p.items; apiOk = true; S.provider = p.provider; }
    catch (e) { notice(`News API did not answer (${e.message}) — using public feeds.`); }
  }
  const feedItems = await feedsP;
  if (!apiOk) S.provider = 'rss';

  const items = dedupe(apiOk ? apiItems.concat(feedItems) : feedItems);

  S.loading = false;
  $('#refreshBtn').classList.remove('go');

  if (!items.length) {
    if (cache && cache.items.length) {
      S.items = cache.items; S.provider = cache.provider || 'rss';
      notice('Live news unavailable — showing the last headlines that loaded.');
      paintMeta(cache.items.length, cat.label, new Date(cache.t));
      return render();
    }
    S.items = [];
    $('#grid').innerHTML = ''; $('#heroSlot').innerHTML = ''; $('#more').hidden = true;
    $('#meta').textContent = 'Nothing loaded';
    $('#emptyMsg').textContent = skipped.length
      ? `Could not reach ${skipped.join(', ')}. Public feeds throttle the very first request, so trying once more usually works.`
      : 'No headlines came back for this category.';
    $('#empty').hidden = false;
    return;
  }

  S.items = items;
  STORE.write(ck, { t: Date.now(), items, provider: S.provider });
  if (skipped.length) notice(`Skipped: ${skipped.join(', ')} — feed did not respond this time.`);
  paintMeta(items.length, cat.label, new Date());
  render();
}

/* ---------- rendering ---------- */
function skeletons() {
  const g = $('#grid');
  g.innerHTML = '';
  $('#heroSlot').innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const s = el('div', 'sk');
    s.appendChild(el('div', 'sk-img'));
    s.appendChild(el('div', 'sk-l'));
    s.appendChild(el('div', 'sk-l s'));
    s.style.animationDelay = (i * 60) + 'ms';
    g.appendChild(s);
  }
}

function visible() {
  const q = S.q.toLowerCase();
  return q ? S.items.filter(it => (it.title + ' ' + it.desc + ' ' + it.tag).toLowerCase().includes(q)) : S.items;
}

function render() {
  const list = visible();
  S.shown = Math.min(PAGE, list.length);
  paint(list);
}

function paint(list) {
  const grid = $('#grid'), hero = $('#heroSlot');
  grid.innerHTML = ''; hero.innerHTML = '';
  $('#empty').hidden = list.length > 0;
  if (!list.length) { hero.hidden = true; $('#more').hidden = true; return; }

  const flat = !!S.q || S.cat === 'saved';
  hero.hidden = flat;
  // hero bina image ke adhoora lagta hai — pehle 15 me se photo wali story uthao
  let hi = flat ? -1 : list.findIndex((it, i) => it.img && i < 15);
  if (hi === -1 && !flat) hi = 0;
  const head = flat ? [] : [list[hi]];
  const body = flat ? list : list.filter((_, i) => i !== hi);

  head.forEach(it => hero.appendChild(heroNode(it)));
  body.slice(0, Math.max(0, S.shown - head.length)).forEach((it, i) => {
    const c = cardNode(it);
    c.style.animationDelay = Math.min(i, 12) * 45 + 'ms';
    grid.appendChild(c);
  });

  const drawn = head.length + grid.children.length;
  $('#more').hidden = flat || drawn >= list.length;
}

function heroNode(it) {
  const a = el('a', 'hero');
  a.href = it.link; a.target = '_blank'; a.rel = 'noopener';
  a.appendChild(it.img ? Object.assign(el('img'), { src: it.img, alt: '', loading: 'eager' }) : el('div', 'noimg'));
  a.appendChild(el('div', 'shade'));
  const body = el('div', 'hero-body');
  body.appendChild(el('span', 'kicker', 'Breaking · ' + it.tag));
  body.appendChild(el('h2', '', it.title));
  if (it.desc) body.appendChild(el('p', '', it.desc));
  const foot = el('div', 'hero-foot');
  foot.append(el('span', 'src', it.src), el('span', 'dotsep', '•'), el('span', '', relTime(it.date)), el('span', 'dotsep', '•'), el('span', '', 'Read full story ↗'));
  body.appendChild(foot);
  a.appendChild(body);
  return a;
}

const NEWS_ICO = '<svg viewBox="0 0 24 24"><path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 8h3v9a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12h7M7 15h4"/></svg>';
function placeholder(tag) {
  const p = el('div', 'noimg');
  p.innerHTML = NEWS_ICO;
  p.appendChild(el('span', '', tag));
  return p;
}

function cardNode(it) {
  const k = key(it);
  const art = el('article', 'card');
  const thumb = el('div', 'thumb');
  if (it.img) {
    const img = el('img'); img.src = it.img; img.alt = ''; img.loading = 'lazy';
    img.onerror = () => { img.remove(); thumb.appendChild(placeholder(it.tag)); };
    thumb.appendChild(img);
  } else thumb.appendChild(placeholder(it.tag));

  const btn = el('button', 'save' + (saved[k] ? ' on' : ''));
  btn.setAttribute('aria-label', 'Save story');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4z"/></svg>';
  btn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    saved[k] ? delete saved[k] : (saved[k] = it);
    STORE.write('np_saved', saved);
    btn.classList.toggle('on');
    badge();
    toast(saved[k] ? 'Saved to your list' : 'Removed from saved');
    if (S.cat === 'saved') renderSaved();
  });

  const body = el('div', 'card-body');
  body.appendChild(el('h3', '', it.title));
  if (it.desc) body.appendChild(el('p', '', it.desc));
  const meta = el('div', 'card-meta');
  const tag = el('span', 'src-tag'); tag.append(el('i'), document.createTextNode(it.tag));
  meta.append(tag, el('span', '', relTime(it.date)));
  body.appendChild(meta);

  art.append(el('span', 'strip'), thumb, btn, body);
  art.addEventListener('click', e => {
    if (e.target.closest('.save') || window.getSelection().toString()) return;
    window.open(it.link, '_blank', 'noopener');
  });
  return art;
}

/* ---------- load more (client pages) ---------- */
function more() {
  if (S.loading) return;
  S.shown += PAGE;
  paint(visible());
}

/* ---------- saved ---------- */
function renderSaved() {
  const list = Object.values(saved).sort((a, b) => (b.date || 0) - (a.date || 0));
  S.items = list; S.shown = list.length;
  S.meta = list.length ? `${list.length} saved story${list.length > 1 ? 's' : ''}` : 'Nothing saved yet';
  $('#meta').textContent = S.meta;
  $('#notice').hidden = true;
  $('#empty').hidden = list.length > 0;
  if (!list.length) {
    $('#emptyMsg').textContent = 'Tap the bookmark icon on any story to keep it here — it stays saved in this browser.';
    $('#grid').innerHTML = ''; $('#heroSlot').innerHTML = ''; $('#more').hidden = true;
    return;
  }
  paint(list);
}

function badge() {
  const b = $('#savedCount');
  b.textContent = Object.keys(saved).length;
  b.classList.toggle('on', Object.keys(saved).length > 0);
}

/* ---------- categories ---------- */
function paintCats() {
  const nav = $('#cats');
  nav.innerHTML = '';
  CATS.forEach(c => {
    const b = el('button', 'cat' + (c.id === S.cat ? ' on' : ''));
    b.appendChild(el('span', '', c.label));
    b.addEventListener('click', () => { S.cat !== c.id && load(c.id); scrollTo({ top: 0, behavior: 'smooth' }) });
    nav.appendChild(b);
  });
}

/* ---------- search ---------- */
let deb;
$('#q').addEventListener('input', e => {
  clearTimeout(deb);
  $('#qclear').hidden = !e.target.value;
  deb = setTimeout(() => {
    S.q = e.target.value.trim();
    S.shown = PAGE;
    const list = visible();
    paint(list);
    $('#empty').hidden = list.length > 0;
    if (!S.q) { $('#meta').textContent = S.meta; return; }
    $('#meta').textContent = list.length
      ? `${list.length} match${list.length === 1 ? '' : 'es'} for “${S.q}”`
      : `No match for “${S.q}”`;
    if (!list.length) $('#emptyMsg').textContent = 'Nothing in the loaded headlines matches that word. Try another one.';
  }, 220);
});
$('#qclear').addEventListener('click', () => { $('#q').value = ''; $('#q').dispatchEvent(new Event('input')); $('#q').focus(); });

/* ---------- controls ---------- */
$('#refreshBtn').addEventListener('click', () => { if (!S.loading) load(S.cat, true) });
$('#savedBtn').addEventListener('click', () => load('saved'));
$('#moreBtn').addEventListener('click', more);
document.addEventListener('click', e => { if (e.target.closest('[data-act="retry"]')) load(S.cat, true) });
document.addEventListener('click', e => { if (e.target.closest('[data-act="top"]')) { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }) } });

const root = document.documentElement;
root.dataset.theme = STORE.read('np_theme', 'dark');
$('#themeBtn').addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  STORE.write('np_theme', root.dataset.theme);
});

addEventListener('keydown', e => {
  const typing = /input|textarea/i.test(document.activeElement.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus() }
  if (e.key.toLowerCase() === 'r' && !typing) load(S.cat, true)
  if (e.key === 'Escape' && typing) { $('#q').value = ''; $('#q').dispatchEvent(new Event('input')); $('#q').blur() }
});

addEventListener('scroll', () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  $('#bar').style.width = (max > 0 ? scrollY / max * 100 : 0) + '%';
}, { passive: true });

badge();
paintCats();
load('top');
