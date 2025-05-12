// src/middleware/rateLimiter.ts
import { redisClient } from '../services/redis';
import { RateLimiterRedis } from 'rate-limiter-flexible';

const rateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'ratelimit',
  points: 5, // 5 requests
  duration: 1, // per 1 second
  blockDuration: 2, // Block for 2 seconds if exceeded
});

export async function voteRateLimiter(req, res, next) {
  try {
    const userId = req.user.sub;
    await rateLimiter.consume(`vote:${userId}`);
    next();
  } catch (error) {
    res.status(429).json({ error: 'Too many vote requests, please try again later' });
  }
}