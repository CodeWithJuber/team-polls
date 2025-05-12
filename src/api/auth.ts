// src/api/auth.ts
import { Router } from 'express';
import { generateAnonymousToken } from '../auth/jwt';

const router = Router();

router.post('/anon', async (req, res) => {
  try {
    const { token, userId, username } = await generateAnonymousToken();
    res.json({ token, userId, username });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

export const authRouter = router;