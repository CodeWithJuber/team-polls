FROM node:18-alpine

WORKDIR /app

# Install PostgreSQL client
RUN apk add --no-cache postgresql-client

# Copy package files first
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Make start script executable
RUN chmod +x /app/start.sh

# Set the entry point to the script
ENTRYPOINT ["/app/start.sh"]