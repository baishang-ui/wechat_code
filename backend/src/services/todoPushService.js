const { WebSocketServer } = require('ws');

function extractTokenFromRequest(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const apiKey = String(req.headers['x-api-key'] || '').trim();
  if (apiKey) {
    return apiKey;
  }

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    return String(url.searchParams.get('token') || '').trim();
  } catch (error) {
    return '';
  }
}

class TodoPushService {
  constructor(expectedToken, snapshotProvider = null) {
    this.expectedToken = String(expectedToken || '').trim();
    this.snapshotProvider = typeof snapshotProvider === 'function' ? snapshotProvider : null;
    this.wss = null;
  }

  setup(server) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== '/ws/todos') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const token = extractTokenFromRequest(req);
      if (this.expectedToken && token !== this.expectedToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws) => {
      if (!this.snapshotProvider || ws.readyState !== 1) {
        return;
      }

      ws.send(JSON.stringify({
        type: 'todo.snapshot',
        reason: 'ws.connect',
        timestamp: Date.now(),
        todos: this.snapshotProvider() || []
      }));
    });
  }

  broadcast(payload) {
    if (!this.wss) {
      return;
    }

    const body = JSON.stringify(payload);
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(body);
      }
    });
  }

  broadcastSnapshot(todos, reason) {
    this.broadcast({
      type: 'todo.snapshot',
      reason: String(reason || 'sync'),
      timestamp: Date.now(),
      todos: todos || []
    });
  }

  broadcastTodo(todo, reason) {
    if (!todo) {
      return;
    }

    this.broadcast({
      type: todo.deleted ? 'todo.delete' : 'todo.upsert',
      reason: String(reason || 'sync'),
      timestamp: Date.now(),
      todo
    });
  }
}

module.exports = {
  TodoPushService
};
