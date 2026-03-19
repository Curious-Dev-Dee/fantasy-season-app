import { supabase } from "./supabase.js";
import { resolveAuth, rejectAuth } from "./auth-state.js";

async function protectPage() {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
        console.warn("Auth Guard: No session found. Redirecting to login...");
        rejectAuth(new Error("No session"));
        window.location.replace("/login");
        return;
    }

    // Resolve the shared Promise — home.js is awaiting this.
    // If home.js awaits authReady before this line runs, it waits.
    // If home.js awaits after this line runs, it resolves instantly.
    // Either way, no race condition.
    resolveAuth(session.user);
}

protectPage();

supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
        window.location.replace("/login");
    }
});