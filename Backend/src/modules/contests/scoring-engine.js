/**
 * scoring-engine.js — Pure ICPC-style scoring for contests.
 *
 * No I/O, no DB, no imports from fs/child_process/pg.
 * Exported for direct property-based testing.
 */

/**
 * Compute ICPC-style standings from participations and submissions.
 *
 * @param {Array<{ id: number, userId: number, username: string, startedAt: string|Date, isVirtual: boolean }>} participations
 * @param {Array<{ participationId: number, problemId: number, status: string, createdAt: string|Date }>} submissions
 * @returns {Array<StandingEntry>} sorted by rank
 *
 * StandingEntry = {
 *   rank: number,
 *   participationId: number,
 *   userId: number,
 *   username: string,
 *   isVirtual: boolean,
 *   solvedCount: number,
 *   penaltyTime: number,
 *   problems: Object<number, { attempts: number, acceptedAt: Date|null, penaltyMinutes: number, isFirstSolve: boolean }>
 * }
 */
export function computeICPCStandings(participations, submissions) {
  if (!participations || participations.length === 0) return [];

  // 1. Build a map: participationId → participation for quick lookup
  const participationMap = new Map();
  for (const p of participations) {
    participationMap.set(p.id, {
      ...p,
      startedAt: new Date(p.startedAt),
    });
  }

  // 2. Build a map: (participationId, problemId) → sorted submissions[]
  //    Key format: "participationId:problemId"
  const groupMap = new Map();
  for (const sub of submissions) {
    if (!participationMap.has(sub.participationId)) continue;
    const key = `${sub.participationId}:${sub.problemId}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key).push({
      ...sub,
      createdAt: new Date(sub.createdAt),
    });
  }

  // Sort each group by createdAt
  for (const group of groupMap.values()) {
    group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // 3. For each (participationId, problemId) group, compute problem result
  //    problemResults: Map<"participationId:problemId", { attempts, acceptedAt, penaltyMinutes, solved }>
  const problemResults = new Map();
  for (const [key, subs] of groupMap.entries()) {
    const [pidStr, _probIdStr] = key.split(':');
    const participationId = Number(pidStr);
    const participation = participationMap.get(participationId);

    let wrongBefore = 0;
    let acceptedAt = null;

    for (const sub of subs) {
      if (sub.status === 'ACCEPTED') {
        acceptedAt = sub.createdAt;
        break;
      }
      wrongBefore++;
    }

    let penaltyMinutes = 0;
    if (acceptedAt) {
      const elapsedMs = acceptedAt.getTime() - participation.startedAt.getTime();
      penaltyMinutes = Math.floor(elapsedMs / 60000) + 20 * wrongBefore;
    }

    const totalAttempts = acceptedAt
      ? wrongBefore + 1
      : subs.length;

    problemResults.set(key, {
      attempts: totalAttempts,
      acceptedAt,
      penaltyMinutes,
      solved: acceptedAt !== null,
    });
  }

  // 4. Aggregate per participant: solvedCount, totalPenalty, problems map
  const standingsRaw = [];
  for (const participation of participations) {
    if (!participationMap.has(participation.id)) continue;

    let solvedCount = 0;
    let totalPenalty = 0;
    const problems = {};

    // Find all problem groups for this participation
    for (const [key, result] of problemResults.entries()) {
      const [pidStr, probIdStr] = key.split(':');
      if (Number(pidStr) !== participation.id) continue;

      const problemId = Number(probIdStr);
      problems[problemId] = {
        attempts: result.attempts,
        acceptedAt: result.acceptedAt,
        penaltyMinutes: result.penaltyMinutes,
        isFirstSolve: false, // will be set in step 7
      };

      if (result.solved) {
        solvedCount++;
        totalPenalty += result.penaltyMinutes;
      }
    }

    standingsRaw.push({
      participationId: participation.id,
      userId: participation.userId,
      username: participation.username,
      isVirtual: participation.isVirtual,
      solvedCount,
      penaltyTime: totalPenalty,
      problems,
    });
  }

  // 5. Sort by (solvedCount DESC, penaltyTime ASC)
  standingsRaw.sort((a, b) => {
    if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
    return a.penaltyTime - b.penaltyTime;
  });

  // 6. Assign ranks with ties
  for (let i = 0; i < standingsRaw.length; i++) {
    if (
      i === 0 ||
      standingsRaw[i].solvedCount !== standingsRaw[i - 1].solvedCount ||
      standingsRaw[i].penaltyTime !== standingsRaw[i - 1].penaltyTime
    ) {
      standingsRaw[i].rank = i + 1;
    } else {
      standingsRaw[i].rank = standingsRaw[i - 1].rank;
    }
  }

  // 7. Mark first-solves per problem (earliest acceptedAt across ALL participants)
  const firstSolveMap = new Map(); // problemId → earliest acceptedAt
  for (const [key, result] of problemResults.entries()) {
    if (!result.solved) continue;
    const [_pidStr, probIdStr] = key.split(':');
    const problemId = Number(probIdStr);
    const current = firstSolveMap.get(problemId);
    if (!current || result.acceptedAt.getTime() < current.getTime()) {
      firstSolveMap.set(problemId, result.acceptedAt);
    }
  }

  // Mark isFirstSolve on each participant's problem entry
  for (const entry of standingsRaw) {
    for (const [probIdStr, probData] of Object.entries(entry.problems)) {
      const problemId = Number(probIdStr);
      if (
        probData.acceptedAt &&
        firstSolveMap.has(problemId) &&
        probData.acceptedAt.getTime() === firstSolveMap.get(problemId).getTime()
      ) {
        probData.isFirstSolve = true;
      }
    }
  }

  return standingsRaw;
}
