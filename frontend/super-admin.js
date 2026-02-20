import { supabase } from "./supabase.js";
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css"></link>

window.addEventListener('auth-verified', async (e) => {
    const user = e.detail.user;
    
    // Check if user is actually an admin
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('is_admin')
        .eq('user_id', user.id)
        .single();

    if (!profile || !profile.is_admin) {
        alert("Access Denied: Admins Only.");
        window.location.href = "home.html";
        return;
    }

    // If they ARE admin, proceed to load the dashboard
    loadAdminDashboard();
});
/* =========================
   INITIALIZATION
========================= */
document.addEventListener('DOMContentLoaded', () => {
    loadAdminDashboard();
    setupAdminListeners();
});

async function loadAdminDashboard() {
    const { data: auditData, error } = await supabase
        .from('admin_audit_view')
        .select('*')
        .order('total_points', { ascending: false });

    if (error) {
        console.error("Error fetching audit data:", error);
        return;
    }

    renderAuditCards(auditData);
    renderAuditTable(auditData);
}

/* =========================
   CORE RENDERING
======================== */
function renderAuditCards(data) {
    const totalUsers = data.length;
    const activeBoosters = data.filter(u => u.s8_booster_used).length;
    
    // We'll fetch open queries separately if you have the table, 
    // otherwise setting a placeholder for now.
    document.getElementById("totalUsers").textContent = totalUsers;
    document.getElementById("activeBoosters").textContent = activeBoosters;
}

function renderAuditTable(data) {
    const tbody = document.getElementById("auditBody");
    tbody.innerHTML = data.map(user => `
        <tr>
            <td><strong>${user.team_name || 'N/A'}</strong></td>
            <td>${user.full_name}</td>
            <td><span class="pts-badge">${user.total_points}</span></td>
            <td style="color: ${user.subs_remaining < 0 ? '#ef4444' : '#9AE000'}">
                ${user.subs_remaining === 999 ? '∞' : user.subs_remaining}
            </td>
            <td>
                <i class="fas fa-bolt" style="color: ${user.s8_booster_used ? '#9AE000' : '#475569'}"></i>
            </td>
            <td>
                <button class="action-btn" onclick="viewUserDetails('${user.user_id}')">
                    <i class="fas fa-eye"></i>
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
        const rows = document.querySelectorAll("#auditBody tr");
        
        rows.forEach(row => {
            const team = row.cells[0].textContent.toLowerCase();
            const name = row.cells[1].textContent.toLowerCase();
            row.style.display = (team.includes(term) || name.includes(term)) ? "" : "none";
        });
    });
}

// Global function for the "View" button
window.viewUserDetails = (userId) => {
    // Redirect to a specific user audit page or open a modal
    console.log("Auditing User ID:", userId);
    window.location.href = `user-audit.html?id=${userId}`;
};