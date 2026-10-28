/**
 * Cookie mirror of the device's portfolio selection (the selection itself
 * lives in localStorage, see `portfolio-context.tsx`). The server reads it
 * only to start the dashboard's computations for the right portfolio while
 * the page is still loading; nothing is ever scoped by it.
 */
export const PORTFOLIO_COOKIE = "beobeo.portfolio";

export function setPortfolioCookie(id: string | null): void {
  document.cookie = id
    ? `${PORTFOLIO_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`
    : `${PORTFOLIO_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
