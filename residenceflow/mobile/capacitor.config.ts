import type { CapacitorConfig } from "@capacitor/cli";

/**
 * GestPro mobile shell. The native apps load the hosted web application (same accounts,
 * same security, always up to date) inside a Capacitor WebView. Set GESTPRO_APP_URL to the
 * production URL before `npx cap sync` (CI reads the repository variable APP_URL).
 */
const appUrl = (process.env.GESTPRO_APP_URL || "https://gestpro-app.vercel.app").replace(/\/+$/, "");
const host = new URL(appUrl).host;

const config: CapacitorConfig = {
  appId: "net.bouquetinnovation.gestpro",
  appName: "GestPro",
  webDir: "www",
  backgroundColor: "#0f172a",
  server: {
    url: appUrl,
    // Keep every page of the app (and its sub-domains) inside the app; everything else opens the system browser.
    allowNavigation: [host, `*.${host.split(".").slice(-2).join(".")}`],
    errorPath: "offline.html",
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#0f172a",
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#0f172a",
    preferredContentMode: "mobile",
  },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, launchAutoHide: true, backgroundColor: "#0f172a", showSpinner: false },
    StatusBar: { style: "DARK", backgroundColor: "#0f172a" },
  },
};

export default config;
