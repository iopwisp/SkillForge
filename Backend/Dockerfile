# syntax=docker/dockerfile:1.7
#
# Multi-stage build: native modules (isolated-vm, better-sqlite3) compile
# in the build stage which has python+make+g++. The runtime stage is the
# slim node:18-alpine plus the prebuilt node_modules.
#
# Pinned to Node 18 because the current isolated-vm release is not
# compatible with Node 20's V8 ABI (build error:
# `v8::SourceLocation does not name a type`). Once a new isolated-vm
# release ships with Node 20 support we can move both stages to 20.

# ─── Build stage ────────────────────────────────────────────────────────
FROM node:18-alpine AS build

WORKDIR /app

# Build deps for native modules
RUN apk add --no-cache python3 make g++ linux-headers

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . ./

# ─── Runtime stage ──────────────────────────────────────────────────────
FROM node:18-alpine

WORKDIR /app

# We do NOT install the build toolchain in the runtime image. Native modules
# bring their compiled .node binaries from the build stage.
RUN apk add --no-cache docker-cli

COPY --from=build /app /app

ENV NODE_ENV=production
EXPOSE 10000

CMD ["sh", "-c", "PORT=${PORT:-10000} npm start"]
