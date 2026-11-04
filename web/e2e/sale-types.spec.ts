import { expect, test } from "@playwright/test";
import { createUser, liveAuction, rpc, uiLogin } from "./helpers";

test("sealed bids stay hidden, then the highest wins", async ({ page }) => {
  const host = await createUser("sealhost");
  const rival = await createUser("sealrival", "Sealed Rival");
  const bidder = await createUser("sealbidder", "Sealed Bidder");
  const { auctionId, lotId } = await liveAuction(host, { title: `Sealed ${Date.now()}`, startPrice: 500, saleType: "sealed" });
  await rpc(rival, "place_sealed_bid", { p_lot_id: lotId, p_amount: 600 });

  await uiLogin(page, bidder, `/a/${auctionId}`);
  await expect(page.getByText("1 bidder", { exact: true })).toBeVisible();
  await page.getByLabel("Sealed bid amount").fill("750");
  await page.getByRole("button", { name: "Place sealed bid" }).click();
  await expect(page.getByText(/Your sealed bid: ₹750/)).toBeVisible();
  await expect(page.getByText("2 bidders", { exact: true })).toBeVisible();

  await rpc(host, "close_lot_now", { p_lot_id: lotId });
  await expect(page.getByText("Sold for")).toBeVisible();
  await expect(page.getByText(/to you/)).toBeVisible();
});

test("host accepts an offer", async ({ page }) => {
  const host = await createUser("offerhost");
  const buyer = await createUser("offerbuyer", "Offer Buyer");
  const { auctionId, lotId } = await liveAuction(host, { title: `Offer ${Date.now()}`, startPrice: 200, saleType: "offer" });
  await rpc(buyer, "make_offer", { p_lot_id: lotId, p_amount: 260, p_message: "Can pick up today" });

  await uiLogin(page, host, `/a/${auctionId}`);
  await expect(page.getByText('"Can pick up today"')).toBeVisible();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Accept offer" }).click();
  await expect(page.getByText("Sold for")).toBeVisible();
});
