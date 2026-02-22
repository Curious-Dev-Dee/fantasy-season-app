import { supabase } from "./supabase.js"; // Changed from ../ to ./

export async function initNotificationHub(userId) {
    const trigger = document.getElementById("notifTrigger");
    const panel = document.getElementById("notifPanel");
    const badge = document.getElementById("notifBadge");
    const list = document.getElementById("notifList");
    const markReadBtn = document.getElementById("markAllRead");

    if (!trigger || !panel) return;

    const refreshNotifs = async () => {
        const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10);
        if (error || !data) return;

        const unread = data.filter(n => !n.is_read).length;
        badge.innerText = unread;
        badge.classList.toggle("hidden", unread === 0);

        list.innerHTML = data.length === 0 ? '<div class="empty-notif">No new updates</div>' : data.map(n => `
            <div class="notif-item ${n.is_read ? '' : 'unread'}">
                <span class="title">${n.title}</span>
                <div class="msg">${n.message}</div>
                <span class="time">${new Date(n.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>`).join('');
    };

    trigger.onclick = (e) => { e.stopPropagation(); panel.classList.toggle("hidden"); };
    markReadBtn.onclick = async () => { await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId); refreshNotifs(); };
    document.addEventListener('click', () => panel.classList.add("hidden"));
    panel.onclick = (e) => e.stopPropagation();
    
    supabase.channel('user-notifs').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => refreshNotifs()).subscribe();
    refreshNotifs();
}