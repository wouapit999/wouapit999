import type { NotificationChannel } from '../../src/index.js';

export interface SeedNotificationTemplate {
  readonly key: string;
  readonly channel: NotificationChannel;
  readonly locale: 'en' | 'fr' | 'pt';
  readonly subject: string | null;
  readonly body: string;
  readonly variables: readonly string[];
}

type LocalisedCopy = Record<'en' | 'fr' | 'pt', { subject: string; email: string; sms: string }>;

interface TemplateSpec {
  readonly key: string;
  readonly variables: readonly string[];
  readonly copy: LocalisedCopy;
}

const TEMPLATE_SPECS: readonly TemplateSpec[] = [
  {
    key: 'welcome',
    variables: ['firstName', 'appName', 'portalUrl'],
    copy: {
      en: {
        subject: 'Welcome to {{appName}}',
        email:
          'Hello {{firstName}},\n\nYour {{appName}} account has been created. Sign in at {{portalUrl}} to complete your profile and verify your identity before sending your first transfer.\n\nThe {{appName}} team',
        sms: '{{appName}}: welcome {{firstName}}! Your account is ready. Sign in at {{portalUrl}} to get started.',
      },
      fr: {
        subject: 'Bienvenue sur {{appName}}',
        email:
          'Bonjour {{firstName}},\n\nVotre compte {{appName}} a été créé. Connectez-vous sur {{portalUrl}} pour compléter votre profil et vérifier votre identité avant votre premier transfert.\n\nL’équipe {{appName}}',
        sms: '{{appName}} : bienvenue {{firstName}} ! Votre compte est prêt. Connectez-vous sur {{portalUrl}} pour commencer.',
      },
      pt: {
        subject: 'Bem-vindo(a) ao {{appName}}',
        email:
          'Olá {{firstName}},\n\nA sua conta {{appName}} foi criada. Inicie sessão em {{portalUrl}} para completar o seu perfil e verificar a sua identidade antes da primeira transferência.\n\nA equipa {{appName}}',
        sms: '{{appName}}: bem-vindo(a) {{firstName}}! A sua conta está pronta. Inicie sessão em {{portalUrl}} para começar.',
      },
    },
  },
  {
    key: 'password-reset',
    variables: ['firstName', 'appName', 'resetUrl', 'code', 'expiresInMinutes'],
    copy: {
      en: {
        subject: 'Reset your {{appName}} password',
        email:
          'Hello {{firstName}},\n\nWe received a request to reset your password. Use the link below within {{expiresInMinutes}} minutes:\n{{resetUrl}}\n\nIf you did not request this, you can ignore this message; your password will not change.\n\nThe {{appName}} team',
        sms: '{{appName}}: your password reset code is {{code}}. It expires in {{expiresInMinutes}} minutes. Never share this code.',
      },
      fr: {
        subject: 'Réinitialisez votre mot de passe {{appName}}',
        email:
          'Bonjour {{firstName}},\n\nNous avons reçu une demande de réinitialisation de votre mot de passe. Utilisez le lien ci-dessous dans les {{expiresInMinutes}} minutes :\n{{resetUrl}}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message ; votre mot de passe restera inchangé.\n\nL’équipe {{appName}}',
        sms: '{{appName}} : votre code de réinitialisation est {{code}}. Il expire dans {{expiresInMinutes}} minutes. Ne le partagez jamais.',
      },
      pt: {
        subject: 'Redefina a sua palavra-passe {{appName}}',
        email:
          'Olá {{firstName}},\n\nRecebemos um pedido para redefinir a sua palavra-passe. Utilize o link abaixo dentro de {{expiresInMinutes}} minutos:\n{{resetUrl}}\n\nSe não fez este pedido, ignore esta mensagem; a sua palavra-passe não será alterada.\n\nA equipa {{appName}}',
        sms: '{{appName}}: o seu código de redefinição é {{code}}. Expira em {{expiresInMinutes}} minutos. Nunca partilhe este código.',
      },
    },
  },
  {
    key: 'login-alert',
    variables: ['firstName', 'appName', 'loginAt', 'ip', 'location', 'device', 'securityUrl'],
    copy: {
      en: {
        subject: 'New sign-in to your {{appName}} account',
        email:
          'Hello {{firstName}},\n\nA new sign-in to your account was detected:\n• When: {{loginAt}}\n• Device: {{device}}\n• Location: {{location}} ({{ip}})\n\nIf this was you, no action is needed. Otherwise secure your account immediately at {{securityUrl}}.\n\nThe {{appName}} team',
        sms: '{{appName}}: new sign-in on {{loginAt}} from {{location}}. Not you? Secure your account: {{securityUrl}}',
      },
      fr: {
        subject: 'Nouvelle connexion à votre compte {{appName}}',
        email:
          'Bonjour {{firstName}},\n\nUne nouvelle connexion à votre compte a été détectée :\n• Quand : {{loginAt}}\n• Appareil : {{device}}\n• Lieu : {{location}} ({{ip}})\n\nSi c’était vous, aucune action n’est requise. Sinon, sécurisez immédiatement votre compte sur {{securityUrl}}.\n\nL’équipe {{appName}}',
        sms: '{{appName}} : nouvelle connexion le {{loginAt}} depuis {{location}}. Ce n’est pas vous ? Sécurisez votre compte : {{securityUrl}}',
      },
      pt: {
        subject: 'Novo início de sessão na sua conta {{appName}}',
        email:
          'Olá {{firstName}},\n\nFoi detetado um novo início de sessão na sua conta:\n• Quando: {{loginAt}}\n• Dispositivo: {{device}}\n• Localização: {{location}} ({{ip}})\n\nSe foi você, não é necessária qualquer ação. Caso contrário, proteja a sua conta imediatamente em {{securityUrl}}.\n\nA equipa {{appName}}',
        sms: '{{appName}}: novo início de sessão em {{loginAt}} a partir de {{location}}. Não foi você? Proteja a sua conta: {{securityUrl}}',
      },
    },
  },
  {
    key: 'mfa-code',
    variables: ['firstName', 'appName', 'code', 'expiresInMinutes'],
    copy: {
      en: {
        subject: 'Your {{appName}} verification code',
        email:
          'Hello {{firstName}},\n\nYour verification code is:\n\n{{code}}\n\nIt expires in {{expiresInMinutes}} minutes. {{appName}} staff will never ask you for this code.\n\nThe {{appName}} team',
        sms: '{{appName}} code: {{code}}. Expires in {{expiresInMinutes}} min. Never share it.',
      },
      fr: {
        subject: 'Votre code de vérification {{appName}}',
        email:
          'Bonjour {{firstName}},\n\nVotre code de vérification est :\n\n{{code}}\n\nIl expire dans {{expiresInMinutes}} minutes. Le personnel {{appName}} ne vous demandera jamais ce code.\n\nL’équipe {{appName}}',
        sms: 'Code {{appName}} : {{code}}. Expire dans {{expiresInMinutes}} min. Ne le partagez jamais.',
      },
      pt: {
        subject: 'O seu código de verificação {{appName}}',
        email:
          'Olá {{firstName}},\n\nO seu código de verificação é:\n\n{{code}}\n\nExpira em {{expiresInMinutes}} minutos. A equipa {{appName}} nunca lhe pedirá este código.\n\nA equipa {{appName}}',
        sms: 'Código {{appName}}: {{code}}. Expira em {{expiresInMinutes}} min. Nunca o partilhe.',
      },
    },
  },
];

const LOCALES = ['en', 'fr', 'pt'] as const;

/** Flattens the template specs into one row per key × channel (EMAIL, SMS) × locale. */
export function buildNotificationTemplates(): SeedNotificationTemplate[] {
  const rows: SeedNotificationTemplate[] = [];
  for (const spec of TEMPLATE_SPECS) {
    for (const locale of LOCALES) {
      const copy = spec.copy[locale];
      rows.push({
        key: spec.key,
        channel: 'EMAIL',
        locale,
        subject: copy.subject,
        body: copy.email,
        variables: spec.variables,
      });
      rows.push({
        key: spec.key,
        channel: 'SMS',
        locale,
        subject: null,
        body: copy.sms,
        variables: spec.variables,
      });
    }
  }
  return rows;
}
