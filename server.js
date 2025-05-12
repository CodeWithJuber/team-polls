// server.js
const express = require('express');
const http = require('http');
const { Server: SocketServer } = require('socket.io');
const cors = require('cors');
const knex = require('knex');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const path = require('path');

// Database connection
const db = knex({
 client: 'pg',
 connection: process.env.DATABASE_URL || 'postgres://postgres:postgres@postgres:5432/team_polls'
});

// Redis connection
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');

// Express app setup
const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
 cors: { origin: '*' }
});

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
 res.send('OK');
});

// Helper to safely parse JSON options
function safeParseOptions(options) {
 if (typeof options === 'string') {
   try {
     return JSON.parse(options);
   } catch (e) {
     console.log('Error parsing options string:', e);
     // Return empty array as fallback
     return [];
   }
 }
 return Array.isArray(options) ? options : [];
}

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
   req.user = {
     sub: payload.sub,
     username: payload.username
   };
   next();
 } catch (error) {
   return res.status(401).json({ error: 'Invalid or expired token' });
 }
}

// Rate limiting middleware
const rateLimitMap = new Map();

function rateLimitMiddleware(req, res, next) {
 if (!req.user) return next();
 
 const userId = req.user.sub;
 const now = Date.now();
 const windowMs = 1000; // 1 second window
 const maxRequests = 5; // 5 requests per second
 
 const userRateLimit = rateLimitMap.get(userId) || { count: 0, resetTime: now + windowMs };
 
 // Reset if the time window has passed
 if (now > userRateLimit.resetTime) {
   userRateLimit.count = 0;
   userRateLimit.resetTime = now + windowMs;
 }
 
 userRateLimit.count++;
 rateLimitMap.set(userId, userRateLimit);
 
 if (userRateLimit.count > maxRequests) {
   return res.status(429).json({ 
     error: 'Rate limit exceeded', 
     retryAfter: Math.ceil((userRateLimit.resetTime - now) / 1000) 
   });
 }
 
 next();
}

// Helper function to close a poll
async function closePoll(pollId) {
 try {
   await db('polls')
     .where({ id: pollId })
     .update({ is_active: false });
   
   io.to(`poll:${pollId}`).emit('poll_closed', { pollId });
   
   redis.publish('poll_updates', JSON.stringify({
     pollId,
     event: 'poll_closed'
   }));
   
   console.log(`Poll ${pollId} closed at ${new Date().toISOString()}`);
 } catch (error) {
   console.error(`Error closing poll ${pollId}:`, error);
 }
}

// Get poll with full results
async function getPollWithResults(pollId) {
 const poll = await db('polls').where({ id: pollId }).first();
 
 if (!poll) {
   return null;
 }
 
 const voteCounts = await db('votes')
   .where({ poll_id: pollId })
   .select('option_index')
   .count('* as count')
   .groupBy('option_index');
 
 const options = safeParseOptions(poll.options);
 
 const results = options.map((option, index) => {
   const voteData = voteCounts.find(v => v.option_index === index);
   return {
     option,
     count: voteData ? parseInt(voteData.count) : 0
   };
 });
 
 const totalVotes = results.reduce((sum, result) => sum + result.count, 0);
 
 return {
   id: poll.id,
   question: poll.question,
   options: options,
   results: results,
   expires_at: poll.expires_at,
   created_at: poll.created_at,
   is_active: poll.is_active,
   total_votes: totalVotes
 };
}

// Anonymous auth endpoint
app.post('/api/auth/anon', async (req, res) => {
 try {
   const userId = uuidv4();
   const username = `anon-${userId.slice(0, 8)}`;
   
   await db('users').insert({ id: userId, username });
   
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
   
   if (!question || !options || !Array.isArray(options) || options.length < 2) {
     return res.status(400).json({ 
       error: 'Invalid poll data. Question and at least 2 options are required.' 
     });
   }
   
   const [poll] = await db('polls').insert({
     question,
     options: JSON.stringify(options),
     expires_at: expiresAt
   }).returning('*');
   
   // Process the poll with default values
   const pollWithOptions = {
     ...poll,
     options: safeParseOptions(poll.options),
     results: [], 
     total_votes: 0
   };
   
   // Schedule poll closing
   const expiryTime = new Date(poll.expires_at).getTime() - Date.now();
   if (expiryTime > 0) {
     setTimeout(async () => {
       await closePoll(poll.id);
     }, expiryTime);
   }
   
   res.status(201).json(pollWithOptions);
 } catch (error) {
   console.error('Create poll error:', error);
   res.status(500).json({ error: 'Failed to create poll' });
 }
});

// Get poll
app.get('/api/poll/:id', async (req, res) => {
 try {
   const pollId = req.params.id;
   const poll = await getPollWithResults(pollId);
   
   if (!poll) {
     return res.status(404).json({ error: 'Poll not found' });
   }
   
   res.json(poll);
 } catch (error) {
   console.error('Get poll error:', error);
   res.status(500).json({ error: 'Failed to get poll' });
 }
});

// Cast vote
app.post('/api/poll/:id/vote', authMiddleware, rateLimitMiddleware, async (req, res) => {
 try {
   const pollId = req.params.id;
   const userId = req.user.sub;
   const { optionIndex } = req.body;
   
   console.log(`Vote request: User ${userId} voting for option ${optionIndex} in poll ${pollId}`);
   
   if (!userId) {
     return res.status(401).json({ error: 'Authentication required' });
   }
   
   let updatedPoll = null;
   
   await db.transaction(async trx => {
     // Check if poll exists and is active
     const poll = await trx('polls').where({ id: pollId }).first();
     
     if (!poll) {
       throw new Error('Poll not found');
     }
     
     if (new Date(poll.expires_at) < new Date() || !poll.is_active) {
       throw new Error('Poll has expired');
     }
     
     // Parse the options safely
     const options = safeParseOptions(poll.options);
     
     if (optionIndex < 0 || optionIndex >= options.length) {
       throw new Error('Invalid option index');
     }
     
     // Check if the vote already exists
     const existingVote = await trx('votes')
       .where({
         poll_id: pollId,
         user_id: userId
       })
       .first();
     
     if (existingVote) {
       // Update existing vote
       await trx('votes')
         .where({
           poll_id: pollId,
           user_id: userId
         })
         .update({
           option_index: optionIndex
         });
       
       console.log(`Updated vote: User ${userId} changed vote to option ${optionIndex} in poll ${pollId}`);
     } else {
       // Insert new vote
       await trx('votes').insert({
         id: uuidv4(),
         poll_id: pollId,
         user_id: userId,
         option_index: optionIndex
       });
       
       console.log(`New vote: User ${userId} voted for option ${optionIndex} in poll ${pollId}`);
     }
     
     // Get updated vote counts within the transaction
     const voteCounts = await trx('votes')
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
     
     const totalVotes = results.reduce((sum, result) => sum + result.count, 0);
     
     updatedPoll = {
       id: poll.id,
       results,
       total_votes: totalVotes
     };
   });
   
   if (!updatedPoll) {
     return res.status(500).json({ error: 'Failed to update poll after voting' });
   }
   
   const updateData = {
     pollId,
     results: updatedPoll.results,
     total_votes: updatedPoll.total_votes,
     timestamp: Date.now()
   };
   
   // Method 1: Emit directly to specific room with client count check
   const clients = io.sockets.adapter.rooms.get(`poll:${pollId}`);
   console.log(`Room poll:${pollId} has ${clients ? clients.size : 0} clients connected`);
   
   io.in(`poll:${pollId}`).fetchSockets().then(sockets => {
     console.log(`Broadcasting to ${sockets.length} clients in poll:${pollId}`);
     io.to(`poll:${pollId}`).emit('vote_update', updateData);
   });
   
   // Method 2: Global broadcast as fallback
   io.emit('global_vote_update', updateData);
   
   // Method 3: Via Redis pubsub
   redis.publish('poll_updates', JSON.stringify(updateData));
   
   res.json({ 
     success: true, 
     results: updatedPoll.results,
     total_votes: updatedPoll.total_votes
   });
 } catch (error) {
   console.error('Vote error:', error);
   res.status(500).json({ 
     error: 'Failed to cast vote',
     message: error.message
   });
 }
});

// Get live polls 
app.get('/api/live-polls', async (req, res) => {
 try {
   // Get all active polls
   const polls = await db('polls')
     .where('expires_at', '>', new Date())
     .andWhere({ is_active: true })
     .orderBy('created_at', 'desc')
     .limit(10);
   
   // Get vote counts for each poll
   const pollsWithData = await Promise.all(polls.map(async (poll) => {
     return await getPollWithResults(poll.id);
   }));
   
   // Filter out any null values (in case a poll was deleted during processing)
   const validPolls = pollsWithData.filter(poll => poll !== null);
   
   res.json(validPolls);
 } catch (error) {
   console.error('Get live polls error:', error);
   res.status(500).json({ error: 'Failed to get live polls' });
 }
});

// Server-sent events for live poll updates
app.get('/api/live/:id', (req, res) => {
 try {
   const pollId = req.params.id;
   
   // Set up SSE
   res.setHeader('Content-Type', 'text/event-stream');
   res.setHeader('Cache-Control', 'no-cache');
   res.setHeader('Connection', 'keep-alive');
   
   // Initial data fetch and send
   (async () => {
     const poll = await getPollWithResults(pollId);
     
     if (!poll) {
       res.write(`data: ${JSON.stringify({ error: 'Poll not found' })}\n\n`);
       return res.end();
     }
     
     // Send the initial data
     res.write(`data: ${JSON.stringify(poll)}\n\n`);
   })();
   
   // Subscribe to Redis channel for this poll
   const client = redis.duplicate();
   client.subscribe('poll_updates');
   
   client.on('message', (channel, message) => {
     try {
       const data = JSON.parse(message);
       if (data.pollId === pollId) {
         res.write(`data: ${message}\n\n`);
       }
     } catch (err) {
       console.error('Error parsing Redis message:', err);
     }
   });
   
   // Handle client disconnect
   req.on('close', () => {
     client.unsubscribe();
     client.quit();
     res.end();
   });
 } catch (error) {
   console.error('Live poll error:', error);
   res.status(500).json({ error: 'Failed to get live poll updates' });
 }
});

// Track active polls and their viewers
const activePollRooms = new Map();
const userPolls = new Map();
// Store active comments in memory (could move to Redis for persistence)
const pollComments = new Map();

// Socket.io setup
io.use((socket, next) => {
 const token = socket.handshake.auth.token;
 if (!token) {
   return next(new Error('Authentication required'));
 }
 
 try {
   const payload = jwt.verify(token, JWT_SECRET);
   socket.user = {
     sub: payload.sub,
     username: payload.username
   };
   next();
 } catch (error) {
   return next(new Error('Invalid token'));
 }
});

io.on('connection', (socket) => {
 if (!socket.user) {
   socket.disconnect();
   return;
 }
 
 console.log(`User connected: ${socket.user.sub} with socket ID: ${socket.id}`);
 
 // Add user to tracking
 userPolls.set(socket.user.sub, new Set());
 
 // Send list of active polls to the newly connected user
 socket.emit('active_polls', Array.from(activePollRooms.keys()));
 
 // Add an explicit heartbeat to keep connections alive
 const heartbeatInterval = setInterval(() => {
   socket.emit('heartbeat', { timestamp: Date.now() });
 }, 30000);
 
 socket.on('join_poll', async (pollId, callback) => {
   try {
     // Validate poll exists
     const poll = await db('polls').where({ id: pollId }).first();
     if (!poll) {
       socket.emit('error', { message: 'Poll not found' });
       if (callback) callback({ success: false, error: 'Poll not found' });
       return;
     }
     
     // Leave any previous poll rooms this socket was in
     const roomsToLeave = [...socket.rooms].filter(room => 
       room !== socket.id && room.startsWith('poll:') && room !== `poll:${pollId}`
     );
     
     for (const room of roomsToLeave) {
       console.log(`User ${socket.user.sub} leaving room ${room} to join poll:${pollId}`);
       socket.leave(room);
       
       // Update user's poll tracking
       const oldPollId = room.replace('poll:', '');
       if (activePollRooms.has(oldPollId)) {
         activePollRooms.get(oldPollId).delete(socket.user.sub);
         
         // Notify others in the old room
         const oldViewerCount = activePollRooms.get(oldPollId).size || 0;
         io.to(room).emit('viewer_count', { 
           pollId: oldPollId, 
           count: oldViewerCount 
         });
         
         // Remove empty rooms
         if (oldViewerCount === 0) {
           activePollRooms.delete(oldPollId);
         }
       }
     }
     
     // Join the new poll room
     socket.join(`poll:${pollId}`);
     
     // Add user to active viewers for this poll
     if (!activePollRooms.has(pollId)) {
       activePollRooms.set(pollId, new Set());
       pollComments.set(pollId, []);
     }
     activePollRooms.get(pollId).add(socket.user.sub);
     
     // Track which polls this user has joined
     userPolls.get(socket.user.sub).add(pollId);
     
     // Get current poll data
     const pollWithResults = await getPollWithResults(pollId);
     
     // Send initial poll data to the user
     socket.emit('poll_data', pollWithResults);
     
     // Send existing comments
     const comments = pollComments.get(pollId) || [];
     socket.emit('comment_history', comments);
     
     // Notify everyone in the room about the new viewer count
     const viewerCount = activePollRooms.get(pollId).size || 0;
     io.to(`poll:${pollId}`).emit('viewer_count', { pollId, count: viewerCount });
     
     console.log(`User ${socket.user.sub} joined poll ${pollId} (${viewerCount} viewers)`);
     
     // Debug: Log all clients in the room
     const clients = io.sockets.adapter.rooms.get(`poll:${pollId}`);
     console.log(`Room poll:${pollId} has ${clients ? clients.size : 0} clients connected`);
     
     // Send confirmation to client
     socket.emit('poll_joined', { pollId, success: true });
     if (callback) callback({ success: true });
   } catch (err) {
     console.error(`Error joining poll ${pollId}:`, err);
     socket.emit('error', { message: 'Failed to join poll' });
     if (callback) callback({ success: false, error: err.message });
   }
 });
 
 socket.on('leave_poll', (pollId) => {
   handleLeavePoll(socket, pollId);
 });
 
 // Handle real-time comments on polls
 socket.on('send_comment', async ({ pollId, comment }) => {
   if (!socket.user) return;
   
   // Validate comment
   if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
     return;
   }
   
   // Limit comment length
   const trimmedComment = comment.trim().substring(0, 500);
   
   // Create comment object
   const commentData = {
     id: uuidv4(),
     pollId,
     userId: socket.user.sub,
     username: socket.user.username,
     text: trimmedComment,
     timestamp: new Date().toISOString()
   };
   
   // Store comment
   const comments = pollComments.get(pollId) || [];
   comments.push(commentData);
   
   // Limit stored comments (keep last 100)
   if (comments.length > 100) {
     comments.splice(0, comments.length - 100);
   }
   
   pollComments.set(pollId, comments);
   
   // Broadcast comment to all users in the poll room
   io.to(`poll:${pollId}`).emit('new_comment', commentData);
 });
 
 socket.on('heartbeat_ack', () => {
   // Optional: track last heartbeat response time
   socket.lastHeartbeat = Date.now();
 });
 
 socket.on('debug_info', (callback) => {
   const roomsInfo = {};
   for (const room of socket.rooms) {
     if (room !== socket.id) {
       const roomClients = io.sockets.adapter.rooms.get(room);
       roomsInfo[room] = roomClients ? roomClients.size : 0;
     }
   }
   
   const response = {
     socketId: socket.id,
     userId: socket.user?.sub,
     rooms: roomsInfo,
     connected: socket.connected,
     serverTime: Date.now()
   };
   
   if (callback) callback(response);
   return response;
 });
 
 socket.on('disconnect', () => {
   console.log(`User disconnected: ${socket.user.sub}`);
   clearInterval(heartbeatInterval);
   
   // Get polls this user was in
   const userPollSet = userPolls.get(socket.user.sub);
   if (userPollSet) {
     // Leave all polls
     for (const pollId of userPollSet) {
       handleLeavePoll(socket, pollId);
     }
     
     // Clean up user tracking
     userPolls.delete(socket.user.sub);
   }
 });
 
 // Helper function to handle leaving a poll
 function handleLeavePoll(socket, pollId) {
   socket.leave(`poll:${pollId}`);
   
   // Remove user from active viewers
   if (activePollRooms.has(pollId)) {
     const viewers = activePollRooms.get(pollId);
     viewers.delete(socket.user.sub);
     
     // Remove from user's active polls
     const userPollSet = userPolls.get(socket.user.sub);
     if (userPollSet) {
       userPollSet.delete(pollId);
     }
     
     // If this poll has no more viewers, clean up
     if (viewers.size === 0) {
       activePollRooms.delete(pollId);
     } else {
       // Notify remaining viewers about the updated count
       const viewerCount = viewers.size;
       io.to(`poll:${pollId}`).emit('viewer_count', { pollId, count: viewerCount });
     }
   }
   
   console.log(`User ${socket.user.sub} left poll ${pollId}`);
 }
});

// Redis subscriber for horizontal scaling
const redisSubscriber = redis.duplicate();
redisSubscriber.subscribe('poll_updates');

redisSubscriber.on('message', (channel, message) => {
 if (channel === 'poll_updates') {
   try {
     const update = JSON.parse(message);
     if (update.event === 'poll_closed') {
       io.to(`poll:${update.pollId}`).emit('poll_closed', { pollId: update.pollId });
     } else if (update.pollId && update.results) {
       io.to(`poll:${update.pollId}`).emit('vote_update', update);
     }
   } catch (error) {
     console.error('Error processing Redis message:', error);
   }
 }
});

// Serve static front-end files in production
if (process.env.NODE_ENV === 'production') {
 app.use(express.static(path.join(__dirname, '../frontend/dist')));
 
 app.get('*', (req, res) => {
   res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
 });
}

// Schedule cleanup for expired polls
setInterval(async () => {
 try {
   const expiredPolls = await db('polls')
     .where('expires_at', '<', new Date())
     .andWhere({ is_active: true })
     .select('id');
   
   for (const poll of expiredPolls) {
     await closePoll(poll.id);
   }
 } catch (error) {
   console.error('Error in poll cleanup:', error);
 }
}, 60000); // Check every minute

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
 console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
 console.log('SIGTERM received, shutting down gracefully');
 
 // Close the server
 server.close(() => {
   console.log('HTTP server closed');
 });
 
 // Close database connection
 await db.destroy();
 
 // Close Redis connections
 redis.disconnect();
 redisSubscriber.disconnect();
 
 process.exit(0);
});

module.exports = server;