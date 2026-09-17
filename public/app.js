// Retail SOP Document Assistant - Client App

const API_BASE = window.location.origin;

const state = {
  token: localStorage.getItem('sop_token') || null,
  user: null,
  documents: [],
  history: [],
  selectedFile: null,
  activeFeedbackMsgId: null,
  selectedRating: 'thumbs_up'
};

// DOM Elements
const elements = {
  // Status
  backendStatus: document.getElementById('backendStatus'),
  geminiStatus: document.getElementById('geminiStatus'),
  geminiStatusDot: document.getElementById('geminiStatusDot'),
  
  // Auth & User
  userWidget: document.getElementById('userWidget'),
  userAvatar: document.getElementById('userAvatar'),
  userNameDisplay: document.getElementById('userNameDisplay'),
  userRoleBadge: document.getElementById('userRoleBadge'),
  btnLogout: document.getElementById('btnLogout'),
  authModal: document.getElementById('authModal'),
  authModalClose: document.getElementById('authModalClose'),
  tabLoginBtn: document.getElementById('tabLoginBtn'),
  tabRegisterBtn: document.getElementById('tabRegisterBtn'),
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  loginUsername: document.getElementById('loginUsername'),
  loginPassword: document.getElementById('loginPassword'),
  loginError: document.getElementById('loginError'),
  regFullName: document.getElementById('regFullName'),
  regUsername: document.getElementById('regUsername'),
  regPassword: document.getElementById('regPassword'),
  regRole: document.getElementById('regRole'),
  regError: document.getElementById('regError'),
  mobileAuthBtn: document.getElementById('mobileAuthBtn'),

  // Sidebar & Upload
  sidebar: document.getElementById('sidebar'),
  mobileMenuBtn: document.getElementById('mobileMenuBtn'),
  mobileCloseBtn: document.getElementById('mobileCloseBtn'),
  tabBtns: document.querySelectorAll('.tab-btn'),
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  selectedFileName: document.getElementById('selectedFileName'),
  btnUploadFile: document.getElementById('btnUploadFile'),
  filePathInput: document.getElementById('filePathInput'),
  btnUploadPath: document.getElementById('btnUploadPath'),
  
  // Documents & History
  documentList: document.getElementById('documentList'),
  docCountBadge: document.getElementById('docCountBadge'),
  btnRefreshDocs: document.getElementById('btnRefreshDocs'),
  historyContainer: document.getElementById('historyContainer'),
  historyCount: document.getElementById('historyCount'),
  btnClearHistory: document.getElementById('btnClearHistory'),
  
  // Chat
  chatContainer: document.getElementById('chatContainer'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  btnSend: document.getElementById('btnSend'),
  zeroStateCard: document.getElementById('zeroStateCard'),
  
  // Feedback Modal
  feedbackModal: document.getElementById('feedbackModal'),
  feedbackModalClose: document.getElementById('feedbackModalClose'),
  ratingChoiceBtns: document.querySelectorAll('.rating-choice-btn'),
  feedbackComment: document.getElementById('feedbackComment'),
  btnSubmitFeedback: document.getElementById('btnSubmitFeedback'),
  
  // Toast
  toastContainer: document.getElementById('toastContainer')
};

// -----------------------------
// TOAST NOTIFICATIONS
// -----------------------------
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
    <span>${message}</span>
  `;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// -----------------------------
// AUTHENTICATION & SESSION
// -----------------------------
function getAuthHeaders() {
  const headers = {};
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  return headers;
}

async function checkAuthSession() {
  if (!state.token) {
    promptLogin();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      state.user = data.user;
      updateUserUI();
      loadUserHistory();
    } else {
      logout();
    }
  } catch (err) {
    console.warn("Session validation error:", err);
  }
}

function updateUserUI() {
  if (state.user) {
    elements.userNameDisplay.textContent = state.user.fullName || state.user.username;
    elements.userRoleBadge.textContent = state.user.role || 'General';
    elements.userAvatar.textContent = (state.user.fullName || state.user.username)[0].toUpperCase();
    elements.userWidget.style.display = 'block';
  } else {
    elements.userWidget.style.display = 'none';
  }
}

function promptLogin() {
  elements.authModal.classList.add('open');
  switchAuthTab('login');
}

function switchAuthTab(tab) {
  elements.loginError.style.display = 'none';
  elements.regError.style.display = 'none';
  if (tab === 'login') {
    elements.tabLoginBtn.classList.add('active');
    elements.tabRegisterBtn.classList.remove('active');
    elements.loginForm.classList.add('active');
    elements.registerForm.classList.remove('active');
  } else {
    elements.tabRegisterBtn.classList.add('active');
    elements.tabLoginBtn.classList.remove('active');
    elements.registerForm.classList.add('active');
    elements.loginForm.classList.remove('active');
  }
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('sop_token');
  updateUserUI();
  elements.chatContainer.innerHTML = '';
  elements.historyContainer.innerHTML = '<div class="empty-list-text">No past questions recorded.</div>';
  elements.historyCount.textContent = '0';
  promptLogin();
}

// -----------------------------
// BACKEND STATUS
// -----------------------------
async function checkBackendStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    if (res.ok) {
      const data = await res.json();
      elements.backendStatus.textContent = "Connected";
      elements.backendStatus.className = "status-val text-success";
      
      if (data.gemini_configured) {
        elements.geminiStatus.textContent = "Active (.env)";
        elements.geminiStatus.className = "status-val text-success";
        elements.geminiStatusDot.className = "status-dot online";
      } else {
        elements.geminiStatus.textContent = "Keyword fallback";
        elements.geminiStatus.className = "status-val";
        elements.geminiStatusDot.className = "status-dot offline";
      }
    } else {
      throw new Error();
    }
  } catch (err) {
    elements.backendStatus.textContent = "Disconnected";
    elements.backendStatus.className = "status-val text-error";
    elements.geminiStatus.textContent = "Offline";
    elements.geminiStatusDot.className = "status-dot offline";
  }
}

// -----------------------------
// DOCUMENTS MANAGEMENT
// -----------------------------
async function loadDocuments() {
  try {
    const res = await fetch(`${API_BASE}/api/documents`);
    if (res.ok) {
      const docs = await res.json();
      state.documents = docs;
      renderDocuments();
    }
  } catch (err) {
    console.error("Error loading documents:", err);
  }
}

function renderDocuments() {
  const activeDocs = state.documents.filter(d => d.status === 'active');
  elements.docCountBadge.textContent = activeDocs.length;

  if (activeDocs.length === 0) {
    elements.documentList.innerHTML = '<div class="empty-list-text">No documents indexed yet.</div>';
    elements.zeroStateCard.style.display = 'block';
    return;
  }

  elements.zeroStateCard.style.display = 'none';
  elements.documentList.innerHTML = '';

  activeDocs.forEach(doc => {
    const ext = (doc.file_type || '.pdf').toLowerCase().replace('.', '');
    const badgeClass = `badge-${ext}`;

    const item = document.createElement('div');
    item.className = 'doc-item';
    item.innerHTML = `
      <div class="doc-info">
        <div class="doc-title-row">
          <span class="doc-title" title="${doc.title}">${doc.title}</span>
          <span class="file-badge ${badgeClass}">${ext}</span>
        </div>
        <div class="doc-filename" title="${doc.filename}">${doc.filename}</div>
      </div>
      <button class="btn-delete-doc" data-id="${doc.id}" title="Delete document">🗑️</button>
    `;

    item.querySelector('.btn-delete-doc').addEventListener('click', () => deleteDocument(doc.id, doc.title));
    elements.documentList.appendChild(item);
  });
}

async function deleteDocument(docId, docTitle) {
  if (!confirm(`Are you sure you want to remove "${docTitle}" from the knowledge base?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/documents/${docId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      showToast(`Document "${docTitle}" removed.`, 'success');
      loadDocuments();
    } else {
      const err = await res.json();
      showToast(err.detail || "Failed to delete document", 'error');
    }
  } catch (e) {
    showToast("Server error during deletion", 'error');
  }
}

// -----------------------------
// DOCUMENT UPLOAD HANDLERS
// -----------------------------
function setupUploadHandlers() {
  // Tab Switching
  elements.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // Drag & Drop
  const dropZone = elements.dropZone;
  const fileInput = elements.fileInput;

  dropZone.addEventListener('click', () => fileInput.click());
  
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  });

  // Upload File Submit
  elements.btnUploadFile.addEventListener('click', async () => {
    if (!state.selectedFile) return;

    const formData = new FormData();
    formData.append('file', state.selectedFile);
    formData.append('title', state.selectedFile.name.replace(/\.[^/.]+$/, ''));
    formData.append('category', 'General');
    formData.append('version', 'v1.0');

    elements.btnUploadFile.disabled = true;
    elements.btnUploadFile.innerHTML = '<span>⏳ Indexing document...</span>';

    try {
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`✅ Indexed: ${state.selectedFile.name}`, 'success');
        state.selectedFile = null;
        elements.selectedFileName.textContent = '';
        elements.fileInput.value = '';
        loadDocuments();
      } else {
        showToast(data.detail || "Upload failed", 'error');
      }
    } catch (err) {
      showToast("Network error uploading document", 'error');
    } finally {
      elements.btnUploadFile.disabled = false;
      elements.btnUploadFile.innerHTML = '<span>🚀 Upload & Index File</span>';
    }
  });

  // Path Upload Submit
  elements.btnUploadPath.addEventListener('click', async () => {
    const filePath = elements.filePathInput.value.trim();
    if (!filePath) {
      showToast("Please enter a valid file path", 'error');
      return;
    }

    elements.btnUploadPath.disabled = true;
    elements.btnUploadPath.innerHTML = '<span>⏳ Indexing from path...</span>';

    try {
      const res = await fetch(`${API_BASE}/api/upload_path`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ file_path: filePath })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "File indexed successfully!", 'success');
        elements.filePathInput.value = '';
        loadDocuments();
      } else {
        showToast(data.detail || "Failed to index path", 'error');
      }
    } catch (err) {
      showToast("Network error indexing path", 'error');
    } finally {
      elements.btnUploadPath.disabled = false;
      elements.btnUploadPath.innerHTML = '<span>🚀 Index from Path</span>';
    }
  });

  // Refresh Vector Store
  elements.btnRefreshDocs.addEventListener('click', async () => {
    elements.btnRefreshDocs.style.transform = 'rotate(360deg)';
    elements.btnRefreshDocs.style.transition = 'transform 0.5s';
    setTimeout(() => {
      elements.btnRefreshDocs.style.transform = 'none';
      elements.btnRefreshDocs.style.transition = 'none';
    }, 500);

    try {
      const res = await fetch(`${API_BASE}/api/documents/refresh`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        showToast("Vector store refreshed successfully!", 'success');
        loadDocuments();
      }
    } catch (e) {
      showToast("Failed to refresh vector store", 'error');
    }
  });
}

function handleFileSelection(file) {
  state.selectedFile = file;
  elements.selectedFileName.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  elements.btnUploadFile.disabled = false;
}

// -----------------------------
// USER HISTORY
// -----------------------------
async function loadUserHistory() {
  if (!state.token) return;

  try {
    const res = await fetch(`${API_BASE}/api/history`, {
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const history = await res.json();
      state.history = history;
      renderChatHistory();
      renderPastQuestionsList();
    }
  } catch (err) {
    console.error("Error loading user history:", err);
  }
}

function renderPastQuestionsList() {
  const userQueries = state.history.filter(m => m.role === 'user').map(m => m.content);
  elements.historyCount.textContent = userQueries.length;

  if (userQueries.length === 0) {
    elements.historyContainer.innerHTML = '<div class="empty-list-text">No past questions recorded.</div>';
    return;
  }

  elements.historyContainer.innerHTML = '';
  // Show last 10 in reverse order
  userQueries.slice(-10).reverse().forEach(q => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.textContent = `💬 ${q}`;
    item.title = q;
    item.addEventListener('click', () => {
      elements.chatInput.value = q;
      elements.chatInput.focus();
    });
    elements.historyContainer.appendChild(item);
  });
}

function renderChatHistory() {
  elements.chatContainer.innerHTML = '';
  if (state.history.length === 0) return;

  state.history.forEach(msg => {
    appendMessageBubble(msg.role, msg.content, msg.citations, msg.message_id, false);
  });

  scrollToBottom();
}

// Clear History
elements.btnClearHistory.addEventListener('click', async () => {
  if (!confirm("Clear your conversation history and all recorded data?")) return;

  try {
    const res = await fetch(`${API_BASE}/api/history`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      state.history = [];
      elements.chatContainer.innerHTML = '';
      elements.historyContainer.innerHTML = '<div class="empty-list-text">No past questions recorded.</div>';
      elements.historyCount.textContent = '0';
      showToast("All chat history and data cleared.", 'info');
    }
  } catch (err) {
    showToast("Failed to clear chat history", 'error');
  }
});

// -----------------------------
// CHAT Q&A INTERACTION
// -----------------------------
function setupChatHandlers() {
  elements.chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = elements.chatInput.value.trim();
    if (!query) return;

    if (!state.token) {
      promptLogin();
      return;
    }

    elements.chatInput.value = '';
    appendMessageBubble('user', query, [], null, true);
    scrollToBottom();

    // Add typing indicator
    const typingId = appendTypingIndicator();
    scrollToBottom();

    elements.btnSend.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ query })
      });

      removeTypingIndicator(typingId);

      if (res.ok) {
        const data = await res.json();
        appendMessageBubble('assistant', data.answer, data.citations, data.message_id, true);
        loadUserHistory(); // Refresh history drawer
      } else {
        const err = await res.json();
        appendMessageBubble('assistant', `❌ Error: ${err.detail || 'Could not process query'}`, [], null, true);
      }
    } catch (err) {
      removeTypingIndicator(typingId);
      appendMessageBubble('assistant', `❌ Connection error: ${err.message}`, [], null, true);
    } finally {
      elements.btnSend.disabled = false;
      scrollToBottom();
    }
  });
}

function appendMessageBubble(role, content, citations = [], messageId = null, animate = true) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  if (!animate) row.style.animation = 'none';

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.innerHTML = role === 'user' ? '👤' : '🤖';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  const isStrictWarning = 
    content.toLowerCase().includes("only related to retail sop") ||
    content.toLowerCase().includes("not relevant to the uploaded document");
  if (isStrictWarning) {
    bubble.classList.add('strict-warning');
    bubble.innerHTML = `
      <div class="strict-warning-badge">
        <span>⚠️</span> <span>${escapeHtml(content)}</span>
      </div>
    `;
  } else {
    // Markdown-like simple formatting for bullets and bold text
    const formatted = formatText(content);
    bubble.innerHTML = formatted;
  }

  // Citations Accordion
  if (citations && citations.length > 0) {
    const citWrapper = document.createElement('div');
    citWrapper.className = 'citations-wrapper';
    
    let citationsHtml = '';
    citations.forEach((c, idx) => {
      citationsHtml += `
        <div class="citation-box">
          <div class="citation-title">${idx + 1}. ${escapeHtml(c.title)} (${escapeHtml(c.source)})</div>
          <div class="citation-meta">Page/Sheet: ${c.page} | Category: ${escapeHtml(c.category)}</div>
          <div class="citation-content">"${escapeHtml(c.content)}"</div>
        </div>
      `;
    });

    citWrapper.innerHTML = `
      <details class="citations-details">
        <summary class="citations-summary">
          <span>📄 View Citations (${citations.length})</span>
        </summary>
        <div class="citations-list">
          ${citationsHtml}
        </div>
      </details>
    `;
    bubble.appendChild(citWrapper);
  }

  // Feedback Actions on Assistant Message
  if (role === 'assistant' && messageId) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.innerHTML = `
      <button class="btn-feedback" data-id="${messageId}" data-rating="thumbs_up" title="Helpful">👍 Helpful</button>
      <button class="btn-feedback" data-id="${messageId}" data-rating="thumbs_down" title="Needs improvement">👎 Inaccurate</button>
    `;

    actions.querySelectorAll('.btn-feedback').forEach(btn => {
      btn.addEventListener('click', () => {
        openFeedbackModal(messageId, btn.dataset.rating);
      });
    });

    bubble.appendChild(actions);
  }

  row.appendChild(avatar);
  row.appendChild(bubble);
  elements.chatContainer.appendChild(row);
}

function appendTypingIndicator() {
  const id = `typing_${Date.now()}`;
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.id = id;

  row.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  elements.chatContainer.appendChild(row);
  return id;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function scrollToBottom() {
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

function formatText(text) {
  if (!text) return '';
  
  const lines = text.split('\n');
  const outputBlocks = [];
  let currentList = [];
  let listType = null; // 'ul' or 'ol'

  function flushList() {
    if (currentList.length > 0) {
      if (listType === 'ul') {
        outputBlocks.push(`<ul class="msg-list">${currentList.map(li => `<li>${li}</li>`).join('')}</ul>`);
      } else if (listType === 'ol') {
        outputBlocks.push(`<ol class="msg-ordered-list">${currentList.map(li => `<li>${li}</li>`).join('')}</ol>`);
      }
      currentList = [];
      listType = null;
    }
  }

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    // Heading 3 or 4: ### Header or #### Header
    if (/^#{2,4}\s+(.*)/.test(line)) {
      flushList();
      const title = line.replace(/^#{2,4}\s+/, '');
      outputBlocks.push(`<h4 class="msg-subheading">${formatInline(title)}</h4>`);
      continue;
    }

    // Bullet list: • item, - item, * item
    const bulletMatch = line.match(/^[\s•\-\*]\s*(.*)/);
    if (bulletMatch && (line.startsWith('•') || line.startsWith('-') || line.startsWith('*'))) {
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      currentList.push(formatInline(bulletMatch[1]));
      continue;
    }

    // Ordered list: 1. item
    const numMatch = line.match(/^(\d+)\.\s*(.*)/);
    if (numMatch) {
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      currentList.push(formatInline(numMatch[2]));
      continue;
    }

    // Regular paragraph
    flushList();
    outputBlocks.push(`<p class="msg-p">${formatInline(line)}</p>`);
  }

  flushList();
  return outputBlocks.join('');
}

function formatInline(str) {
  if (!str) return '';
  let escaped = escapeHtml(str);

  // Bold with label formatting: **Label:** or **Label**
  escaped = escaped.replace(/\*\*(.*?):\*\*/g, '<strong class="msg-label">$1:</strong>');
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italics *text* or _text_
  escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
  escaped = escaped.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Inline code `code`
  escaped = escaped.replace(/`([^`]+)`/g, '<code class="msg-code">$1</code>');

  return escaped;
}

function escapeHtml(string) {
  if (!string) return '';
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// -----------------------------
// FEEDBACK MODAL
// -----------------------------
function openFeedbackModal(messageId, defaultRating = 'thumbs_up') {
  state.activeFeedbackMsgId = messageId;
  state.selectedRating = defaultRating;
  
  elements.ratingChoiceBtns.forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.rating === defaultRating);
  });
  elements.feedbackComment.value = '';
  elements.feedbackModal.classList.add('open');
}

elements.ratingChoiceBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    elements.ratingChoiceBtns.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.selectedRating = btn.dataset.rating;
  });
});

elements.feedbackModalClose.addEventListener('click', () => {
  elements.feedbackModal.classList.remove('open');
});

elements.btnSubmitFeedback.addEventListener('click', async () => {
  if (!state.activeFeedbackMsgId) return;

  const comment = elements.feedbackComment.value.trim();
  try {
    const res = await fetch(`${API_BASE}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        message_id: state.activeFeedbackMsgId,
        rating: state.selectedRating,
        comment: comment || null
      })
    });
    if (res.ok) {
      showToast("Thank you for your feedback!", 'success');
      elements.feedbackModal.classList.remove('open');
    }
  } catch (e) {
    showToast("Failed to submit feedback", 'error');
  }
});

// -----------------------------
// MODAL & AUTH EVENT HANDLERS
// -----------------------------
function setupAuthHandlers() {
  // Switch tabs
  elements.tabLoginBtn.addEventListener('click', () => switchAuthTab('login'));
  elements.tabRegisterBtn.addEventListener('click', () => switchAuthTab('register'));

  // Open modal triggers
  elements.mobileAuthBtn.addEventListener('click', () => elements.authModal.classList.add('open'));
  elements.authModalClose.addEventListener('click', () => elements.authModal.classList.remove('open'));
  elements.btnLogout.addEventListener('click', logout);

  // Login Form Submit
  elements.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = elements.loginUsername.value.trim();
    const password = elements.loginPassword.value;

    elements.loginError.style.display = 'none';

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (res.ok) {
        state.token = data.token;
        state.user = data.user;
        localStorage.setItem('sop_token', data.token);
        updateUserUI();
        elements.authModal.classList.remove('open');
        showToast(`Welcome back, ${data.user.fullName}!`, 'success');
        loadUserHistory();
      } else {
        elements.loginError.textContent = data.detail || "Invalid login credentials";
        elements.loginError.style.display = 'block';
      }
    } catch (err) {
      elements.loginError.textContent = "Network error logging in";
      elements.loginError.style.display = 'block';
    }
  });

  // Register Form Submit
  elements.registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = elements.regFullName.value.trim();
    const username = elements.regUsername.value.trim();
    const password = elements.regPassword.value;
    const role = elements.regRole.value;

    elements.regError.style.display = 'none';

    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, username, password, role })
      });

      const data = await res.json();
      if (res.ok) {
        state.token = data.token;
        state.user = data.user;
        localStorage.setItem('sop_token', data.token);
        updateUserUI();
        elements.authModal.classList.remove('open');
        showToast(`Account created! Welcome, ${data.user.fullName}.`, 'success');
        loadUserHistory();
      } else {
        elements.regError.textContent = data.detail || "Registration failed";
        elements.regError.style.display = 'block';
      }
    } catch (err) {
      elements.regError.textContent = "Network error creating account";
      elements.regError.style.display = 'block';
    }
  });

  // Mobile menu open / close
  elements.mobileMenuBtn.addEventListener('click', () => {
    elements.sidebar.classList.add('open');
  });
  elements.mobileCloseBtn.addEventListener('click', () => {
    elements.sidebar.classList.remove('open');
  });
}

// -----------------------------
// INITIALIZATION
// -----------------------------
document.addEventListener('DOMContentLoaded', async () => {
  setupAuthHandlers();
  setupUploadHandlers();
  setupChatHandlers();
  
  await checkBackendStatus();
  await loadDocuments();
  await checkAuthSession();
});
