/**
 * Pocket Transactions — stock quote proxy (FIXED build, 2026-09-28).
 *
 * Replaces the code in your Deno Deploy project "stock-proxy"
 * (https://stock-proxy.tirth-3171.deno.net). Same JSON contract as before,
 * so the web app needs NO changes:
 *   GET ?symbol=MASPTOP50.NS  ->  { symbol, last, prev, currency, fetchedAt }
 *   on failure                ->  { error: "..." }
 *
 * WHAT WAS WRONG IN THE OLD WORKER: `prev` was the close of the day the
 * symbol was first fetched (cached forever), so "Prev close" and the daily
 * P&L drifted further from reality every day (MASPTOP50 showed 113.25 — the
 * 21-Sep close — as "prev" on 28-Sep; confirmed still live on the endpoint).
 *
 * THE FIX: `prev` is now always the last COMPLETED session's close, taken as
 * the second-to-last daily candle of a fresh 6-day chart; `last` is the live
 * regularMarketPrice.
 */

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

async function quote(symbol: string) {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) + "?range=6d&interval=1d";
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("Yahoo HTTP " + res.status);
  const j = await res.json();
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r) throw new Error("No chart result");

  const meta = r.meta || {};
  const closes: number[] = [];
  const quoteArr = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const rawClose: Array<number | null> = quoteArr.close || [];
  for (const c of rawClose) {
    if (typeof c === "number" && isFinite(c) && c > 0) closes.push(c);
  }
  if (!closes.length) throw new Error("No closes");

  const last =
    typeof meta.regularMarketPrice === "number" && isFinite(meta.regularMarketPrice)
      ? meta.regularMarketPrice
      : closes[closes.length - 1];
  const prev = closes.length > 1 ? closes[closes.length - 2] : null;

  return {
    symbol,
    last,
    prev,
    currency: typeof meta.currency === "string" ? meta.currency : "INR",
    fetchedAt: new Date().toISOString(),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const symbol = new URL(req.url).searchParams.get("symbol");
    if (!symbol) return json({ error: "missing ?symbol=" }, 400);
    try {
      return json(await quote(symbol));
    } catch (e) {
      // Mirror the app's fallback: strip .NS once for foreign listings.
      if (/\.NS$/i.test(symbol)) return json(await quote(symbol.replace(/\.NS$/i, "")));
      throw e;
    }
  } catch (e) {
    return json({ error: String((e && (e as Error).message) || e) }, 502);
  }
});
