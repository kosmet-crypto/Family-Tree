import type { CapacitorConfig } from "@capacitor/cli";

// Two ways to ship the web part inside the Android/iOS app:
//  - bundled (default, Google Play): the static build in out/ is packaged into the APK/AAB;
//    updates need a new store release.
//  - live / OTA (test phase): set CAP_LIVE_URL (e.g. the GitHub Pages URL) when running
//    `npx cap sync`; the app then always loads the latest deployed web version, so every push
//    to main updates installed test apps without a new APK. Leave it unset for store builds.
const liveUrl = process.env.CAP_LIVE_URL;

const config: CapacitorConfig = {
  appId: "com.epicurus001.rootsbranches",
  appName: "Roots & Branches",
  webDir: "out",
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 0 },
  },
  ...(liveUrl
    ? { server: { url: liveUrl, cleartext: false, errorPath: "index.html" } }
    : {}),
};

export default config;
