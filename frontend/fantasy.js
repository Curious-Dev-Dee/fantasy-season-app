import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm";

const sb = createClient(
  "https://tuvqgcosbweljslbfgqc.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1dnFnY29zYndlbGpzbGJmZ3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NTkyNTgsImV4cCI6MjA4NjIzNTI1OH0.doWGRcUdRamCyd4i9YJd8vwZEGtfX5hwsAHtb1zKZo"
);

// simple guard: redirect to / if not logged in
sb.auth.getUser().then(({ data }) => {
  const user = data?.user;
  if (!user) {
    window.location.replace("/");
  }
});

// toggle details
document.querySelectorAll(".view-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.target;
    const panel = document.getElementById(targetId);
    if (!panel) return;
    panel.classList.toggle("hidden");
  });
});