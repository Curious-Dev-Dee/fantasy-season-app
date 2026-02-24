import { supabase as adminSupabase } from "./supabase.js";

const ADMIN_EMAIL = "satyara9jansahoo@gmail.com";

let allUsers = [];

document.addEventListener('DOMContentLoaded', () => {
    initSuperAdmin();
});

async function initSuperAdmin() {
    const { data: { user }, error } = await adminSupabase.auth.getUser();
    if (error || !user) {
        alert("Please log in first.");
        window.location.href = "login.html";
        return;
    }

    const loggedInEmail = (user.email || "").trim().toLowerCase();
    if (loggedInEmail !== ADMIN_EMAIL.toLowerCase()) {
        alert(`Access Denied: ${user.email} is not authorized.`);
        window.location.href = "home.html";
        return;
    }

    loadAdminDashboard();
}

async function loadAdminDashboard() {
    console.log("Fetching admin audit data...");
    
    // Fetch directly from your view
    const { data: auditData, error } = await adminSupabase
        .from('admin_audit_view')
        .select('*')
        .order('total_points', { ascending: false });

    if (error) {
        console.error("Critical Admin Error:", error.message);
        alert("Fetch failed. Check your console and Service Role key.");
        return;
    }

    allUsers = auditData;
    renderAuditCards(auditData);
    renderAuditTable(auditData);
    setupAdminListeners();
}

function renderAuditCards(data) {
    document.getElementById("totalUsers").textContent = data.length;
    document.getElementById("activeBoosters").textContent = data.filter(u => u.s8_booster_used).length;
    // Placeholder for queries since that table is new
    document.getElementById("openQueries").textContent = "0"; 
}

function renderAuditTable(data) {
    const tbody = document.getElementById("auditBody");
    
    tbody.innerHTML = data.map(user => `
        <tr>
            <td><strong>${user.team_name || 'No Team'}</strong></td>
            <td>${user.full_name}</td>
            <td><span class="pts-badge">${user.total_points}</span></td>
            <td style="color: ${user.subs_remaining < 0 ? '#ff4d4d' : '#9AE000'}">
                ${user.subs_remaining === 999 ? 'INF' : user.subs_remaining}
            </td>
            <td>
                <i class="fas fa-bolt" style="color: ${user.s8_booster_used ? '#9AE000' : '#334155'}"></i>
            </td>
            <td>
                <button class="action-btn" onclick="viewUserDetails('${user.user_id}')">
                    <i class="fas fa-search"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

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

window.viewUserDetails = (userId) => {
    // Open a prompt to manually override subs for this user
    const newSubTotal = prompt(`Enter new TOTAL_SUBS_USED for user ${userId}:`);
    if (newSubTotal !== null) {
        updateUserSubs(userId, parseInt(newSubTotal));
    }
};

async function updateUserSubs(userId, total) {
    const { error } = await adminSupabase
        .from('user_match_teams')
        .update({ total_subs_used: total })
        .eq('user_id', userId)
        .order('locked_at', { ascending: false })
        .limit(1);

    if (error) alert("Update failed: " + error.message);
    else {
        alert("User updated successfully!");
        loadAdminDashboard();
    }
}
