import { useEffect } from "react";

const SITE = "AuctionHub";

/**
 * The browser tab's title while this page is shown: "<title> · AuctionHub",
 * or just "AuctionHub" while the title isn't known yet (data still loading).
 * Leaving the page puts the plain site name back, so no page inherits the
 * previous one's title.
 */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : SITE;
  }, [title]);
  useEffect(
    () => () => {
      document.title = SITE;
    },
    [],
  );
}
