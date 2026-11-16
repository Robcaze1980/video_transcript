FROM node:24.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY server ./server
COPY deploy/google-cloud/files-bundle.mjs ./deploy/google-cloud/files-bundle.mjs
RUN node deploy/google-cloud/files-bundle.mjs
FROM node:24.13.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/cloud-dist ./cloud-dist
USER node
ENV NODE_ENV=production
CMD ["node","--no-network-family-autoselection","cloud-dist/filesEntry.js"]
