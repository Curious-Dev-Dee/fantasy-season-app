import { supabase } from "./supabase.js";

const authContainer = document.getElementById("authContainer");
const googleBtn = document.getElementById("googleLoginBtn");
const btnText = googleBtn?.querySelector(".btn-text");
const spinner = googleBtn?.querySelector(".spinner"); // Target the spinner
const errorEl = document.getElementById("authError");

// 1. Better Auth Handling
supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
        // Use consistent path
        window.location.replace("/home.html");
    } else {
        // Only show UI if definitely NOT logged in
        authContainer?.classList.remove("hidden");
    }
});

async function signInWithGoogle() {
    try {
        if (googleBtn) {
            googleBtn.disabled = true;
            btnText.textContent = "Connecting...";
            spinner?.classList.remove("hidden"); // Show the spinner
        }

        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                // Ensure this matches your Supabase Dashboard Allowlist!
                redirectTo: `${window.location.origin}/home.html`, 
            },
        });

        if (error) throw error;
    } catch (err) {
        console.error("Auth Error:", err);
        googleBtn.disabled = false;
        btnText.textContent = "Continue with Google";
        spinner?.classList.add("hidden");
        
        // Show the actual Supabase error if it exists, otherwise use the fallback
        errorEl.textContent = err.message || "Connection failed. Check your internet.";
        errorEl.style.display = "block";
    }
}

googleBtn?.addEventListener("click", signInWithGoogle);