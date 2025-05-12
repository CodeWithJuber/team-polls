// knexfile.ts (at project root)
import dotenv from 'dotenv';
import { Knex } from 'knex';
import path from 'path';

dotenv.config();

const config: Record<string, Knex.Config> = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL || {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'team_polls',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres'
    },
    migrations: {
      directory: path.join(__dirname, 'src/db/migrations'),
      extension: 'ts'
    },
    seeds: {
      directory: path.join(__dirname, 'src/db/seeds'),
      extension: 'ts'
    },
    pool: {
      min: 2,
      max: 10
    }
  },
  
  test: {
    client: 'pg',
    connection: process.env.TEST_DATABASE_URL || {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.TEST_DB_NAME || 'team_polls_test',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres'
    },
    migrations: {
      directory: path.join(__dirname, 'src/db/migrations'),
      extension: 'ts'
    },
    seeds: {
      directory: path.join(__dirname, 'src/db/seeds'),
      extension: 'ts'
    },
    pool: {
      min: 2,
      max: 10
    }
  },
  
  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: path.join(__dirname, 'dist/db/migrations')
    },
    seeds: {
      directory: path.join(__dirname, 'dist/db/seeds')
    },
    pool: {
      min: 2,
      max: 20
    }
  }
};

// For when imported via require
module.exports = config;
// For when imported via import
export default config;