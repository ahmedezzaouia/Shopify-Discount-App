# Build stage: needs devDependencies for vite / react-router build
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force
COPY . .
RUN npx prisma generate
RUN npm run build

# Production stage: listen on Render's PORT at 0.0.0.0
FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 3000

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/build ./build
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts

CMD ["npm", "run", "docker-start"]
