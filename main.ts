// Lista de Presenca - versao Deno Deploy (estado no Deno KV, tempo real via kv.watch)
const kv = await Deno.openKv();
const PIN = String(Deno.env.get("PIN") ?? "0000");
const HTML = await Deno.readTextFile(new URL("./index.html", import.meta.url));
const KEY = ["state"];
// deno-lint-ignore no-explicit-any
type S = any;
const empty = (): S => ({ date: "", updatedAt: new Date().toISOString(), rows: [] });
const json = (o: unknown, code = 200) => new Response(JSON.stringify(o), { status: code, headers: { "content-type": "application/json" } });
const nowHM = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

async function mutate(fn: (s: S) => unknown): Promise<unknown> {
  for (let i = 0; i < 6; i++) {
    const cur = await kv.get<S>(KEY);
    const s: S = cur.value ?? empty();
    const out = fn(s) as { error?: string };
    if (out && out.error) return out;
    s.updatedAt = new Date().toISOString();
    const r = await kv.atomic().check(cur).set(KEY, s).commit();
    if (r.ok) return out;
  }
  return { error: "conflito, tente de novo" };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/" || url.pathname === "/index.html")
    return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  if (url.pathname === "/health") return json({ ok: true });
  const pin = req.headers.get("x-pin") ?? url.searchParams.get("pin");
  if (pin !== PIN) return json({ error: "PIN invalido" }, 401);

  if (url.pathname === "/api/state") return json((await kv.get<S>(KEY)).value ?? empty());

  if (url.pathname === "/api/events") {
    const enc = new TextEncoder();
    let timer: number; let ac = new AbortController();
    const stream = new ReadableStream({
      start(c) {
        const w = kv.watch<[S]>([KEY]).getReader();
        (async () => {
          try {
            while (true) {
              const { done, value } = await w.read();
              if (done) break;
              c.enqueue(enc.encode("data: " + JSON.stringify(value[0].value ?? empty()) + "\n\n"));
            }
          } catch { /* fechado */ }
        })();
        timer = setInterval(() => { try { c.enqueue(enc.encode(": ka\n\n")); } catch { /* fechado */ } }, 15000);
        ac.signal.addEventListener("abort", () => w.cancel());
      },
      cancel() { clearInterval(timer); ac.abort(); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }

  if (req.method === "POST") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (url.pathname === "/api/update") {
      const out = await mutate((s) => {
        const row = s.rows.find((r: S) => r.id === b.id);
        if (!row) return { error: "linha nao encontrada" };
        if ("status" in b) {
          const st = ["presente", "atrasado", ""].includes(b.status) ? b.status : "";
          if (st !== row.status) { row.status = st; row.marcadoEm = st ? nowHM() : ""; }
        }
        if ("obs" in b) row.obs = String(b.obs).slice(0, 500);
        return { ok: true };
      });
      return json(out, (out as S).error ? 404 : 200);
    }
    if (url.pathname === "/api/load") {
      if (!Array.isArray(b.rows)) return json({ error: "rows invalido" }, 400);
      await kv.set(KEY, { date: String(b.date ?? ""), updatedAt: new Date().toISOString(), rows: b.rows.slice(0, 500) });
      return json({ ok: true, n: b.rows.length });
    }
    if (url.pathname === "/api/add") {
      const nome = String(b.nome ?? "").trim().slice(0, 100);
      if (!nome) return json({ error: "nome vazio" }, 400);
      const out = await mutate((s) => {
        s.rows.push({ id: "x" + Date.now(), rota: String(b.rota ?? "").slice(0, 20), hora: String(b.hora ?? ""), dsp: String(b.dsp ?? "").slice(0, 20), nome, reserva: !b.rota, status: "", marcadoEm: "", obs: "" });
        return { ok: true };
      });
      return json(out);
    }
  }
  return json({ error: "not found" }, 404);
});
