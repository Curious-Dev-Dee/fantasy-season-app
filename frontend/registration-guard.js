/**
 * registration-guard.js
 *
 * Import this in auth.js / your profile-creation flow.
 * Call checkRegistrationOpen() before showing the profile
 * setup form, so users know immediately if spots are full.
 *
 * Also wraps the profile INSERT so if the DB trigger fires
 * it shows a clean error instead of a raw Supabase error.
 */

import { supabase } from "./supabase.js";

/* ─── Check registration status before showing signup form ── */
export async function checkRegistrationOpen() {
    const { data, error } = await supabase
        .from("app_config")
        .select("key, value")
        .in("key", ["max_users", "registration_open"]);

    if (error || !data) return { open: true }; // fail open — don't block on a config error

    const config = Object.fromEntries(data.map(r => [r.key, r.value]));
    const maxUsers    = parseInt(config.max_users || "200", 10);
    const regOpen     = config.registration_open !== "false";

    if (!regOpen) {
        return { open: false, reason: "paused" };
    }

    // Also check the live count
    const { count } = await supabase
        .from("user_profiles")
        .select("*", { count: "exact", head: true });

    if ((count || 0) >= maxUsers) {
        return { open: false, reason: "full", current: count, max: maxUsers };
    }

    return { open: true, spotsLeft: maxUsers - (count || 0) };
}

/* ─── Show the "we're full" screen ──────────────────────────── */
export function showRegistrationClosed(reason = "full") {
    document.body.innerHTML = `
        <div style="
            min-height: 100dvh;
            background: #0c1117;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 32px 24px;
            font-family: 'Inter', -apple-system, sans-serif;
            color: #fff;
            text-align: center;
            box-sizing: border-box;
        ">
            <div style="font-size: 56px; margin-bottom: 20px;">
                ${reason === "full" ? "🏟️" : "⏸️"}
            </div>

            <h1 style="
                font-size: 26px;
                font-weight: 900;
                margin: 0 0 12px;
                color: #9AE000;
                text-transform: uppercase;
                letter-spacing: 1px;
            ">
                ${reason === "full" ? "All Spots Taken" : "Registrations Paused"}
            </h1>

            <p style="
                font-size: 15px;
                color: #94a3b8;
                line-height: 1.6;
                max-width: 320px;
                margin: 0 0 28px;
            ">
                ${reason === "full"
                    ? "Cricket Experts is currently at full capacity for this IPL season. We may open more spots in future seasons."
                    : "New registrations are temporarily paused. Check back soon."
                }
            </p>

            <a href="https://YOUR_BLOG_URL_HERE" style="
                display: inline-block;
                background: #9AE000;
                color: #000;
                font-weight: 800;
                font-size: 14px;
                padding: 14px 28px;
                border-radius: 12px;
                text-decoration: none;
                letter-spacing: 0.3px;
            ">
                Read Our Cricket Blog →
            </a>

            <p style="
                margin-top: 32px;
                font-size: 12px;
                color: #475569;
            ">
                Already have an account?
                <a href="login.html" style="color: #9AE000; text-decoration: none; font-weight: 700;">
                    Sign In
                </a>
            </p>
        </div>
    `;
}

/* ─── Parse DB trigger error messages ───────────────────────── */
export function isUserLimitError(error) {
    if (!error) return false;
    const msg = error.message || "";
    return msg.includes("USER_LIMIT_REACHED") || msg.includes("REGISTRATION_CLOSED");
}