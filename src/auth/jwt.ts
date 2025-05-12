// src/auth/jwt.ts
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { redisClient } from '../services/redis';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const TOKEN_EXPIRY = '2h'; // Short-lived tokens

export async function generateAnonymousToken() {
  // Create anonymous user
  const userId = uuidv4();
  const username = `anon-${userId.slice(0, 8)}`;
  
  // Store in database (simplified for now)
  // In production, use proper user repository
  
  const token = jwt.sign({
    sub: userId,
    username
  }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  
  return { token, userId, username };
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Auth middleware
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  req.user = payload;
  next();
}