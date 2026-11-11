import { once } from 'node:events';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { renderLaunchPreview } from './render';

export async function startLaunchPreview(port = 0) {
  let files: ReturnType<typeof renderLaunchPreview>;
  const server = createServer((request, response) => {
    response.setHeader('X-Robots-Tag', 'noindex');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let route: string;
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      route = decodeURIComponent(pathname).slice(1);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const key = route.endsWith('/') ? route + 'index.html' : route;
    const body = files.get(key);
    if (body === undefined || (route !== 'sitemap.xml' && !route.endsWith('/'))) {
      response.writeHead(404).end();
      return;
    }
    const contentType = key === 'sitemap.xml' ? 'application/xml' : 'text/html';
    response.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('Could not open the local preview.');
  const origin = 'http://127.0.0.1:' + address.port;
  files = renderLaunchPreview(origin);
  return { server, origin };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void startLaunchPreview().then(({ origin }) => console.log(origin + '/sitemap.xml'));
}
