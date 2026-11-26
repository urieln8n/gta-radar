/**
 * Cliente HTTP de gta-radar.
 *
 * Adaptado de ai-market/src/sources/http.ts: reintentos con backoff
 * exponencial que respetan las cabeceras de límite (retry-after,
 * x-ratelimit-remaining/reset) en vez de martillar al servidor, y que nunca
 * reintentan para siempre. Añade lo que necesita un lector de feeds de medios:
 *
 * - tiempo máximo por intento (incluida la lectura del cuerpo),
 * - tamaño máximo de respuesta, comprobado mientras se lee,
 * - espera máxima: si el servidor pide esperar más, se abandona esa fuente
 *   en lugar de bloquear la ejecución o ignorar su límite,
 * - User-Agent genérico e identificable,
 * - detección de charset (cabecera HTTP o declaración XML),
 * - fetch y sleep inyectables para probar sin red y sin esperas reales.
 */

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export interface OpcionesPeticion {
  fetchFn?: FetchFn;
  sleepFn?: SleepFn;
  /** Reintentos después del primer intento. Por defecto 3 (4 intentos como máximo). */
  maxReintentos?: number;
  /** Base del backoff exponencial cuando el servidor no indica cuánto esperar. */
  baseEsperaMs?: number;
  /** Si el servidor pide esperar más que esto, se abandona en vez de esperar. */
  maxEsperaMs?: number;
  /** Tiempo máximo de cada intento, incluida la lectura del cuerpo. */
  timeoutMs?: number;
  /** Tamaño máximo de la respuesta en bytes. */
  maxBytes?: number;
  headers?: Record<string, string>;
}

export const USER_AGENT = "gta-radar/0.1 (lector de titulares RSS)";

export const LIMITES_POR_DEFECTO = {
  maxReintentos: 3,
  baseEsperaMs: 500,
  maxEsperaMs: 60_000,
  timeoutMs: 15_000,
  maxBytes: 5 * 1024 * 1024,
} as const;

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

export class LimiteTamanoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimiteTamanoError";
  }
}

const dormir: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 408, 429 y 5xx son transitorios; el resto de errores no se reintenta. */
export function esReintentable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Cuánto pide esperar el servidor según sus cabeceras, o null si no dice nada.
 * Acepta retry-after en segundos o como fecha HTTP, y x-ratelimit-reset como
 * segundos epoch o como segundos restantes.
 */
export function esperaPedidaPorServidor(response: Response, ahoraMs = Date.now()): number | null {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const segundos = Number(retryAfter);
    if (Number.isFinite(segundos) && segundos >= 0) return segundos * 1000;
    const fecha = Date.parse(retryAfter);
    if (Number.isFinite(fecha)) return Math.max(0, fecha - ahoraMs);
  }
  const restantes = response.headers.get("x-ratelimit-remaining")?.trim();
  const reinicio = Number(response.headers.get("x-ratelimit-reset"));
  if (restantes === "0" && Number.isFinite(reinicio) && reinicio > 0) {
    const esperaMs = reinicio > 1e9 ? reinicio * 1000 - ahoraMs : reinicio * 1000;
    if (esperaMs > 0) return esperaMs;
  }
  return null;
}

/** Backoff exponencial con algo de aleatoriedad para no sincronizar reintentos. */
export function backoffMs(intento: number, baseEsperaMs: number): number {
  return baseEsperaMs * 2 ** intento + Math.floor(Math.random() * 250);
}

/**
 * Libera el cuerpo sin esperar: cancelar un stream puede no resolverse nunca
 * (p. ej. si está bifurcado con tee/clone) y eso no debe colgar la recogida.
 */
function descartarCuerpo(response: Response): void {
  if (!response.body || response.bodyUsed) return;
  response.body.cancel().catch(() => {});
}

function describirError(err: unknown, timeoutMs: number): Error {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return new Error(`tiempo agotado (${timeoutMs} ms)`, { cause: err });
    return err;
  }
  return new Error(String(err));
}

/** Hace un GET reintentando ante 408/429/5xx y errores de red, con límites. */
export async function pedirConReintentos(url: string, opciones: OpcionesPeticion = {}): Promise<Response> {
  const fetchFn = opciones.fetchFn ?? fetch;
  const sleepFn = opciones.sleepFn ?? dormir;
  const maxReintentos = opciones.maxReintentos ?? LIMITES_POR_DEFECTO.maxReintentos;
  const baseEsperaMs = opciones.baseEsperaMs ?? LIMITES_POR_DEFECTO.baseEsperaMs;
  const maxEsperaMs = opciones.maxEsperaMs ?? LIMITES_POR_DEFECTO.maxEsperaMs;
  const timeoutMs = opciones.timeoutMs ?? LIMITES_POR_DEFECTO.timeoutMs;
  const headers = { "user-agent": USER_AGENT, ...opciones.headers };

  let ultimoError: Error | undefined;
  for (let intento = 0; intento <= maxReintentos; intento++) {
    let response: Response;
    try {
      response = await fetchFn(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      ultimoError = describirError(err, timeoutMs);
      if (intento === maxReintentos) break;
      await sleepFn(Math.min(backoffMs(intento, baseEsperaMs), maxEsperaMs));
      continue;
    }

    if (esReintentable(response.status)) {
      descartarCuerpo(response);
      if (intento === maxReintentos) {
        throw new HttpError(response.status, url, `Abandono tras ${intento + 1} intentos (último estado ${response.status})`);
      }
      const pedida = esperaPedidaPorServidor(response);
      if (pedida !== null && pedida > maxEsperaMs) {
        throw new HttpError(
          response.status,
          url,
          `El servidor pide esperar ${Math.ceil(pedida / 1000)} s (máximo ${Math.ceil(maxEsperaMs / 1000)} s); se abandona para respetar su límite`,
        );
      }
      await sleepFn(pedida ?? Math.min(backoffMs(intento, baseEsperaMs), maxEsperaMs));
      continue;
    }

    if (!response.ok) {
      descartarCuerpo(response);
      throw new HttpError(response.status, url, `La petición falló con estado ${response.status}`);
    }
    return response;
  }
  const motivo = ultimoError ?? new Error("error desconocido");
  throw new Error(`Abandono tras ${maxReintentos + 1} intentos: ${motivo.message}`, { cause: motivo });
}

function etiquetaCharset(bytes: Uint8Array, contentType: string | null): string {
  const deCabecera = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
  if (deCabecera) return deCabecera;
  const inicio = new TextDecoder("latin1").decode(bytes.subarray(0, 256));
  return /<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/i.exec(inicio)?.[1] ?? "utf-8";
}

function decodificar(bytes: Uint8Array, contentType: string | null): string {
  try {
    return new TextDecoder(etiquetaCharset(bytes, contentType)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Lee el cuerpo como texto sin pasar de maxBytes (corta la descarga si se excede). */
export async function leerTextoConLimite(response: Response, maxBytes: number): Promise<string> {
  const declarada = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declarada) && declarada > maxBytes) {
    descartarCuerpo(response);
    throw new LimiteTamanoError(`La respuesta declara ${declarada} bytes (máximo ${maxBytes})`);
  }
  if (!response.body) return "";

  const lector = response.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      lector.cancel().catch(() => {});
      throw new LimiteTamanoError(`La respuesta supera el máximo de ${maxBytes} bytes`);
    }
    trozos.push(value);
  }
  return decodificar(Buffer.concat(trozos), response.headers.get("content-type"));
}

/** GET con reintentos y límites, devolviendo el cuerpo como texto. */
export async function descargarTexto(url: string, opciones: OpcionesPeticion = {}): Promise<string> {
  const response = await pedirConReintentos(url, opciones);
  return leerTextoConLimite(response, opciones.maxBytes ?? LIMITES_POR_DEFECTO.maxBytes);
}
