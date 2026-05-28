/**
 * Profile helpers — extracted from index.js
 * Provides getProfileId, getProfileIds, profileWhere, profileInClause, profileParams
 */

// Helper: get profile ID from request (header first, then query param, then 1)
function getProfileId(req) {
  return parseInt(req.headers['x-profile-id'] || req.query.profile_id || 1);
}

// Helper: get profile IDs from request (supports JSON array via header)
function getProfileIds(req) {
  const header = req.headers['x-profile-ids'];
  if (header) {
    try {
      const parsed = JSON.parse(header);
      if (Array.isArray(parsed) && parsed.length > 0)
        return parsed.map((id) => parseInt(id)).filter((id) => !isNaN(id));
    } catch (e) {
      // single ID fallback
    }
  }
  const qp = req.query.profile_ids;
  if (qp) {
    const ids = String(qp)
      .split(',')
      .map((id) => parseInt(id.trim()))
      .filter((id) => !isNaN(id));
    if (ids.length > 0) return ids;
  }
  return [getProfileId(req)];
}

// Helper: wrap all data queries with profile_id
function profileWhere(tableAlias = 't', extra = '') {
  return `${tableAlias}.profile_id = ?${extra ? ' AND ' + extra : ''}`;
}

// Helper: build profile IN clause for multiple profiles
function profileInClause(tableAlias = 't', extra = '') {
  const placeholder = extra
    ? `${tableAlias}.profile_id IN (?) AND ${extra}`
    : `${tableAlias}.profile_id IN (?)`;
  return placeholder;
}

// Helper: wrap query params with profile IDs for IN clause
function profileParams(pids, extra = []) {
  return [...pids, ...extra];
}

module.exports = { getProfileId, getProfileIds, profileWhere, profileInClause, profileParams };
