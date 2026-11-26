import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { FetchFn } from "../../src/recoger/http.ts";
import { idDeEnlace, recogerNoticias, type Noticia } from "../../src/recoger/noticias.ts";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const RUTA_FUENTES = join(AQUI, "fuentes.json");
const AHORA = new Date("2026-11-26T12:00:00.000Z");
const CLAVES_CONTRATO = ["enlace", "estado", "fecha", "id", "medio", "recogida", "resumen", "titular"];

const URL_A = "https://medio-a.example/feed.xml";
const URL_B = "https://medio-b.example/atom.xml";

let feedA = "";
let feedB = "";
let dir = "";
const fetchGlobal = globalThis.fetch;

before(async () => {
  feedA = await readFile(join(AQUI, "fixtures/medio-a.xml"), "utf8");
  feedB = await readFile(join(AQUI, "fixtures/medio-b.xml"), "utf8");
  // Sin red: si algo usara el fetch real, el test fallaría.
  globalThis.fetch = async () => {
    throw new Error("Red prohibida en los tests");
  };
});

after(() => {
  globalThis.fetch = fetchGlobal;
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gta-radar-noticias-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Sirve los feeds de prueba y apunta qué URLs se piden. */
function servidorFalso(rutas: Record<string, () => Response>) {
  const pedidas: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    pedidas.push(url);
    const responder = rutas[url];
    if (!responder) throw new Error(`URL inesperada en test: ${url}`);
    return responder();
  };
  return { fetchFn, pedidas };
}

const xml = (texto: string) => () =>
  new Response(texto, { headers: { "content-type": "application/xml; charset=utf-8" } });

function feedsNormales() {
  return servidorFalso({ [URL_A]: xml(feedA), [URL_B]: xml(feedB) });
}

async function recoger(fetchFn: FetchFn) {
  return recogerNoticias({
    rutaFuentes: RUTA_FUENTES,
    dirNoticias: join(dir, "noticias"),
    fetchFn,
    sleepFn: async () => {},
    ahora: () => AHORA,
  });
}

async function leerMes(mes: string): Promise<Noticia[]> {
  return JSON.parse(await readFile(join(dir, "noticias", `${mes}.json`), "utf8")) as Noticia[];
}

describe("recogerNoticias", () => {
  it("solo descarga las fuentes RSS permitidas", async () => {
    const { fetchFn, pedidas } = feedsNormales();
    await recoger(fetchFn);
    assert.deepEqual(pedidas, [URL_A, URL_B]);
  });

  it("guarda solo titulares de GTA 6 sin palabras prohibidas, deduplicados y por mes", async () => {
    const { fetchFn } = feedsNormales();
    const resultado = await recoger(fetchFn);

    assert.deepEqual(
      resultado.fuentes.map(({ id, entradas, sobreGta6, prohibidas, repetidas, nuevas }) => ({
        id, entradas, sobreGta6, prohibidas, repetidas, nuevas,
      })),
      [
        { id: "medio-a", entradas: 14, sobreGta6: 12, prohibidas: 7, repetidas: 1, nuevas: 4 },
        { id: "medio-b", entradas: 4, sobreGta6: 4, prohibidas: 0, repetidas: 1, nuevas: 3 },
      ],
    );
    assert.equal(resultado.nuevas, 7);
    assert.deepEqual(resultado.archivos, { "2026-10.json": 1, "2026-11.json": 6 });

    const noviembre = await leerMes("2026-11");
    assert.deepEqual(
      noviembre.map((n) => [n.titular, n.medio, n.fecha]),
      [
        ["GTA VI: el tráiler 3 ya tiene fecha", "Medio B", "2026-11-20T10:00:00.000Z"],
        ["Truco para ganar dinero rápido en GTA 6", "Medio A", "2026-11-23T18:00:00.000Z"],
        ["Grand Theft Auto VI tendrá el mapa más grande de la saga", "Medio A", "2026-11-24T08:30:00.000Z"],
        ["GTA 6: Rockstar confirma la fecha de lanzamiento", "Medio A", "2026-11-25T10:00:00.000Z"],
        ["GTA 6 & la economía: costará 70 dólares", "Medio A", "2026-11-26T12:00:00.000Z"],
        ["Rumor: GTA 6 llegará a PC en 2027", "Medio B", "2026-11-26T12:00:00.000Z"],
      ],
    );

    const octubre = await leerMes("2026-10");
    assert.deepEqual(octubre.map((n) => [n.titular, n.enlace, n.fecha]), [
      ["GTA 6 oficial: así será Vice City", "https://medio-b.example/noticias/gta-6-vice-city", "2026-10-15T07:00:00.000Z"],
    ]);

    for (const n of [...noviembre, ...octubre]) {
      assert.deepEqual(Object.keys(n).sort(), CLAVES_CONTRATO, "solo los campos del contrato");
      assert.equal(n.resumen, null);
      assert.equal(n.estado, "pendiente");
      assert.equal(n.recogida, AHORA.toISOString());
      assert.equal(n.id, idDeEnlace(n.enlace));
      assert.doesNotMatch(n.enlace, /utm_|#/);
    }
    const ids = [...noviembre, ...octubre].map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, "sin ids repetidos");
  });

  it("nunca guarda texto del artículo ni imágenes", async () => {
    const { fetchFn } = feedsNormales();
    await recoger(fetchFn);
    for (const nombre of await readdir(join(dir, "noticias"))) {
      const contenido = await readFile(join(dir, "noticias", nombre), "utf8");
      assert.doesNotMatch(contenido, /TEXTO DEL ARTICULO|\.jpg|<img/i);
    }
  });

  it("es idempotente: la segunda ejecución no añade ni reescribe nada", async () => {
    await recoger(feedsNormales().fetchFn);
    const antes = await Promise.all(["2026-10", "2026-11"].map((m) => readFile(join(dir, "noticias", `${m}.json`), "utf8")));

    const segunda = await recoger(feedsNormales().fetchFn);
    assert.equal(segunda.nuevas, 0);
    assert.deepEqual(segunda.archivos, {});
    assert.deepEqual(segunda.fuentes.map((f) => f.repetidas), [5, 4], "lo guardado + los duplicados del propio feed");

    const despues = await Promise.all(["2026-10", "2026-11"].map((m) => readFile(join(dir, "noticias", `${m}.json`), "utf8")));
    assert.deepEqual(despues, antes);
    assert.deepEqual((await readdir(join(dir, "noticias"))).sort(), ["2026-10.json", "2026-11.json"], "sin temporales");
  });

  it("respeta lo que ya existe (estado y resumen) y solo añade lo nuevo", async () => {
    const enlace = "https://medio-a.example/gta-6-fecha-lanzamiento";
    const aprobada: Noticia = {
      id: idDeEnlace(enlace),
      titular: "GTA 6: Rockstar confirma la fecha de lanzamiento",
      medio: "Medio A",
      fecha: "2026-11-25T10:00:00.000Z",
      enlace,
      resumen: "Rockstar confirmó la fecha de lanzamiento de GTA 6.",
      estado: "aprobada",
      recogida: "2026-11-25T11:00:00.000Z",
    };
    await mkdir(join(dir, "noticias"), { recursive: true });
    await writeFile(join(dir, "noticias", "2026-11.json"), `${JSON.stringify([aprobada], null, 2)}\n`);

    const resultado = await recoger(feedsNormales().fetchFn);
    assert.equal(resultado.nuevas, 6);

    const noviembre = await leerMes("2026-11");
    assert.equal(noviembre.length, 6);
    assert.deepEqual(noviembre[0], aprobada, "la existente sigue intacta y primero");
    assert.equal(noviembre.filter((n) => n.enlace === enlace).length, 1);
  });

  it("deduplica contra noticias de otros meses", async () => {
    const enlace = "https://medio-a.example/gta-vi-mapa";
    await mkdir(join(dir, "noticias"), { recursive: true });
    await writeFile(
      join(dir, "noticias", "2026-09.json"),
      JSON.stringify([{ id: idDeEnlace(enlace), titular: "x", medio: "Medio A", fecha: "2026-09-01T00:00:00.000Z", enlace, resumen: null, estado: "descartada", recogida: "2026-09-01T00:00:00.000Z" }]),
    );
    await recoger(feedsNormales().fetchFn);
    const noviembre = await leerMes("2026-11");
    assert.equal(noviembre.some((n) => n.enlace === enlace), false);
  });

  it("si una fuente falla, sigue con las demás y lo informa", async () => {
    const { fetchFn } = servidorFalso({
      [URL_A]: () => new Response(null, { status: 503 }),
      [URL_B]: xml(feedB),
    });
    const resultado = await recoger(fetchFn);
    assert.match(resultado.fuentes[0]?.error ?? "", /503/);
    assert.equal(resultado.fuentes[1]?.error, undefined);
    assert.equal(resultado.fuentes[1]?.nuevas, 4, "sin medio-a, el mapa de GTA VI ya no es repetido");
    assert.equal(resultado.nuevas, 4);
  });

  it("no sobrescribe un archivo de mes corrupto", async () => {
    await mkdir(join(dir, "noticias"), { recursive: true });
    await writeFile(join(dir, "noticias", "2026-11.json"), "{ esto no es json");
    await assert.rejects(recoger(feedsNormales().fetchFn), /no es JSON válido/);
    assert.equal(await readFile(join(dir, "noticias", "2026-11.json"), "utf8"), "{ esto no es json");
  });
});
