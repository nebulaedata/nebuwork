FROM node:22.19.0-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
RUN npm ci --ignore-scripts
COPY apps/web ./apps/web
ENV VITE_API_PREFIX=/nebulaedev VITE_API_BASE_URL=/nebulaedev/nwaa
RUN npm run build --workspace apps/web
FROM nginx:1.29.2
COPY --from=build /app/apps/web/dist/client /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
