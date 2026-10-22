import { getStore } from "@netlify/blobs";

// Tutti i dati della famiglia stanno in un solo documento: membri, orario, cene e voti.
const KEY = "stato";
const empty = () => ({ membri: [], ora: "20:30", cene: {}, voti: {} });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEV = /^[a-z0-9]{6,40}$/i;
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function apply(s, op) {
  switch (op && op.tipo) {
    case "famiglia": {
      if (!Array.isArray(op.membri) || op.membri.length > 30) throw new Error("membri non validi");
      s.membri = op.membri
        .map((m) => ({ id: str(m && m.id, 40), nome: str(m && m.nome, 20), emoji: str(m && m.emoji, 16) }))
        .filter((m) => m.id && m.nome);
      if (typeof op.ora === "string" && /^\d{2}:\d{2}$/.test(op.ora)) s.ora = op.ora;
      return;
    }
    case "cena": {
      if (!DAY.test(op.id || "")) throw new Error("data non valida");
      const piatto = str(op.piatto, 60);
      if (!piatto) throw new Error("manca il piatto");
      s.cene[op.id] = { chefId: str(op.chefId, 40), chefNome: str(op.chefNome, 20), piatto, note: str(op.note, 120) };
      return;
    }
    case "voto": {
      if (!DAY.test(op.cena || "") || !DEV.test(op.dev || "")) throw new Error("voto non valido");
      const stelle = Number(op.stelle);
      if (!Number.isInteger(stelle) || stelle < 1 || stelle > 5) throw new Error("stelle non valide");
      s.voti[op.cena + "_" + op.dev] = { cena: op.cena, stelle, commento: str(op.commento, 400) };
      return;
    }
    default:
      throw new Error("operazione sconosciuta");
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export default async (req) => {
  try {
    const store = getStore({ name: "cena-del-mercoledi", consistency: "strong" });

    if (req.method === "GET") {
      const s = (await store.get(KEY, { type: "json" })) || empty();
      return json(s);
    }
    if (req.method !== "POST") return json({ errore: "metodo non ammesso" }, 405);

    let op;
    try { op = await req.json(); } catch { return json({ errore: "richiesta non valida" }, 400); }

    // Scrittura sicura: se due persone salvano nello stesso istante, si rilegge e si riprova.
    for (let i = 0; i < 8; i++) {
      const cur = await store.getWithMetadata(KEY, { type: "json" });
      const s = cur && cur.data ? cur.data : empty();
      try { apply(s, op); } catch (e) { return json({ errore: e.message }, 400); }
      let res;
      try {
        if (cur && cur.etag) res = await store.setJSON(KEY, s, { onlyIfMatch: cur.etag });
        else if (!cur) res = await store.setJSON(KEY, s, { onlyIfNew: true });
        else res = await store.setJSON(KEY, s);
      } catch (e) {
        console.error("scrittura condizionata non riuscita", e);
        res = { modified: false };
      }
      if (res && res.modified !== false) return json(s);
      await new Promise((r) => setTimeout(r, 80 + Math.random() * 320));
    }

    // Ultima possibilità: rilegge e salva senza condizioni, così il dato non va perso.
    const last = (await store.get(KEY, { type: "json" })) || empty();
    apply(last, op);
    await store.setJSON(KEY, last);
    return json(last);
  } catch (e) {
    console.error(e);
    return json({ errore: "database non raggiungibile (" + (e && e.message ? e.message : "errore sconosciuto") + ")" }, 500);
  }
};

export const config = { path: "/api" };
