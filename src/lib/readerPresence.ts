/**
 * Notifies the active AuthContext heartbeat listener when entering or leaving a reader route,
 * or toggling incognito mode, so series reader presence stays accurate without polling loops.
 */
export const notifyReaderPresenceChange = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event('toonparrot:reader-presence-change'));
};
