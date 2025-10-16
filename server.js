const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const fileUpload = require('express-fileupload');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

// Data persistence files
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHAT_ROOMS_FILE = path.join(DATA_DIR, 'chatRooms.json');
const USER_PROFILES_FILE = path.join(DATA_DIR, 'userProfiles.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// In-memory storage for users and messages (now persisted)
let users = [];
let messages = [];
let onlineUsers = new Set();
let currentRoom = 'general';

// Track online users
let activeSessions = new Set();

// Track active calls per room
let activeCalls = {}; // roomId: { initiator: username, participants: Set, streamId: string }

// User profiles
let userProfiles = {}; // username: { avatar: base64, displayName: string }

// Load data from files
function loadData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading users:', err);
    users = [];
  }

  try {
    if (fs.existsSync(CHAT_ROOMS_FILE)) {
      chatRooms = JSON.parse(fs.readFileSync(CHAT_ROOMS_FILE, 'utf8'));
      // Convert message timestamps back to Date objects
      Object.keys(chatRooms).forEach(roomId => {
        chatRooms[roomId].messages.forEach(msg => {
          msg.timestamp = new Date(msg.timestamp);
        });
      });
    } else {
      chatRooms = {
        'general': { name: 'General Chat', messages: [], type: 'group', admins: ['admin'], members: [] },
        'random': { name: 'Random', messages: [], type: 'group', admins: ['admin'], members: [] },
        'tech': { name: 'Tech Talk', messages: [], type: 'group', admins: ['admin'], members: [] }
      };
    }
  } catch (err) {
    console.error('Error loading chat rooms:', err);
    chatRooms = {
      'general': { name: 'General Chat', messages: [], type: 'group', admins: ['admin'], members: [] },
      'random': { name: 'Random', messages: [], type: 'group', admins: ['admin'], members: [] },
      'tech': { name: 'Tech Talk', messages: [], type: 'group', admins: ['admin'], members: [] }
    };
  }

  try {
    if (fs.existsSync(USER_PROFILES_FILE)) {
      userProfiles = JSON.parse(fs.readFileSync(USER_PROFILES_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading user profiles:', err);
    userProfiles = {};
  }
}

// Save data to files
function saveData() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('Error saving users:', err);
  }

  try {
    fs.writeFileSync(CHAT_ROOMS_FILE, JSON.stringify(chatRooms, null, 2));
  } catch (err) {
    console.error('Error saving chat rooms:', err);
  }

  try {
    fs.writeFileSync(USER_PROFILES_FILE, JSON.stringify(userProfiles, null, 2));
  } catch (err) {
    console.error('Error saving user profiles:', err);
  }
}

// Load data on startup
loadData();

// Polls storage
let polls = {}; // pollId: { question, options: [{text, votes: []}], creator, room, createdAt }

// Load polls from file
const POLLS_FILE = path.join(DATA_DIR, 'polls.json');
function loadPolls() {
  try {
    if (fs.existsSync(POLLS_FILE)) {
      polls = JSON.parse(fs.readFileSync(POLLS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading polls:', err);
    polls = {};
  }
}

function savePolls() {
  try {
    fs.writeFileSync(POLLS_FILE, JSON.stringify(polls, null, 2));
  } catch (err) {
    console.error('Error saving polls:', err);
  }
}

// Load polls on startup
loadPolls();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (users.find(user => user.username === username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  users.push({ username, password });
  res.json({ message: 'Registration successful' });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  // Track online users
  activeSessions.add(username);
  res.json({ message: 'Login successful', username });
});

app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/messages', (req, res) => {
  const room = req.query.room || 'general';
  res.json(chatRooms[room] ? chatRooms[room].messages : []);
});

app.post('/messages', (req, res) => {
  const { username, message, room, type, file, pollId } = req.body;
  const targetRoom = room || 'general';
  if (!username || (!message && !file && !pollId)) {
    return res.status(400).json({ error: 'Username and content required' });
  }
  if (!chatRooms[targetRoom]) {
    return res.status(400).json({ error: 'Invalid room' });
  }
  const msg = { id: Date.now(), username, timestamp: new Date() };
  if (message) msg.message = message;
  if (type) msg.type = type;
  if (file) msg.file = file;
  if (pollId) msg.pollId = pollId;
  chatRooms[targetRoom].messages.push(msg);
  saveData(); // Save after message
  res.json({ message: 'Message sent' });
});

app.put('/edit-message', (req, res) => {
  const { messageId, newMessage, room } = req.body;
  if (!messageId || !newMessage || !room) {
    return res.status(400).json({ error: 'Message ID, new message, and room required' });
  }
  if (!chatRooms[room]) {
    return res.status(400).json({ error: 'Invalid room' });
  }
  const messageIndex = chatRooms[room].messages.findIndex(msg => msg.id == messageId);
  if (messageIndex === -1) {
    return res.status(404).json({ error: 'Message not found' });
  }
  chatRooms[room].messages[messageIndex].message = newMessage;
  saveData(); // Save after edit
  res.json({ message: 'Message edited successfully' });
});

app.get('/rooms', (req, res) => {
  const rooms = Object.keys(chatRooms).map(id => {
    const room = chatRooms[id];
    return {
      id,
      name: room.name,
      type: room.type,
      callActive: activeCalls[id] ? true : false,
      callParticipants: activeCalls[id] ? Array.from(activeCalls[id].participants) : []
    };
  });
  res.json(rooms);
});

app.get('/online-users', (req, res) => {
  res.json({ count: activeSessions.size });
});

app.get('/user-profile/:username', (req, res) => {
  const username = req.params.username;
  const profile = userProfiles[username] || { displayName: username, avatar: null };
  res.json(profile);
});

app.post('/user-profile/:username', (req, res) => {
  const username = req.params.username;
  const { displayName } = req.body;
  const avatarFile = req.files ? req.files.avatar : null;

  if (!userProfiles[username]) {
    userProfiles[username] = {};
  }

  if (displayName) userProfiles[username].displayName = displayName;

  if (avatarFile) {
    // Convert file to base64 for storage
    const base64 = avatarFile.data.toString('base64');
    userProfiles[username].avatar = `data:${avatarFile.mimetype};base64,${base64}`;
  }

  res.json({ message: 'Profile updated' });
});

app.post('/create-room', (req, res) => {
  const { name, type, creator } = req.body;
  if (!name || !type || !creator) {
    return res.status(400).json({ error: 'Name, type, and creator required' });
  }
  const roomId = name.toLowerCase().replace(/\s+/g, '-');
  if (chatRooms[roomId]) {
    return res.status(400).json({ error: 'Room already exists' });
  }
  chatRooms[roomId] = {
    name,
    type,
    messages: [],
    admins: [creator],
    members: [creator]
  };
  // Add to user's chats
  if (!userProfiles[creator]) userProfiles[creator] = {};
  if (!userProfiles[creator].chats) userProfiles[creator].chats = [];
  userProfiles[creator].chats.push(roomId);
  res.json({ message: 'Room created', roomId });
});

app.post('/create-private-chat', (req, res) => {
  const { username, targetUser } = req.body;
  if (!username || !targetUser) {
    return res.status(400).json({ error: 'Username and target user required' });
  }
  if (username === targetUser) {
    return res.status(400).json({ error: 'Cannot create chat with yourself' });
  }
  // Check if private chat already exists
  const existingChat = Object.keys(chatRooms).find(id => {
    const room = chatRooms[id];
    return room.type === 'private' && room.members.includes(username) && room.members.includes(targetUser);
  });
  if (existingChat) {
    return res.json({ message: 'Chat already exists', roomId: existingChat });
  }
  const roomId = `private-${Date.now()}`;
  chatRooms[roomId] = {
    name: `Chat with ${targetUser}`,
    type: 'private',
    messages: [],
    admins: [username, targetUser],
    members: [username, targetUser]
  };
  // Add to both users' chats
  [username, targetUser].forEach(user => {
    if (!userProfiles[user]) userProfiles[user] = {};
    if (!userProfiles[user].chats) userProfiles[user].chats = [];
    userProfiles[user].chats.push(roomId);
  });
  res.json({ message: 'Private chat created', roomId });
});

app.put('/change-username', (req, res) => {
  const { oldUsername, newUsername } = req.body;
  if (!oldUsername || !newUsername) {
    return res.status(400).json({ error: 'Old and new username required' });
  }
  if (users.find(user => user.username === newUsername)) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  const userIndex = users.findIndex(user => user.username === oldUsername);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }
  users[userIndex].username = newUsername;
  // Update userProfiles
  if (userProfiles[oldUsername]) {
    userProfiles[newUsername] = userProfiles[oldUsername];
    delete userProfiles[oldUsername];
  }
  // Update active sessions
  if (activeSessions.has(oldUsername)) {
    activeSessions.delete(oldUsername);
    activeSessions.add(newUsername);
  }
  // Update chat rooms memberships
  Object.keys(chatRooms).forEach(roomId => {
    const room = chatRooms[roomId];
    if (room.members.includes(oldUsername)) {
      room.members = room.members.map(m => m === oldUsername ? newUsername : m);
    }
    if (room.admins.includes(oldUsername)) {
      room.admins = room.admins.map(a => a === oldUsername ? newUsername : a);
    }
    room.messages.forEach(msg => {
      if (msg.username === oldUsername) msg.username = newUsername;
    });
  });
  res.json({ message: 'Username changed successfully' });
});

app.get('/user-chats', (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  const userChats = userProfiles[username]?.chats || [];
  const chats = userChats.map(roomId => {
    const room = chatRooms[roomId];
    return room ? { id: roomId, name: room.name, type: room.type, lastMessage: room.messages[room.messages.length - 1] } : null;
  }).filter(Boolean);
  res.json(chats);
});

// Polls routes
app.post('/create-poll', (req, res) => {
  const { question, options, room, creator } = req.body;
  if (!question || !options || !room || !creator) {
    return res.status(400).json({ error: 'Question, options, room, and creator required' });
  }
  if (options.length < 2) {
    return res.status(400).json({ error: 'At least 2 options required' });
  }
  const pollId = `poll-${Date.now()}`;
  polls[pollId] = {
    question,
    options: options.map(opt => ({ text: opt, votes: [] })),
    creator,
    room,
    createdAt: new Date()
  };
  savePolls();
  res.json({ pollId, message: 'Poll created' });
});

app.post('/vote-poll', (req, res) => {
  const { pollId, optionIndex, username } = req.body;
  if (!pollId || optionIndex === undefined || !username) {
    return res.status(400).json({ error: 'Poll ID, option index, and username required' });
  }
  if (!polls[pollId]) {
    return res.status(404).json({ error: 'Poll not found' });
  }
  const poll = polls[pollId];
  // Remove previous vote if exists
  poll.options.forEach(opt => {
    opt.votes = opt.votes.filter(vote => vote !== username);
  });
  // Add new vote
  if (poll.options[optionIndex]) {
    poll.options[optionIndex].votes.push(username);
  }
  savePolls();
  res.json({ message: 'Vote recorded' });
});

app.get('/polls/:room', (req, res) => {
  const room = req.params.room;
  const roomPolls = Object.keys(polls).filter(pollId => polls[pollId].room === room).map(pollId => ({
    id: pollId,
    ...polls[pollId]
  }));
  res.json(roomPolls);
});

// File upload route
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.post('/upload-file', upload.single('file'), (req, res) => {
  const { username, room } = req.body;
  if (!username || !room || !req.file) {
    return res.status(400).json({ error: 'Username, room, and file required' });
  }
  if (!chatRooms[room]) {
    return res.status(400).json({ error: 'Invalid room' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  const msg = {
    id: Date.now(),
    username,
    timestamp: new Date(),
    file: fileUrl,
    type: 'file',
    filename: req.file.originalname,
    mimetype: req.file.mimetype
  };
  chatRooms[room].messages.push(msg);
  saveData();
  res.json({ message: 'File uploaded' });
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Link sharing route
app.get('/room/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  if (!chatRooms[roomId]) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const room = chatRooms[roomId];
  res.json({
    id: roomId,
    name: room.name,
    type: room.type,
    members: room.members.length,
    description: room.description || 'No description'
  });
});

// Socket.IO handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (data) => {
    const { username, room } = data;
    socket.join(room);
    socket.username = username;
    socket.room = room;
    console.log(`${username} joined room ${room}`);

    // Notify others in the room
    socket.to(room).emit('user-joined', { username, room });
  });

  socket.on('start-call', (data) => {
    const { username, room, isVideo } = data;
    if (!activeCalls[room]) {
      activeCalls[room] = {
        initiator: username,
        participants: new Set([username]),
        isVideo: isVideo,
        startTime: new Date()
      };
      io.to(room).emit('call-started', {
        initiator: username,
        room: room,
        isVideo: isVideo,
        participants: Array.from(activeCalls[room].participants)
      });
      console.log(`Call started in room ${room} by ${username}`);
    } else {
      // Join existing call
      activeCalls[room].participants.add(username);
      io.to(room).emit('call-updated', {
        room: room,
        participants: Array.from(activeCalls[room].participants)
      });
      console.log(`${username} joined existing call in room ${room}`);
    }
  });

  socket.on('join-call', (data) => {
    const { username, room } = data;
    if (activeCalls[room]) {
      activeCalls[room].participants.add(username);
      io.to(room).emit('call-updated', {
        room: room,
        participants: Array.from(activeCalls[room].participants)
      });
      console.log(`${username} joined call in room ${room}`);
    }
  });

  socket.on('end-call', (data) => {
    const { username, room } = data;
    if (activeCalls[room]) {
      activeCalls[room].participants.delete(username);
      if (activeCalls[room].participants.size === 0) {
        delete activeCalls[room];
        io.to(room).emit('call-ended', { room: room });
        console.log(`Call ended in room ${room}`);
      } else {
        io.to(room).emit('call-updated', {
          room: room,
          participants: Array.from(activeCalls[room].participants)
        });
        console.log(`${username} left call in room ${room}`);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (socket.username && socket.room) {
      // Remove from active sessions
      activeSessions.delete(socket.username);

      // Handle call cleanup
      if (activeCalls[socket.room] && activeCalls[socket.room].participants.has(socket.username)) {
        activeCalls[socket.room].participants.delete(socket.username);
        if (activeCalls[socket.room].participants.size === 0) {
          delete activeCalls[socket.room];
          socket.to(socket.room).emit('call-ended', { room: socket.room });
        } else {
          socket.to(socket.room).emit('call-updated', {
            room: socket.room,
            participants: Array.from(activeCalls[socket.room].participants)
          });
        }
      }

      socket.to(socket.room).emit('user-left', { username: socket.username, room: socket.room });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
