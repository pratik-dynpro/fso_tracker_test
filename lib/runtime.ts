import { Capacitor } from '@capacitor/core';

/** True when running inside the Capacitor native WebView (iOS or Android). */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
