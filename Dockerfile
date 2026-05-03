FROM node:lts-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

RUN echo '\
server {\
  listen 80;\
  server_name _;\
  root /usr/share/nginx/html;\
  index index.html;\
  location / {\
    try_files $uri $uri/ /index.html;\
  }\
}\
' > /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
