// ─── AD MANAGER ──────────────────────────────────────────────────────────────
// Rules:
// - Never runs on edit-team page
// - Shows Monetag vignette on page load (once)
// - Shows again every 120 seconds while user stays on page
// - Respects Safari Private Mode (localStorage try/catch)

const AD_ZONE      = "10742556";
const AD_INTERVAL  = 120000; // 120 seconds
const AD_COOLDOWN  = 10000;  // 10s min between any two ads
const BLOCKED_PAGE = "edit-team";

let adInterval = null;
let lastShown   = 0;

function isBlockedPage() {
    return window.location.pathname.includes(BLOCKED_PAGE) ||
           document.title.toLowerCase().includes("edit team");
}

function loadMonetagAd() {
    if (isBlockedPage()) return;

    const now = Date.now();
    if (now - lastShown < AD_COOLDOWN) return;
    lastShown = now;

    // Persist last shown time for cross-tab cooldown
    try { localStorage.setItem("ad_last_shown", now); } catch (_) {}

    const script        = document.createElement("script");
    script.dataset.zone = AD_ZONE;
    script.src          = "https://gizokraijaw.net/vignette.min.js";
    script.async        = true;
    document.body.appendChild(script);
}

function startAdCycle() {
    if (isBlockedPage()) return;

    // Show on load after short delay (let page render first)
    setTimeout(loadMonetagAd, 2000);

    // Then every 120 seconds
    adInterval = setInterval(loadMonetagAd, AD_INTERVAL);
}

function stopAdCycle() {
    if (adInterval) {
        clearInterval(adInterval);
        adInterval = null;
    }
}

// Stop when page hides, restart when visible again
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        stopAdCycle();
    } else {
        // Resume — but don't show immediately on tab return
        // just restart the 120s cycle
        if (!isBlockedPage()) {
            adInterval = setInterval(loadMonetagAd, AD_INTERVAL);
        }
    }
});

// Clean up on page hide
window.addEventListener("pagehide", stopAdCycle);

// Start
startAdCycle();

export { loadMonetagAd };