import { pb } from "./pb.js";

async function protectPage() {
    // If not logged in, kick them back to login
    if (!pb.authStore.isValid) {
        window.location.replace("/login");
        return;
    }

    // If logged in, show the page
    document.body.classList.remove("loading-state");
    document.body.classList.add("loaded");
    
    // Send user data to home.js
    const event = new CustomEvent('auth-verified', { 
        detail: { user: pb.authStore.model } 
    });
    window.dispatchEvent(event);
}

protectPage();