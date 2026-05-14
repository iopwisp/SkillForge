# syntax=docker/dockerfile:1.7
#
# Multi-stage build: native modules (isolated-vm, better-sqlite3) compile
# in the build stage which has python+make+g++. The runtime stage is the
# slim node:22-alpine plus the prebuilt node_modules.
#
# Pinned to Node 22 because:
#   - isolated-vm@6.x requires node>=22 (uses v8::SourceLocation API)
#   - thread-stream@4.x requires node>=20
#   - eslint@10.x requires node>=20.19
# Earlier images (node:18 / node:20) caused EBADENGINE on `npm ci` and
# the well-known `v8::SourceLocation does not name a type` C++ error.

# ─── Build stage ────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Build deps for native modules
RUN apk add --no-cache python3 make g++ linux-headers

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . ./

# ─── Runtime stage ──────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# We do NOT install the build toolchain in the runtime image. Native modules
# bring their compiled .node binaries from the build stage.
RUN apk add --no-cache docker-cli

COPY --from=build /app /app

ENV NODE_ENV=production
EXPOSE 10000

CMD ["sh", "-c", "PORT=${PORT:-10000} npm start"]
