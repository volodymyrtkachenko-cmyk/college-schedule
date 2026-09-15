FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package.json ./
RUN npm install

FROM dependencies AS development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM dependencies AS builder
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_DEFAULT_GROUP_ID=85
ARG NEXT_PUBLIC_DEFAULT_GROUP_NAME=85
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_DEFAULT_GROUP_ID=$NEXT_PUBLIC_DEFAULT_GROUP_ID
ENV NEXT_PUBLIC_DEFAULT_GROUP_NAME=$NEXT_PUBLIC_DEFAULT_GROUP_NAME
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
