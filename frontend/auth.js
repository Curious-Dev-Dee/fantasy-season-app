import { pb } from "./pb.js";

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
            if (btnText) btnText.textContent = "Redirecting...";
        }

        // 1. Manually fetch the auth methods (this is a simple GET request)
        const authMethods = await pb.collection('users').listAuthMethods();
        const googleProvider = authMethods.authProviders.find(p => p.name === 'google');

        if (!googleProvider) throw new Error("Google provider not enabled in PB Admin!");

        // 2. Save the provider data for later (PocketBase needs this to verify the return)
        localStorage.setItem('provider', JSON.stringify(googleProvider));

        // 3. FORCE a hard redirect to the provider's URL
        // This completely avoids the 'EventSource' / Realtime timeout
        const redirectUrl = window.location.origin + '/home';
        window.location.href = googleProvider.authUrl + redirectUrl;

    } catch (err) {
        console.error("Manual Auth Error:", err);
        alert("Satya's laptop is taking too long to respond. Refresh and try once more.");
        if (googleBtn) {
            googleBtn.disabled = false;
            if (btnText) btnText.textContent = "Continue with Google";
        }
    }
}

window.signInWithGoogle = signInWithGoogle;