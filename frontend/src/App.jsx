// React App.js
import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';

const API_URL = '/api';
let socket;

function App() {
  const [user, setUser] = useState(null);
  const [pollId, setPollId] = useState('');
  const [poll, setPoll] = useState(null);
  const [livePolls, setLivePolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [comment, setComment] = useState('');
  const [comments, setComments] = useState([]);
  const [highlightedOptions, setHighlightedOptions] = useState([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketDebugInfo, setSocketDebugInfo] = useState({});
  const commentsRef = useRef(null);
  
  // Setup socket connection with reconnection
  const setupSocket = (token) => {
    if (socket) {
      socket.disconnect();
    }
    
    socket = io({
      auth: {
        token
      },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000
    });
    
    socket.on('connect', () => {
      console.log('Socket connected with ID:', socket.id);
      setSocketConnected(true);
      
      // When connected/reconnected, join the current poll if there is one
      if (pollId) {
        console.log(`Joining poll room for poll ${pollId} after connect/reconnect`);
        socket.emit('join_poll', pollId, (response) => {
          console.log('Join poll response:', response);
        });
      }
      
      // Get debug info
      socket.emit('debug_info', (info) => {
        setSocketDebugInfo(info);
      });
    });
    
    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
      setError(`WebSocket connection error: ${err.message}`);
      setSocketConnected(false);
    });
    
    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setSocketConnected(false);
    });
    
    socket.on('error', (errorData) => {
      console.error('Socket error:', errorData);
      setError(`Socket error: ${errorData.message}`);
    });
    
    // Listen for direct vote updates
    socket.on('vote_update', (data) => {
      console.log('Received vote update:', data);
      if (data.pollId === pollId) {
        console.log('Updating local poll data with new results');
        setPoll(prev => {
          if (!prev) return null;
          return {
            ...prev,
            results: data.results,
            total_votes: data.total_votes,
            _lastUpdate: Date.now() // For debugging
          };
        });
        
        // Visual feedback for new votes
        highlightVoteChanges(data.results);
      }
    });
    
    // Listen for global vote updates as backup
    socket.on('global_vote_update', (data) => {
      if (data.pollId === pollId) {
        console.log('Received global vote update');
        setPoll(prev => {
          if (!prev) return null;
          return {
            ...prev,
            results: data.results,
            total_votes: data.total_votes,
            _lastUpdate: Date.now()
          };
        });
        
        // Visual feedback
        highlightVoteChanges(data.results);
      }
    });
    
    // Poll closed notification
    socket.on('poll_closed', (data) => {
      if (data.pollId === pollId) {
        setPoll(prev => {
          if (!prev) return null;
          return {
            ...prev,
            is_active: false
          };
        });
        alert('This poll has closed.');
      }
      
      // Remove from live polls if present
      setLivePolls(prev => prev.filter(livePoll => livePoll.id !== data.pollId));
    });
    
    // Confirmation of joining poll room
    socket.on('poll_joined', (data) => {
      console.log(`Successfully joined poll room for ${data.pollId}`);
    });
    
    // Live viewer count updates
    socket.on('viewer_count', (data) => {
      if (data.pollId === pollId) {
        setViewerCount(data.count);
      }
    });
    
    // Comments on polls
    socket.on('new_comment', (commentData) => {
      if (commentData.pollId === pollId) {
        setComments(prev => [...prev, commentData]);
        
        // Scroll to the newest comment
        setTimeout(() => {
          if (commentsRef.current) {
            commentsRef.current.scrollTop = commentsRef.current.scrollHeight;
          }
        }, 100);
      }
    });
    
    // Initial comment history
    socket.on('comment_history', (commentsData) => {
      setComments(commentsData);
      
      // Scroll to the newest comment
      setTimeout(() => {
        if (commentsRef.current) {
          commentsRef.current.scrollTop = commentsRef.current.scrollHeight;
        }
      }, 100);
    });
    
    // Initial poll data
    socket.on('poll_data', (pollData) => {
      if (pollData.id === pollId) {
        setPoll(pollData);
      }
    });
    
    // Heartbeat response
    socket.on('heartbeat', (data) => {
      console.log('Heartbeat received:', data);
      socket.emit('heartbeat_ack');
    });

    return socket;
 };
 
 useEffect(() => {
   // Authenticate and set up socket
   async function authenticate() {
     try {
       const res = await axios.post(`${API_URL}/auth/anon`);
       setUser(res.data);
       
       // Setup socket with the token
       setupSocket(res.data.token);
     } catch (err) {
       setError('Authentication failed: ' + (err.response?.data?.error || err.message));
       console.error(err);
     }
   }
   
   authenticate();
   
   // Define window debug method
   window.debugSocketConnection = () => {
     if (!socket) {
       console.log('Socket object not initialized');
       return;
     }
     
     console.log('Socket status:', {
       id: socket.id,
       connected: socket.connected,
       disconnected: socket.disconnected
     });
     
     if (pollId) {
       console.log('Current poll ID:', pollId);
       socket.emit('join_poll', pollId, (response) => {
         console.log('Manual rejoin response:', response);
       });
     }
     
     socket.emit('debug_info', (info) => {
       console.log('Socket debug info:', info);
       setSocketDebugInfo(info);
     });
   };
   
   return () => {
     if (socket) {
       console.log('Disconnecting socket');
       socket.disconnect();
     }
   };
 }, []);
 
 // Function for visual feedback when votes change
 const highlightVoteChanges = (newResults) => {
   if (!poll || !poll.results) return;
   
   const changedIndices = [];
   
   // Compare previous and new results
   newResults.forEach((result, index) => {
     const oldResult = poll.results[index];
     if (oldResult && result.count !== oldResult.count) {
       changedIndices.push(index);
     }
   });
   
   // Set highlighted options
   setHighlightedOptions(changedIndices);
   
   // Clear highlight after animation
   setTimeout(() => {
     setHighlightedOptions([]);
   }, 1000);
 };
 
 // Fetch live polls
 const fetchLivePolls = async () => {
   try {
     const res = await axios.get(`${API_URL}/live-polls`);
     setLivePolls(res.data);
   } catch (err) {
     console.error('Failed to fetch live polls:', err);
   }
 };
 
 // Fetch live polls when component mounts
 useEffect(() => {
   fetchLivePolls();
   
   // Refresh live polls every 30 seconds
   const interval = setInterval(fetchLivePolls, 30000);
   return () => clearInterval(interval);
 }, []);
 
 // Join poll room when poll ID changes
 useEffect(() => {
   if (pollId && socket && socket.connected) {
     console.log(`Joining poll ${pollId} after poll ID change`);
     socket.emit('join_poll', pollId, (response) => {
       console.log('Join poll response:', response);
       if (!response.success) {
         setError(`Failed to join poll: ${response.error || 'Unknown error'}`);
       }
     });
   }
 }, [pollId]);
 
 // Reconnect to poll room if socket reconnects
 useEffect(() => {
   if (socketConnected && pollId) {
     console.log(`Reconnecting to poll ${pollId} after socket reconnection`);
     socket.emit('join_poll', pollId);
   }
 }, [socketConnected, pollId]);
 
 const fetchPoll = async () => {
   if (!pollId) return;
   
   setLoading(true);
   try {
     const res = await axios.get(`${API_URL}/poll/${pollId}`);
     setPoll(res.data);
     setComments([]);
     
     // Join socket room
     if (socket && socket.connected) {
       console.log(`Joining poll room for poll ${pollId}`);
       socket.emit('join_poll', pollId, (response) => {
         console.log('Join poll response:', response);
       });
     } else {
       console.warn('Socket not available when fetching poll');
       if (user && user.token) {
         // Try to reconnect socket
         setupSocket(user.token);
       }
     }
   } catch (err) {
     setError('Failed to fetch poll: ' + (err.response?.data?.error || err.message));
     console.error(err);
   } finally {
     setLoading(false);
   }
 };
 
 const castVote = async (optionIndex) => {
   if (!user || !pollId) return;
   
   try {
     console.log(`Casting vote for option ${optionIndex} in poll ${pollId}`);
     console.log(`Using auth token: ${user.token.substring(0, 15)}...`);
     
     const response = await axios.post(
       `${API_URL}/poll/${pollId}/vote`,
       { optionIndex },
       {
         headers: {
           Authorization: `Bearer ${user.token}`
         }
       }
     );
     
     console.log('Vote response:', response.data);
     
     // Immediate UI update for faster feedback
     if (response.data.results) {
       setPoll(prev => ({
         ...prev,
         results: response.data.results,
         total_votes: response.data.total_votes,
         _lastUpdate: Date.now() // For debugging
       }));
       
       // Visual feedback for changed options
       highlightVoteChanges(response.data.results);
     }
   } catch (err) {
     const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message;
     setError(`Failed to cast vote: ${errorMessage}`);
     console.error('Vote error details:', err.response?.data || err);
   }
 };
 
 const createPoll = async (event) => {
   event.preventDefault();
   const formData = new FormData(event.target);
   
   const question = formData.get('question');
   const optionsText = formData.get('options');
   const options = optionsText
     .split('\n')
     .filter(option => option.trim() !== '');
   
   if (!question || options.length < 2) {
     setError('Please provide a question and at least two options');
     return;
   }
   
   // Set expiry to 1 hour from now
   const expiresAt = new Date(Date.now() + 3600000).toISOString();
   
   try {
     const res = await axios.post(`${API_URL}/poll`, {
       question,
       options,
       expiresAt
     });
     
     setPollId(res.data.id);
     setPoll(res.data);
     setComments([]);
     
     // Join socket room
     if (socket && socket.connected) {
       socket.emit('join_poll', res.data.id, (response) => {
         console.log('Join poll response after creation:', response);
       });
     } else if (user && user.token) {
       // Try to reconnect socket
       setupSocket(user.token);
     }
     
     // Clear form
     event.target.reset();
     
     // Refresh live polls
     fetchLivePolls();
   } catch (err) {
     setError('Failed to create poll: ' + (err.response?.data?.error || err.message));
     console.error(err);
   }
 };

 // Generate a shareable URL for the poll
 const getPollUrl = () => {
   return `${window.location.origin}?poll=${poll?.id}`;
 };

 // Copy poll URL to clipboard
 const copyPollUrl = () => {
   const url = getPollUrl();
   navigator.clipboard.writeText(url).then(() => {
     alert('Poll URL copied to clipboard!');
   });
 };
 
 // Send a comment
 const sendComment = () => {
   if (!comment.trim() || !socket || !socket.connected || !pollId) return;
   
   socket.emit('send_comment', {
     pollId,
     comment: comment.trim()
   });
   
   setComment('');
 };
 
 // Leave current poll
 const leavePoll = () => {
   if (socket && socket.connected && pollId) {
     socket.emit('leave_poll', pollId);
   }
   
   setPoll(null);
   setPollId('');
   setViewerCount(0);
   setComments([]);
 };
 
 // Force reconnect socket
 const reconnectSocket = () => {
   if (user && user.token) {
     setupSocket(user.token);
     setError(null);
   }
 };
 
 // Check URL parameters for poll ID on load
 useEffect(() => {
   const urlParams = new URLSearchParams(window.location.search);
   const urlPollId = urlParams.get('poll');
   if (urlPollId) {
     setPollId(urlPollId);
     // We'll fetch the poll when the user auth is complete
   }
 }, []);
 
 // Fetch poll when user is authenticated and URL has poll ID
 useEffect(() => {
   if (user && pollId) {
     fetchPoll();
   }
 }, [user]);
 
 return (
   <div className="App" style={{
     maxWidth: '800px',
     margin: '0 auto',
     padding: '20px',
     fontFamily: 'Arial, sans-serif'
   }}>
     <h1>Team Polls</h1>
     
     {/* Socket status indicator */}
     <div style={{
       position: 'fixed',
       top: '10px',
       right: '10px',
       padding: '5px 10px',
       borderRadius: '15px',
       background: socketConnected ? '#4caf50' : '#f44336',
       color: 'white',
       fontSize: '12px',
       display: 'flex',
       alignItems: 'center',
       cursor: 'pointer'
     }} onClick={reconnectSocket}>
       <div style={{
         width: '8px',
         height: '8px',
         borderRadius: '50%',
         background: 'white',
         marginRight: '5px'
       }}></div>
       {socketConnected ? 'Connected' : 'Disconnected'}
     </div>
     
     {error && (
       <div style={{ 
         background: '#ffebee', 
         color: '#c62828', 
         padding: '10px', 
         borderRadius: '4px',
         marginBottom: '20px',
         position: 'relative'
       }}>
         {error}
         <button 
           onClick={() => setError(null)} 
           style={{
             position: 'absolute',
             top: '5px',
             right: '5px',
             background: 'none',
             border: 'none',
             cursor: 'pointer',
             fontSize: '16px'
           }}
         >
           ✕
         </button>
       </div>
     )}
     
     {user ? (
       <div>
         <p>Logged in as: {user.username}</p>
         
         {!poll ? (
           <div>
             <h2>Find a Poll</h2>
             <div style={{ marginBottom: '20px' }}>
               <input 
                 type="text" 
                 value={pollId} 
                 onChange={(e) => setPollId(e.target.value)}
                 placeholder="Enter Poll ID" 
                 style={{ padding: '8px', marginRight: '10px', width: '300px' }}
               />
               <button 
                 onClick={fetchPoll} 
                 disabled={loading}
                 style={{
                   padding: '8px 16px',
                   background: '#1976d2',
                   color: 'white',
                   border: 'none',
                   borderRadius: '4px',
                   cursor: loading ? 'not-allowed' : 'pointer'
                 }}
               >
                 {loading ? 'Loading...' : 'Find Poll'}
               </button>
             </div>
             
             <h2>Or Create a New Poll</h2>
             <form onSubmit={createPoll} style={{ marginTop: '20px' }}>
               <div style={{ marginBottom: '15px' }}>
                 <label style={{ display: 'block', marginBottom: '5px' }}>
                   Question:
                   <input 
                     type="text" 
                     name="question" 
                     required 
                     style={{ 
                       display: 'block', 
                       width: '100%', 
                       padding: '8px',
                       marginTop: '5px' 
                     }}
                   />
                 </label>
               </div>
               <div style={{ marginBottom: '15px' }}>
                 <label style={{ display: 'block', marginBottom: '5px' }}>
                   Options (one per line):
                   <textarea 
                     name="options" 
                     rows={5} 
                     required 
                     style={{ 
                       display: 'block', 
                       width: '100%', 
                       padding: '8px',
                       marginTop: '5px'  
                     }}
                   />
                 </label>
               </div>
               <button 
                 type="submit"
                 style={{
                   padding: '10px 20px',
                   background: '#388e3c',
                   color: 'white',
                   border: 'none',
                   borderRadius: '4px',
                   cursor: 'pointer'
                 }}
               >
                 Create Poll
               </button>
             </form>
             
             {/* Live Polls Section */}
             <h2 style={{ marginTop: '30px' }}>
               Live Polls
               <span style={{ 
                 fontSize: '14px',
                 color: '#757575',
                 fontWeight: 'normal',
                 marginLeft: '10px'
               }}>
                 Real-time updates
               </span>
             </h2>
             
             {livePolls.length === 0 ? (
               <p>No active polls at the moment.</p>
             ) : (
               <div>
                 {livePolls.map(livePoll => (
                   <div 
                     key={livePoll.id} 
                     style={{
                       border: '1px solid #ddd',
                       borderRadius: '4px',
                       padding: '15px',
                       marginBottom: '15px',
                       cursor: 'pointer',
                       transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                       ':hover': {
                         transform: 'translateY(-2px)',
                         boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
                       }
                     }}
                     onClick={() => {
                       setPollId(livePoll.id);
                       fetchPoll();
                     }}
                   >
                     <h3>{livePoll.question}</h3>
                     <div style={{
                       display: 'flex',
                       justifyContent: 'space-between',
                       marginBottom: '10px',
                       fontSize: '14px',
                       color: '#757575'
                     }}>
                       <span>Total votes: {livePoll.total_votes || 0}</span>
                       <span>Expires: {new Date(livePoll.expires_at).toLocaleString()}</span>
                     </div>
                     
                     {/* Show poll results preview */}
                     <div style={{ marginBottom: '10px' }}>
                       {livePoll.results.map((result, idx) => (
                         <div key={idx} style={{ marginBottom: '5px' }}>
                           <div style={{ display: 'flex', alignItems: 'center' }}>
                             <span style={{ minWidth: '150px', fontSize: '14px' }}>{result.option}</span>
                             <div style={{ 
                               flex: 1,
                               height: '20px',
                               background: '#e0e0e0',
                               borderRadius: '10px',
                               overflow: 'hidden'
                             }}>
                               <div style={{
                                 width: `${livePoll.total_votes ? (result.count / livePoll.total_votes * 100) : 0}%`,
                                 height: '100%',
                                 background: '#1976d2',
                                 transition: 'width 0.3s ease'
                               }} />
                             </div>
                             <span style={{ marginLeft: '10px', minWidth: '50px', textAlign: 'right' }}>
                               {livePoll.total_votes ? Math.round(result.count / livePoll.total_votes * 100) : 0}%
                             </span>
                           </div>
                         </div>
                       ))}
                     </div>
                     
                     <button 
                       onClick={(e) => {
                         e.stopPropagation();
                         setPollId(livePoll.id);
                         fetchPoll();
                       }}
                       style={{
                         padding: '8px 16px',
                         background: '#1976d2',
                         color: 'white',
                         border: 'none',
                         borderRadius: '4px',
                         cursor: 'pointer'
                       }}
                     >
                       Join Poll
                     </button>
                   </div>
                 ))}
               </div>
             )}
           </div>
         ) : (
           <div>
             <div style={{
               display: 'flex',
               justifyContent: 'space-between',
               alignItems: 'flex-start'
             }}>
               <h2 style={{ marginBottom: '5px' }}>{poll.question}</h2>
               
               <div style={{
                 display: 'flex',
                 alignItems: 'center',
                 background: '#f5f5f5',
                 padding: '5px 10px',
                 borderRadius: '20px',
                 fontSize: '14px'
               }}>
                 <span style={{ marginRight: '5px' }}>👁️</span>
                 <span>{viewerCount} {viewerCount === 1 ? 'viewer' : 'viewers'}</span>
               </div>
             </div>
             
             <div style={{ 
               display: 'flex', 
               justifyContent: 'space-between',
               marginBottom: '15px',
               fontSize: '14px',
               color: '#757575'
             }}>
               <p style={{ margin: '0' }}>Poll ID: {poll.id}</p>
               <p style={{ margin: '0' }}>Expires: {new Date(poll.expires_at).toLocaleString()}</p>
             </div>
             
             {/* Live indicator */}
             <div style={{
               display: 'inline-block',
               background: '#f44336',
               color: 'white',
               padding: '4px 8px',
               borderRadius: '4px',
               fontSize: '12px',
               fontWeight: 'bold',
               marginBottom: '15px'
             }}>
               <span style={{
                 display: 'inline-block',
                 width: '8px',
                 height: '8px',
                 borderRadius: '50%',
                 background: 'white',
                 marginRight: '5px',
                 animation: 'pulse 2s infinite'
               }}></span>
               LIVE
             </div>
             
             {/* Share poll button */}
             <div style={{ marginBottom: '20px' }}>
               <button
                 onClick={copyPollUrl}
                 style={{
                   padding: '8px 16px',
                   background: '#673ab7',
                   color: 'white',
                   border: 'none',
                   borderRadius: '4px',
                   cursor: 'pointer'
                 }}
               >
                 Copy Shareable Link
               </button>
             </div>
             
             {/* Voting section */}
             <div style={{ 
               display: 'flex',
               marginBottom: '30px'
             }}>
               {/* Options */}
               <div style={{ flex: 3, marginRight: '20px' }}>
                 {poll.options.map((option, index) => (
                   <div 
                     key={index} 
                     style={{ 
                       margin: '10px 0',
                       padding: '10px',
                       display: 'flex',
                       alignItems: 'center',
                       borderRadius: '4px',
                       animation: highlightedOptions.includes(index) ? 'highlight 1s ease' : 'none'
                     }}
                   >
                     <button 
                       onClick={() => castVote(index)}
                       disabled={!poll.is_active}
                       style={{
                         padding: '8px 16px',
                         background: poll.is_active ? '#1976d2' : '#bdbdbd',
                         color: 'white',
                         border: 'none',
                         borderRadius: '4px',
                         marginRight: '15px',
                         cursor: poll.is_active ? 'pointer' : 'not-allowed',
                         minWidth: '120px'
                       }}
                     >
                       {option}
                     </button>
                     
                     {/* Results bars with animation */}
                     <div style={{ 
                       flex: 1,
                       display: 'flex',
                       alignItems: 'center'
                     }}>
                       <div style={{ 
                         width: '200px',
                         height: '20px',
                         background: '#e0e0e0',
                         borderRadius: '10px',
                         overflow: 'hidden',
                         marginRight: '10px'
                       }}>
                         <div style={{
                           width: `${poll.results && poll.total_votes > 0 
                             ? (poll.results[index] ? poll.results[index].count / poll.total_votes * 100 : 0) 
                             : 0}%`,
                           height: '100%',
                           background: highlightedOptions.includes(index) ? '#4caf50' : '#1976d2',
                           transition: 'width 0.5s ease, background-color 0.5s ease'
                         }} />
                       </div>
                       <span>
                         {poll.results && poll.results[index] ? poll.results[index].count : 0} votes 
                         ({poll.total_votes > 0 
                           ? Math.round((poll.results[index]?.count || 0) / poll.total_votes * 100) 
                           : 0}%)
                       </span>
                     </div>
                   </div>
                 ))}
               </div>
               
               {/* Comments section */}
               <div style={{ flex: 2 }}>
                 <h3 style={{ fontSize: '16px', marginTop: '0' }}>Live Chat</h3>
                 <div 
                   ref={commentsRef}
                   style={{
                     height: '200px',
                     border: '1px solid #ddd',
                     borderRadius: '4px',
                     padding: '10px',
                     overflowY: 'auto',
                     marginBottom: '10px'
                   }}
                 >
                   {comments.length === 0 ? (
                     <p style={{ color: '#757575', fontSize: '14px' }}>No comments yet</p>
                   ) : (
                     comments.map(comment => (
                       <div key={comment.id} style={{
                         marginBottom: '8px',
                         padding: '8px',
                         background: '#f5f5f5',
                         borderRadius: '4px',
                         fontSize: '14px'
                       }}>
                         <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                           {comment.username}
                         </div>
                         <div>{comment.text}</div>
                         <div style={{ fontSize: '12px', color: '#757575', marginTop: '4px' }}>
                           {new Date(comment.timestamp).toLocaleTimeString()}
                         </div>
                       </div>
                     ))
                   )}
                 </div>
                 <div style={{ display: 'flex' }}>
                   <input
                     type="text"
                     value={comment}
                     onChange={(e) => setComment(e.target.value)}
                     placeholder="Type a comment..."
                     style={{
                       flex: 1,
                       padding: '8px',
                       borderRadius: '4px 0 0 4px',
                       border: '1px solid #ddd',
                       borderRight: 'none'
                     }}
                     onKeyPress={(e) => {
                       if (e.key === 'Enter') sendComment();
                     }}
                   />
                   <button
                     onClick={sendComment}
                     style={{
                       padding: '8px 16px',
                       background: '#4caf50',
                       color: 'white',
                       border: 'none',
                       borderRadius: '0 4px 4px 0',
                       cursor: 'pointer'
                     }}
                   >
                     Send
                   </button>
                 </div>
               </div>
             </div>
             
             {!poll.is_active && (
               <p style={{ 
                 color: '#d32f2f', 
                 fontWeight: 'bold' 
               }}>
                 This poll has closed
               </p>
             )}
             
             {/* Debug information */}
             {process.env.NODE_ENV !== 'production' && poll && (
               <div style={{
                 marginTop: '20px',
                 padding: '10px',
                 backgroundColor: '#f5f5f5',
                 borderRadius: '4px',
                 fontSize: '12px',
                 fontFamily: 'monospace'
               }}>
                 <h4>Debug Info</h4>
                 <div>Socket connected: {socket?.connected ? 'Yes' : 'No'} (ID: {socket?.id || 'None'})</div>
                 <div>Poll ID: {poll.id}</div>
                 <div>Last update: {poll._lastUpdate ? new Date(poll._lastUpdate).toLocaleTimeString() : 'None'}</div>
                 <div>Total votes: {poll.total_votes}</div>
                 <div>Active viewers: {viewerCount}</div>
                 <button onClick={() => {
                   if (socket && socket.connected) {
                     socket.emit('join_poll', pollId, (response) => {
                       console.log('Manual rejoin response:', response);
                     });
                     console.log('Manually rejoined poll room');
                   } else {
                     console.log('Socket not connected, cannot rejoin');
                     reconnectSocket();
                   }
                 }} style={{ marginRight: '10px' }}>
                   Rejoin poll room
                 </button>
                 <button onClick={reconnectSocket}>
                   Reconnect socket
                 </button>
               </div>
             )}
             
             <button
               onClick={leavePoll}
               style={{
                 marginTop: '20px',
                 padding: '8px 16px',
                 background: '#f44336',
                 color: 'white',
                 border: 'none',
                 borderRadius: '4px',
                 cursor: 'pointer'
               }}
             >
               Back to Home
             </button>
           </div>
         )}
       </div>
     ) : (
       <div style={{
         display: 'flex',
         justifyContent: 'center',
         alignItems: 'center',
         height: '200px'
       }}>
         <div style={{
           border: '4px solid #f3f3f3',
           borderTop: '4px solid #3498db',
           borderRadius: '50%',
           width: '30px',
           height: '30px',
           animation: 'spin 2s linear infinite',
           marginRight: '10px'
         }} />
         <p>Loading user information...</p>
       </div>
     )}
     
     {/* Add some CSS for animations */}
     <style>
       {`
         @keyframes spin {
           0% { transform: rotate(0deg); }
           100% { transform: rotate(360deg); }
         }
         
         @keyframes pulse {
           0% { opacity: 0.4; }
           50% { opacity: 1; }
           100% { opacity: 0.4; }
         }
         
         @keyframes highlight {
           0% { background-color: transparent; }
           50% { background-color: rgba(76, 175, 80, 0.2); }
           100% { background-color: transparent; }
         }
       `}
     </style>
   </div>
 );
}

export default App;