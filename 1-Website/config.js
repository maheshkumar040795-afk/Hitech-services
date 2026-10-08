// ════════════════════════════════════════════════════════════════
//  Hitech Services — settings (edit this file, no rebuild needed)
//  Supabase Dashboard → Project Settings → API
//  Use the "anon" / "publishable" key ONLY. Never the service_role / secret key.
// ════════════════════════════════════════════════════════════════
window.HITECH_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-ID.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',

  // Hidden login domain for technicians (they only type their mobile number).
  // Must match TECH_EMAIL_DOMAIN in the admin-users Edge Function. Leave as is.
  TECH_EMAIL_DOMAIN: 'tech.htservice.in',
}
