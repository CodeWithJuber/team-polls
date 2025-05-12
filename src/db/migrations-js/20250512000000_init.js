// src/db/migrations-js/20250512000000_init.js

exports.up = async function(knex) {
    // Users table (for authentication)
    await knex.schema.createTable('users', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('username').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
    
    // Polls table
    await knex.schema.createTable('polls', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('question').notNullable();
      table.jsonb('options').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('expires_at').notNullable();
      table.boolean('is_active').defaultTo(true);
    });
    
    // Votes table
    await knex.schema.createTable('votes', table => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('poll_id').notNullable().references('id').inTable('polls');
      table.uuid('user_id').notNullable().references('id').inTable('users');
      table.integer('option_index').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Each user can only vote once per poll
      table.unique(['poll_id', 'user_id']);
    });
    
    // Index for fast lookups
    await knex.raw(`
      CREATE INDEX votes_poll_id_idx ON votes (poll_id);
    `);
  };
  
  exports.down = async function(knex) {
    await knex.schema.dropTable('votes');
    await knex.schema.dropTable('polls');
    await knex.schema.dropTable('users');
  };