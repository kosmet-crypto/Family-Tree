// Purchases through RevenueCat in the native app (Google Play / App Store).
// The server learns about purchases from the RevenueCat webhook; /api/billing/sync is called
// right after a purchase so the plan updates without waiting for it.

import { clientConfig } from "./config";
import { isNativeApp } from "./backup";
import { RepoError } from "./repo/errors";

export function billingAvailable(): boolean {
  return isNativeApp() && !!(clientConfig.revenueCatAndroidKey || clientConfig.revenueCatIosKey);
}

async function purchases(userId: string | null) {
  if (!billingAvailable() || !userId) throw new RepoError("billing_unavailable", "Куповина је доступна у Android/iOS апликацији.");
  const { Capacitor } = await import("@capacitor/core");
  const { Purchases } = await import("@revenuecat/purchases-capacitor");
  const apiKey = Capacitor.getPlatform() === "ios" ? clientConfig.revenueCatIosKey : clientConfig.revenueCatAndroidKey;
  await Purchases.configure({ apiKey, appUserID: userId });
  return Purchases;
}

async function sync() {
  const { api } = await import("./repo/cloud");
  await api("/api/billing/sync", { method: "POST" }).catch(() => {});
}

export async function purchasePremium(userId: string | null): Promise<void> {
  const P = await purchases(userId);
  const offerings = await P.getOfferings();
  const pkg = offerings.current?.availablePackages[0];
  if (!pkg) throw new RepoError("no_offering", "Понуда тренутно није доступна.");
  await P.purchasePackage({ aPackage: pkg });
  await sync();
}

export async function restorePurchases(userId: string | null): Promise<void> {
  const P = await purchases(userId);
  await P.restorePurchases();
  await sync();
}
