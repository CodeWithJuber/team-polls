# Team Polls - Real-time Voting Application

Team Polls is a real-time polling application that allows users to create polls, vote, and see results instantly. The application provides live updates as votes come in, enabling immediate feedback during team meetings, events, or any collaborative decision-making process.

## Features

- **Real-time Updates**: All votes and comments are instantly broadcast to all connected users
- **Anonymous Voting**: Users can participate anonymously without needing to create accounts
- **Shareable Links**: Easily share polls via unique URLs
- **Live Chat**: Comment and discuss each poll in real-time
- **Multiple Choice Options**: Create polls with as many options as needed
- **Expiring Polls**: Polls automatically expire after the set time period
- **Viewer Count**: See how many people are currently viewing a poll
- **Mobile Responsive**: Works well on all device sizes

## Tech Stack

- **Frontend**: React.js with real-time updates
- **Backend**: Node.js with Express
- **Database**: PostgreSQL for persistent storage
- **Real-time Communication**: Socket.io for WebSockets
- **Caching**: Redis for pub/sub and horizontal scaling
- **Authentication**: JWT-based stateless authentication
- **Container**: Docker and Docker Compose for easy deployment

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)

### Quick Start with Docker

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/team-polls.git
   cd team-polls
   ```

2. Start the application:
   ```bash
   docker-compose up
   ```

3. Access the application at http://localhost:5173

### Local Development

1. Install dependencies:
   ```bash
   # Install backend dependencies
   npm install
   
   # Install frontend dependencies
   cd frontend
   npm install
   ```

2. Start PostgreSQL and Redis (using Docker):
   ```bash
   docker-compose up postgres redis
   ```

3. Start the backend server:
   ```bash
   # From project root
   npm run dev
   ```

4. Start the frontend development server:
   ```bash
   cd frontend
   npm run dev
   ```

5. Access the application at http://localhost:5173

## API Endpoints

### Authentication
- `POST /api/auth/anon`: Create anonymous user and get JWT token

### Polls
- `POST /api/poll`: Create a new poll
- `GET /api/poll/:id`: Get poll details with results
- `POST /api/poll/:id/vote`: Cast a vote for a specific option
- `GET /api/live-polls`: Get a list of active polls
- `GET /api/live/:id`: SSE endpoint for live poll updates

## WebSocket Events

### Client to Server
- `join_poll`: Join a poll room to receive updates
- `leave_poll`: Leave a poll room
- `send_comment`: Send a comment on a poll

### Server to Client
- `vote_update`: Real-time vote count updates
- `global_vote_update`: Global channel for vote updates
- `new_comment`: New comment notifications
- `comment_history`: Initial comment history when joining a poll
- `poll_data`: Initial poll data when joining
- `viewer_count`: Updates on how many users are viewing a poll
- `poll_closed`: Notification when a poll is closed

## Project Structure

```
team-polls/
├── server.js             # Main server file
├── package.json          # Backend dependencies
├── docker-compose.yml    # Docker configuration
├── frontend/             # React frontend application
│   ├── src/              # Source code
│   │   ├── App.jsx       # Main application component
│   │   └── ...
│   ├── package.json      # Frontend dependencies
│   └── ...
└── README.md             # This file
```

## Common Issues and Solutions

### "Cannot use import statement outside a module" Error

If you encounter this error when starting the server:

```
SyntaxError: Cannot use import statement outside a module
```

This occurs because Node.js needs to be configured to use ES Modules. To fix this:

1. Either convert import statements to require() in server.js:
   ```javascript
   // Instead of:
   // import express from 'express';
   
   // Use:
   const express = require('express');
   ```

2. Or add "type": "module" to your package.json:
   ```json
   {
     "name": "team-polls",
     "type": "module",
     "version": "1.0.0",
     ...
   }
   ```

### Socket Connection Problems
- Make sure your browser supports WebSockets
- Check for network issues or firewall restrictions
- The debug panel in the app provides connection status and manual reconnection options

### Vote Updates Not Showing
- If votes aren't updating in real-time, use the "Refresh Poll Data" button in the debug panel
- Ensure the WebSocket connection is established (check the indicator in the top right)
- Try rejoining the poll room using the "Rejoin Poll Room" button

### Database Connection Issues
- If the application can't connect to the database, ensure PostgreSQL is running
- Check that the database URL is correctly set in your environment

## Performance Considerations

- The system is designed to handle multiple simultaneous polls
- Redis is used for horizontal scaling in production environments
- For very high volume polls, consider enabling the additional caching options

## Security

- JWT authentication is used to prevent unauthorized votes
- Rate limiting is implemented to prevent voting spam
- All user inputs are sanitized to prevent injection attacks

## Deployment

### Docker Deploy (Recommended)
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Manual Deployment
1. Set up PostgreSQL and Redis
2. Configure environment variables
3. Build the frontend:
   ```bash
   cd frontend
   npm run build
   ```
4. Start the server:
   ```bash
   NODE_ENV=production node server.js
   ```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `JWT_SECRET`: Secret for JWT token generation
- `NODE_ENV`: Environment (development/production)

## Troubleshooting Live Updates

If you're experiencing issues with live updates on poll votes:

1. **Check WebSocket Connection**: Look for the connection indicator in the top right corner
2. **Verify Socket Authentication**: Ensure your anonymous token is properly set
3. **Browser Console**: Check for any WebSocket errors in your browser's console
4. **Room Joining**: The application will attempt to rejoin poll rooms periodically
5. **Manual Actions**: Use the debug panel to manually refresh data or reconnect

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Socket.io for the excellent real-time communication library
- React team for the frontend framework
- Express for the lightweight server framework
- All contributors who have helped improve this project
