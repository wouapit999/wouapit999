/**
 * Source of truth for UI copy. `fr` and `pt` must declare the same keys (enforced by TypeScript
 * and by `messages.test.ts`). Placeholders use `{name}` syntax.
 */
export const en = {
  // Brand & shell
  'app.tagline': 'Send money across CEMAC and Lusophone Africa',
  'app.description':
    'BI-Rem moves money between Central Africa and Portuguese-speaking Africa with transparent fees, mobile-money payouts and bank-grade security.',
  'nav.home': 'Home',
  'nav.dashboard': 'Dashboard',
  'nav.profile': 'Profile',
  'nav.notifications': 'Notifications',
  'nav.security': 'Security',
  'nav.login': 'Sign in',
  'nav.register': 'Create account',
  'nav.logout': 'Sign out',
  'nav.openMenu': 'Open navigation menu',
  'nav.closeMenu': 'Close navigation menu',
  'nav.primary': 'Primary navigation',
  'nav.skipToContent': 'Skip to main content',
  'locale.label': 'Language',
  'locale.en': 'English',
  'locale.fr': 'Français',
  'locale.pt': 'Português',
  'footer.rights': '© {year} BI-Rem. All rights reserved.',
  'footer.phase': 'Phase 1 — account foundation',

  // Common actions and states
  'action.save': 'Save changes',
  'action.cancel': 'Cancel',
  'action.retry': 'Try again',
  'action.back': 'Back',
  'action.backToLogin': 'Back to sign in',
  'action.markRead': 'Mark as read',
  'state.loading': 'Loading…',
  'state.saving': 'Saving…',
  'state.submitting': 'Please wait…',
  'state.empty': 'Nothing here yet',
  'state.error.title': 'Something went wrong',
  'state.error.generic': 'An unexpected error occurred. Please try again.',
  'state.error.network': 'We could not reach the server. Check your connection and try again.',
  'state.error.unauthorized': 'Your session has expired. Please sign in again.',
  'state.error.rateLimited': 'Too many attempts. Please wait a moment and try again.',
  'state.error.correlation': 'Reference: {id}',
  'badge.availableSoon': 'Available soon',
  'badge.comingPhase2': 'Phase 2',
  'badge.unread': 'Unread',
  'badge.live': 'Live',
  'badge.future': 'Coming later',

  // Landing
  'landing.hero.title': 'Fast, fair transfers between Central Africa and Lusophone Africa',
  'landing.hero.subtitle':
    'Open your BI-Rem account today. Wallets, mobile-money payouts and transfers arrive in the next phases — your verified account will be ready for them.',
  'landing.hero.cta': 'Create your free account',
  'landing.hero.secondary': 'I already have an account',
  'landing.features.title': 'Built for the corridors we serve',
  'landing.features.fees.title': 'Transparent fees',
  'landing.features.fees.body':
    'Every quote shows the exchange rate and fee before you confirm. No hidden margins.',
  'landing.features.mobile.title': 'Mobile money first',
  'landing.features.mobile.body':
    'Payouts to MTN MoMo, Orange Money, Airtel Money and local banks across our corridors.',
  'landing.features.security.title': 'Bank-grade security',
  'landing.features.security.body':
    'Encrypted at rest and in transit, two-factor authentication and full audit trails.',
  'landing.countries.title': 'Supported countries',
  'landing.countries.subtitle':
    'Live corridors launch with Phase 1 account onboarding; future markets are already modelled so your details stay valid.',
  'landing.countries.region.CEMAC': 'CEMAC (Central Africa)',
  'landing.countries.region.PALOP': 'Lusophone Africa (PALOP)',
  'landing.countries.region.FUTURE': 'Coming later',
  'landing.countries.currency': 'Currency',
  'landing.countries.dialCode': 'Dial code',
  'landing.example.title': 'Example quote',
  'landing.example.body': 'Send {send} and your recipient receives about {receive}.',
  'landing.example.disclaimer': 'Indicative only — live rates arrive with the transfers phase.',

  // Auth pages
  'auth.login.title': 'Sign in to BI-Rem',
  'auth.login.subtitle': 'Welcome back. Enter your details to continue.',
  'auth.login.submit': 'Sign in',
  'auth.login.forgot': 'Forgot your password?',
  'auth.login.noAccount': 'New to BI-Rem?',
  'auth.login.mfaUnsupported':
    'This account has two-factor authentication enabled. MFA sign-in arrives in a later release of the portal.',
  'auth.login.invalid': 'Incorrect email or password.',
  'auth.register.title': 'Create your account',
  'auth.register.subtitle': 'It takes less than two minutes.',
  'auth.register.submit': 'Create account',
  'auth.register.hasAccount': 'Already have an account?',
  'auth.register.terms': 'I accept the Terms of Service and Privacy Policy',
  'auth.register.marketing': 'Send me product news and offers (optional)',
  'auth.register.success.title': 'Account created',
  'auth.register.success.body':
    'Check your inbox to verify your email address. You can already sign in.',
  'auth.forgot.title': 'Reset your password',
  'auth.forgot.subtitle':
    'Enter the email linked to your account and we will send you a reset link.',
  'auth.forgot.submit': 'Send reset link',
  'auth.forgot.success.title': 'Check your inbox',
  'auth.forgot.success.body':
    'If an account exists for {email}, a reset link is on its way. It expires in 30 minutes.',
  'auth.reset.title': 'Choose a new password',
  'auth.reset.subtitle': 'Pick a strong password you do not use anywhere else.',
  'auth.reset.submit': 'Update password',
  'auth.reset.missingToken.title': 'Reset link invalid',
  'auth.reset.missingToken.body':
    'This link is missing its token or has expired. Request a new one to continue.',
  'auth.reset.success.title': 'Password updated',
  'auth.reset.success.body': 'You can now sign in with your new password.',
  'auth.password.hint':
    'At least 12 characters with upper and lower case letters, a digit and a symbol.',

  // Form fields
  'field.email': 'Email address',
  'field.password': 'Password',
  'field.newPassword': 'New password',
  'field.currentPassword': 'Current password',
  'field.confirmPassword': 'Confirm password',
  'field.firstName': 'First name',
  'field.lastName': 'Last name',
  'field.phone': 'Mobile number',
  'field.phone.hint': 'International format, e.g. +237655123456',
  'field.country': 'Country of residence',
  'field.country.placeholder': 'Select a country',
  'field.locale': 'Preferred language',
  'field.optional': 'optional',
  'field.required': 'required',
  'field.showPassword': 'Show password',
  'field.hidePassword': 'Hide password',

  // Dashboard
  'dashboard.welcome.title': 'Welcome back, {name}',
  'dashboard.welcome.body':
    'Your BI-Rem account is set up. Transfers and wallets unlock in the next phases; keep your profile and security settings up to date in the meantime.',
  'dashboard.kyc.title': 'Identity verification',
  'dashboard.kyc.placeholder': 'Verification coming in Phase 2',
  'dashboard.kyc.body':
    'You will be able to verify your identity with a government ID and a selfie to unlock transfers.',
  'dashboard.kyc.status': 'Status',
  'dashboard.kyc.notStarted': 'Not started',
  'dashboard.quick.title': 'Quick actions',
  'dashboard.quick.send.title': 'Send money',
  'dashboard.quick.send.body': 'Transfer to mobile money or bank accounts across our corridors.',
  'dashboard.quick.wallets.title': 'Wallets',
  'dashboard.quick.wallets.body': 'Hold balances in XAF, AOA, MZN and more.',
  'dashboard.quick.profile.title': 'Complete your profile',
  'dashboard.quick.profile.body': 'Add your mobile number and country so payouts are ready.',
  'dashboard.quick.security.title': 'Secure your account',
  'dashboard.quick.security.body':
    'Change your password and prepare for two-factor authentication.',
  'dashboard.account.title': 'Account overview',
  'dashboard.account.email': 'Email',
  'dashboard.account.status': 'Status',
  'dashboard.account.memberSince': 'Member since',
  'dashboard.account.lastLogin': 'Last sign-in',
  'dashboard.account.never': 'First visit',
  'dashboard.account.emailVerified': 'Verified',
  'dashboard.account.emailUnverified': 'Not verified',

  // User status labels
  'userStatus.PENDING_VERIFICATION': 'Pending verification',
  'userStatus.ACTIVE': 'Active',
  'userStatus.SUSPENDED': 'Suspended',
  'userStatus.LOCKED': 'Locked',
  'userStatus.DEACTIVATED': 'Deactivated',

  // Profile
  'profile.title': 'Profile',
  'profile.subtitle': 'Your personal details as they appear on your account.',
  'profile.edit': 'Edit profile',
  'profile.saved': 'Profile updated.',
  'profile.noPhone': 'No mobile number on file',
  'profile.noCountry': 'No country selected',
  'profile.emailLocked': 'Contact support to change your email address.',

  // Notifications
  'notifications.title': 'Notifications',
  'notifications.subtitle': 'Security alerts and account updates.',
  'notifications.empty.title': 'No notifications yet',
  'notifications.empty.body':
    'We will let you know about sign-ins, security changes and transfers here.',
  'notifications.unreadCount': '{count} unread',
  'notifications.channel.EMAIL': 'E-mail',
  'notifications.channel.SMS': 'SMS',
  'notifications.channel.PUSH': 'Push',
  'notifications.channel.IN_APP': 'In-app',
  'pagination.label': 'Pagination',
  'pagination.previous': 'Previous',
  'pagination.next': 'Next',
  'pagination.summary': 'Page {page} of {total}',
  'notifications.category.SECURITY': 'Security',
  'notifications.category.TRANSACTIONAL': 'Transactions',
  'notifications.category.SYSTEM': 'System',
  'notifications.category.MARKETING': 'News',

  // Security
  'security.title': 'Security',
  'security.subtitle': 'Keep your account protected.',
  'security.password.title': 'Change password',
  'security.password.body': 'You will stay signed in on this device.',
  'security.password.submit': 'Update password',
  'security.password.success': 'Your password has been changed.',
  'security.mfa.title': 'Two-factor authentication',
  'security.mfa.body':
    'Add a second step at sign-in using an authenticator app. Enrolment opens in a later release.',
  'security.mfa.enabled': 'Enabled',
  'security.mfa.disabled': 'Not enabled',
  'security.sessions.title': 'Active sessions',
  'security.sessions.body': 'Sign out of every device if you suspect unauthorised access.',
  'security.sessions.signOutAll': 'Sign out everywhere',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
