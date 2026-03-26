// ─── ARTICLE AD MANAGER ──────────────────────────────────────────────────
// Rules:
// - ONLY load this script on news/article pages.
// - Aggressively loads multiple ad zones (Popunders / In-Page Push).
// - Includes error tracking for dead Monetag domains.

const ARTICLE_ADS = [
    { zone: "10788828", url: "https://al5sm.com/tag.min.js" },
    { zone: "10746396", url: "https://nap5k.com/tag.min.js" }
];

function injectArticleAd(adConfig) {
    const script = document.createElement("script");
    script.dataset.zone = adConfig.zone;
    script.src = adConfig.url;
    script.async = true;

    // Detect if Monetag rotates or kills this specific domain
    script.onerror = () => {
        console.error(`🚨 CRITICAL: Monetag Ad (Zone ${adConfig.zone}) failed to load! The domain ${adConfig.url} might be dead.`);
    };

    // Inject the script safely into the page
    document.body.appendChild(script);
}

function startArticleAds() {
    console.log("Loading aggressive article ads...");
    
    // Loop through our array and inject both ad tags immediately
    ARTICLE_ADS.forEach(ad => injectArticleAd(ad));
}

// Start immediately when the article page loads
startArticleAds();

export { startArticleAds };