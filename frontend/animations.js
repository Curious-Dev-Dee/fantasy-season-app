// ================================================
// ANIMATIONS.JS — Rank Flair Utilities
// Import in any JS file that needs rank flair:
// import { getEffectiveRank, applyRankFlair } from "./animations.js";
// ================================================

// Gets the best rank across both leagues.
// Example: rank 5 overall + rank 2 private = effective rank 2 (silver)
export function getEffectiveRank(overallRank, privateRank) {
    return Math.min(overallRank ?? Infinity, privateRank ?? Infinity);
}

// Applies gold/silver/bronze CSS classes to an avatar and/or name element.
// Pass null for either element if it doesn't exist on that page.
// Example: applyRankFlair(avatarDiv, nameSpan, 1) → adds rank-avatar-1, rank-name-1
export function applyRankFlair(avatarEl, nameEl, effectiveRank) {
    if (!effectiveRank || effectiveRank > 3) return; // not in top 3, do nothing
    avatarEl?.classList.add(`rank-avatar-${effectiveRank}`);
    nameEl?.classList.add(`rank-name-${effectiveRank}`);
}