import { supabase } from "./supabase.js";
import {
    checkRegistrationOpen,
    showRegistrationClosed,
} from "./registration-guard.js";

const authContainer = document.getElementById("authContainer");
const googleBtn     = document.getElementById("googleLoginBtn");
const btnText       = googleBtn?.querySelector(".btn-text");
const spinner       = googleBtn?.querySelector(".spinner");
const errorEl       = document.getElementById("authError");

/* ── REGISTRATION GUARD ──────────────────────────────────────────────────
   Runs before showing the login UI to any visitor who is not already
   logged in. Existing users are redirected by onAuthStateChange before
   this ever runs — it only affects genuinely new visitors from the blog.
─────────────────────────────────────────────────────────────────────── */
async function checkAndReveal() {
    const status = await checkRegistrationOpen();
    if (!status.open) {
        showRegistrationClosed(status.reason);
        return;
    }
    authContainer?.classList.remove("hidden");
}

/* ── AUTH STATE ──────────────────────────────────────────────────────────
   onAuthStateChange fires on every page load with the current session.
   BUG FIX: was redirecting to /home.html — changed to /home (clean URL).
   Vercel serves pages at clean URLs; /home.html may route differently
   and was causing the post-login redirect to land on fixtures.
─────────────────────────────────────────────────────────────────────── */
supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
        // BUG FIX: /home not /home.html
        window.location.replace("/home");
    } else {
        checkAndReveal();
    }
});

/* ── HELPERS ─────────────────────────────────────────────────────────── */
function setLoading(isLoading) {
    if (!googleBtn) return;
    googleBtn.disabled  = isLoading;
    btnText.textContent = isLoading ? "Connecting…" : "Continue with Google";
    spinner?.classList.toggle("hidden", !isLoading);
}

function showError(message) {
    if (!errorEl) return;
    errorEl.textContent   = message;
    errorEl.style.display = "block";
}

function clearError() {
    if (!errorEl) return;
    errorEl.textContent   = "";
    errorEl.style.display = "none";
}

/* ── GOOGLE SIGN IN ──────────────────────────────────────────────────── */
async function signInWithGoogle() {
    clearError();

    // Second check at button-press time — in case last spot was just taken
    const status = await checkRegistrationOpen();
    if (!status.open) {
        showRegistrationClosed(status.reason);
        return;
    }

    setLoading(true);

    try {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                // BUG FIX: /home not /home.html
                // This must also match the redirect URL in your
                // Supabase Dashboard → Authentication → URL Configuration → Redirect URLs
                // Add both: https://yourdomain.com/home and https://yourdomain.com/home.html
                redirectTo: `${window.location.origin}/home`,
            },
        });

        if (error) throw error;

    } catch (err) {
        console.error("Auth error:", err);
        setLoading(false);
        const isNetworkError = !navigator.onLine ||
            err.message?.toLowerCase().includes("network");
        showError(
            isNetworkError
                ? "No connection. Check your internet and try again."
                : err.message || "Something went wrong. Please try again."
        );
    }
}

googleBtn?.addEventListener("click", signInWithGoogle);