import { supabase as adminSupabase } from "./supabase.js";

const ADMIN_EMAIL = "satyara9jansahoo@gmail.com";

let allUsers = [];

document.addEventListener("DOMContentLoaded", () => {
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

    const { data: auditData, error } = await adminSupabase
        .from("admin_audit_view")
        .select("*")
        .order("total_points", { ascending: false });

    if (error) {
        console.error("Critical Admin Error:", error.message);
        alert("Fetch failed. Check your console and Service Role key.");
        return;
    }

    allUsers = auditData || [];
    renderAuditCards(allUsers);
    renderAuditTable(allUsers);
    setupAdminListeners();
}

function renderAuditCards(data) {
    document.getElementById("totalUsers").textContent = data.length;
    document.getElementById("activeBoosters").textContent = data.filter((user) => user.s8_booster_used).length;
    document.getElementById("openQueries").textContent = "0";
}

function renderAuditTable(data) {
    const tbody = document.getElementById("auditBody");
    if (!tbody) return;

    tbody.replaceChildren();

    data.forEach((user) => {
        const row = document.createElement("tr");

        const teamCell = document.createElement("td");
        const strong = document.createElement("strong");
        strong.textContent = user.team_name || "No Team";
        teamCell.appendChild(strong);

        const nameCell = document.createElement("td");
        nameCell.textContent = user.full_name || "";

        const pointsCell = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = "pts-badge";
        badge.textContent = String(user.total_points ?? 0);
        pointsCell.appendChild(badge);

        const subsCell = document.createElement("td");
        subsCell.style.color = user.subs_remaining < 0 ? "#ff4d4d" : "#9AE000";
        subsCell.textContent = user.subs_remaining === 999 ? "INF" : String(user.subs_remaining ?? 0);

        const boosterCell = document.createElement("td");
        const bolt = document.createElement("i");
        bolt.className = "fas fa-bolt";
        bolt.style.color = user.s8_booster_used ? "#9AE000" : "var(--border);";
        boosterCell.appendChild(bolt);

        const actionCell = document.createElement("td");
        const actionBtn = document.createElement("button");
        actionBtn.className = "action-btn";
        actionBtn.onclick = () => window.viewUserDetails(user.user_id);

        const icon = document.createElement("i");
        icon.className = "fas fa-search";
        actionBtn.appendChild(icon);
        actionCell.appendChild(actionBtn);

        row.append(teamCell, nameCell, pointsCell, subsCell, boosterCell, actionCell);
        tbody.appendChild(row);
    });
}

function setupAdminListeners() {
    const searchInput = document.getElementById("userSearch");
    searchInput.addEventListener("input", (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter((user) =>
            (user.team_name || "").toLowerCase().includes(term) ||
            (user.full_name || "").toLowerCase().includes(term)
        );
        renderAuditTable(filtered);
    });
}

window.viewUserDetails = (userId) => {
    const newSubTotal = prompt(`Enter new TOTAL_SUBS_USED for user ${userId}:`);
    if (newSubTotal !== null) {
        updateUserSubs(userId, parseInt(newSubTotal, 10));
    }
};

async function updateUserSubs(userId, total) {
    const { error } = await adminSupabase
        .from("user_match_teams")
        .update({ total_subs_used: total })
        .eq("user_id", userId)
        .order("locked_at", { ascending: false })
        .limit(1);

    if (error) alert("Update failed: " + error.message);
    else {
        alert("User updated successfully!");
        loadAdminDashboard();
    }
}
