const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const NOT_FOUND_RESPONSE = "i can answer questions only related to retail SOP";

// Standard English stop words and function words for generic NLP tokenization
const STOP_WORDS = new Set([
  "a", "about", "above", "across", "after", "again", "against", "all", "along", "also",
  "am", "among", "an", "and", "any", "are", "aren", "around", "as", "at",
  "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "cannot", "could", "couldn", "did", "didn", "do", "does", "doesn", "doing",
  "don", "down", "due", "during", "each", "etc", "few", "for", "from", "further",
  "had", "hadn", "has", "hasn", "have", "haven", "having", "he", "her", "here",
  "hers", "herself", "him", "himself", "his", "how", "i", "if", "in", "into",
  "is", "isn", "it", "its", "itself", "let", "me", "more", "most", "must",
  "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only",
  "onto", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own",
  "per", "same", "she", "should", "shouldn", "so", "some", "such", "than", "that",
  "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they",
  "this", "those", "through", "to", "too", "under", "until", "unto", "up", "upon",
  "very", "via", "vs", "was", "wasn", "we", "were", "weren", "what", "when",
  "where", "which", "while", "who", "whom", "why", "will", "with", "within", "without",
  "would", "wouldn", "you", "your", "yours", "yourself", "yourselves",
  "give", "tell", "show", "find", "list", "explain", "please"
]);

// -----------------------------
// TEXT SPLITTER IMPLEMENTATION
// -----------------------------
function splitTextRecursively(text, chunkSize = 500, chunkOverlap = 100, separators = ["\n\n", "\n", ". ", " ", ""]) {
  const chunks = [];
  if (!text || !text.trim()) return chunks;

  function split(content, currentSeps) {
    if (content.length <= chunkSize) {
      if (content.trim()) chunks.push(content.trim());
      return;
    }

    if (currentSeps.length === 0) {
      // Direct hard split
      for (let i = 0; i < content.length; i += (chunkSize - chunkOverlap)) {
        const piece = content.slice(i, i + chunkSize).trim();
        if (piece) chunks.push(piece);
      }
      return;
    }

    const [sep, ...remainingSeps] = currentSeps;
    const parts = content.split(sep);
    let currentChunk = "";

    for (let part of parts) {
      const candidate = currentChunk ? `${currentChunk}${sep}${part}` : part;
      if (candidate.length <= chunkSize) {
        currentChunk = candidate;
      } else {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        if (part.length > chunkSize) {
          split(part, remainingSeps);
          currentChunk = "";
        } else {
          currentChunk = part;
        }
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
  }

  split(text, separators);
  return chunks;
}

// -----------------------------
// DOCUMENT LOADERS
// -----------------------------
async function loadRawDocuments(filePath, docMetadata = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const rawDocs = [];
  const title = docMetadata.title || docMetadata.filename || path.basename(filePath);

  if (!fs.existsSync(filePath)) {
    return rawDocs;
  }

  try {
    // 1. PDF Files
    if (ext === '.pdf') {
      try {
        const pdfParse = require('pdf-parse');
        const dataBuffer = fs.readFileSync(filePath);

        let pageIndex = 0;
        const options = {
          pagerender: function (pageData) {
            return pageData.getTextContent().then(function (textContent) {
              let lastY, text = '';
              for (let item of textContent.items) {
                if (lastY == item.transform[5] || !lastY) {
                  text += item.str;
                } else {
                  text += '\n' + item.str;
                }
                lastY = item.transform[5];
              }
              pageIndex++;
              return `--- PAGE ${pageIndex} ---\n` + text;
            });
          }
        };

        const parsed = await pdfParse(dataBuffer, options);
        const fullText = parsed.text || '';

        const pageSections = fullText.split(/--- PAGE \d+ ---\n/).filter(s => s.trim().length > 0);
        if (pageSections.length > 0) {
          pageSections.forEach((section, idx) => {
            rawDocs.push({
              pageContent: section.trim(),
              metadata: { page: idx }
            });
          });
        } else if (fullText.trim()) {
          rawDocs.push({
            pageContent: fullText.trim(),
            metadata: { page: 0 }
          });
        }
      } catch (pdfErr) {
        console.warn(`Warning parsing PDF with pdf-parse (${filePath}): ${pdfErr.message}. Attempting simple buffer extract.`);
        const dataBuffer = fs.readFileSync(filePath, 'latin1');
        const matchTj = dataBuffer.match(/\((.*?)\)\s*Tj/g);
        if (matchTj && matchTj.length > 0) {
          const text = matchTj.map(m => m.replace(/^\(/, '').replace(/\)\s*Tj$/, '')).join(' ');
          rawDocs.push({ pageContent: text, metadata: { page: 0 } });
        } else {
          rawDocs.push({ pageContent: `[Document: ${title}]`, metadata: { page: 0 } });
        }
      }
    }
    // 2. Word Documents (.docx, .doc)
    else if (ext === '.docx' || ext === '.doc') {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        const text = (result.value || '').trim();
        if (text) {
          rawDocs.push({ pageContent: text, metadata: { page: 0 } });
        } else {
          rawDocs.push({ pageContent: "[Word document contained no extractable text]", metadata: { page: 0 } });
        }
      } catch (docErr) {
        console.error(`Error loading Word document ${filePath}:`, docErr);
        rawDocs.push({ pageContent: `[Error reading Word document: ${docErr.message}]`, metadata: { page: 0 } });
      }
    }
    // 3. Excel Spreadsheets (.xlsx, .xls)
    else if (ext === '.xlsx' || ext === '.xls') {
      try {
        const xlsx = require('xlsx');
        const workbook = xlsx.readFile(filePath);
        let sheetIndex = 0;
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const csvText = xlsx.utils.sheet_to_csv(sheet);
          if (csvText && csvText.trim()) {
            const content = `--- Sheet: ${sheetName} (Document: ${title}) ---\n${csvText.trim()}`;
            rawDocs.push({
              pageContent: content,
              metadata: { page: sheetIndex, sheet_name: sheetName }
            });
            sheetIndex++;
          }
        }
      } catch (xlsxErr) {
        console.error(`Error loading Excel ${filePath}:`, xlsxErr);
        rawDocs.push({ pageContent: `[Error reading Excel: ${xlsxErr.message}]`, metadata: { page: 0 } });
      }
    }
    // 4. CSV Files (.csv)
    else if (ext === '.csv') {
      try {
        const csvContent = fs.readFileSync(filePath, 'utf-8');
        const content = `--- CSV Data: ${title} ---\n${csvContent.trim()}`;
        rawDocs.push({ pageContent: content, metadata: { page: 0 } });
      } catch (csvErr) {
        console.error(`Error loading CSV ${filePath}:`, csvErr);
        rawDocs.push({ pageContent: `[Error reading CSV: ${csvErr.message}]`, metadata: { page: 0 } });
      }
    }
    // 5. Plain Text / Markdown (.txt, .md, .log, .json)
    else {
      try {
        const text = fs.readFileSync(filePath, 'utf-8');
        rawDocs.push({ pageContent: text.trim(), metadata: { page: 0 } });
      } catch (txtErr) {
        console.error(`Error loading text file ${filePath}:`, txtErr);
        rawDocs.push({ pageContent: `[Error reading text: ${txtErr.message}]`, metadata: { page: 0 } });
      }
    }
  } catch (err) {
    console.error(`Unhandled error loading ${filePath}:`, err);
  }

  return rawDocs;
}

async function processDocument(filePath, docMetadata = {}) {
  const documents = await loadRawDocuments(filePath, docMetadata);
  const chunks = [];

  for (const doc of documents) {
    const textPieces = splitTextRecursively(doc.pageContent, 500, 100);
    for (const piece of textPieces) {
      chunks.push({
        pageContent: piece,
        metadata: {
          source: docMetadata.filename || path.basename(filePath),
          title: docMetadata.title || "Untitled Document",
          min_role: docMetadata.min_role || "General",
          version: docMetadata.version || "v1.0",
          category: docMetadata.category || "General",
          page: doc.metadata.page !== undefined ? doc.metadata.page : 0,
          sheet_name: doc.metadata.sheet_name || null
        }
      });
    }
  }

  return chunks;
}

// -----------------------------
// GENERIC NLP UTILITIES & STEMMING
// -----------------------------
function stemWord(w) {
  if (!w) return "";
  let s = w.toLowerCase().trim();
  if (s.endsWith('ies') && s.length > 4) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('ing') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('tion') && s.length > 6) s = s.slice(0, -4);
  else if (s.endsWith('ions') && s.length > 6) s = s.slice(0, -4);
  else if (s.endsWith('ed') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('es') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('s') && s.length > 3) s = s.slice(0, -1);
  return s;
}

// Pure generic text hygiene and formatting for arbitrary documents
function cleanSentence(text) {
  if (!text) return "";
  let clean = text
    .replace(/^[\s•\-\*\d\.\)\(\>\#\|\[\]]+/, '') // Strip leading bullet markers, numbering, parens
    .replace(/_{2,}/g, '')                      // Strip blank form underlines
    .replace(/\[\s*\]|☐|✓|✔|☑/g, '')             // Strip checkbox symbols
    .replace(/\s+/g, ' ')                        // Normalize whitespace
    .trim();

  // Generic Key-Value formatting: e.g. "Item Code: SKU101" -> "**Item Code:** SKU101"
  const kvMatch = clean.match(/^([A-Za-z0-9\s/_-]{2,35}):\s*(.+)$/);
  if (kvMatch && !kvMatch[1].includes('.') && kvMatch[2].length > 0) {
    const key = kvMatch[1].trim();
    const val = kvMatch[2].trim();
    const formattedKey = key.charAt(0).toUpperCase() + key.slice(1);
    clean = `**${formattedKey}:** ${val}`;
  }

  // Generic CSV / Delimited Row formatting: e.g. "SKU101, Organic Milk, 45, Refrigerated"
  if (!clean.startsWith('**') && clean.includes(',') && clean.split(',').length >= 3) {
    const parts = clean.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      clean = `**${parts[0]}** — ${parts.slice(1).join(' | ')}`;
    }
  }

  // Capitalize sentence start if not markdown-bolded
  if (clean.length > 0 && !clean.startsWith('**')) {
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  // Ensure appropriate sentence punctuation at end
  if (clean.length > 0 && !/[.!?:]$/.test(clean) && !clean.endsWith('**')) {
    clean += '.';
  }

  return clean;
}

// Generic structural noise filters (no hardcoded domain strings)
function isNoiseSentence(sentence) {
  if (!sentence) return true;
  const trimmed = sentence.trim();

  // Length constraints for coherent information
  if (trimmed.length < 8 || trimmed.length > 600) return true;

  // Standalone numbers, page numbers, or dates
  if (/^(?:page\s*\d+|\d+[\/\-]\d+|\d+)$/i.test(trimmed)) return true;

  // Pure punctuation, dashes, or symbols
  if (/^[\s\-_=\*\.\#\|:\+~]+$/.test(trimmed)) return true;

  // Empty form prompts (e.g., "Signature: ____", "Name:")
  if (/^[A-Za-z\s]{2,30}:\s*_{0,}\s*$/.test(trimmed)) return true;

  // Internal document boundary markers
  if (/^---\s*(?:page|sheet|document|csv data)/i.test(trimmed)) return true;

  // Table header delimiter rows (e.g., "|---|---|")
  if (/^\|?[\s\-:|]+\|?$/.test(trimmed)) return true;

  return false;
}

// Dynamically generate clean Markdown header from query without hardcoding
function generateDynamicTitle(query) {
  if (!query || typeof query !== 'string') return "### Relevant Information";

  let cleanQ = query
    .replace(/^(?:what\s+(?:is|are|was|were|do|does|did)|tell\s+me\s+about|give\s+me|how\s+(?:to|do\s+i|can\s+i)|can\s+you\s+(?:explain|tell|show|give)|details\s+(?:on|about)|please\s+provide|where\s+is|when\s+is|explain|show\s+me|list\s+(?:all|the)?)\s+/i, '')
    .replace(/[?!.:;]+$/, '')
    .trim();

  if (!cleanQ || cleanQ.length < 3) {
    cleanQ = "Information Details";
  }

  // Convert to Title Case
  const title = cleanQ
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return `### ${title}`;
}

// -----------------------------
// VECTOR STORE & SEMANTIC INDEX
// -----------------------------
class InMemoryVectorStore {
  constructor() {
    this.chunks = [];
  }

  setChunks(chunks) {
    this.chunks = chunks || [];
  }

  getChunks() {
    return this.chunks;
  }

  // Generic TF-IDF & N-Gram BM25 search
  search(query, k = 8) {
    if (!this.chunks || this.chunks.length === 0) return [];
    if (!query || !query.trim()) return [];

    const queryTokens = query.toLowerCase().split(/\W+/).filter(w => w.length >= 2 && !STOP_WORDS.has(w));
    const fallbackTokens = queryTokens.length > 0 ? queryTokens : query.toLowerCase().split(/\W+/).filter(w => w.length > 1);

    if (fallbackTokens.length === 0) return [];

    const queryStems = new Set(fallbackTokens.map(stemWord).filter(Boolean));
    const queryLower = query.toLowerCase().trim();

    const scored = this.chunks.map(chunk => {
      const contentLower = chunk.pageContent.toLowerCase();
      const chunkWords = contentLower.split(/\W+/).filter(Boolean);
      const chunkStems = new Set(chunkWords.map(stemWord).filter(Boolean));

      let matchedTerms = 0;
      for (const qs of queryStems) {
        if (chunkStems.has(qs)) {
          matchedTerms++;
        }
      }

      // Exact phrase match bonus
      let phraseBonus = 0;
      if (queryLower.length > 4 && contentLower.includes(queryLower)) {
        phraseBonus = 15;
      }

      // Query coverage: fraction of distinct query stems present
      const coverageRatio = queryStems.size > 0 ? (matchedTerms / queryStems.size) : 0;

      const score = (matchedTerms * 4) + (coverageRatio * 10) + phraseBonus;
      return { chunk, score, matchedTerms, coverageRatio };
    });

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Dynamic threshold: for multi-word queries, require meaningful query term overlap
    const minRequiredScore = queryStems.size >= 4 ? 8 : (queryStems.size >= 2 ? 6 : 3);
    const relevant = scored.filter(s => s.score >= minRequiredScore).slice(0, k).map(s => s.chunk);

    return relevant;
  }
}

let _vectorStoreInstance = new InMemoryVectorStore();

async function rebuildVectorStore(activeDocs = []) {
  const allChunks = [];
  for (const doc of activeDocs) {
    if (doc.file_path && fs.existsSync(doc.file_path)) {
      const chunks = await processDocument(doc.file_path, doc);
      allChunks.push(...chunks);
    }
  }

  _vectorStoreInstance.setChunks(allChunks);
  return _vectorStoreInstance;
}

function getVectorStore() {
  return _vectorStoreInstance;
}

// -----------------------------
// OFFLINE DETERMINISTIC NLP SYNTHESIZER
// -----------------------------
function generateOfflineAnswer(query, docs) {
  if (!docs || docs.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  // Extract query keywords and stems
  let rawKeywords = query.toLowerCase().split(/\W+/).filter(w => w.length >= 2 && !STOP_WORDS.has(w));
  if (rawKeywords.length === 0) {
    rawKeywords = query.toLowerCase().split(/\W+/).filter(w => w.length > 1);
  }

  if (rawKeywords.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  const queryStems = new Map();
  for (const kw of rawKeywords) {
    queryStems.set(stemWord(kw), kw);
  }

  const rawCandidates = [];

  // Extract candidate sentences from retrieved document chunks
  for (const doc of docs) {
    const content = doc.pageContent;
    const rawSegments = content.split(/(?<=[.!?\n])\s+|\n+/);

    for (const raw of rawSegments) {
      const trimmed = raw.trim();
      if (!trimmed || isNoiseSentence(trimmed)) continue;

      const clean = cleanSentence(trimmed);
      if (!clean || clean.length < 12) continue;

      const lower = clean.toLowerCase();
      const sentenceWords = lower.split(/\W+/).filter(Boolean);
      const sentenceStems = new Set(sentenceWords.map(stemWord).filter(Boolean));

      let matchedCount = 0;
      const matchedKws = new Set();

      for (const [stem, kw] of queryStems.entries()) {
        if (sentenceStems.has(stem)) {
          matchedCount++;
          matchedKws.add(kw);
        }
      }

      if (matchedCount > 0) {
        const coverageRatio = matchedCount / queryStems.size;
        
        // Check for exact multi-word n-gram matches from query
        let exactPhraseBonus = 0;
        for (let i = 0; i < rawKeywords.length - 1; i++) {
          const bigram = `${rawKeywords[i]} ${rawKeywords[i + 1]}`;
          if (lower.includes(bigram)) {
            exactPhraseBonus += 8;
          }
        }

        const score = (matchedCount * 5) + (coverageRatio * 10) + exactPhraseBonus;

        rawCandidates.push({
          score,
          matchedCount,
          coverageRatio,
          matchedKws: Array.from(matchedKws),
          text: clean,
          docTitle: doc.metadata.title || "Document"
        });
      }
    }
  }

  if (rawCandidates.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  // Filter candidates: for multi-word queries (>=3 keywords), reject single-token coincidences
  const candidateSentences = [];
  for (const cand of rawCandidates) {
    if (queryStems.size >= 3 && cand.matchedCount < 2 && cand.coverageRatio < 0.35) {
      continue;
    }
    candidateSentences.push(cand);
  }

  if (candidateSentences.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  // Sort candidate sentences by score descending
  candidateSentences.sort((a, b) => b.score - a.score || b.matchedCount - a.matchedCount);

  // Validate best candidate against minimum threshold
  const bestCand = candidateSentences[0];
  const minRequiredScore = queryStems.size >= 3 ? 14 : (queryStems.size >= 2 ? 10 : 6);
  if (bestCand.score < minRequiredScore) {
    return NOT_FOUND_RESPONSE;
  }

  // Balanced sentence selection across distinct query keywords with deduplication
  const selectedSentences = [];

  // Helper for word-overlap deduplication (Jaccard similarity)
  function isDuplicate(textA, textB) {
    const wordsA = new Set(textA.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const wordsB = new Set(textB.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return false;

    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    const union = new Set([...wordsA, ...wordsB]).size;
    return (intersection / union) > 0.70;
  }

  // Pass 1: Select top sentence for each matched query keyword
  for (const kw of rawKeywords) {
    const candidate = candidateSentences.find(cand =>
      cand.matchedKws.includes(kw) &&
      !selectedSentences.some(sel => isDuplicate(sel.text, cand.text))
    );
    if (candidate && !selectedSentences.includes(candidate)) {
      selectedSentences.push(candidate);
    }
  }

  // Pass 2: Fill remaining top scoring sentences (up to 4 bullets max)
  for (const cand of candidateSentences) {
    if (selectedSentences.length >= 4) break;
    if (!selectedSentences.some(sel => isDuplicate(sel.text, cand.text))) {
      selectedSentences.push(cand);
    }
  }

  if (selectedSentences.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  // Format into structured Markdown with dynamic title
  const dynamicTitle = generateDynamicTitle(query);
  const formattedBullets = selectedSentences.map(s => `• ${s.text}`);

  return `${dynamicTitle}\n\n${formattedBullets.join('\n\n')}`;
}

function getConfiguredGeminiKey(overrideKey = null) {
  dotenv.config();
  const key = overrideKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const cleaned = key.trim().replace(/^["']|["']$/g, '');
  if (!cleaned || cleaned === "your_gemini_api_key_here") return null;
  return cleaned;
}

// -----------------------------
// EXECUTE QA CHAIN (FRESH EVALUATION PER QUERY)
// -----------------------------
async function executeQa(vectorStore, query, userRole = "General", apiKey = null) {
  if (!query || !query.trim()) {
    return {
      answer: NOT_FOUND_RESPONSE,
      citations: []
    };
  }

  if (!vectorStore) {
    return {
      answer: NOT_FOUND_RESPONSE,
      citations: []
    };
  }

  const docs = vectorStore.search(query, 8);

  if (!docs || docs.length === 0) {
    return {
      answer: NOT_FOUND_RESPONSE,
      citations: []
    };
  }

  const citations = docs.map(d => ({
    source: d.metadata.source || "Document",
    title: d.metadata.title || "Untitled Document",
    page: (parseInt(d.metadata.page, 10) || 0) + 1,
    sheet_name: d.metadata.sheet_name || null,
    category: d.metadata.category || "General",
    content: d.pageContent.trim()
  }));

  const effectiveApiKey = getConfiguredGeminiKey(apiKey);

  let answer = NOT_FOUND_RESPONSE;

  if (!effectiveApiKey) {
    answer = generateOfflineAnswer(query, docs);
  } else {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(effectiveApiKey);

      const context = docs.map(d => {
        const pageNum = (parseInt(d.metadata.page, 10) || 0) + 1;
        const pageOrSheet = d.metadata.sheet_name ? `Sheet: ${d.metadata.sheet_name}` : `Page: ${pageNum}`;
        return `[Document: ${d.metadata.title || 'Doc'}, ${pageOrSheet}]\n${d.pageContent}`;
      }).join("\n\n");

      const systemPrompt =
        "You are a strict and accurate Document Q&A Assistant.\n\n" +
        "CRITICAL INSTRUCTIONS:\n" +
        "1. You MUST answer the user's question ONLY and ENTIRELY using the provided Document Context below.\n" +
        "2. Do NOT extrapolate, speculate, or bring in any outside knowledge or general knowledge.\n" +
        "3. If the provided context does NOT contain enough relevant information to answer the question accurately, " +
        "you MUST reply with ONLY this exact phrase (without quotes or extra text):\n" +
        `${NOT_FOUND_RESPONSE}\n` +
        "4. If the information is present in the context, provide a clear, crisp, and well-structured response in complete grammatical sentences using clean bullet points. Avoid quoting table of contents, raw page numbers, or empty form fields.\n\n" +
        `--- DOCUMENT CONTEXT ---\n${context}\n\n` +
        `User Question: ${query}`;

      let rawAnswer = null;
      const modelsToTry = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash", "gemini-pro"];

      for (const modelName of modelsToTry) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(systemPrompt);
          const responseText = result.response.text();
          if (responseText && responseText.trim()) {
            rawAnswer = responseText.trim();
            break;
          }
        } catch (mErr) {
          continue;
        }
      }

      if (!rawAnswer) {
        answer = generateOfflineAnswer(query, docs);
      } else if (
        rawAnswer.toLowerCase().includes(NOT_FOUND_RESPONSE.toLowerCase()) ||
        rawAnswer.toLowerCase().includes("only related to retail sop") ||
        rawAnswer.toLowerCase().includes("not relevant to the uploaded document") ||
        rawAnswer.toLowerCase().includes("does not contain") ||
        rawAnswer.toLowerCase().includes("cannot find") ||
        rawAnswer.toLowerCase().includes("could not find")
      ) {
        answer = NOT_FOUND_RESPONSE;
      } else {
        answer = rawAnswer;
      }
    } catch (err) {
      console.warn("Gemini generation error, falling back to offline keyword match:", err.message);
      answer = generateOfflineAnswer(query, docs);
    }
  }

  if (answer === NOT_FOUND_RESPONSE) {
    return {
      answer: NOT_FOUND_RESPONSE,
      citations: []
    };
  }

  return {
    answer,
    citations
  };
}

module.exports = {
  NOT_FOUND_RESPONSE,
  loadRawDocuments,
  processDocument,
  splitTextRecursively,
  InMemoryVectorStore,
  rebuildVectorStore,
  getVectorStore,
  cleanSentence,
  isNoiseSentence,
  generateDynamicTitle,
  generateOfflineAnswer,
  getConfiguredGeminiKey,
  executeQa
};
