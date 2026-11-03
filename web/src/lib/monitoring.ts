/**
 * Optional error monitoring. Does nothing unless VITE_SENTRY_DSN is set at build
 * time (Cloudflare build variable). The SDK is loaded lazily so it costs nothing
 * when disabled. No personal data is sent: IPs, cookies and user details are off.
 */
export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  void import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
      tracesSampleRate: 0,
      beforeSend(event) {
        delete event.user;
        if (event.request) {
          delete event.request.cookies;
          delete event.request.headers;
          // Strip invite codes and other query params from reported URLs.
          if (event.request.url) event.request.url = event.request.url.split("?")[0];
        }
        return event;
      },
    });
  });
}
