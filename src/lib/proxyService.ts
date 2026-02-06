
// Proxy profissional que funciona para todos os tipos de stream
export const PROXY_GATEWAY = 'https://api.codetabs.com/v1/proxy?quest=';

/**
 * Professional Proxy Service for IPTV Streams
 * This service provides a single high-performance proxy gateway
 */

/**
 * Wraps a URL with the professional proxy gateway
 */
export function wrapWithProfessionalProxy(url: string): string {
  if (!url) return '';
  return `${PROXY_GATEWAY}${encodeURIComponent(url)}`;
}

/**
 * Generates the real IPTV stream URL based on Xtream Codes standard
 */
export function buildRealStreamUrl(params: {
  baseUrl: string;
  user: string;
  pass: string;
  id: string | number;
  type: 'live' | 'movie' | 'series';
  extension?: string;
}): string {
  const base = params.baseUrl.replace(/\/$/, '');
  const { user, pass, id, type } = params;
  
  let endpoint = '';
  let ext = params.extension || '';
  
  if (type === 'live') {
    endpoint = 'live';
    if (!ext) ext = 'ts'; // Default for live
  } else if (type === 'movie') {
    endpoint = 'movie';
    if (!ext) ext = 'mp4'; // Default for movie
  } else if (type === 'series') {
    endpoint = 'series';
    if (!ext) ext = 'mp4'; // Default for series
  }
  
  const extensionSuffix = ext ? `.${ext}` : '';
  return `${base}/${endpoint}/${user}/${pass}/${id}${extensionSuffix}`;
}
