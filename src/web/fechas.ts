/**
 * Fechas de la web del radar.
 *
 * El público principal está en México, así que las fechas se muestran y los
 * meses se agrupan en la hora de Ciudad de México: una noticia del 1 de
 * noviembre a las 03:00 UTC sale como «31 oct» y en la página de octubre,
 * igual que la ve quien la lee.
 */

export const ZONA = 'America/Mexico_City';

const formatoDia = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: ZONA,
});

const formatoMes = new Intl.DateTimeFormat('es-MX', {
  month: 'long',
  year: 'numeric',
  timeZone: ZONA,
});

const partesMes = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  timeZone: ZONA,
});

/** «2026-11» para una fecha, según la hora de Ciudad de México. */
export function claveMes(fecha: Date): string {
  const partes = partesMes.formatToParts(fecha);
  const anio = partes.find((p) => p.type === 'year')?.value;
  const mes = partes.find((p) => p.type === 'month')?.value;
  if (!anio || !mes) throw new Error(`No se pudo calcular el mes de ${fecha.toISOString()}.`);
  return `${anio}-${mes}`;
}

/** «26 nov 2026». */
export function textoDia(fecha: Date): string {
  return formatoDia.format(fecha).replace(/\./g, '');
}

/** «noviembre de 2026» para la clave «2026-11». */
export function nombreMes(clave: string): string {
  const [anio, mes] = clave.split('-').map(Number);
  if (!anio || !mes) throw new Error(`Clave de mes no válida: ${clave}`);
  // Mediodía del día 15 en UTC: cae en ese mes en cualquier zona horaria.
  return formatoMes.format(new Date(Date.UTC(anio, mes - 1, 15, 12)));
}

export function conMayuscula(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase('es') + texto.slice(1);
}

/** Fecha para RSS (RFC 822), siempre en GMT. */
export function fechaRss(fecha: Date): string {
  return fecha.toUTCString();
}
