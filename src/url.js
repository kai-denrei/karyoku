// url.js — the one place that reads the URL. `#plate?seed=7` and
// `?seed=7#plate` both work: the hash's own query is merged under the real
// search string, search winning on a collision.
export function query() {
  const q = new URLSearchParams(location.search);
  const hq = location.hash.indexOf('?');
  if (hq >= 0) for (const [k, v] of new URLSearchParams(location.hash.slice(hq + 1))) if (!q.has(k)) q.set(k, v);
  return q;
}
// a link to this tab with one param changed (a look switch reloads the page)
export function withParam(key, value) {
  const q = query();
  q.set(key, value);
  const tab = location.hash.slice(1).split('?')[0] || 'plate';
  return `${location.pathname}?${q.toString()}#${tab}`;
}
