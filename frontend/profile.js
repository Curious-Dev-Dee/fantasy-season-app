import { supabase } from "./supabase.js";

let currentUserId = null;

/* ── INIT ─────────────────────────────────────────────────────────────────
   auth-guard.js already verified the session before this module runs.
   We use getSession() directly — no authReady needed, no race condition.
─────────────────────────────────────────────────────────────────────────── */
(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return; // auth-guard.js handles redirect
    currentUserId = session.user.id;
    await loadProfile();
})();

/* ── LOAD PROFILE ──────────────────────────────────────────────────────── */
async function loadProfile() {
    const { data: p, error } = await supabase
        .from("user_profiles")
        .select("full_name, team_name, team_photo_url, joined_at")
        .eq("user_id", currentUserId)
        .maybeSingle();

    // Hide loader, show content regardless
    document.getElementById("profLoading")?.classList.add("hidden");
    document.getElementById("profContent")?.classList.remove("hidden");

    if (error) { console.error("Profile fetch error:", error.message); return; }
    if (!p)    { console.warn("No profile row found for user:", currentUserId); return; }

    // Avatar
    if (p.team_photo_url) {
        const { data: img } = supabase.storage
            .from("team-avatars")
            .getPublicUrl(p.team_photo_url);
        const av = document.getElementById("profAvatar");
        if (av) {
            av.style.backgroundImage    = `url('${img.publicUrl}')`;
            av.style.backgroundSize     = "cover";
            av.style.backgroundPosition = "center";
        }
    }

    const fullName = p.full_name || "—";
    const teamName = p.team_name || "—";

    setText("profName",    fullName);
    setText("profTeam",    teamName);
    setText("profNameVal", fullName);
    setText("profTeamVal", teamName);

    if (p.joined_at) {
        const d = new Date(p.joined_at).toLocaleDateString("en-IN", {
            day: "numeric", month: "long", year: "numeric"
        });
        setText("profJoined", d);
    }
}

/* ── PHOTO CHANGE ──────────────────────────────────────────────────────── */
document.getElementById("profChangePhotoBtn")?.addEventListener("click", () => {
    document.getElementById("profAvatarInput")?.click();
});

document.getElementById("profAvatarInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentUserId) return;

    const btn = document.getElementById("profChangePhotoBtn");
    btn.disabled    = true;
    btn.textContent = "Uploading…";
    showStatus("", "");

    try {
        const ext      = file.name.split(".").pop();
        const fileName = `${currentUserId}/avatar.${ext}`;

        const { error: uploadErr } = await supabase.storage
            .from("team-avatars")
            .upload(fileName, file, { cacheControl: "3600", upsert: true });
        if (uploadErr) throw uploadErr;

        const photoPath = `${fileName}?t=${Date.now()}`;

        const { error: updateErr } = await supabase
            .from("user_profiles")
            .update({ team_photo_url: photoPath })
            .eq("user_id", currentUserId);
        if (updateErr) throw updateErr;

        // Update avatar preview immediately without reload
        const { data: img } = supabase.storage
            .from("team-avatars")
            .getPublicUrl(photoPath);
        const av = document.getElementById("profAvatar");
        if (av) {
            av.style.backgroundImage    = `url('${img.publicUrl}')`;
            av.style.backgroundSize     = "cover";
            av.style.backgroundPosition = "center";
        }

        showStatus("Photo updated ✅", "success");

    } catch (err) {
        console.error("Photo upload failed:", err.message);
        showStatus("Upload failed — try again", "error");
    } finally {
        btn.disabled    = false;
        btn.textContent = "📷 Change Profile Photo";
    }
});

/* ── SIGN OUT ──────────────────────────────────────────────────────────── */
document.getElementById("profSignOutBtn")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
});

/* ── HELPERS ───────────────────────────────────────────────────────────── */
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function showStatus(msg, type) {
    const el = document.getElementById("profPhotoStatus");
    if (!el) return;
    if (!msg) { el.classList.add("hidden"); return; }
    el.textContent = msg;
    el.className   = `prof-status ${type}`;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 4000);
}