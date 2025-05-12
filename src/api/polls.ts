// src/api/polls.ts
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/jwt';
import { voteRateLimiter } from '../middleware/rateLimiter';
import { createPoll, getPoll, castVote } from '../services/pollService';

const router = Router();

// Validation schemas
const pollSchema = z.object({
  question: z.string().min(5).max(200),
  options: z.array(z.string().min(1).max(100)).min(2).max(10),
  expiresAt: z.string().datetime()
});

const voteSchema = z.object({
  optionIndex: z.number().int().min(0)
});

// Create poll endpoint
router.post('/', async (req, res) => {
  try {
    const { question, options, expiresAt } = pollSchema.parse(req.body);
    
    // Ensure expiresAt is in the future
    if (new Date(expiresAt) <= new Date()) {
      return res.status(400).json({ error: 'Expiration time must be in the future' });
    }
    
    const poll = await createPoll(question, options, expiresAt);
    res.status(201).json(poll);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Create poll error:', error);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// Get poll endpoint
router.get('/:id', async (req, res) => {
  try {
    const pollId = req.params.id;
    const poll = await getPoll(pollId);
    
    if (!poll) {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    res.json(poll);
  } catch (error) {
    console.error('Get poll error:', error);
    res.status(500).json({ error: 'Failed to get poll' });
  }
});

// Cast vote endpoint
router.post('/:id/vote', authMiddleware, voteRateLimiter, async (req, res) => {
  try {
    const pollId = req.params.id;
    const userId = req.user.sub;
    const { optionIndex } = voteSchema.parse(req.body);
    
    const results = await castVote(pollId, userId, optionIndex);
    res.json({ success: true, results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    
    if (error.message === 'Poll not found') {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    if (error.message === 'Poll has expired') {
      return res.status(403).json({ error: 'Poll has expired' });
    }
    
    console.error('Vote error:', error);
    res.status(500).json({ error: 'Failed to cast vote' });
  }
});

export const pollRouter = router;