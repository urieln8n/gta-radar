/**
 * npm run build:sitio: carpeta ./salida que publica el Worker gta-radar (wrangler.jsonc → assets.directory).
 *
 *   sitio/                                  la guía gratis de gta.andresrendon.com, tal cual
 *   npm run build -- --salida salida/radar  el radar
 *   → salida/
 *
 * En Cloudflare (Worker gta-radar → Configuración → Compilación): comando de compilación «npm run build:sitio»,
 * comando de implementación «npx wrangler deploy».
 *
 * Si algo no cuadra, termina con error: Cloudflare no llega a ejecutar el despliegue y sigue en línea la versión
 * anterior. Así nunca se publica el radar sin la guía. Falla si:
 *   - falta un archivo imprescindible de sitio/;
 *   - sitio/index.html no lleva el formulario de Brevo (form con action *.sibforms.com/serve/… y campo EMAIL);
 *   - existe sitio/radar (/radar lo genera el build del radar);
 *   - el radar no se genera o sale con datos de ejemplo.
 * Si todavía no existe data/noticias/ (ninguna recogida ha traído noticias), el radar sale vacío.
 */

import { spawnSync } from 'node:child_process';
import { access, cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MARCA_EJEMPLO } from '../web/sitio.ts';

const SITIO = 'sitio';
const SALIDA = 'salida';
const RADAR = `${SALIDA}/radar`;
const NOTICIAS = 'data/noticias';

/** Lo que sirve hoy gta.andresrendon.com. Si cambias el nombre de alguno (por ejemplo, el PDF), cámbialo aquí. */
const IMPRESCINDIBLES = [
  'index.html',
  'gracias.html',
  'privacidad.html',
  'styles.css',
  'favicon.svg',
  'guia-gta6-errores-novato.pdf',
  'robots.txt',
  'sitemap.xml',
  '_headers',
];

/** El formulario de alta de Brevo (lista #9) de la portada. */
const FORMULARIO_BREVO = /<form\b[^>]*\baction="https:\/\/[a-z0-9-]+\.sibforms\.com\/serve\/[^"]+"[\s\S]*?<\/form>/;

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

async function contarArchivos(dir: string): Promise<number> {
  const entradas = await readdir(dir, { recursive: true, withFileTypes: true });
  return entradas.filter((e) => e.isFile()).length;
}

/** Lanza «npm run build» con argumentos extra, para no duplicar aquí cómo se construye el radar. */
function construirRadar(argumentos: string[]): void {
  const npm = process.env.npm_execpath;
  const resultado =
    npm && /\.c?js$/.test(npm)
      ? spawnSync(process.execPath, [npm, 'run', 'build', '--', ...argumentos], { stdio: 'inherit' })
      : spawnSync(npm || 'npm', ['run', 'build', '--', ...argumentos], {
          stdio: 'inherit',
          shell: process.platform === 'win32',
        });
  if (resultado.status !== 0) throw new Error('npm run build (el radar) ha fallado.');
}

async function comprobarSitio(): Promise<void> {
  const faltan: string[] = [];
  for (const archivo of IMPRESCINDIBLES) {
    if (!(await existe(path.join(SITIO, archivo)))) faltan.push(`${SITIO}/${archivo}`);
  }
  if (faltan.length > 0) {
    throw new Error(`faltan ${faltan.join(', ')}. sitio/ debe ser la copia de la web publicada (docs/DESPLIEGUE.md).`);
  }
  const formulario = FORMULARIO_BREVO.exec(await readFile(path.join(SITIO, 'index.html'), 'utf8'));
  if (!formulario || !formulario[0].includes('name="EMAIL"')) {
    throw new Error('sitio/index.html no lleva el formulario de Brevo (action *.sibforms.com/serve/… con campo EMAIL).');
  }
  if (await existe(path.join(SITIO, 'radar'))) {
    throw new Error('sitio/radar no debe existir: /radar lo genera npm run build.');
  }
}

async function main(): Promise<void> {
  await comprobarSitio();

  let datos = NOTICIAS;
  let vacia: string | null = null;
  if (!(await existe(NOTICIAS))) {
    console.warn(`Aviso: todavía no existe ${NOTICIAS}/; el radar sale sin noticias.`);
    vacia = await mkdtemp(path.join(tmpdir(), 'gta-radar-sin-noticias-'));
    datos = vacia;
  }

  try {
    await rm(SALIDA, { recursive: true, force: true });
    construirRadar(['--datos', datos, '--salida', RADAR]);
  } finally {
    if (vacia) await rm(vacia, { recursive: true, force: true });
  }

  if (!(await existe(path.join(RADAR, 'index.html'))) || !(await existe(path.join(RADAR, 'feed.xml')))) {
    throw new Error(`el build del radar no generó ${RADAR}/index.html y ${RADAR}/feed.xml.`);
  }
  const radar = await readFile(path.join(RADAR, 'index.html'), 'utf8');
  const feed = await readFile(path.join(RADAR, 'feed.xml'), 'utf8');
  if (radar.includes('content="noindex"') || feed.includes(MARCA_EJEMPLO)) {
    throw new Error('el radar ha salido con datos de ejemplo; no se publica.');
  }

  // Entrada a entrada, para que cualquier choque de nombres con lo que generó el radar sea un error.
  for (const entrada of await readdir(SITIO)) {
    await cp(path.join(SITIO, entrada), path.join(SALIDA, entrada), { recursive: true, force: false, errorOnExist: true });
  }

  console.log(
    `Sitio: ${SALIDA}/ = ${SITIO}/ (${await contarArchivos(SITIO)} archivos) + radar/ (${await contarArchivos(RADAR)} archivos).`,
  );
}

main().catch(async (error: unknown) => {
  // Sin salida a medias: si algo falla, ./salida no queda para que un «wrangler deploy» la publique.
  await rm(SALIDA, { recursive: true, force: true });
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
