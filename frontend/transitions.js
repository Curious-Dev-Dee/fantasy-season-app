function handleLinkClick(e) {
    const link = e.target.closest("a[href]");
    if (!link) return;

    const href = link.getAttribute("href");

    // Ignore: external links, anchors, new tab, javascript:
    if (!href
        || href.startsWith("http")
        || href.startsWith("#")
        || href.startsWith("javascript")
        || link.target === "_blank"
    ) return;

    e.preventDefault();

    // Fade out current page
    document.body.style.transition = "opacity 0.15s ease, transform 0.15s ease";
    document.body.style.opacity    = "0";

    setTimeout(() => {
        window.location.href = href;
    }, 150);
}

document.addEventListener("click", handleLinkClick);

// Also handle bottom nav buttons that use onclick
// instead of href — fade before navigation
window.__navigate = function(href) {
    document.body.style.transition = "opacity 0.15s ease, transform 0.15s ease";
    document.body.style.opacity    = "0";
    setTimeout(() => { window.location.href = href; }, 150);
};