/**
 * Curated in-app help content.
 * Videos are official Apple Support tutorials and open in a privacy-enhanced
 * YouTube embed. Guides are intentionally practical and device-agnostic.
 */

export const GUIDE_CATEGORIES = [
  { id: "all", label: "All guides" },
  { id: "getting-started", label: "Getting started" },
  { id: "battery", label: "Battery" },
  { id: "connectivity", label: "Connectivity" },
  { id: "security", label: "Security" },
  { id: "apps", label: "Apps & storage" },
  { id: "accessibility", label: "Accessibility" },
];

export const GUIDES = [
  {
    id: "install-aide",
    category: "getting-started",
    icon: "smartphone",
    title: "Install Aide on your iPhone",
    summary: "Add the support app to your Home Screen for full-screen help and push alerts.",
    duration: "2 min",
    steps: [
      "Open this page in Safari. On iPhone, only Safari can install a Home Screen web app.",
      "Tap the Share button in the toolbar (the square with the upward arrow).",
      "Scroll down and tap “Add to Home Screen”, then confirm with “Add”.",
      "Open Aide from your Home Screen. The app now runs full screen with an app icon.",
      "Tap Enable when asked about notifications so ticket updates can reach you.",
    ],
    tip: "If you do not see “Add to Home Screen”, make sure you are in Safari and not in a private browsing tab.",
  },
  {
    id: "battery-drain",
    category: "battery",
    icon: "battery",
    title: "Stop unexplained battery drain",
    summary: "Find the apps and settings that are using power and make a few high-impact changes.",
    duration: "4 min",
    steps: [
      "Open Settings → Battery and scroll to “Battery Usage by App”.",
      "Look for an app with unusually high background time, then open Settings → General → Background App Refresh and limit it.",
      "Turn on Low Power Mode from Settings → Battery (or Control Center) when you need to stretch the charge.",
      "Lower auto-lock to 30 seconds in Settings → Display & Brightness → Auto-Lock and enable Dark Mode.",
      "Use Wi-Fi instead of cellular where possible, and avoid charging in very hot places.",
    ],
    tip: "Battery Health below 80% usually means it is time for a service appointment. Check Settings → Battery → Battery Health & Charging.",
  },
  {
    id: "wifi-troubleshoot",
    category: "connectivity",
    icon: "wifi",
    title: "Fix Wi-Fi connection problems",
    summary: "A practical reset order that fixes most iPhone Wi-Fi issues without a repair.",
    duration: "5 min",
    steps: [
      "Turn Wi-Fi off and back on in Settings, then toggle Airplane Mode for 10 seconds.",
      "Tap the ⓘ next to the network and choose “Forget This Network”, then reconnect and re-enter the password.",
      "Restart your router and modem: unplug both, wait 30 seconds, power the modem first, then the router.",
      "Check for a VPN or device-management profile under Settings → General → VPN & Device Management and remove stale entries.",
      "As a last resort, use Settings → General → Transfer or Reset iPhone → Reset → Reset Network Settings.",
    ],
    tip: "Resetting network settings removes saved Wi-Fi passwords. Make sure you can recover them before continuing.",
  },
  {
    id: "storage-cleanup",
    category: "apps",
    icon: "database",
    title: "Free up storage without losing memories",
    summary: "Reclaim space safely by finding large apps, media and caches.",
    duration: "4 min",
    steps: [
      "Open Settings → General → iPhone Storage and wait for the list to calculate.",
      "Look for apps marked “Never Used” or with large Documents & Data. Offload unused apps to keep their data.",
      "Review large attachments in Messages and delete videos or files you no longer need.",
      "Turn on iCloud Photos with “Optimize iPhone Storage” if you need full-resolution originals off-device.",
      "Restart the iPhone afterwards, then check the storage figure again.",
    ],
    tip: "Offloading an app keeps its documents and data, so re-installing it later restores your place.",
  },
  {
    id: "secure-apple-account",
    category: "security",
    icon: "shield",
    title: "Lock down your Apple Account",
    summary: "Use two-factor authentication, review trusted devices and recognize phishing.",
    duration: "6 min",
    steps: [
      "Open Settings → [your name] → Sign-In & Security and confirm two-factor authentication is on.",
      "Review Trusted Phone Numbers and Devices. Remove anything you do not recognize.",
      "Change your password immediately if you reused it anywhere else, then sign out of all devices.",
      "Enable Find My and Stolen Device Protection for an extra layer if your iPhone supports it.",
      "Never share a verification code. Apple will never call and ask for it.",
    ],
    tip: "A pop-up asking for your Apple Account password inside a random app or website is almost always a phishing attempt.",
  },
  {
    id: "app-permissions",
    category: "security",
    icon: "eye",
    title: "Review app permissions and tracking",
    summary: "Decide which apps can see location, photos, microphone, camera and activity.",
    duration: "3 min",
    steps: [
      "Open Settings → Privacy & Security.",
      "Go through Location Services and set apps to “While Using” or “Never” where appropriate.",
      "Open Photos, Microphone, Camera and Contacts to review which apps have access.",
      "Tap Tracking and turn off “Allow Apps to Request to Track” if you prefer not to be tracked.",
      "Use Settings → Apps to inspect individual app permissions in newer iOS versions.",
    ],
    tip: "A weather app rarely needs your contacts. If a permission does not make sense for the app's purpose, turn it off.",
  },
  {
    id: "hotspot",
    category: "connectivity",
    icon: "wifi",
    title: "Share your connection with Personal Hotspot",
    summary: "Set up a secure hotspot and connect a laptop or another phone.",
    duration: "3 min",
    steps: [
      "Open Settings → Personal Hotspot and turn on “Allow Others to Join”.",
      "Tap Wi-Fi Password and choose something long and unique.",
      "On the other device, open Wi-Fi settings and select your iPhone's name.",
      "Enter the hotspot password and wait for the connection to establish.",
      "Turn the hotspot off when finished to save battery.",
    ],
    tip: "If the hotspot option is missing, ask your carrier whether your plan includes tethering.",
  },
  {
    id: "accessibility-text",
    category: "accessibility",
    icon: "eye",
    title: "Make text and controls easier to see",
    summary: "Larger text, bold type, higher contrast and reduced motion in a few taps.",
    duration: "3 min",
    steps: [
      "Open Settings → Accessibility → Display & Text Size.",
      "Enable “Larger Text” and use the slider, or turn on “Bold Text”.",
      "Increase Contrast and turn on “Button Shapes” for clearer controls.",
      "Open Settings → Accessibility → Motion and enable “Reduce Motion” if animations cause discomfort.",
      "Use Control Center's text size control for quick changes while reading.",
    ],
    tip: "Per-app text size can be adjusted in Control Center when the app supports Dynamic Type.",
  },
  {
    id: "update-ios",
    category: "getting-started",
    icon: "refresh",
    title: "Update iOS safely",
    summary: "Install the latest security fixes with a backup in place.",
    duration: "4 min",
    steps: [
      "Charge the iPhone or keep it connected to power and join a reliable Wi-Fi network.",
      "Open Settings → General → Software Update and let it check for updates.",
      "Tap Download and Install. Do not lock the screen unnecessarily during the download.",
      "If you are low on space temporarily, use the option to remove apps and reinstall them after the update.",
      "After restarting, check Settings → General → About to confirm the new iOS version.",
    ],
    tip: "Take an iCloud or computer backup before major updates, especially if the update is a new iOS version.",
  },
];

export const VIDEOS = [
  {
    id: "MVm3LDWhXn0",
    title: "Understanding your iPhone battery usage",
    source: "Apple Support",
    length: "2:21",
    category: "Battery",
  },
  {
    id: "WN__CnJF2bM",
    title: "How to share your Wi-Fi password",
    source: "Apple Support",
    length: "1:51",
    category: "Connectivity",
  },
  {
    id: "ltgk8FiVHoE",
    title: "How to use Personal Hotspot",
    source: "Apple Support",
    length: "2:04",
    category: "Connectivity",
  },
];

export const FAQS = [
  {
    question: "What data does Aide collect while the app is open?",
    answer:
      "When diagnostics sharing is on, Aide periodically stores battery state, GPS position (if you allow location access), a display brightness estimate, your timezone and basic device information. You can turn sharing off at any time from your profile. Turning it off keeps you visible as online, but stops sensitive fields from being written.",
  },
  {
    question: "Why does brightness appear as an estimate?",
    answer:
      "Mobile browsers do not expose the hardware screen-brightness value. Aide uses the Ambient Light Sensor where the browser supports it (mostly Android) and otherwise estimates from your light/dark appearance setting and time of day. The value is labelled as an estimate in the technician view.",
  },
  {
    question: "Why is battery information unavailable on my iPhone?",
    answer:
      "Safari on iOS does not implement the Battery Status API. Aide detects this and reports “Not available” instead of guessing. Your ticket will still include time, timezone, device, browser and any other supported diagnostics.",
  },
  {
    question: "Can I use Aide without creating an account?",
    answer:
      "Yes. Continue as a guest and your tickets work normally. Guest sessions are tied to this browser and cannot be recovered if the site data is cleared. You can add an email and password later from your profile to keep your history.",
  },
  {
    question: "How do I know a technician has seen my ticket?",
    answer:
      "The status changes from Pending to In progress when a technician picks it up, and then to Resolved with a written resolution. Enable push notifications to receive updates even when the app is not open.",
  },
  {
    question: "Who can see my diagnostics and attachments?",
    answer:
      "Firestore and Storage security rules restrict access to your own account and authenticated staff with the admin role. Attachments are not public. Support staff only use the data to diagnose and resolve your request.",
  },
];
