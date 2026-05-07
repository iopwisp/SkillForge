# syntax=docker/dockerfile:1.7
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . ./

ENV NODE_ENV=production
EXPOSE 10000

CMD ["sh", "-c", "PORT=${PORT:-10000} npm start"]
