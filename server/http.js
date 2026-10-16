/**
 * Detalles comunes de las peticiones HTTP que hace Nébula.
 *
 * Los servicios de imágenes (sobre todo los de Wikimedia) rechazan las peticiones
 * que no se identifican como es debido: si el agente de usuario es genérico o no
 * lleva forma de contacto, responden 403 y la carátula «no se descarga» aunque
 * los datos de texto sí lleguen. Por eso el agente de usuario se define aquí una
 * sola vez y con el formato que piden.
 */
export const CONTACTO = 'https://github.com/notspesuser322/GameLibraryManager';
export const VERSION_UA = '1.1';

export const USER_AGENT = `Nébula/${VERSION_UA} (gestor de biblioteca de juegos local; ${CONTACTO})`;

/** Cabeceras que aceptan tanto wikis como CDNs de tiendas. */
export function cabecerasImagen({ referer = null } = {}) {
  const headers = {
    'user-agent': USER_AGENT,
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5',
    'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
  };
  if (referer) headers.referer = referer;
  return headers;
}

/** Cabeceras para pedir datos (JSON) o páginas. */
export function cabecerasDatos(extra = {}) {
  return {
    'user-agent': USER_AGENT,
    accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
    'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
    ...extra,
  };
}

const FIRMAS = [
  [0x89, 0x50, 0x4e, 0x47],       /* PNG  */
  [0xff, 0xd8, 0xff],             /* JPEG */
  [0x47, 0x49, 0x46, 0x38],       /* GIF  */
  [0x42, 0x4d],                   /* BMP  */
  [0x00, 0x00, 0x01, 0x00],       /* ICO  */
];

/**
 * ¿El contenido descargado es de verdad una imagen?
 * Muchos servicios devuelven HTML con código 200 cuando no encuentran el
 * archivo; sin esta comprobación se guardaría una página web como carátula.
 */
export function pareceImagen(buffer) {
  if (!buffer || buffer.length < 100) return false;
  for (const firma of FIRMAS) {
    if (firma.every((byte, indice) => buffer[indice] === byte)) return true;
  }
  /* WEBP: RIFF....WEBP */
  if (buffer.length > 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return true;
  /* SVG: empieza por <svg o <?xml … <svg */
  const inicio = buffer.subarray(0, 400).toString('utf8').trim().toLowerCase();
  if (inicio.startsWith('<svg') || (inicio.startsWith('<?xml') && inicio.includes('<svg'))) return true;
  return false;
}

/** Extensión de archivo según el tipo de imagen. */
export function extensionDeImagen(buffer, tipo = '') {
  const textoTipo = String(tipo).toLowerCase();
  if (textoTipo.includes('png')) return '.png';
  if (textoTipo.includes('webp')) return '.webp';
  if (textoTipo.includes('gif')) return '.gif';
  if (textoTipo.includes('svg')) return '.svg';
  if (buffer && buffer[0] === 0x89 && buffer[1] === 0x50) return '.png';
  if (buffer && buffer[0] === 0x47 && buffer[1] === 0x49) return '.gif';
  const inicio = buffer ? buffer.subarray(0, 400).toString('utf8').trim().toLowerCase() : '';
  if (inicio.startsWith('<svg') || inicio.startsWith('<?xml')) return '.svg';
  return '.jpg';
}
