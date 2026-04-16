const express = require('express');
const cors = require('cors');
const { config } = require('./config');
const {
  createHttpError,
  listTodos,
  getTodoById,
  listEvents,
  createTodo,
  updateTodo,
  deleteTodo,
  applySyncMessage
} = require('./services/todoService');
const { AliyunIotService } = require('./services/iotService');

const app = express();
const iotService = new AliyunIotService(config.aliyun);

app.use(cors());
app.use(express.json({ limit: '512kb' }));

function extractToken(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  return String(req.headers['x-api-key'] || '').trim();
}

function requireToken(expectedToken, label) {
  return (req, res, next) => {
    if (!expectedToken) {
      next();
      return;
    }

    const providedToken = extractToken(req);
    if (providedToken !== expectedToken) {
      next(createHttpError(401, `${label} token 无效`));
      return;
    }

    next();
  };
}

async function syncSnapshot(reason) {
  const todos = listTodos();
  await iotService.publishSnapshot(todos, reason);
  return todos;
}

async function handleSyncMessage(message, sourceLabel) {
  const result = applySyncMessage(message, sourceLabel);

  if (result.reason === 'pull') {
    const todos = await syncSnapshot('device.pull');
    return {
      ...result,
      todos
    };
  }

  if (result.changed) {
    await syncSnapshot(`sync.${result.reason}`);
  }

  return result;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'todo-iot-backend',
    time: Date.now(),
    iotEnabled: iotService.isEnabled()
  });
});

app.get('/api/todos', requireToken(config.miniappApiToken, 'miniapp'), (req, res) => {
  const includeDeleted = String(req.query.includeDeleted || '').trim() === 'true';
  res.json({
    items: listTodos({ includeDeleted })
  });
});

app.get('/api/todos/:id', requireToken(config.miniappApiToken, 'miniapp'), (req, res, next) => {
  try {
    const todo = getTodoById(req.params.id);

    if (!todo || todo.deleted) {
      throw createHttpError(404, '待办不存在');
    }

    res.json(todo);
  } catch (error) {
    next(error);
  }
});

app.post('/api/todos', requireToken(config.miniappApiToken, 'miniapp'), async (req, res, next) => {
  try {
    const todo = createTodo({
      title: req.body && req.body.title,
      source: 'miniapp'
    });

    await syncSnapshot('miniapp.create');
    res.status(201).json(todo);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/todos/:id', requireToken(config.miniappApiToken, 'miniapp'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.title === undefined && body.completed === undefined) {
      throw createHttpError(400, '至少传 title 或 completed');
    }

    const todo = updateTodo(req.params.id, body, 'miniapp');
    await syncSnapshot('miniapp.update');
    res.json(todo);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/todos/:id', requireToken(config.miniappApiToken, 'miniapp'), async (req, res, next) => {
  try {
    const todo = deleteTodo(req.params.id, 'miniapp');
    await syncSnapshot('miniapp.delete');
    res.json(todo);
  } catch (error) {
    next(error);
  }
});

app.get('/api/events', requireToken(config.miniappApiToken, 'miniapp'), (req, res) => {
  const limit = req.query.limit;
  res.json({
    items: listEvents(limit)
  });
});

app.post('/api/device/messages', requireToken(config.deviceApiToken, 'device'), async (req, res, next) => {
  try {
    const result = await handleSyncMessage(req.body, 'device-http');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((req, res, next) => {
  next(createHttpError(404, '接口不存在'));
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  const body = {
    message: error.message || '服务器错误'
  };

  if (error.details) {
    body.details = error.details;
  }

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json(body);
});

const server = app.listen(config.port, () => {
  console.log(`todo backend listening on http://localhost:${config.port}`);
  console.log(`db file: ${config.dbFile}`);
  console.log(`[iot] mqtt device login disabled`);
  console.log(`[iot] accessKey configured: ${config.aliyun.accessKeyId ? 'yes' : 'no'}`);
  console.log(`[iot] tls flag (mqtt legacy): ${config.aliyun.useTls ? 'enabled' : 'disabled'}`);
  console.log(`[iot] publish topic: ${config.aliyun.commandTopic || '(none)'}`);
  console.log(`[iot] report topic (handled outside backend mqtt): ${config.aliyun.reportTopic || '(none)'}`);
  iotService.start();
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
