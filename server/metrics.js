/** Aggregate funnel and activation metrics, independent of page size. */
export function calculateMetrics(db, includeDemo = true) {
  const filter = includeDemo ? '' : 'WHERE s.is_demo=0';
  const teamFilter = includeDemo
    ? ''
    : 'AND team_id IN (SELECT t.id FROM teams t JOIN schools s ON s.id=t.school_id WHERE s.is_demo=0)';
  const teams = db
    .prepare(
      `SELECT
    COUNT(*) total, SUM(CASE WHEN t.started_at IS NOT NULL THEN 1 ELSE 0 END) started,
    SUM(CASE WHEN sub.id IS NOT NULL THEN 1 ELSE 0 END) submitted,
    SUM(CASE WHEN sub.status='approved' THEN 1 ELSE 0 END) approved,
    SUM(CASE WHEN sub.status='pending' THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN sub.status='returned' THEN 1 ELSE 0 END) returned,
    SUM(CASE WHEN t.referred_by_school_id IS NOT NULL AND t.referred_by_school_id<>t.school_id THEN 1 ELSE 0 END) referrals,
    SUM(CASE WHEN sub.status='approved' AND t.referred_by_school_id IS NOT NULL AND t.referred_by_school_id<>t.school_id THEN 1 ELSE 0 END) "referralsApproved"
    FROM teams t JOIN schools s ON s.id=t.school_id
    LEFT JOIN submissions sub ON sub.id=(SELECT id FROM submissions WHERE team_id=t.id ORDER BY updated_at DESC LIMIT 1) ${filter}`,
    )
    .get();
  const funnel = Object.fromEntries(
    Object.entries(teams)
      .filter(([k]) => !k.startsWith('referrals'))
      .map(([k, v]) => [k, v || 0]),
  );
  funnel.conversion = funnel.total ? +((funnel.approved / funnel.total) * 100).toFixed(1) : 0;
  const usage = db
    .prepare(
      `SELECT COUNT(*) requests, SUM(CASE WHEN status='ok' AND source='llm' THEN 1 ELSE 0 END) llm_success,
    SUM(prompt_tokens) prompt_tokens, SUM(completion_tokens) completion_tokens,
    AVG(CASE WHEN source='llm' AND status='ok' THEN latency_ms END) latency_ms
    FROM llm_calls WHERE 1=1 ${teamFilter}`,
    )
    .get();
  // Aggregate historical events without loading all notes/events into process memory.
  const median = db
    .prepare(
      `WITH first_values AS (
    SELECT (julianday(n.created_at)-julianday(c.created_at))*1440 minutes,
      ROW_NUMBER() OVER (ORDER BY (julianday(n.created_at)-julianday(c.created_at))) rn,
      COUNT(*) OVER () n FROM events c JOIN events n ON n.team_id=c.team_id AND n.type='first_note'
    JOIN teams t ON t.id=c.team_id JOIN schools s ON s.id=t.school_id
    WHERE c.type='team_created' AND n.created_at>=c.created_at ${includeDemo ? '' : 'AND s.is_demo=0'}
  ) SELECT AVG(minutes) median FROM first_values WHERE rn IN ((n+1)/2, (n+2)/2)`,
    )
    .get().median;
  const measuredTeams = db
    .prepare(
      `SELECT COUNT(*) n FROM events e JOIN events c ON c.team_id=e.team_id
    AND c.type='team_created' AND e.created_at>=c.created_at JOIN teams t ON t.id=e.team_id
    JOIN schools s ON s.id=t.school_id WHERE e.type='first_note' ${includeDemo ? '' : 'AND s.is_demo=0'}`,
    )
    .get().n;
  const retention = db
    .prepare(
      `SELECT COUNT(*) eligible, SUM(CASE WHEN EXISTS (
    SELECT 1 FROM events a WHERE a.team_id=n.team_id AND a.type='activity'
    AND a.created_at>=datetime(n.created_at, '+6 days') AND a.created_at<=datetime(n.created_at, '+8 days')
    ) THEN 1 ELSE 0 END) returned FROM events n JOIN teams t ON t.id=n.team_id
    JOIN schools s ON s.id=t.school_id WHERE n.type='first_note' AND n.created_at<=datetime('now', '-8 days')
    ${includeDemo ? '' : 'AND s.is_demo=0'}`,
    )
    .get();
  return {
    ...teams,
    funnel,
    usage,
    activation: {
      medianFirstValueMinutes: median,
      measuredTeams,
      d7Eligible: retention.eligible,
      d7Returned: retention.returned || 0,
      d7Percent: retention.eligible ? +((retention.returned / retention.eligible) * 100).toFixed(1) : null,
    },
  };
}
