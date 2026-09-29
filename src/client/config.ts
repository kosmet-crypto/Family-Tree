// Client configuration. Without Supabase keys the app runs in local mode: all data stays in
// this browser (IndexedDB). That is how the GitHub Pages demo and a key-less APK work.

export const clientConfig = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  /** Where the API routes live when the UI is a static bundle (Capacitor / GitHub Pages). */
  apiBase: (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, ""),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  revenueCatAndroidKey: process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY ?? "",
  revenueCatIosKey: process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY ?? "",
  appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
};

export const isCloud = () => !!(clientConfig.supabaseUrl && clientConfig.supabaseAnonKey);

export const credit = "Developed by: Ivan S. - Epicurus001, Oslo";
