import { supabase } from "./supabase.js";

const googleBtn = document.getElementById("googleLoginBtn");
const spinner = document.querySelector(".spinner");
const btnText = document.querySelector(".btn-text");
const errorEl = document.getElementById("authError");

/* =========================
   SESSION MANAGEMENT (The Fix)
   ========================= */
// onAuthStateChange handles both the initial load AND 
// the moment the user returns from Google.
supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    window.location.replace("home.html"); // .replace prevents user from clicking 'back' to login
  }
});

/* =========================
   UI STATE LOGIC
   ========================= */
function setAuthLoading(isLoading) {
  if (!googleBtn) return;
  
  googleBtn.disabled = isLoading;
  
  if (isLoading) {
    spinner?.classList.remove("hidden");
    if (btnText) btnText.textContent = "Verifying...";
    if (errorEl) errorEl.style.display = "none";
  } else {
    spinner?.classList.add("hidden");
    if (btnText) btnText.textContent = "Continue with Google";
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

/* =========================
   EVENT LISTENERS
   ========================= */
if (googleBtn) {
  googleBtn.addEventListener("click", signInWithGoogle);
}

// Fix: Re-enable button if user clicks 'back' from Google Auth screen
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    setAuthLoading(false);
  }
});