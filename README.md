# Retail SOP Document Intelligence Assistant (Node.js)

An AI-powered Standard Operating Procedure (SOP) Assistant built natively with **Node.js, Express, and modern Web Technologies**. It provides document grounding, citations, multi-format file ingestion, user authentication, and per-user chat histories.

---

## 🌟 Key Features

- **100% Node.js Native**: Fast, lightweight architecture using Express and modern ES/CommonJS modules.
- **Multi-Format Document Parsing**:
  - 📄 **PDF** documents (`pdf-parse`)
  - 📝 **Word** documents (`.docx`, `.doc` via `mammoth`)
  - 📊 **Excel** spreadsheets (`.xlsx`, `.xls` via `xlsx`)
  - 📈 **CSV** tabular files
  - 📑 **Text / Markdown** (`.txt`, `.md`)
- **Strict Document Grounding**:
  - Integrated with **Google Gemini** (`gemini-2.5-flash`, `gemini-1.5-flash`).
  - Strict grounding: Answers queries **ONLY** from uploaded documents.
  - Returns `"i can answer questions only related to retail SOP"` with empty citations when queries are not found in the documents.
  - Fallback deterministic offline keyword & sentence extractor when no LLM key is configured.
- **User Authentication & Isolated Histories**:
  - User Registration ("Create Account") with role assignments (`General`, `Manager`, `Admin`).
  - Secure login with `bcryptjs` password hashing and JWT session tokens.
  - **Account-Isolated Chat History**: Each account has its own private chat history, questions log, and citations.
- **Interactive UI**:
  - Dark mode with glassmorphism and modern typography (`Inter`, `Outfit`).
  - Drag-and-drop & local path document ingestion.
  - Active document manager with filetype badges and 1-click deletion.
  - Collapsible citation cards showing source document, page/sheet, category, and exact matched excerpt.
  - Inline feedback buttons (👍 / 👎) with comments recording.

---

## 🚀 Local Setup & Development

### 1. Prerequisites
- **Node.js**: v18.0.0 or later (v20+ recommended)
- **npm**: v9.0.0 or later
- **Git**: installed on your system

### 2. Installation
```bash
npm install
```

### 3. Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Or create `.env` manually:
```env
PORT=8000
NODE_ENV=development
JWT_SECRET=retail_sop_super_secure_jwt_secret_key_2026
GEMINI_API_KEY=your_gemini_api_key_here
```

### 4. Running Locally
Start the server:
```bash
npm start
```
Or with automatic reload for development:
```bash
npm run dev
```

Open your browser at `http://localhost:8000`.

### 5. Running Automated Tests
Execute the complete test suite:
```bash
npm test
```

---

## 📦 Pushing to Git (GitHub / GitLab)

Follow these steps to push the project to your Git repository:

### Step 1: Stage all files
```bash
git add .
```

### Step 2: Commit changes
```bash
git commit -m "feat: Add Render deployment configuration and clean git structure"
```

### Step 3: Link your remote repository
If you haven't connected your GitHub repository yet, create a new repository on GitHub (e.g., `retail-sop-app`) and run:
```bash
git remote add origin https://github.com/<your-username>/retail-sop-app.git
```
*(Replace `<your-username>` with your actual GitHub username)*

### Step 4: Push to main branch
```bash
git branch -M main
git push -u origin main
```

---

## ☁️ Deploying on Render

This repository includes a pre-configured [`render.yaml`](render.yaml) file for automated, 1-click Blueprint deployment as well as standard manual Web Service deployment.

### Option A: Automatic Blueprint Deployment (Recommended)

1. Sign in to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** in the top right corner and select **Blueprint**.
3. Connect your GitHub/GitLab account and select your `retail-sop-app` repository.
4. Render will automatically detect `render.yaml` and configure:
   - **Service Type**: Web Service (`Node`)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/status`
   - **Environment Variables**: `NODE_ENV=production`, `PORT=10000`, `JWT_SECRET` (auto-generated), `GEMINI_API_KEY` (prompted).
5. (Optional) Provide your `GEMINI_API_KEY` in the environment variables prompt.
6. Click **Apply**. Render will build and deploy your app.

---

### Option B: Manual Web Service Deployment

If you prefer manual setup without Blueprints:

1. In Render Dashboard, click **New +** → **Web Service**.
2. Connect your Git repository.
3. Configure the settings:
   - **Name**: `retail-sop-assistant`
   - **Language / Runtime**: `Node`
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
4. Expand **Advanced** and add the following **Environment Variables**:
   | Key | Value | Description |
   | :--- | :--- | :--- |
   | `NODE_ENV` | `production` | Production mode |
   | `PORT` | `10000` | Render standard port |
   | `JWT_SECRET` | *(Random 32-char string)* | Session encryption key |
   | `GEMINI_API_KEY` | *(Your Gemini API key)* | Optional for Gemini LLM |
5. In **Health Check Path**, enter: `/api/status`.
6. Click **Create Web Service**.

Once deployed, Render provides you with a live URL (e.g., `https://retail-sop-assistant.onrender.com`).

---

## 👥 Default Accounts
| Username | Password | Role |
| :--- | :--- | :--- |
| `admin` | `admin123` | Administrator |
| `staff` | `staff123` | General Retail Associate |

*You can also create new accounts directly in the UI via the "Create Account" tab.*

---

## 🔌 REST API Endpoints

### Authentication
- `POST /api/auth/register` - Create a new user account
- `POST /api/auth/login` - Authenticate and receive JWT token
- `GET /api/auth/me` - Get current authenticated user profile

### Documents
- `GET /api/documents` - List all uploaded documents
- `POST /api/upload` - Upload file (multipart/form-data)
- `POST /api/upload_path` - Ingest file from local filesystem path
- `DELETE /api/documents/:id` - Remove document and rebuild vector store
- `POST /api/documents/refresh` - Refresh vector index

### Chat & History
- `POST /api/chat` - Submit SOP query with optional role/Gemini key
- `GET /api/history` - Fetch authenticated user's chat history
- `DELETE /api/history` - Purge history and all data
- `POST /api/feedback` - Submit thumbs up/down rating and comments

### System Health
- `GET /api/status` - Health check & server capabilities
