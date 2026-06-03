import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm";

const sb = createClient(
  "https://tuvqgcosbweljslbfgqc.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1dnFnY29zYndlbGpzbGJmZ3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NTkyNTgsImV4cCI6MjA4NjIzNTI1OH0.doWGRcUdRamCyd4i9YJd8vwZEGtfX5hwsAHtb1zKZo"
);

const overlay = document.getElementById("loadingOverlay");
const logoutBtn = document.getElementById("homeLogoutBtn");

function setLoading(on) {
  if (!overlay) return;
  overlay.classList.toggle("hidden", !on);
}

// protect page
setLoading(true);
sb.auth.getUser().then(({ data }) => {
  const user = data?.user;
  if (!user) {
    window.location.replace("/");
  } else {
    setLoading(false);
  }
});

// logout
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    setLoading(true);
    try {
      await sb.auth.signOut();
    } finally {
      window.location.replace("/");
    }
  });
}