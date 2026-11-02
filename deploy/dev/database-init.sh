#!/bin/sh
set -eu
mysql -hmysql -uroot < /init/databases.sql
# Keep the vendored schema intact, while allowing interrupted first initialization to resume.
sed 's/^CREATE TABLE /CREATE TABLE IF NOT EXISTS /' /init/nacos.sql | mysql -hmysql -uroot nacos_dev
echo 'Nacos 2.4.2 schema is ready; existing tables and rows are preserved.'
