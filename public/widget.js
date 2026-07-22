/**
 * ZeroChat — Premium Embeddable Chat Widget
 * 
 * Usage: <script src="https://your-worker.workers.dev/widget.js"></script>
 */
(function () {
  'use strict';

  // --- Configuration ---
  const RECONNECT_BASE = 1000;
  const RECONNECT_MAX = 30000;
  const SESSION_KEY = 'zerochat_session_id';
  const NAME_KEY = 'zerochat_customer_name';

  // Auto-detect API URL
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
  let hasHistory = false;

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  // --- Styles (Vibrant Dark Theme) ---
  const styles = document.createElement('style');
  styles.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');

    #zerochat-widget * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: 'Outfit', sans-serif;
    }

    :root {
      --zc-bg: #09090b;
      --zc-panel: #18181b;
      --zc-panel-hover: #27272a;
      --zc-text: #f4f4f5;
      --zc-text-dim: #a1a1aa;
      --zc-accent-1: #c026d3; /* Fuchsia */
      --zc-accent-2: #7c3aed; /* Violet */
      --zc-border: rgba(255, 255, 255, 0.1);
      --zc-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
    }

    #zerochat-bubble {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--zc-accent-1), var(--zc-accent-2));
      box-shadow: 0 8px 32px rgba(192, 38, 211, 0.4);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease;
      z-index: 999999;
    }

    #zerochat-bubble:hover {
      transform: scale(1.08);
      box-shadow: 0 12px 40px rgba(192, 38, 211, 0.6);
    }

    #zerochat-bubble svg {
      width: 32px;
      height: 32px;
      fill: white;
    }

    .zerochat-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 18px;
      height: 18px;
      background: #ef4444;
      border-radius: 50%;
      border: 2px solid var(--zc-bg);
      display: none;
      animation: zerochat-pulse 2s infinite;
    }

    @keyframes zerochat-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.2); }
    }

    #zerochat-window, #zerochat-window * {
      box-sizing: border-box;
    }
    
    #zerochat-window {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 400px;
      height: 700px;
      max-height: calc(100vh - 48px);
      background: var(--zc-bg);
      border-radius: 24px;
      border: 1px solid var(--zc-border);
      box-shadow: var(--zc-shadow);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 2147483647;
      color: var(--zc-text);
      /* Glassmorphism */
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      background: rgba(9, 9, 11, 0.85);
    }

    @media (max-width: 480px) {
      #zerochat-window {
        bottom: 0;
        right: 0;
        width: 100vw;
        height: 100vh;
        max-height: 100vh;
        border-radius: 0;
        border: none;
      }
      #zerochat-bubble {
        bottom: 16px;
        right: 16px;
      }
    }

    .zerochat-visible {
      display: flex !important;
      animation: zerochat-slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes zerochat-slide-up {
      from { opacity: 0; transform: translateY(20px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .zerochat-header {
      padding: 20px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--zc-border);
      background: rgba(255,255,255,0.02);
    }

    .zerochat-header-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .zerochat-header-avatar {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--zc-accent-1), var(--zc-accent-2));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 12px rgba(192, 38, 211, 0.3);
    }

    .zerochat-header-text h3 {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 2px 0;
    }

    .zerochat-header-text p {
      font-size: 12px;
      color: var(--zc-text-dim);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .zerochat-status-dot {
      width: 6px;
      height: 6px;
      background: #10b981;
      border-radius: 50%;
      display: inline-block;
    }

    .zerochat-close {
      background: rgba(255,255,255,0.05);
      border: none;
      cursor: pointer;
      color: var(--zc-text-dim);
      padding: 8px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .zerochat-close:hover {
      background: rgba(255,255,255,0.1);
      color: white;
    }

    /* --- Views --- */
    .zerochat-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .zerochat-hidden {
      display: none !important;
    }

    /* --- Home View --- */
    .zerochat-home {
      flex: 1;
      overflow-y: auto;
      padding: 32px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .zerochat-mascot {
      width: 100px;
      height: 100px;
      margin-bottom: 24px;
      background: linear-gradient(135deg, rgba(192, 38, 211, 0.2), rgba(124, 58, 237, 0.2));
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
      box-shadow: 0 0 40px rgba(192, 38, 211, 0.2);
      animation: float 4s ease-in-out infinite;
    }

    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }

    .zerochat-home h2 {
      font-size: 24px;
      font-weight: 700;
      text-align: center;
      margin-bottom: 8px;
      background: linear-gradient(to right, #fff, #a1a1aa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .zerochat-home p {
      color: var(--zc-text-dim);
      text-align: center;
      font-size: 14px;
      margin-bottom: 32px;
      line-height: 1.5;
    }

    .zerochat-suggestions {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .zerochat-suggestion-card {
      background: var(--zc-panel);
      border: 1px solid var(--zc-border);
      padding: 16px;
      border-radius: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: all 0.2s;
    }

    .zerochat-suggestion-card:hover {
      background: var(--zc-panel-hover);
      border-color: rgba(192, 38, 211, 0.4);
      transform: translateY(-2px);
    }

    .zerochat-suggestion-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: rgba(192, 38, 211, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }

    .zerochat-suggestion-text h4 {
      font-size: 14px;
      font-weight: 600;
      color: var(--zc-text);
      margin-bottom: 2px;
    }

    .zerochat-suggestion-text p {
      font-size: 12px;
      color: var(--zc-text-dim);
      margin: 0;
      text-align: left;
    }

    /* --- Chat View --- */
    .zerochat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      scroll-behavior: smooth;
    }

    .zerochat-messages::-webkit-scrollbar {
      width: 6px;
    }
    .zerochat-messages::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.1);
      border-radius: 10px;
    }

    #zerochat-window .zerochat-msg {
      max-width: 85%;
      padding: 12px 18px;
      margin-bottom: 16px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      animation: zerochat-fade-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: inline-block;
    }

    @keyframes zerochat-fade-in {
      from { opacity: 0; transform: translateY(8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .zerochat-msg.customer {
      align-self: flex-end;
      background: linear-gradient(135deg, var(--zc-accent-1), var(--zc-accent-2));
      color: white;
      border-radius: 20px 20px 4px 20px;
      box-shadow: 0 4px 12px rgba(192, 38, 211, 0.2);
    }

    .zerochat-msg.ai,
    .zerochat-msg.bot {
      align-self: flex-start;
      background: var(--zc-panel);
      color: var(--zc-text);
      border: 1px solid var(--zc-border);
      border-radius: 20px 20px 20px 4px;
    }

    .zerochat-msg.owner {
      align-self: flex-start;
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.2);
      border-radius: 20px 20px 20px 4px;
    }

    .zerochat-msg-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
      opacity: 0.8;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* --- Typing Indicator --- */
    .zerochat-typing {
      align-self: flex-start;
      background: var(--zc-panel);
      border: 1px solid var(--zc-border);
      border-radius: 20px 20px 20px 4px;
      padding: 16px 20px;
      display: none;
      margin-top: auto;
      margin-bottom: 4px;
    }

    .zerochat-typing.visible {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }

    .zerochat-typing span {
      width: 6px;
      height: 6px;
      background: var(--zc-text-dim);
      border-radius: 50%;
      animation: zerochat-bounce 1.4s infinite cubic-bezier(0.4, 0, 0.2, 1);
    }

    .zerochat-typing span:nth-child(1) { animation-delay: 0s; }
    .zerochat-typing span:nth-child(2) { animation-delay: 0.2s; }
    .zerochat-typing span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes zerochat-bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
      40% { transform: translateY(-4px); opacity: 1; }
    }

    /* --- Input Area --- */
    .zerochat-input-area {
      padding: 16px 24px 20px;
      border-top: 1px solid var(--zc-border);
      display: flex;
      gap: 12px;
      align-items: center;
      background: rgba(255,255,255,0.01);
      flex-shrink: 0;
    }

    .zerochat-input-wrapper {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
    }

    .zerochat-input-area input {
      width: 100%;
      padding: 14px 20px;
      background: var(--zc-panel);
      border: 1px solid var(--zc-border);
      color: var(--zc-text);
      border-radius: 24px;
      font-size: 14px;
      outline: none;
      transition: all 0.2s;
    }

    .zerochat-input-area input::placeholder {
      color: #52525b;
    }

    .zerochat-input-area input:focus {
      border-color: rgba(192, 38, 211, 0.5);
      background: rgba(255,255,255,0.05);
      box-shadow: 0 0 0 4px rgba(192, 38, 211, 0.1);
    }

    .zerochat-send-btn {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--zc-accent-1), var(--zc-accent-2));
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
      flex-shrink: 0;
      box-shadow: 0 4px 12px rgba(192, 38, 211, 0.3);
    }

    .zerochat-send-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 16px rgba(192, 38, 211, 0.5);
    }

    .zerochat-footer {
      text-align: center;
      padding-bottom: 12px;
      font-size: 11px;
      color: #52525b;
      background: rgba(255,255,255,0.01);
    }

    /* --- Name Prompt Overlay --- */
    .zerochat-name-prompt {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(9, 9, 11, 0.95);
      backdrop-filter: blur(10px);
      z-index: 10;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px;
      text-align: center;
      border-radius: 24px;
    }

    .zerochat-name-prompt h3 {
      font-size: 24px;
      margin-bottom: 8px;
      color: white;
    }

    .zerochat-name-prompt p {
      color: var(--zc-text-dim);
      margin-bottom: 24px;
      font-size: 14px;
    }

    .zerochat-name-prompt input {
      width: 100%;
      padding: 14px 20px;
      background: var(--zc-panel);
      border: 1px solid var(--zc-border);
      border-radius: 16px;
      font-size: 15px;
      margin-bottom: 16px;
      color: white;
      outline: none;
      text-align: center;
    }

    .zerochat-name-prompt input:focus {
      border-color: var(--zc-accent-1);
    }

    .zerochat-name-prompt button {
      width: 100%;
      padding: 14px 32px;
      background: linear-gradient(135deg, var(--zc-accent-1), var(--zc-accent-2));
      color: white;
      border: none;
      border-radius: 16px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }

    .zerochat-name-prompt button:hover {
      transform: translateY(-2px);
    }

    .zerochat-name-skip {
      background: none !important;
      color: var(--zc-text-dim) !important;
      font-size: 13px !important;
      padding: 12px !important;
      margin-top: 8px;
    }
  `;
  document.head.appendChild(styles);

  // --- Build DOM ---
  const container = document.createElement('div');
  container.id = 'zerochat-widget';
  container.innerHTML = `
    <div id="zerochat-bubble">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
      <div class="zerochat-badge"></div>
    </div>
    <div id="zerochat-window">
      <div class="zerochat-header">
        <div class="zerochat-header-info">
          <div class="zerochat-header-avatar">🤖</div>
          <div class="zerochat-header-text">
            <h3>Traiinc AI</h3>
            <p><span class="zerochat-status-dot"></span> <span id="zerochat-status">Online</span></p>
          </div>
        </div>
        <button class="zerochat-close" aria-label="Close chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="zerochat-view zerochat-home" id="zerochat-home">
        <div class="zerochat-mascot">🤖</div>
        <h2>Hello, there!</h2>
        <p>How can I help you today? Choose a topic below or type your own question.</p>
        
        <div class="zerochat-suggestions">
          <div class="zerochat-suggestion-card" data-prompt="What are your special offers?">
            <div class="zerochat-suggestion-icon">🎁</div>
            <div class="zerochat-suggestion-text">
              <h4>Special Offers</h4>
              <p>See our latest deals</p>
            </div>
          </div>
          <div class="zerochat-suggestion-card" data-prompt="How do I get in touch with sales?">
            <div class="zerochat-suggestion-icon">🤝</div>
            <div class="zerochat-suggestion-text">
              <h4>Talk to Sales</h4>
              <p>Connect with our human team</p>
            </div>
          </div>
          <div class="zerochat-suggestion-card" data-prompt="Tell me about your services">
            <div class="zerochat-suggestion-icon">⚡</div>
            <div class="zerochat-suggestion-text">
              <h4>Our Services</h4>
              <p>Learn what we can do for you</p>
            </div>
          </div>
        </div>
      </div>

      <div class="zerochat-view zerochat-messages zerochat-hidden" id="zerochat-messages">
        <!-- Messages will appear here -->
        <div class="zerochat-typing" id="zerochat-typing">
          <span></span><span></span><span></span>
        </div>
      </div>

      <div class="zerochat-input-area">
        <div class="zerochat-input-wrapper">
          <input type="text" id="zerochat-input" placeholder="Type a message..." autocomplete="off" />
        </div>
        <button class="zerochat-send-btn" id="zerochat-send" aria-label="Send message">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
      <div class="zerochat-footer">Developed by Tushar Rai & <a href="https://traiinc.com" target="_blank" style="color: inherit; text-decoration: underline;">Trai inc</a></div>
    </div>
  `;
  document.body.appendChild(container);

  // --- DOM refs ---
  const bubble = document.getElementById('zerochat-bubble');
  const chatWindow = document.getElementById('zerochat-window');
  const homeView = document.getElementById('zerochat-home');
  const messagesEl = document.getElementById('zerochat-messages');
  const inputEl = document.getElementById('zerochat-input');
  const sendBtn = document.getElementById('zerochat-send');
  const statusEl = document.getElementById('zerochat-status');
  const typingEl = document.getElementById('zerochat-typing');
  const badge = bubble.querySelector('.zerochat-badge');

  // --- View Toggle Logic ---
  function showChatView() {
    homeView.classList.add('zerochat-hidden');
    messagesEl.classList.remove('zerochat-hidden');
  }

  // --- Suggestion Cards ---
  document.querySelectorAll('.zerochat-suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.getAttribute('data-prompt');
      if (prompt) {
        inputEl.value = prompt;
        sendMessage();
      }
    });
  });

  // --- Name prompt (shown on first open if no name stored) ---
  function showNamePrompt() {
    if (customerName) {
      connectWebSocket();
      return;
    }

    const prompt = document.createElement('div');
    prompt.className = 'zerochat-name-prompt';
    prompt.innerHTML = `
      <h3>👋 Welcome!</h3>
      <p>Before we start, what's your name?</p>
      <input type="text" id="zerochat-name-input" placeholder="Your name" autocomplete="name" />
      <button id="zerochat-name-submit">Start Chat</button>
      <button class="zerochat-name-skip" id="zerochat-name-skip">Continue as Guest</button>
    `;
    chatWindow.appendChild(prompt);

    const nameInput = document.getElementById('zerochat-name-input');
    const submitBtn = document.getElementById('zerochat-name-submit');
    const skipBtn = document.getElementById('zerochat-name-skip');

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
      chatWindow.classList.add('zerochat-visible');
      bubble.style.display = 'none';
      badge.style.display = 'none';
      
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        showNamePrompt();
      } else {
        if (hasHistory) showChatView();
      }
      inputEl.focus();
    } else {
      chatWindow.classList.remove('zerochat-visible');
      bubble.style.display = 'flex';
    }
  });

  document.querySelector('.zerochat-close').addEventListener('click', function () {
    isOpen = false;
    chatWindow.classList.remove('zerochat-visible');
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
    document.querySelector('.zerochat-status-dot').style.background = '#eab308'; // Yellow

    ws.onopen = function () {
      isConnected = true;
      reconnectAttempts = 0;
      statusEl.textContent = 'Online';
      document.querySelector('.zerochat-status-dot').style.background = '#10b981'; // Green

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
          messagesEl.innerHTML = `
            <div class="zerochat-typing" id="zerochat-typing">
              <span></span><span></span><span></span>
            </div>
          `;
          // Re-grab the typing element reference after innerHTML overwrite
          const newTypingEl = document.getElementById('zerochat-typing');
          
          if (data.messages && data.messages.length > 0) {
            hasHistory = true;
            if (isOpen) showChatView();

            data.messages.forEach(function (msg) {
              appendMessage(msg.sender, msg.content, false, newTypingEl);
            });
            scrollToBottom();
          }
          break;

        case 'message':
          // Skip echoed customer messages (we already show them optimistically)
          if (data.sender === 'customer') break;

          hasHistory = true;
          if (isOpen) showChatView();

          const msgTypingEl = document.getElementById('zerochat-typing');
          appendMessage(data.sender, data.content, true, msgTypingEl);
          hideTyping();

          // Play sound if chat window is closed OR tab is hidden
          if (!isOpen || document.hidden) {
            playNotificationSound();
          }

          // Show badge if window is closed
          if (!isOpen) {
            badge.style.display = 'block';
          }
          break;

        case 'typing':
          showTyping();
          break;

        case 'rate_limited': {
          const rlTypingEl = document.getElementById('zerochat-typing');
          appendMessage('bot', data.message, true, rlTypingEl);
          break;
        }

        case 'error':
          console.error('ZeroChat error:', data.message);
          // If conversation is closed, reset session so user can start fresh
          if (data.message && data.message.includes('ended')) {
            localStorage.removeItem(SESSION_KEY);
            sessionId = crypto.randomUUID();
            localStorage.setItem(SESSION_KEY, sessionId);
          }
          break;
      }
    };

    ws.onclose = function () {
      isConnected = false;
      statusEl.textContent = 'Reconnecting...';
      document.querySelector('.zerochat-status-dot').style.background = '#ef4444'; // Red
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

    showChatView();
    hasHistory = true;

    ws.send(JSON.stringify({ type: 'message', text: text }));

    // Optimistically show the message locally
    const currTypingEl = document.getElementById('zerochat-typing');
    appendMessage('customer', text, true, currTypingEl);

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
  function appendMessage(sender, content, animate, referenceTypingEl) {
    const div = document.createElement('div');
    div.className = 'zerochat-msg ' + sender;

    const labels = {
      ai: '🤖 AI',
      owner: '👤 Team',
      bot: '⚙️ System',
    };

    let html = '';
    if (labels[sender]) {
      html += '<div class="zerochat-msg-badge">' + labels[sender] + '</div>';
    }
    html += '<div>' + escapeHtml(content) + '</div>';
    div.innerHTML = html;

    if (!animate) {
      div.style.animation = 'none';
    }

    if (referenceTypingEl) {
      messagesEl.insertBefore(div, referenceTypingEl);
    } else {
      messagesEl.appendChild(div);
    }
    scrollToBottom();
  }

  // --- Typing indicator ---
  function showTyping() {
    const el = document.getElementById('zerochat-typing');
    if (el) {
      el.classList.add('visible');
      scrollToBottom();
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(hideTyping, 10000);
    }
  }

  function hideTyping() {
    const el = document.getElementById('zerochat-typing');
    if (el) {
      el.classList.remove('visible');
      clearTimeout(typingTimeout);
    }
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
