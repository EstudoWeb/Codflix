import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import {
  authErrorMessage,
  buildPlayerApiUrl,
  getJson,
  isAuthOk,
  normalizeBaseUrl,
  type ProxyMode,
  type XtreamAuthResponse
} from "@/lib/xtream";
import { generateStreamCandidates, type StreamCandidate } from "@/lib/streamTester";
import serversJson from "./servers5684.json";
// Componente para vídeo HTML puro (MP4, MKV, etc.)
const DirectVideoPlayer = ({ 
  url, 
  className, 
  onError, 
  onCanPlay,
  onTimeUpdate 
}: { 
  url: string; 
  className?: string; 
  onError?: () => void; 
  onCanPlay?: () => void;
  onTimeUpdate?: () => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    hasStartedRef.current = false;
    
    if (videoRef.current && url) {
      const video = videoRef.current;
      
      video.pause();
      video.removeAttribute('src');
      video.load();
      
      video.src = url;
      video.load();
      
      const playVideo = () => {
        video.play().catch(() => {});
      };
      
      video.addEventListener('loadeddata', playVideo, { once: true });
      
      return () => {
        video.removeEventListener('loadeddata', playVideo);
      };
    }
  }, [url]);

  return (
    <video 
      ref={videoRef} 
      className={className} 
      controls 
      autoPlay
      playsInline
      crossOrigin="anonymous"
      style={{position: "absolute"}}
      onCanPlay={() => {
        onCanPlay?.();
      }}
      onTimeUpdate={() => {
        if (!hasStartedRef.current && videoRef.current && videoRef.current.currentTime > 0) {
          hasStartedRef.current = true;
          onTimeUpdate?.();
        }
      }}
      onError={(e) => {
        const video = e.currentTarget;
        const error = video.error;
        onError?.();
      }}
    />
  );
};

// Componente para Live TV - Suporta HLS (.m3u8) e MPEG-TS (.ts)
// HLS funciona por segmentos (não para!), MPEG-TS tem reconexão automática silenciosa
const LivePlayer = ({ 
  url, 
  format,
  className, 
  onError, 
  onPlay 
}: { 
  url: string; 
  format: "m3u8" | "ts" | "mp4" | "other";
  className?: string; 
  onError?: () => void; 
  onPlay?: () => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hasPlayedRef = useRef(false);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDestroyedRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isDestroyedRef.current = false;
    hasPlayedRef.current = false;

    if (!videoRef.current || !url) return;

    // Timeout de segurança inicial
    errorTimeoutRef.current = setTimeout(() => {
      if (!hasPlayedRef.current && !isDestroyedRef.current) {
        onError?.();
      }
    }, 15000);

    const video = videoRef.current;

    // USAR HLS.js para streams .m3u8 (FUNCIONA POR SEGMENTOS - NÃO PARA!)
    if (format === "m3u8") {
      // Verificar suporte nativo (Safari/iOS)
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.play().catch(() => {});
        return;
      }

      if (!Hls.isSupported()) {
        video.src = url;
        video.play().catch(() => {});
        return;
      }

      try {
        const hls = new Hls({
          debug: false,
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 60,
          maxBufferSize: 120 * 1000 * 1000,
          fragLoadingMaxRetry: 10,
          manifestLoadingMaxRetry: 10,
          levelLoadingMaxRetry: 10,
          fragLoadingMaxRetryTimeout: 10000,
          manifestLoadingMaxRetryTimeout: 10000,
        });

        hls.attachMedia(video);

        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          hls.loadSource(url);
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                if (!hasPlayedRef.current) {
                  onError?.();
                }
                break;
            }
          }
        });

        hlsRef.current = hls;
      } catch (e) {
        if (!hasPlayedRef.current) onError?.();
      }
    } 
    // USAR mpegts.js para streams .ts com reconexão automática silenciosa
    else if (format === "ts" && mpegts.getFeatureList().mseLivePlayback) {
      try {
        const createPlayer = () => {
          if (isDestroyedRef.current) return;
          
          const player = mpegts.createPlayer({
            type: 'mpegts',
            isLive: true,
            url: url,
            cors: true
          }, {
            enableWorker: true,
            enableStashBuffer: true,
            stashInitialSize: 1024 * 1024,
            autoCleanupSourceBuffer: true,
            autoCleanupMaxBackwardDuration: 300,
            autoCleanupMinBackwardDuration: 120,
            lazyLoad: false,
            liveBufferLatencyChasing: false,
            liveBufferLatencyMaxLatency: 300,
            liveBufferLatencyMinRemain: 30,
            fixAudioTimestampGap: true,
            accurateSeek: false,
            seekType: 'range',
            reuseRedirectedURL: true,
          });

          // Reconexão automática silenciosa quando o stream termina
          player.on(mpegts.Events.LOADING_COMPLETE, () => {
            if (!isDestroyedRef.current && hasPlayedRef.current) {
              // Reconectar em 500ms
              reconnectTimeoutRef.current = setTimeout(() => {
                if (!isDestroyedRef.current) {
                  try {
                    player.unload();
                    player.load();
                    player.play()?.catch(() => {});
                  } catch {
                    // Recriar player se falhar
                    try { player.destroy(); } catch {}
                    playerRef.current = null;
                    createPlayer();
                  }
                }
              }, 500);
            }
          });

          player.on(mpegts.Events.ERROR, (_errType: any, _errDetail: any) => {
            if (!hasPlayedRef.current && !isDestroyedRef.current) {
              onError?.();
            } else if (hasPlayedRef.current && !isDestroyedRef.current) {
              // Reconectar silenciosamente após erro durante reprodução
              reconnectTimeoutRef.current = setTimeout(() => {
                if (!isDestroyedRef.current) {
                  try {
                    player.unload();
                    player.load();
                    player.play()?.catch(() => {});
                  } catch {
                    try { player.destroy(); } catch {}
                    playerRef.current = null;
                    createPlayer();
                  }
                }
              }, 1000);
            }
          });

          player.attachMediaElement(video);
          player.load();
          player.play()?.catch(() => {});
          
          playerRef.current = player;
        };

        createPlayer();
      } catch (e) {
        if (!hasPlayedRef.current) onError?.();
      }
    }
    // Fallback para vídeo direto
    else {
      video.src = url;
      video.play().catch(() => {});
    }

    return () => {
      isDestroyedRef.current = true;
      
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = null;
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch {}
        hlsRef.current = null;
      }
      
      if (playerRef.current) {
        try {
          playerRef.current.pause();
          playerRef.current.unload();
          playerRef.current.detachMediaElement();
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }
    };
  }, [url, format, onError]);

  const handleTimeUpdate = () => {
    if (!hasPlayedRef.current && videoRef.current && videoRef.current.currentTime > 0) {
      hasPlayedRef.current = true;
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = null;
      }
      onPlay?.();
    }
  };

  return (
    <video 
      ref={videoRef} 
      className={className} 
      controls 
      autoPlay 
      playsInline
      crossOrigin="anonymous"
      onPlay={handleTimeUpdate}
      onTimeUpdate={handleTimeUpdate}
      onPlaying={handleTimeUpdate}
      onEnded={() => {
        // Para HLS: não deveria acontecer em live
        // Para MPEG-TS: o mpegts.js vai reconectar automaticamente
      }}
      style={{ width: '100%', position: "absolute" }}
    />
  );
};

type ContentType = "live" | "movie" | "series";
type Category = { id: string; name: string };
type Stream = {
  id: string;
  name: string;
  icon?: string;
  categoryId?: string;
  containerExtension?: string;
  rating?: string;
  year?: string;
  plot?: string;
  director?: string;
  cast?: string;
  genre?: string;
  releaseDate?: string;
  runtime?: number;
  epgChannelId?: string;
};

type EpgProgramme = {
  start: string;
  stop: string;
  channel: string;
  title: string;
  desc?: string;
};

type EpgData = {
  programmes: EpgProgramme[];
  channelMap: Map<string, EpgProgramme[]>;
};

type ContentCache = {
  categories: Category[];
  streams: Stream[];
  loaded: boolean;
  loading: boolean;
  error?: string;
};

type Profile = {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  proxyMode: ProxyMode;
  createdAt: number;
};

const STORAGE_KEY = "xtreamProfiles.v1";

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function makeProfileName(baseUrl: string, username: string) {
  try {
    const u = new URL(baseUrl);
    return `${username} • ${u.host}`;
  } catch { return `${username} • ${baseUrl}`; }
}

function explainNetworkError(err: any) {
  const raw = String(err?.message ?? "");
  if (!raw) return "Falha de rede.";
  if (/timeout/i.test(raw)) return "Tempo limite excedido.";
  if (/json inválido/i.test(raw)) return "Resposta inválida.";
  if (/network error/i.test(raw)) return "Falha de rede.";
  return raw;
}

export function App() {
  const [view, setView] = useState<"profiles" | "login" | "browse" | "player">("profiles");

  // Profiles
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const activeProfile = useMemo(() => profiles.find((p) => p.id === activeProfileId) ?? null, [profiles, activeProfileId]);

  // Login form
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Content Selection
  const [contentType, setContentType] = useState<ContentType>("movie");
  const [contentCache, setContentCache] = useState<Record<ContentType, ContentCache>>(
    {
      live: { categories: [], streams: [], loaded: false, loading: false },
      movie: { categories: [], streams: [], loaded: false, loading: false },
      series: { categories: [], streams: [], loaded: false, loading: false },
    }
  );

  // Data
  const [categories, setCategories] = useState<Category[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // Player
  const [selectedStream, setSelectedStream] = useState<Stream | null>(null);
  const [selectedContentInfo, setSelectedContentInfo] = useState<any>(null);
  const [seriesDetails, setSeriesDetails] = useState<{ seasons: any[], episodes: Record<string, any[]> } | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [selectedEpisode, setSelectedEpisode] = useState<any>(null);
  
  // VOD Player
  const [vodCandidates, setVodCandidates] = useState<string[]>([]);
  const [vodCurrentIndex, setVodCurrentIndex] = useState(0);
  const [vodStatus, setVodStatus] = useState<"loading" | "playing" | "offline">("loading");
  const vodTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vodStartedRef = useRef(false);
  
  // Live TV Player
  const [streamCandidates, setStreamCandidates] = useState<StreamCandidate[]>([]);
  const [currentStreamIndex, setCurrentStreamIndex] = useState(0);
  const [isTryingAlternative, setIsTryingAlternative] = useState(false);
  const [isContentOffline, setIsContentOffline] = useState(false);
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveStartedRef = useRef(false);

  // EPG
  const [epgData, setEpgData] = useState<EpgData | null>(null);
  const [epgLoading, setEpgLoading] = useState(false);

  // UX
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  // Load profiles from storage
  useEffect(() => {
    const saved = safeJsonParse<Profile[]>(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved)) {
      setProfiles(saved);
      setView(saved.length ? "profiles" : "login");
    } else {
      setView("login");
    }
  }, []);

  // Persist profiles
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles)); }, [profiles]);

  const resetData = () => {
    setCategories([]);
    setStreams([]);
    setSelectedCategoryId(null);
    setSelectedStream(null);
    setVodCandidates([]);
    setVodCurrentIndex(0);
    setStreamCandidates([]);
    setCurrentStreamIndex(0);
  };

  const goToProfiles = () => {
    setError("");
    setStatus("");
    setLoading(false);
    setActiveProfileId(null);
    resetData();
    setView("profiles");
  };

  const removeProfile = (id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    if (activeProfileId === id) goToProfiles();
  };

  // Parse EPG XMLTV
  const parseEpgXml = (xmlText: string): EpgData => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const programmes: EpgProgramme[] = [];
    const channelMap = new Map<string, EpgProgramme[]>();

    const programmeNodes = xmlDoc.getElementsByTagName("programme");
    for (let i = 0; i < programmeNodes.length; i++) {
      const prog = programmeNodes[i];
      const channel = prog.getAttribute("channel") || "";
      const start = prog.getAttribute("start") || "";
      const stop = prog.getAttribute("stop") || "";
      
      const titleNode = prog.getElementsByTagName("title")[0];
      const title = titleNode?.textContent || "Sem título";
      
      const descNode = prog.getElementsByTagName("desc")[0];
      const desc = descNode?.textContent || undefined;

      const programme: EpgProgramme = { start, stop, channel, title, desc };
      programmes.push(programme);

      if (!channelMap.has(channel)) {
        channelMap.set(channel, []);
      }
      channelMap.get(channel)!.push(programme);
    }

    return { programmes, channelMap };
  };

  const loadEpg = async (profile: Profile) => {
    if (epgLoading || epgData) return;
    
    setEpgLoading(true);
    try {
      const epgUrl = `${profile.baseUrl}/xmltv.php?username=${encodeURIComponent(profile.username)}&password=${encodeURIComponent(profile.password)}`;
      
      const response = await fetch(epgUrl);
      if (!response.ok) {
        setEpgLoading(false);
        return;
      }
      
      const xmlText = await response.text();
      const parsed = parseEpgXml(xmlText);
      setEpgData(parsed);
    } catch (err) {
      // Silencioso
    } finally {
      setEpgLoading(false);
    }
  };

  const detectProxyMode = (inputUrl: string): ProxyMode => {
    try {
      const urlObj = new URL(inputUrl.includes("://") ? inputUrl : `http://${inputUrl}`);
      if (urlObj.protocol === "http:" && window.location.protocol === "https:") return "allorigins";
      return "direct";
    } catch { return "allorigins"; }
  };

  const validateAndAddProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setStatus("Validando usuário no servidor...");
    setLoading(true);

    try {
      const servers: string[] = Array.isArray(serversJson) ? serversJson : [];
      
      if (servers.length === 0) {
        setLoading(false);
        setStatus("");
        setError("Nenhum servidor configurado no arquivo servers.json");
        return;
      }

      // Criar promessas para todas as URLs simultaneamente (silenciosamente)
      const loginPromises = servers.map(async (serverUrl) => {
        try {
          const baseUrl = normalizeBaseUrl(serverUrl);
          const detectedProxyMode = detectProxyMode(serverUrl);
          
          const authUrl = buildPlayerApiUrl({ baseUrl, username, password });
          const auth = await getJson<XtreamAuthResponse>(authUrl, detectedProxyMode, 300000);

          if (isAuthOk(auth)) {
            return { success: true as const, baseUrl, proxyMode: detectedProxyMode };
          }
          return { success: false as const, baseUrl, proxyMode: detectedProxyMode, error: authErrorMessage(auth) };
        } catch (err: any) {
          return { success: false as const, baseUrl: serverUrl, proxyMode: "direct" as ProxyMode, error: err.message };
        }
      });

      // Aguardar todas as promessas terminarem para ver se alguma teve sucesso
      const allResults = await Promise.all(loginPromises);
      const successResult = allResults.find(r => r.success);

      if (successResult && successResult.success) {
        const { baseUrl, proxyMode } = successResult;

        const id = `${baseUrl}::${username}`;
        const next: Profile = {
          id,
          name: makeProfileName(baseUrl, username),
          baseUrl,
          username,
          password,
          proxyMode,
          createdAt: Date.now(),
        };

        setProfiles((prev) => {
          const existingIdx = prev.findIndex((p) => p.id === id);
          if (existingIdx >= 0) {
            const copy = [...prev];
            copy[existingIdx] = next;
            return copy;
          }
          return [next, ...prev];
        });

        setLoading(false);
        setStatus("");
        setView("profiles");
        setPassword("");
      } else {
        // Todas falharam
        setLoading(false);
        setStatus("");
        setError("Dados de login inválidos, ou não renovado!");
      }
    } catch (err: any) {
      setLoading(false);
      setStatus("");
      setError(explainNetworkError(err));
    }
  };

  const loadContent = async (profile: Profile, type: ContentType) => {
    setError("");
    setStatus(`Carregando ${type === "live" ? "canais" : type === "movie" ? "filmes" : "séries"}...`);
    setLoading(true);

    setCategories([]);
    setStreams([]);
    setSelectedCategoryId(null);
    setContentCache((prev) => ({
      ...prev,
      [type]: { ...(prev[type] ?? { categories: [], streams: [] }), loaded: false, loading: true, error: undefined },
    }));
    
    try {
      const authUrl = buildPlayerApiUrl({ baseUrl: profile.baseUrl, username: profile.username, password: profile.password });
      const auth = await getJson<XtreamAuthResponse>(authUrl, profile.proxyMode, 300000);
      if (!isAuthOk(auth)) throw new Error(authErrorMessage(auth));

      const actions = {
        live: { cat: "get_live_categories", stream: "get_live_streams" },
        movie: { cat: "get_vod_categories", stream: "get_vod_streams" },
        series: { cat: "get_series_categories", stream: "get_series" },
      };

      const { cat: catAction, stream: streamAction } = actions[type];

      const catUrl = buildPlayerApiUrl({ baseUrl: profile.baseUrl, username: profile.username, password: profile.password, action: catAction });
      setStatus(`Carregando categorias...`);
      const catRaw = await getJson<any[]>(catUrl, profile.proxyMode, 300000);
      const cats: Category[] = Array.isArray(catRaw)
        ? catRaw.map((c: any) => ({ id: String(c.category_id ?? c.id ?? ""), name: String(c.category_name ?? c.name ?? "") })).filter((c) => c.id && c.name)
        : [];
      setCategories(cats);

      const streamsUrl = buildPlayerApiUrl({ baseUrl: profile.baseUrl, username: profile.username, password: profile.password, action: streamAction });
      setStatus(`Carregando conteúdo...`);
      const streamsRaw = await getJson<any[]>(streamsUrl, profile.proxyMode, 300000);
      const mappedStreams: Stream[] = Array.isArray(streamsRaw)
        ? streamsRaw.map((s: any) => ({
            id: String(s.stream_id ?? s.series_id ?? s.id ?? ""),
            name: String(s.name ?? s.title ?? ""),
            icon: s.stream_icon ?? s.cover ?? s.series_cover ? String(s.stream_icon ?? s.cover ?? s.series_cover) : undefined,
            categoryId: s.category_id !== undefined ? String(s.category_id) : undefined,
            containerExtension: s.container_extension ? String(s.container_extension) : undefined,
            rating: s.rating ? String(s.rating) : undefined,
            year: s.year ? String(s.year) : undefined,
            epgChannelId: s.epg_channel_id ? String(s.epg_channel_id) : undefined,
          })).filter((s) => s.id && s.name)
        : [];

      // Carregar EPG para canais ao vivo
      if (type === "live" && !epgData) {
        loadEpg(profile).catch(err => console.warn("[EPG] Erro ao carregar:", err));
      }

      setStreams(mappedStreams);
      setContentCache((prev) => ({
        ...prev,
        [type]: { categories: cats, streams: mappedStreams, loaded: true, loading: false, error: undefined },
      }));
      setActiveProfileId(profile.id);
      setContentType(type);
      setLoading(false);
      setStatus("");
      setView("browse");
    } catch (err: any) {
      console.error(err);
      setLoading(false);
      setStatus("");
      setError(explainNetworkError(err));
      if (view !== "browse") setView("profiles");
    }
  };

  const loadProfileInitial = async (profile: Profile) => { await loadContent(profile, "movie"); };

  const switchContentType = async (type: ContentType) => {
    const cached = contentCache[type];
    setContentType(type);
    setSelectedCategoryId(null);
    if (cached?.loaded) {
      setCategories(cached.categories);
      setStreams(cached.streams);
      setLoading(false);
      setStatus("");
      return;
    }
    if (activeProfile) await loadContent(activeProfile, type);
  };

  const [top10, setTop10] = useState<Stream[]>([]);
  const TMDB_API_KEY = "302e14c74c0902c7b6b5a18555ddd02d";

  useEffect(() => {
    const fetchTop10 = async () => {
      if (streams.length === 0) return;
      
      if (contentType === 'live') {
        setTop10(streams.slice(0, 10));
        return;
      }

      try {
        const tmdbType = contentType === 'movie' ? 'movie' : 'tv';
        const url = `https://api.themoviedb.org/3/${tmdbType}/popular?api_key=${TMDB_API_KEY}&language=pt-BR&page=1`;
        const response = await fetch(url);
        const data = await response.json();
        const popularTmdb = data.results || [];

        const dynamicTop10: Stream[] = [];
        const usedIds = new Set<string>();

        // 1. Tentar encontrar os populares do TMDB no servidor
        for (const item of popularTmdb) {
          if (dynamicTop10.length >= 10) break;
          const name = (item.title || item.name || "").toLowerCase();
          
          const match = streams.find(s => {
            const sName = s.name.toLowerCase();
            return sName.includes(name) || name.includes(sName);
          });

          if (match && !usedIds.has(match.id)) {
            dynamicTop10.append ? null : dynamicTop10.push(match);
            usedIds.add(match.id);
          }
        }

        // 2. Se faltar, preencher com aleatórios do servidor
        if (dynamicTop10.length < 10) {
          const available = streams.filter(s => !usedIds.has(s.id));
          const shuffled = [...available].sort(() => 0.5 - Math.random());
          for (const s of shuffled) {
            if (dynamicTop10.length >= 10) break;
            dynamicTop10.push(s);
            usedIds.add(s.id);
          }
        }

        setTop10(dynamicTop10.slice(0, 10));
      } catch (err) {
        console.error("Erro ao buscar Top 10 TMDB", err);
        setTop10(streams.slice(0, 10));
      }
    };

    fetchTop10();
  }, [streams, contentType]);

  useEffect(() => {
    const cached = contentCache[contentType];
    if (cached?.loaded) {
      setCategories(cached.categories);
      setStreams(cached.streams);
      setLoading(false);
      setStatus("");
    }
  }, [contentType, contentCache]);

  const filteredStreams = useMemo(() => {
    let filtered = streams;
    if (selectedCategoryId) filtered = filtered.filter((s) => String(s.categoryId ?? "") === String(selectedCategoryId));
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((s) => s.name.toLowerCase().includes(term));
    }
    return filtered;
  }, [streams, selectedCategoryId, searchTerm]);

  const openDetails = async (stream: Stream) => {
    setSelectedStream(stream);
    setSelectedContentInfo(null);
    setSeriesDetails(null);
    setSelectedEpisode(null);
    
    if (activeProfile) {
      if (contentType === "live") {
        startLivePlayback(stream);
        return;
      }

      setLoading(true);
      setStatus("Carregando detalhes...");
      try {
        const action = contentType === "movie" ? "get_vod_info" : "get_series_info";
        const infoUrl = buildPlayerApiUrl({
          baseUrl: activeProfile.baseUrl,
          username: activeProfile.username,
          password: activeProfile.password,
          action,
          extra: { [contentType === "movie" ? "vod_id" : "series_id"]: stream.id }
        });
        const details = await getJson<any>(infoUrl, activeProfile.proxyMode, 300000);
        setSelectedContentInfo(details.info || details.movie_data || details || {});
        
        if (contentType === "series") {
          const seasons = details.seasons || [];
          let episodesRaw = details.episodes || {};
          
          const processedEpisodes: Record<string, any[]> = {};

          if (typeof episodesRaw === 'object' && !Array.isArray(episodesRaw)) {
            for (const [seasonKey, episodeList] of Object.entries(episodesRaw)) {
              if (Array.isArray(episodeList)) {
                processedEpisodes[seasonKey] = episodeList.map((ep: any, idx: number) => ({
                  id: ep.id || ep.episode_id || `${stream.id}_${seasonKey}_${idx}`,
                  episode_num: ep.episode_num || ep.episode_number || idx + 1,
                  title: ep.title || ep.name || `Episódio ${ep.episode_num || idx + 1}`,
                  info: ep.info || {},
                  container_extension: ep.container_extension || ep.container_ext || 'mp4',
                  stream_id: ep.id || ep.episode_id || ep.stream_id
                }));
              }
            }
          } else if (Array.isArray(episodesRaw)) {
            episodesRaw.forEach((ep: any, idx: number) => {
              const sNum = ep.season || ep.season_number || 1;
              if (!processedEpisodes[sNum]) processedEpisodes[sNum] = [];
              processedEpisodes[sNum].push({
                id: ep.id || ep.episode_id || `${stream.id}_${sNum}_${idx}`,
                episode_num: ep.episode_num || ep.episode_number || idx + 1,
                title: ep.title || ep.name || `Episódio ${ep.episode_num || idx + 1}`,
                info: ep.info || {},
                container_extension: ep.container_extension || ep.container_ext || 'mp4',
                stream_id: ep.id || ep.episode_id || ep.stream_id
              });
            });
          }

          setSeriesDetails({ seasons, episodes: processedEpisodes });
          
          const seasonNumbers = Object.keys(processedEpisodes).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
          if (seasonNumbers.length > 0) setSelectedSeason(seasonNumbers[0]);
          else if (seasons.length > 0) setSelectedSeason(seasons[0].season_number || 1);
          else setSelectedSeason(1);
        }
      } catch (err) {
        console.error("Erro ao carregar detalhes", err);
        if (contentType === "movie") {
          startVodPlayback(stream);
          return;
        }
      } finally {
        setLoading(false);
        setStatus("");
      }
    }
  };

  // ========== VOD PLAYER (FILMES/SÉRIES) ==========
  const startVodPlayback = useCallback((stream: Stream, episode?: any) => {
    if (!activeProfile) return;

    if (vodTimeoutRef.current) {
      clearTimeout(vodTimeoutRef.current);
      vodTimeoutRef.current = null;
    }

    vodStartedRef.current = false;
    setVodStatus("loading");
    setError("");
    setSelectedStream(stream);
    setSelectedEpisode(episode || null);

    const streamId = episode?.stream_id || episode?.id || stream.id;
    const ext = episode?.container_extension || stream.containerExtension || 'mp4';
    const type = contentType === "series" ? "series" : "movie";

    const codetabsUrl1 = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`${normalizeBaseUrl(activeProfile.baseUrl)}/${type}/${activeProfile.username}/${activeProfile.password}/${streamId}.${ext}`)}`;
    const codetabsUrl2 = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`${normalizeBaseUrl(activeProfile.baseUrl)}/${type}/${activeProfile.username}/${activeProfile.password}/${streamId}`)}`;
    const codetabsUrl3 = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`${normalizeBaseUrl(activeProfile.baseUrl)}/${type}/${activeProfile.username}/${activeProfile.password}/${streamId}.mp4`)}`;
    
    const candidates = [codetabsUrl1, codetabsUrl2, codetabsUrl3];

    setVodCandidates(candidates);
    setVodCurrentIndex(0);
    setView("player");

    vodTimeoutRef.current = setTimeout(() => {
      if (!vodStartedRef.current) {
        tryNextVodCandidate();
      }
    }, 15000);
  }, [activeProfile, contentType]);

  const tryNextVodCandidate = useCallback(() => {
    if (vodTimeoutRef.current) {
      clearTimeout(vodTimeoutRef.current);
      vodTimeoutRef.current = null;
    }

    setVodCurrentIndex((prev) => {
      const next = prev + 1;
      if (next < vodCandidates.length) {
        vodStartedRef.current = false;
        
        vodTimeoutRef.current = setTimeout(() => {
          if (!vodStartedRef.current) {
            tryNextVodCandidate();
          }
        }, 15000);
        
        return next;
      } else {
        setVodStatus("offline");
        return prev;
      }
    });
  }, [vodCandidates.length]);

  const onVodPlaying = useCallback(() => {
    if (!vodStartedRef.current) {
      vodStartedRef.current = true;
      setVodStatus("playing");
      
      if (vodTimeoutRef.current) {
        clearTimeout(vodTimeoutRef.current);
        vodTimeoutRef.current = null;
      }
    }
  }, []);

  const onVodError = useCallback(() => {
    if (!vodStartedRef.current) {
      tryNextVodCandidate();
    }
  }, [tryNextVodCandidate]);

  // ========== LIVE PLAYER (CANAIS) ==========
  const startLivePlayback = useCallback((stream: Stream) => {
    if (!activeProfile) return;

    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
    
    liveStartedRef.current = false;
    setIsContentOffline(false);
    setError("");
    setSelectedStream(stream);
    setSelectedEpisode(null);

    const candidates = generateStreamCandidates({
      baseUrl: activeProfile.baseUrl,
      username: activeProfile.username,
      password: activeProfile.password,
      kind: "live",
      streamId: stream.id,
      containerExtension: stream.containerExtension,
    });

    if (candidates.length === 0) {
      setError("Nenhum stream disponível.");
      return;
    }

    setStreamCandidates(candidates);
    setCurrentStreamIndex(0);
    setIsTryingAlternative(true);
    setView("player");

    streamTimeoutRef.current = setTimeout(() => {
      if (!liveStartedRef.current) {
        tryNextLiveStream();
      }
    }, 15000);
  }, [activeProfile]);

  const tryNextLiveStream = useCallback(() => {
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
    
    liveStartedRef.current = false;
    
    setCurrentStreamIndex((prev) => {
      const next = prev + 1;
      if (next < streamCandidates.length) {
        setIsTryingAlternative(true);
        
        streamTimeoutRef.current = setTimeout(() => {
          if (!liveStartedRef.current) {
            tryNextLiveStream();
          }
        }, 15000);
        
        return next;
      } else {
        setIsTryingAlternative(false);
        setIsContentOffline(true);
        return prev;
      }
    });
  }, [streamCandidates.length]);

  const stopPlayback = () => {
    if (vodTimeoutRef.current) {
      clearTimeout(vodTimeoutRef.current);
      vodTimeoutRef.current = null;
    }
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
    setSelectedStream(null);
    setSelectedEpisode(null);
    setVodCandidates([]);
    setVodCurrentIndex(0);
    setVodStatus("loading");
    setCurrentStreamIndex(0);
    setIsContentOffline(false);
    setError("");
    setView("browse");
  };

  const closeDetails = () => {
    setSelectedStream(null);
    setSelectedContentInfo(null);
    setSeriesDetails(null);
    setSelectedEpisode(null);
  };

  const availableSeasons = useMemo(() => {
    if (!seriesDetails) return [];
    const episodeSeasons = Object.keys(seriesDetails.episodes).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
    if (episodeSeasons.length > 0) return episodeSeasons;
    return seriesDetails.seasons.map((s: any) => s.season_number).filter(Boolean);
  }, [seriesDetails]);

  const currentEpisodes = useMemo(() => {
    if (!seriesDetails) return [];
    return seriesDetails.episodes[selectedSeason] || seriesDetails.episodes[String(selectedSeason)] || [];
  }, [seriesDetails, selectedSeason]);

  const currentVodUrl = vodCandidates[vodCurrentIndex] || "";
  const currentLiveStream = streamCandidates[currentStreamIndex];
  const currentLiveUrl = currentLiveStream?.url || "";

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-red-600 selection:text-white">
      {/* PROFILES */}
      {view === "profiles" && (
        <div className="min-h-screen bg-gray-900 bg-[url('https://assets.nflxext.com/ffe/siteui/vlv3/c38a2d52-138e-48a3-ab68-36787ece46b3/eeb03fc9-99c6-438e-824d-32917ce55783/IN-en-20240101-popsignuptwoweeks-perspective_alpha_website_large.jpg')] bg-cover bg-blend-overlay">
          <header className="flex flex-col sm:flex-row justify-between items-center px-4 sm:px-6 py-4 sm:py-5 bg-black/60 backdrop-blur-md border-b border-white/10 gap-3">
            <div className="text-2xl sm:text-3xl font-bold tracking-tighter">COD<span style={{color:"red"}}>FLIX</span> <span className="text-white text-xs font-light">IPTV</span></div>
            <button
              onClick={() => { setError(""); setStatus(""); setView("login"); }}
              className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded transition text-sm sm:text-base"
            >
              Adicionar usuário
            </button>
          </header>

          <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
            <h1 className="text-xl sm:text-2xl font-bold mb-2">Quem está assistindo?</h1>
            <p className="text-sm text-gray-300 mb-6">Selecione um usuário para carregar o conteúdo.</p>

            {(error || status) && (
              <div className="mb-6 space-y-2">
                {status && <div className="p-3 bg-white/10 border border-white/10 rounded text-sm">{status}</div>}
                {error && <div className="p-3 bg-red-900/50 border border-red-500 rounded text-sm">{error}</div>}
              </div>
            )}

            {profiles.length === 0 ? (
              <div className="p-6 bg-black/70 border border-white/10 rounded-lg">
                <p className="text-gray-200">Nenhum usuário adicionado ainda.</p>
                <button onClick={() => { setError(""); setStatus(""); setView("login"); }} className="mt-4 bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded transition">
                  Adicionar primeiro usuário
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {profiles.map((p) => (
                  <div key={p.id} className="bg-black/70 border border-white/10 rounded-xl p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-base sm:text-lg font-semibold truncate">{p.username} / Ativo ✅</div>
                        <div className="text-xs text-gray-400 mt-1 truncate">Pronto para assistir</div>
                      </div>
                      <button onClick={() => removeProfile(p.id)} className="text-xs text-gray-300 hover:text-white border border-white/20 hover:border-white/40 px-2 py-1 rounded transition flex-shrink-0" title="Remover usuário">✕</button>
                    </div>
                    <button onClick={() => loadProfileInitial(p)} disabled={loading} className="mt-4 w-full bg-white text-black font-bold py-2 rounded hover:bg-gray-200 transition disabled:opacity-60">
                      {loading ? "Carregando..." : "Entrar"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      )}

      {/* LOGIN */}
      {view === "login" && (
        <div className="flex items-center justify-center min-h-screen bg-gray-900 bg-[url('https://assets.nflxext.com/ffe/siteui/vlv3/c38a2d52-138e-48a3-ab68-36787ece46b3/eeb03fc9-99c6-438e-824d-32917ce55783/IN-en-20240101-popsignuptwoweeks-perspective_alpha_website_large.jpg')] bg-cover bg-blend-overlay p-4">
          <div className="bg-black/80 backdrop-blur-md rounded-xl p-6 sm:p-8 max-w-md w-full border border-gray-700 shadow-2xl">
          <h1 className="text-xl sm:text-2xl font-bold text-white" style={{fontSize:"28px"}}>Cod<span className="text-red-600">Flix</span></h1>
            <div className="flex items-center justify-between gap-3 mb-6">
              <h1 style={{marginTop: "10px"}}>Adicionar Xtream</h1>
              <button onClick={() => setView(profiles.length ? "profiles" : "login")} className="text-sm text-gray-300 hover:text-white underline">Voltar</button>
            </div>

            {(error || status) && (
              <div className="mb-4 space-y-2">
                {status && <div className="p-3 bg-white/10 border border-white/10 rounded text-sm">{status}</div>}
                {error && <div className="p-3 bg-red-900/50 border border-red-500 rounded text-white text-sm">{error}</div>}
              </div>
            )}

            <form onSubmit={validateAndAddProfile} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Usuário</label>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required className="w-full p-3 bg-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600 transition" placeholder="username" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Senha</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full p-3 bg-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-red-600 transition" placeholder="password" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded transition disabled:opacity-50">
                {loading ? "Validando..." : "Validar e adicionar"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* BROWSE */}
      {view === "browse" && activeProfile && (
        <div className="relative pb-20">
          <header className="flex justify-between items-center px-4 sm:px-6 py-3 sm:py-4 bg-black sticky top-0 z-20 backdrop-blur-sm border-b border-white/10">
            <div className="flex items-center gap-4 sm:gap-8">
              <div className="text-xl sm:text-3xl font-bold text-red-600 tracking-tighter cursor-pointer" onClick={() => setSelectedCategoryId(null)}>
                CODFLIX <span className="text-white text-[10px] sm:text-xs font-light">IPTV</span>
              </div>
              
              <nav className="hidden md:flex items-center gap-6">
                <button onClick={() => switchContentType("live")} className={`text-sm transition hover:text-gray-300 ${contentType === "live" ? "font-bold text-white" : "text-gray-400"}`}>Canais ao vivo</button>
                <button onClick={() => switchContentType("movie")} className={`text-sm transition hover:text-gray-300 ${contentType === "movie" ? "font-bold text-white" : "text-gray-400"}`}>Filmes</button>
                <button onClick={() => switchContentType("series")} className={`text-sm transition hover:text-gray-300 ${contentType === "series" ? "font-bold text-white" : "text-gray-400"}`}>Séries</button>
              </nav>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="relative hidden sm:block">
                <input type="text" placeholder="Pesquisar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="bg-black/50 border border-white/20 rounded-full px-4 py-1 text-sm focus:outline-none focus:border-red-600 transition w-32 lg:w-60" />
              </div>
              <button onClick={goToProfiles} className="bg-transparent border border-white/50 text-white hover:bg-white hover:text-black hover:border-white px-3 sm:px-4 py-1 rounded text-xs sm:text-sm transition font-medium">Sair</button>
            </div>
          </header>

          {/* Mobile Nav */}
          <div className="md:hidden bg-black/80 border-b border-white/10 sticky top-[52px] z-20">
            <div className="flex items-center justify-around py-2">
              <button onClick={() => switchContentType("live")} className={`text-xs uppercase tracking-wider px-3 py-1 ${contentType === "live" ? "text-white font-bold" : "text-gray-500"}`}>Canais</button>
              <button onClick={() => switchContentType("movie")} className={`text-xs uppercase tracking-wider px-3 py-1 ${contentType === "movie" ? "text-white font-bold" : "text-gray-500"}`}>Filmes</button>
              <button onClick={() => switchContentType("series")} className={`text-xs uppercase tracking-wider px-3 py-1 ${contentType === "series" ? "text-white font-bold" : "text-gray-500"}`}>Séries</button>
            </div>
            <div className="px-4 pb-2">
              <input type="text" placeholder="Pesquisar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-gray-900 border border-white/10 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-red-600 transition" />
            </div>
          </div>

          <div className="flex overflow-x-auto px-4 sm:px-6 py-3 space-x-2 sm:space-x-3 scrollbar-hide bg-black/50 backdrop-blur-sm sticky top-[52px] md:top-[60px] z-10 border-b border-gray-800/50">
            <button onClick={() => setSelectedCategoryId(null)} className={`flex-shrink-0 px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${selectedCategoryId === null ? "bg-white text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>Início</button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setSelectedCategoryId(c.id)} className={`flex-shrink-0 px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${selectedCategoryId === c.id ? "bg-white text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>{c.name}</button>
            ))}
          </div>

          <div className="p-4 sm:p-6 space-y-8 sm:space-y-10 min-h-screen relative">
            {loading && (
              <div className="absolute inset-0 bg-black/60 z-30 flex items-center justify-center backdrop-blur-sm min-h-[50vh]">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                  <div className="text-white font-medium text-sm sm:text-base">{status || "Carregando..."}</div>
                </div>
              </div>
            )}

            {searchTerm.trim() ? (
              <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl sm:text-3xl font-bold text-white">Resultados para "{searchTerm}"</h2>
                  <button onClick={() => setSearchTerm("")} className="text-gray-400 hover:text-white text-sm">Limpar pesquisa</button>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                  {filteredStreams.map((s) => (
                    <button key={s.id} onClick={() => openDetails(s)} className="text-left group">
                      <div className={`relative ${contentType === 'live' ? 'aspect-video' : 'aspect-[2/3]'} bg-gray-800 rounded-md overflow-hidden ring-1 ring-white/10 group-hover:ring-white/40 transition shadow-lg`}>
                        {s.icon ? (
                          <img src={s.icon} alt={s.name} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).src = contentType === 'live' ? "https://via.placeholder.com/300x169/111827/ffffff?text=No+Preview" : "https://via.placeholder.com/300x450/111827/ffffff?text=No+Cover"; }} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">Sem imagem</div>
                        )}
                        {s.rating && <div className="absolute top-2 right-2 bg-black/60 px-1.5 py-0.5 rounded text-[10px] font-bold border border-white/20">{s.rating}</div>}
                      </div>
                      <div className="mt-2 text-xs sm:text-sm text-gray-200 truncate font-medium">{s.name}</div>
                      {s.year && <div className="text-[10px] sm:text-[11px] text-gray-500">{s.year}</div>}
                    </button>
                  ))}
                </div>
                {filteredStreams.length === 0 && (
                  <div className="text-center py-20 bg-gray-900/50 rounded-xl border border-dashed border-white/10">
                    <div className="text-4xl mb-4">🔍</div>
                    <div className="text-gray-200 font-medium text-lg">Nenhum resultado encontrado</div>
                    <p className="text-gray-500 text-sm mt-1">Tente pesquisar por outros termos.</p>
                  </div>
                )}
              </section>
            ) : (
              <>
                {selectedCategoryId === null && top10.length > 0 && !loading && (
                  <section className="space-y-3 animate-in fade-in duration-700">
                    <h3 className="text-lg sm:text-xl font-bold text-gray-100 flex items-center gap-2">
                      <span className="text-red-600 font-black">TOP 10</span> {contentType === 'live' ? 'Canais' : contentType === 'movie' ? 'Filmes' : 'Séries'} Hoje
                    </h3>
                    <div className="flex overflow-x-auto space-x-3 sm:space-x-4 pb-4 scrollbar-hide -mx-2 px-2">
                      {top10.map((s, idx) => (
                        <button key={s.id} onClick={() => openDetails(s)} className="flex-shrink-0 w-40 sm:w-56 text-left group">
                          <div className="relative aspect-video bg-gray-800 rounded-md overflow-hidden ring-1 ring-white/10 group-hover:ring-white/40 transition">
                            {s.icon ? (
                              <img src={s.icon} alt={s.name} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/300x169/111827/ffffff?text=No+Preview"; }} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">Sem imagem</div>
                            )}
                            <div className="absolute left-2 bottom-1 text-4xl sm:text-5xl font-black text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">{idx + 1}</div>
                          </div>
                          <div className="mt-2 text-xs sm:text-sm text-gray-200 truncate">{s.name}</div>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {selectedCategoryId === null ? (
                  categories.slice(0, 15).map((cat) => {
                    const catStreams = streams.filter((s) => String(s.categoryId ?? "") === String(cat.id)).slice(0, 15);
                    if (!catStreams.length) return null;
                    return (
                      <section key={cat.id} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg sm:text-xl font-bold text-gray-100">{cat.name}</h3>
                          <button onClick={() => setSelectedCategoryId(cat.id)} className="text-xs sm:text-sm text-gray-400 hover:text-white transition">Ver tudo &rsaquo;</button>
                        </div>
                        <div className="flex overflow-x-auto space-x-3 sm:space-x-4 pb-4 scrollbar-hide -mx-2 px-2">
                          {catStreams.map((s) => (
                            <button key={s.id} onClick={() => openDetails(s)} className="flex-shrink-0 w-32 sm:w-44 md:w-56 text-left group">
                              <div className={`relative ${contentType === 'live' ? 'aspect-video' : 'aspect-[2/3]'} bg-gray-800 rounded-md overflow-hidden ring-1 ring-white/10 group-hover:ring-white/40 transition shadow-lg`}>
                                {s.icon ? (
                                  <img src={s.icon} alt={s.name} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).src = contentType === 'live' ? "https://via.placeholder.com/300x169/111827/ffffff?text=No+Preview" : "https://via.placeholder.com/300x450/111827/ffffff?text=No+Cover"; }} />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">Sem imagem</div>
                                )}
                                {s.rating && <div className="absolute top-2 right-2 bg-black/60 px-1.5 py-0.5 rounded text-[10px] font-bold border border-white/20">{s.rating}</div>}
                              </div>
                              <div className="mt-2 text-xs sm:text-sm text-gray-200 truncate font-medium">{s.name}</div>
                              {s.year && <div className="text-[10px] sm:text-[11px] text-gray-500">{s.year}</div>}
                            </button>
                          ))}
                        </div>
                      </section>
                    );
                  })
                ) : (
                  <section className="animate-in fade-in slide-in-from-right-4 duration-500">
                    <div className="flex items-center gap-3 mb-6">
                      <button onClick={() => setSelectedCategoryId(null)} className="text-gray-400 hover:text-white transition">←</button>
                      <h2 className="text-2xl sm:text-3xl font-bold text-white">{categories.find((c) => c.id === selectedCategoryId)?.name ?? "Categoria"}</h2>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                      {filteredStreams.map((s) => (
                        <button key={s.id} onClick={() => openDetails(s)} className="text-left group">
                          <div className={`relative ${contentType === 'live' ? 'aspect-video' : 'aspect-[2/3]'} bg-gray-800 rounded-md overflow-hidden ring-1 ring-white/10 group-hover:ring-white/40 transition shadow-lg`}>
                            {s.icon ? (
                              <img src={s.icon} alt={s.name} className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).src = contentType === 'live' ? "https://via.placeholder.com/300x169/111827/ffffff?text=No+Preview" : "https://via.placeholder.com/300x450/111827/ffffff?text=No+Cover"; }} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">Sem imagem</div>
                            )}
                            {s.rating && <div className="absolute top-2 right-2 bg-black/60 px-1.5 py-0.5 rounded text-[10px] font-bold border border-white/20">{s.rating}</div>}
                          </div>
                          <div className="mt-2 text-xs sm:text-sm text-gray-200 truncate font-medium">{s.name}</div>
                          {s.year && <div className="text-[10px] sm:text-[11px] text-gray-500">{s.year}</div>}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          {/* Details Modal */}
          {selectedStream && contentType !== "live" && !selectedContentInfo && loading && (
            <div className="fixed inset-0 bg-black/80 z-40 flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-600"></div>
            </div>
          )}

          {selectedStream && contentType !== "live" && selectedContentInfo && (
            <div className="fixed inset-0 bg-black/95 z-40 overflow-y-auto">
              <div className="min-h-screen">
                <div className="max-w-4xl mx-auto bg-gray-900 rounded-xl overflow-hidden shadow-2xl relative my-4 sm:my-10 mx-4 sm:mx-auto">
                  <button onClick={closeDetails} className="absolute top-3 right-3 sm:top-4 sm:right-4 z-50 bg-black/50 p-2 rounded-full hover:bg-black transition">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>

                  <div className="flex flex-col md:flex-row">
                    <div className="md:w-1/3 aspect-[2/3] relative">
                      <img src={selectedStream.icon || selectedContentInfo.cover || selectedContentInfo.movie_image} className="w-full h-full object-cover" alt={selectedStream.name} onError={(e) => (e.target as HTMLImageElement).src = "https://via.placeholder.com/300x450?text=No+Cover"} />
                      <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent"></div>
                    </div>
                    
                    <div className="md:w-2/3 p-4 sm:p-8 space-y-3 sm:space-y-4">
                      <h2 className="text-2xl sm:text-4xl font-bold">{selectedStream.name}</h2>
                      
                      <div className="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm font-medium flex-wrap">
                        {(selectedContentInfo.rating || selectedContentInfo.rating_5based) && <span className="text-green-500">★ {selectedContentInfo.rating || selectedContentInfo.rating_5based}</span>}
                        {(selectedContentInfo.releasedate || selectedContentInfo.release_date || selectedStream.year) && <span className="text-gray-400">{selectedContentInfo.releasedate || selectedContentInfo.release_date || selectedStream.year}</span>}
                        {(selectedContentInfo.duration || selectedContentInfo.runtime) && <span className="text-gray-400">{selectedContentInfo.duration || selectedContentInfo.runtime} min</span>}
                        {selectedContentInfo.genre && <span className="text-gray-400">{selectedContentInfo.genre}</span>}
                      </div>

                      <p className="text-gray-300 text-sm sm:text-base leading-relaxed line-clamp-6">
                        {selectedContentInfo.plot || selectedContentInfo.description || "Sem descrição disponível."}
                      </p>

                      {contentType === "movie" ? (
                        <button onClick={() => startVodPlayback(selectedStream)} className="w-full sm:w-auto bg-white text-black font-bold py-3 px-8 rounded hover:bg-gray-200 transition flex items-center justify-center gap-2">
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                          Assistir Agora
                        </button>
                      ) : (
                        <div className="space-y-4 sm:space-y-6">
                          <div className="flex items-center gap-4 border-b border-white/10 pb-2">
                            <h3 className="font-bold text-lg">Episódios</h3>
                            <select value={selectedSeason} onChange={(e) => setSelectedSeason(Number(e.target.value))} className="bg-transparent text-sm font-bold focus:outline-none">
                              {availableSeasons.map(s => <option key={s} value={s} className="bg-gray-900">Temporada {s}</option>)}
                            </select>
                          </div>
                          
                          <div className="grid gap-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                            {currentEpisodes.map((ep: any) => (
                              <button key={ep.id} onClick={() => startVodPlayback(selectedStream, ep)} className="flex items-center gap-4 p-2 rounded hover:bg-white/5 text-left group transition">
                                <div className="text-gray-500 font-mono text-sm w-6">{ep.episode_num}</div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium group-hover:text-red-500 transition truncate">{ep.title}</div>
                                </div>
                                <div className="opacity-0 group-hover:opacity-100 transition text-red-500">
                                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PLAYER OVERLAY */}
          {view === "player" && selectedStream && (
            <div className="fixed inset-0 z-[100] bg-black flex flex-col animate-in fade-in duration-300">
              <div className="absolute top-0 left-0 right-0 p-4 sm:p-6 z-10 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent">
                <button onClick={stopPlayback} className="flex items-center gap-2 text-white/70 hover:text-white transition group">
                  <svg className="w-6 h-6 group-hover:-translate-x-1 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  <span className="font-medium">Voltar</span>
                </button>
                <div className="flex flex-col items-end gap-1">
                  <div className="text-white font-bold text-sm sm:text-lg drop-shadow-md">{selectedEpisode ? selectedEpisode.title : selectedStream.name}</div>
                  {selectedEpisode && <div className="text-gray-400 text-xs">Temporada {selectedSeason} • Episódio {selectedEpisode.episode_num}</div>}
                </div>
              </div>

              <div className="flex-1 relative flex items-center justify-center">
                {contentType === "live" ? (
                  <>
                    {isContentOffline ? (
                      <div className="text-center p-6 animate-in zoom-in duration-300">
                        <div className="text-5xl mb-4">⚠️</div>
                        <h3 className="text-xl font-bold mb-2">Canal Temporariamente Offline</h3>
                        <p className="text-gray-400 max-w-md mx-auto">Não foi possível conectar a este canal. Tente novamente mais tarde ou escolha outro canal.</p>
                        <button onClick={stopPlayback} className="mt-6 bg-white text-black px-8 py-2 rounded-full font-bold hover:bg-gray-200 transition">Voltar para a lista</button>
                      </div>
                    ) : currentLiveUrl ? (
                      <LivePlayer 
                        url={currentLiveUrl} 
                        format={currentLiveStream.format}
                        className="w-full h-full" 
                        onError={tryNextLiveStream}
                        onPlay={() => { liveStartedRef.current = true; setIsTryingAlternative(false); }}
                      />
                    ) : null}
                    
                    {isTryingAlternative && !isContentOffline && (
                      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-3 z-20">
                        <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                        <div className="text-xs text-white font-medium">Otimizando conexão...</div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {vodStatus === "offline" ? (
                      <div className="text-center p-6 animate-in zoom-in duration-300">
                        <div className="text-5xl mb-4">❌</div>
                        <h3 className="text-xl font-bold mb-2">Erro ao carregar vídeo</h3>
                        <p className="text-gray-400">O conteúdo solicitado não está disponível no momento.</p>
                        <button onClick={stopPlayback} className="mt-6 bg-white text-black px-8 py-2 rounded-full font-bold hover:bg-gray-200 transition">Voltar</button>
                      </div>
                    ) : currentVodUrl ? (
                      <DirectVideoPlayer 
                        url={currentVodUrl} 
                        className="w-full h-full" 
                        onError={onVodError}
                        onCanPlay={onVodPlaying}
                        onTimeUpdate={onVodPlaying}
                      />
                    ) : null}
                  </>
                )}

                {(vodStatus === "loading" || (contentType === "live" && !currentLiveUrl && !isContentOffline)) && (
                  <div className="flex flex-col items-center gap-3 z-10">
                    <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                    <div className="text-white/50 text-sm font-medium">Carregando...</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
