# syntax=docker/dockerfile:1

# Pinned to the same major the project is developed on, so "works locally,
# breaks in the container" cannot come from a runtime version drift.
ARG NODE_VERSION=24-alpine

# ---------------------------------------------------------------------------
# deps — the full dependency tree, shared by the dev and build stages.
# Split out so a source-only change does not re-run npm ci.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# dev — hot-reload target, used by `docker compose --profile app up`.
# Runs as root deliberately: compose bind-mounts the host working tree over
# /app, and matching host UIDs across macOS and Linux is more trouble than it
# is worth for a throwaway local container. The prod stage below runs as the
# unprivileged `node` user, which is the one that matters.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS dev
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000 9229
CMD ["npm", "run", "start:dev"]

# ---------------------------------------------------------------------------
# build — compile TypeScript, then drop dev dependencies in place so the prod
# stage can copy a already-pruned node_modules rather than reinstalling.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------------------------------------------------------------------------
# prod — dist plus production dependencies only. No source, no toolchain.
# tsc-alias rewrites the @-aliases at build time, so there is no need for
# tsconfig-paths at runtime.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
