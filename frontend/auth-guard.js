async function protectPage() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error("Session check failed:", error);
      window.location.replace("/");
      return;
    }

    if (!session) {
      window.location.replace("/");
      return;
    }

    // ✅ Unlock UI
    document.body.classList.remove("loading-state");
    
    // ✅ Fire the event (your existing pattern is perfect!)
    const event = new CustomEvent('auth-verified', { 
      detail: { user: session.user } 
    });
    window.dispatchEvent(event);
    
    console.log("✅ Auth Guard: User verified", session.user.email);
    
  } catch (error) {
    console.error("Auth guard error:", error);
    window.location.replace("/");
  }
}
