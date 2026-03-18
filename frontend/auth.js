import { supabase } from "./supabase.js";

const authContainer = document.getElementById("authContainer");
const googleBtn     = document.getElementById("googleLoginBtn");
const btnText       = googleBtn?.querySelector(".btn-text");
const spinner       = googleBtn?.querySelector(".spinner");
const errorEl       = document.getElementById("authError");

// Redirect immediately if session exists.
// onAuthStateChange fires on every page load with the current session —
// no separate getSession() call needed, which avoids a double round-trip.
supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    window.location.replace("/home.html");
  } else {
    // Only reveal the UI once we know the user is definitely not logged in.
    // This prevents a flash of the login form for already-authed users.
    authContainer?.classList.remove("hidden");
  }
});

function setLoading(isLoading) {
  if (!googleBtn) return;
  googleBtn.disabled = isLoading;
  btnText.textContent = isLoading ? "Connecting…" : "Continue with Google";
  spinner?.classList.toggle("hidden", !isLoading);
}

function showError(message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.style.display = "block";
}

function clearError() {
  if (!errorEl) return;
  errorEl.textContent = "";
  errorEl.style.display = "none";
}

async function signInWithGoogle() {
  clearError();
  setLoading(true);

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Must match the redirect URL in your Supabase Dashboard Allowlist.
        // Using /home.html directly so the OAuth callback lands on the right page.
        redirectTo: `${window.location.origin}/home.html`,
      },
    });

    if (error) throw error;
    // If signInWithOAuth succeeds it triggers a browser redirect —
    // no need to setLoading(false) here; the page navigates away.

  } catch (err) {
    console.error("Auth error:", err);
    setLoading(false);
    // Show Supabase's error message if useful, otherwise a friendly fallback.
    const isNetworkError = !navigator.onLine || err.message?.toLowerCase().includes("network");
    showError(
      isNetworkError
        ? "No connection. Check your internet and try again."
        : err.message || "Something went wrong. Please try again."
    );
  }
}

googleBtn?.addEventListener("click", signInWithGoogle);