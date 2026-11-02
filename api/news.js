/* ============================================================
   api/news.js — Vercel serverless function
   Yeh file browser me KABHI download nahi hoti, isliye API keys
   yahan safe hain. Front-end sirf /api/news?cat=tech maangta hai.

   Order:  1) NewsAPI.org  →  2) newsdata.io  →  3) client RSS feeds
   ============================================================ */

// Vercel → Settings → Environment Variables me inko daal sakte ho;
// na daalo to neeche wali keys chalti hain (sirf server par rehti hain).
const NEWSAPI_KEY   = process.env.NEWSAPI_KEY  || 'be7e9ee3c8b84f1c94ca94b5da28c874';
const NEWSDATA_KEY  = process.env.NEWSDATA_KEY || 'pub_427cb22865c34f7cae0ccd76ca675c8c';

const CATS = {
  top:           { na: { sources: 'bbc-news,al-jazeera-english,the-hindu' }, nd: {} },
  india:         { na: { q: 'india' },                                      nd: { country: 'in' } },
  world:         { na: { q: 'world OR international OR global' },           nd: { category: 'politics' } },
  tech:          { na: { q: 'technology OR AI OR app OR gadget' },          nd: { category: 'technology' } },
  business:      { na: { q: 'business OR economy OR stock OR market' },     nd: { category: 'business' } },
  sports:        { na: { q: 'sports OR cricket OR football OR tennis' },   nd: { category: 'sports' } },
  science:       { na: { q: 'science OR space OR research OR NASA' },       nd: { category: 'science' } },
  entertainment: { na: { q: 'movie OR entertainment OR music OR celebrity' }, nd: { category: 'entertainment' } }
};

const clip = (t, n) => {
  t = (t || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, '') + '…';
};
const stamp = s => { const t = Date.parse(s); return isNaN(t) ? 0 : t; };

/* ---- provider 1: newsapi.org ---- */
async function fromNewsApi(cat) {
  const p = CATS[cat].na;
  const q = new URLSearchParams({ pageSize: '30', language: 'en', ...p, apiKey: NEWSAPI_KEY });
  const url = p.sources
    ? 'https://newsapi.org/v2/top-headlines?' + q
    : 'https://newsapi.org/v2/everything?' + new URLSearchParams([ ...q, ['sortBy', 'publishedAt'] ]);

  const data = await (await fetch(url)).json();
  if (data.status !== 'ok' || !Array.isArray(data.articles)) {
    throw new Error((data.errors && data.errors[0] && data.errors[0].message) || data.message || 'newsapi error');
  }
  return data.articles.filter(a => a.title && a.url).map(a => ({
    title: clip(a.title, 160),
    link: a.url,
    desc: clip(a.description || a.content || '', 220),
    img: a.urlToImage || '',
    src: (a.source && a.source.name) || 'News',
    tag: (a.source && a.source.name) || 'News',
    date: stamp(a.publishedAt)
  }));
}

/* ---- provider 2: newsdata.io ---- */
async function fromNewsData(cat) {
  const q = new URLSearchParams({ apikey: NEWSDATA_KEY, language: 'en', size: '10', ...CATS[cat].nd });
  const data = await (await fetch('https://newsdata.io/api/1/latest?' + q)).json();
  if (!Array.isArray(data.results)) throw new Error((data.results && data.results.message) || 'newsdata error');
  return data.results.filter(r => r.title && r.link).map(r => ({
    title: clip(r.title, 160),
    link: r.link,
    desc: clip(r.description || r.content || '', 220),
    img: r.image_url || '',
    src: r.source_name || 'News',
    tag: r.source_name || 'News',
    date: stamp(String(r.pubDate || '').replace(' ', 'T') + 'Z')
  }));
}

module.exports = async (req, res) => {
  const cat = CATS[req.query.cat] ? req.query.cat : 'top';
  res.setHeader('Cache-Control', 'public, max-age=120');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const tries = [['newsapi', fromNewsApi], ['newsdata', fromNewsData]];
  const errors = [];
  for (const [name, run] of tries) {
    try {
      const items = await run(cat);
      if (items.length) return res.status(200).json({ ok: true, provider: name, cat, items });
      errors.push(name + ': empty');
    } catch (e) {
      errors.push(name + ': ' + String(e.message || e));
    }
  }
  // dono API fail → client RSS feeds par aa jayega
  return res.status(502).json({ ok: false, message: errors.join(' | ').slice(0, 300) });
};
