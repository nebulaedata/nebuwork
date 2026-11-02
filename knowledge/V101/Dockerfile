FROM node:22-bookworm-slim AS frontend
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 go build -trimpath -o /out/nebulaekno ./cmd/nebulaekno

FROM maven:3.9.11-eclipse-temurin-17 AS ofd-renderer
WORKDIR /build
COPY reader/ofd-renderer/pom.xml ./
COPY reader/ofd-renderer/src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -q -DskipTests package

FROM python:3.11-slim-bookworm AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw fonts-noto-cjk ffmpeg tesseract-ocr tesseract-ocr-chi-sim ca-certificates && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jre-headless && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY reader/requirements.txt /app/reader/requirements.txt
RUN pip install --no-cache-dir -r /app/reader/requirements.txt
RUN groupadd -g 10001 nebulaekno && useradd -u 10001 -g nebulaekno -m nebulaekno && mkdir -p /data && chown nebulaekno:nebulaekno /data
COPY --from=build /out/nebulaekno /app/nebulaekno
COPY --from=ofd-renderer /build/target/ofd-renderer-1.0.0.jar /app/ofd-renderer/
COPY --from=ofd-renderer /build/target/lib /app/ofd-renderer/lib
COPY reader /app/reader
COPY internal/defaults/parser_catalog.json /app/reader/parser_catalog.json
COPY --from=frontend /web/dist /app/web
ENV PYTHONUNBUFFERED=1 NEBULAEKNO_DATA_DIR=/data NEBULAEKNO_HOST=0.0.0.0 NEBULAEKNO_PORT=8080
USER nebulaekno
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=5s --start-period=660s --retries=3 CMD ["/app/nebulaekno","healthcheck"]
ENTRYPOINT ["/usr/bin/tini","--","/app/nebulaekno"]
