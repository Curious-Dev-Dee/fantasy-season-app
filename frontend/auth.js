import { pb } from "./pb.js";

// 1. Reveal the UI as soon as the script loads
document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("authContainer");
    if (container) {
        container.classList.remove("hidden");
    }
});

// 2. The Login Function
async function signInWithGoogle() {
    const googleBtn = document.getElementById("googleLoginBtn");
    const btnText = googleBtn?.querySelector(".btn-text");

    try {
        if (googleBtn) {
            googleBtn.disabled = true;
            if (btnText) btnText.textContent = "Connecting to Google...";
        }

        // PocketBase handles the popup
        const authData = await pb.collection('users').authWithOAuth2({ 
            provider: 'google' 
        });

        if (pb.authStore.isValid) {
            // Successful login!
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

// 3. CRITICAL: Make the function globally available for the HTML button
window.signInWithGoogle = signInWithGoogle;