import { supabase } from "../supabase.js"; // Adjust path if your supabase.js is in root

export async function initNotificationHub(userId) {
    const trigger = document.getElementById("notifTrigger");
    const panel = document.getElementById("notifPanel");
    const badge = document.getElementById("notifBadge");
    const list = document.getElementById("notifList");
    const markReadBtn = document.getElementById("markAllRead");

    const refreshNotifs = async () => {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error || !data) return;

        // Update the red badge
        const unreadCount = data.filter(n => !n.is_read).length;
        badge.innerText = unreadCount;
        badge.classList.toggle("hidden", unreadCount === 0);

        // Render the list
        if (data.length === 0) {
            list.innerHTML = `<div class="empty-notif">No alerts yet.</div>`;
            return;
        }

        list.innerHTML = data.map(n => `
            <div class="notif-item ${n.is_read ? '' : 'unread'}">
                <span class="title">${getIcon(n.type)} ${n.title}</span>
                <div class="msg">${n.message}</div>
                <span class="time">${new Date(n.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
        `).join('');
    };

    function getIcon(type) {
        const icons = { 'delay': '🌧️', 'points': '📈', 'lock': '🔒', 'abandoned': '🚫' };
        return icons[type] || '🔔';
    }

    // Toggle logic
    trigger.onclick = (e) => {
        e.stopPropagation();
        panel.classList.toggle("hidden");
    };

    markReadBtn.onclick = async () => {
        await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId);
        refreshNotifs();
    };

    document.addEventListener('click', () => panel.classList.add("hidden"));
    panel.onclick = (e) => e.stopPropagation();

    // Listen for new notifications in real-time
    supabase.channel('custom-notif-channel')
        .on('postgres_changes', { 
            event: 'INSERT', 
            schema: 'public', 
            table: 'notifications', 
            filter: `user_id=eq.${userId}` 
        }, () => refreshNotifs())
        .subscribe();

    refreshNotifs();
}