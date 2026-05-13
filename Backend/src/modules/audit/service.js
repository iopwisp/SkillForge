import * as q from './queries.js';

export async function recordEvent(actor, {
  action,
  entityType,
  entityKey,
  details = {},
}, { db: executor } = {}) {
  await q.insertAuditEvent({
    actorId: actor.id,
    actorUsername: actor.username,
    actorRole: actor.role,
    action,
    entityType,
    entityKey,
    details,
  }, executor);
}

export async function listEvents({
  action,
  actorUsername,
  entityType,
  entityKey,
  page,
  pageSize,
}) {
  const pageNumber = Math.max(parseInt(page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(pageSize || '50', 10), 1), 200);
  const offset = (pageNumber - 1) * limit;

  const where = [];
  const args = [];

  if (action) {
    where.push('action = ?');
    args.push(String(action).toUpperCase());
  }
  if (entityType) {
    where.push('entity_type = ?');
    args.push(String(entityType).toUpperCase());
  }
  if (actorUsername) {
    where.push('actor_username = ?');
    args.push(String(actorUsername));
  }
  if (entityKey) {
    where.push('entity_key ILIKE ?');
    args.push(`%${String(entityKey)}%`);
  }

  const { rows, total } = await q.listAuditEvents({
    where, args, limit, offset,
  });

  return {
    items: rows.map((row) => ({
      id: row.id,
      actor: {
        id: row.actor_id,
        username: row.actor_username,
        role: row.actor_role,
      },
      action: row.action,
      entityType: row.entity_type,
      entityKey: row.entity_key,
      details: row.details_json || {},
      createdAt: row.created_at,
    })),
    total,
    page: pageNumber,
    pageSize: limit,
  };
}
