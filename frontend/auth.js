import { pb } from "./pb.js";

// IMMEDIATELY show the UI when the script loads
document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("authContainer");
    if (container) container.classList.remove("hidden");
});

async function signInWithGoogle() {
    const googleBtn = document.getElementById("googleLoginBtn");
    const btnText = googleBtn?.querySelector(".btn-text");

    try {
        if (googleBtn) {
            googleBtn.disabled = true;
            if (btnText) btnText.textContent = "Connecting to Google...";
        }

        // PocketBase opens the Google popup
        const authData = await pb.collection('users').authWithOAuth2({ 
            provider: 'google' 
        });

        if (pb.authStore.isValid) {
            window.location.replace("/home");
        }

    } catch (err) {
        console.error("Login Error:", err);
        alert("Login failed. Check if Satya's laptop is online!");
        if (googleBtn) {
            googleBtn.disabled = false;
            if (btnText) btnText.textContent = "Continue with Google";
        }
    }
}

// Attach to window so the HTML button can "see" it
window.signInWithGoogle = signInWithGoogle;