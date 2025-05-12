// src/services/pollService.ts
import { db } from '../db';
import { socketServer } from '../sockets';
import { redisClient } from './redis';

export async function createPoll(question, options, expiresAt) {
  const poll = await db('polls').insert({
    question,
    options: JSON.stringify(options),
    expires_at: expiresAt
  }).returning('*');
  
  // Set expiration job
  const expirationDelay = new Date(expiresAt).getTime() - Date.now();
  setTimeout(() => closePoll(poll.id), expirationDelay);
  
  return poll[0];
}

export async function getPoll(pollId) {
  const poll = await db('polls').where({ id: pollId }).first();
  
  if (!poll) {
    return null;
  }
  
  // Get vote counts
  const voteCounts = await db('votes')
    .where({ poll_id: pollId })
    .select('option_index')
    .count('* as count')
    .groupBy('option_index');
  
  // Format results
  const options = JSON.parse(poll.options);
  const results = options.map((option, index) => {
    const voteData = voteCounts.find(v => v.option_index === index);
    return {
      option,
      count: voteData ? parseInt(voteData.count) : 0
    };
  });
  
  return {
    ...poll,
    options: options,
    results
  };
}

export async function castVote(pollId, userId, optionIndex) {
  // Check if poll is active
  const poll = await db('polls')
    .where({ id: pollId })
    .first();
  
  if (!poll) {
    throw new Error('Poll not found');
  }
  
  if (new Date(poll.expires_at) < new Date() || !poll.is_active) {
    throw new Error('Poll has expired');
  }
  
  // Check option validity
  const options = JSON.parse(poll.options);
  if (optionIndex < 0 || optionIndex >= options.length) {
    throw new Error('Invalid option index');
  }
  
  try {
    // Insert or update vote (idempotent per user)
    await db('votes')
      .insert({
        poll_id: pollId,
        user_id: userId,
        option_index: optionIndex
      })
      .onConflict(['poll_id', 'user_id'])
      .merge({ option_index: optionIndex });
    
    // Get updated results
    const results = await getVoteTally(pollId);
    
    // Broadcast update via WebSockets
    socketServer.to(`poll:${pollId}`).emit('vote_update', {
      pollId,
      results
    });
    
    // Also publish to Redis for horizontal scaling
    redisClient.publish('poll_updates', JSON.stringify({
      pollId,
      results
    }));
    
    return results;
  } catch (error) {
    console.error('Error casting vote:', error);
    throw error;
  }
}

export async function getVoteTally(pollId) {
  const voteCounts = await db('votes')
    .where({ poll_id: pollId })
    .select('option_index')
    .count('* as count')
    .groupBy('option_index');
  
  const poll = await db('polls').where({ id: pollId }).first();
  const options = JSON.parse(poll.options);
  
  return options.map((option, index) => {
    const voteData = voteCounts.find(v => v.option_index === index);
    return {
      option,
      count: voteData ? parseInt(voteData.count) : 0
    };
  });
}

export async function closePoll(pollId) {
  await db('polls')
    .where({ id: pollId })
    .update({ is_active: false });
  
  // Notify clients that poll is closed
  socketServer.to(`poll:${pollId}`).emit('poll_closed', { pollId });
  
  // Publish to Redis for horizontal scaling
  redisClient.publish('poll_updates', JSON.stringify({
    pollId,
    event: 'poll_closed'
  }));
}