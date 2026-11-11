import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { pilotLanguages } from '../pilot-site/languages';
import { renderCommercialPreview, renderPilotSite } from '../pilot-site/render';
import { pilotLocale } from './web/pilotLocales.js';

const cookieName = 'linguistvision_preview_entry';
const lifetimeSeconds = 8 * 60 * 60;

export interface PreviewAttribution {
  locale: string;
  source: 'chatgpt' | 'unattributed';
}

interface PreviewSession extends PreviewAttribution {
  sessionId: string;
  expires: number;
}

export function createPreviewAttribution(origin: string, commercial = false) {
  const key = randomBytes(32);
  const entryLabels = new Map(pilotLanguages.map(pack => [pack.locale, pilotLocale(pack.id).text('enter')]));
  const files = commercial ? renderCommercialPreview(origin) : renderPilotSite(origin, pilotLanguages, 'en-US', entryLabels);
  const pages = new Map(pilotLanguages.map(pack => {
    const route = '/' + pack.locale.toLowerCase() + '/' + pack.slug + '/';
    return [new URL(route, origin).pathname, { locale: pack.locale, html: files.get(route.slice(1) + 'index.html')! }];
  }));
  const sign = (value: string) => createHmac('sha256', key).update(value).digest();

  return {
    pages,
    sitemap: files.get('sitemap.xml')!,
    read(header: string | undefined): PreviewSession | undefined {
      const cookie = header?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='));
      const [value, signature] = cookie?.slice(cookieName.length + 1).split('.') ?? [];
      if (!value || !signature || !/^[a-f0-9]{64}$/.test(signature) ||
          !timingSafeEqual(sign(value), Buffer.from(signature, 'hex'))) return;
      const session: PreviewSession = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
      if (session.expires > Date.now()) return session;
    },
    issue(locale: string, url: URL, referer: string | undefined) {
      const fromChatGPT = url.searchParams.get('utm_source') === 'chatgpt.com' ||
        Boolean(referer && URL.canParse(referer) && new URL(referer).origin === 'https://chatgpt.com');
      const session: PreviewSession = {
        sessionId: randomUUID(),
        locale, source: fromChatGPT ? 'chatgpt' : 'unattributed', expires: Date.now() + lifetimeSeconds * 1000,
      };
      const value = Buffer.from(JSON.stringify(session)).toString('base64url');
      const cookie = cookieName + '=' + value + '.' + sign(value).toString('hex') +
        '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + lifetimeSeconds;
      return { session, cookie };
    },
  };
}
