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

        /* STABILITY FIX: We are using a Redirect instead of a Popup.
           This bypasses the 'Realtime' timeout errors caused by the tunnel.
        */
        await pb.collection('users').authWithOAuth2({ 
            provider: 'google',
            // This tells Google to send the user directly to your home page
            url: window.location.origin + '/home' 
        });

    } catch (err) {
        console.error("Login Error:", err);
        
        // Handle the specific 'ClientResponseError 0' timeout
        if (err.isAbort || err.status === 0) {
            alert("Connection timed out. Satya's laptop might be busy. Please try again!");
        } else {
            alert("Login failed. Check your internet connection.");
        }
        
        if (googleBtn) {
            googleBtn.disabled = false;
            if (btnText) btnText.textContent = "Continue with Google";
        }
    }
}

// 3. Make the function globally available for the HTML button
window.signInWithGoogle = signInWithGoogle;