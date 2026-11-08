FROM maven:3.9-eclipse-temurin-8 AS build
WORKDIR /src
COPY . .
RUN mvn -B -DskipTests package

FROM tomcat:9-jdk8-temurin
RUN rm -rf /usr/local/tomcat/webapps/*
COPY --from=build /src/target/*.war /usr/local/tomcat/webapps/ROOT.war
EXPOSE 8080
CMD ["catalina.sh", "run"]
