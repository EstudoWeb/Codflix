export type ProxyMode = "direct" | "allorigins" | "corsproxy" | "jsdelivr" | "cloudflare";

export type XtreamAuthResponse = {
  user_info?: {
    auth?: number | boolean;
    status?: string;
    message?: string;
    username?: string;
    password?: string;
  };
  server_info?: {
    url?: string;
    port?: string | number;
    https_port?: string | number;
    server_protocol?: string;
    rtmp_port?: string | number;
    timestamp_now?: number;
    time_now?: string;
  };
};

export function normalizeBaseUrl(input: string) {
  const raw = input.trim();
  const withProto = raw.includes("://") ? raw : `http://${raw}`;
  try {
    const u = new URL(withProto);

    // Some users paste full API paths like /get.php or /player_api.php
    // We must keep only the origin to build correct Xtream endpoints.
    return u.origin;
  } catch {
    // Fallback: best-effort cleanup
    return withProto.replace(/\/(?:player_api\.php|get\.php|xmltv\.php).*$/i, "").replace(/\/+$/g, "");
  }
}

function stripBom(s: string) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function looksLikeHtml(s: string) {
  const t = s.trim().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<body");
}

export function wrapWithProxy(url: string, mode: ProxyMode) {
  switch (mode) {
    case "allorigins":
      return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    case "corsproxy":
      return `https://corsproxy.io/?${encodeURIComponent(url)}`;
    case "jsdelivr":
      // cors.jsdelivr.net expects the full URL after the slash, encoded
      return `https://cors.jsdelivr.net/${encodeURIComponent(url)}`;
    case "cloudflare":
      // NOTE: herokuapp instance may require manual activation; kept as best-effort.
      return `https://cors-anywhere.herokuapp.com/${url}`;
    default:
      return url;
  }
}

export function buildPlayerApiUrl(params: {
  baseUrl: string;
  username: string;
  password: string;
  action?: string;
  extra?: Record<string, string | number | boolean | undefined>;
}) {
  const sp = new URLSearchParams();
  sp.set("username", params.username);
  sp.set("password", params.password);
  if (params.action) sp.set("action", params.action);
  if (params.extra) {
    for (const [k, v] of Object.entries(params.extra)) {
      if (v === undefined) continue;
      sp.set(k, String(v));
    }
  }
  return `${params.baseUrl}/player_api.php?${sp.toString()}`;
}

export function buildLiveStreamUrl(params: {
  baseUrl: string;
  username: string;
  password: string;
  streamId: string | number;
  extension?: "m3u8" | "ts";
}) {
  const ext = params.extension ?? "m3u8";
  return `${params.baseUrl}/live/${encodeURIComponent(params.username)}/${encodeURIComponent(
    params.password
  )}/${encodeURIComponent(String(params.streamId))}.${ext}`;
}

export function buildVodStreamUrl(params: {
  baseUrl: string;
  username: string;
  password: string;
  streamId: string | number;
  container?: string;
}) {
  const ext = params.container ?? "mp4";
  return `${params.baseUrl}/movie/${encodeURIComponent(params.username)}/${encodeURIComponent(
    params.password
  )}/${encodeURIComponent(String(params.streamId))}.${ext}`;
}

export function buildSeriesStreamUrl(params: {
  baseUrl: string;
  username: string;
  password: string;
  streamId: string | number;
  container?: string;
}) {
  const ext = params.container ?? "mp4";
  return `${params.baseUrl}/series/${encodeURIComponent(params.username)}/${encodeURIComponent(
    params.password
  )}/${encodeURIComponent(String(params.streamId))}.${ext}`;
}

export type XtreamSeriesInfo = {
  seasons: {
    air_date: string;
    episode_count: number;
    id: number;
    name: string;
    overview: string;
    season_number: number;
    cover: string;
    episodes: any[];
  }[];
  info: any;
  episodes: Record<string, any[]>;
};

export type XtreamVodInfo = {
  info: any;
  movie_data: any;
};

export function isMixedContent(url: string) {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:" && url.startsWith("http://");
}

export function isAuthOk(data: XtreamAuthResponse) {
  const ui = data?.user_info;
  if (!ui) return false;
  const auth = ui.auth;
  const status = (ui.status ?? "").toLowerCase();
  return auth === 1 || auth === true || status === "active";
}

export function authErrorMessage(data: XtreamAuthResponse) {
  const msg = data?.user_info?.message;
  if (msg && String(msg).trim()) return String(msg);
  const status = data?.user_info?.status;
  if (status && String(status).trim()) return `Status: ${status}`;
  return "Credenciais inválidas ou conta inativa.";
}

// Fetch com timeout usando AbortController
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function getJson<T = any>(
  url: string,
  proxyMode: ProxyMode,
  timeoutMs = 300000
): Promise<T> {
  const proxyModes: ProxyMode[] =
    proxyMode === "direct"
      ? ["direct"]
      : proxyMode === "allorigins"
        ? ["allorigins", "corsproxy", "jsdelivr", "cloudflare"]
        : [proxyMode, "allorigins", "corsproxy", "jsdelivr"];

  let lastError: Error | null = null;

  for (let i = 0; i < proxyModes.length; i++) {
    const mode = proxyModes[i];
    const isLastMode = i === proxyModes.length - 1;
    
    try {
      const finalUrl = wrapWithProxy(url, mode);
      const res = await fetchWithTimeout(finalUrl, timeoutMs);

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error("Credenciais inválidas (HTTP 401/403)");
        }
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const raw = await res.text();
      const trimmed = stripBom(raw).trim();
      
      if (!trimmed) {
        lastError = new Error("Resposta vazia do servidor");
        if (isLastMode) throw lastError;
        continue;
      }

      // Some proxies/servers return HTML error pages
      if (looksLikeHtml(trimmed)) {
        lastError = new Error(
          `Resposta HTML (proxy: ${mode}). Isso indica bloqueio do proxy, CORS ou URL incorreta.`
        );
        if (isLastMode) throw lastError;
        continue;
      }

      if (trimmed === "[]") {
        // Empty array is valid for some endpoints
        return [] as T;
      }

      try {
        return JSON.parse(trimmed) as T;
      } catch (e) {
        lastError = new Error(
          `JSON inválido (proxy: ${mode}). Servidor retornou: ${trimmed.substring(0, 140)}`
        );
        if (isLastMode) throw lastError;
        continue;
      }
    } catch (err: any) {
      lastError = err;
      if (isLastMode) {
        throw lastError;
      }
      // Otherwise, continue to next proxy
    }
  }

  throw lastError || new Error("Falha ao conectar no servidor com qualquer proxy");
}

export function getBestProxyUrl(url: string, proxyMode: ProxyMode): string {
  // For direct mode, check if it's HTTP while we're on HTTPS
  if (proxyMode === 'direct') {
    if (isMixedContent(url)) {
      // If mixed content, automatically use allorigins
      return wrapWithProxy(url, 'allorigins');
    }
    return url;
  }
  
  return wrapWithProxy(url, proxyMode);
}
