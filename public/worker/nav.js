/**
 * The worker app's destinations. Pure data (no DOM), so the mapping can be tested.
 *  - TABS: the five on the phone's bottom bar.
 *  - EXTRAS: Feedback and Settings, labelled icon buttons in the top bar on phones.
 * On a wide screen (900px and up) all seven are in the left sidebar. An id is also the page's hash: `#pay`.
 * "records" is the attendance-and-disputes screen (the tour and old links use that address), labelled Disputes.
 */
export const TABS = Object.freeze([
  { id: 'home', icon: 'home', labelKey: 'tab.home' },
  { id: 'pay', icon: 'wallet', labelKey: 'tab.pay' },
  { id: 'report', icon: 'alert', labelKey: 'tab.report' },
  { id: 'records', icon: 'calendar', labelKey: 'tab.disputes' },
  { id: 'passport', icon: 'badge', labelKey: 'tab.passport' },
]);

export const EXTRAS = Object.freeze([
  { id: 'feedback', icon: 'smile', labelKey: 'tab.feedback' },
  { id: 'settings', icon: 'gear', labelKey: 'tab.settings' },
]);

/** The sidebar: the five main places, then a divider, then Feedback and Settings. */
export const SIDEBAR_GROUPS = Object.freeze([TABS, EXTRAS]);
export const DESTINATIONS = Object.freeze([...TABS, ...EXTRAS]);
export const SCREENS = Object.freeze(DESTINATIONS.map((d) => d.id));

/** Which destination is marked as current for a screen (every screen is its own destination). */
export const tabForScreen = (screen) => DESTINATIONS.find((d) => d.id === screen)?.id ?? null;
