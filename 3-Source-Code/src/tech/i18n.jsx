// HT Jobs (technician app) language: Tamil (default) or English. The office web app stays English.
// Usage: const { t, lang, setLang } = useLang();  t('Mark Completed')  ·  t('Collect {amt}', { amt })
// Keys are the English text; a missing Tamil text simply shows the English.
import { useSyncExternalStore } from 'react'

const KEY = 'ht_lang'
let lang = (() => { try { return localStorage.getItem(KEY) || 'ta' } catch { return 'ta' } })()
const subs = new Set()

export function setLang(l) {
  lang = l === 'en' ? 'en' : 'ta'
  try { localStorage.setItem(KEY, lang) } catch { /* ignore */ }
  try { document.documentElement.lang = lang } catch { /* ignore */ }
  subs.forEach((f) => f())
}
export const getLang = () => lang
/** For dates: Tamil month / weekday names in Tamil mode */
export const locale = () => (lang === 'ta' ? 'ta-IN' : 'en-IN')

// English text for keys that are not plain sentences (parts of a sentence in another order in Tamil)
const EN = {
  'collect.before': 'You have to collect',
  'collect.after': 'from the customer',
  'wd.0': 'Mon', 'wd.1': 'Tue', 'wd.2': 'Wed', 'wd.3': 'Thu', 'wd.4': 'Fri', 'wd.5': 'Sat', 'wd.6': 'Sun',
}

const TA = {
  // ── Reasons for "Can't complete" (the office still gets the English reason) ──
  'Customer not available': 'வாடிக்கையாளர் வீட்டில் இல்லை',
  'Customer not answering phone': 'வாடிக்கையாளர் போன் எடுக்கவில்லை',
  'Wrong / incomplete address': 'தவறான / முழுமையில்லாத முகவரி',
  'Customer cancelled': 'வாடிக்கையாளர் ரத்து செய்தார்',
  'Product not delivered yet': 'பொருள் இன்னும் டெலிவரி ஆகவில்லை',
  'Parts / material needed': 'பாகங்கள் / பொருட்கள் தேவை',
  'Site not ready': 'இடம் தயாராக இல்லை',
  'Other': 'வேறு காரணம்',

  // ── Mark completed ──
  'Select what you repaired': 'என்ன ரிப்பேர் செய்தீர்கள் என்று தேர்ந்தெடுக்கவும்',
  'Select what you installed': 'என்ன இன்ஸ்டால் செய்தீர்கள் என்று தேர்ந்தெடுக்கவும்',
  'Select Collect from customer or Paid on Amazon': '"வாடிக்கையாளரிடம் வசூல்" அல்லது "Amazon-ல் செலுத்தப்பட்டது" தேர்ந்தெடுக்கவும்',
  'Enter the amount collected from the customer': 'வாடிக்கையாளரிடம் வாங்கிய தொகையை உள்ளிடவும்',
  'Please wait, photos are still uploading': 'காத்திருக்கவும், போட்டோக்கள் இன்னும் அப்லோட் ஆகின்றன',
  'A photo did not upload. Tap it to retry, or remove it (✕).': 'ஒரு போட்டோ அப்லோட் ஆகவில்லை. மீண்டும் முயற்சிக்க அதைத் தொடவும், அல்லது நீக்கவும் (✕).',
  'Add at least 1 photo of the installation': 'குறைந்தது 1 இன்ஸ்டாலேஷன் போட்டோ சேர்க்கவும்',
  'Photos are not set up on the server yet. Please call the office.': 'போட்டோ வசதி இன்னும் தயாராகவில்லை. ஆபீஸுக்கு போன் செய்யவும்.',
  'Job completed · paid on Amazon': 'வேலை முடிந்தது · Amazon-ல் செலுத்தப்பட்டது',
  'Job completed · {amt} collected from customer': 'வேலை முடிந்தது · வாடிக்கையாளரிடம் {amt} வசூல்',
  'Mark repair completed': 'ரிப்பேர் முடிந்தது',
  'Mark job completed': 'வேலை முடிந்தது',
  'collect.before': 'வாடிக்கையாளரிடம்',
  'collect.after': 'வசூலிக்க வேண்டும்',
  'This order is not paid on Amazon. Collect the amount (cash or UPI) before you leave.': 'இந்த ஆர்டருக்கு Amazon-ல் பணம் செலுத்தப்படவில்லை. கிளம்பும் முன் தொகையை (பணம் அல்லது UPI) வாங்கவும்.',
  '1. What did you repair?': '1. என்ன ரிப்பேர் செய்தீர்கள்?',
  '1. What did you install?': '1. என்ன இன்ஸ்டால் செய்தீர்கள்?',
  'Payment': 'பணம்',
  '2. Payment': '2. பணம்',
  'Collect from customer': 'வாடிக்கையாளரிடம் வசூல்',
  'Paid on Amazon': 'Amazon-ல் செலுத்தப்பட்டது',
  'Customer already paid on Amazon — nothing to collect (₹0).': 'வாடிக்கையாளர் ஏற்கனவே Amazon-ல் செலுத்திவிட்டார் — வசூலிக்க எதுவும் இல்லை (₹0).',
  'Amount you received from the customer (cash or UPI). It is deducted from your pay for this job.': 'வாடிக்கையாளரிடம் நீங்கள் வாங்கிய தொகை (பணம் அல்லது UPI). இது இந்த வேலைக்கான உங்கள் சம்பளத்தில் கழிக்கப்படும்.',
  'Amount collected': 'வசூலித்த தொகை',
  'Amount fixed by office · cannot be changed': 'அலுவலகம் நிர்ணயித்த தொகை · மாற்ற முடியாது',
  'Note': 'குறிப்பு',
  '(optional)': '(விருப்பம்)',
  'e.g. Installed with extra pipe 2 m': 'எ.கா. கூடுதல் பைப் 2 மீ வைத்து இன்ஸ்டால் செய்தேன்',
  'Saving…': 'சேமிக்கிறது…',
  'Uploading photos…': 'போட்டோக்கள் அப்லோட் ஆகின்றன…',
  'Submit — Job Completed': 'சமர்ப்பி — வேலை முடிந்தது',

  // ── Can't complete ──
  'Select or type a reason': 'காரணத்தைத் தேர்ந்தெடுக்கவும் அல்லது எழுதவும்',
  'Reported to office': 'ஆபீஸுக்கு தெரிவிக்கப்பட்டது',
  "Can't complete this job": 'இந்த வேலையை முடிக்க முடியவில்லை',
  'Why? The office will see this reason.': 'ஏன்? இந்த காரணத்தை ஆபீஸ் பார்க்கும்.',
  'Type the reason': 'காரணத்தை எழுதவும்',
  'Sending…': 'அனுப்புகிறது…',
  'Submit reason': 'காரணத்தை அனுப்பு',

  // ── Job detail ──
  'Re-open this job? It goes back to Rescheduled ({d}).': 'இந்த வேலையை மீண்டும் திறக்கவா? இது மாற்றிய தேதிக்கு ({d}) திரும்பும்.',
  'Re-open this job as Pending?': 'இந்த வேலையை மீண்டும் நிலுவையாகத் திறக்கவா?',
  'Job re-opened': 'வேலை மீண்டும் திறக்கப்பட்டது',
  'Call': 'அழை',
  'Location': 'லொகேஷன்',
  'Map': 'மேப்',
  'Job': 'வேலை',
  'Repair': 'ரிப்பேர்',
  'Service': 'சேவை',
  'Product type': 'பொருள் வகை',
  'Installed': 'இன்ஸ்டால் செய்தது',
  'Cash collect': 'வசூலிக்க வேண்டியது',
  '{amt} from customer': 'வாடிக்கையாளரிடம் {amt}',
  'Phone': 'போன்',
  'Address': 'முகவரி',
  'Pin code': 'பின்கோடு',
  'Order date': 'ஆர்டர் தேதி',
  'Rescheduled to': 'மாற்றிய தேதி',
  'Completed on': 'முடிந்த நேரம்',
  'Closed': 'மூடப்பட்டது',
  '{amt} collected from customer': 'வாடிக்கையாளரிடம் {amt} வசூல்',
  'Mark Completed': 'வேலை முடிந்தது',
  "Can't Complete": 'முடிக்க முடியவில்லை',
  'Closed on an earlier day. Call the office to change it.': 'முந்தைய நாளில் மூடப்பட்டது. மாற்ற ஆபீஸுக்கு போன் செய்யவும்.',
  'Edit details': 'விவரங்களை மாற்று',
  'Re-open': 'மீண்டும் திற',
  'Notes': 'குறிப்புகள்',
  'Add a note for the office…': 'ஆபீஸுக்கு ஒரு குறிப்பு எழுதவும்…',
  'You': 'நீங்கள்',
  'Office': 'ஆபீஸ்',
  '(office)': '(ஆபீஸ்)',
  'No notes yet': 'இன்னும் குறிப்புகள் இல்லை',
  'Notes need internet': 'குறிப்பு எழுத இன்டர்நெட் தேவை',

  // ── Status ──
  'Pending': 'நிலுவை',
  'Rescheduled': 'மாற்றிய தேதி',
  'Completed': 'முடிந்தது',
  'Not done': 'முடியவில்லை',
  'Done': 'முடிந்தவை',
  'Repair completed': 'ரிப்பேர் முடிந்தது',
  'Paid on Amazon · nothing collected': 'Amazon-ல் செலுத்தப்பட்டது · வசூல் இல்லை',
  'cash collected': 'பணம் வசூல்',
  'NEW': 'புதிது',
  'REPAIR': 'ரிப்பேர்',
  'Rescheduled · ': 'மாற்றிய தேதி · ',
  ' · overdue': ' · தாமதம்',
  'Collect {amt}': '{amt} வசூலிக்கவும்',

  // ── Account ──
  'PIN must be at least 6 digits': 'PIN குறைந்தது 6 எண்கள் இருக்க வேண்டும்',
  'PIN changed': 'PIN மாற்றப்பட்டது',
  'My account': 'என் கணக்கு',
  'Technician ID: {c}': 'டெக்னீஷியன் ID: {c}',
  'Change PIN': 'PIN மாற்று',
  'New PIN (6+ digits)': 'புதிய PIN (6+ எண்கள்)',
  'Logout': 'வெளியேறு',
  'Language': 'மொழி',

  // ── Salary ──
  'Previous month': 'கடந்த மாதம்',
  'Current month': 'இந்த மாதம்',
  'Earned': 'சம்பாதித்தது',
  'Install': 'இன்ஸ்டால்',
  'Collected': 'வசூல்',
  'Petrol': 'பெட்ரோல்',
  'Advance': 'அட்வான்ஸ்',
  'Paid': 'கொடுத்தது',
  'Salary paid ✓ {d}': 'சம்பளம் கொடுக்கப்பட்டது ✓ {d}',
  'You owe office': 'ஆபீஸுக்கு தர வேண்டியது',
  'Net salary': 'நிகர சம்பளம்',
  'Installations': 'இன்ஸ்டாலேஷன்',
  'Repairs': 'ரிப்பேர்',
  '1 job': '1 வேலை',
  '{n} jobs': '{n} வேலைகள்',
  '1 job completed': '1 வேலை முடிந்தது',
  '{n} jobs completed': '{n} வேலைகள் முடிந்தன',
  'Collected from customers': 'வாடிக்கையாளர்களிடம் வசூல்',
  'Cash / UPI you received': 'நீங்கள் வாங்கிய பணம் / UPI',
  'Petrol allowance': 'பெட்ரோல் அலவன்ஸ்',
  'Salary advance': 'சம்பள அட்வான்ஸ்',
  'Salary paid': 'சம்பளம் கொடுக்கப்பட்டது',
  'Balance': 'மீதம்',
  'Petrol allowance & advance': 'பெட்ரோல் அலவன்ஸ் & அட்வான்ஸ்',
  'Net salary = Earned − Collected + Petrol − Advance. Questions? Call the office.': 'நிகர சம்பளம் = சம்பாதித்தது − வசூல் + பெட்ரோல் − அட்வான்ஸ். சந்தேகம் இருந்தால் ஆபீஸுக்கு போன் செய்யவும்.',
  'Net salary = Earned − Collected. Questions? Call the office.': 'நிகர சம்பளம் = சம்பாதித்தது − வசூல். சந்தேகம் இருந்தால் ஆபீஸுக்கு போன் செய்யவும்.',

  // ── Main screen ──
  'Your login is not linked to a technician profile.': 'உங்கள் லாகின் டெக்னீஷியன் கணக்குடன் இணைக்கப்படவில்லை.',
  'Please contact the office.': 'ஆபீஸைத் தொடர்பு கொள்ளவும்.',
  'No matching jobs': 'பொருந்தும் வேலைகள் இல்லை',
  'No pending jobs': 'நிலுவை வேலைகள் இல்லை',
  'Nothing here in the last {n} days': 'கடந்த {n} நாட்களில் எதுவும் இல்லை',
  'New jobs appear here automatically when the office assigns them.': 'ஆபீஸ் வேலை கொடுத்தவுடன் புதிய வேலைகள் இங்கே தானாக வரும்.',
  'Showing last {a} days · Show last {b} days': 'கடந்த {a} நாட்கள் · கடந்த {b} நாட்களைக் காட்டு',
  'Live': 'நேரலை',
  'Reconnecting': 'மீண்டும் இணைக்கிறது',
  'Turn on job notifications': 'வேலை அறிவிப்புகளை இயக்கவும்',
  'Get a phone notification every time the office assigns you a job, even when this app is closed.': 'ஆபீஸ் உங்களுக்கு வேலை கொடுக்கும் ஒவ்வொரு முறையும், ஆப் மூடியிருந்தாலும் போனில் அறிவிப்பு வரும்.',
  'On iPhone, add HT Jobs to your Home Screen first, then open it from there to turn on alerts.': 'iPhone-ல் முதலில் HT Jobs-ஐ Home Screen-ல் சேர்க்கவும், பிறகு அங்கிருந்து திறந்து அறிவிப்புகளை இயக்கவும்.',
  'Alerts are blocked. Allow notifications for HT Jobs in your phone Settings.': 'அறிவிப்புகள் தடுக்கப்பட்டுள்ளன. போன் Settings-ல் HT Jobs-க்கு அறிவிப்புகளை அனுமதிக்கவும்.',
  'Turning on…': 'இயக்குகிறது…',
  'Turn on notifications': 'அறிவிப்புகளை இயக்கு',
  'How to add to Home Screen': 'Home Screen-ல் சேர்ப்பது எப்படி',
  'Search item, area, pincode…': 'பொருள், பகுதி, பின்கோடு தேடுங்கள்…',
  'Search name, area, pincode…': 'பெயர், பகுதி, பின்கோடு தேடுங்கள்…',
  'Retry': 'மீண்டும் முயற்சி',
  'Welcome,': 'வணக்கம்,',
  'Technician ID · {c}': 'டெக்னீஷியன் ID · {c}',
  'Technician': 'டெக்னீஷியன்',
  'Loading your jobs…': 'உங்கள் வேலைகள் ஏற்றப்படுகின்றன…',
  'You have 1 pending job': 'உங்களுக்கு 1 நிலுவை வேலை உள்ளது',
  'You have {n} pending jobs': 'உங்களுக்கு {n} நிலுவை வேலைகள் உள்ளன',
  'No pending jobs right now': 'இப்போது நிலுவை வேலைகள் இல்லை',
  'Mark each job Completed with the amount collected': 'ஒவ்வொரு வேலையையும் வசூல் தொகையுடன் "முடிந்தது" எனக் குறிக்கவும்',
  'View my jobs': 'என் வேலைகளைப் பார்',

  // ── Photos ──
  'Installation photos': 'இன்ஸ்டாலேஷன் போட்டோக்கள்',
  'Take photo': 'போட்டோ எடு',
  'Upload from gallery': 'கேலரியிலிருந்து சேர்',
  'Failed': 'தோல்வி',
  'Remove photo': 'போட்டோவை நீக்கு',
  'Uploading 1 photo…': '1 போட்டோ அப்லோட் ஆகிறது…',
  'Uploading {n} photos…': '{n} போட்டோக்கள் அப்லோட் ஆகின்றன…',
  'Maximum 10 photos.': 'அதிகபட்சம் 10 போட்டோக்கள்.',
  'Take photos of the installed product (photos are made smaller before upload).': 'இன்ஸ்டால் செய்த பொருளை போட்டோ எடுக்கவும் (அப்லோட் முன் போட்டோ சிறியதாக்கப்படும்).',
  'No internet': 'இன்டர்நெட் இல்லை',
  'Could not read this photo': 'இந்த போட்டோவைப் படிக்க முடியவில்லை',
  'Will upload when online': 'இன்டர்நெட் வந்ததும் அப்லோட் ஆகும்',
  'No internet: photos are saved on the phone and upload when you are back online.': 'இன்டர்நெட் இல்லை: போட்டோக்கள் போனில் சேமிக்கப்பட்டு, இன்டர்நெட் வந்ததும் அப்லோட் ஆகும்.',

  // ── Done calendar ──
  'wd.0': 'தி', 'wd.1': 'செ', 'wd.2': 'பு', 'wd.3': 'வி', 'wd.4': 'வெ', 'wd.5': 'ச', 'wd.6': 'ஞா',
  'Whole month': 'முழு மாதம்',
  'Today': 'இன்று',
  'job done': 'வேலை முடிந்தது',
  'jobs done': 'வேலைகள் முடிந்தன',
  'earned': 'சம்பாதித்தது',
  '{n} job': '{n} வேலை',
  '{n} jobs.cell': '{n} வேலை',
  'No jobs completed on this day': 'இந்த நாளில் வேலை எதுவும் முடியவில்லை',
  'No jobs completed this month': 'இந்த மாதம் வேலை எதுவும் முடியவில்லை',
  'Cash collected': 'பணம் வசூல்',
  'Outside Chennai': 'சென்னைக்கு வெளியே',
  'Chennai': 'சென்னை',
  'The calendar needs internet. Showing the last saved data.': 'காலண்டருக்கு இன்டர்நெட் தேவை. கடைசியாகச் சேமித்தது காட்டப்படுகிறது.',

  // ── Offline ──
  'Offline · showing saved jobs': 'இன்டர்நெட் இல்லை · சேமித்த வேலைகள்',
  '1 update waiting to send': '1 அப்டேட் அனுப்பக் காத்திருக்கிறது',
  '{n} updates waiting to send': '{n} அப்டேட்கள் அனுப்பக் காத்திருக்கின்றன',
  'Send now': 'இப்போது அனுப்பு',
  'Saved on phone · will send when internet is back': 'போனில் சேமிக்கப்பட்டது · இன்டர்நெட் வந்ததும் அனுப்பப்படும்',
  'Waiting to send': 'அனுப்பக் காத்திருக்கிறது',
  'All updates sent to office': 'எல்லா அப்டேட்களும் ஆபீஸுக்கு அனுப்பப்பட்டன',
  'Could not update {o}: {e}': '{o} அப்டேட் ஆகவில்லை: {e}',
  'This needs internet': 'இதற்கு இன்டர்நெட் தேவை',
  'Sending saved updates…': 'சேமித்த அப்டேட்கள் அனுப்பப்படுகின்றன…',

  // ── App update / install banners ──
  'A new version is available': 'புதிய பதிப்பு வந்துள்ளது',
  'Update now': 'இப்போது அப்டேட் செய்',
  'Install HT Jobs': 'HT Jobs-ஐ இன்ஸ்டால் செய்',
  'Add to your home screen — opens like a normal app.': 'Home screen-ல் சேர்க்கவும் — சாதாரண ஆப் போல திறக்கும்.',
  'Not now': 'பிறகு',
  'Install': 'இன்ஸ்டால்',

  // ── Login ──
  'Hitech Services · Technician App': 'Hitech Services · டெக்னீஷியன் ஆப்',
  'Enter your 10-digit mobile number': 'உங்கள் 10 இலக்க மொபைல் எண்ணை உள்ளிடவும்',
  'Mobile number': 'மொபைல் எண்',
  'Logging in…': 'லாகின் ஆகிறது…',
  'Login': 'லாகின்',
  'Forgot PIN?': 'PIN மறந்துவிட்டதா?',
  'Install app on this phone': 'இந்த போனில் ஆப்பை இன்ஸ்டால் செய்',
  'Install app on this iPhone': 'இந்த iPhone-ல் ஆப்பை இன்ஸ்டால் செய்',
  'To install: Chrome menu ⋮ → Add to Home screen': 'இன்ஸ்டால் செய்ய: Chrome மெனு ⋮ → Add to Home screen',
  'No internet connection. Please try again.': 'இன்டர்நெட் இணைப்பு இல்லை. மீண்டும் முயற்சிக்கவும்.',
  'The office will send you a new PIN': 'ஆபீஸ் உங்களுக்கு புதிய PIN அனுப்பும்',
  'Your registered mobile number': 'பதிவு செய்த மொபைல் எண்',
  'Send request to office': 'ஆபீஸுக்கு கோரிக்கை அனுப்பு',
  'Request sent': 'கோரிக்கை அனுப்பப்பட்டது',
  'If {m} is registered, the office will send your new PIN on WhatsApp. Then log in with the new PIN.': '{m} பதிவு செய்யப்பட்டிருந்தால், ஆபீஸ் உங்கள் புதிய PIN-ஐ WhatsApp-ல் அனுப்பும். பிறகு புதிய PIN-ல் லாகின் செய்யவும்.',
  'Call office': 'ஆபீஸுக்கு அழை',
  'Back to login': 'லாகினுக்குத் திரும்பு',
  'PIN reset is not set up on the server yet. Please call the office for now.': 'PIN மாற்றும் வசதி இன்னும் தயாராகவில்லை. இப்போதைக்கு ஆபீஸுக்கு போன் செய்யவும்.',
}

/** Translate (works outside React too, e.g. toasts) */
export function tr(s, vars) {
  let out = (lang === 'ta' ? TA[s] : undefined) ?? EN[s] ?? s
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m))
  return out
}

export function useLang() {
  const l = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, () => lang, () => lang)
  return { lang: l, setLang, t: tr }
}

/** Small "தமிழ் | EN" switch */
export function LangSwitch({ dark = false, className = '' }) {
  const { lang: l } = useLang()
  const btn = (v, label) => (
    <button type="button" onClick={() => setLang(v)} aria-pressed={l === v}
      className={`px-2.5 py-1 rounded-full text-xs font-bold transition ${l === v ? (dark ? 'bg-white text-ink-900' : 'bg-brand-600 text-white') : (dark ? 'text-slate-300' : 'text-slate-500')}`}>{label}</button>
  )
  return <div className={`inline-flex items-center p-0.5 rounded-full ${dark ? 'bg-white/10' : 'bg-slate-100'} ${className}`}>{btn('ta', 'தமிழ்')}{btn('en', 'EN')}</div>
}
