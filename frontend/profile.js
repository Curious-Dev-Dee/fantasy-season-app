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

async function loadProfile() {
    const { data: p } = await supabase.from('user_profiles').select('*').eq('user_id', currentUserId).single();
    if (p) {
        fullNameInput.value = p.full_name || "";
        teamNameInput.value = p.team_name || "";
        
        if (p.team_photo_url) {
            const { data } = supabase.storage.from('team-avatars').getPublicUrl(p.team_photo_url);
            avatarDisplay.style.backgroundImage = `url(${data.publicUrl})`;
        }
    }
}

// 2. Photo Upload Trigger
document.getElementById("changePhotoBtn").onclick = () => avatarInput.click();

avatarInput.onchange = async () => {
    const file = avatarInput.files[0];
    if (!file) return;

    const fileExt = file.name.split('.').pop();
    const fileName = `${currentUserId}-${Math.random()}.${fileExt}`;

    const { error } = await supabase.storage.from('team-avatars').upload(fileName, file, { upsert: true });
    
    if (!error) {
        await supabase.from('user_profiles').update({ team_photo_url: fileName }).eq('user_id', currentUserId);
        location.reload();
    }
};

// 3. Save Text Data
saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.innerText = "SAVING...";

    const { error } = await supabase.from('user_profiles').update({
        full_name: fullNameInput.value.trim(),
        team_name: teamNameInput.value.trim()
        // Add contact, state etc if columns exist
    }).eq('user_id', currentUserId);

    if (!error) {
        saveStatus.classList.remove("hidden");
        setTimeout(() => saveStatus.classList.add("hidden"), 3000);
    }
    
    saveBtn.disabled = false;
    saveBtn.innerText = "SAVE CHANGES";
};

// Logout logic
document.getElementById("logoutBtn").onclick = async () => {
    await supabase.auth.signOut();
    window.location.href = "login.html";
};