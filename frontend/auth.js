import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm";
import { checkRegistrationOpen, showRegistrationClosed } from "./registration-guard.js";

const sb = createClient(
  "https://tuvqgcosbweljslbfgqc.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1dnFnY29zYndlbGpzbGJmZ3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NTkyNTgsImV4cCI6MjA4NjIzNTI1OH0.doWGRcUdRamCyd4i9YJd8vwZEGtfX5hwsAHtb1zKZo"
);

// If already logged in, go straight to home
sb.auth.getUser().then(({ data }) => {
  if (data?.user) {
    window.location.replace("/home");
  }
});

const googleBtn = document.getElementById("googleLoginBtn");
const spinIco = document.getElementById("spinIco");
const errEl = document.getElementById("authError");

function setLoading(on) {
  if (!googleBtn) return;
  googleBtn.disabled = on;
  if (spinIco) {
    spinIco.classList.toggle("on", on);
  }
  const txt = googleBtn.querySelector(".btn-text");
  if (txt) {
    txt.textContent = on ? "Connecting..." : "Continue with Google";
  }
}

function showErr(msg) {
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.classList.add("show");
  setTimeout(() => {
    errEl.classList.remove("show");
  }, 5000);
}

async function doLogin() {
  let status;
  try {
    status = await checkRegistrationOpen();
  } catch (e) {
    status = { open: true }; // fail open for now
  }

  if (status && status.open === false) {
    showRegistrationClosed(status.reason);
    return;
  }

  setLoading(true);
  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/home`,
      },
    });

    if (error) throw error;
  } catch (err) {
    setLoading(false);
    if (!navigator.onLine) {
      showErr("No internet, try again.");
    } else {
      showErr(err.message || "Sign in failed.");
    }
  }
}

if (googleBtn) {
  googleBtn.addEventListener("click", doLogin);
}