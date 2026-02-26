// authguard.js
import { pb } from "./pb.js";

async function protectPage() {
  // Check if the authStore has a valid token
  if (!pb.authStore.isValid) {
    window.location.replace("/login");
    return;
  }

  // Reveal the page
  document.body.classList.remove("loading-state");
  document.body.classList.add("loaded");
  
  // Signal home.js that user is ready
  const event = new CustomEvent('auth-verified', { 
      detail: { user: pb.authStore.model } 
  });
  window.dispatchEvent(event);
}

protectPage();

// Monitor logout (clearing the store)
pb.authStore.onChange(() => {
  if (!pb.authStore.isValid) {
    window.location.replace("/login");
  }
});