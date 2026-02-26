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
            if (btnText) btnText.textContent = "Connecting...";
        }

        // STABILITY FIX: We use a redirect so we don't need a "Live" connection
        // This stops the 'EventSource connect took too long' error
        await pb.collection('users').authWithOAuth2({ 
            provider: 'google',
            // This ensures the login happens in the SAME window, not a popup
            url: window.location.origin + '/home' 
        });

    } catch (err) {
        console.error("Login Error:", err);
        
        // Handle the specific 'ClientResponseError 0' timeout
        if (err.status === 0) {
            alert("Connection timed out. Satya's laptop might be busy or the tunnel is slow.");
        } else {
            alert("Login failed. Check your internet connection.");
        }
        
        if (googleBtn) {
            googleBtn.disabled = false;
            if (btnText) btnText.textContent = "Continue with Google";
        }
    }
}

// 3. Make the function globally available
window.signInWithGoogle = signInWithGoogle;