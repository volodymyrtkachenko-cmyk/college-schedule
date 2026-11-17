FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM dependencies AS development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM dependencies AS builder
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_DEFAULT_GROUP_ID=85
ARG NEXT_PUBLIC_DEFAULT_GROUP_NAME=85
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_DEFAULT_GROUP_ID=$NEXT_PUBLIC_DEFAULT_GROUP_ID
ENV NEXT_PUBLIC_DEFAULT_GROUP_NAME=$NEXT_PUBLIC_DEFAULT_GROUP_NAME
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
