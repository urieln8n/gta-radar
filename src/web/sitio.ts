/**
 * Genera los archivos de dist/radar/ a partir de las noticias.
 *
 * Función pura: recibe noticias y plantillas y devuelve un mapa
 * «ruta relativa → contenido», sin tocar el disco. build.ts lo escribe.
 * Solo salen noticias con estado «aprobada»; el filtro está aquí, en el
 * último paso antes del HTML, para que ningún llamador pueda saltárselo.
 */

import { aprobadas, type Noticia } from './datos.ts';
import { claveMes, conMayuscula, fechaRss, nombreMes, textoDia } from './fechas.ts';
import { escapar, rellenar, type Plantillas } from './plantillas.ts';

export interface OpcionesSitio {
  /** URL pública de la carpeta del radar, con barra final. */
  base: string;
  /** Noticias en la portada. */
  ultimas: number;
  /** Noticias en el feed RSS. */
  enFeed: number;
  /** Vista previa con datos inventados: aviso visible y noindex. */
  ejemplo: boolean;
}

export const OPCIONES_POR_DEFECTO: OpcionesSitio = {
  base: 'https://gta.andresrendon.com/radar/',
  ultimas: 20,
  enFeed: 50,
  ejemplo: false,
};

export const MARCA_EJEMPLO = '[EJEMPLO]';

export interface Sitio {
  archivos: Map<string, string>;
  aprobadas: number;
  meses: string[];
  ejemplo: boolean;
}

const NOMBRE = 'Radar GTA 6';
const MARCA = 'Vice City Diario';

interface Mes {
  clave: string;
  noticias: Noticia[];
}

function contar(n: number): string {
  return n === 1 ? '1 noticia' : `${n} noticias`;
}

function conPunto(frase: string): string {
  return /[.!?…»"]$/.test(frase) ? frase : `${frase}.`;
}

/** Fecha más reciente entre publicación y recogida, para lastmod. */
function ultimoCambio(lista: readonly Noticia[]): string | null {
  let max = Number.NEGATIVE_INFINITY;
  for (const n of lista) max = Math.max(max, Date.parse(n.fecha), Date.parse(n.recogida));
  return Number.isFinite(max) ? new Date(max).toISOString() : null;
}

function agruparPorMes(lista: readonly Noticia[]): Mes[] {
  const mapa = new Map<string, Noticia[]>();
  for (const n of lista) {
    const clave = claveMes(new Date(n.fecha));
    const grupo = mapa.get(clave);
    if (grupo) grupo.push(n);
    else mapa.set(clave, [n]);
  }
  return [...mapa.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([clave, noticias]) => ({ clave, noticias }));
}

export function generarSitio(
  todas: readonly Noticia[],
  plantillas: Plantillas,
  opcionesParciales: Partial<OpcionesSitio> = {},
): Sitio {
  const opciones = { ...OPCIONES_POR_DEFECTO, ...opcionesParciales };
  const base = new URL(opciones.base.endsWith('/') ? opciones.base : `${opciones.base}/`).href;
  const sitio = new URL('../', base).href;

  const lista = aprobadas(todas);
  const meses = agruparPorMes(lista);
  // Red de seguridad: los datos de ejemplo nunca salen como si fueran reales.
  const ejemplo = opciones.ejemplo || lista.some((n) => n.titular.startsWith(MARCA_EJEMPLO));

  const tarjeta = (n: Noticia, nivel: 'h2' | 'h3') => {
    const fecha = new Date(n.fecha);
    return rellenar(
      plantillas.noticia,
      {
        nivel,
        ancla: `n-${n.id.slice(0, 12)}`,
        titular: n.titular,
        medio: n.medio,
        fecha_iso: fecha.toISOString(),
        fecha_texto: textoDia(fecha),
        enlace: n.enlace,
        frase: n.resumen ? `<p class="noticia__frase">${escapar(n.resumen)}</p>` : '',
      },
      'noticia.html',
    ).trim();
  };

  const listado = (noticias: readonly Noticia[], nivel: 'h2' | 'h3') =>
    noticias.length === 0
      ? '<p class="vacio">Todavía no hay noticias publicadas. Vuelve pronto.</p>'
      : `<ol class="noticias">\n${noticias.map((n) => tarjeta(n, nivel)).join('\n')}\n</ol>`;

  const pagina = (datos: { titulo: string; descripcion: string; ruta: string; raiz: string; contenido: string }) =>
    rellenar(
      plantillas.base,
      {
        titulo: datos.titulo,
        descripcion: datos.descripcion,
        canonica: new URL(datos.ruta, base).href,
        raiz: datos.raiz,
        sitio,
        nombre: NOMBRE,
        marca: MARCA,
        contenido: datos.contenido,
        robots: ejemplo ? '<meta name="robots" content="noindex">' : '',
        aviso: ejemplo
          ? '<p class="aviso-ejemplo" role="note">Vista previa con datos de ejemplo: los titulares son inventados. No publicar.</p>'
          : '',
      },
      'base.html',
    ).replace(/\n[ \t]*(?=\n)/g, ''); // quita las líneas que dejan vacías los huecos opcionales

  const archivos = new Map<string, string>();

  // Portada: lo último + archivo por mes.
  const masReciente = lista[0];
  const actualizado = masReciente
    ? `<p class="actualizado">Última noticia: <time datetime="${new Date(masReciente.fecha).toISOString()}">${escapar(
        textoDia(new Date(masReciente.fecha)),
      )}</time></p>`
    : '';
  const archivo =
    meses.length === 0
      ? ''
      : [
          '<nav class="seccion archivo" aria-labelledby="archivo">',
          '  <h2 class="seccion__titulo" id="archivo">Archivo por mes</h2>',
          '  <ul>',
          ...meses.map(
            (m) =>
              `    <li><a href="${m.clave}/">${escapar(conMayuscula(nombreMes(m.clave)))} <span>${contar(
                m.noticias.length,
              )}</span></a></li>`,
          ),
          '  </ul>',
          '</nav>',
        ].join('\n');

  archivos.set(
    'index.html',
    pagina({
      titulo: `${NOMBRE}: lo último en noticias · ${MARCA}`,
      descripcion: `Lo último de GTA 6 en un vistazo: titulares elegidos a mano, una frase de contexto y el enlace a cada medio. De ${MARCA}, canal de fans.`,
      ruta: '',
      raiz: './',
      contenido: rellenar(
        plantillas.portada,
        { actualizado, noticias: listado(lista.slice(0, opciones.ultimas), 'h3'), archivo },
        'portada.html',
      ),
    }),
  );

  // Una página por mes, de la noticia más reciente a la más antigua.
  meses.forEach((mes, i) => {
    const nombre = nombreMes(mes.clave);
    const enlaceMes = (otro: Mes | undefined, rel: 'prev' | 'next') => {
      if (!otro) return '<span></span>';
      const texto = escapar(conMayuscula(nombreMes(otro.clave)));
      return rel === 'prev'
        ? `<a href="../${otro.clave}/" rel="prev">← ${texto}</a>`
        : `<a href="../${otro.clave}/" rel="next">${texto} →</a>`;
    };
    const anterior = meses[i + 1];
    const siguiente = meses[i - 1];
    const paginacion =
      anterior || siguiente
        ? `<nav class="paginacion" aria-label="Otros meses">\n  ${enlaceMes(anterior, 'prev')}\n  ${enlaceMes(siguiente, 'next')}\n</nav>`
        : '';

    archivos.set(
      `${mes.clave}/index.html`,
      pagina({
        titulo: `Noticias de GTA 6 de ${nombre} · Radar · ${MARCA}`,
        descripcion: `Noticias de GTA 6 de ${nombre}: ${contar(mes.noticias.length)} con una frase de contexto y el enlace a cada medio.`,
        ruta: `${mes.clave}/`,
        raiz: '../',
        contenido: rellenar(
          plantillas.mes,
          {
            mes: conMayuscula(nombre),
            mes_minuscula: nombre,
            entradilla: `${conMayuscula(contar(mes.noticias.length))} de GTA 6 elegidas a mano, de la más reciente a la más antigua.`,
            noticias: listado(mes.noticias, 'h2'),
            paginacion,
          },
          'mes.html',
        ),
      }),
    );
  });

  // Feed RSS 2.0: enlaza a cada artículo original.
  const tituloFeed = `${ejemplo ? `${MARCA_EJEMPLO} ` : ''}${NOMBRE} · ${MARCA}`;
  const items = lista.slice(0, opciones.enFeed).map((n) => {
    const descripcion = n.resumen ? `${conPunto(n.resumen)} Vía ${n.medio}.` : `Vía ${n.medio}.`;
    return [
      '    <item>',
      `      <title>${escapar(n.titular)}</title>`,
      `      <link>${escapar(n.enlace)}</link>`,
      `      <guid isPermaLink="false">${n.id}</guid>`,
      `      <pubDate>${fechaRss(new Date(n.fecha))}</pubDate>`,
      `      <description>${escapar(descripcion)}</description>`,
      '    </item>',
    ].join('\n');
  });
  archivos.set(
    'feed.xml',
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
      '  <channel>',
      `    <title>${escapar(tituloFeed)}</title>`,
      `    <link>${escapar(base)}</link>`,
      `    <atom:link href="${escapar(new URL('feed.xml', base).href)}" rel="self" type="application/rss+xml"/>`,
      `    <description>Titulares de GTA 6 elegidos a mano, con una frase de contexto y el enlace a cada medio. ${MARCA} es un canal de fans, no afiliado a Rockstar Games ni Take-Two.</description>`,
      '    <language>es</language>',
      ...(masReciente ? [`    <lastBuildDate>${fechaRss(new Date(masReciente.fecha))}</lastBuildDate>`] : []),
      ...items,
      '  </channel>',
      '</rss>',
      '',
    ].join('\n'),
  );

  // Sitemap: solo URLs bajo /radar/ (es lo único que puede listar desde aquí).
  const url = (ruta: string, lastmod: string | null) =>
    `  <url><loc>${escapar(new URL(ruta, base).href)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  archivos.set(
    'sitemap.xml',
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      url('', ultimoCambio(lista.slice(0, opciones.ultimas))),
      ...meses.map((m) => url(`${m.clave}/`, ultimoCambio(m.noticias))),
      '</urlset>',
      '',
    ].join('\n'),
  );

  archivos.set('estilos.css', plantillas.estilos);
  archivos.set('favicon.svg', plantillas.favicon);

  return { archivos, aprobadas: lista.length, meses: meses.map((m) => m.clave), ejemplo };
}
