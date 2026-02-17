import { supabase } from "./supabase.js";

const authContainer = document.getElementById("authContainer");
const googleBtn = document.getElementById("googleLoginBtn");
const btnText = googleBtn?.querySelector(".btn-text");
const spinner = googleBtn?.querySelector(".spinner");
const errorEl = document.getElementById("authError");

/* =========================
   SAFE APP BOOT
   ========================= */
async function bootApp() {
  try {
    // Validate token with server (NOT cached session)
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error) throw error;

    if (user) {
      window.location.replace("/home.html");
      return;
    }

    // If no user → show login UI
    authContainer?.classList.remove("hidden");

  } catch (err) {
    console.error("Boot Error:", err);

    // Even if Supabase fails, show login
    authContainer?.classList.remove("hidden");
  }
}

bootApp();

/* =========================
   UI STATE
   ========================= */
function setAuthLoading(isLoading) {
  if (!googleBtn) return;

  googleBtn.disabled = isLoading;

  if (isLoading) {
    spinner?.classList.remove("hidden");
    btnText.textContent = "Redirecting...";
    errorEl.style.display = "none";

    // Fail-safe unlock after 10 seconds
    setTimeout(() => {
      setAuthLoading(false);
    }, 10000);

  } else {
    spinner?.classList.add("hidden");
    btnText.textContent = "Continue with Google";
  }
}

/* =========================
   GOOGLE SIGN IN
   ========================= */
async function signInWithGoogle() {
  try {
    setAuthLoading(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "https://fantasy-season-app.vercel.app/home.html",
      },
    });

    if (error) throw error;

  } catch (err) {
    console.error("Auth Error:", err);
    setAuthLoading(false);

    errorEl.textContent = "Sign-in failed. Please try again.";
    errorEl.style.display = "block";
  }
}

googleBtn?.addEventListener("click", signInWithGoogle);

/* =========================
   Safari Back Button Fix
   ========================= */
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    setAuthLoading(false);
  }
});
