# Fuentes del radar

Comprobado el **26 de noviembre de 2026**. La configuración está en [`data/config/fuentes.json`](../data/config/fuentes.json).

Criterio: una fuente lleva `"permitido": true` solo si su aviso legal permite **de forma expresa** mostrar titular + enlace. Si el texto no lo deja claro, `false`. No se usó ningún agregador (Feeder, rss.app…): cada feed sale de un enlace de la propia web o de su dominio oficial.

## Resumen

| id | Tipo | Permitido | Motivo |
|---|---|---|---|
| `vandal` | rss | **no** | Pide autorización escrita para reproducir total o parcialmente |
| `3djuegos` | rss | **sí** | CC BY-NC 3.0 ES (Webedia), con condiciones |
| `eurogamer-es` | rss | **no** | Prohíbe enlazar con ánimo de lucro y mostrar su contenido en otras webs sin permiso escrito |
| `xataka` | rss | **sí** | CC BY-NC 3.0 ES (Webedia), con condiciones |
| `meristation` | rss | **no** | Todos los derechos reservados, exclusión de minería de datos y oposición a uso por IA |
| `game-informer` | rss | **no** | Solo fuente de datos, no se muestra en el radar |
| `rockstar-newswire` | manual | **no** | Sin RSS oficial. Los términos de Take-Two solo permiten uso personal y no comercial |
| `rockstar-youtube` | youtube | **no** | **Aplazado a una fase posterior** (ver [Decisiones](#decisiones-de-andrés-26-nov-2026)) |

El recolector (`src/recoger/noticias.ts`) solo descarga fuentes con `"permitido": true` y `"tipo": "rss"`. Hoy son `3djuegos` y `xataka`.

### Condiciones de Webedia (3DJuegos y Xataka)

La licencia CC BY-NC solo cubre lo que pide si se cumplen estas tres condiciones:

1. **Sin uso comercial.** Webedia considera comercial *«su publicación en cualquier página que muestre publicidad o que sirva de soporte a otra actividad como la venta de bienes y servicios»*. Si la web del radar lleva anuncios o vende algo, estas dos fuentes pasan a `false`.
2. **Enlace directo sin `nofollow`** a la página del artículo. La web no debe poner `rel="nofollow"` en esos enlaces. `rel="noopener"` sí se puede usar.
3. **Atribución.** Se cumple con el campo `medio` y el enlace al artículo.

La licencia no cubre algunas fotos y vídeos de terceros, pero da igual, porque el radar nunca guarda imágenes.

---

## Vandal

- **RSS oficial:** `https://vandal.elespanol.com/xml.cgi`
  - Enlazado desde la portada https://vandal.elespanol.com/ como `<link rel="alternate" type="application/rss+xml" title="Noticias Vandal">` y con el icono RSS del pie.
- **Comprobación con curl:** HTTP 200, `text/xml; charset=ISO-8859-1`, RSS 2.0, 30 items. Último item: 26-nov-2026 18:35 GMT.
- **robots.txt** (https://vandal.elespanol.com/robots.txt): no bloquea `/xml.cgi`.
- **Aviso legal:** https://vandal.elespanol.com/estaticos/copyright (enlace «Aviso legal» del pie)
  - §7: *«La reproducción total o parcial, uso, transformación, distribución y/o comunicación pública requieren de la autorización escrita previa por parte de VANDAL»*.
  - Solo permite uso *«personal, educativo y no comercial»*, citando fuente, autor y URL. Se opone a las recopilaciones comerciales del art. 32.1 LPI.
- **Decisión:** `false`. No menciona titular + enlace, así que no queda claro. Para activarla hace falta permiso escrito de Vandal.
- **Nota técnica:** el feed viene en ISO-8859-1. Hay que decodificarlo bien o los acentos saldrán rotos.

## 3DJuegos

- **RSS oficial:** `https://www.3djuegos.com/feedburner.xml`
  - Enlazado desde la portada https://www.3djuegos.com/ con el icono RSS (`title="3djuegos por RSS"`).
  - El otro enlace RSS de la portada, `/index.xml`, redirige a este mismo feed. Pese al nombre, se sirve desde 3djuegos.com y no desde Google FeedBurner.
- **Comprobación con curl:** HTTP 200, `text/xml; charset=UTF-8`, RSS 2.0, 27 items. Último item: 26-nov-2026 20:31 UTC.
- **robots.txt** (https://www.3djuegos.com/robots.txt): solo veta `/*/*/*/feed.xml`, no el feed general.
- **Aviso legal:** «Condiciones de uso» del pie, https://weblogs.webedia.es/condiciones-uso.html. El aviso legal de privacidad está en https://weblogs.webedia.es/aviso-legal.html.
  - *«Nuestras publicaciones utilizan una licencia Creative Commons que permite el uso de sus contenidos con fines no comerciales, exigiendo sólo la atribución al autor»*. Enlaza a CC BY-NC 3.0 ES: http://creativecommons.org/licenses/by-nc/3.0/es/
- **Decisión:** `true`, con las [condiciones de Webedia](#condiciones-de-webedia-3djuegos-y-xataka).

## Eurogamer.es

- **RSS oficial:** `https://www.eurogamer.es/feed/news` (Noticias)
  - La portada https://www.eurogamer.es/ enlaza el feed general `https://www.eurogamer.es/feed` con `<link rel="alternate">`.
  - La página oficial de feeds, https://www.eurogamer.es/feeds (enlazada en el pie), lista `/feed/news` y otros por sección.
- **Comprobación con curl:** `/feed/news`: HTTP 200, `application/rss+xml`, 84 items. `/feed`: HTTP 200, 83 items. Último item: 26-nov-2026 09:49 UTC.
- **robots.txt** (https://www.eurogamer.es/robots.txt): no bloquea `/feed`.
- **Aviso legal:** https://www.eurogamer.es/terms-and-conditions (enlace «Términos y condiciones» del pie)
  - Solo permite el uso *«for your private, non-commercial, personal use»*.
  - Prohíbe, sin permiso previo por escrito: *«provide hypertext links, URL Links, graphic links, hyperlinks or other direct connection for profit or gain»* y *«display, publish, copy, print, post or otherwise use it and the information contained therein for the benefit of any third party or web site»*.
- **Decisión:** `false`. Prohíbe de forma expresa mostrar su contenido en otra web sin permiso.

## Xataka

- **RSS oficial:** `https://www.xataka.com/index.xml`
  - Enlazado desde la portada https://www.xataka.com/ con el icono RSS (`title="Xataka en Rss"`). Redirige a `https://www.xataka.com/feedburner.xml`, que sigue en el mismo dominio.
- **Comprobación con curl:** HTTP 200 tras la redirección, `text/xml; charset=UTF-8`, RSS 2.0, 30 items. Último item: 26-nov-2026 20:29 UTC.
- **robots.txt** (https://www.xataka.com/robots.txt): solo veta `/*/*/*/feed.xml`.
- **Aviso legal:** el enlace «Condiciones de uso» de la cabecera (https://www.weblogssl.com/contenidos) redirige a https://weblogs.webedia.es/condiciones-uso.html. Es el mismo texto que el de 3DJuegos.
- **Decisión:** `true`, con las [condiciones de Webedia](#condiciones-de-webedia-3djuegos-y-xataka).
- **Nota:** Xataka es un medio generalista de tecnología, así que casi nada de su feed será de GTA 6. El filtro hace el trabajo.

## Meristation

- **RSS oficial:** `https://feeds.as.com/mrss-s/pages/as/site/as.com/section/meristation/portada/`
  - **as.com bloquea cualquier acceso automatizado** (DataDome: 403 y captcha), tanto con curl como con la herramienta de búsqueda. No se intentó saltar el bloqueo. Sus propias condiciones prohíben *«eludir o manipular cualquier dispositivo de protección»*.
  - Por eso la página oficial de RSS de AS (https://as.com/rss/ → https://as.com/rss-de-ascom-n/) se leyó en el Internet Archive: https://web.archive.org/web/20261107001634/https://as.com/rss-de-ascom-n/
  - Esa página enlaza los feeds de todas las secciones en `feeds.as.com/mrss-s/pages/as/site/as.com/section/<sección>/portada/`.
  - Para MeriStation, el enlace apunta al mismo servicio de Prisa en `cntapi.prisasd.com`, con una clave de API en la URL. Esa variante no se usa ni se copia aquí. Se usa la ruta equivalente de `feeds.as.com`, que no lleva clave.
- **Comprobación con curl:** HTTP 200, `application/xml`, RSS 2.0. Título del canal: «MeriStation: Noticias, guías y análisis…», 89 items. Último item: 26-nov-2026 08:47 GMT.
  - `feeds.as.com/robots.txt` devuelve 403, así que no se pudo leer.
- **Aviso legal:** https://as.com/meristation/condiciones-legales/, leído en https://web.archive.org/web/20260719212851/https://as.com/meristation/condiciones-legales/
  - *«quedan expresamente prohibidas la reproducción, la distribución y la comunicación pública […] de la totalidad o parte de los contenidos de esta página web, con fines comerciales […] sin la autorización de MERISTATION»*.
  - Uso solo *«personal y privado»*.
- **Aviso legal de AS** (mismo titular, Diario AS S.L.): https://as.com/aviso-legal/, leído en https://web.archive.org/web/20261113145855/https://as.com/aviso-legal/
  - Prohíbe la reproducción total o parcial *«cualquiera que sea su finalidad»* sin autorización.
  - Se opone a las revistas de prensa (art. 32.1 TRLPI) y hace reserva expresa frente a la minería de textos y datos (art. 67.3 RDL 24/2021) y *«frente a cualquier utilización de sus contenidos por tecnologías de inteligencia artificial»*.
  - Licencias: ventacontenidos@prisamedia.com
- **Decisión:** `false`.
- **Notas:**
  - Este feed trae el **texto completo** del artículo (`content:encoded`) y muchas imágenes (`media:`). Aunque algún día se active, el recolector debe quedarse solo con titular, enlace y fecha.
  - Ningún texto de AS o Meristation puede pasar por un modelo de IA, tampoco para resumir.

## Game Informer

- **RSS oficial:** `https://gameinformer.com/news.xml`
  - Aparece en la página oficial de feeds https://gameinformer.com/rss, con las secciones All (`/rss.xml`), News, Previews, Reviews y Features, entre otras.
  - No se encontró un enlace a esa página en la portada ni en `/news`: ninguna de las dos tiene `<link rel="alternate">`. Pero la página está en el propio dominio y es la lista oficial.
- **Comprobación con curl:** `/news.xml`: HTTP 200, `application/rss+xml`, «Game Informer News», 50 items. Último item: 25-nov-2026 10:56 CST.
- **robots.txt** (https://gameinformer.com/robots.txt): solo veta `/cdn-cgi/`.
- **Aviso legal:** https://gameinformer.com/terms (enlace «Terms and Conditions» del pie)
  - Solo da una licencia *«personal, worldwide, royalty-free, non-transferable, and non-exclusive license to access and use»*.
  - *«You agree not to "frame" or "mirror" any elements of the Game Informer without the Company's express prior written consent»*.
  - No autoriza en ningún punto mostrar titulares en otra web.
- **Decisión:** `false`. **Solo fuente de datos, no se muestra en el radar.**
- **Nota:** con `false`, el recolector actual tampoco lo descarga. Si se quiere usar para detectar noticias, tendrá que ser un proceso aparte que no publique nada, ni siquiera la traducción del titular. Cada dato debe confirmarse en una fuente permitida u oficial antes de aprobarlo.

## Rockstar Newswire

- **¿RSS oficial?** **No.**
  - https://www.rockstargames.com/newswire no tiene ningún `<link rel="alternate" type="application/rss+xml">`. La página es una aplicación JavaScript.
  - Estas rutas devuelven **404**:
    - https://www.rockstargames.com/newswire/rss
    - https://www.rockstargames.com/newswire.rss
    - https://www.rockstargames.com/newswire/feed
    - https://www.rockstargames.com/newswire/rss.xml
    - https://www.rockstargames.com/rss
  - Por eso es `"tipo": "manual"`: una persona la revisa en el navegador.
- **robots.txt** (https://www.rockstargames.com/robots.txt): bloquea por completo a ClaudeBot, GPTBot, CCBot, cohere-ai, Meta-ExternalAgent, Applebot-Extended e ia_archiver. **No se debe automatizar.**
- **Aviso legal:** https://www.rockstargames.com/legal
  - La página se carga con JavaScript y solo con curl no muestra el texto. El soporte de Rockstar remite a esa URL para sus términos.
  - El texto aplicable se leyó en los Términos de servicio de Take-Two: https://www.take2games.com/legal/ (redirige a `/legal/en-US/`). Cubren los *«games, apps, products, websites»* del grupo, al que pertenece Rockstar.
  - §2.2: licencia *«for your personal, non-commercial enjoyment»*.
  - §2.3: prohíbe *«copy […] distribute […] commercialize»*. Además, *«nothing in the limited license […] authorizes the use of the Services (including the Content) […] to develop, train, enhance, or provide source material for […] any Generative AI Tools»*.
- **Decisión:** `false`. No autorizan titular + enlace.
- **Notas:**
  - Aunque se active, los resúmenes de noticias de Rockstar los tiene que escribir una persona, no una IA.
  - La página de política de material con copyright, https://support.rockstargames.com/articles/7bNaeoMFTV0iUDGhStTXvz/policy-on-posting-copyrighted-material, no respondió: curl falló sin conexión y WebFetch se agotó dos veces. Está pendiente de leer.

## Rockstar Games en YouTube

- **Canal oficial:** https://www.youtube.com/@RockstarGames
  - **channelId `UC6VcWc1rAoWdBCM0JxrRQ3A`**, sacado de `externalId` y de la URL canónica de la página del canal.
  - Nombre «Rockstar Games», creado el 17-feb-2006, enlaza a rockstargames.com/VI.
- **Feed de YouTube:** `https://www.youtube.com/feeds/videos.xml?channel_id=UC6VcWc1rAoWdBCM0JxrRQ3A`
  - Lo enlaza la propia página del canal (`<link rel="alternate" type="application/rss+xml">`).
  - curl: HTTP 200, Atom, 15 entradas. Último vídeo: 19-nov-2026.
  - Pero **https://www.youtube.com/robots.txt** tiene `Disallow: /feeds/videos.xml` para `User-agent: *`.
- **Aviso legal:** Términos de YouTube, https://www.youtube.com/t/terms?hl=es-419
  - Prohíbe *«acceder al Servicio mediante cualquier medio automatizado (como robots…), excepto: (a) en el caso de motores de búsqueda públicos, conforme a los archivos robots.txt de YouTube; (b) con el permiso previo y por escrito de YouTube; o (c) según lo permita la legislación vigente»*.
  - Solo permite ver el contenido *«para fines personales y no comerciales»* y mostrar vídeos *«a través del reproductor de YouTube insertable»*.
  - Los títulos de los vídeos son además contenido de Rockstar, sujeto a los términos de Take-Two (ver arriba).
- **Vía permitida para automatizar:** YouTube Data API v3. Sus políticas para desarrolladores (https://developers.google.com/youtube/terms/developer-policies, «Refreshing, Storing, and Displaying API Data») limitan el almacenamiento de datos públicos a **30 días** como máximo: después hay que borrarlos o refrescarlos.
  - Eso choca con los `data/noticias/AAAA-MM.json`, que se guardan para siempre.
  - Por convención de YouTube, la lista de subidas del canal es `UU6VcWc1rAoWdBCM0JxrRQ3A`. Conviene confirmarlo con `channels.list` → `contentDetails`.
- **Decisión:** `false`. Hoy no hay forma de automatizar el canal que cumpla los términos y el contrato a la vez.
- **Estado: fase posterior**, vía YouTube Data API con datos que se refrescan cada 30 días, fuera de `data/noticias`.

---

## Reglas para el recolector y la web (salen de los avisos legales)

- De cada item del feed se guarda solo **titular, enlace y fecha**. `description`, `content:encoded`, `media:*` y `enclosure` se descartan siempre. Meristation, Vandal y Eurogamer meten imágenes en el feed.
- Ningún feed comprobado lleva parámetros de seguimiento en `<link>`, así que el enlace del item sirve como enlace canónico para el `sha1`.
- Los enlaces a Webedia (3DJuegos, Xataka) se publican **sin `rel="nofollow"`**.
- Si la web del radar lleva publicidad o se usa para vender algo, 3DJuegos y Xataka pasan a `false` y el radar se queda sin fuentes RSS publicables.
- No se intenta sortear ningún bloqueo anti-bots (DataDome de as.com) ni robots.txt (Rockstar, `/feeds/videos.xml` de YouTube).
- Ningún texto de AS/Meristation ni de Rockstar puede entrar en un modelo de IA.

## Cómo repetir las comprobaciones

```bash
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
for u in \
  https://vandal.elespanol.com/xml.cgi \
  https://www.3djuegos.com/feedburner.xml \
  https://www.eurogamer.es/feed/news \
  https://www.xataka.com/index.xml \
  https://feeds.as.com/mrss-s/pages/as/site/as.com/section/meristation/portada/ \
  https://gameinformer.com/news.xml; do
  curl -sL -A "$UA" --compressed -o /tmp/feed.xml -w "%{http_code} %{content_type} $u\n" "$u"
  grep -c '<item' /tmp/feed.xml
done
```

Para Rockstar:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://www.rockstargames.com/newswire/rss   # 404
curl -s https://www.youtube.com/robots.txt | grep feeds                             # Disallow: /feeds/videos.xml
```

Los avisos legales pueden cambiar. Hay que repasarlos antes de cambiar cualquier `permitido` y anotar aquí la fecha.

---

## Decisiones de Andrés (26-nov-2026)

1. **`/radar` no tendrá anuncios ni venta, y sus enlaces irán sin `nofollow`.** Con eso se cumplen las condiciones de Webedia, así que 3DJuegos y Xataka se quedan en `"permitido": true`. Si algún día `/radar` lleva publicidad o venta, ambas pasan a `false`.
2. **YouTube queda aplazado.** Se hará en una **fase posterior, vía YouTube Data API, con datos que se refrescan cada 30 días, fuera de `data/noticias`**. Mientras tanto, `rockstar-youtube` sigue en `false` y no se sondea su feed.
3. **Los resúmenes los escribe Andrés a mano. Ninguna IA lee el contenido de los medios.** Esto cubre las reservas de AS/Meristation y Take-Two/Rockstar frente al uso por IA, y vale para todas las fuentes, no solo para esas.
4. **Game Informer queda fuera por ahora.** Sigue en `false`, así que el recolector no lo descarga, y no se monta ningún proceso aparte para usarlo como fuente de datos.
