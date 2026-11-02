FROM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml ./
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -DskipTests package

FROM eclipse-temurin:17-jre-jammy@sha256:b3054a20e1a851574cdb1692dd0db5310c647e62214a2a7abecbec1b9e3ae8f1
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    sed -i 's|http://archive.ubuntu.com|https://archive.ubuntu.com|g;s|http://security.ubuntu.com|https://security.ubuntu.com|g' /etc/apt/sources.list && \
    apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 update && DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 install -y --no-install-recommends libreoffice-writer libreoffice-impress fonts-noto-cjk fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea iptables util-linux && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/target/nebuwork-preview-worker-1.0.0.jar /opt/preview/worker.jar
COPY entrypoint.sh /opt/preview/entrypoint.sh
RUN chmod 755 /opt/preview/entrypoint.sh
ENV PREVIEW_TEMP_DIR=/work PREVIEW_CONVERTER_ISOLATED=true
ENTRYPOINT ["/opt/preview/entrypoint.sh"]
