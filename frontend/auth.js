import { supabase } from "./supabase.js";

/* =========================
   AUTO-REDIRECT CHECK
========================= */
async function checkExistingSession() {
    const { data: { session } } = await supabase.auth.getSession();
    
    // If a session exists, skip the login page and go home!
    if (session) {
        window.location.href = "home.html";
    }
}

// Run the check immediately
checkExistingSession();

/* =========================
   DOM REFERENCES
========================= */
// ... rest of your existing code ...
/* =========================
   DOM REFERENCES
========================= */

const googleBtn = document.getElementById("googleLoginBtn");
const spinner = document.querySelector(".spinner");
const btnText = document.querySelector(".btn-text");
const errorEl = document.getElementById("authError");

/* =========================
   PAGE FADE-IN
========================= */

window.addEventListener("load", () => {
  document.body.classList.add("page-loaded");
});

/* =========================
   GOOGLE SIGN IN
========================= */

async function signInWithGoogle() {
  if (!googleBtn) return;

  try {
    // Clear previous error
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }

    // Disable button
    googleBtn.disabled = true;

    // Show spinner
    if (spinner) spinner.classList.remove("hidden");
    if (btnText) btnText.textContent = "Signing in...";

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/home.html`,
      },
    });

    if (error) {
      throw error;
    }

  } catch (err) {
    console.error("Google login error:", err);

    // Show inline error
    if (errorEl) {
      errorEl.textContent = "Login failed. Please try again.";
      errorEl.style.display = "block";
    }

    // Reset button state
    googleBtn.disabled = false;

    if (spinner) spinner.classList.add("hidden");
    if (btnText) btnText.textContent = "Continue with Google";
  }
}

/* =========================
   EVENT LISTENER
========================= */

if (googleBtn) {
  googleBtn.addEventListener("click", signInWithGoogle);
}
