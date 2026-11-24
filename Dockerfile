FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node app.js index.html *.css instaauto-mark.svg server.js worker.js ./
COPY --chown=node:node src src
COPY --chown=node:node db db
COPY --chown=node:node scripts scripts
RUN install -d -o node -g node -m 0700 /app/media
USER node
CMD ["node","server.js"]
