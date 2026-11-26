/**
 * npm run build: data/noticias/*.json → dist/radar/
 *
 *   npm run build
 *   npm run build -- --datos test/fixtures/noticias          (vista previa con datos de ejemplo)
 *   npm run build -- --base http://localhost:8080/radar/     (URLs absolutas para otra dirección)
 *
 * Opciones: --datos <carpeta> (data/noticias), --salida <carpeta> (dist/radar),
 * --base <url> (o RADAR_URL_BASE; https://gta.andresrendon.com/radar/),
 * --ultimas <n> (20), --ejemplo (fuerza el aviso de datos de ejemplo).
 *
 * El resultado es estático y autocontenido: se copia tal cual en /radar de la
 * web publicada. Es determinista (sin fecha de build), así que si las noticias
 * no cambian, los archivos tampoco.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { leerNoticias } from './datos.ts';
import { cargarPlantillas } from './plantillas.ts';
import { generarSitio, OPCIONES_POR_DEFECTO } from './sitio.ts';

function rutaDentroDelProyecto(ruta: string, raiz: string): string {
  const absoluta = path.resolve(raiz, ruta);
  const relativa = path.relative(raiz, absoluta);
  if (relativa === '' || relativa.startsWith('..') || path.isAbsolute(relativa)) {
    throw new Error(`--salida debe ser una subcarpeta del proyecto (recibido: ${ruta}).`);
  }
  return absoluta;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      datos: { type: 'string', default: 'data/noticias' },
      salida: { type: 'string', default: 'dist/radar' },
      base: { type: 'string' },
      ultimas: { type: 'string', default: String(OPCIONES_POR_DEFECTO.ultimas) },
      ejemplo: { type: 'boolean', default: false },
    },
  });

  const raiz = process.cwd();
  const salida = rutaDentroDelProyecto(values.salida, raiz);
  const datos = path.resolve(raiz, values.datos);
  const base = values.base ?? process.env.RADAR_URL_BASE ?? OPCIONES_POR_DEFECTO.base;
  const ultimas = Number.parseInt(values.ultimas, 10);
  if (!Number.isInteger(ultimas) || ultimas < 1) throw new Error('--ultimas debe ser un número mayor que 0.');

  const lectura = await leerNoticias(datos);
  for (const aviso of lectura.avisos) console.warn(`Aviso: ${aviso}`);

  const sitio = generarSitio(lectura.noticias, await cargarPlantillas(), { base, ultimas, ejemplo: values.ejemplo });

  await rm(salida, { recursive: true, force: true });
  for (const [ruta, contenido] of sitio.archivos) {
    const destino = path.join(salida, ruta);
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, contenido, 'utf8');
  }

  const meses = sitio.meses.length ? sitio.meses.join(', ') : 'ninguno';
  console.log(
    `Radar: ${sitio.aprobadas} aprobadas de ${lectura.noticias.length} noticias válidas ` +
      `(${lectura.archivos} archivos). Meses: ${meses}. ${sitio.archivos.size} archivos en ${path.relative(raiz, salida)}/`,
  );
  if (sitio.ejemplo) {
    console.warn('Aviso: datos de ejemplo. Las páginas llevan aviso visible y noindex: no publicar este build.');
  }
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
