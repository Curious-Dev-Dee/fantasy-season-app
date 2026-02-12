import { supabase } from "./supabase.js";

const googleBtn = document.getElementById("googleLoginBtn");
const spinner = googleBtn?.querySelector(".spinner");
const btnText = googleBtn?.querySelector(".btn-text");

async function signInWithGoogle() {
  if (!googleBtn) return;

  try {
    // Disable button
    googleBtn.disabled = true;
    googleBtn.classList.add("loading");
    spinner?.classList.remove("hidden");
    btnText.textContent = "Signing in...";

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/home.html",
      },
    });

    if (error) {
      throw error;
    }
  } catch (err) {
    console.error("Google login error:", err);
    alert("Login failed. Please try again.");

    // Reset button state
    googleBtn.disabled = false;
    googleBtn.classList.remove("loading");
    spinner?.classList.add("hidden");
    btnText.textContent = "Continue with Google";
  }
}

if (googleBtn) {
  googleBtn.addEventListener("click", signInWithGoogle);
}
