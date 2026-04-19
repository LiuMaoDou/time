// Time Tracker Cloud - 轻量自建后端
// 替代 Supabase，使用 SQLite 存储 + WebSocket 实时推送

const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const WebSocket = require('ws');

const PORT = parseInt(process.env.PORT || '8002', 10);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'timetracker.db');
const DATA_DIR = path.dirname(DB_PATH);

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化 SQLite
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
`);

// 预插入默认行（如果不存在）
const insertStub = db.prepare('INSERT OR IGNORE INTO app_state (id, data, updated_at) VALUES (?, ?, strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\'))');
insertStub.run('my_daily_data', '{}');

const stmtGet = db.prepare('SELECT data FROM app_state WHERE id = ?');
const stmtUpsert = db.prepare('INSERT INTO app_state (id, data, updated_at) VALUES (?, ?, strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')');

// WebSocket 实时推送
const wss = new WebSocket.Server({ noServer: true });
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    // 连接后立即推送当前数据
    try {
        const row = stmtGet.get('my_daily_data');
        if (row) {
            ws.send(JSON.stringify({ type: 'init', data: JSON.parse(row.data) }));
        }
    } catch (e) {
        console.error('WebSocket init push error:', e.message);
    }
});

function broadcastUpdate(data) {
    const msg = JSON.stringify({ type: 'update', data });
    for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
        }
    }
}

// MIME types
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

// HTTP 服务器
const server = http.createServer((req, res) => {
    // CORS - 允许所有来源
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // API: 获取数据
    if (req.method === 'GET' && req.url === '/api/data') {
        try {
            const row = stmtGet.get('my_daily_data');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'my_daily_data', data: row ? JSON.parse(row.data) : {} }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: 保存数据 (upsert)
    if ((req.method === 'POST' || req.method === 'PUT') && req.url === '/api/data') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const parsed = JSON.parse(body);
                const id = parsed.id || 'my_daily_data';
                const dataStr = JSON.stringify(parsed.data || {});

                stmtUpsert.run(id, dataStr);
                broadcastUpdate(parsed.data || {});

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, id }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // 静态文件服务（从 /opt/time/public 目录）
    const publicDir = path.join(__dirname, '..', 'public');
    let filePath = req.url.split('?')[0];
    if (filePath === '/') filePath = '/index.html';
    const fullPath = path.join(publicDir, filePath);

    // 安全：防止路径穿越
    if (!fullPath.startsWith(publicDir)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    const ext = path.extname(fullPath);
    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404);
            return res.end('Not Found');
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

// WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Time Tracker Server running on http://127.0.0.1:${PORT}`);
    console.log(`Database: ${DB_PATH}`);
    console.log(`WebSocket: ws://127.0.0.1:${PORT}`);
});

// 优雅退出
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
