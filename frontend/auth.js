import { supabase } from "./supabase.js";

const authContainer = document.getElementById("authContainer");
const googleBtn = document.getElementById("googleLoginBtn");
const btnText = googleBtn?.querySelector(".btn-text");
const spinner = googleBtn?.querySelector(".spinner");
const errorEl = document.getElementById("authError");

let loadingTimeout = null;

/* =========================
   SAFE APP BOOT
========================= */
async function bootApp() {
  try {
    // Always validate against Supabase server
    const { data, error } = await supabase.auth.getUser();

    if (error) throw error;

    if (data?.user) {
      window.location.replace("/home.html");
      return;
    }

    // Show login UI
    authContainer?.classList.remove("hidden");

  } catch (err) {
    console.error("Boot Error:", err);
    authContainer?.classList.remove("hidden");
  }
}

bootApp();

/* =========================
   AUTH STATE LISTENER
========================= */
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session) {
    window.location.replace("/home.html");
  }
});

/* =========================
   UI STATE
========================= */
function setAuthLoading(isLoading) {
  if (!googleBtn) return;

  googleBtn.disabled = isLoading;

  if (isLoading) {
    spinner?.classList.remove("hidden");
    if (btnText) btnText.textContent = "Redirecting...";
    errorEl.style.display = "none";

    // Safe timeout protection
    loadingTimeout = setTimeout(() => {
      setAuthLoading(false);
    }, 15000);

  } else {
    spinner?.classList.add("hidden");
    if (btnText) btnText.textContent = "Continue with Google";

    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
      loadingTimeout = null;
    }
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
        redirectTo: `${window.location.origin}/home.html`,
      },
    });

    if (error) throw error;

  } catch (err) {
    console.error("Auth Error:", err);
    setAuthLoading(false);

    if (errorEl) {
      errorEl.textContent = "Sign-in failed. Please try again.";
      errorEl.style.display = "block";
    }
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
