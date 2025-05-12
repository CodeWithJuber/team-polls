// src/sockets/index.ts
import { DefaultEventsMap, Server as SocketServer } from 'socket.io';
import { verifyToken } from '../auth/jwt';
import { redisClient } from '../services/redis';

let io: SocketServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>;

export function setupSocketHandlers(socketServer: SocketServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>) {
  io = socketServer;
  
  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    
    const user = verifyToken(token);
    if (!user) {
      return next(new Error('Invalid token'));
    }
    
    socket.user = user;
    next();
  });
  
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.sub}`);
    
    // Join poll room
    socket.on('join_poll', (pollId) => {
      socket.join(`poll:${pollId}`);
      console.log(`User ${socket.user.sub} joined poll ${pollId}`);
    });
    
    // Leave poll room
    socket.on('leave_poll', (pollId) => {
      socket.leave(`poll:${pollId}`);
      console.log(`User ${socket.user.sub} left poll ${pollId}`);
    });
    
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.user.sub}`);
    });
  });
  
  // Subscribe to Redis channel for horizontal scaling
  const redisSubscriber = redisClient.duplicate();
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
  
  return io;
}

export { io as socketServer };