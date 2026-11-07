<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# LinguistVision

Transcribe, translate and burn subtitles into videos from the browser.

## Architecture

- `npm run dev` starts an Express-like Node HTTP server with Vite middleware.
- The browser uploads the video once to `/api/video`; the Node server uses the
  Gemini Files API and never sends `GEMINI_API_KEY` to the browser.
- Videos are transcribed in validated 45-second sections with a small overlap.
  Failed sections are retried independently and are never converted into fake
  subtitles.
- AI Studio deployments without the Node server can still use the direct Files
  API fallback and the key selected in AI Studio.

## Run locally

**Prerequisites:** Node.js 20+

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY=...`
3. Run `npm run dev` and open `http://localhost:3000`

The default model is `gemini-3.8-flash`. You can override it with
`GEMINI_MODEL` in `.env.local`. If you change any environment variable,
restart `npm run dev`; Node does not reload `.env.local` automatically.

The legacy `npm run dev:vite` command only serves the frontend and is intended
for static AI Studio development. Use `npm run dev` for the secure local proxy.

## Validation

```bash
npm run lint
npm test
npm run build
```

`npm run build` creates `dist/`; `npm start` serves that build with the API proxy.

## Production security

The Node server does not provide user authentication. Do not expose port 3000
publicly without adding authentication, per-user rate limits and HTTPS. Files
uploaded to Gemini are retained according to the Gemini Files API expiration.
The app deletes them when a new video replaces the current one or the page is
closed, when the browser permits the cleanup request.
