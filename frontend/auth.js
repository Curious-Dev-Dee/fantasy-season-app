import { supabase } from "./supabase.js";

/* =========================
   PAGE DETECTION
========================= */

const isLoginPage = window.location.pathname.includes("login");
const isSignupPage = window.location.pathname.includes("signup");

const primaryButton = document.querySelector(".auth-btn.primary");
const errorText = document.querySelector(".auth-error");

/* =========================
   UI HELPERS
========================= */

function showError(message) {
  if (!errorText) return;
  errorText.textContent = message;
  errorText.style.display = "block";
}

function clearError() {
  if (!errorText) return;
  errorText.textContent = "";
  errorText.style.display = "none";
}

function setLoadingState(isLoading) {
  if (!primaryButton) return;

  if (isLoading) {
    primaryButton.disabled = true;
    primaryButton.classList.add("loading");
    primaryButton.innerHTML = `
      <span class="spinner"></span>
      <span>Authenticating...</span>
    `;
  } else {
    primaryButton.disabled = false;
    primaryButton.classList.remove("loading");
    primaryButton.innerHTML = `
      <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" class="google-icon" />
      <span>Continue with Google</span>
    `;
  }
}

/* =========================
   GOOGLE SIGN IN
========================= */

async function signInWithGoogle() {
  clearError();
  setLoadingState(true);

  const redirectUrl = window.location.origin + "/home.html";

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl,
    },
  });

  if (error) {
    console.error(error);
    showError("Authentication failed. Please try again.");
    setLoadingState(false);
  }
}

/* =========================
   INIT
========================= */

if ((isLoginPage || isSignupPage) && primaryButton) {
  primaryButton.addEventListener("click", signInWithGoogle);
}

/* =========================
   PAGE FADE IN
========================= */

window.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("page-loaded");
});
