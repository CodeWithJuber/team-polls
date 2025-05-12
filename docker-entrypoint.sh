#!/bin/sh
set -e

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL..."
until PGPASSWORD=postgres psql -h postgres -U postgres -c '\q'; do
  >&2 echo "PostgreSQL is unavailable - sleeping"
  sleep 1
done

echo "PostgreSQL is up - running migrations"

# Run migrations
node_modules/.bin/knex --knexfile=knexfile.js migrate:latest

# Start the application
echo "Starting application"
node dist/server.js