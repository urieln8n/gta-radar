# Despliegue de gta-radar

| Pieza | Qué hace |
|---|---|
| **Worker `gta-radar`** (Cloudflare Workers, conectado por Git a `urieln8n/gta-radar`) | En cada push a `main`: `npm run build:sitio` → `npx wrangler deploy`. Publica `salida/` = `sitio/` (la guía gratis) + `radar/`. |
| `.github/workflows/recoger.yml` («Recoger noticias») | Cada día a las 04:41 UTC (si `RECOGIDA_ACTIVA` = `true`) y a mano: `npm run recoger` y commit de `data/` como `github-actions[bot]`. Si falla, abre o comenta la issue «Recogida fallida». |
| `.github/workflows/publicar.yml` («Publicar web (reserva)») | Solo a mano y solo si falla la compilación de Cloudflare: compila igual y despliega el mismo Worker desde GitHub Actions. |

Mientras no muevas el dominio (paso 4), **gta.andresrendon.com la sigue sirviendo el proyecto de Pages antiguo `gta-andresrendon`** (subida directa, despliegue `e1190f1f` del 26-nov-2026). No se ha tocado.

## 1. Qué hay en `sitio/`

El 26-nov-2026 rehíce la web a partir de la versión publicada. Son 9 archivos:

| Archivo | Origen |
|---|---|
| `index.html`, `gracias.html`, `privacidad.html` | Las páginas publicadas, sin el bloque «Cloudflare Pages Analytics» (ver abajo). |
| `styles.css`, `favicon.svg`, `guia-gta6-errores-novato.pdf`, `robots.txt`, `sitemap.xml` | Tal cual se publican. |
| `_headers` | Reconstruido a partir de las cabeceras que se sirven hoy. |

Lo que comprobé:

- **Las páginas son idénticas byte a byte a las publicadas**, salvo dos cosas que Cloudflare añade al servirlas y que no forman parte de los archivos:
  - El script de Web Analytics que inyecta Pages antes de `</body>`, entre dos comentarios `<!-- Cloudflare Pages Analytics -->`. Lo quité (ver el paso 4, «Después»).
  - En el dominio, la zona ofusca el correo de `privacidad` (`/cdn-cgi/l/email-protection`). Por eso esa página la cogí de `gta-andresrendon.pages.dev`, donde sale el `mailto:` original.
- **El formulario de Brevo es idéntico**: la misma `action` (`https://7cbfe83b.sibforms.com/serve/MUIFAJyd…`), los mismos campos (`EMAIL`, la trampa antispam `email_address_check`, `locale`, `html_type`), la casilla de consentimiento y el mismo script de envío. El número de lista (#9) no aparece en el HTML porque se configura dentro de Brevo. Se confirma con el alta de prueba del paso 3.
- **`_headers`**: las 5 cabeceras de seguridad que se sirven en todas las rutas y `Cache-Control: public, max-age=3600` en el PDF. Dejé fuera dos cosas que no venían de ese archivo: el `access-control-allow-origin: *` (lo añadía Pages por defecto) y el `max-age=14400` que se ve en el dominio (es la caché de la zona).
- No hay más archivos: el resto de rutas probadas devolvía la portada, no hay JS aparte ni `404.html`, y `og.png` (enlazado como imagen para compartir) **no existe** tampoco en la web actual.

Reglas:
- **Todo lo que hay en `sitio/` se publica**: no metas ahí notas, README ni borradores.
- No crees `sitio/radar/`: esa carpeta la genera el build del radar.
- Si cambias el nombre de algún archivo de la tabla (por ejemplo, el PDF), cámbialo también en `IMPRESCINDIBLES`, dentro de `src/despliegue/build-sitio.ts`.

## 2. Configuración del Worker en Cloudflare

En **Workers & Pages → gta-radar → Configuración → Compilación**:

| Campo | Valor |
|---|---|
| Repositorio / rama | `urieln8n/gta-radar`, rama `main` |
| **Comando de compilación** | `npm run build:sitio` |
| Implementar comando | `npx wrangler deploy` |
| Directorio raíz | `/` |
| Variables de compilación | Ninguna |

- **Por qué no `npm ci && npm run build:sitio`:** Cloudflare ya instala las dependencias (a partir de `package-lock.json`) antes del comando de compilación. Con `npm ci &&` también funciona, pero instala dos veces.
- **Node:** el archivo `.node-version` (`22`) fija Node 22. Si no estuviera, Cloudflare usaría Node 24.
- **`wrangler.jsonc`:** `name` = `gta-radar` (tiene que coincidir con el nombre del Worker; si no, Cloudflare abre un pull request para «arreglarlo»), `compatibility_date` = `2026-11-23` y `assets.directory` = `./salida`. Solo archivos estáticos: sin código de Worker, sin rutas y sin dominio.
- **Opcional:** como `wrangler` no está en `package.json`, `npx wrangler deploy` usa la última versión que haya. Si prefieres que no cambie sola, pon `npx wrangler@4.168.0 deploy` (la que he probado).
- **Ramas que no son `main`:** Cloudflare también las compila y sube una versión de vista previa, sin tocar la web publicada. Si no las quieres, desactívalas en esa misma pantalla (control de ramas).

### Por qué nunca se publica el radar sin la guía

- `npm run build:sitio` **falla** si a `sitio/` le falta algún archivo de la tabla, si `sitio/index.html` no lleva el formulario de Brevo (un `<form>` con `action` `https://….sibforms.com/serve/…` y el campo `EMAIL`), si existe `sitio/radar/`, o si el radar no se genera o sale con datos de ejemplo.
- Si la compilación falla, Cloudflare no ejecuta `wrangler deploy` y **sigue en línea la versión anterior**. Además, el script borra `salida/` al fallar.
- `salida/` está en `.gitignore`, así que nunca llega al repo. Sin compilación no existe `./salida`, y `wrangler deploy` falla.
- Lo probé en local: cada uno de esos casos termina con error y sin `salida/`. Con la copia buena, `wrangler dev` sirve la portada idéntica byte a byte, las cabeceras y `/radar/`.

## 3. Primera publicación y prueba en `*.workers.dev`

1. Haz push a `main`. Cloudflare compila y despliega. El registro sale en la página del Worker (compilaciones) y como check en el commit de GitHub.
2. Abre la dirección `*.workers.dev` del Worker (sale en su página; tiene la forma `https://gta-radar.<tu-subdominio>.workers.dev`).
3. Revísala en móvil y ordenador:
   - La portada se ve igual que gta.andresrendon.com.
   - **Alta de prueba** con tu correo: sale «¡Listo! Revisa tu correo…», llega el correo de confirmación de Brevo y el contacto aparece en la **lista #9**.
   - El enlace de confirmación lleva a la URL configurada en Brevo (normalmente en gta.andresrendon.com), que aún es la web vieja. Esa parte se vuelve a probar después de mover el dominio.
   - `/gracias`, `/privacidad`, el PDF y `/radar/` (y `/radar/feed.xml`).
4. Compárala con la web actual. Cambia `nuevo` por tu dirección `*.workers.dev`:

   ```bash
   viejo=https://gta-andresrendon.pages.dev
   nuevo=https://gta-radar.TU-SUBDOMINIO.workers.dev
   quitar='s#<!-- Cloudflare Pages Analytics -->.*<!-- Cloudflare Pages Analytics -->##'
   for p in / /gracias /privacidad /styles.css /favicon.svg /guia-gta6-errores-novato.pdf /robots.txt /sitemap.xml; do
     if cmp -s <(curl -s "$viejo$p" | sed "$quitar") <(curl -s "$nuevo$p" | sed "$quitar"); then echo "igual      $p"; else echo "DIFERENTE  $p"; fi
   done
   cab='^(x-frame-options|x-content-type-options|referrer-policy|permissions-policy|strict-transport-security|cache-control):'
   for p in / /guia-gta6-errores-novato.pdf; do
     diff <(curl -sI "$viejo$p" | tr -d '\r' | tr A-Z a-z | grep -E "$cab" | sort) \
          <(curl -sI "$nuevo$p" | tr -d '\r' | tr A-Z a-z | grep -E "$cab" | sort) && echo "cabeceras iguales  $p"
   done
   ```

   Lo esperado es «igual» en todo y «cabeceras iguales» en las dos rutas. Contra el Worker en local, así salió.

5. **Diferencias esperadas** (no son fallos):
   - **Las rutas que no existen dan 404.** En la web vieja mostraban la portada, porque Pages sirve el `index.html` cuando no hay `404.html`. Si algún enlace (por ejemplo, el de confirmación de Brevo) apunta a una ruta que no existe, ahora se verá un 404. Por eso hay que repetir la prueba del alta en el paso 4.
   - `/gracias.html` → `/gracias` redirige con 307 (antes, 308). Lleva al mismo sitio.
   - Ya no salen `access-control-allow-origin: *` ni el script de Web Analytics.

## 4. Mover gta.andresrendon.com al Worker (solo cuando el paso 3 salga igual)

Elige un momento tranquilo (no justo después de publicar un Short): entre los pasos b y d la web estará unos minutos sin responder.

- **a.** Punto de vuelta: el proyecto de Pages `gta-andresrendon` y su despliegue `e1190f1f` se quedan como están.
- **b.** Cloudflare → zona `andresrendon.com` → **DNS → Registros**: borra el CNAME `gta` → `gta-andresrendon.pages.dev`. Un Worker no acepta un dominio que ya tenga un CNAME.
- **c.** **Workers & Pages → gta-andresrendon** (Pages) → **Dominios personalizados** → `⋯` junto a `gta.andresrendon.com` → **Eliminar dominio**. No borres el proyecto.
- **d.** **Workers & Pages → gta-radar** (Worker) → **Configuración → Dominios y rutas → Añadir → Dominio personalizado** → `gta.andresrendon.com` → **Añadir**. Cloudflare crea el registro DNS y el certificado.
- **e.** Cuando salga activo, abre `https://gta.andresrendon.com/` y `/radar/`. Repite la comparación con `nuevo=https://gta.andresrendon.com`. `/privacidad` puede salir DIFERENTE porque en el dominio Cloudflare ofusca el correo.
- **f.** Haz un alta de prueba completa: formulario → correo de Brevo → enlace de confirmación → página de gracias (no un 404) → PDF.

**Si algo va mal (volver atrás):** en el Worker, **Dominios y rutas** → quita `gta.andresrendon.com`. Después, en el proyecto de Pages `gta-andresrendon` → **Dominios personalizados → Configurar un dominio** → `gta.andresrendon.com` → **Activar**, que vuelve a crear el CNAME. La web vieja sigue intacta.

**Después:**
- **Web Analytics:** Pages la inyectaba sola y el Worker no. Para seguir midiendo visitas, actívala en Cloudflare (**Analytics → Web Analytics**) para `gta.andresrendon.com`. Si no se inyecta sola, pega en las tres páginas de `sitio/` el fragmento que te da. Las cifras empiezan de cero.
- Deja el proyecto de Pages viejo unas semanas antes de borrarlo.
- Opcional: añade `"workers_dev": false` a `wrangler.jsonc` para que la web solo se vea en el dominio.

## 5. Día a día

- **Recogida:** cada madrugada (04:41 UTC; GitHub puede retrasar unos minutos los cron). Las noticias nuevas entran como `pendiente`. El commit del bot también lo despliega Cloudflare, aunque la web no cambia: solo muestra las aprobadas.
- **Publicar:** aprueba noticias (`"estado": "aprobada"`) y haz push a `main`. Cloudflare lo despliega solo.
- **Si falla una compilación:** sigue en línea la versión anterior. Lo verás en la página del Worker y como check rojo en el commit de GitHub.
- **Volver a una versión anterior:** en la página del Worker, sección de implementaciones → elige la versión → revertir (o `npx wrangler rollback`).
- **Si falla la recogida:** se abre la issue «Recogida fallida» o se le añade un comentario. `data/` en `main` no cambia. Ciérrala cuando esté arreglado.

## 6. GitHub: variables y secretos

En `urieln8n/gta-radar` → **Settings → Secrets and variables → Actions**:

| Nombre | Tipo | Para qué |
|---|---|---|
| `RECOGIDA_ACTIVA` | Variable | `true` para que la recogida corra sola cada día. Ponla cuando la primera ejecución manual (Actions → Recoger noticias → Run workflow) salga bien. |
| `CLOUDFLARE_API_TOKEN` | Secret | Solo para `publicar.yml` (reserva). Ver paso 7. |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Solo para `publicar.yml` (reserva). Ver paso 7. |

La compilación de Cloudflare no necesita ninguno: usa un token propio que crea Cloudflare al conectar el repo. La variable `PAGES_PROJECT` de versiones anteriores de esta guía ya no se usa.

Comprueba también:
- Las **Issues** están activadas (hoy lo están).
- Si proteges `main`, permite que `github-actions[bot]` haga push.

## 7. Reserva: `publicar.yml`

Úsalo solo si la compilación de Cloudflare no funciona. Antes necesita los dos secretos:

1. **Token:** panel de Cloudflare → icono de perfil → **Mi perfil → Tokens de API → Crear token → Token personalizado**. Una sola fila de permisos: **Cuenta · Workers Scripts · Editar** (Account · Workers Scripts · Edit). En recursos de la cuenta, incluye tu cuenta. Sin filtro de IP. Cloudflare muestra el valor **una sola vez**: pégalo directamente en el secreto. No lo guardes en archivos, commits ni chats.
2. **ID de la cuenta:** en **Workers & Pages** (columna derecha, «ID de cuenta»), en la URL del panel justo detrás de `dash.cloudflare.com/`, o con `npx wrangler whoami`.
3. Guárdalos (`gh secret set` pide el valor sin mostrarlo):

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN --repo urieln8n/gta-radar
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo urieln8n/gta-radar
   ```

4. **Actions → Publicar web (reserva) → Run workflow.** En «URL», pon `https://gta.andresrendon.com` si el dominio ya está en el Worker; si no, su dirección `*.workers.dev`. Al terminar, comprueba que la portada lleva el formulario y que `/radar/feed.xml` existe.

El siguiente push a `main` lo vuelve a desplegar Cloudflare, así que los dos caminos no se pisan.

## Apagar

- **Recogida automática:** borra la variable `RECOGIDA_ACTIVA` (o ponle otro valor). La ejecución manual sigue disponible.
- **Despliegue automático:** Worker → **Configuración → Compilación** → desconecta el repositorio. La web se queda con la última versión publicada.
- **Token de la reserva:** Cloudflare → **Tokens de API** → cambiarlo o borrarlo. Si lo cambias, actualiza `CLOUDFLARE_API_TOKEN`.
