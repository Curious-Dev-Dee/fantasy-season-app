import { supabase } from "./supabase.js";

// Global state to hold users for searching
let allUsers = [];

/* =========================
   AUTH CHECK & INIT
========================= */
window.addEventListener('auth-verified', async (e) => {
    const user = e.detail.user;
    
    // 1. Verify Admin Status immediately
    const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('is_admin')
        .eq('user_id', user.id)
        .single();

    if (profileError || !profile || !profile.is_admin) {
        console.error("Admin verification failed:", profileError);
        alert("ACCESS DENIED: You do not have admin privileges.");
        window.location.href = "home.html";
        return;
    }

    // 2. Load the data ONLY after admin status is confirmed
    initAdmin();
});

async function initAdmin() {
    await loadAdminDashboard();
    setupAdminListeners();
}

/* =========================
   DATA FETCHING
========================= */
async function loadAdminDashboard() {
    console.log("Loading Admin View...");
    
    const { data: auditData, error } = await supabase
        .from('admin_audit_view')
        .select('*')
        .order('total_points', { ascending: false });

    if (error) {
        console.error("Audit Fetch Error:", error.message);
        // If 403 happens here, check SQL GRANTS
        return;
    }

    allUsers = auditData; // Store for search
    renderAuditCards(auditData);
    renderAuditTable(auditData);
}

/* =========================
   CORE RENDERING
======================== */
function renderAuditCards(data) {
    document.getElementById("totalUsers").textContent = data.length;
    document.getElementById("activeBoosters").textContent = data.filter(u => u.s8_booster_used).length;
    // Open queries would be a separate fetch from your support table
}

function renderAuditTable(data) {
    const tbody = document.getElementById("auditBody");
    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center">No users found.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(user => `
        <tr>
            <td><strong>${user.team_name || 'No Team'}</strong></td>
            <td>${user.full_name}</td>
            <td><span class="pts-badge">${user.total_points}</span></td>
            <td style="color: ${user.subs_remaining < 0 ? '#ff4d4d' : '#9AE000'}">
                ${user.subs_remaining === 999 ? '∞' : user.subs_remaining}
            </td>
            <td>
                <i class="fas fa-bolt" style="color: ${user.s8_booster_used ? '#9AE000' : '#334155'}"></i>
            </td>
            <td>
                <button class="action-btn" title="Audit User" onclick="viewUserDetails('${user.user_id}')">
                    <i class="fas fa-search"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

/* =========================
   INTERACTIVE FEATURES
========================= */
function setupAdminListeners() {
    const searchInput = document.getElementById("userSearch");
    
    searchInput.addEventListener("input", (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter(u => 
            (u.team_name || '').toLowerCase().includes(term) || 
            (u.full_name || '').toLowerCase().includes(term)
        );
        renderAuditTable(filtered);
    });
}

// Global function attached to window for HTML access
window.viewUserDetails = (userId) => {
    // Navigate to a detail page with the ID as a parameter
    window.location.href = `user-audit.html?user=${userId}`;
};