import { supabase } from "./supabase.js";
import { resolveAuth, rejectAuth } from "./auth-state.js";

async function protectPage() {
    // Check cache first — skip network call for returning users
    const cached = sessionStorage.getItem("ce_user");
    if (cached) {
        try {
            const user = JSON.parse(cached);
            resolveAuth(user);
            return;
        } catch (_) {
            sessionStorage.removeItem("ce_user");
        }
    }

    // No cache — do the real network check
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
        console.warn("Auth Guard: No session found. Redirecting to login...");
        rejectAuth(new Error("No session"));
        window.location.replace("/login");
        return;
    }

    // Cache user for future page loads
    sessionStorage.setItem("ce_user", JSON.stringify(session.user));
    resolveAuth(session.user);
}

protectPage();

supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
        sessionStorage.removeItem("ce_user");
        window.location.replace("/login");
    }
});