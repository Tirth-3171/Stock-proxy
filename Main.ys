Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");

  if (!symbol) {
    return new Response(JSON.stringify({ error: "Missing symbol" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const yahoo = "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) + "?interval=1d&range=5d";

  try {
    const res = await fetch(yahoo, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Yahoo HTTP " + res.status }), {
        status: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    const j = await res.json();
    const result = j?.chart?.result?.[0];

    if (!result) {
      return new Response(JSON.stringify({ error: "No data for " + symbol }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    const meta = result.meta;
    return new Response(JSON.stringify({
      symbol: symbol,
      last: meta.regularMarketPrice,
      prev: meta.chartPreviousClose || meta.previousClose || null,
      currency: meta.currency || "INR",
      fetchedAt: new Date().toISOString()
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
});
