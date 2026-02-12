import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export const supabase = createClient(
  "https://tuvqgcosbweljslbfgqc.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1dnFnY29zYndlbGpzbGJmZ3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NTkyNTgsImV4cCI6MjA4NjIzNTI1OH0._doWGRcUdRamCyd4i9YJd8vwZEGtfX5hwsAHtb1zKZo"
);
