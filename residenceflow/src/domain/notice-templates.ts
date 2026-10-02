import { renderTemplate } from "./template";

/**
 * Arrears notice templates (reminder → formal notice → final notice), EN/FR.
 * Pure text with {{placeholders}}; rendering is done with the whitelisted, non-evaluating
 * renderTemplate helper. The wording is generic: it must be reviewed by legal counsel
 * for the organization's jurisdiction before use (a disclaimer is shown on the page).
 */
export const NOTICE_LEVELS = ["REMINDER", "FORMAL_NOTICE", "FINAL_NOTICE"] as const;
export type NoticeLevel = (typeof NOTICE_LEVELS)[number];
export type NoticeLanguage = "en" | "fr";

export const NOTICE_PLACEHOLDERS = [
  "tenantName", "unit", "building", "outstanding", "oldestDueDate", "daysOverdue", "date", "companyName", "phone",
] as const;
export type NoticeVars = Record<(typeof NOTICE_PLACEHOLDERS)[number], string | number>;

export interface NoticeTemplate {
  title: string;
  body: string;
}

export const NOTICE_TEMPLATES: Record<NoticeLevel, Record<NoticeLanguage, NoticeTemplate>> = {
  REMINDER: {
    en: {
      title: "Payment reminder",
      body: `{{date}}

Dear {{tenantName}},

Our records show an outstanding balance of {{outstanding}} on your account for unit {{unit}}, {{building}}. The oldest unpaid invoice was due on {{oldestDueDate}} ({{daysOverdue}} days ago).

If you have already made this payment, please disregard this reminder and accept our thanks. Otherwise, we kindly ask you to settle the balance as soon as possible, or to contact us at {{phone}} to discuss a payment arrangement.

Thank you for your prompt attention.

{{companyName}}`,
    },
    fr: {
      title: "Rappel de paiement",
      body: `{{date}}

Madame, Monsieur {{tenantName}},

Nos registres font apparaître un solde impayé de {{outstanding}} sur votre compte pour le logement {{unit}}, {{building}}. La plus ancienne facture impayée était exigible le {{oldestDueDate}} (il y a {{daysOverdue}} jours).

Si vous avez déjà effectué ce règlement, nous vous prions de ne pas tenir compte de ce rappel et vous en remercions. Dans le cas contraire, nous vous invitons à régulariser votre situation dans les meilleurs délais ou à nous contacter au {{phone}} pour convenir d'un échéancier.

Nous vous remercions de votre diligence.

{{companyName}}`,
    },
  },
  FORMAL_NOTICE: {
    en: {
      title: "Formal notice to pay",
      body: `{{date}}

Dear {{tenantName}},

Despite our previous reminder, the balance of {{outstanding}} for unit {{unit}}, {{building}} remains unpaid. The oldest overdue invoice was due on {{oldestDueDate}}, which is {{daysOverdue}} days ago.

You are hereby formally requested to pay the full outstanding amount within eight (8) days of receipt of this notice. Failing payment within this period, we reserve the right to apply the late-payment provisions of your lease and to pursue any remedy available to us, without further notice.

To make payment or to discuss your situation, contact us at {{phone}}.

Yours sincerely,

{{companyName}}`,
    },
    fr: {
      title: "Mise en demeure de payer",
      body: `{{date}}

Madame, Monsieur {{tenantName}},

Malgré notre précédent rappel, le solde de {{outstanding}} relatif au logement {{unit}}, {{building}} demeure impayé. La plus ancienne facture en retard était exigible le {{oldestDueDate}}, soit depuis {{daysOverdue}} jours.

Par la présente, nous vous mettons en demeure de régler l'intégralité de la somme due dans un délai de huit (8) jours à compter de la réception de ce courrier. À défaut de paiement dans ce délai, nous nous réservons le droit d'appliquer les clauses de retard prévues à votre bail et d'engager toute voie de recours à notre disposition, sans autre avis.

Pour régler ou pour discuter de votre situation, contactez-nous au {{phone}}.

Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

{{companyName}}`,
    },
  },
  FINAL_NOTICE: {
    en: {
      title: "Final notice before legal action",
      body: `{{date}}

Dear {{tenantName}},

This is our final notice concerning the unpaid balance of {{outstanding}} for unit {{unit}}, {{building}}. The oldest overdue invoice was due on {{oldestDueDate}} ({{daysOverdue}} days overdue) and our previous reminder and formal notice have remained without effect.

Unless full payment is received within eight (8) days of receipt of this letter, we will, without further notice, refer the matter for recovery and initiate the legal proceedings provided for by your lease and applicable law, including proceedings for the termination of the lease. All related costs may be charged to you.

You may still avoid these steps by paying the full balance or contacting us immediately at {{phone}}.

Yours sincerely,

{{companyName}}`,
    },
    fr: {
      title: "Dernier avis avant poursuites",
      body: `{{date}}

Madame, Monsieur {{tenantName}},

Le présent courrier constitue notre dernier avis concernant le solde impayé de {{outstanding}} relatif au logement {{unit}}, {{building}}. La plus ancienne facture en retard était exigible le {{oldestDueDate}} ({{daysOverdue}} jours de retard) et notre rappel ainsi que notre mise en demeure sont restés sans effet.

À défaut de règlement intégral dans un délai de huit (8) jours à compter de la réception de cette lettre, nous transmettrons, sans autre avis, le dossier en recouvrement et engagerons les procédures prévues par votre bail et la loi applicable, y compris une action en résiliation du bail. Les frais y afférents pourront être mis à votre charge.

Vous pouvez encore éviter ces démarches en réglant l'intégralité du solde ou en nous contactant immédiatement au {{phone}}.

Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

{{companyName}}`,
    },
  },
};

export function isNoticeLevel(v: string): v is NoticeLevel {
  return (NOTICE_LEVELS as readonly string[]).includes(v);
}

/** Renders the title and body of a notice; placeholders are substituted, never evaluated. */
export function renderNotice(level: NoticeLevel, language: NoticeLanguage, vars: NoticeVars): NoticeTemplate {
  const tpl = NOTICE_TEMPLATES[level][language];
  const v: Record<string, string | number> = { ...vars };
  return { title: renderTemplate(tpl.title, v), body: renderTemplate(tpl.body, v) };
}
