import type { ModuleMessages } from "@/i18n";

export const setupMessages: ModuleMessages = {
  en: {
    "setup.title": "Welcome — first-time setup",
    "setup.subtitle": "Create your organization and its first administrator account. This page is available only once, on a fresh installation.",
    "setup.org": "Organization name",
    "setup.adminName": "Administrator name",
    "setup.adminEmail": "Administrator email",
    "setup.passwordHint": "At least 10 characters, with three of: lowercase, uppercase, digits, symbols.",
    "setup.submit": "Create organization",
    "setup.alreadyDone": "Setup has already been completed. Please sign in.",
    "setup.emailTaken": "A user with this email already exists.",
  },
  fr: {
    "setup.title": "Bienvenue — première configuration",
    "setup.subtitle": "Créez votre organisation et son premier compte administrateur. Cette page n'est disponible qu'une seule fois, sur une nouvelle installation.",
    "setup.org": "Nom de l'organisation",
    "setup.adminName": "Nom de l'administrateur",
    "setup.adminEmail": "E-mail de l'administrateur",
    "setup.passwordHint": "Au moins 10 caractères, avec trois types parmi : minuscules, majuscules, chiffres, symboles.",
    "setup.submit": "Créer l'organisation",
    "setup.alreadyDone": "La configuration a déjà été effectuée. Veuillez vous connecter.",
    "setup.emailTaken": "Un utilisateur avec cet e-mail existe déjà.",
  },
};
