/**
 * glicko2-engine.js — Pure Glicko-2 rating computation for contests.
 *
 * No I/O, no DB, no imports from fs/child_process/pg.
 * Exported for direct property-based testing.
 *
 * Reference: http://www.glicko.net/glicko/glicko2.pdf
 */

// Constants
const TAU = 0.5; // System constant (controls volatility change speed)
const EPSILON = 0.000001; // Convergence tolerance for volatility iteration
const SCALE = 173.7178; // Glicko-2 scaling factor (400 / ln(10))

/**
 * Compute Glicko-2 rating changes for all live participants after a contest.
 *
 * @param {Array<{ userId: number, rating: number, rd: number, volatility: number }>} participants
 * @param {Array<{ userId: number, rank: number }>} standings - final standings (live only)
 * @returns {Array<{ userId: number, oldRating: number, newRating: number, oldRd: number, newRd: number, delta: number }>}
 *
 * Invariant: sum(delta) ≈ 0 (within ±0.01 * N)
 */
export function computeGlicko2Changes(participants, standings) {
  if (participants.length < 2) return [];

  // Build rank map: userId → rank
  const rankMap = new Map(standings.map(s => [s.userId, s.rank]));

  // Filter to only participants who have standings
  const active = participants.filter(p => rankMap.has(p.userId));
  if (active.length < 2) return [];

  // Convert to Glicko-2 scale
  const players = active.map(p => ({
    userId: p.userId,
    mu: (p.rating - 1500) / SCALE,
    phi: p.rd / SCALE,
    sigma: p.volatility,
    rank: rankMap.get(p.userId),
    oldRating: p.rating,
    oldRd: p.rd,
  }));

  // For each player, compute new rating
  const results = players.map(player => {
    // Compute outcomes against all opponents
    const opponents = players.filter(p => p.userId !== player.userId);

    // g(φ) function
    const g = (phi) => 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));

    // E(μ, μj, φj) function
    const E = (mu, muj, phij) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

    // Compute variance v
    let vInvSum = 0;
    let deltaSum = 0;

    for (const opp of opponents) {
      const gj = g(opp.phi);
      const Ej = E(player.mu, opp.mu, opp.phi);

      // Score: 1 if player rank < opp rank (win), 0 if > (loss), 0.5 if tied
      let score;
      if (player.rank < opp.rank) score = 1;
      else if (player.rank > opp.rank) score = 0;
      else score = 0.5;

      vInvSum += gj * gj * Ej * (1 - Ej);
      deltaSum += gj * (score - Ej);
    }

    const v = 1 / vInvSum;
    const delta = v * deltaSum;

    // Compute new volatility σ' using Illinois algorithm
    const a = Math.log(player.sigma * player.sigma);
    const phiSq = player.phi * player.phi;

    const f = (x) => {
      const ex = Math.exp(x);
      const d2 = delta * delta;
      const num = ex * (d2 - phiSq - v - ex);
      const den = 2 * (phiSq + v + ex) * (phiSq + v + ex);
      return num / den - (x - a) / (TAU * TAU);
    };

    // Find bounds
    let A = a;
    let B;
    if (delta * delta > phiSq + v) {
      B = Math.log(delta * delta - phiSq - v);
    } else {
      let k = 1;
      while (f(a - k * TAU) < 0) k++;
      B = a - k * TAU;
    }

    // Illinois method iteration
    let fA = f(A);
    let fB = f(B);
    for (let i = 0; i < 100; i++) {
      if (Math.abs(B - A) <= EPSILON) break;
      const C = A + (A - B) * fA / (fB - fA);
      const fC = f(C);
      if (fC * fB <= 0) {
        A = B;
        fA = fB;
      } else {
        fA = fA / 2;
      }
      B = C;
      fB = fC;
    }

    const newSigma = Math.exp(B / 2);

    // Update phi and mu
    const phiStar = Math.sqrt(phiSq + newSigma * newSigma);
    const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const newMu = player.mu + newPhi * newPhi * deltaSum;

    // Convert back to rating scale
    const newRating = newMu * SCALE + 1500;
    const newRd = newPhi * SCALE;

    return {
      userId: player.userId,
      oldRating: player.oldRating,
      newRating: Math.round(newRating * 100) / 100,
      oldRd: player.oldRd,
      newRd: Math.round(newRd * 100) / 100,
      delta: Math.round((newRating - player.oldRating) * 100) / 100,
    };
  });

  // Normalize deltas to enforce zero-sum
  const totalDelta = results.reduce((sum, r) => sum + r.delta, 0);
  const adjustment = totalDelta / results.length;
  for (const r of results) {
    r.newRating = Math.round((r.newRating - adjustment) * 100) / 100;
    r.delta = Math.round((r.delta - adjustment) * 100) / 100;
  }

  return results;
}

// Export initial values for use by the service
export const INITIAL_RATING = 1500;
export const INITIAL_RD = 350;
export const INITIAL_VOLATILITY = 0.06;
