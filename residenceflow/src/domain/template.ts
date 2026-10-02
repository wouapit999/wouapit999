/**
 * Safe placeholder rendering for notification templates: only whitelisted {{keys}} are replaced,
 * values are HTML-escaped, and unknown placeholders are left empty (never evaluated).
 */
export function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderTemplate(template: string, vars: Record<string, string | number>, opts: { html?: boolean } = {}) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return "";
    return opts.html ? escapeHtml(String(v)) : String(v);
  });
}

export const DEFAULT_TEMPLATES: Record<string, { en: { title: string; body: string }; fr: { title: string; body: string } }> = {
  INVOICE_ISSUED: {
    en: { title: "New invoice {{number}}", body: "An invoice of {{amount}} is due on {{dueDate}}." },
    fr: { title: "Nouvelle facture {{number}}", body: "Une facture de {{amount}} est due le {{dueDate}}." },
  },
  RENT_DUE: {
    en: { title: "Rent due soon", body: "Invoice {{number}} ({{amount}}) is due on {{dueDate}}." },
    fr: { title: "Loyer bientôt dû", body: "La facture {{number}} ({{amount}}) est due le {{dueDate}}." },
  },
  RENT_OVERDUE: {
    en: { title: "Rent overdue", body: "Invoice {{number}} is overdue. Outstanding: {{amount}}." },
    fr: { title: "Loyer en retard", body: "La facture {{number}} est en retard. Solde : {{amount}}." },
  },
  PAYMENT_RECEIVED: {
    en: { title: "Payment received", body: "We received your payment of {{amount}}. Receipt {{receipt}}." },
    fr: { title: "Paiement reçu", body: "Nous avons reçu votre paiement de {{amount}}. Reçu {{receipt}}." },
  },
  PAYMENT_REJECTED: {
    en: { title: "Payment not confirmed", body: "Your payment submission {{reference}} could not be confirmed." },
    fr: { title: "Paiement non confirmé", body: "Votre paiement {{reference}} n'a pas pu être confirmé." },
  },
  LEASE_EXPIRY: {
    en: { title: "Lease expiring", body: "Lease {{reference}} ends on {{endDate}}." },
    fr: { title: "Bail arrivant à échéance", body: "Le bail {{reference}} se termine le {{endDate}}." },
  },
  MAINTENANCE_UPDATE: {
    en: { title: "Maintenance update {{number}}", body: "Status changed to {{status}}." },
    fr: { title: "Mise à jour maintenance {{number}}", body: "Nouveau statut : {{status}}." },
  },
  VISITOR_ARRIVAL: {
    en: { title: "Visitor arrived", body: "{{visitor}} has checked in at the front desk." },
    fr: { title: "Visiteur arrivé", body: "{{visitor}} s'est présenté(e) à l'accueil." },
  },
  PARCEL_RECEIVED: {
    en: { title: "Parcel received", body: "A parcel for {{recipient}} is waiting at the front desk." },
    fr: { title: "Colis reçu", body: "Un colis pour {{recipient}} vous attend à l'accueil." },
  },
  MESSAGE_RECEIVED: {
    en: { title: "New message", body: "{{from}}: {{subject}}" },
    fr: { title: "Nouveau message", body: "{{from}} : {{subject}}" },
  },
  MAINTENANCE_SUBMITTED: {
    en: { title: "New maintenance request {{number}}", body: "{{title}} — {{location}}" },
    fr: { title: "Nouvelle demande de maintenance {{number}}", body: "{{title}} — {{location}}" },
  },
  PAYMENT_SUBMITTED: {
    en: { title: "Payment proof submitted", body: "{{tenant}} submitted {{amount}} for verification." },
    fr: { title: "Preuve de paiement soumise", body: "{{tenant}} a soumis {{amount}} pour vérification." },
  },
  DOCUMENT_EXPIRY: {
    en: { title: "Document expiring: {{name}}", body: "Expires on {{date}}." },
    fr: { title: "Document arrivant à expiration : {{name}}", body: "Expire le {{date}}." },
  },
  ACCOUNT_INVITATION: {
    en: { title: "Your {{app}} account", body: "You have been invited to {{app}}. Activate your account within 72 hours: {{link}}" },
    fr: { title: "Votre compte {{app}}", body: "Vous avez été invité(e) sur {{app}}. Activez votre compte sous 72 heures : {{link}}" },
  },
  PASSWORD_RESET: {
    en: { title: "Password reset", body: "Use this link within 30 minutes to reset your password: {{link}}. If you did not request this, ignore this email." },
    fr: { title: "Réinitialisation du mot de passe", body: "Utilisez ce lien sous 30 minutes pour réinitialiser votre mot de passe : {{link}}. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail." },
  },
  ANNOUNCEMENT: {
    en: { title: "{{title}}", body: "A new building announcement has been posted." },
    fr: { title: "{{title}}", body: "Une nouvelle annonce a été publiée." },
  },
};
