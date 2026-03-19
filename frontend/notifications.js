import { supabase } from "./supabase.js";

/* ── Notification type metadata ── */
const NOTIF_META = {
    points:   { icon: "⚡", label: "Points"   },
    locked:   { icon: "🔒", label: "Locked"   },
    abandoned:{ icon: "🚫", label: "Abandoned" },
    delayed:  { icon: "⏰", label: "Delayed"  },
    info:     { icon: "🏏", label: "Update"   },
};

/* ── Relative timestamp (e.g. "2h ago", "just now") ── */
function relativeTime(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins  = Math.floor(diff / 60000);
    if (mins < 1)  return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

export async function initNotificationHub(userId) {
    const trigger    = document.getElementById("notifTrigger");
    const panel      = document.getElementById("notifPanel");
    const badge      = document.getElementById("notifBadge");
    const list       = document.getElementById("notifList");
    const markReadBtn = document.getElementById("markAllRead");

    if (!trigger || !panel || !badge || !list || !markReadBtn) return;

    /* ── Render notifications ── */
    const refreshNotifs = async () => {
        const { data, error } = await supabase
            .from("notifications")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(20);

        if (error || !data) return;

        // Update badge
        const unreadCount = data.filter(n => !n.is_read).length;
        badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
        badge.classList.toggle("hidden", unreadCount === 0);

        list.replaceChildren();

        if (data.length === 0) {
            const empty       = document.createElement("div");
            empty.className   = "empty-notif";
            empty.textContent = "You're all caught up 🏏";
            list.appendChild(empty);
            return;
        }

        data.forEach(notif => {
            const meta   = NOTIF_META[notif.type] || NOTIF_META.info;
            const item   = document.createElement("div");
            item.className = `notif-item ${notif.is_read ? "" : "unread"}`.trim();
            item.dataset.type = notif.type || "info";

            // Mark as read on click
            item.onclick = async () => {
                if (!notif.is_read) {
                    item.classList.remove("unread");
                    await supabase.from("notifications")
                        .update({ is_read: true })
                        .eq("id", notif.id);
                    // Decrement badge without a full refresh
                    const current = parseInt(badge.textContent || "0", 10);
                    const next    = Math.max(0, current - 1);
                    badge.textContent = next > 9 ? "9+" : String(next);
                    badge.classList.toggle("hidden", next === 0);
                }
            };

            // Icon + title row
            const titleRow       = document.createElement("div");
            titleRow.className   = "notif-title-row";

            const iconEl         = document.createElement("span");
            iconEl.className     = "notif-icon";
            iconEl.textContent   = meta.icon;

            const titleEl        = document.createElement("span");
            titleEl.className    = "title";
            titleEl.textContent  = notif.title || "";

            titleRow.append(iconEl, titleEl);

            // Message — support multi-line (newlines from DB)
            const msgEl        = document.createElement("div");
            msgEl.className    = "msg";

            // Split on newlines so double-header messages render as separate lines
            const lines = (notif.message || "").split("\n");
            lines.forEach((line, i) => {
                if (i > 0) msgEl.appendChild(document.createElement("br"));
                msgEl.appendChild(document.createTextNode(line));
            });

            // Time
            const timeEl        = document.createElement("span");
            timeEl.className    = "time";
            timeEl.textContent  = relativeTime(notif.created_at);

            item.append(titleRow, msgEl, timeEl);
            list.appendChild(item);
        });
    };

    /* ── Toggle panel ── */
    trigger.onclick = (e) => {
        e.stopPropagation();
        const isHidden = panel.classList.contains("hidden");
        panel.classList.toggle("hidden");
        // Mark all read when opening
        if (isHidden) {
            supabase.from("notifications")
                .update({ is_read: true })
                .eq("user_id", userId)
                .eq("is_read", false)
                .then(() => {
                    badge.textContent = "0";
                    badge.classList.add("hidden");
                    list.querySelectorAll(".notif-item.unread").forEach(el => {
                        el.classList.remove("unread");
                    });
                });
        }
    };

    markReadBtn.onclick = async () => {
        await supabase.from("notifications")
            .update({ is_read: true })
            .eq("user_id", userId);
        badge.textContent = "0";
        badge.classList.add("hidden");
        list.querySelectorAll(".notif-item.unread").forEach(el =>
            el.classList.remove("unread")
        );
    };

    // Close panel when clicking outside
    document.addEventListener("click", () => panel.classList.add("hidden"));
    panel.onclick = (e) => e.stopPropagation();

    /* ── Realtime: new notification arrives → refresh + animate bell ── */
    supabase.channel(`user-notifs-${userId}`)
        .on(
            "postgres_changes",
            {
                event:  "INSERT",
                schema: "public",
                table:  "notifications",
                filter: `user_id=eq.${userId}`,
            },
            () => {
                refreshNotifs();
                // Briefly animate the bell so user notices
                trigger.classList.add("bell-ring");
                setTimeout(() => trigger.classList.remove("bell-ring"), 1000);
            }
        )
        .subscribe();

    // Initial load
    refreshNotifs();
}