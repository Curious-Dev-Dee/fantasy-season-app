async function signInWithGoogle() {
  try {
    if (googleBtn) {
      googleBtn.disabled = true;
      if (btnText) btnText.textContent = "Connecting...";
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/home`,
      },
    });

    if (error) {
      console.error("Auth Error:", error);
      throw error;
    }

  } catch (error) {
    // ✅ Better error messages
    let errorMsg = "Login failed. Please try again.";
    if (error.message.includes("OAuth")) {
      errorMsg = "Google login failed. Check your internet connection.";
    } else if (error.message.includes("blocked")) {
      errorMsg = "Google OAuth not enabled in Supabase dashboard.";
    }

    if (googleBtn) {
      googleBtn.disabled = false;
      if (btnText) btnText.textContent = "Continue with Google";
    }
    if (errorEl) {
      errorEl.textContent = errorMsg;
      errorEl.style.display = "block";
      setTimeout(() => errorEl.style.display = "none", 5000); // Auto-hide
    }
  }
}
