# GestPro mobile (Android & iOS)

Native shells built with [Capacitor](https://capacitorjs.com) around the hosted GestPro web application. Users sign in with the same accounts; every feature, permission and security control of the web app applies unchanged, and the apps are always up to date because the pages are served from the cloud. A local fallback page (`www/offline.html`, EN/FR) is shown when the phone is offline.

| | |
|---|---|
| App id | `net.bouquetinnovation.gestpro` |
| Name | GestPro |
| Min Android | 7.0 (API 24), target API 36 |
| iOS | 15+ (Swift Package Manager, no CocoaPods needed) |
| App URL | `GESTPRO_APP_URL` at sync time (CI: repository variable `APP_URL`) |

## Downloadable APK

Every push to `main` that touches `mobile/` (or a manual run of the **Mobile apps** workflow) rebuilds the app and refreshes the rolling release **android-latest**:

```
https://github.com/wouapit999/residenceflow/releases/download/android-latest/GestPro.apk
```

The same release carries `GestPro.aab` for the Play Console. While the repository is private the link asks for a GitHub sign-in; make the repository public or share the file itself to let clients download it. Without the signing secrets the build is signed with a debug key: fine for installing on your own phones, not accepted by Google Play.

## One-time setup for the stores

1. **Set the production URL**: GitHub → Settings → Secrets and variables → Actions → *Variables* → `APP_URL = https://<your-vercel-domain>`.
2. **Android upload key** (once, keep it safe):
   ```bash
   keytool -genkeypair -v -keystore gestpro-upload.keystore -alias gestpro -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 gestpro-upload.keystore   # → secret ANDROID_KEYSTORE_BASE64
   ```
   Add secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (= gestpro), `ANDROID_KEY_PASSWORD`, then re-run the workflow.
3. **Google Play Console** (one-off $25 developer account): create the app *GestPro*, upload `GestPro.aab` to Internal testing, fill the listing from `store/listing-en.md` / `store/listing-fr.md`, add screenshots from `../docs/screenshots/*-mobile.png` and the icon `resources/icon.png`, privacy policy URL `https://<your-domain>/privacy`, complete the Data safety form (account data, business records, no ads, no selling), then promote to Production.
4. **Apple App Store** (Apple Developer Program, $99/year, needs a Mac with Xcode):
   ```bash
   cd mobile && npm ci && GESTPRO_APP_URL=https://<your-domain> npm run sync
   npx cap open ios        # Xcode: set your Team under Signing & Capabilities
   ```
   Product → Archive → Distribute App → App Store Connect. In App Store Connect create *GestPro*, fill the listing (FR + EN) from `store/`, upload screenshots (6.7" and 5.5" iPhone, from the `-mobile.png` set), set the privacy policy URL and the privacy nutrition labels, submit for review. The `ios` CI job compiles the project on every change so it is always ready to archive.

## Local development

```bash
cd mobile
npm ci
GESTPRO_APP_URL=http://192.168.x.x:3000 npm run sync   # your dev machine on the same Wi-Fi
npx cap open android   # or: npx cap run android --target <device>
```

Icons and splash screens are generated from `resources/` with `npm run assets` (`@capacitor/assets`).
