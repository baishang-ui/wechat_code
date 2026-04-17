const { db, runInTransaction } = require('../db');

const MAX_ACTIVE_TODOS = 5;

function createHttpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function normalizeTimestamp(value, fallback = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }

  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return fallback;
}

function sanitizeTitle(title) {
  return String(title || '').trim();
}

function toBooleanInt(value, fallback = 0) {
  if (value === undefined) {
    return fallback ? 1 : 0;
  }

  return value ? 1 : 0;
}

function createTodoId() {
  return `todo-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function mapTodo(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    completed: Boolean(row.completed),
    deleted: Boolean(row.deleted),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version
  };
}

const statements = {
  getTodoById: db.prepare(`
    SELECT id, title, completed, deleted, source, created_at, updated_at, deleted_at, version
    FROM todos
    WHERE id = ?
  `),
  listTodos: db.prepare(`
    SELECT id, title, completed, deleted, source, created_at, updated_at, deleted_at, version
    FROM todos
    ORDER BY deleted ASC, completed ASC, updated_at DESC
  `),
  listActiveTodos: db.prepare(`
    SELECT id, title, completed, deleted, source, created_at, updated_at, deleted_at, version
    FROM todos
    WHERE deleted = 0
    ORDER BY completed ASC, updated_at DESC
  `),
  countActiveTodos: db.prepare(`
    SELECT COUNT(1) AS count
    FROM todos
    WHERE deleted = 0
  `),
  insertTodo: db.prepare(`
    INSERT INTO todos (id, title, completed, deleted, source, created_at, updated_at, deleted_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateTodo: db.prepare(`
    UPDATE todos
    SET title = ?, completed = ?, deleted = ?, source = ?, created_at = ?, updated_at = ?, deleted_at = ?, version = ?
    WHERE id = ?
  `),
  insertEvent: db.prepare(`
    INSERT INTO sync_events (event_type, source, payload, created_at)
    VALUES (?, ?, ?, ?)
  `),
  listEvents: db.prepare(`
    SELECT id, event_type, source, payload, created_at
    FROM sync_events
    ORDER BY id DESC
    LIMIT ?
  `)
};

function recordEvent(eventType, source, payload) {
  statements.insertEvent.run(
    eventType,
    String(source || 'system'),
    JSON.stringify(payload || {}),
    Date.now()
  );
}

function listTodos(options = {}) {
  const rows = options.includeDeleted
    ? statements.listTodos.all()
    : statements.listActiveTodos.all();

  return rows.map(mapTodo);
}

function getTodoById(id) {
  return mapTodo(statements.getTodoById.get(id));
}

function getActiveTodoCount() {
  const row = statements.countActiveTodos.get();
  return row ? Number(row.count) || 0 : 0;
}

function listEvents(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return statements.listEvents.all(safeLimit).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    source: row.source,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at
  }));
}

function saveIncomingTodo(input) {
  return runInTransaction(() => {
    const source = String(input.source || 'system');
    const id = String(input.id || createTodoId()).trim();
    const current = statements.getTodoById.get(id);
    const existing = mapTodo(current);
    const incomingUpdatedAt = normalizeTimestamp(
      input.updatedAt,
      existing ? existing.updatedAt : Date.now()
    );

    if (existing && incomingUpdatedAt < existing.updatedAt) {
      recordEvent('todo.ignored_stale', source, {
        id,
        incomingUpdatedAt,
        currentUpdatedAt: existing.updatedAt
      });
      return {
        applied: false,
        stale: true,
        todo: existing
      };
    }

    const deleted = input.deleted !== undefined ? Boolean(input.deleted) : existing ? existing.deleted : false;
    const title = sanitizeTitle(
      input.title !== undefined
        ? input.title
        : existing
          ? existing.title
          : deleted
            ? 'Deleted item'
            : ''
    );

    if (!deleted && !title) {
      throw createHttpError(400, 'title 不能为空');
    }

    if (!existing && !deleted && getActiveTodoCount() >= MAX_ACTIVE_TODOS) {
      throw createHttpError(400, `最多只能保留 ${MAX_ACTIVE_TODOS} 条待办`);
    }

    const completed =
      input.completed !== undefined
        ? Boolean(input.completed)
        : existing
          ? existing.completed
          : false;
    const createdAt = existing
      ? existing.createdAt
      : normalizeTimestamp(input.createdAt, incomingUpdatedAt);
    const deletedAt = deleted ? incomingUpdatedAt : null;
    const version = existing ? existing.version + 1 : 1;

    const payload = {
      id,
      title: title || (existing ? existing.title : 'Deleted item'),
      completed,
      deleted,
      source,
      createdAt,
      updatedAt: incomingUpdatedAt,
      deletedAt,
      version
    };

    if (existing) {
      statements.updateTodo.run(
        payload.title,
        toBooleanInt(payload.completed),
        toBooleanInt(payload.deleted),
        payload.source,
        payload.createdAt,
        payload.updatedAt,
        payload.deletedAt,
        payload.version,
        payload.id
      );
    } else {
      statements.insertTodo.run(
        payload.id,
        payload.title,
        toBooleanInt(payload.completed),
        toBooleanInt(payload.deleted),
        payload.source,
        payload.createdAt,
        payload.updatedAt,
        payload.deletedAt,
        payload.version
      );
    }

    recordEvent(
      deleted
        ? existing
          ? 'todo.deleted'
          : 'todo.deleted_tombstone'
        : existing
          ? 'todo.updated'
          : 'todo.created',
      source,
      payload
    );

    return {
      applied: true,
      stale: false,
      todo: payload
    };
  });
}

function createTodo({ title, source = 'miniapp' }) {
  return saveIncomingTodo({
    id: createTodoId(),
    title,
    completed: false,
    deleted: false,
    source,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }).todo;
}

function updateTodo(id, changes, source = 'miniapp') {
  const current = getTodoById(id);

  if (!current || current.deleted) {
    throw createHttpError(404, '待办不存在');
  }

  return saveIncomingTodo({
    id,
    title: changes.title !== undefined ? changes.title : current.title,
    completed: changes.completed !== undefined ? changes.completed : current.completed,
    deleted: false,
    source,
    createdAt: current.createdAt,
    updatedAt: Date.now()
  }).todo;
}

function deleteTodo(id, source = 'miniapp') {
  const current = getTodoById(id);

  if (!current || current.deleted) {
    throw createHttpError(404, '待办不存在');
  }

  return saveIncomingTodo({
    id,
    title: current.title,
    completed: current.completed,
    deleted: true,
    source,
    createdAt: current.createdAt,
    updatedAt: Date.now()
  }).todo;
}

function normalizeSyncMessage(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const rawType = String(input.type || input.action || input.event || '').trim().toLowerCase();
  if (rawType) {
    const explicitMap = {
      upsert: 'todo.upsert',
      update: 'todo.upsert',
      create: 'todo.upsert',
      add: 'todo.upsert',
      delete: 'todo.delete',
      remove: 'todo.delete',
      del: 'todo.delete',
      pull: 'todo.pull',
      sync: 'todo.pull'
    };
    const mappedType = explicitMap[rawType] || rawType;

    if (mappedType.startsWith('todo.')) {
      return {
        ...input,
        type: mappedType
      };
    }
  }

  if (Array.isArray(input.todos)) {
    return {
      type: 'todo.batch',
      todos: input.todos,
      source: input.source,
      updatedAt: input.updatedAt
    };
  }

  const todo = input.todo && typeof input.todo === 'object'
    ? input.todo
    : input;
  const id = todo && String(todo.id || '').trim();
  const hasTodoFields = Boolean(todo && todo.completed !== undefined);
  const wantsDelete = Boolean(
    todo &&
    (todo.deleted === true || String(todo.op || '').trim().toLowerCase() === 'delete')
  );

  if (id && (hasTodoFields || wantsDelete)) {
    if (wantsDelete) {
      return {
        type: 'todo.delete',
        id,
        title: todo.title,
        createdAt: todo.createdAt,
        updatedAt: todo.updatedAt,
        source: input.source
      };
    }

    return {
      type: 'todo.upsert',
      todo: {
        id,
        completed: todo.completed,
        updatedAt: todo.updatedAt
      },
      updatedAt: todo.updatedAt,
      source: input.source
    };
  }

  return null;
}

function applySyncMessage(message, fallbackSource = 'hardware') {
  if (!message || typeof message !== 'object') {
    throw createHttpError(400, '消息体必须是 JSON 对象');
  }

  const normalizedMessage = normalizeSyncMessage(message) || message;
  const type = String(normalizedMessage.type || '').trim();
  const source = String(normalizedMessage.source || fallbackSource || 'hardware');

  if (type === 'todo.pull') {
    recordEvent('todo.pull_requested', source, normalizedMessage);
    return {
      changed: false,
      reason: 'pull',
      todo: null
    };
  }

  if (type === 'todo.batch') {
    const todos = Array.isArray(normalizedMessage.todos) ? normalizedMessage.todos : [];
    let changed = false;

    todos.forEach((todoItem) => {
      const targetId = todoItem && String(todoItem.id || '').trim();
      const current = getTodoById(targetId);

      if (!targetId || !current || current.deleted) {
        return;
      }

      const result = saveIncomingTodo({
        id: targetId,
        completed: todoItem && todoItem.completed,
        title: current.title,
        deleted: false,
        source,
        createdAt: current.createdAt,
        updatedAt: (todoItem && todoItem.updatedAt) || normalizedMessage.updatedAt
      });

      changed = changed || Boolean(result.applied);
    });

    return {
      changed,
      reason: 'batch',
      todo: null
    };
  }

  if (type === 'todo.upsert') {
    const todo = normalizedMessage.todo || {};
    const targetId = String(todo.id || '').trim();
    const current = getTodoById(targetId);

    if (!targetId) {
      throw createHttpError(400, '缺少待办 id');
    }

    if (!current || current.deleted) {
      throw createHttpError(404, '待办不存在');
    }

    const result = saveIncomingTodo({
      id: targetId,
      title: current.title,
      completed: todo.completed,
      deleted: false,
      source,
      createdAt: current.createdAt,
      updatedAt: todo.updatedAt || normalizedMessage.updatedAt
    });

    return {
      changed: result.applied,
      reason: result.stale ? 'stale' : 'upsert',
      todo: result.todo
    };
  }

  if (type === 'todo.delete') {
    const targetId = String(
      normalizedMessage.id || (normalizedMessage.todo && normalizedMessage.todo.id) || ''
    ).trim();

    if (!targetId) {
      throw createHttpError(400, '删除消息缺少 id');
    }

    const current = getTodoById(targetId);
    const result = saveIncomingTodo({
      id: targetId,
      title: current ? current.title : normalizedMessage.title,
      completed: current ? current.completed : false,
      deleted: true,
      source,
      createdAt: current ? current.createdAt : normalizeTimestamp(normalizedMessage.createdAt),
      updatedAt: normalizedMessage.updatedAt || Date.now()
    });

    return {
      changed: result.applied,
      reason: result.stale ? 'stale' : 'delete',
      todo: result.todo
    };
  }

  throw createHttpError(400, `不支持的消息类型: ${type || '(empty)'}`);
}
module.exports = {
  createHttpError,
  listTodos,
  getTodoById,
  listEvents,
  createTodo,
  updateTodo,
  deleteTodo,
  applySyncMessage
};

