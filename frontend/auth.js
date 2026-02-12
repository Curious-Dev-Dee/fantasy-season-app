import { supabase } from "./supabase.js";

console.log("auth.js loaded");

const isLoginPage = window.location.pathname.includes("login");
const isSignupPage = window.location.pathname.includes("signup");

const primaryButton = document.querySelector(".auth-btn.primary");
const errorText = document.querySelector(".auth-error");

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

async function signInWithGoogle() {
  clearError();

  if (!primaryButton) return;

  primaryButton.disabled = true;
  primaryButton.textContent = "Redirecting…";

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + "/home.html",
    },
  });

  if (error) {
    showError("Google login failed.");
    console.error(error);
    primaryButton.disabled = false;
    primaryButton.textContent = "Continue with Google";
  }
}

if ((isLoginPage || isSignupPage) && primaryButton) {
  primaryButton.addEventListener("click", signInWithGoogle);
}
