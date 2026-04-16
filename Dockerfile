FROM node:lts-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:lts-alpine

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./
COPY --from=build /app/package-lock.json ./

RUN npm ci --omit=dev

EXPOSE 3099

CMD ["node", "server/agent.js"]
