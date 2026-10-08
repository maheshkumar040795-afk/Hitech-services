// ════════════════════════════════════════════════════════════════
//  Hitech Services — settings (edit this file, no rebuild needed)
//  Supabase Dashboard → Project Settings → API
//  Use the "anon" / "publishable" key ONLY. Never the service_role / secret key.
// ════════════════════════════════════════════════════════════════
window.HITECH_CONFIG = {
  SUPABASE_URL: 'https://eqtdqqhnwfsmoamxvain.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_ct-3fMcvwl4LJvNoBMtzGA_ipmHjw68',

  // Hidden login domain for technicians (they only type their mobile number).
  // Must match TECH_EMAIL_DOMAIN in the admin-users Edge Function. Leave as is.
  TECH_EMAIL_DOMAIN: 'tech.htservice.in',
}
