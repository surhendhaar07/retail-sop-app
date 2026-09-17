const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('crypto'); // Or use crypto.randomUUID

dotenv.config();

const ragPipeline = require('./ragPipeline');

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || "retail_sop_super_secure_jwt_secret_key_2026";

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Data directory and paths
const DATA_DIR = path.join(__dirname, 'data');
const DOCS_DIR = path.join(DATA_DIR, 'documents');
const DOC_STORE_FILE = path.join(DATA_DIR, 'document_store.json');
const LOGS_FILE = path.join(DATA_DIR, 'chat_logs.json');
const USER_HISTORIES_FILE = path.join(DATA_DIR, 'user_histories.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

// JSON Helpers
function readJsonFile(filePath, defaultVal = []) {
  if (!fs.existsSync(filePath)) return defaultVal;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return defaultVal;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

// Initialize files if not existing
if (!fs.existsSync(DOC_STORE_FILE)) writeJsonFile(DOC_STORE_FILE, []);
if (!fs.existsSync(LOGS_FILE)) writeJsonFile(LOGS_FILE, []);
if (!fs.existsSync(USER_HISTORIES_FILE)) writeJsonFile(USER_HISTORIES_FILE, {});
if (!fs.existsSync(FEEDBACK_FILE)) writeJsonFile(FEEDBACK_FILE, []);
if (!fs.existsSync(USERS_FILE)) {
  // Create default admin and staff accounts
  const salt = bcrypt.genSaltSync(10);
  const defaultUsers = [
    {
      id: "usr_admin",
      username: "admin",
      fullName: "Store Administrator",
      passwordHash: bcrypt.hashSync("admin123", salt),
      role: "Admin",
      createdAt: new Date().toISOString()
    },
    {
      id: "usr_staff",
      username: "staff",
      fullName: "Retail Floor Associate",
      passwordHash: bcrypt.hashSync("staff123", salt),
      role: "General",
      createdAt: new Date().toISOString()
    }
  ];
  writeJsonFile(USERS_FILE, defaultUsers);
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, DOCS_DIR);
  },
  filename: function (req, file, cb) {
    const fileId = Math.random().toString(36).substring(2, 10);
    const sanitized = `${fileId}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    cb(null, sanitized);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt", ".md"]);

// Helper UUID
function generateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Auth Middleware (Optional / Extract user if present)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) {
      req.user = null;
    } else {
      req.user = decodedUser;
    }
    next();
  });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ detail: "Authentication required" });
  }

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) {
      return res.status(403).json({ detail: "Invalid or expired session token" });
    }
    req.user = decodedUser;
    next();
  });
}

// -----------------------------
// AUTH ROUTES
// -----------------------------

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
  const { username, password, fullName, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ detail: "Username and password are required." });
  }

  const cleanUsername = username.trim().toLowerCase();
  if (cleanUsername.length < 3) {
    return res.status(400).json({ detail: "Username must be at least 3 characters." });
  }
  if (password.length < 4) {
    return res.status(400).json({ detail: "Password must be at least 4 characters." });
  }

  const users = readJsonFile(USERS_FILE, []);
  const existing = users.find(u => u.username.toLowerCase() === cleanUsername);
  if (existing) {
    return res.status(409).json({ detail: `User '${cleanUsername}' already exists. Please choose a different username or log in.` });
  }

  const salt = bcrypt.genSaltSync(10);
  const newUser = {
    id: `usr_${generateId().substring(0, 8)}`,
    username: cleanUsername,
    fullName: (fullName && fullName.trim()) || cleanUsername,
    passwordHash: bcrypt.hashSync(password, salt),
    role: role || "General",
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeJsonFile(USERS_FILE, users);

  const token = jwt.sign(
    { id: newUser.id, username: newUser.username, fullName: newUser.fullName, role: newUser.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.status(201).json({
    message: "Account created successfully!",
    token,
    user: {
      id: newUser.id,
      username: newUser.username,
      fullName: newUser.fullName,
      role: newUser.role
    }
  });
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ detail: "Username and password are required." });
  }

  const cleanUsername = username.trim().toLowerCase();
  const users = readJsonFile(USERS_FILE, []);
  const user = users.find(u => u.username.toLowerCase() === cleanUsername);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ detail: "Invalid username or password." });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, fullName: user.fullName, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.json({
    message: "Login successful!",
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role
    }
  });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: req.user
  });
});

// -----------------------------
// CORE SYSTEM STATUS
// -----------------------------
app.get('/', (req, res, next) => {
  // If accept header favors HTML and requesting root in browser, serve index.html
  if (req.accepts('html') && !req.xhr) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  
  const geminiKey = ragPipeline.getConfiguredGeminiKey();
  res.json({
    message: "RAG Document Assistant API is running! (Node.js Native)",
    gemini_configured: Boolean(geminiKey),
    supported_formats: Array.from(SUPPORTED_EXTENSIONS)
  });
});

app.get('/api/status', (req, res) => {
  const geminiKey = ragPipeline.getConfiguredGeminiKey();
  res.json({
    message: "RAG Document Assistant API is running! (Node.js Native)",
    gemini_configured: Boolean(geminiKey),
    supported_formats: Array.from(SUPPORTED_EXTENSIONS)
  });
});

// -----------------------------
// DOCUMENT UPLOADS & MANAGEMENT
// -----------------------------

// POST /api/upload
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: "No file uploaded." });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        detail: `Unsupported file format '${ext}'. Supported formats: ${Array.from(SUPPORTED_EXTENSIONS).sort().join(', ')}`
      });
    }

    const rawTitle = req.body.title;
    const category = req.body.category || "General";
    const version = req.body.version || "v1.0";
    const minRole = req.body.min_role || "General";
    const docTitle = rawTitle && rawTitle.trim() ? rawTitle.trim() : path.parse(req.file.originalname).name;

    const docStore = readJsonFile(DOC_STORE_FILE, []);

    // Archive older versions of the same doc in category
    for (const doc of docStore) {
      if ((doc.title || '').trim().toLowerCase() === docTitle.toLowerCase() && doc.category === category) {
        doc.status = "archived";
      }
    }

    const newDoc = {
      id: generateId(),
      filename: req.file.originalname,
      sanitized_filename: req.file.filename,
      file_path: req.file.path,
      file_type: ext,
      title: docTitle,
      category: category,
      version: version,
      min_role: minRole,
      status: "active",
      uploaded_at: new Date().toISOString()
    };

    docStore.push(newDoc);
    writeJsonFile(DOC_STORE_FILE, docStore);

    // Rebuild vector store
    try {
      const activeDocs = docStore.filter(d => d.status === "active");
      await ragPipeline.rebuildVectorStore(activeDocs);
    } catch (e) {
      return res.json({
        message: "Document uploaded successfully, but indexing encountered an issue.",
        warning: e.message,
        document: newDoc
      });
    }

    return res.json({
      message: "Document uploaded and database indexed successfully!",
      document: newDoc
    });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ detail: `Failed to upload document: ${err.message}` });
  }
});

// POST /api/upload_path
app.post('/api/upload_path', async (req, res) => {
  try {
    const { file_path, title, category = "General" } = req.body;
    if (!file_path) {
      return res.status(400).json({ detail: "file_path is required." });
    }

    const cleanedPath = file_path.trim().replace(/^["']|["']$/g, '');
    if (!fs.existsSync(cleanedPath)) {
      return res.status(400).json({ detail: `File not found at path: ${cleanedPath}` });
    }

    const filename = path.basename(cleanedPath);
    const ext = path.extname(filename).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return res.status(400).json({
        detail: `Unsupported file format '${ext}'. Supported: ${Array.from(SUPPORTED_EXTENSIONS).sort().join(', ')}`
      });
    }

    const docTitle = title && title.trim() ? title.trim() : path.parse(filename).name;
    const fileId = Math.random().toString(36).substring(2, 10);
    const sanitizedFilename = `${fileId}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const savedFilePath = path.join(DOCS_DIR, sanitizedFilename);

    fs.copyFileSync(cleanedPath, savedFilePath);

    const docStore = readJsonFile(DOC_STORE_FILE, []);

    for (const doc of docStore) {
      if ((doc.title || '').trim().toLowerCase() === docTitle.toLowerCase() && doc.category === category) {
        doc.status = "archived";
      }
    }

    const newDoc = {
      id: generateId(),
      filename: filename,
      sanitized_filename: sanitizedFilename,
      file_path: savedFilePath,
      file_type: ext,
      title: docTitle,
      category: category,
      version: "v1.0",
      min_role: "General",
      status: "active",
      uploaded_at: new Date().toISOString()
    };

    docStore.push(newDoc);
    writeJsonFile(DOC_STORE_FILE, docStore);

    try {
      const activeDocs = docStore.filter(d => d.status === "active");
      await ragPipeline.rebuildVectorStore(activeDocs);
    } catch (e) {
      return res.json({
        message: "Document indexed with warning.",
        warning: e.message,
        document: newDoc
      });
    }

    return res.json({
      message: `Successfully indexed '${filename}'!`,
      document: newDoc
    });
  } catch (err) {
    console.error("Path upload error:", err);
    return res.status(500).json({ detail: `Failed to copy and index document: ${err.message}` });
  }
});

// GET /api/documents
app.get('/api/documents', (req, res) => {
  const docs = readJsonFile(DOC_STORE_FILE, []);
  res.json(docs);
});

// DELETE /api/documents/:doc_id
app.delete('/api/documents/:doc_id', async (req, res) => {
  const docId = req.params.doc_id;
  const docStore = readJsonFile(DOC_STORE_FILE, []);
  
  const docToDelete = docStore.find(d => d.id === docId);
  if (!docToDelete) {
    return res.status(404).json({ detail: "Document not found" });
  }

  const remainingDocs = docStore.filter(d => d.id !== docId);

  if (docToDelete.file_path && fs.existsSync(docToDelete.file_path)) {
    try {
      fs.unlinkSync(docToDelete.file_path);
    } catch (e) {
      console.warn("Warning deleting file:", e.message);
    }
  }

  writeJsonFile(DOC_STORE_FILE, remainingDocs);

  const activeDocs = remainingDocs.filter(d => d.status === "active");
  await ragPipeline.rebuildVectorStore(activeDocs);

  return res.json({ message: `Document '${docToDelete.title}' deleted successfully.` });
});

// POST /api/documents/refresh
app.post('/api/documents/refresh', async (req, res) => {
  try {
    const docStore = readJsonFile(DOC_STORE_FILE, []);
    const activeDocs = docStore.filter(d => d.status === "active");

    if (activeDocs.length === 0) {
      await ragPipeline.rebuildVectorStore([]);
      return res.json({ message: "Database cleared (no active documents to index)." });
    }

    await ragPipeline.rebuildVectorStore(activeDocs);
    return res.json({ message: "Vector store refreshed successfully with active documents." });
  } catch (err) {
    return res.status(500).json({ detail: `Failed to refresh vector database: ${err.message}` });
  }
});

// -----------------------------
// USER HISTORY ENDPOINTS
// -----------------------------

// Helper to resolve username from auth or params
function resolveUser(req) {
  if (req.user && req.user.username) {
    return req.user.username.trim().toLowerCase();
  }
  if (req.params.username) {
    return req.params.username.trim().toLowerCase();
  }
  if (req.query.username) {
    return req.query.username.trim().toLowerCase();
  }
  if (req.body && req.body.username) {
    return req.body.username.trim().toLowerCase();
  }
  return "default";
}

// GET /api/history (Authenticated / Current User)
app.get('/api/history', authenticateToken, (req, res) => {
  const username = resolveUser(req);
  const histories = readJsonFile(USER_HISTORIES_FILE, {});
  return res.json(histories[username] || []);
});

// GET /api/history/:username
app.get('/api/history/:username', authenticateToken, (req, res) => {
  const username = (req.params.username || "default").trim().toLowerCase();
  const histories = readJsonFile(USER_HISTORIES_FILE, {});
  return res.json(histories[username] || []);
});

// DELETE /api/history (Clears conversation history, logs, and feedback data)
app.delete('/api/history', authenticateToken, (req, res) => {
  const username = resolveUser(req);
  const clearAll = req.query.all === 'true';

  const histories = readJsonFile(USER_HISTORIES_FILE, {});
  const logs = readJsonFile(LOGS_FILE, []);
  const feedbacks = readJsonFile(FEEDBACK_FILE, []);

  if (clearAll) {
    writeJsonFile(USER_HISTORIES_FILE, {});
    writeJsonFile(LOGS_FILE, []);
    writeJsonFile(FEEDBACK_FILE, []);
    return res.json({ message: "All conversation histories, chat logs, and feedback records cleared completely." });
  }

  // 1. Clear user conversation history
  histories[username] = [];
  writeJsonFile(USER_HISTORIES_FILE, histories);

  // 2. Clear user logs and associated feedbacks
  const userMessageIds = new Set(
    logs.filter(l => (l.username || 'default').toLowerCase() === username).map(l => l.message_id)
  );
  const remainingLogs = logs.filter(l => (l.username || 'default').toLowerCase() !== username);
  const remainingFeedbacks = feedbacks.filter(f => !userMessageIds.has(f.message_id));

  writeJsonFile(LOGS_FILE, remainingLogs);
  writeJsonFile(FEEDBACK_FILE, remainingFeedbacks);

  return res.json({ message: `Chat history and all associated log records for user '${username}' cleared successfully.` });
});

// DELETE /api/history/:username
app.delete('/api/history/:username', authenticateToken, (req, res) => {
  const username = (req.params.username || "default").trim().toLowerCase();
  const histories = readJsonFile(USER_HISTORIES_FILE, {});
  const logs = readJsonFile(LOGS_FILE, []);
  const feedbacks = readJsonFile(FEEDBACK_FILE, []);

  histories[username] = [];
  writeJsonFile(USER_HISTORIES_FILE, histories);

  const userMessageIds = new Set(
    logs.filter(l => (l.username || 'default').toLowerCase() === username).map(l => l.message_id)
  );
  const remainingLogs = logs.filter(l => (l.username || 'default').toLowerCase() !== username);
  const remainingFeedbacks = feedbacks.filter(f => !userMessageIds.has(f.message_id));

  writeJsonFile(LOGS_FILE, remainingLogs);
  writeJsonFile(FEEDBACK_FILE, remainingFeedbacks);

  return res.json({ message: `Chat history and all associated log records for user '${username}' cleared successfully.` });
});

// -----------------------------
// CHAT Q&A INTERACTION
// -----------------------------
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { query, user_role, api_key } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ detail: "Query is required." });
    }

    const username = resolveUser(req);
    const role = user_role || (req.user ? req.user.role : "General");

    const vectorStore = ragPipeline.getVectorStore();
    const result = await ragPipeline.executeQa(vectorStore, query, role, api_key);

    const messageId = generateId();
    const timestamp = new Date().toISOString();

    const chatLog = {
      message_id: messageId,
      username: username,
      timestamp: timestamp,
      query: query,
      user_role: role,
      answer: result.answer,
      citations: result.citations
    };

    // 1. Append to global logs
    const logs = readJsonFile(LOGS_FILE, []);
    logs.push(chatLog);
    writeJsonFile(LOGS_FILE, logs);

    // 2. Append to user-isolated history
    const histories = readJsonFile(USER_HISTORIES_FILE, {});
    if (!histories[username]) {
      histories[username] = [];
    }

    histories[username].push({
      role: "user",
      content: query,
      timestamp: timestamp
    });

    histories[username].push({
      role: "assistant",
      content: result.answer,
      citations: result.citations,
      message_id: messageId,
      timestamp: timestamp
    });

    writeJsonFile(USER_HISTORIES_FILE, histories);

    return res.json({
      message_id: messageId,
      answer: result.answer,
      citations: result.citations
    });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ detail: `Chat processing failed: ${err.message}` });
  }
});

// -----------------------------
// FEEDBACK & ADMIN LOGS
// -----------------------------
app.post('/api/feedback', (req, res) => {
  const { message_id, rating, comment } = req.body;
  if (!message_id || !rating) {
    return res.status(400).json({ detail: "message_id and rating are required." });
  }

  const feedbacks = readJsonFile(FEEDBACK_FILE, []);
  const feedbackEntry = {
    feedback_id: generateId(),
    message_id: message_id,
    timestamp: new Date().toISOString(),
    rating: rating,
    comment: comment || null
  };
  feedbacks.push(feedbackEntry);
  writeJsonFile(FEEDBACK_FILE, feedbacks);

  const logs = readJsonFile(LOGS_FILE, []);
  for (const log of logs) {
    if (log.message_id === message_id) {
      log.feedback = {
        rating: rating,
        comment: comment || null,
        timestamp: feedbackEntry.timestamp
      };
      break;
    }
  }
  writeJsonFile(LOGS_FILE, logs);

  return res.json({ message: "Feedback submitted successfully!" });
});

app.get('/api/admin/logs', (req, res) => {
  return res.json(readJsonFile(LOGS_FILE, []));
});

app.get('/api/admin/feedback', (req, res) => {
  return res.json(readJsonFile(FEEDBACK_FILE, []));
});

// Initialize vector store on server start with existing active documents (or seed defaults)
(async () => {
  try {
    const docStore = readJsonFile(DOC_STORE_FILE, []);
    let activeDocs = docStore.filter(d => d.status === "active");

    // Auto-seed default SOP documents if fresh deployment / empty document store
    if (activeDocs.length === 0) {
      const candidateSeedFiles = [
        "Store_Operations_SOP_Version_2.0.docx",
        "Store Operations Standard Operating Procedures.docx",
        "SOP.docx",
        "Store_Operations_SOP_Version_2.0.pdf",
        "SOP.pdf"
      ];

      for (const sampleFile of candidateSeedFiles) {
        const rootFilePath = path.join(__dirname, sampleFile);
        if (fs.existsSync(rootFilePath)) {
          const targetFilename = `seed_${sampleFile.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const targetPath = path.join(DOCS_DIR, targetFilename);
          if (!fs.existsSync(targetPath)) {
            fs.copyFileSync(rootFilePath, targetPath);
          }
          const seedDoc = {
            id: "doc_seed_" + Math.random().toString(36).substring(2, 10),
            title: "Store Operations Standard Operating Procedures (v2.0)",
            filename: sampleFile,
            file_path: targetPath,
            file_size: fs.statSync(targetPath).size,
            file_type: path.extname(sampleFile).toLowerCase(),
            uploaded_at: new Date().toISOString(),
            status: "active",
            category: "Operations",
            version: "v2.0",
            min_role: "General"
          };
          docStore.push(seedDoc);
          writeJsonFile(DOC_STORE_FILE, docStore);
          activeDocs = [seedDoc];
          console.log(`Auto-seeded initial SOP document: ${sampleFile}`);
          break;
        }
      }
    }

    if (activeDocs.length > 0) {
      console.log(`Indexing ${activeDocs.length} active document(s) into vector store...`);
      await ragPipeline.rebuildVectorStore(activeDocs);
      console.log("Vector store indexing complete.");
    }
  } catch (err) {
    console.warn("Initial vector store build warning:", err.message);
  }
})();

// Start Express Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  Retail SOP Document Intelligence Assistant (Node.js) `);
    console.log(`  Server running at: http://localhost:${PORT}        `);
    console.log(`=======================================================`);
  });
}

module.exports = app;
