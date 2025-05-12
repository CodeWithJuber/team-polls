// tests/integration/poll.test.ts
import request from 'supertest';
import { app } from '../../src/app';
import { db } from '../../src/db';

describe('Poll API', () => {
  let authToken;
  let pollId;
  
  beforeAll(async () => {
    // Get auth token
    const authRes = await request(app)
      .post('/api/auth/anon')
      .send();
      
    authToken = authRes.body.token;
  });
  
  afterAll(async () => {
    await db.destroy();
  });
  
  it('should create a new poll', async () => {
    const response = await request(app)
      .post('/api/poll')
      .send({
        question: 'Test poll question?',
        options: ['Option 1', 'Option 2', 'Option 3'],
        expiresAt: new Date(Date.now() + 86400000).toISOString() // +24h
      });
      
    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.question).toBe('Test poll question?');
    
    pollId = response.body.id;
  });
  
  it('should get poll details', async () => {
    const response = await request(app)
      .get(`/api/poll/${pollId}`);
      
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(pollId);
    expect(response.body).toHaveProperty('results');
  });
  
  it('should cast a vote', async () => {
    const response = await request(app)
      .post(`/api/poll/${pollId}/vote`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ optionIndex: 1 });
      
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.results[1].count).toBe(1);
  });
  
  it('should be idempotent when voting multiple times', async () => {
    // First vote (already done in previous test)
    
    // Second vote for the same user but different option
    const response = await request(app)
      .post(`/api/poll/${pollId}/vote`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ optionIndex: 2 });
      
    expect(response.status).toBe(200);
    
    // Get poll to verify vote count
    const pollRes = await request(app)
      .get(`/api/poll/${pollId}`);
      
    // Should still have only 1 vote total (moved from option 1 to 2)
    const totalVotes = pollRes.body.results.reduce((sum, option) => sum + option.count, 0);
    expect(totalVotes).toBe(1);
    expect(pollRes.body.results[1].count).toBe(0); // Previous vote removed
    expect(pollRes.body.results[2].count).toBe(1); // New vote counted
  });
});