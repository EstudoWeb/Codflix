import { normalizeBaseUrl } from "@/lib/xtream";

export function generateCodetabsUrl(
  baseUrl: string,
  username: string,
  password: string,
  streamId: string,
  type: 'movie' | 'series',
  ext: string
): string {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  let directUrl: string;
  
  if (type === 'movie') {
    directUrl = `${normalizedBase}/movie/${username}/${password}/${streamId}.${ext}`;
  } else {
    directUrl = `${normalizedBase}/series/${username}/${password}/${streamId}.${ext}`;
  }
  
  return `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(directUrl)}`;
}

export function generateMovieCodetabsUrl(
  baseUrl: string,
  username: string,
  password: string,
  streamId: string,
  ext: string = 'mp4'
): string {
  return generateCodetabsUrl(baseUrl, username, password, streamId, 'movie', ext);
}

export function generateSeriesCodetabsUrl(
  baseUrl: string,
  username: string,
  password: string,
  streamId: string,
  ext: string = 'mp4'
): string {
  return generateCodetabsUrl(baseUrl, username, password, streamId, 'series', ext);
}