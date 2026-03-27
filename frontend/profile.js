import { supabase } from "./supabase.js";

let currentUserId   = null;
let teamNameLocked  = false;

(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    currentUserId = session.user.id;

    // Check if Match 1 has locked
    const { data: match1 } = await supabase
        .from("matches")
        .select("status")
        .eq("match_number", 1)
        .maybeSingle();

    teamNameLocked = match1?.status === "locked";

    await loadProfile();
})();

async function loadProfile() {
    const { data: p, error } = await supabase
        .from("user_profiles")
        .select("full_name, team_name, team_photo_url, joined_at")
        .eq("user_id", currentUserId)
        .maybeSingle();

    document.getElementById("profLoading")?.classList.add("hidden");
    document.getElementById("profContent")?.classList.remove("hidden");

    if (error || !p) return;

    if (p.team_photo_url) {
        const { data: img } = supabase.storage
            .from("team-avatars").getPublicUrl(p.team_photo_url);
        const av = document.getElementById("profAvatar");
        if (av) {
            av.style.backgroundImage    = `url('${img.publicUrl}')`;
            av.style.backgroundSize     = "cover";
            av.style.backgroundPosition = "center";
        }
    }

    setText("profName",    p.full_name  || "—");
    setText("profTeam",    p.team_name  || "—");
    setText("profNameVal", p.full_name  || "—");

    if (p.joined_at) {
        const d = new Date(p.joined_at).toLocaleDateString("en-IN", {
            day: "numeric", month: "long", year: "numeric"
        });
        setText("profJoined", d);
    }

    // Team name — editable before Match 1, locked after
    const teamValEl    = document.getElementById("profTeamVal");
    const teamInputEl  = document.getElementById("profTeamInput");
    const teamSaveBtn  = document.getElementById("profTeamSaveBtn");
    const lockNotice   = document.getElementById("profLockNotice");
    const editNotice   = document.getElementById("profEditNotice");

    if (teamNameLocked) {
        // Show locked view
        if (teamValEl)   { teamValEl.textContent = p.team_name || "—"; teamValEl.classList.remove("hidden"); }
        if (teamInputEl) teamInputEl.classList.add("hidden");
        if (teamSaveBtn) teamSaveBtn.classList.add("hidden");
        if (lockNotice)  lockNotice.classList.remove("hidden");
        if (editNotice)  editNotice.classList.add("hidden");
    } else {
        // Show editable input
        if (teamValEl)   teamValEl.classList.add("hidden");
        if (teamInputEl) { teamInputEl.value = p.team_name || ""; teamInputEl.classList.remove("hidden"); }
        if (teamSaveBtn) teamSaveBtn.classList.remove("hidden");
        if (lockNotice)  lockNotice.classList.add("hidden");
        if (editNotice)  editNotice.classList.remove("hidden");
    }
}

/* ── SAVE TEAM NAME ── */
document.getElementById("profTeamSaveBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("profTeamInput");
    const btn   = document.getElementById("profTeamSaveBtn");
    const newName = input?.value.trim();

    if (!newName) { showStatus("Team name cannot be empty.", "error"); return; }
    if (newName.length > 30) { showStatus("Max 30 characters.", "error"); return; }

    btn.disabled    = true;
    btn.textContent = "Saving…";

    const { error } = await supabase
        .from("user_profiles")
        .update({ team_name: newName })
        .eq("user_id", currentUserId);

    if (error) {
        showStatus("Failed to save. Try again.", "error");
    } else {
        setText("profTeam", newName);
        showStatus("Team name updated ✅", "success");
    }

    btn.disabled    = false;
    btn.textContent = "Save Team Name";
});

/* ── PHOTO CHANGE ── */
document.getElementById("profChangePhotoBtn")?.addEventListener("click", () => {
    document.getElementById("profAvatarInput")?.click();
});

document.getElementById("profAvatarInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentUserId) return;

    if (file.size > 2 * 1024 * 1024) {
        showStatus("Photo must be under 2MB. Please choose a smaller image.", "error");
        return;
    }

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

        const { data: img } = supabase.storage
            .from("team-avatars").getPublicUrl(photoPath);
        const av = document.getElementById("profAvatar");
        if (av) {
            av.style.backgroundImage    = `url('${img.publicUrl}')`;
            av.style.backgroundSize     = "cover";
            av.style.backgroundPosition = "center";
        }

        showStatus("Photo updated ✅", "success");

    } catch (err) {
        showStatus("Upload failed — try again", "error");
    } finally {
        btn.disabled    = false;
        btn.textContent = "📷 Change Profile Photo";
    }
});

/* ── SIGN OUT ── */
document.getElementById("profSignOutBtn")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "/index";
});

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