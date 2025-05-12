// src/api/index.ts
import { Router } from 'express';
import { authRouter } from './auth';
import { pollRouter } from './polls';

const router = Router();

router.use('/auth', authRouter);
router.use('/poll', pollRouter);

export function setupRoutes(app) {
  app.use('/api', router);
  
  // Error handler
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });
}