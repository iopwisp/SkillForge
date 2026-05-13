import { db } from '../../shared/db.js';

export const insertAuditEvent = ({
  actorId,
  actorUsername,
  actorRole,
  action,
  entityType,
  entityKey,
  details,
}, executor = db) =>
  executor.none(`
    INSERT INTO audit_events (
      actor_id, actor_username, actor_role,
      action, entity_type, entity_key, details_json
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    actorId ?? null,
    actorUsername,
    actorRole,
    action,
    entityType,
    entityKey,
    details ?? {},
  ]);

export async function listAuditEvents({
  where, args, limit, offset,
}, executor = db) {
  const whereSql = where.length ? `WHERE ${bindWhere(where, 1)}` : '';
  const totalRow = await executor.maybeOne(`
    SELECT COUNT(*)::int AS n
    FROM audit_events
    ${whereSql}
  `, args);

  const rows = await executor.many(`
    SELECT
      id, actor_id, actor_username, actor_role,
      action, entity_type, entity_key, details_json, created_at
    FROM audit_events
    ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT $${args.length + 1}
    OFFSET $${args.length + 2}
  `, [...args, limit, offset]);

  return { rows, total: totalRow?.n ?? 0 };
}

function bindWhere(clauses, startAt) {
  let index = startAt;
  return clauses
    .map((clause) => clause.replace(/\?/g, () => `$${index++}`))
    .join(' AND ');
}
