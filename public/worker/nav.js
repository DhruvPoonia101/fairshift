/**
 * The worker app's bottom navigation: four tabs, each owning the screens reached from it.
 * Pure data (no DOM), so the mapping can be tested.
 */
export const TABS = Object.freeze([
  { id: 'home', icon: 'home', labelKey: 'tab.home', screens: ['home', 'records'] },
  { id: 'pay', icon: 'wallet', labelKey: 'tab.pay', screens: ['pay'] },
  { id: 'report', icon: 'alert', labelKey: 'tab.report', screens: ['report'] },
  { id: 'me', icon: 'user', labelKey: 'tab.me', screens: ['me', 'passport', 'feedback'] },
]);

export const SCREENS = Object.freeze(TABS.flatMap((tab) => tab.screens));

/** Which tab is lit for a screen (a screen reached from a tab keeps that tab lit). */
export const tabForScreen = (screen) => TABS.find((tab) => tab.screens.includes(screen))?.id ?? null;
