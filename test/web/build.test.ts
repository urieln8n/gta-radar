import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { aprobadas, leerNoticias, validarNoticia, type Noticia } from '../../src/web/datos.ts';
import { claveMes, textoDia } from '../../src/web/fechas.ts';
import { cargarPlantillas, escapar, rellenar } from '../../src/web/plantillas.ts';
import { generarSitio } from '../../src/web/sitio.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = path.join(RAIZ, 'test/fixtures/noticias');
const PIE = 'Canal de fans, no afiliado a Rockstar Games ni Take-Two';

const noticiaBase: Noticia = {
  id: 'a'.repeat(40),
  titular: 'Titular real de prueba',
  medio: 'Medio',
  fecha: '2026-11-20T12:00:00Z',
  enlace: 'https://example.com/a',
  resumen: 'Una frase.',
  estado: 'aprobada',
  recogida: '2026-11-20T13:00:00Z',
};

async function sitioDeFixtures() {
  const { noticias, avisos } = await leerNoticias(FIXTURES);
  const sitio = generarSitio(noticias, await cargarPlantillas());
  return { noticias, avisos, sitio };
}

function paginasHtml(archivos: Map<string, string>): [string, string][] {
  return [...archivos].filter(([ruta]) => ruta.endsWith('.html'));
}

describe('datos', () => {
  it('lee los fixtures sin avisos y todos van marcados como ejemplo', async () => {
    const { noticias, avisos } = await leerNoticias(FIXTURES);
    assert.deepEqual(avisos, []);
    assert.equal(noticias.length, 9);
    for (const n of noticias) assert.ok(n.titular.startsWith('[EJEMPLO]'), n.titular);
  });

  it('rechaza enlaces que no son http(s), ids que no son sha1 y estados desconocidos', () => {
    assert.equal(validarNoticia({ ...noticiaBase, enlace: 'javascript:alert(1)' }).ok, false);
    assert.equal(validarNoticia({ ...noticiaBase, enlace: 'data:text/html,hola' }).ok, false);
    assert.equal(validarNoticia({ ...noticiaBase, id: 'corto' }).ok, false);
    assert.equal(validarNoticia({ ...noticiaBase, estado: 'publicada' }).ok, false);
    assert.equal(validarNoticia({ ...noticiaBase, fecha: 'ayer' }).ok, false);
    assert.equal(validarNoticia({ ...noticiaBase, resumen: 3 }).ok, false);
    assert.equal(validarNoticia(noticiaBase).ok, true);
  });

  it('un resumen vacío cuenta como null', () => {
    const r = validarNoticia({ ...noticiaBase, resumen: '   ' });
    assert.ok(r.ok);
    assert.equal(r.noticia.resumen, null);
  });

  it('aprobadas() deja solo las aprobadas, de la más reciente a la más antigua', () => {
    const lista = aprobadas([
      { ...noticiaBase, id: '1'.repeat(40), fecha: '2026-11-01T00:00:00Z' },
      { ...noticiaBase, id: '2'.repeat(40), fecha: '2026-11-03T00:00:00Z' },
      { ...noticiaBase, id: '3'.repeat(40), estado: 'pendiente' },
      { ...noticiaBase, id: '4'.repeat(40), estado: 'descartada' },
    ]);
    assert.deepEqual(
      lista.map((n) => n.id[0]),
      ['2', '1'],
    );
  });

  it('falla si la carpeta no existe (no publica un radar vacío por error)', async () => {
    await assert.rejects(leerNoticias(path.join(RAIZ, 'no-existe')), /No se puede leer/);
  });
});

describe('fechas', () => {
  it('agrupa y muestra en hora de Ciudad de México', () => {
    const madrugada = new Date('2026-11-01T03:00:00Z');
    assert.equal(claveMes(madrugada), '2026-10');
    assert.equal(textoDia(madrugada), '31 oct 2026');
  });
});

describe('plantillas', () => {
  it('escapa por defecto y no reinterpreta lo insertado', () => {
    assert.equal(rellenar('<p>{{x}}</p>', { x: '<b>{{y}}</b>' }, 't'), '<p>&lt;b&gt;{{y}}&lt;/b&gt;</p>');
    assert.equal(rellenar('{{{x}}}', { x: '<b>' }, 't'), '<b>');
    assert.throws(() => rellenar('{{falta}}', {}, 't'), /falta el valor/);
    assert.equal(escapar('a\u0000b'), 'ab');
  });
});

describe('sitio', () => {
  it('genera portada, una página por mes, feed, sitemap, CSS y favicon', async () => {
    const { sitio } = await sitioDeFixtures();
    assert.deepEqual([...sitio.archivos.keys()].sort(), [
      '2026-10/index.html',
      '2026-11/index.html',
      'estilos.css',
      'favicon.svg',
      'feed.xml',
      'index.html',
      'sitemap.xml',
    ]);
    assert.equal(sitio.aprobadas, 7);
  });

  it('nunca muestra pendientes ni descartadas', async () => {
    const { sitio } = await sitioDeFixtures();
    for (const [ruta, contenido] of sitio.archivos) {
      assert.ok(!contenido.includes('no debe salir'), ruta);
    }
  });

  it('cada noticia lleva titular, medio, fecha, frase y «Leer en <medio>» con rel="noopener"', async () => {
    const { sitio } = await sitioDeFixtures();
    const portada = sitio.archivos.get('index.html') ?? '';
    const tarjetas = portada.match(/<li class="noticia">[\s\S]*?<\/li>/g) ?? [];
    assert.equal(tarjetas.length, 7);
    for (const t of tarjetas) {
      assert.match(t, /class="noticia__titular"/);
      assert.match(t, /class="noticia__medio"/);
      assert.match(t, /<time datetime="[^"]+">\d{1,2} [a-z]{3} \d{4}<\/time>/);
      assert.match(t, /<a class="noticia__leer" href="https?:\/\/[^"]+" target="_blank" rel="noopener"[^>]*>Leer en /);
    }
    // 6 de las 7 aprobadas tienen frase.
    assert.equal(portada.match(/class="noticia__frase"/g)?.length, 6);
  });

  it('todas las páginas llevan el pie de canal de fans', async () => {
    const { sitio } = await sitioDeFixtures();
    for (const [ruta, html] of paginasHtml(sitio.archivos)) assert.ok(html.includes(PIE), ruta);
  });

  it('escapa titulares, medios, frases y enlaces', async () => {
    const { sitio } = await sitioDeFixtures();
    const nov = sitio.archivos.get('2026-11/index.html') ?? '';
    assert.ok(nov.includes('&quot;Comillas&quot;, &lt;etiquetas&gt; &amp; símbolos'));
    assert.ok(nov.includes('Leer en Diario &lt;Ficticio&gt; &amp; Cía'));
    assert.ok(nov.includes('href="https://example.net/prueba?a=1&amp;b=2"'));
    assert.ok(!nov.includes('<etiquetas>'));
    assert.ok(!nov.includes('<b>etiquetas</b>'));
  });

  it('el feed y el sitemap son XML sin & sueltos', async () => {
    const { sitio } = await sitioDeFixtures();
    for (const ruta of ['feed.xml', 'sitemap.xml']) {
      const xml = sitio.archivos.get(ruta) ?? '';
      assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), ruta);
      assert.doesNotMatch(xml, /&(?!amp;|lt;|gt;|quot;|#39;)/, ruta);
    }
    const feed = sitio.archivos.get('feed.xml') ?? '';
    assert.equal(feed.match(/<item>/g)?.length, 7);
    assert.match(feed, /<atom:link href="https:\/\/gta\.andresrendon\.com\/radar\/feed\.xml" rel="self"/);
    const sitemap = sitio.archivos.get('sitemap.xml') ?? '';
    assert.equal(sitemap.match(/<loc>https:\/\/gta\.andresrendon\.com\/radar\/[^<]*<\/loc>/g)?.length, 3);
  });

  it('los datos de ejemplo salen con aviso y noindex; los reales no', async () => {
    const plantillas = await cargarPlantillas();
    const { sitio } = await sitioDeFixtures();
    assert.equal(sitio.ejemplo, true);
    for (const [ruta, html] of paginasHtml(sitio.archivos)) {
      assert.ok(html.includes('<meta name="robots" content="noindex">'), ruta);
      assert.ok(html.includes('class="aviso-ejemplo"'), ruta);
    }
    const real = generarSitio([noticiaBase], plantillas);
    assert.equal(real.ejemplo, false);
    const html = real.archivos.get('index.html') ?? '';
    assert.ok(!html.includes('noindex'));
    assert.ok(!html.includes('aviso-ejemplo'));
  });

  it('sin noticias aprobadas genera una portada vacía y un feed sin items', async () => {
    const sitio = generarSitio([{ ...noticiaBase, estado: 'pendiente' }], await cargarPlantillas());
    assert.deepEqual(sitio.meses, []);
    assert.match(sitio.archivos.get('index.html') ?? '', /Todavía no hay noticias publicadas/);
    assert.doesNotMatch(sitio.archivos.get('feed.xml') ?? '', /<item>/);
  });

  it('las páginas de mes enlazan al mes anterior y al siguiente', async () => {
    const { sitio } = await sitioDeFixtures();
    assert.match(sitio.archivos.get('2026-10/index.html') ?? '', /href="\.\.\/2026-11\/" rel="next"/);
    assert.match(sitio.archivos.get('2026-11/index.html') ?? '', /href="\.\.\/2026-10\/" rel="prev"/);
  });
});

describe('npm run build', () => {
  it('escribe dist en la carpeta pedida y rechaza salidas fuera del proyecto', async () => {
    const ejecutar = promisify(execFile);
    // Se ejecuta desde una carpeta temporal: tsx se pasa por ruta absoluta.
    const tsx = ['--import', import.meta.resolve('tsx'), path.join(RAIZ, 'src/web/build.ts')];
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'radar-'));
    try {
      await ejecutar(process.execPath, [...tsx, '--datos', FIXTURES, '--salida', 'salida/radar'], { cwd: tmp });
      const escritos = await readdir(path.join(tmp, 'salida/radar'), { recursive: true });
      assert.ok(escritos.includes('index.html'));
      assert.match(await readFile(path.join(tmp, 'salida/radar/2026-11/index.html'), 'utf8'), /Noviembre de 2026/);

      await assert.rejects(
        ejecutar(process.execPath, [...tsx, '--datos', FIXTURES, '--salida', '..'], { cwd: tmp }),
        /subcarpeta del proyecto/,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
