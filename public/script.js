// Global variable for current user
let currentUser = null;
let socket = null;

// Check if on login page
if (document.getElementById('login-form')) {
  // Form toggle
  document.getElementById('login-toggle').addEventListener('click', () => {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-toggle').classList.add('active');
    document.getElementById('register-toggle').classList.remove('active');
  });

  document.getElementById('register-toggle').addEventListener('click', () => {
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-toggle').classList.add('active');
    document.getElementById('login-toggle').classList.remove('active');
  });

  // Login form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (response.ok) {
      currentUser = username;
      localStorage.setItem('currentUser', username);
      window.location.href = '/chat';
    } else {
      document.getElementById('message').textContent = data.error;
    }
  });

  // Register form
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;

    const response = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (response.ok) {
      document.getElementById('message').textContent = 'Registration successful! Please login.';
      document.getElementById('login-toggle').click();
    } else {
      document.getElementById('message').textContent = data.error;
    }
  });
}

// Check if on chat page
if (document.getElementById('chat-messages')) {
  currentUser = localStorage.getItem('currentUser');
  if (!currentUser) {
    window.location.href = '/';
  }

  let currentRoom = 'general';

  // Set user info
  loadUserProfile();
  document.getElementById('user-name').textContent = currentUser;

  // Initialize Socket.IO
  socket = io();

  // Join initial room
  socket.emit('join-room', { username: currentUser, room: currentRoom });

  // Load rooms
  async function loadRooms() {
    const response = await fetch('/rooms');
    const rooms = await response.json();
    const roomsList = document.getElementById('rooms-list');
    roomsList.innerHTML = '';
    rooms.forEach(room => {
      const roomDiv = document.createElement('div');
      roomDiv.className = `room-item ${room.id === currentRoom ? 'active' : ''}`;
      let callInfo = '';
      if (room.callActive && room.callParticipants.length > 0) {
        callInfo = `<div class="call-info">📞 ${room.callParticipants.join(', ')}</div>`;
      }
      roomDiv.innerHTML = `<h4>${room.name}</h4><p>Click to join</p>${callInfo}`;
      roomDiv.addEventListener('click', () => switchRoom(room.id, room.name));
      roomsList.appendChild(roomDiv);
    });
  }

  // Load messages for current room
  async function loadMessages() {
    const response = await fetch(`/messages?room=${currentRoom}`);
    const messages = await response.json();
    const chatMessages = document.getElementById('chat-messages');
    const existingMessages = chatMessages.children.length;

    // Only update if there are new messages
    if (messages.length !== existingMessages) {
      chatMessages.innerHTML = '';
      messages.forEach(msg => {
        addMessageToUI(msg);
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  // Update online users count
  async function updateOnlineCount() {
    const response = await fetch('/online-users');
    const data = await response.json();
    document.getElementById('online-count').textContent = `${data.count} online`;
  }

  // Add message to UI
  function addMessageToUI(msg) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${msg.username === currentUser ? 'own' : 'other'}`;
    messageDiv.setAttribute('data-message-id', msg.id || Date.now()); // Add message ID for actions
    const time = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    let content = `<strong>${msg.username}:</strong> `;
    if (msg.type === 'file') {
      // Check if it's an image for preview
      if (msg.mimetype && msg.mimetype.startsWith('image/')) {
        content += `<div class="file-preview">
          <img src="${msg.file}" alt="${msg.filename}" class="image-preview" onclick="openImageModal('${msg.file}', '${msg.filename}')">
          <a href="${msg.file}" download="${msg.filename}" class="download-link">📥 Download ${msg.filename}</a>
        </div>`;
      } else {
        content += `<a href="${msg.file}" download="${msg.filename}" class="download-link">📥 Download ${msg.filename}</a>`;
      }
    } else if (msg.pollId) {
      // Handle poll display
      content += `<div class="poll-display" data-poll-id="${msg.pollId}">Loading poll...</div>`;
    } else {
      content += msg.message;
    }
    content += `<div class="message-time">${time}</div>`;

    // Add message actions if user owns the message
    if (msg.username === currentUser) {
      content += `
        <div class="message-actions">
          <button class="action-btn reply-btn" title="Reply">↩️</button>
          <button class="action-btn copy-btn" title="Copy">📋</button>
          <button class="action-btn edit-btn" title="Edit">✏️</button>
        </div>
      `;
    }

    messageDiv.innerHTML = content;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Load poll if present
    if (msg.pollId) {
      loadPoll(msg.pollId, messageDiv.querySelector('.poll-display'));
    }

    // Add event listeners for message actions
    if (msg.username === currentUser) {
      const replyBtn = messageDiv.querySelector('.reply-btn');
      const copyBtn = messageDiv.querySelector('.copy-btn');
      const editBtn = messageDiv.querySelector('.edit-btn');

      replyBtn.addEventListener('click', () => replyToMessage(msg));
      copyBtn.addEventListener('click', () => copyMessage(msg));
      editBtn.addEventListener('click', () => editMessage(msg, messageDiv));
    }
  }

  // Load and display poll
  async function loadPoll(pollId, container) {
    const response = await fetch(`/polls/${currentRoom}`);
    const polls = await response.json();
    const poll = polls.find(p => p.id === pollId);
    if (poll) {
      container.innerHTML = `
        <div class="poll-question">${poll.question}</div>
        <div class="poll-options">
          ${poll.options.map((opt, index) => `
            <div class="poll-option" onclick="votePoll('${pollId}', ${index})">
              <span>${opt.text}</span>
              <span class="vote-count">${opt.votes.length} votes</span>
            </div>
          `).join('')}
        </div>
      `;
    }
  }

  // Vote on poll
  async function votePoll(pollId, optionIndex) {
    await fetch('/vote-poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollId, optionIndex, username: currentUser })
    });
    loadMessages(); // Refresh to show updated votes
  }

  // Switch room
  function switchRoom(roomId, roomName) {
    currentRoom = roomId;
    document.getElementById('room-name').textContent = roomName;
    document.querySelectorAll('.room-item').forEach(item => item.classList.remove('active'));
    event.target.closest('.room-item').classList.add('active');
    loadMessages();

    // Join new room via socket
    socket.emit('join-room', { username: currentUser, room: currentRoom });
  }

  loadRooms();
  loadMessages();
  updateOnlineCount();
  setInterval(loadMessages, 1000); // Poll every 1 second for instant updates
  setInterval(updateOnlineCount, 5000); // Update online count every 5 seconds

  // Send message
  document.getElementById('message-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('message-input').value.trim();
    if (message) {
      const response = await fetch('/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, message, room: currentRoom })
      });
      if (response.ok) {
        document.getElementById('message-input').value = '';
        loadMessages(); // Immediately update messages
      }
    }
  });

  // Emoji picker
  document.getElementById('emoji-btn').addEventListener('click', openEmojiModal);

  function openEmojiModal() {
    document.getElementById('emoji-modal').style.display = 'flex';
  }

  function closeEmojiModal() {
    document.getElementById('emoji-modal').style.display = 'none';
  }

  document.getElementById('emoji-list').addEventListener('click', (e) => {
    if (e.target.classList.contains('emoji')) {
      const emoji = e.target.textContent;
      document.getElementById('message-input').value += emoji;
      closeEmojiModal();
    }
  });

  // File upload
  document.getElementById('file-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,audio/*,application/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('username', currentUser);
        formData.append('room', currentRoom);

        const response = await fetch('/upload-file', {
          method: 'POST',
          body: formData
        });
        if (response.ok) {
          loadMessages();
        } else {
          alert('Failed to upload file');
        }
      }
    };
    input.click();
  });

  // Poll creation
  document.getElementById('poll-btn').addEventListener('click', openPollModal);

  function openPollModal() {
    document.getElementById('poll-modal').style.display = 'flex';
  }

  function closePollModal() {
    document.getElementById('poll-modal').style.display = 'none';
  }

  document.getElementById('add-option-btn').addEventListener('click', () => {
    const optionsDiv = document.getElementById('poll-options');
    const optionCount = optionsDiv.querySelectorAll('.poll-option').length + 1;
    const container = document.createElement('div');
    container.className = 'poll-option-container';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'poll-option';
    input.placeholder = `Option ${optionCount}`;
    input.required = true;
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-option-btn';
    deleteBtn.textContent = '❌';
    deleteBtn.addEventListener('click', () => {
      container.remove();
      updateDeleteButtons();
    });
    container.appendChild(input);
    container.appendChild(deleteBtn);
    optionsDiv.appendChild(container);
    updateDeleteButtons();
  });

  function updateDeleteButtons() {
    const containers = document.querySelectorAll('.poll-option-container');
    containers.forEach((container, index) => {
      const deleteBtn = container.querySelector('.delete-option-btn');
      if (containers.length > 2) {
        deleteBtn.style.display = 'inline-block';
      } else {
        deleteBtn.style.display = 'none';
      }
    });
  }

  document.getElementById('poll-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = document.getElementById('poll-question').value;
    const options = Array.from(document.querySelectorAll('.poll-option')).map(input => input.value).filter(val => val.trim());

    if (options.length < 2) {
      alert('Please provide at least 2 options');
      return;
    }

    const response = await fetch('/create-poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, options, room: currentRoom, creator: currentUser })
    });

    if (response.ok) {
      closePollModal();
      loadMessages();
    } else {
      alert('Failed to create poll');
    }
  });

  // Call buttons - enhanced with controls
  let currentStream = null;
  let isMuted = false;
  let isVideoOn = true;

  document.getElementById('voice-call-btn').addEventListener('click', async () => {
    await startCall(false);
  });

  document.getElementById('video-call-btn').addEventListener('click', async () => {
    await startCall(true);
  });

  async function startCall(isVideo = false) {
    try {
      const constraints = { audio: true, video: isVideo };
      currentStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Notify server about starting call
      socket.emit('start-call', { username: currentUser, room: currentRoom, isVideo: isVideo });

      // Create call UI
      const callContainer = document.createElement('div');
      callContainer.id = 'call-container';
      callContainer.innerHTML = `
        <div class="call-overlay">
          <div class="call-info">
            <h3>${isVideo ? 'Video' : 'Voice'} Call</h3>
            <p>Connected</p>
            <div id="call-participants">Participants: ${currentUser}</div>
          </div>
          <div class="call-video" id="call-video"></div>
          <div class="call-controls">
            <button id="mute-btn" class="control-btn">🔇 Mute</button>
            ${isVideo ? '<button id="video-toggle-btn" class="control-btn">📹 Video Off</button>' : ''}
            <button id="end-call-btn" class="control-btn end-call">📞 End Call</button>
          </div>
        </div>
      `;
      document.body.appendChild(callContainer);

      if (isVideo) {
        const video = document.createElement('video');
        video.srcObject = currentStream;
        video.autoplay = true;
        video.muted = true; // Mute to avoid feedback
        video.style.width = '100%';
        video.style.maxWidth = '400px';
        video.style.borderRadius = '10px';
        document.getElementById('call-video').appendChild(video);
      } else {
        // For voice call, add audio element with low volume to allow local audio monitoring
        const audio = document.createElement('audio');
        audio.srcObject = currentStream;
        audio.autoplay = true;
        audio.volume = 0.1; // Low volume to avoid feedback but allow monitoring
        document.getElementById('call-video').appendChild(audio);
      }

      // Controls
      document.getElementById('mute-btn').addEventListener('click', toggleMute);
      if (isVideo) {
        document.getElementById('video-toggle-btn').addEventListener('click', toggleVideo);
      }
      document.getElementById('end-call-btn').addEventListener('click', () => {
        endCall();
        socket.emit('end-call', { username: currentUser, room: currentRoom });
      });

    } catch (err) {
      alert('Could not access media: ' + err.message);
    }
  }

  function toggleMute() {
    if (currentStream) {
      const audioTracks = currentStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      isMuted = !isMuted;
      const muteBtn = document.getElementById('mute-btn');
      muteBtn.textContent = isMuted ? '🔊 Unmute' : '🔇 Mute';
      muteBtn.classList.toggle('muted', isMuted);
    }
  }

  function toggleVideo() {
    if (currentStream) {
      const videoTracks = currentStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      isVideoOn = !isVideoOn;
      const videoBtn = document.getElementById('video-toggle-btn');
      videoBtn.textContent = isVideoOn ? '📹 Video Off' : '📷 Video On';
      const videoEl = document.querySelector('#call-video video');
      if (videoEl) {
        videoEl.style.opacity = isVideoOn ? '1' : '0.3';
      }
    }
  }

  function endCall() {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }
    const callContainer = document.getElementById('call-container');
    if (callContainer) {
      callContainer.remove();
    }
    isMuted = false;
    isVideoOn = true;
  }

  // Socket event listeners
  socket.on('call-started', (data) => {
    const { initiator, room, isVideo, participants } = data;
    if (room === currentRoom && initiator !== currentUser) {
      // Show notification that a call has started
      showCallNotification(initiator, isVideo, participants);
    }
  });

  socket.on('call-updated', (data) => {
    const { room, participants } = data;
    if (room === currentRoom) {
      updateCallParticipants(participants);
    }
  });

  socket.on('call-ended', (data) => {
    const { room } = data;
    if (room === currentRoom) {
      // Hide call notification if shown
      hideCallNotification();
    }
  });

  function showCallNotification(initiator, isVideo, participants) {
    // Remove existing notification
    hideCallNotification();

    const notification = document.createElement('div');
    notification.id = 'call-notification';
    notification.innerHTML = `
      <div class="call-notification-content">
        <p>${initiator} started a ${isVideo ? 'video' : 'voice'} call</p>
        <p>Participants: ${participants.join(', ')}</p>
        <button id="join-call-btn" class="join-call-btn">Join Call</button>
      </div>
    `;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #0088cc;
      color: white;
      padding: 15px;
      border-radius: 10px;
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      z-index: 1001;
    `;
    document.body.appendChild(notification);

    document.getElementById('join-call-btn').addEventListener('click', () => {
      socket.emit('join-call', { username: currentUser, room: currentRoom });
      startCall(isVideo);
      hideCallNotification();
    });
  }

  function hideCallNotification() {
    const notification = document.getElementById('call-notification');
    if (notification) {
      notification.remove();
    }
  }

  function updateCallParticipants(participants) {
    const participantsDiv = document.getElementById('call-participants');
    if (participantsDiv) {
      participantsDiv.textContent = `Participants: ${participants.join(', ')}`;
    }
  }

  // Load user profile
  async function loadUserProfile() {
    const response = await fetch(`/user-profile/${currentUser}`);
    const profile = await response.json();
    const avatar = document.getElementById('user-avatar');
    if (profile.avatar) {
      avatar.style.backgroundImage = `url(${profile.avatar})`;
      avatar.style.backgroundSize = 'cover';
      avatar.textContent = '';
    } else {
      avatar.textContent = currentUser.charAt(0).toUpperCase();
      avatar.style.backgroundImage = '';
    }
    document.getElementById('user-name').textContent = profile.displayName || currentUser;
  }

  // Profile modal functions
  function openProfileModal() {
    document.getElementById('profile-modal').style.display = 'flex';
    // Load current profile data
    fetch(`/user-profile/${currentUser}`)
      .then(response => response.json())
      .then(profile => {
        document.getElementById('username').value = currentUser;
        document.getElementById('display-name').value = profile.displayName || currentUser;
      });
  }

  function closeProfileModal() {
    document.getElementById('profile-modal').style.display = 'none';
  }

  // Profile form submission
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newUsername = document.getElementById('username').value;
    const displayName = document.getElementById('display-name').value;
    const avatarFile = document.getElementById('avatar-upload').files[0];

    // Change username if different
    if (newUsername !== currentUser) {
      const changeResponse = await fetch('/change-username', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldUsername: currentUser, newUsername })
      });
      if (changeResponse.ok) {
        currentUser = newUsername;
        localStorage.setItem('currentUser', newUsername);
        document.getElementById('user-name').textContent = newUsername;
      } else {
        const error = await changeResponse.json();
        alert('Failed to change username: ' + error.error);
        return;
      }
    }

    // Update profile
    const formData = new FormData();
    formData.append('displayName', displayName);
    if (avatarFile) {
      formData.append('avatar', avatarFile);
    }

    const response = await fetch(`/user-profile/${currentUser}`, {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      closeProfileModal();
      loadUserProfile();
    } else {
      alert('Failed to update profile');
    }
  });

  // Hamburger menu toggle
  document.getElementById('hamburger-btn').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
  });

  // Create chat modal functions
  function openCreateChatModal() {
    document.getElementById('create-chat-modal').style.display = 'flex';
  }

  function closeCreateChatModal() {
    document.getElementById('create-chat-modal').style.display = 'none';
  }

  // Create chat form submission
  document.getElementById('create-chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const chatType = document.getElementById('chat-type').value;
    const chatName = document.getElementById('chat-name').value;
    const targetUser = document.getElementById('target-user').value;

    if (chatType === 'private') {
      if (!targetUser) {
        alert('Please enter a target user for private chat');
        return;
      }
      const response = await fetch('/create-private-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, targetUser })
      });
      const data = await response.json();
      if (response.ok) {
        closeCreateChatModal();
        loadUserChats();
        switchRoom(data.roomId, `Chat with ${targetUser}`);
      } else {
        alert('Failed to create private chat: ' + data.error);
      }
    } else {
      const response = await fetch('/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: chatName, type: 'group', creator: currentUser })
      });
      const data = await response.json();
      if (response.ok) {
        closeCreateChatModal();
        loadRooms();
        switchRoom(data.roomId, chatName);
      } else {
        alert('Failed to create channel: ' + data.error);
      }
    }
  });

  // Chat type change handler
  document.getElementById('chat-type').addEventListener('change', (e) => {
    const targetUserLabel = document.getElementById('target-user-label');
    const targetUserInput = document.getElementById('target-user');
    if (e.target.value === 'private') {
      targetUserLabel.style.display = 'block';
      targetUserInput.style.display = 'block';
      targetUserInput.required = true;
    } else {
      targetUserLabel.style.display = 'none';
      targetUserInput.style.display = 'none';
      targetUserInput.required = false;
    }
  });

  // Load user chats
  async function loadUserChats() {
    const response = await fetch(`/user-chats?username=${currentUser}`);
    const chats = await response.json();
    // Add user chats to rooms list
    const roomsList = document.getElementById('rooms-list');
    chats.forEach(chat => {
      const existingRoom = roomsList.querySelector(`[data-room-id="${chat.id}"]`);
      if (!existingRoom) {
        const roomDiv = document.createElement('div');
        roomDiv.className = 'room-item';
        roomDiv.setAttribute('data-room-id', chat.id);
        roomDiv.innerHTML = `<h4>${chat.name}</h4><p>${chat.lastMessage ? chat.lastMessage.message : 'No messages'}</p>`;
        roomDiv.addEventListener('click', () => switchRoom(chat.id, chat.name));
        roomsList.appendChild(roomDiv);
      }
    });
  }

  // Event listeners for new buttons
  document.getElementById('create-chat-btn').addEventListener('click', openCreateChatModal);
  document.getElementById('create-channel-btn').addEventListener('click', () => {
    openCreateChatModal();
    document.getElementById('chat-type').value = 'channel';
    document.getElementById('chat-type').dispatchEvent(new Event('change'));
  });

  // Load user chats on page load
  loadUserChats();

  // Message action functions
  function replyToMessage(msg) {
    const input = document.getElementById('message-input');
    const replyText = `@${msg.username}: `;
    input.value = replyText;
    input.focus();
    input.setSelectionRange(replyText.length, replyText.length);
  }

  function copyMessage(msg) {
    let textToCopy = msg.message;
    if (msg.type === 'file') {
      textToCopy = msg.filename || 'File';
    }
    navigator.clipboard.writeText(textToCopy).then(() => {
      // Show temporary feedback
      const notification = document.createElement('div');
      notification.textContent = 'Message copied!';
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #4CAF50;
        color: white;
        padding: 10px 20px;
        border-radius: 5px;
        z-index: 1000;
      `;
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 2000);
    });
  }

  function editMessage(msg, messageDiv) {
    const originalContent = msg.message;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalContent;
    input.className = 'edit-input';
    input.style.cssText = `
      width: 100%;
      padding: 5px;
      border: 1px solid #ccc;
      border-radius: 3px;
      margin: 5px 0;
    `;

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'save-edit-btn';
    saveBtn.style.cssText = `
      margin-left: 5px;
      padding: 5px 10px;
      background: #0088cc;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'cancel-edit-btn';
    cancelBtn.style.cssText = `
      margin-left: 5px;
      padding: 5px 10px;
      background: #ccc;
      color: black;
      border: none;
      border-radius: 3px;
      cursor: pointer;
    `;

    // Replace message content with edit form
    const contentDiv = messageDiv.querySelector('strong').parentElement;
    const originalHTML = contentDiv.innerHTML;
    contentDiv.innerHTML = '';
    contentDiv.appendChild(input);
    contentDiv.appendChild(saveBtn);
    contentDiv.appendChild(cancelBtn);

    input.focus();
    input.select();

    saveBtn.addEventListener('click', async () => {
      const newMessage = input.value.trim();
      if (newMessage && newMessage !== originalContent) {
        const response = await fetch('/edit-message', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: msg.id, newMessage, room: currentRoom })
        });
        if (response.ok) {
          loadMessages();
        } else {
          alert('Failed to edit message');
        }
      } else {
        contentDiv.innerHTML = originalHTML;
      }
    });

    cancelBtn.addEventListener('click', () => {
      contentDiv.innerHTML = originalHTML;
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveBtn.click();
      } else if (e.key === 'Escape') {
        cancelBtn.click();
      }
    });
  }

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('currentUser');
    window.location.href = '/';
  });

  // Image modal functions
  function openImageModal(src, filename) {
    const modal = document.createElement('div');
    modal.id = 'image-modal';
    modal.innerHTML = `
      <div class="image-modal-content">
        <span class="close-modal" onclick="closeImageModal()">&times;</span>
        <img src="${src}" alt="${filename}" class="modal-image">
        <div class="modal-caption">${filename}</div>
      </div>
    `;
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 2000;
    `;
    document.body.appendChild(modal);
  }

  function closeImageModal() {
    const modal = document.getElementById('image-modal');
    if (modal) {
      modal.remove();
    }
  }
}
