// /api/proxy.ts
// Este código é para um ambiente Node.js, como as funções da Vercel.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Pega a URL do vídeo da query string. Ex: /api/proxy?url=https://...
  const videoUrl = req.query.url;

  if (typeof videoUrl !== 'string' || !videoUrl ) {
    return res.status(400).send('A URL do vídeo é obrigatória.');
  }

  try {
    // Faz a requisição para a URL do vídeo
    const videoResponse = await fetch(videoUrl, {
      headers: {
        // Importante: Repassa o cabeçalho 'Range' para suportar seeking (avançar/retroceder) no vídeo
        'Range': req.headers.range || 'bytes=0-',
      },
    });

    // Se a requisição ao servidor de vídeo falhar
    if (!videoResponse.ok) {
      return res.status(videoResponse.status).send(videoResponse.statusText);
    }

    // Pega os cabeçalhos da resposta original e os repassa para o seu player
    const headers = {
      'Content-Type': videoResponse.headers.get('Content-Type') || 'video/mp4',
      'Content-Length': videoResponse.headers.get('Content-Length') || '',
      'Accept-Ranges': 'bytes', // Indica que aceitamos requisições parciais
      'Content-Range': videoResponse.headers.get('Content-Range') || '',
    };

    // Envia os cabeçalhos de volta para o player
    res.writeHead(videoResponse.status, headers);

    // Usa pipe para transmitir o corpo da resposta (o vídeo) diretamente para o player
    // Isso é MUITO eficiente e não sobrecarrega a memória do servidor.
    if (videoResponse.body) {
      const reader = videoResponse.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        res.write(value);
      }
    }
    res.end();

  } catch (error) {
    console.error('Erro no proxy:', error);
    res.status(500).send('Erro interno ao buscar o vídeo.');
  }
}
