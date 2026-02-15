FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/telegram-mcp.config.example.json ./telegram-mcp.config.example.json
COPY --from=builder /app/docker ./docker
EXPOSE 3000
CMD ["node", "dist/index.cjs", "serve", "--transport=http", "--port=3000"]
