// src/services/redis.ts
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

export const redisClient = new Redis(REDIS_URL);

export async function connectRedis() {
  try {
    await redisClient.ping();
    console.log('Redis connected');
    return redisClient;
  } catch (error) {
    console.error('Redis connection error:', error);
    throw error;
  }
}