/**
 * TraiincBot — Embeddable Chat Widget
 * 
 * Usage: <script src="https://your-worker.workers.dev/widget.js"></script>
 * Auto-detects API URL from its own script src. Zero configuration.
 */
(function () {
  'use strict';

  // --- Configuration ---
  const RECONNECT_BASE = 1000;
  const RECONNECT_MAX = 30000;
  const SESSION_KEY = 'traiinc_session_id';
  const NAME_KEY = 'traiinc_customer_name';

  // Auto-detect API URL from script src
  const scriptEl = document.currentScript;
  const API_BASE = scriptEl
    ? new URL(scriptEl.src).origin
    : window.location.origin;

  // --- State ---
  let ws = null;
  let reconnectAttempts = 0;
  let sessionId = localStorage.getItem(SESSION_KEY);
  let customerName = localStorage.getItem(NAME_KEY) || '';
  let isOpen = false;
  let isConnected = false;
  let typingTimeout = null;

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  // --- Styles ---
  const styles = document.createElement('style');
  styles.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

    #traiinc-widget * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }

    #traiinc-bubble {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      box-shadow: 0 4px 24px rgba(99, 102, 241, 0.4);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s ease, box-shadow 0.3s ease;
      z-index: 999999;
    }

    #traiinc-bubble:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 32px rgba(99, 102, 241, 0.5);
    }

    #traiinc-bubble svg {
      width: 28px;
      height: 28px;
      fill: white;
    }

    #traiinc-bubble .traiinc-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 18px;
      height: 18px;
      background: #ef4444;
      border-radius: 50%;
      border: 2px solid white;
      display: none;
      animation: traiinc-pulse 2s infinite;
    }

    @keyframes traiinc-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.2); }
    }

    #traiinc-window {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 380px;
      height: 520px;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 8px 48px rgba(0, 0, 0, 0.15);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 999999;
      animation: traiinc-slide-up 0.3s ease;
    }

    @keyframes traiinc-slide-up {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Mobile responsive — full screen */
    @media (max-width: 480px) {
      #traiinc-window {
        bottom: 0;
        right: 0;
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        border-radius: 0;
      }
      #traiinc-bubble {
        bottom: 16px;
        right: 16px;
      }
    }

    #traiinc-window.traiinc-visible {
      display: flex;
    }

    .traiinc-header {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .traiinc-header-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .traiinc-header-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }

    .traiinc-header-text h3 {
      font-size: 15px;
      font-weight: 600;
    }

    .traiinc-header-text p {
      font-size: 12px;
      opacity: 0.85;
    }

    .traiinc-close {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      padding: 4px;
      border-radius: 8px;
      transition: background 0.2s;
    }

    .traiinc-close:hover {
      background: rgba(255,255,255,0.15);
    }

    .traiinc-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: #f8fafc;
    }

    .traiinc-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      animation: traiinc-fade-in 0.2s ease;
    }

    @keyframes traiinc-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .traiinc-msg.customer {
      align-self: flex-end;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      border-bottom-right-radius: 4px;
    }

    .traiinc-msg.ai,
    .traiinc-msg.bot {
      align-self: flex-start;
      background: white;
      color: #1e293b;
      border: 1px solid #e2e8f0;
      border-bottom-left-radius: 4px;
    }

    .traiinc-msg.owner {
      align-self: flex-start;
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #a7f3d0;
      border-bottom-left-radius: 4px;
    }

    .traiinc-msg-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
      opacity: 0.7;
    }

    .traiinc-typing {
      align-self: flex-start;
      padding: 12px 16px;
      display: none;
    }

    .traiinc-typing.visible {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    .traiinc-typing span {
      width: 8px;
      height: 8px;
      background: #94a3b8;
      border-radius: 50%;
      animation: traiinc-bounce 1.4s infinite ease-in-out;
    }

    .traiinc-typing span:nth-child(1) { animation-delay: 0s; }
    .traiinc-typing span:nth-child(2) { animation-delay: 0.2s; }
    .traiinc-typing span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes traiinc-bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    .traiinc-input-area {
      padding: 12px 16px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      gap: 8px;
      align-items: center;
      background: white;
      flex-shrink: 0;
    }

    .traiinc-input-area input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid #e2e8f0;
      border-radius: 24px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }

    .traiinc-input-area input:focus {
      border-color: #6366f1;
    }

    .traiinc-send-btn {
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, opacity 0.2s;
      flex-shrink: 0;
    }

    .traiinc-send-btn:hover {
      transform: scale(1.05);
    }

    .traiinc-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .traiinc-footer {
      text-align: center;
      padding: 6px;
      font-size: 11px;
      color: #94a3b8;
      background: white;
      border-top: 1px solid #f1f5f9;
      flex-shrink: 0;
    }

    /* Name prompt overlay */
    .traiinc-name-prompt {
      position: absolute;
      inset: 0;
      background: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px;
      gap: 16px;
      z-index: 10;
    }

    .traiinc-name-prompt h3 {
      font-size: 18px;
      color: #1e293b;
    }

    .traiinc-name-prompt p {
      font-size: 14px;
      color: #64748b;
      text-align: center;
    }

    .traiinc-name-prompt input {
      width: 100%;
      max-width: 260px;
      padding: 12px 16px;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
    }

    .traiinc-name-prompt input:focus {
      border-color: #6366f1;
    }

    .traiinc-name-prompt button {
      padding: 12px 32px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      transition: transform 0.2s;
    }

    .traiinc-name-prompt button:hover {
      transform: scale(1.05);
    }

    .traiinc-name-skip {
      background: none !important;
      color: #94a3b8 !important;
      font-size: 13px !important;
      padding: 8px !important;
    }
  `;
  document.head.appendChild(styles);

  // --- Build DOM ---
  const container = document.createElement('div');
  container.id = 'traiinc-widget';
  container.innerHTML = `
    <div id="traiinc-bubble">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
      <div class="traiinc-badge"></div>
    </div>
    <div id="traiinc-window">
      <div class="traiinc-header">
        <div class="traiinc-header-info">
          <div class="traiinc-header-avatar">💬</div>
          <div class="traiinc-header-text">
            <h3>Chat with us</h3>
            <p id="traiinc-status">Connecting...</p>
          </div>
        </div>
        <button class="traiinc-close" aria-label="Close chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="traiinc-messages" id="traiinc-messages"></div>
      <div class="traiinc-typing" id="traiinc-typing">
        <span></span><span></span><span></span>
      </div>
      <div class="traiinc-input-area">
        <input type="text" id="traiinc-input" placeholder="Type a message..." autocomplete="off" />
        <button class="traiinc-send-btn" id="traiinc-send" aria-label="Send message">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
      <div class="traiinc-footer">Powered by AI · Our team is also notified</div>
    </div>
  `;
  document.body.appendChild(container);

  // --- DOM refs ---
  const bubble = document.getElementById('traiinc-bubble');
  const chatWindow = document.getElementById('traiinc-window');
  const messagesEl = document.getElementById('traiinc-messages');
  const inputEl = document.getElementById('traiinc-input');
  const sendBtn = document.getElementById('traiinc-send');
  const statusEl = document.getElementById('traiinc-status');
  const typingEl = document.getElementById('traiinc-typing');
  const badge = bubble.querySelector('.traiinc-badge');

  // --- Name prompt (shown on first open if no name stored) ---
  function showNamePrompt() {
    if (customerName) {
      connectWebSocket();
      return;
    }

    const prompt = document.createElement('div');
    prompt.className = 'traiinc-name-prompt';
    prompt.innerHTML = `
      <h3>👋 Welcome!</h3>
      <p>Before we start, what's your name?</p>
      <input type="text" id="traiinc-name-input" placeholder="Your name" autocomplete="name" />
      <button id="traiinc-name-submit">Start Chat</button>
      <button class="traiinc-name-skip" id="traiinc-name-skip">Continue as Guest</button>
    `;
    chatWindow.appendChild(prompt);

    const nameInput = document.getElementById('traiinc-name-input');
    const submitBtn = document.getElementById('traiinc-name-submit');
    const skipBtn = document.getElementById('traiinc-name-skip');

    nameInput.focus();

    function submit() {
      const name = nameInput.value.trim() || 'Guest';
      customerName = name;
      localStorage.setItem(NAME_KEY, name);
      prompt.remove();
      connectWebSocket();
    }

    submitBtn.addEventListener('click', submit);
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submit();
    });
    skipBtn.addEventListener('click', function () {
      customerName = 'Guest';
      localStorage.setItem(NAME_KEY, 'Guest');
      prompt.remove();
      connectWebSocket();
    });
  }

  // --- Toggle chat window ---
  bubble.addEventListener('click', function () {
    isOpen = !isOpen;
    if (isOpen) {
      chatWindow.classList.add('traiinc-visible');
      bubble.style.display = 'none';
      badge.style.display = 'none';
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        showNamePrompt();
      }
      inputEl.focus();
    } else {
      chatWindow.classList.remove('traiinc-visible');
      bubble.style.display = 'flex';
    }
  });

  document.querySelector('.traiinc-close').addEventListener('click', function () {
    isOpen = false;
    chatWindow.classList.remove('traiinc-visible');
    bubble.style.display = 'flex';
  });

  // --- WebSocket Connection ---
  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = API_BASE.startsWith('https') ? 'wss' : 'ws';
    const host = API_BASE.replace(/^https?:\/\//, '');
    const wsUrl = `${protocol}://${host}/ws?sessionId=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(customerName)}`;

    ws = new WebSocket(wsUrl);
    statusEl.textContent = 'Connecting...';

    ws.onopen = function () {
      isConnected = true;
      reconnectAttempts = 0;
      statusEl.textContent = 'Online';

      // Send init message
      ws.send(JSON.stringify({
        type: 'init',
        sessionId: sessionId,
        customerName: customerName,
      }));
    };

    ws.onmessage = function (event) {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (data.type) {
        case 'connected':
          break;

        case 'history':
          // Clear existing messages and render history
          messagesEl.innerHTML = '';
          if (data.messages && data.messages.length > 0) {
            data.messages.forEach(function (msg) {
              appendMessage(msg.sender, msg.content, false);
            });
            scrollToBottom();
          }
          break;

        case 'message':
          // Don't re-render customer messages (we already showed them locally)
          if (data.sender !== 'customer') {
            appendMessage(data.sender, data.content, true);
            hideTyping();

            // Play sound if tab not focused
            if (document.hidden && isOpen) {
              playNotificationSound();
            }

            // Show badge if window is closed
            if (!isOpen) {
              badge.style.display = 'block';
            }
          }
          break;

        case 'typing':
          showTyping();
          break;

        case 'rate_limited':
          appendMessage('bot', data.message, true);
          break;

        case 'error':
          console.error('TraiincBot error:', data.message);
          break;
      }
    };

    ws.onclose = function () {
      isConnected = false;
      statusEl.textContent = 'Reconnecting...';
      scheduleReconnect();
    };

    ws.onerror = function () {
      isConnected = false;
    };
  }

  // --- Reconnect with exponential backoff ---
  function scheduleReconnect() {
    const delay = Math.min(
      RECONNECT_BASE * Math.pow(2, reconnectAttempts),
      RECONNECT_MAX
    );
    reconnectAttempts++;
    setTimeout(connectWebSocket, delay);
  }

  // --- Send message ---
  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ type: 'message', text: text }));

    // Optimistically show the message locally
    appendMessage('customer', text, true);

    inputEl.value = '';
    inputEl.focus();
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // --- Render message ---
  function appendMessage(sender, content, animate) {
    const div = document.createElement('div');
    div.className = 'traiinc-msg ' + sender;

    const labels = {
      ai: '🤖 AI',
      owner: '👤 Team',
      bot: '⚙️ System',
    };

    let html = '';
    if (labels[sender]) {
      html += '<div class="traiinc-msg-badge">' + labels[sender] + '</div>';
    }
    html += '<div>' + escapeHtml(content) + '</div>';
    div.innerHTML = html;

    if (!animate) {
      div.style.animation = 'none';
    }

    messagesEl.appendChild(div);
    scrollToBottom();
  }

  // --- Typing indicator ---
  function showTyping() {
    typingEl.classList.add('visible');
    scrollToBottom();

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(hideTyping, 10000); // Auto-hide after 10s
  }

  function hideTyping() {
    typingEl.classList.remove('visible');
    clearTimeout(typingTimeout);
  }

  // --- Utilities ---
  function scrollToBottom() {
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Notification sound ---
  function playNotificationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.value = 0.1;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      // Audio not available
    }
  }
})();
