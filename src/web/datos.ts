/**
 * Lectura y validación de data/noticias/AAAA-MM.json para la web.
 *
 * La web confía lo menos posible en los datos: cada noticia se comprueba
 * contra el contrato común y las que no lo cumplen se saltan con un aviso
 * (un enlace javascript: o una fecha rota nunca llegan al HTML). Un archivo
 * que no es JSON válido, en cambio, detiene el build: es mejor no publicar
 * que publicar un radar al que le falta un mes entero.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const ESTADOS = ['pendiente', 'aprobada', 'descartada'] as const;
export type Estado = (typeof ESTADOS)[number];

export interface Noticia {
  /** sha1 del enlace canónico. */
  id: string;
  titular: string;
  medio: string;
  /** ISO 8601. */
  fecha: string;
  enlace: string;
  /** Nuestra frase (una sola, en español neutro) o null si aún no hay. */
  resumen: string | null;
  estado: Estado;
  /** ISO 8601. */
  recogida: string;
}

export interface Lectura {
  noticias: Noticia[];
  avisos: string[];
  archivos: number;
}

const ARCHIVO_MES = /^\d{4}-(0[1-9]|1[0-2])\.json$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const SHA1 = /^[0-9a-f]{40}$/;

function textoLimpio(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.replace(/\s+/g, ' ').trim();
  return limpio === '' ? null : limpio;
}

function fechaIso(valor: unknown): string | null {
  if (typeof valor !== 'string' || !ISO.test(valor)) return null;
  return Number.isNaN(Date.parse(valor)) ? null : valor;
}

export type Validacion = { ok: true; noticia: Noticia } | { ok: false; error: string };

export function validarNoticia(valor: unknown): Validacion {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    return { ok: false, error: 'no es un objeto' };
  }
  const n = valor as Record<string, unknown>;

  if (typeof n.id !== 'string' || !SHA1.test(n.id)) return { ok: false, error: 'id no es un sha1' };

  const titular = textoLimpio(n.titular);
  if (!titular) return { ok: false, error: 'falta el titular' };

  const medio = textoLimpio(n.medio);
  if (!medio) return { ok: false, error: 'falta el medio' };

  const fecha = fechaIso(n.fecha);
  if (!fecha) return { ok: false, error: 'fecha no es ISO 8601' };

  const recogida = fechaIso(n.recogida);
  if (!recogida) return { ok: false, error: 'recogida no es ISO 8601' };

  if (typeof n.enlace !== 'string') return { ok: false, error: 'falta el enlace' };
  let url: URL;
  try {
    url = new URL(n.enlace);
  } catch {
    return { ok: false, error: 'enlace no es una URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: `enlace con protocolo no permitido (${url.protocol})` };
  }

  if (n.resumen !== null && typeof n.resumen !== 'string') {
    return { ok: false, error: 'resumen no es null ni texto' };
  }

  if (typeof n.estado !== 'string' || !(ESTADOS as readonly string[]).includes(n.estado)) {
    return { ok: false, error: `estado desconocido (${String(n.estado)})` };
  }

  return {
    ok: true,
    noticia: {
      id: n.id,
      titular,
      medio,
      fecha,
      enlace: n.enlace,
      resumen: textoLimpio(n.resumen),
      estado: n.estado as Estado,
      recogida,
    },
  };
}

/** Lee todos los AAAA-MM.json de una carpeta. Falla si la carpeta no existe. */
export async function leerNoticias(dir: string): Promise<Lectura> {
  let nombres: string[];
  try {
    nombres = await readdir(dir);
  } catch (error) {
    throw new Error(`No se puede leer la carpeta de noticias «${dir}»: ${(error as Error).message}`);
  }

  const avisos: string[] = [];
  const porId = new Map<string, Noticia>();
  let archivos = 0;

  for (const nombre of nombres.filter((n) => n.endsWith('.json')).sort()) {
    if (!ARCHIVO_MES.test(nombre)) {
      avisos.push(`${nombre}: se ignora (el nombre debe ser AAAA-MM.json).`);
      continue;
    }
    archivos++;
    const ruta = path.join(dir, nombre);
    let contenido: unknown;
    try {
      contenido = JSON.parse(await readFile(ruta, 'utf8'));
    } catch (error) {
      throw new Error(`${ruta} no es JSON válido: ${(error as Error).message}`);
    }
    if (!Array.isArray(contenido)) throw new Error(`${ruta} debe contener una lista de noticias.`);

    contenido.forEach((elemento, i) => {
      const resultado = validarNoticia(elemento);
      if (!resultado.ok) {
        avisos.push(`${nombre}[${i}]: se salta (${resultado.error}).`);
        return;
      }
      const { noticia } = resultado;
      const previa = porId.get(noticia.id);
      if (previa) {
        avisos.push(`${nombre}[${i}]: id repetido ${noticia.id.slice(0, 10)}…, se queda la recogida más reciente.`);
        if (Date.parse(previa.recogida) >= Date.parse(noticia.recogida)) return;
      }
      porId.set(noticia.id, noticia);
    });
  }

  return { noticias: [...porId.values()], avisos, archivos };
}

/** Solo las aprobadas, de la más reciente a la más antigua (orden estable). */
export function aprobadas(noticias: readonly Noticia[]): Noticia[] {
  return noticias
    .filter((n) => n.estado === 'aprobada')
    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha) || a.id.localeCompare(b.id));
}
