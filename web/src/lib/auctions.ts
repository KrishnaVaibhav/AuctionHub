import { supabase } from "./supabase";
import type { Auction } from "./types";

const BRANDING_MARKER = "/auction-branding/";

/**
 * Permanently delete an auction: its storage files first (lot photos/videos and
 * cover), then the row. Lots, bids, chat, teams and deal chats are removed by
 * cascade. Any file missed here is swept by the Worker's nightly orphan cleanup.
 */
export async function deleteAuctionCompletely(auction: Pick<Auction, "id" | "cover_url">): Promise<void> {
  const { data: lots } = await supabase.from("lots").select("id").eq("auction_id", auction.id);
  const lotIds = (lots ?? []).map((l) => l.id as string);

  if (lotIds.length) {
    const { data: media } = await supabase.from("lot_media").select("path").in("lot_id", lotIds);
    const paths = (media ?? []).map((m) => m.path as string);
    for (let i = 0; i < paths.length; i += 100) {
      await supabase.storage.from("lot-media").remove(paths.slice(i, i + 100));
    }
  }

  const coverIdx = auction.cover_url?.indexOf(BRANDING_MARKER) ?? -1;
  if (auction.cover_url && coverIdx >= 0) {
    await supabase.storage.from("auction-branding").remove([decodeURIComponent(auction.cover_url.slice(coverIdx + BRANDING_MARKER.length))]);
  }

  const { error } = await supabase.rpc("delete_auction", { p_auction_id: auction.id });
  if (error) throw error;
}

export const canDelete = (status: Auction["status"]) => status === "draft" || status === "ended" || status === "cancelled";

export const visibilityLabel: Record<Auction["visibility"], string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};
