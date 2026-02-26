// auth.js
import { pb } from "./pb.js";

async function signInWithGoogle() {
  const googleBtn = document.getElementById("googleLoginBtn");
  const btnText = googleBtn?.querySelector(".btn-text");

  try {
    if (googleBtn) {
      googleBtn.disabled = true;
      if (btnText) btnText.textContent = "Connecting to Google...";
    }

    // PocketBase handles the OAuth popup and redirect in one go
    const authData = await pb.collection('users').authWithOAuth2({ 
        provider: 'google' 
    });

    if (pb.authStore.isValid) {
        // Success! Go to home
        window.location.replace("/home");
    }

  } catch (err) {
    console.error("Connection Error:", err.message);
    alert("Login failed. Check your internet or laptop server.");
    if (googleBtn) {
      googleBtn.disabled = false;
      if (btnText) btnText.textContent = "Continue with Google";
    }
  }
}

// Make sure your HTML button calls this function
window.signInWithGoogle = signInWithGoogle;