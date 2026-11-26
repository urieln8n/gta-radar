/**
 * Recoge titulares sobre GTA 6 de los feeds RSS/Atom permitidos.
 *
 * - Lee data/config/fuentes.json y usa solo las fuentes con "permitido": true
 *   y "tipo": "rss".
 * - Se queda con los titulares sobre GTA 6 / GTA VI / Grand Theft Auto VI.
 * - Descarta filtraciones, leaks, mod menus, cheats, códigos y cracks
 *   (en el titular o en el enlace). "truco" NO se descarta: en el canal
 *   significa consejo.
 * - Deduplica por id = sha1(enlace canónico), contra todo data/noticias/ y
 *   dentro de la propia ejecución.
 * - Añade lo nuevo a data/noticias/AAAA-MM.json (mes UTC de "fecha") con
 *   "resumen": null y "estado": "pendiente". Lo que ya existe no se toca.
 * - Idempotente: si no hay nada nuevo, no reescribe ningún archivo.
 *
 * Solo se guardan titular, medio, fecha y enlace: nunca texto del artículo
 * ni imágenes de los medios.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { descargarTexto, type FetchFn, type OpcionesPeticion, type SleepFn } from "./http.ts";

// ---------------------------------------------------------------------------
// Tipos del contrato común
// ---------------------------------------------------------------------------

export type TipoFuente = "rss" | "youtube" | "manual";

export interface Fuente {
  id: string;
  nombre: string;
  tipo: TipoFuente;
  url: string;
  aviso_legal_url: string;
  permitido: boolean;
  nota: string;
}

export type EstadoNoticia = "pendiente" | "aprobada" | "descartada";

export interface Noticia {
  id: string;
  titular: string;
  medio: string;
  fecha: string;
  enlace: string;
  resumen: string | null;
  estado: EstadoNoticia;
  recogida: string;
}

/** Lo único que se extrae de cada entrada del feed. */
export interface EntradaFeed {
  titular: string;
  enlace: string | null;
  fecha: string | null;
}

// ---------------------------------------------------------------------------
// Fuentes
// ---------------------------------------------------------------------------

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function esUrlHttp(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  try {
    const url = new URL(valor);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Filtra la lista de fuentes: solo "permitido": true (estricto) y "tipo": "rss". */
export function seleccionarFuentesRss(lista: unknown): { fuentes: Fuente[]; avisos: string[] } {
  if (!Array.isArray(lista)) throw new Error("fuentes.json debe ser un array de fuentes");
  const fuentes: Fuente[] = [];
  const avisos: string[] = [];
  lista.forEach((f, i) => {
    if (!esObjeto(f) || f.permitido !== true || f.tipo !== "rss") return;
    const nombre = typeof f.id === "string" && f.id ? f.id : `posición ${i}`;
    if (typeof f.id !== "string" || !f.id || typeof f.nombre !== "string" || !f.nombre.trim()) {
      avisos.push(`Fuente ${nombre} ignorada: le falta "id" o "nombre"`);
      return;
    }
    if (!esUrlHttp(f.url)) {
      avisos.push(`Fuente ${nombre} ignorada: "url" no es http(s)`);
      return;
    }
    fuentes.push(f as unknown as Fuente);
  });
  return { fuentes, avisos };
}

export async function cargarFuentes(ruta: string): Promise<{ fuentes: Fuente[]; avisos: string[] }> {
  const texto = await readFile(ruta, "utf8");
  return seleccionarFuentesRss(JSON.parse(texto));
}

// ---------------------------------------------------------------------------
// Filtros de tema y de palabras prohibidas
// ---------------------------------------------------------------------------

/** Minúsculas y sin tildes, para comparar "Código" con "codigo". */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const ANTES = String.raw`(?<![\p{L}\p{N}])`;
const DESPUES = String.raw`(?![\p{L}\p{N}])`;

// "GTA 6", "GTA VI", "GTA6", "#GTAVI", "Grand Theft Auto VI" (y "... 6").
// No coincide con "GTA Vice City", "GTA VII" ni "GTA 60".
const RE_GTA6 = new RegExp(String.raw`${ANTES}(?:gta|grand[\s_-]+theft[\s_-]+auto)[\s_:-]*(?:6|vi)${DESPUES}`, "u");

export function esSobreGta6(titular: string): boolean {
  return RE_GTA6.test(normalizar(titular));
}

/** Palabras prohibidas del contrato. Se buscan también sus variantes (plural, verbo, sin tilde). */
export const PALABRAS_PROHIBIDAS = ["filtración", "leak", "mod menu", "cheat", "código", "crack"] as const;

const PATRONES_PROHIBIDOS: ReadonlyArray<{ palabra: (typeof PALABRAS_PROHIBIDAS)[number]; re: RegExp }> = [
  // filtración/filtraciones y "se filtra", "filtran", "filtrado/a/os/as", "filtraron"
  {
    palabra: "filtración",
    re: new RegExp(String.raw`${ANTES}(?:filtraci|filtrad[oa]s?${DESPUES}|filtra(?:n|ron)?${DESPUES})`, "u"),
  },
  { palabra: "leak", re: new RegExp(String.raw`${ANTES}leak`, "u") }, // leak, leaks, leaked, leaker...
  { palabra: "mod menu", re: new RegExp(String.raw`${ANTES}mod[\s_-]*menu`, "u") }, // mod menu, mod menú, modmenu
  { palabra: "cheat", re: new RegExp(String.raw`${ANTES}cheat`, "u") }, // cheat, cheats, cheat codes...
  { palabra: "código", re: new RegExp(String.raw`${ANTES}codigo`, "u") }, // código, códigos
  { palabra: "crack", re: new RegExp(String.raw`${ANTES}crack`, "u") }, // crack, crackeado...
];

/**
 * Variantes que solo se distinguen por la tilde y por eso se buscan en el texto
 * sin quitar tildes: "filtró" (pretérito de filtrar) frente a "filtro" (de fotos...).
 */
const PATRONES_CON_TILDE: ReadonlyArray<{ palabra: (typeof PALABRAS_PROHIBIDAS)[number]; re: RegExp }> = [
  { palabra: "filtración", re: new RegExp(String.raw`${ANTES}filtró${DESPUES}`, "u") },
];

/** Devuelve la palabra prohibida encontrada, o null. "truco" no está prohibida. */
export function palabraProhibida(texto: string): string | null {
  const sinTildes = normalizar(texto);
  const conTildes = texto.normalize("NFC").toLowerCase();
  return (
    PATRONES_PROHIBIDOS.find(({ re }) => re.test(sinTildes))?.palabra ??
    PATRONES_CON_TILDE.find(({ re }) => re.test(conTildes))?.palabra ??
    null
  );
}

// ---------------------------------------------------------------------------
// Enlaces e ids
// ---------------------------------------------------------------------------

const PARAMETROS_SEGUIMIENTO = new Set([
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "igshid",
  "mc_cid", "mc_eid", "_ga", "_gl", "ocid", "cmpid", "ref_src", "smid",
]);

function esParametroSeguimiento(clave: string): boolean {
  const c = clave.toLowerCase();
  return c.startsWith("utm_") || PARAMETROS_SEGUIMIENTO.has(c);
}

function decodificarSeguro(texto: string): string {
  try {
    return decodeURIComponent(texto.replace(/\+/g, " "));
  } catch {
    return texto;
  }
}

/**
 * Enlace canónico: http(s) absoluto, sin fragmento, sin credenciales y sin
 * parámetros de seguimiento (utm_*, fbclid...). El resto de la query se
 * conserva tal cual para no romper el enlace. Devuelve null si no es válido.
 */
export function canonizarEnlace(enlace: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(enlace.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.username = "";
  url.password = "";
  if (url.search) {
    const partes = url.search
      .slice(1)
      .split("&")
      .filter((p) => p && !esParametroSeguimiento(decodificarSeguro(p.split("=")[0] ?? "")));
    url.search = partes.length > 0 ? `?${partes.join("&")}` : "";
  }
  return url.toString();
}

export function idDeEnlace(enlaceCanonico: string): string {
  return createHash("sha1").update(enlaceCanonico).digest("hex");
}

// ---------------------------------------------------------------------------
// Lectura de feeds RSS 2.0 / Atom (solo titular, enlace y fecha)
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", iexcl: "¡", iquest: "¿", euro: "€",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
};

function decodificarUnaVez(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entera, cuerpo: string) => {
    if (cuerpo[0] === "#") {
      const codigo = cuerpo[1] === "x" || cuerpo[1] === "X" ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10);
      return Number.isInteger(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : entera;
    }
    return ENTIDADES[cuerpo] ?? entera;
  });
}

/** Decodifica entidades; una segunda pasada arregla los feeds con doble escape (&amp;#8217;). */
export function decodificarEntidades(texto: string): string {
  const una = decodificarUnaVez(texto);
  return /&(#x[0-9a-f]+|#\d+|[a-z]+);/i.test(una) ? decodificarUnaVez(una) : una;
}

/** Las etiquetas de bloque separan palabras; las de línea (<b>, <i>...) desaparecen sin dejar hueco. */
function quitarEtiquetas(texto: string): string {
  return texto
    .replace(/<\/?(?:br|p|div|li|ul|ol|h[1-6]|tr|td|th|blockquote)\b[^>]*>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "");
}

const MAX_TITULAR = 300;

function limpiarTexto(crudo: string): string {
  let t = crudo.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  t = quitarEtiquetas(t);
  t = decodificarEntidades(t);
  t = quitarEtiquetas(t); // títulos con HTML escapado (Atom type="html")
  t = t.replace(/\s+/g, " ").trim();
  return t.length > MAX_TITULAR ? `${t.slice(0, MAX_TITULAR - 1).trimEnd()}…` : t;
}

function escaparRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Texto del primer elemento no vacío de la lista (ignora elementos autocerrados). */
function textoDe(bloque: string, etiquetas: readonly string[]): string | null {
  for (const etiqueta of etiquetas) {
    const e = escaparRegExp(etiqueta);
    const m = new RegExp(`<${e}(?:\\s[^>]*?)?(?<!/)>([\\s\\S]*?)</${e}\\s*>`, "i").exec(bloque);
    if (m?.[1] !== undefined) {
      const texto = limpiarTexto(m[1]);
      if (texto) return texto;
    }
  }
  return null;
}

function atributos(etiqueta: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of etiqueta.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (m[1]) attrs[m[1].toLowerCase()] = decodificarEntidades(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

/** <link href="..."/> de Atom: prefiere rel="alternate" (o sin rel). */
function enlaceAtom(bloque: string): string | null {
  const enlaces = [...bloque.matchAll(/<link\b([^>]*)>/gi)].map((m) => atributos(m[1] ?? "")).filter((a) => a.href);
  const alternativo = enlaces.find((a) => !a.rel || a.rel === "alternate");
  return (alternativo ?? enlaces[0])?.href ?? null;
}

function enlaceGuid(bloque: string): string | null {
  const m = /<guid\b([^>]*)>([\s\S]*?)<\/guid\s*>/i.exec(bloque);
  if (!m || /ispermalink\s*=\s*["']false["']/i.test(m[1] ?? "")) return null;
  const texto = limpiarTexto(m[2] ?? "");
  return /^https?:\/\//i.test(texto) ? texto : null;
}

/** Extrae titular, enlace y fecha de cada <item> (RSS) o <entry> (Atom). Nada más. */
export function parsearFeed(xml: string): EntradaFeed[] {
  const entradas: EntradaFeed[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const bloque = m[2] ?? "";
    const titular = textoDe(bloque, ["title"]);
    if (!titular) continue;
    const enlace =
      textoDe(bloque, ["feedburner:origLink", "link"]) ?? enlaceAtom(bloque) ?? enlaceGuid(bloque);
    const fecha = textoDe(bloque, ["pubDate", "published", "dc:date", "updated", "a10:updated"]);
    entradas.push({ titular, enlace, fecha });
  }
  return entradas;
}

/** Fecha ISO de publicación; si falta, no se entiende o está en el futuro, la de recogida. */
export function fechaIso(cruda: string | null, recogidaMs: number): string {
  const ms = cruda ? Date.parse(cruda) : Number.NaN;
  return new Date(Number.isFinite(ms) && ms <= recogidaMs ? ms : recogidaMs).toISOString();
}

// ---------------------------------------------------------------------------
// Archivos data/noticias/AAAA-MM.json
// ---------------------------------------------------------------------------

export const RE_ARCHIVO_MES = /^\d{4}-\d{2}\.json$/;

export type NoticiaGuardada = Record<string, unknown> & { id: string };

export function esNoEncontrado(err: unknown): boolean {
  return esObjeto(err) && err.code === "ENOENT";
}

/** Lee un archivo de mes. Si está corrupto se aborta: nunca se sobrescribe lo que no se entiende. */
export async function leerArchivoMes(ruta: string): Promise<NoticiaGuardada[]> {
  let texto: string;
  try {
    texto = await readFile(ruta, "utf8");
  } catch (err) {
    if (esNoEncontrado(err)) return [];
    throw err;
  }
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch (err) {
    throw new Error(`${ruta} no es JSON válido; no se toca nada`, { cause: err });
  }
  if (!Array.isArray(datos) || !datos.every((n) => esObjeto(n) && typeof n.id === "string")) {
    throw new Error(`${ruta} no es un array de noticias con "id"; no se toca nada`);
  }
  return datos as NoticiaGuardada[];
}

async function idsExistentes(dir: string): Promise<Set<string>> {
  let nombres: string[];
  try {
    nombres = await readdir(dir);
  } catch (err) {
    if (esNoEncontrado(err)) return new Set();
    throw err;
  }
  const ids = new Set<string>();
  for (const nombre of nombres.filter((n) => RE_ARCHIVO_MES.test(n)).sort()) {
    for (const noticia of await leerArchivoMes(join(dir, nombre))) ids.add(noticia.id);
  }
  return ids;
}

/** Escritura atómica: archivo temporal + rename, para no dejar JSON a medias. */
export async function escribirAtomico(ruta: string, datos: unknown): Promise<void> {
  const temporal = `${ruta}.${process.pid}.tmp`;
  await writeFile(temporal, `${JSON.stringify(datos, null, 2)}\n`, "utf8");
  await rename(temporal, ruta);
}

/**
 * Añade al archivo del mes las noticias que todavía no estén en él.
 * Se relee justo antes de escribir para no pisar cambios hechos mientras se
 * descargaban los feeds (p. ej. una noticia que alguien acaba de aprobar).
 */
async function anadirAlMes(dir: string, mes: string, nuevas: Noticia[]): Promise<number> {
  const ruta = join(dir, `${mes}.json`);
  const actuales = await leerArchivoMes(ruta);
  const ids = new Set(actuales.map((n) => n.id));
  const porAnadir = nuevas.filter((n) => !ids.has(n.id));
  if (porAnadir.length === 0) return 0;
  await escribirAtomico(ruta, [...actuales, ...porAnadir]);
  return porAnadir.length;
}

// ---------------------------------------------------------------------------
// Recogida
// ---------------------------------------------------------------------------

export interface ResultadoFuente {
  id: string;
  nombre: string;
  entradas: number;
  sobreGta6: number;
  prohibidas: number;
  sinEnlace: number;
  repetidas: number;
  nuevas: number;
  error?: string;
}

export interface ResultadoRecogida {
  fuentes: ResultadoFuente[];
  avisos: string[];
  nuevas: number;
  /** Noticias añadidas por archivo, p. ej. { "2026-11.json": 3 }. */
  archivos: Record<string, number>;
}

export interface OpcionesRecogida {
  rutaFuentes: string;
  dirNoticias: string;
  fetchFn?: FetchFn;
  sleepFn?: SleepFn;
  ahora?: () => Date;
  http?: Omit<OpcionesPeticion, "fetchFn" | "sleepFn">;
}

const ACEPTAR_FEEDS = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5";

export async function recogerNoticias(opciones: OpcionesRecogida): Promise<ResultadoRecogida> {
  const { fuentes, avisos } = await cargarFuentes(opciones.rutaFuentes);
  const vistos = await idsExistentes(opciones.dirNoticias);
  const ahora = opciones.ahora ?? (() => new Date());
  const recogidaMs = ahora().getTime();
  const recogida = new Date(recogidaMs).toISOString();

  const nuevasPorMes = new Map<string, Noticia[]>();
  const resultados: ResultadoFuente[] = [];

  // Una fuente detrás de otra: no hay prisa y así no se satura a nadie.
  for (const fuente of fuentes) {
    const r: ResultadoFuente = {
      id: fuente.id, nombre: fuente.nombre,
      entradas: 0, sobreGta6: 0, prohibidas: 0, sinEnlace: 0, repetidas: 0, nuevas: 0,
    };
    resultados.push(r);

    let entradas: EntradaFeed[];
    try {
      const xml = await descargarTexto(fuente.url, {
        ...opciones.http,
        headers: { accept: ACEPTAR_FEEDS, ...opciones.http?.headers },
        fetchFn: opciones.fetchFn,
        sleepFn: opciones.sleepFn,
      });
      entradas = parsearFeed(xml);
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
      continue;
    }

    r.entradas = entradas.length;
    for (const entrada of entradas) {
      if (!esSobreGta6(entrada.titular)) continue;
      r.sobreGta6++;

      const enlace = entrada.enlace ? canonizarEnlace(entrada.enlace, fuente.url) : null;
      if (!enlace) {
        r.sinEnlace++;
        continue;
      }
      const ruta = decodificarSeguro(new URL(enlace).pathname);
      if (palabraProhibida(entrada.titular) || palabraProhibida(ruta)) {
        r.prohibidas++;
        continue;
      }
      const id = idDeEnlace(enlace);
      if (vistos.has(id)) {
        r.repetidas++;
        continue;
      }
      vistos.add(id);

      const fecha = fechaIso(entrada.fecha, recogidaMs);
      const noticia: Noticia = {
        id,
        titular: entrada.titular,
        medio: fuente.nombre,
        fecha,
        enlace,
        resumen: null,
        estado: "pendiente",
        recogida,
      };
      const mes = fecha.slice(0, 7);
      const delMes = nuevasPorMes.get(mes) ?? [];
      delMes.push(noticia);
      nuevasPorMes.set(mes, delMes);
      r.nuevas++;
    }
  }

  const archivos: Record<string, number> = {};
  let total = 0;
  if (nuevasPorMes.size > 0) await mkdir(opciones.dirNoticias, { recursive: true });
  for (const [mes, nuevas] of [...nuevasPorMes].sort(([a], [b]) => a.localeCompare(b))) {
    nuevas.sort((a, b) => a.fecha.localeCompare(b.fecha));
    const anadidas = await anadirAlMes(opciones.dirNoticias, mes, nuevas);
    if (anadidas > 0) {
      archivos[`${mes}.json`] = anadidas;
      total += anadidas;
    }
  }

  return { fuentes: resultados, avisos, nuevas: total, archivos };
}

// ---------------------------------------------------------------------------
// CLI: npm run recoger
// ---------------------------------------------------------------------------

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));

async function main(): Promise<void> {
  const rutaFuentes = join(RAIZ, "data/config/fuentes.json");
  const dirNoticias = join(RAIZ, "data/noticias");

  let resultado: ResultadoRecogida;
  try {
    resultado = await recogerNoticias({ rutaFuentes, dirNoticias });
  } catch (err) {
    if (esNoEncontrado(err)) console.error(`No existe ${relative(RAIZ, rutaFuentes)}`);
    else console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  for (const aviso of resultado.avisos) console.warn(`Aviso: ${aviso}`);
  if (resultado.fuentes.length === 0) console.warn("No hay fuentes RSS permitidas en fuentes.json");

  for (const f of resultado.fuentes) {
    if (f.error) {
      console.error(`${f.nombre}: ERROR — ${f.error}`);
      continue;
    }
    console.log(
      `${f.nombre}: ${f.entradas} entradas, ${f.sobreGta6} sobre GTA 6, ` +
        `${f.prohibidas} descartadas por palabra prohibida, ${f.repetidas} repetidas, ${f.nuevas} nuevas`,
    );
  }
  const detalle = Object.entries(resultado.archivos)
    .map(([archivo, n]) => `data/noticias/${archivo} (+${n})`)
    .join(", ");
  console.log(`Total: ${resultado.nuevas} noticias nuevas${detalle ? ` → ${detalle}` : ""}`);

  const fallidas = resultado.fuentes.filter((f) => f.error).length;
  if (resultado.fuentes.length > 0 && fallidas === resultado.fuentes.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
