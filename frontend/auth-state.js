// ================================================
// AUTH-STATE.JS — Shared auth Promise
//
// WHY THIS EXISTS:
// auth-guard.js and home.js both need the session,
// but they load in parallel. Using a one-shot
// CustomEvent caused a race condition on slow
// connections — home.js could miss the event if
// auth-guard.js fired it before home.js added
// its listener.
//
// HOW IT WORKS:
// auth-guard.js calls resolveAuth(user) once it
// verifies the session. home.js awaits authReady,
// which resolves instantly if auth already finished,
// or waits if it hasn't yet. No race possible.
// ================================================

let resolveAuth;
let rejectAuth;

export const authReady = new Promise((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth  = reject;
});

export { resolveAuth, rejectAuth };