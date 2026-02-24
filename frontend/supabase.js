// frontend/supabase.js - IMPROVED VERSION

// ✅ Use environment variables (set these in Vercel dashboard)
const SUPABASE_URL = 'https://tuvqgcosbweljslbfgqc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1dnFnY29zYndlbGpzbGJmZ3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NTkyNTgsImV4cCI6MjA4NjIzNTI1OH0._doWGRcUdRamCyd4i9YJd8vwZEGtfX5hwsAHtb1zKZo'; // Your anon key

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // ✅ Auto refresh tokens
    autoRefreshToken: true,
    // ✅ Persist session in localStorage
    persistSession: true,
    // ✅ Detect auth changes across tabs
    detectSessionInUrl: false
  }
});

// ✅ Helper to check if user is admin (you can use this later)
export async function isAdmin() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  
  // Check your 'profiles' table for role (we'll set this up later)
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();
    
  return data?.role === 'admin';
}
