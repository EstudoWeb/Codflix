/**
 * URL Resolver - Segue redirects até encontrar a URL final do vídeo
 * Usa múltiplos proxies para resolver URLs e contornar CORS
 */

const PROXY_LIST = [
  // Proxies que permitem seguir redirects
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

/**
 * Tenta resolver a URL final seguindo redirects
 * Retorna a URL que realmente funciona para reprodução
 */
export async function resolveVideoUrl(originalUrl: string): Promise<string> {
  console.log("[URLResolver] Tentando resolver URL:", originalUrl);
  
  // Primeiro, tenta fazer um HEAD request direto para ver se há redirect
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(originalUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    // Se chegou aqui, a URL é acessível diretamente
    // response.url contém a URL final após todos os redirects
    if (response.ok || response.status === 200 || response.status === 206) {
      console.log("[URLResolver] URL direta resolvida:", response.url);
      return response.url;
    }
  } catch (e) {
    console.log("[URLResolver] HEAD request direto falhou, tentando proxies...");
  }
  
  // Se falhou, tenta através de proxies
  for (let i = 0; i < PROXY_LIST.length; i++) {
    const proxyFn = PROXY_LIST[i];
    const proxiedUrl = proxyFn(originalUrl);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(proxiedUrl, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        // Se o proxy funcionou, retorna a URL proxiada para o player usar
        console.log(`[URLResolver] Proxy ${i + 1} funcionou:`, proxiedUrl);
        return proxiedUrl;
      }
    } catch (e) {
      console.log(`[URLResolver] Proxy ${i + 1} falhou`);
    }
  }
  
  // Se nenhum proxy funcionou, retorna a URL original e deixa o player tentar
  console.log("[URLResolver] Nenhum resolver funcionou, usando URL original");
  return originalUrl;
}

/**
 * Gera uma lista de URLs candidatas para tentar
 * Cada uma com diferentes proxies e formatos
 */
export function generateCandidateUrls(baseUrl: string, username: string, password: string, streamId: string, type: 'movie' | 'series', extension?: string): string[] {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const ext = extension && extension !== 'undefined' ? extension : 'mp4';
  const endpoint = type === 'movie' ? 'movie' : 'series';
  
  const directUrl = `${cleanBase}/${endpoint}/${username}/${password}/${streamId}.${ext}`;
  
  const candidates: string[] = [
    // 1. Link direto
    directUrl,
    
    // 2. Com proxies diferentes
    `https://corsproxy.io/?${encodeURIComponent(directUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(directUrl)}`,
    
    // 3. Sem extensão (alguns servidores aceitam)
    `${cleanBase}/${endpoint}/${username}/${password}/${streamId}`,
    
    // 4. Sem extensão com proxy
    `https://corsproxy.io/?${encodeURIComponent(`${cleanBase}/${endpoint}/${username}/${password}/${streamId}`)}`,
  ];
  
  return candidates;
}
