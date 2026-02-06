/**
 * Stream Candidate Generator for Live TV Channels
 * Prioriza streaming contínuo sem corte de conexão
 */

export interface StreamCandidate {
  url: string;
  label: string;
  via: "direct" | "proxy";
  format: "m3u8" | "ts" | "mp4" | "other";
}

// Proxies que suportam streaming contínuo
const PROXIES = [
  'https://api.codetabs.com/v1/proxy?quest=',
  'https://corsproxy.org/?',
];

function uniqByUrl(items: StreamCandidate[]) {
  const seen = new Set<string>();
  const out: StreamCandidate[] = [];
  for (const it of items) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

/**
 * Gera a URL real do stream no padrão Xtream Codes
 */
function buildStreamUrl(
  baseUrl: string,
  username: string,
  password: string,
  streamId: string | number,
  type: 'live' | 'movie' | 'series',
  extension: string
): string {
  const base = baseUrl.replace(/\/$/, '');
  const ext = extension ? `.${extension}` : '';
  return `${base}/${type}/${username}/${password}/${streamId}${ext}`;
}

/**
 * Gera candidatos de stream
 * Para LIVE: Prioriza HLS direto (funciona por segmentos, não corta conexão!)
 * Para VOD: Usa proxy CodeTabs
 */
export function generateStreamCandidates(params: {
  baseUrl: string;
  username: string;
  password: string;
  kind: "live" | "vod" | "series";
  streamId: string | number;
  containerExtension?: string;
}): StreamCandidate[] {
  const { baseUrl, username, password, kind, streamId, containerExtension } = params;
  const out: StreamCandidate[] = [];

  const type = kind === "vod" ? "movie" : kind;

  if (kind === "live") {
    // PARA CANAIS AO VIVO: Priorizar TS direto (funciona com mpegts.js + MSE!)
    const tsUrl = buildStreamUrl(baseUrl, username, password, streamId, type, "ts");
    const hlsUrl = buildStreamUrl(baseUrl, username, password, streamId, type, "m3u8");
    const rawUrl = buildStreamUrl(baseUrl, username, password, streamId, type, "");

    // 1. TS direto (PRIORIDADE MÁXIMA - funciona com mpegts.js + MSE, buffer infinito!)
    out.push({ url: tsUrl, label: "TS Direto", via: "direct", format: "ts" });
    
    // 2. HLS direto (fallback - funciona por segmentos)
    out.push({ url: hlsUrl, label: "HLS Direto", via: "direct", format: "m3u8" });
    
    // 3. Raw direto
    out.push({ url: rawUrl, label: "Raw Direto", via: "direct", format: "ts" });
    
    // 4. TS via proxy (se CORS bloquear)
    out.push({ url: `${PROXIES[0]}${encodeURIComponent(tsUrl)}`, label: "TS Proxy", via: "proxy", format: "ts" });
    
    // 5. HLS via proxy CodeTabs (fallback se CORS bloquear)
    out.push({ url: `${PROXIES[0]}${encodeURIComponent(hlsUrl)}`, label: "HLS Proxy", via: "proxy", format: "m3u8" });
  } else {
    // Para VOD: usar proxy CodeTabs
    const formats = [containerExtension || "mp4", "mkv", ""];
    
    for (const format of formats) {
      const realUrl = buildStreamUrl(baseUrl, username, password, streamId, type, format);
      const proxiedUrl = `${PROXIES[0]}${encodeURIComponent(realUrl)}`;
      
      out.push({
        url: proxiedUrl,
        label: format ? `CodeTabs .${format}` : "CodeTabs raw",
        via: "proxy",
        format: format === "m3u8" ? "m3u8" : format === "ts" ? "ts" : "mp4"
      });
    }
  }

  return uniqByUrl(out);
}
