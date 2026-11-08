FROM eclipse-temurin:17-jre
WORKDIR /app
COPY . /app
ENV HOTEL_DB_HOST=db HOTEL_DB_PORT=3306 HOTEL_DB_NAME=hotel_db HOTEL_DB_USER=root HOTEL_DB_PASS=root
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/hotel-system-1.0.0.jar"]
