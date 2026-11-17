const supabaseUrl = "https://zfmsjtijkxewrzzvrthc.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmbXNqdGlqa3hld3J6enZydGhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNDEyNTYsImV4cCI6MjA5NTkxNzI1Nn0.4KAnZ8Fo0ohU6rvl9fiZZq0ntDDQLGnrXgDMGykioms";

window.supabaseClient = window.supabase.createClient(
  supabaseUrl,
  supabaseKey
);