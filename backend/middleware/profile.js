/**
 * Profile helpers — extracted from index.js
 * Provides getProfileId, getProfileIds, profileWhere, profileInClause, profileParams
 */

// Helper: get profile ID from request (header first, then query param, then 1)
function getProfileId(req) {
  const id = parseInt(req.headers['x-profile-id'] || req.query.profile_id || 1);
  // Fail closed: require a session and verify the profile belongs to the
  // authenticated user. Previously the ownership check was skipped entirely when
  // no session was present, which let unauthenticated callers read/modify any
  // profile simply by passing its id.
  if (!req.session || !req.session.userId) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
  if (req.repos && req.repos.profiles) {
    const profile = req.repos.profiles.getById(id);
    if (!profile || profile.user_id !== req.session.userId) {
      const err = new Error('Access denied to this profile');
      err.statusCode = 403;
      throw err;
    }
  }
  return id;
}

// Helper: get profile IDs from request (supports JSON array via header)
function getProfileIds(req) {
  let ids = [];
  const header = req.headers['x-profile-ids'];
  if (header) {
    try {
      const parsed = JSON.parse(header);
      if (Array.isArray(parsed) && parsed.length > 0)
        ids = parsed.map((id) => parseInt(id)).filter((id) => !isNaN(id));
    } catch (e) {
      // single ID fallback
    }
  }
  if (ids.length === 0) {
    const qp = req.query.profile_ids;
    if (qp) {
      ids = String(qp)
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id));
    }
  }
  if (ids.length === 0) {
    ids = [parseInt(req.headers['x-profile-id'] || req.query.profile_id || 1)];
  }
  
  // Fail closed: require a session and verify every requested profile belongs to
  // the authenticated user (see getProfileId for rationale).
  if (!req.session || !req.session.userId) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
  if (req.repos && req.repos.profiles) {
    for (const id of ids) {
      const profile = req.repos.profiles.getById(id);
      if (!profile || profile.user_id !== req.session.userId) {
        const err = new Error('Access denied to profile ' + id);
        err.statusCode = 403;
        throw err;
      }
    }
  }
  return ids;
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
