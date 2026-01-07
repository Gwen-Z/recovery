FROM node:20-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 needs native build toolchain at install time
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ \
    libsqlite3-dev \
  && rm -rf /var/lib/apt/lists/*

COPY recovery/CLOUD_VERSION/backend/package.json ./
RUN npm install --omit=dev

COPY recovery/CLOUD_VERSION/backend/src ./src

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libsqlite3-0 \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src

EXPOSE 8080
CMD ["node", "src/server.js"]
