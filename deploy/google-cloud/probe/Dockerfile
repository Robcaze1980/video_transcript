FROM node:24.13.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /probe
COPY smoke.mjs /probe/smoke.mjs
USER node
CMD ["node", "/probe/smoke.mjs"]
