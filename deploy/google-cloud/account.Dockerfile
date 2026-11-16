FROM node:24.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY server/account ./server/account
COPY deploy/google-cloud/account-bundle.mjs ./deploy/google-cloud/account-bundle.mjs
RUN node deploy/google-cloud/account-bundle.mjs
FROM node:24.13.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/account-dist ./account-dist
USER node
ENV NODE_ENV=production
CMD ["node","--no-network-family-autoselection","account-dist/entry.js"]
