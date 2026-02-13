import { supabase } from "./supabase.js";

// This function checks if the user is logged in
async function checkUser() {
  const { data: { session }, error } = await supabase.auth.getSession();

  // If there is no session, redirect to login page
  if (!session || error) {
    console.log("No active session found. Redirecting to login...");
    window.location.href = "login.html";
  } else {
    console.log("User authenticated:", session.user.email);
  }
}

// Run the check immediately
checkUser();