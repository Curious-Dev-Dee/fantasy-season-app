import { supabase } from "./supabase.js";

async function protectPage() {
  try {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      window.location.replace("/login.html");
      return;
    }

    console.log("Authenticated user:", data.user.email);

  } catch (err) {
    console.error("Auth check failed:", err);
    window.location.replace("/login.html");
  }
}

protectPage();

/* Listen for logout across tabs */
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    window.location.replace("/login.html");
  }
});
