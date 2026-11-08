FROM eclipse-temurin:17-jre

WORKDIR /app
COPY library-system-1.0.0.jar app.jar

ENV LIB_DB_HOST=mysql \
    LIB_DB_PORT=3306 \
    LIB_DB_NAME=library_db \
    LIB_DB_USER=root \
    LIB_DB_PASS=library123 \
    LIB_PORT=8090

EXPOSE 8090
ENTRYPOINT ["java", "-jar", "app.jar"]
