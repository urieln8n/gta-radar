import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  canonizarEnlace,
  decodificarEntidades,
  esSobreGta6,
  fechaIso,
  idDeEnlace,
  palabraProhibida,
  parsearFeed,
  seleccionarFuentesRss,
} from "../../src/recoger/noticias.ts";

describe("esSobreGta6", () => {
  for (const titular of [
    "GTA 6: nueva fecha",
    "Así es el mapa de GTA VI",
    "gta6 en PS5",
    "#GTAVI es tendencia",
    "GTA-6 y su precio",
    "Grand Theft Auto VI ya tiene tráiler",
    "Grand Theft Auto 6, lo que sabemos",
    "¿Cuánto costará GTA 6?",
  ]) {
    it(`acepta «${titular}»`, () => assert.equal(esSobreGta6(titular), true));
  }

  for (const titular of [
    "GTA 5 recibe una actualización",
    "Grand Theft Auto V cumple años",
    "GTA Vice City Definitive Edition",
    "GTA VII ya se rumorea",
    "GTA 60 fps",
    "Red Dead Redemption 3",
  ]) {
    it(`rechaza «${titular}»`, () => assert.equal(esSobreGta6(titular), false));
  }
});

describe("palabraProhibida", () => {
  const casos: Array<[string, string]> = [
    ["Filtración de GTA 6 muestra el mapa", "filtración"],
    ["Nuevas FILTRACIONES de GTA VI", "filtración"],
    ["Se filtran imágenes de GTA 6", "filtración"],
    ["GTA 6: tráiler filtrado", "filtración"],
    ["Filtracion sin tilde de GTA 6", "filtración"],
    ["Un exempleado filtró el mapa de GTA 6", "filtración"],
    ["GTA VI: ¿QUIÉN FILTRÓ EL TRÁILER?", "filtración"],
    ["Rockstar dice quién filtró GTA 6", "filtración"], // "ó" en forma descompuesta (NFD)
    ["GTA 6 leak shows map", "leak"],
    ["GTA VI leaked footage", "leak"],
    ["El mejor mod menu de GTA 6", "mod menu"],
    ["Mod menú gratis para GTA 6", "mod menu"],
    ["GTA 6 modmenu", "mod menu"],
    ["Cheats de GTA 6", "cheat"],
    ["GTA 6 cheat codes", "cheat"],
    ["Códigos de GTA VI", "código"],
    ["codigos gta 6 ps5", "código"],
    ["GTA 6 crack para PC", "crack"],
    ["GTA 6 crackeado", "crack"],
  ];
  for (const [texto, palabra] of casos) {
    it(`descarta «${texto}» por ${palabra}`, () => assert.equal(palabraProhibida(texto), palabra));
  }

  for (const texto of [
    "Truco para ganar dinero en GTA 6",
    "5 trucos para empezar GTA VI",
    "GTA 6: los mejores consejos",
    "Rockstar confirma el filtro de fotos de GTA 6",
    "GTA 6 tendrá un FILTRO nuevo en el modo foto",
    "Los filtros del modo foto de GTA VI",
  ]) {
    it(`no descarta «${texto}»`, () => assert.equal(palabraProhibida(texto), null));
  }
});

describe("canonizarEnlace e idDeEnlace", () => {
  it("quita parámetros de seguimiento, fragmento y credenciales", () => {
    assert.equal(
      canonizarEnlace("https://User:clave@Medio.EXAMPLE:443/nota?utm_source=rss&id=5&fbclid=abc#comentarios"),
      "https://medio.example/nota?id=5",
    );
  });

  it("conserva la query que no es de seguimiento tal cual", () => {
    assert.equal(canonizarEnlace("https://medio.example/nota?123&b=a%20b"), "https://medio.example/nota?123&b=a%20b");
  });

  it("resuelve enlaces relativos contra la URL del feed", () => {
    assert.equal(canonizarEnlace("/noticias/x", "https://medio.example/feed.xml"), "https://medio.example/noticias/x");
  });

  it("rechaza lo que no es http(s)", () => {
    assert.equal(canonizarEnlace("javascript:alert(1)"), null);
    assert.equal(canonizarEnlace("mailto:a@medio.example"), null);
    assert.equal(canonizarEnlace("no es una url"), null);
  });

  it("el id es sha1 del enlace canónico", () => {
    const canonico = canonizarEnlace("https://medio.example/nota?utm_medium=feed")!;
    assert.equal(idDeEnlace(canonico), createHash("sha1").update("https://medio.example/nota").digest("hex"));
  });
});

describe("parsearFeed", () => {
  it("lee RSS 2.0 con CDATA y entidades, y solo devuelve titular, enlace y fecha", () => {
    const xml = `<rss><channel><title>Canal</title>
      <item>
        <title><![CDATA[GTA 6 & <i>Vice City</i>]]></title>
        <link>https://medio.example/a?x=1&amp;y=2</link>
        <pubDate>Wed, 25 Nov 2026 10:00:00 +0000</pubDate>
        <description>texto largo</description>
      </item>
      <item><title>Doble escape &amp;#8217;GTA 6&amp;#8217;</title><guid>https://medio.example/b</guid></item>
      <item><title>Sin enlace GTA 6</title><guid isPermaLink="false">abc-123</guid></item>
    </channel></rss>`;
    assert.deepEqual(parsearFeed(xml), [
      { titular: "GTA 6 & Vice City", enlace: "https://medio.example/a?x=1&y=2", fecha: "Wed, 25 Nov 2026 10:00:00 +0000" },
      { titular: "Doble escape ’GTA 6’", enlace: "https://medio.example/b", fecha: null },
      { titular: "Sin enlace GTA 6", enlace: null, fecha: null },
    ]);
  });

  it("prefiere feedburner:origLink al enlace de redirección", () => {
    const xml = `<rss><channel><item><title>GTA 6</title>
      <link>https://feeds.example/~r/medio/123</link>
      <feedburner:origLink>https://medio.example/original</feedburner:origLink>
    </item></channel></rss>`;
    assert.equal(parsearFeed(xml)[0]?.enlace, "https://medio.example/original");
  });

  it("lee Atom: rel=alternate, título html y fecha published", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title>
      <entry>
        <title type="html">GTA 6 &lt;b&gt;oficial&lt;/b&gt;</title>
        <link rel="self" href="https://medio.example/api/1"/>
        <link rel="alternate" href="https://medio.example/nota-1"/>
        <published>2026-11-20T10:00:00Z</published>
        <updated>2026-11-21T10:00:00Z</updated>
      </entry>
    </feed>`;
    assert.deepEqual(parsearFeed(xml), [
      { titular: "GTA 6 oficial", enlace: "https://medio.example/nota-1", fecha: "2026-11-20T10:00:00Z" },
    ]);
  });

  it("ignora entradas sin título y no se rompe con basura", () => {
    assert.deepEqual(parsearFeed("<rss><item><link>https://medio.example/x</link></item></rss>"), []);
    assert.deepEqual(parsearFeed("esto no es xml"), []);
  });
});

describe("decodificarEntidades", () => {
  it("decodifica nombradas, decimales y hexadecimales", () => {
    assert.equal(decodificarEntidades("&aacute; &#233; &#x00F1; &amp; &lt;&gt; &raquo;"), "á é ñ & <> »");
  });
  it("deja intactas las entidades desconocidas", () => {
    assert.equal(decodificarEntidades("&inventada; &#0;"), "&inventada; &#0;");
  });
});

describe("fechaIso", () => {
  const recogida = Date.parse("2026-11-26T12:00:00Z");
  it("convierte RFC 822 e ISO con zona a UTC", () => {
    assert.equal(fechaIso("Wed, 25 Nov 2026 10:00:00 +0000", recogida), "2026-11-25T10:00:00.000Z");
    assert.equal(fechaIso("2026-10-15T09:00:00+02:00", recogida), "2026-10-15T07:00:00.000Z");
  });
  it("usa la fecha de recogida si falta, no se entiende o está en el futuro", () => {
    assert.equal(fechaIso(null, recogida), "2026-11-26T12:00:00.000Z");
    assert.equal(fechaIso("ayer", recogida), "2026-11-26T12:00:00.000Z");
    assert.equal(fechaIso("2026-12-30T00:00:00Z", recogida), "2026-11-26T12:00:00.000Z");
  });
});

describe("seleccionarFuentesRss", () => {
  const base = { aviso_legal_url: "https://m.example/aviso", nota: "" };
  it('solo "permitido": true (booleano) y "tipo": "rss"', () => {
    const { fuentes } = seleccionarFuentesRss([
      { ...base, id: "si", nombre: "Sí", tipo: "rss", url: "https://si.example/feed", permitido: true },
      { ...base, id: "no", nombre: "No", tipo: "rss", url: "https://no.example/feed", permitido: false },
      { ...base, id: "texto", nombre: "Texto", tipo: "rss", url: "https://t.example/feed", permitido: "true" },
      { ...base, id: "sin-permiso", nombre: "Sin", tipo: "rss", url: "https://s.example/feed" },
      { ...base, id: "yt", nombre: "YT", tipo: "youtube", url: "https://yt.example/feed", permitido: true },
      { ...base, id: "man", nombre: "Manual", tipo: "manual", url: "https://m.example/", permitido: true },
    ]);
    assert.deepEqual(fuentes.map((f) => f.id), ["si"]);
  });

  it("avisa de fuentes permitidas mal formadas en vez de usarlas", () => {
    const { fuentes, avisos } = seleccionarFuentesRss([
      { ...base, id: "mala", nombre: "Mala", tipo: "rss", url: "ftp://mala.example/feed", permitido: true },
      { ...base, nombre: "Sin id", tipo: "rss", url: "https://x.example/feed", permitido: true },
    ]);
    assert.equal(fuentes.length, 0);
    assert.equal(avisos.length, 2);
  });

  it("exige un array", () => {
    assert.throws(() => seleccionarFuentesRss({ fuentes: [] }), /array/);
  });
});
