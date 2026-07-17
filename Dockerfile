# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ARG NEXT_PUBLIC_OPENBUCKET_API_URL=http://127.0.0.1:7272
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_DOCS_URL=https://openbucket.dev/docs
ENV NEXT_PUBLIC_OPENBUCKET_API_URL=${NEXT_PUBLIC_OPENBUCKET_API_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_DOCS_URL=${NEXT_PUBLIC_DOCS_URL}
COPY . .
RUN npm run build

# Headless daemon/CLI image. The Compose dashboard runs separately because the
# embedded dashboard intentionally binds only loopback addresses.
FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS daemon
WORKDIR /app
ENV NODE_ENV=production
ENV OPENBUCKET_STORAGE_ROOT=/data
ENV OPENBUCKET_HOME=/state
ENV OPENBUCKET_HOST=0.0.0.0
ENV OPENBUCKET_MANAGEMENT_PORT=7272
ENV OPENBUCKET_S3_PORT=8333
ENV OPENBUCKET_DASHBOARD_URL=http://localhost:3000
ENV OPENBUCKET_SERVE_DASHBOARD=false
ENV OPENBUCKET_OPEN_DASHBOARD=false
ENV OPENBUCKET_SHOW_INITIAL_CREDENTIALS=false
ENV OPENBUCKET_TUNNEL=false
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/LICENSE ./LICENSE
RUN mkdir -p /data /state && chown -R node:node /data /state
USER node
VOLUME ["/data", "/state"]
EXPOSE 7272 8333
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD ["node", "-e", "const p=process.env.OPENBUCKET_MANAGEMENT_PORT||'7272';fetch('http://127.0.0.1:'+p+'/healthz').then(r=>{if(!r.ok)throw Error(String(r.status))}).catch(()=>process.exit(1))"]
ENTRYPOINT ["node", "dist/cli/main.js"]
CMD ["serve", "/data", "--no-open"]

# Production dashboard image. The compiled Node adapter serves the bundled
# worker and static assets without retaining the build toolchain.
FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS dashboard
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/').then(r=>{if(!r.ok)throw Error(String(r.status))}).catch(()=>process.exit(1))"]
CMD ["node", "dist/dashboard/main.js"]

# `docker build .` produces the daemon by default. Compose selects both targets.
FROM daemon AS production
