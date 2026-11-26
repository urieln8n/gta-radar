/**
 * Revisión manual de las noticias pendientes en la terminal: npm run revisar
 *
 * Muestra cada noticia con "estado": "pendiente" (titular, medio, fecha y
 * enlace), de la más antigua a la más reciente, y deja elegir:
 *
 *   - escribir la frase de resumen → se guarda en "resumen" y pasa a "aprobada"
 *   - "d"                          → pasa a "descartada"
 *   - Enter                        → se salta (sigue pendiente)
 *   - "q" (o Ctrl+D / Ctrl+C)      → termina; lo ya decidido está guardado
 *
 * Solo se cambian "resumen" y "estado" de la noticia revisada; nunca otros
 * campos ni otras noticias. Cada decisión se guarda en el momento, releyendo
 * el archivo justo antes para no pisar lo que haya añadido el recolector
 * entretanto. Si la noticia ya no está pendiente (alguien la revisó en
 * paralelo), no se toca.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  escribirAtomico,
  esNoEncontrado,
  leerArchivoMes,
  RE_ARCHIVO_MES,
  type NoticiaGuardada,
} from "../recoger/noticias.ts";

/** Pregunta y devuelve la línea escrita, o null si se acabó la entrada (Ctrl+D). */
export type Preguntar = (pregunta: string) => Promise<string | null>;
export type Escribir = (texto: string) => void;

export interface Pendiente {
  archivo: string;
  noticia: NoticiaGuardada;
}

// ---------------------------------------------------------------------------
// Lectura y guardado
// ---------------------------------------------------------------------------

function comoTexto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/** Noticias pendientes de todos los AAAA-MM.json, de la más antigua a la más reciente. */
export async function listarPendientes(dir: string): Promise<Pendiente[]> {
  let nombres: string[];
  try {
    nombres = await readdir(dir);
  } catch (err) {
    if (esNoEncontrado(err)) return [];
    throw err;
  }
  const pendientes: Pendiente[] = [];
  for (const archivo of nombres.filter((n) => RE_ARCHIVO_MES.test(n)).sort()) {
    for (const noticia of await leerArchivoMes(join(dir, archivo))) {
      if (noticia.estado === "pendiente") pendientes.push({ archivo, noticia });
    }
  }
  // sort es estable: a igual fecha se respeta el orden del archivo.
  return pendientes.sort((a, b) => comoTexto(a.noticia.fecha).localeCompare(comoTexto(b.noticia.fecha)));
}

export type Cambio = { estado: "aprobada"; resumen: string } | { estado: "descartada" };
export type ResultadoGuardado = "guardada" | "ya-revisada" | "no-encontrada";

/**
 * Aplica la decisión a una noticia cambiando solo "estado" (y "resumen" al
 * aprobar). Relee el archivo justo antes de escribir y solo actúa si la
 * noticia sigue pendiente.
 */
export async function guardarDecision(dir: string, archivo: string, id: string, cambio: Cambio): Promise<ResultadoGuardado> {
  const ruta = join(dir, archivo);
  const noticias = await leerArchivoMes(ruta);
  const noticia = noticias.find((n) => n.id === id);
  if (!noticia) return "no-encontrada";
  if (noticia.estado !== "pendiente") return "ya-revisada";
  noticia.estado = cambio.estado;
  if (cambio.estado === "aprobada") noticia.resumen = cambio.resumen;
  await escribirAtomico(ruta, noticias);
  return "guardada";
}

// ---------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------

export type Decision =
  | { tipo: "aprobar"; resumen: string }
  | { tipo: "descartar" }
  | { tipo: "saltar" }
  | { tipo: "salir" };

export function interpretarRespuesta(respuesta: string): Decision {
  const texto = respuesta.trim();
  if (texto === "") return { tipo: "saltar" };
  if (texto.toLowerCase() === "d") return { tipo: "descartar" };
  if (texto.toLowerCase() === "q") return { tipo: "salir" };
  return { tipo: "aprobar", resumen: texto.replace(/\s+/g, " ") };
}

/**
 * Avisos según el contrato de resúmenes (una frase, cifras en dólares). No
 * bloquean: si hay alguno se pide confirmación antes de guardar.
 */
export function avisosResumen(resumen: string): string[] {
  const avisos: string[] = [];
  if (/[.!?…]["'»”)\]]*\s+\S/u.test(resumen)) avisos.push("Parece más de una frase; el resumen debe ser una sola.");
  if (/[€£]|(?<!\p{L})(?:euros?|libras?)(?!\p{L})/iu.test(resumen)) {
    avisos.push("Las cifras van en dólares, no en euros ni libras.");
  }
  if (resumen.length > 280) avisos.push(`Es muy largo para una frase (${resumen.length} caracteres).`);
  return avisos;
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

/** Quita caracteres de control: un titular de un feed no debe poder manipular la terminal. */
function seguro(valor: unknown): string {
  return String(valor ?? "—").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function formatearFecha(valor: unknown): string {
  const ms = typeof valor === "string" ? Date.parse(valor) : Number.NaN;
  if (!Number.isFinite(ms)) return seguro(valor);
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function ficha(posicion: number, total: number, { archivo, noticia }: Pendiente): string {
  return [
    "",
    "─".repeat(60),
    `[${posicion}/${total}]  ${archivo}`,
    `Titular: ${seguro(noticia.titular)}`,
    `Medio:   ${seguro(noticia.medio)}`,
    `Fecha:   ${formatearFecha(noticia.fecha)}`,
    `Enlace:  ${seguro(noticia.enlace)}`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Bucle de revisión
// ---------------------------------------------------------------------------

export interface OpcionesRevision {
  dirNoticias: string;
  preguntar: Preguntar;
  escribir: Escribir;
}

export interface ResultadoRevision {
  aprobadas: number;
  descartadas: number;
  saltadas: number;
  /** Decisiones que no se guardaron porque la noticia cambió mientras tanto. */
  noGuardadas: number;
  /** Pendientes que quedan al terminar. */
  quedan: number;
}

export const PREGUNTA_RESUMEN = "Resumen (Enter = saltar · d = descartar · q = salir) › ";
export const PREGUNTA_CONFIRMAR = "¿Guardar así? (s/N) › ";

export async function revisarPendientes({ dirNoticias, preguntar, escribir }: OpcionesRevision): Promise<ResultadoRevision> {
  const pendientes = await listarPendientes(dirNoticias);
  const r = { aprobadas: 0, descartadas: 0, saltadas: 0, noGuardadas: 0 };
  if (pendientes.length === 0) {
    escribir("No hay noticias pendientes.\n");
    return { ...r, quedan: 0 };
  }
  escribir(
    `${pendientes.length} noticias pendientes. Escribe una frase de resumen para aprobar ` +
      `(español neutro, cifras en dólares), "d" para descartar, Enter para saltar o "q" para salir.\n`,
  );

  revision: for (const [i, pendiente] of pendientes.entries()) {
    escribir(ficha(i + 1, pendientes.length, pendiente));

    for (;;) {
      const respuesta = await preguntar(PREGUNTA_RESUMEN);
      if (respuesta === null) break revision;
      const decision = interpretarRespuesta(respuesta);
      if (decision.tipo === "salir") break revision;
      if (decision.tipo === "saltar") {
        r.saltadas++;
        break;
      }

      if (decision.tipo === "aprobar") {
        const avisos = avisosResumen(decision.resumen);
        if (avisos.length > 0) {
          for (const aviso of avisos) escribir(`  ⚠ ${aviso}\n`);
          const confirmacion = await preguntar(PREGUNTA_CONFIRMAR);
          if (confirmacion === null) break revision;
          if (!/^s[ií]?$/i.test(confirmacion.trim())) {
            escribir("  No se guardó. Escríbelo de nuevo, o pulsa Enter para saltarla.\n");
            continue;
          }
        }
      }

      const cambio: Cambio =
        decision.tipo === "aprobar" ? { estado: "aprobada", resumen: decision.resumen } : { estado: "descartada" };
      const resultado = await guardarDecision(dirNoticias, pendiente.archivo, pendiente.noticia.id, cambio);
      if (resultado === "guardada") {
        if (cambio.estado === "aprobada") r.aprobadas++;
        else r.descartadas++;
        escribir(cambio.estado === "aprobada" ? "  ✔ Aprobada.\n" : "  ✖ Descartada.\n");
      } else {
        r.noGuardadas++;
        escribir(
          resultado === "ya-revisada"
            ? "  ! No se guardó: alguien la revisó mientras tanto.\n"
            : "  ! No se guardó: la noticia ya no está en el archivo.\n",
        );
      }
      break;
    }
  }

  const quedan = (await listarPendientes(dirNoticias)).length;
  escribir(
    `\nAprobadas: ${r.aprobadas} · Descartadas: ${r.descartadas} · Saltadas: ${r.saltadas}` +
      `${r.noGuardadas ? ` · No guardadas: ${r.noGuardadas}` : ""} · Quedan pendientes: ${quedan}\n`,
  );
  return { ...r, quedan };
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

/** Lector de líneas sobre readline. Ctrl+C o Ctrl+D cierran la entrada y preguntar devuelve null. */
export function crearPreguntador(
  input: NodeJS.ReadableStream & { isTTY?: boolean },
  output: NodeJS.WritableStream,
): { preguntar: Preguntar; cerrar: () => void } {
  const rl = createInterface({ input, output, terminal: Boolean(input.isTTY) });
  const lineas = rl[Symbol.asyncIterator]();
  let cerrado = false;
  rl.on("close", () => (cerrado = true));
  rl.on("SIGINT", () => rl.close());
  return {
    async preguntar(pregunta) {
      // La entrada puede haberse cerrado ya (Ctrl+D, o stdin vacío): readline
      // lanzaría "readline was closed" al mostrar la pregunta.
      if (cerrado) return null;
      rl.setPrompt(pregunta);
      rl.prompt();
      const { value, done } = await lineas.next();
      return done ? null : (value as string);
    },
    cerrar: () => {
      if (!cerrado) rl.close();
    },
  };
}

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));

async function main(): Promise<void> {
  const { preguntar, cerrar } = crearPreguntador(process.stdin, process.stdout);
  try {
    await revisarPendientes({
      dirNoticias: join(RAIZ, "data/noticias"),
      preguntar,
      escribir: (texto) => process.stdout.write(texto),
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    cerrar();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
