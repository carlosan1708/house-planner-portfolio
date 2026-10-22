FROM node:22-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN ./node_modules/.bin/esbuild scripts/migrate-v0.1.mjs --bundle --platform=node --format=cjs --outfile=scripts/migrate-v0.1.bundle.cjs --external:firebase-admin/app --external:firebase-admin/firestore --external:firebase-admin/storage

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/scripts/migrate-v0.1.bundle.cjs ./scripts/migrate-v0.1.bundle.cjs
EXPOSE 8080
CMD ["node", "server.js"]
