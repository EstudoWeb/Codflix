/**
 * Configuração de Proxies para Streaming
 * 
 * Se você tem um Cloudflare Worker próprio, adicione a URL aqui:
 * https://seu-worker.seu-usuario.workers.dev
 */

export const CONFIG = {
  // Seu Cloudflare Worker (se tiver) - deixe vazio para usar fallbacks
  CLOUDFLARE_WORKER: '', // Exemplo: 'https://my-proxy.seu-usuario.workers.dev'
  
  // Proxies públicos como fallback
  FALLBACK_PROXIES: [
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://corsproxy.org/?',
    'https://cors.sh/?url=',
  ]
};

/**
 * Função para gerar URL proxiada
 */
export function getProxiedUrl(originalUrl: string, proxyUrl?: string): string {
  const proxy = proxyUrl || CONFIG.CLOUDFLARE_WORKER || CONFIG.FALLBACK_PROXIES[0];
  
  // Se é o CodeTabs, usa o padrão dele
  if (proxy.includes('codetabs')) {
    return proxy + encodeURIComponent(originalUrl);
  }
  
  // Se é o corsproxy.org
  if (proxy.includes('corsproxy.org')) {
    return proxy + encodeURIComponent(originalUrl);
  }
  
  // Se é o cors.sh
  if (proxy.includes('cors.sh')) {
    return proxy + encodeURIComponent(originalUrl);
  }
  
  // Se é um Cloudflare Worker customizado
  if (proxy.includes('workers.dev')) {
    return proxy + '?url=' + encodeURIComponent(originalUrl);
  }
  
  return originalUrl;
}
