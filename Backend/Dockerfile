# syntax=docker/dockerfile:1.7
FROM node:20-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server ./

ENV NODE_ENV=production
EXPOSE 10000

CMD ["sh", "-c", "PORT=${PORT:-10000} npm start"]
