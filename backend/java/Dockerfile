FROM maven:3.9-eclipse-temurin-8 AS build
WORKDIR /build
COPY pom.xml ./
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp -DskipTests package

FROM eclipse-temurin:8-jdk
WORKDIR /app
RUN mkdir -p /app/nebu-data && chown -R 10001:10001 /app
COPY --from=build /build/target/nebuwork-backend-api.jar /app/app.jar
USER 10001:10001
EXPOSE 42020
ENTRYPOINT ["java", "-Dfile.encoding=UTF-8", "-jar", "/app/app.jar"]
