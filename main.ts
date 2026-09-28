/**
 * Pocket Transactions — stock quote proxy (v3, 2026-09-28).
 *
 * Contract (unchanged, the web app needs NO changes):
 *   GET ?symbol=MASPTOP50.NS  ->  { symbol, last, prev, currency, fetchedAt }
 *   on failure                ->  { error: "..." }
 *
 * HISTORY OF THE PREV BUG:
 *  v1: prev = meta.chartPreviousClose  -> close BEFORE the 5-day chart window
 *      (a ~week-old close, e.g. 113.25 shown on 28-Sep). Wrong.
 *  v2: prev = second-to-last daily candle of a fresh 6-day chart -> correct
 *      DURING a session, but on weekends / pre-open it showed the PREVIOUS
 *      session's move labelled as "today" (e.g. Monday 7:45 am showed
 *      Friday's +0.68% as if the market had already moved).
 *  v3 (this file): session-aware. prev = second-to-last candle ONLY while the
 *      exchange is (or has been, today) in session. Whenever the exchange has
 *      no session today yet (weekend, holiday, pre-open), prev = the last
 *      completed session's close, so the app's day P&L reads 0.00 until the
 *      next session begins — same convention as broker apps.
 *
 *  Examples (IST): Sat/Sun/Mon-pre-open -> prev = Friday close, day 0.00%
 *                  Mon 09:15–15:30     -> prev = Friday close is the LIVE base
 *                                         (last candle = today, prev = Fri)
 *                  Mon after 15:30     -> prev = Friday close, shows Monday's move
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

/** Exchange session info by listing suffix. Minutes are local exchange time. */
function exchangeInfo(symbol: string): { tz: string; openMin: number } {
  if (/\.NS$/i.test(symbol) || /\.BO$/i.test(symbol)) {
    return { tz: "Asia/Kolkata", openMin: 9 * 60 + 15 };   // NSE/BSE 09:15 IST
  }
  return { tz: "America/New_York", openMin: 9 * 60 + 30 }; // NYSE/Nasdaq 09:30 ET
}

function tzParts(unixMs: number, tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(unixMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10),
  };
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

  let prev = closes.length > 1 ? closes[closes.length - 2] : null;

  // --- session-aware day base ---
  const info = exchangeInfo(symbol);
  const now = tzParts(Date.now(), info.tz);
  const stamps: number[] = Array.isArray(r.timestamp) ? r.timestamp : [];
  const lastCandleDate = stamps.length
    ? tzParts(stamps[stamps.length - 1] * 1000, info.tz).date
    : null;
  const sessionToday = lastCandleDate !== null &&
    lastCandleDate === now.date && now.minutes >= info.openMin;
  if (!sessionToday) {
    // Exchange has not had a session today (weekend / holiday / pre-open):
    // day P&L must read 0 until the next session begins.
    prev = closes[closes.length - 1];
  }

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
