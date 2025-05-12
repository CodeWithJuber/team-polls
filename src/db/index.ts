// src/db/index.ts
import knex from 'knex';
import path from 'path';

// Get the environment
const environment = process.env.NODE_ENV || 'development';

// Import the knexfile
const knexConfig = require(path.join(process.cwd(), 'knexfile'));
const config = knexConfig[environment];

if (!config) {
  throw new Error(`No configuration found for environment: ${environment}`);
}

if (!config.client) {
  throw new Error('Missing required knex client configuration');
}

// Create the knex instance
export const db = knex(config);

export async function connectDatabase() {
  try {
    await db.raw('SELECT 1');
    console.log(`Database connected successfully in ${environment} mode`);
    return db;
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
}