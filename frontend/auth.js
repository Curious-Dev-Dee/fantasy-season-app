import { supabase } from "./supabase.js";

async function signInWithGoogle() {
  const googleBtn = document.getElementById("googleLoginBtn");
  const btnText = googleBtn?.querySelector(".btn-text");

  try {
    if (googleBtn) {
        googleBtn.disabled = true;
        if (btnText) btnText.textContent = "Connecting to Google...";
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // MUST be a clean URL matching your Vercel settings
        redirectTo: `${window.location.origin}/home`, 
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) throw error;

  } catch (err) {
    console.error("Connection Error:", err.message);
    alert("Check your internet connection or try again in a moment.");
    if (googleBtn) {
        googleBtn.disabled = false;
        if (btnText) btnText.textContent = "Continue with Google";
    }
  }
}