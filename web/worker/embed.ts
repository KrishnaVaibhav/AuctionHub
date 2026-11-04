/**
 * /embed/:auctionId: a tiny self-contained widget for iframes on other sites.
 * It reads the public REST API with the anon key (RLS hides private auctions),
 * refreshes every 15 seconds and links to the full room for bidding.
 */
export function embedPage(id: string, origin: string, supabaseUrl: string, anonKey: string, dark: boolean): Response {
  const cfg = JSON.stringify({ id, origin, url: supabaseUrl, key: anonKey });
  const html = `<!doctype html>
<html lang="en" class="${dark ? "dark" : ""}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>AuctionHub</title>
<style>
  :root { --bg:#fafaf9; --card:#ffffff; --text:#1c1917; --muted:#57534e; --line:#e7e5e4; --accent:#f59e0b; --accent-text:#0c0a09; }
  .dark { --bg:#0f0e0d; --card:#1a1816; --text:#f4f2ef; --muted:#a39b94; --line:#2e2a27; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--text); }
  .wrap { padding:14px; }
  header { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  header img { width:44px; height:44px; border-radius:12px; object-fit:cover; background:var(--line); }
  h1 { font-size:16px; margin:0; font-weight:800; letter-spacing:-0.01em; }
  .status { font-size:12px; color:var(--muted); }
  .live { display:inline-block; background:#dc2626; color:#fff; border-radius:999px; padding:1px 8px; font-weight:700; font-size:11px; }
  ul { list-style:none; margin:0; padding:0; border:1px solid var(--line); border-radius:16px; background:var(--card); overflow:hidden; }
  li { display:flex; justify-content:space-between; gap:12px; padding:10px 12px; border-top:1px solid var(--line); }
  li:first-child { border-top:0; }
  .t { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .m { font-size:12px; color:var(--muted); }
  .p { font-weight:800; font-variant-numeric:tabular-nums; white-space:nowrap; text-align:right; }
  a.cta { display:block; margin-top:10px; text-align:center; background:var(--accent); color:var(--accent-text); font-weight:700; text-decoration:none; border-radius:999px; padding:10px; }
  a.cta:focus-visible { outline:2px solid #d97706; outline-offset:2px; }
  .brand { margin-top:8px; text-align:center; font-size:11px; color:var(--muted); }
  @media (prefers-reduced-motion: no-preference) { .p { transition: color .3s; } }
</style>
</head>
<body>
<div class="wrap" id="app"><p class="status">Loading...</p></div>
<script>
(function () {
  var C = ${cfg};
  var H = { apikey: C.key, Authorization: "Bearer " + C.key };
  var state = null;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function money(n, s) {
    var cur = (s && s.currency) || "INR";
    try { return new Intl.NumberFormat(cur === "INR" ? "en-IN" : undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n); }
    catch (e) { return cur + " " + Math.round(n); }
  }
  function left(ts) {
    var ms = new Date(ts).getTime() - Date.now();
    if (ms <= 0) return "closing";
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return d ? d + "d " + h + "h" : h ? h + "h " + m + "m" : m + "m " + (s % 60) + "s";
  }
  function render() {
    var app = document.getElementById("app");
    app.textContent = "";
    if (!state) { app.appendChild(el("p", "status", "This auction is not public.")); return; }
    var a = state.a, lots = state.lots;
    var head = el("header");
    if (a.cover_url) { var img = el("img"); img.src = a.cover_url; img.alt = ""; head.appendChild(img); }
    var box = el("div");
    box.appendChild(el("h1", null, a.title));
    var st = el("div", "status");
    if (a.status === "live") st.appendChild(el("span", "live", "LIVE"));
    else st.textContent = a.status === "scheduled" && a.starts_at ? "Starts " + new Date(a.starts_at).toLocaleString() : a.status;
    box.appendChild(st);
    head.appendChild(box);
    app.appendChild(head);
    var ul = el("ul");
    lots.forEach(function (l) {
      var li = el("li");
      var info = el("div");
      info.style.minWidth = "0";
      info.appendChild(el("div", "t", l.title));
      var meta = l.status === "open" && a.status === "live" && l.ends_at ? "Ends in " + left(l.ends_at) : l.status;
      if (l.sale_type === "sealed" && l.status === "open") meta += " · sealed bids";
      info.appendChild(el("div", "m", meta + " · " + l.bid_count + " bid" + (l.bid_count === 1 ? "" : "s")));
      li.appendChild(info);
      var price = l.sale_type === "sealed" && l.status === "open" ? "Hidden" : money(l.current_bid != null ? l.current_bid : l.start_price, a.settings);
      li.appendChild(el("div", "p", price));
      ul.appendChild(li);
    });
    if (!lots.length) ul.appendChild(el("li", "m", "No lots yet."));
    app.appendChild(ul);
    var cta = el("a", "cta", a.status === "live" ? "Bid now" : "Open auction");
    cta.href = C.origin + "/a/" + C.id; cta.target = "_blank"; cta.rel = "noopener";
    app.appendChild(cta);
    app.appendChild(el("div", "brand", "Powered by AuctionHub"));
  }
  function load() {
    Promise.all([
      fetch(C.url + "/rest/v1/auctions?id=eq." + C.id + "&select=title,status,cover_url,starts_at,settings", { headers: H }).then(function (r) { return r.json(); }),
      fetch(C.url + "/rest/v1/lots?auction_id=eq." + C.id + "&select=title,status,current_bid,start_price,bid_count,ends_at,sale_type&status=in.(open,pending,sold)&order=position&limit=8", { headers: H }).then(function (r) { return r.json(); })
    ]).then(function (res) {
      state = Array.isArray(res[0]) && res[0].length ? { a: res[0][0], lots: Array.isArray(res[1]) ? res[1] : [] } : null;
      render();
    }).catch(function () {});
  }
  load();
  setInterval(load, 15000);
  setInterval(function () { if (state && state.a.status === "live") render(); }, 1000);
})();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": `default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src ${supabaseUrl}; frame-ancestors *; base-uri 'none'`,
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}
