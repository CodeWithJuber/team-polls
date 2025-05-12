const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL || 'postgres://postgres:postgres@postgres:5432/team_polls'
});
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

// JWT auth middleware
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Anonymous auth endpoint
app.post('/api/auth/anon', async (req, res) => {
  try {
    const userId = uuidv4();
    const username = `anon-${userId.slice(0, 8)}`;
    
    await knex('users').insert({ id: userId, username });
    
    const token = jwt.sign({ sub: userId, username }, JWT_SECRET, { expiresIn: '2h' });
    res.json({ token, userId, username });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Create poll
app.post('/api/poll', async (req, res) => {
  try {
    const { question, options, expiresAt } = req.body;
    
    const [poll] = await knex('polls').insert({
      question,
      options: JSON.stringify(options),
      expires_at: expiresAt
    }).returning('*');
    
    res.status(201).json(poll);
  } catch (error) {
    console.error('Create poll error:', error);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// Get poll
app.get('/api/poll/:id', async (req, res) => {
  try {
    const pollId = req.params.id;
    const poll = await knex('polls').where({ id: pollId }).first();
    
    if (!poll) {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    const voteCounts = await knex('votes')
      .where({ poll_id: pollId })
      .select('option_index')
      .count('* as count')
      .groupBy('option_index');
    
    const options = JSON.parse(poll.options);
    const results = options.map((option, index) => {
      const voteData = voteCounts.find(v => v.option_index === index);
      return {
        option,
        count: voteData ? parseInt(voteData.count) : 0
      };
    });
    
    res.json({
      ...poll,
      options: options,
      results
    });
  } catch (error) {
    console.error('Get poll error:', error);
    res.status(500).json({ error: 'Failed to get poll' });
  }
});

// Cast vote
app.post('/api/poll/:id/vote', authMiddleware, async (req, res) => {
  try {
    const pollId = req.params.id;
    const userId = req.user.sub;
    const { optionIndex } = req.body;
    
    const poll = await knex('polls').where({ id: pollId }).first();
    
    if (!poll) {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    if (new Date(poll.expires_at) < new Date() || !poll.is_active) {
      return res.status(403).json({ error: 'Poll has expired' });
    }
    
    const options = JSON.parse(poll.options);
    if (optionIndex < 0 || optionIndex >= options.length) {
      return res.status(400).json({ error: 'Invalid option index' });
    }
    
    // Try to insert first, if it fails with conflict, update
    try {
      await knex('votes').insert({
        id: uuidv4(),
        poll_id: pollId,
        user_id: userId,
        option_index: optionIndex
      });
    } catch (err) {
      // If insert fails due to unique constraint, update instead
      await knex('votes')
        .where({ poll_id: pollId, user_id: userId })
        .update({ option_index: optionIndex });
    }
    
    const voteCounts = await knex('votes')
      .where({ poll_id: pollId })
      .select('option_index')
      .count('* as count')
      .groupBy('option_index');
    
    const results = options.map((option, index) => {
      const voteData = voteCounts.find(v => v.option_index === index);
      return {
        option,
        count: voteData ? parseInt(voteData.count) : 0
      };
    });
    
    io.to(`poll:${pollId}`).emit('vote_update', {
      pollId,
      results
    });
    
    redis.publish('poll_updates', JSON.stringify({
      pollId,
      results
    }));
    
    res.json({ success: true, results });
  } catch (error) {
    console.error('Vote error:', error);
    res.status(500).json({ error: 'Failed to cast vote' });
  }
});

// Socket.io setup
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  
  try {
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user;
    next();
  } catch (error) {
    return next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.user.sub}`);
  
  socket.on('join_poll', (pollId) => {
    socket.join(`poll:${pollId}`);
    console.log(`User ${socket.user.sub} joined poll ${pollId}`);
  });
  
  socket.on('leave_poll', (pollId) => {
    socket.leave(`poll:${pollId}`);
    console.log(`User ${socket.user.sub} left poll ${pollId}`);
  });
  
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.user.sub}`);
  });
});

// Redis subscriber for horizontal scaling
const redisSubscriber = redis.duplicate();
redisSubscriber.subscribe('poll_updates');

redisSubscriber.on('message', (channel, message) => {
  if (channel === 'poll_updates') {
    const update = JSON.parse(message);
    if (update.event === 'poll_closed') {
      io.to(`poll:${update.pollId}`).emit('poll_closed', { pollId: update.pollId });
    } else {
      io.to(`poll:${update.pollId}`).emit('vote_update', update);
    }
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});