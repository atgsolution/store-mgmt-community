FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_API_ENABLED=true
ENV VITE_API_ENABLED=${VITE_API_ENABLED}

RUN npm run build

FROM nginx:1.30-alpine AS frontend

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]

FROM node:22-alpine AS api

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server ./server
COPY --chown=node:node db ./db
RUN mkdir -p /var/lib/store-mgmt/cold-archive && chown -R node:node /var/lib/store-mgmt /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz || exit 1

CMD ["node", "server/index.mjs"]
