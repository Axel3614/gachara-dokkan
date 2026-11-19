// I banner di Dokkan che mancano sul nostro sito delle immagini (Axel3614/gachara-dokkan), scaricati da soli.
// L'utente, 2026-11-19: "non può succedere questo ogni volta che mettono un evento nuovo" (eventi nuovi col banner
// rotto finché non lanciava `npm run immagini:dokkan`). Gira nel repository gachara-dokkan (.github/workflows/
// banner.yml, ogni ora), dalla sua cartella: legge il pacchetto dei dati pubblicato (ramo "pacchetto" di
// gachadex-releases, lo stesso della web app), prende i percorsi banners/… e images/… che i dati di Dokkan citano
// sul nostro sito e scarica quelli che il repository non ha dallo specchio di DokkanDB (lo stesso indirizzo di
// scripts/immagini-dokkandb.mts), una richiesta ogni 4 secondi. Solo banner e immagini dei pannelli: icone e
// disegni restano allo script dell'utente. Senza dipendenze (Node 22).
//   node banner-nuovi.mjs [--prova]   (--prova: dice cosa scaricherebbe, nessuna richiesta a DokkanDB)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync } from "node:zlib";

const PACCHETTO = "https://raw.githubusercontent.com/Axel3614/gachadex-releases/pacchetto";
const SPECCHIO = "https://enaskhebnjtktdfszdcb.supabase.co/storage/v1/object/public/assets/mirror";
const AGENTE = "Gachara-updater (+https://axel3614.github.io/gachara/)";
const PAUSA_MS = 4000;
const MASSIMO = 60;
// Quelli che lo specchio non ha ancora (un evento appena annunciato): si riprovano dopo un giorno.
const FILE_MANCANTI = ".banner-mancanti.json";
const RIPROVA_MS = 24 * 3600 * 1000;
const prova = process.argv.includes("--prova");

// I percorsi dei banner citati in un testo (i dati scrivono l'indirizzo intero del nostro sito).
export const percorsiBanner = (testo) => [...new Set([...testo.matchAll(/gachara-dokkan\/((?:banners|images)\/[\w./-]+?\.(?:png|jpg|webp))/g)].map((m) => m[1]))];

// Prova veloce (sempre).
{
  const p = percorsiBanner('{"immagine":"https://axel3614.github.io/gachara-dokkan/banners/en/event/eve_listbutton/myp_banner_event_1751.png","x":"https://axel3614.github.io/gachara-dokkan/character/thumb/a.png"}');
  if (p.join() !== "banners/en/event/eve_listbutton/myp_banner_event_1751.png") throw new Error("percorsiBanner");
}

const chiedi = async (indirizzo) => {
  const r = await fetch(indirizzo, { headers: { "User-Agent": AGENTE } });
  return { r, corpo: Buffer.from(await r.arrayBuffer()) };
};

const manifesto = JSON.parse((await chiedi(`${PACCHETTO}/manifesto.json`)).corpo.toString("utf8"));
const percorsi = new Set();
for (const { asset } of Object.values(manifesto.giochi?.dokkan?.file ?? {})) {
  const { r, corpo } = await chiedi(`${PACCHETTO}/${asset}`);
  if (!r.ok) throw new Error(`${r.status} ${asset}`);
  for (const p of percorsiBanner(gunzipSync(corpo).toString("utf8"))) percorsi.add(p);
}
// Il repository è scaricato senza i file (--filter=blob:none): quelli che ha si leggono dall'albero.
const presenti = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n"));
const mancanti = existsSync(FILE_MANCANTI) ? JSON.parse(readFileSync(FILE_MANCANTI, "utf8")) : {};
const adesso = Date.now();
const daChiedere = [...percorsi].filter((p) => !presenti.has(p) && !(adesso - (mancanti[p] ?? 0) < RIPROVA_MS)).sort();
console.log(`${percorsi.size} banner citati dai dati, ${daChiedere.length} da chiedere${daChiedere.length > MASSIMO ? ` (${MASSIMO} in questo giro)` : ""}`);
if (prova) {
  for (const p of daChiedere.slice(0, MASSIMO)) console.log(`  ${p}`);
  process.exit(0);
}

let scaricati = 0;
for (const [i, p] of daChiedere.slice(0, MASSIMO).entries()) {
  if (i) await new Promise((r) => setTimeout(r, PAUSA_MS));
  const { r, corpo } = await chiedi(`${SPECCHIO}/${p}`);
  if (r.status === 429) {
    console.log("429: DokkanDB chiede di rallentare, mi fermo");
    break;
  }
  // Un'immagine vera: PNG, JPEG o WebP (qualche .png è un JPEG col nome .png).
  if (r.ok && /^(?:89504e47|ffd8ff|52494646)/.test(corpo.subarray(0, 4).toString("hex"))) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, corpo);
    delete mancanti[p];
    scaricati++;
    console.log(`  ok ${p}`);
  } else {
    mancanti[p] = adesso;
    console.log(`  manca ${p} (${r.status})`);
  }
}
writeFileSync(FILE_MANCANTI, JSON.stringify(mancanti, null, 1) + "\n");
console.log(`fatto: ${scaricati} scaricati`);
