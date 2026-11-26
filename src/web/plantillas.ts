/**
 * Plantillas de la web del radar.
 *
 * Un motor mínimo, sin dependencias: {{clave}} inserta el valor escapado y
 * {{{clave}}} lo inserta tal cual (solo para HTML que ya hemos generado
 * nosotros). Si falta un valor, falla en vez de dejar el hueco vacío, para
 * que un error de nombre se vea en el build y no en la web publicada.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIR_PLANTILLAS = fileURLToPath(new URL('../../plantillas/', import.meta.url));

export interface Plantillas {
  /** Esqueleto común: cabecera, pie y metadatos. */
  base: string;
  /** Cuerpo de la portada (index.html). */
  portada: string;
  /** Cuerpo de cada página de mes. */
  mes: string;
  /** Tarjeta de una noticia. */
  noticia: string;
  estilos: string;
  favicon: string;
}

/** Caracteres de control que no son válidos en XML 1.0 (ni útiles en HTML). */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Escapa texto para HTML y XML (contenido y valores de atributos). */
export function escapar(texto: string): string {
  return texto
    .replace(CONTROL, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HUECO = /\{\{\{\s*([a-z_]+)\s*\}\}\}|\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Rellena una plantilla en una sola pasada: lo que se inserta no se vuelve a
 * interpretar, así que un titular que contenga «{{algo}}» se queda como texto.
 */
export function rellenar(plantilla: string, valores: Record<string, string>, nombre: string): string {
  return plantilla.replace(HUECO, (_hueco, crudo: string | undefined, normal: string | undefined) => {
    const clave = (crudo ?? normal) as string;
    const valor = valores[clave];
    if (valor === undefined) {
      throw new Error(`Plantilla ${nombre}: falta el valor «${clave}».`);
    }
    return crudo !== undefined ? valor : escapar(valor);
  });
}

export async function cargarPlantillas(dir: string = DIR_PLANTILLAS): Promise<Plantillas> {
  const leer = (archivo: string) => readFile(path.join(dir, archivo), 'utf8');
  const [base, portada, mes, noticia, estilos, favicon] = await Promise.all([
    leer('base.html'),
    leer('portada.html'),
    leer('mes.html'),
    leer('noticia.html'),
    leer('estilos.css'),
    leer('favicon.svg'),
  ]);
  return { base, portada, mes, noticia, estilos, favicon };
}
