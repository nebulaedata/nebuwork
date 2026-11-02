FROM neo4j:5.26.13
USER root
RUN cp /var/lib/neo4j/labs/apoc-5.26.13-core.jar /var/lib/neo4j/plugins/ && chown neo4j:neo4j /var/lib/neo4j/plugins/apoc-5.26.13-core.jar
USER neo4j
