import { supabase } from "./supabase.js";

export async function initNotificationHub(userId) {
    const trigger = document.getElementById("notifTrigger");
    const panel = document.getElementById("notifPanel");
    const badge = document.getElementById("notifBadge");
    const list = document.getElementById("notifList");
    const markReadBtn = document.getElementById("markAllRead");

    if (!trigger || !panel || !badge || !list || !markReadBtn) return;

    const refreshNotifs = async () => {
        const { data, error } = await supabase
            .from("notifications")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(10);

        if (error || !data) return;

        const unread = data.filter((notification) => !notification.is_read).length;
        badge.innerText = unread;
        badge.classList.toggle("hidden", unread === 0);

        list.replaceChildren();

        if (data.length === 0) {
            const empty = document.createElement("div");
            empty.className = "empty-notif";
            empty.textContent = "No new updates";
            list.appendChild(empty);
            return;
        }

        data.forEach((notification) => {
            const item = document.createElement("div");
            item.className = `notif-item ${notification.is_read ? "" : "unread"}`.trim();

            const title = document.createElement("span");
            title.className = "title";
            title.textContent = notification.title || "";

            const message = document.createElement("div");
            message.className = "msg";
            message.textContent = notification.message || "";

            const time = document.createElement("span");
            time.className = "time";
            time.textContent = new Date(notification.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            });

            item.append(title, message, time);
            list.appendChild(item);
        });
    };

    trigger.onclick = (e) => { e.stopPropagation(); panel.classList.toggle("hidden"); };
    markReadBtn.onclick = async () => {
        await supabase.from("notifications").update({ is_read: true }).eq("user_id", userId);
        refreshNotifs();
    };
    document.addEventListener("click", () => panel.classList.add("hidden"));
    panel.onclick = (e) => e.stopPropagation();

    supabase.channel("user-notifs")
        .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`
        }, () => refreshNotifs())
        .subscribe();

    refreshNotifs();
}
