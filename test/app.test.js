const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const app = require('../server');

// Paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const DOCS_DIR = path.join(DATA_DIR, 'documents');
const DOC_STORE_FILE = path.join(DATA_DIR, 'document_store.json');
const LOGS_FILE = path.join(DATA_DIR, 'chat_logs.json');
const USER_HISTORIES_FILE = path.join(DATA_DIR, 'user_histories.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Test files
const TEST_PDF = path.join(__dirname, 'test_returns_policy.pdf');
const TEST_XLSX = path.join(__dirname, 'test_inventory_data.xlsx');
const TEST_CSV = path.join(__dirname, 'test_pricing_rules.csv');
const TEST_TXT = path.join(__dirname, 'test_store_hours.txt');

// Helper to create minimal PDF
function createDummyPdf(filePath, text) {
  const pdfContent = (
    "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 595 842] /Contents 4 0 R >>\nendobj\n" +
    "4 0 obj\n<< /Length 100 >>\nstream\n" +
    "BT\n/F1 12 Tf\n72 712 Td\n(" + text + ") Tj\nET\n" +
    "endstream\nendobj\n" +
    "xref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000056 00000 n\n0000000111 00000 n\n0000000252 00000 n\n" +
    "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n397\n%%EOF\n"
  );
  fs.writeFileSync(filePath, Buffer.from(pdfContent, 'latin1'));
}

test.describe('Retail SOP Node.js Application Suite', () => {
  let authToken = null;
  let registeredUsername = `testuser_${Date.now()}`;

  test.before(() => {
    // Generate dummy files
    createDummyPdf(TEST_PDF, "Cashiers must verify original sales receipt for all customer returns under fifty dollars.");
    
    // Create Excel
    const wb = xlsx.utils.book_new();
    const wsData = [
      ["Item Code", "Item Name", "Stock Level", "Storage Condition"],
      ["SKU101", "Organic Milk", 45, "Refrigerated at four degrees"],
      ["SKU102", "Artisan Bread", 20, "Dry ambient shelf"]
    ];
    const ws = xlsx.utils.aoa_to_sheet(wsData);
    xlsx.utils.book_append_sheet(wb, ws, "Inventory");
    xlsx.writeFile(wb, TEST_XLSX);

    // Create CSV
    const csvData = "Rule ID,Discount Type,Policy Detail\nR-1,Senior Discount,Ten percent off every Tuesday\nR-2,Bulk Purchase,Five percent off on orders exceeding one hundred dollars";
    fs.writeFileSync(TEST_CSV, csvData, 'utf-8');

    // Create TXT
    const txtData = "Store Operating Hours: Monday through Saturday 8:00 AM to 10:00 PM. Sunday 10:00 AM to 6:00 PM.";
    fs.writeFileSync(TEST_TXT, txtData, 'utf-8');
  });

  test.after(() => {
    // Cleanup temporary test files
    [TEST_PDF, TEST_XLSX, TEST_CSV, TEST_TXT].forEach(f => {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (e) {}
      }
    });
  });

  test('1. GET /api/status - Server health and capabilities', async () => {
    const res = await request(app).get('/api/status');
    assert.equal(res.status, 200);
    assert.ok(res.body.message.includes('RAG Document Assistant API is running!'));
    assert.ok(Array.isArray(res.body.supported_formats));
    assert.ok(res.body.supported_formats.includes('.pdf'));
    assert.ok(res.body.supported_formats.includes('.xlsx'));
  });

  test('2. POST /api/auth/register & login - Account creation and JWT generation', async () => {
    // Register
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        username: registeredUsername,
        password: 'password123',
        fullName: 'Test Operator',
        role: 'Manager'
      });
    assert.equal(regRes.status, 201);
    assert.ok(regRes.body.token);
    assert.equal(regRes.body.user.username, registeredUsername);
    assert.equal(regRes.body.user.role, 'Manager');

    // Login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        username: registeredUsername,
        password: 'password123'
      });
    assert.equal(loginRes.status, 200);
    assert.ok(loginRes.body.token);
    authToken = loginRes.body.token;

    // Validate /api/auth/me
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.username, registeredUsername);
  });

  test('3. Multi-format Document Ingestion (PDF, Excel, CSV, TXT)', async () => {
    // 3a. Upload PDF
    const pdfRes = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', TEST_PDF)
      .field('title', 'Returns Policy')
      .field('category', 'Returns');
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.body.document.title, 'Returns Policy');

    // 3b. Upload Excel
    const xlsxRes = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', TEST_XLSX)
      .field('title', 'Inventory Specs')
      .field('category', 'Stock');
    assert.equal(xlsxRes.status, 200);

    // 3c. Upload CSV
    const csvRes = await request(app)
      .post('/api/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', TEST_CSV)
      .field('title', 'Pricing Rules')
      .field('category', 'Pricing');
    assert.equal(csvRes.status, 200);

    // 3d. Upload via Local Path
    const pathRes = await request(app)
      .post('/api/upload_path')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        file_path: TEST_TXT,
        title: 'Store Hours',
        category: 'Operations'
      });
    assert.equal(pathRes.status, 200);

    // List documents
    const listRes = await request(app).get('/api/documents');
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.length >= 4);
  });

  test('4. Strict Grounded Chat & Citations Verification', async () => {
    // Query grounded in PDF
    const resPdf = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        query: "What is the return verification requirement for cashiers?"
      });
    assert.equal(resPdf.status, 200);
    assert.notEqual(resPdf.body.answer, "i can answer questions only related to retail SOP");
    assert.ok(resPdf.body.citations.length > 0);

    // Query grounded in Excel
    const resExcel = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        query: "What are the storage conditions for Organic Milk?"
      });
    assert.equal(resExcel.status, 200);
    assert.notEqual(resExcel.body.answer, "i can answer questions only related to retail SOP");

    // Unrelated Query -> Must strictly reject
    const resUnrelated = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        query: "What is the orbital speed of Jupiter around the sun in kilometers per hour?"
      });
    assert.equal(resUnrelated.status, 200);
    assert.equal(resUnrelated.body.answer, "i can answer questions only related to retail SOP");
    assert.equal(resUnrelated.body.citations.length, 0);
  });

  test('5. User Account History Isolation', async () => {
    // Fetch current user history
    const histRes = await request(app)
      .get('/api/history')
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(histRes.status, 200);
    assert.ok(histRes.body.length > 0);

    // Create second user
    const secondUser = `user2_${Date.now()}`;
    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({
        username: secondUser,
        password: 'password123',
        fullName: 'Second User'
      });
    assert.equal(reg2.status, 201);
    const token2 = reg2.body.token;

    // Second user history should be completely empty (isolated)
    const hist2 = await request(app)
      .get('/api/history')
      .set('Authorization', `Bearer ${token2}`);
    assert.equal(hist2.status, 200);
    assert.equal(hist2.body.length, 0);
  });

  test('6. User Feedback Submission', async () => {
    const chatRes = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query: "What is the return verification requirement?" });
    
    const messageId = chatRes.body.message_id;
    assert.ok(messageId);

    const fbRes = await request(app)
      .post('/api/feedback')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        message_id: messageId,
        rating: "thumbs_up",
        comment: "Accurate citation grounding!"
      });
    assert.equal(fbRes.status, 200);
    assert.equal(fbRes.body.message, "Feedback submitted successfully!");
  });

  test('7. Fresh Evaluation per Query & Complete Data Purge on Clear History', async () => {
    // 7a. Execute query 1
    const res1 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query: "What are the storage conditions for Organic Milk?" });
    assert.equal(res1.status, 200);
    assert.ok(res1.body.answer.length > 0);

    // 7b. Execute query 2 (freshly evaluated)
    const res2 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query: "What are the storage conditions for Organic Milk?" });
    assert.equal(res2.status, 200);
    assert.ok(res2.body.answer.length > 0);

    // 7c. Ensure history has records
    const histBefore = await request(app)
      .get('/api/history')
      .set('Authorization', `Bearer ${authToken}`);
    assert.ok(histBefore.body.length > 0);

    // 7d. Clear history and all data
    const deleteRes = await request(app)
      .delete('/api/history')
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(deleteRes.status, 200);

    // 7e. Verify history is completely empty
    const histAfter = await request(app)
      .get('/api/history')
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(histAfter.status, 200);
    assert.equal(histAfter.body.length, 0);
  });
});
