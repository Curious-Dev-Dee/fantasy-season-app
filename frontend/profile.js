import { supabase } from "./supabase.js";

const avatarDisplay = document.getElementById("avatarDisplay");
const avatarInput = document.getElementById("avatarInput");
const fullNameInput = document.getElementById("fullNameInput");
const teamNameInput = document.getElementById("teamNameInput");
const saveBtn = document.getElementById("saveProfileBtn");
const saveStatus = document.getElementById("saveStatus");

let currentUserId;

// 1. Initial Load
window.addEventListener('auth-verified', async (e) => {
    currentUserId = e.detail.user.id;
    loadProfile();
});

/* =========================
    PROFILE & PHOTO LOGIC
========================= */

async function loadProfile() {
    const { data: p } = await supabase.from('user_profiles').select('*').eq('user_id', currentUserId).single();
    
    if (p) {
        fullNameInput.value = p.full_name || "";
        teamNameInput.value = p.team_name || "";
        
        // 1. LOCK STATE: Disable editing if profile is already completed
        if (p.profile_completed) {
            fullNameInput.readOnly = true;
            teamNameInput.readOnly = true;
            
            // Visual feedback for locked state
            [fullNameInput, teamNameInput].forEach(el => {
                el.style.background = "rgba(255, 255, 255, 0.05)";
                el.style.color = "#94a3b8";
                el.style.cursor = "not-allowed";
            });

            // Update hint text to warn user
            const hint = teamNameInput.parentElement.querySelector('.hint-text');
            if (hint) {
                hint.innerText = "⚠️ Identity locked for the season.";
                hint.style.color = "#ef4444";
                hint.style.fontWeight = "600";
            }
        }

        // 2. AVATAR LOADING: Fix for the "Dark Circle"
        if (p.team_photo_url) {
            const { data } = supabase.storage.from('team-avatars').getPublicUrl(p.team_photo_url);
            avatarDisplay.style.backgroundImage = `url('${data.publicUrl}')`;
            avatarDisplay.style.backgroundSize = "cover";
            avatarDisplay.style.backgroundPosition = "center";
        }
    }
}

// 2. Photo Upload Trigger
document.getElementById("changePhotoBtn").onclick = () => avatarInput.click();

avatarInput.onchange = async () => {
    const file = avatarInput.files[0];
    if (!file) return;

    // Use Date.now() to prevent browser caching of old photos
    const fileExt = file.name.split('.').pop();
    const fileName = `${currentUserId}-${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
        .from('team-avatars')
        .upload(fileName, file, { upsert: true });
    
    if (!uploadError) {
        // Update only the photo URL to avoid trigger conflicts with locked names
        await supabase.from('user_profiles')
            .update({ team_photo_url: fileName })
            .eq('user_id', currentUserId);
            
        alert("Photo updated successfully!");
        location.reload();
    } else {
        console.error("Upload error:", uploadError.message);
        alert("Failed to upload photo.");
    }
};

// 3. Save Text Data
saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.innerText = "SAVING...";

    try {
        // Re-fetch profile to check completion status
        const { data: p } = await supabase.from('user_profiles').select('profile_completed').eq('user_id', currentUserId).single();
        const isFirstTime = !p || !p.profile_completed;

        // SMART PAYLOAD: Only include name/team if it's the first time
        let updatePayload = {};
        
        if (isFirstTime) {
            updatePayload = {
                full_name: fullNameInput.value.trim(),
                team_name: teamNameInput.value.trim(),
                profile_completed: true
            };
            
            if (!updatePayload.full_name || !updatePayload.team_name) {
                throw new Error("Name and Team Name are required!");
            }
        } else {
            // If already completed, this button basically just confirms any other fields 
            // (like State/Contact) if you have them. If not, we just update the timestamp.
            updatePayload = { joined_at: p.joined_at }; // Nop update to avoid trigger
        }

        const { error: updateError } = await supabase.from('user_profiles')
            .update(updatePayload)
            .eq('user_id', currentUserId);

        if (updateError) throw updateError;

        saveStatus.classList.remove("hidden");
        setTimeout(() => {
            saveStatus.classList.add("hidden");
            if (isFirstTime) location.reload();
        }, 3000);

    } catch (err) {
        console.error("Save error:", err.message);
        alert(err.message || "Failed to save changes. Identity cannot be modified once set.");
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerText = "SAVE CHANGES";
    }
};

// Logout logic
document.getElementById("logoutBtn").onclick = async () => {
    await supabase.auth.signOut();
    window.location.href = "login.html";
};