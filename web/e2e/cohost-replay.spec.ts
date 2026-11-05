import { expect, test } from "@playwright/test";
import { createUser, liveAuction, rpc, uiLogin } from "./helpers";

test("a co-host with Run sees the auction and its controls, but can't bid", async ({ page }) => {
  const host = await createUser("cohostowner");
  const cohost = await createUser("cohostrunner", "Co Runner");
  const title = `Cohost ${Date.now()}`;
  const { auctionId } = await liveAuction(host, { title });
  const { data: prof } = await cohost.client.from("profiles").select("username").eq("id", cohost.id).single();
  await rpc(host, "add_moderator", { p_auction_id: auctionId, p_username: prof!.username });
  const { error } = await host.client.from("auction_moderators").update({ can_run: true }).eq("auction_id", auctionId).eq("user_id", cohost.id);
  expect(error).toBeNull();

  await uiLogin(page, cohost, "/host");
  await expect(page.getByRole("heading", { name: "Co-hosting" })).toBeVisible();
  await expect(page.getByText(title)).toBeVisible();

  await page.goto(`/a/${auctionId}`);
  await expect(page.getByText("Co-host controls")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
});

test("an ended auction replays its bids", async ({ page }) => {
  const host = await createUser("replayhost");
  const a = await createUser("replaya", "Replay Alice");
  const b = await createUser("replayb", "Replay Bob");
  const { auctionId, lotId } = await liveAuction(host, { title: `Replay ${Date.now()}`, startPrice: 100 });
  await rpc(a, "place_bid", { p_lot_id: lotId, p_amount: 100 });
  await rpc(b, "place_bid", { p_lot_id: lotId, p_amount: 150 });
  await rpc(host, "end_auction_now", { p_auction_id: auctionId });

  await page.goto(`/a/${auctionId}?tab=replay`);
  await expect(page.getByText("Bid 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Play replay" }).click();
  await expect(page.getByText("Bid 2 of 2")).toBeVisible();
  await expect(page.getByText("Replay Bob").first()).toBeVisible();
});
