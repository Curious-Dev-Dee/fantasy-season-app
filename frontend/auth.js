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
   Runs before showing the login UI to any visitor who isn't already
   logged in. Existing users hit onAuthStateChange first and get
   redirected before this check ever runs — so this only affects
   genuinely new visitors coming in from the blog.
─────────────────────────────────────────────────────────────────────── */
async function checkAndReveal() {
    const status = await checkRegistrationOpen();
    if (!status.open) {
        showRegistrationClosed(status.reason);
        return;
    }
    // Spots available — reveal login form normally
    authContainer?.classList.remove("hidden");
}

/* ── AUTH STATE ──────────────────────────────────────────────────────────
   onAuthStateChange fires on every page load with the current session.
   Session exists → already registered → redirect immediately.
   No session → run registration check before showing the login form.
─────────────────────────────────────────────────────────────────────── */
supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
        // Already logged in — skip the registration check entirely
        window.location.replace("/home.html");
    } else {
        // Not logged in — check if registration is still open before revealing UI
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

    // Second check right at the moment the button is clicked — in case the
    // last spot was taken between page load and button press
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
                redirectTo: `${window.location.origin}/home.html`,
            },
        });

        if (error) throw error;
        // Successful OAuth triggers a browser redirect — no setLoading(false) needed

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