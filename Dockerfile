ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/app/data
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm install --global pnpm@11.19.0 --registry=${NPM_REGISTRY} \
    && pnpm install --prod --frozen-lockfile --ignore-scripts --registry=${NPM_REGISTRY} \
    && pnpm store prune

COPY --chown=node:node server ./server
COPY --chown=node:node web ./web
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
