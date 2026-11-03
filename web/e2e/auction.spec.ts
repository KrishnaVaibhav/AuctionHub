import { expect, test } from "@playwright/test";
import { createUser, liveAuction, PASSWORD, rpc, uiLogin } from "./helpers";

test("host creates an auction in the UI, goes live, and sees a rival bid in real time", async ({ page }) => {
  const host = await createUser("host", "E2E Host");
  const rival = await createUser("rival", "E2E Rival");
  await uiLogin(page, host, "/host");

  await page.getByLabel("New auction title").fill(`E2E auction ${Date.now()}`);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/host\/a\//);

  const newLot = page.locator("form", { hasText: "Add a lot" });
  await newLot.getByRole("textbox").first().fill("Vintage camera");
  await newLot.getByRole("spinbutton").first().fill("1000");
  await newLot.getByRole("button", { name: "Add lot" }).click();
  await expect(page.getByText("Vintage camera").first()).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Go live now" }).click();
  await expect(page).toHaveURL(/\/a\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Live", { exact: true }).first()).toBeVisible();

  const auctionId = page.url().split("/a/")[1];
  const { data: lot } = await host.client.from("lots").select("id").eq("auction_id", auctionId).single();
  await rpc(rival, "place_bid", { p_lot_id: lot!.id, p_amount: 1000 });

  // Realtime: the host's open page updates without reload.
  await expect(page.getByText(/^1 bid/)).toBeVisible();
  await expect(page.getByText("leads").first()).toBeVisible();
});

test("bidder places a bid through the bid panel", async ({ page }) => {
  const host = await createUser("host2");
  const bidder = await createUser("bidder", "E2E Bidder");
  const { auctionId } = await liveAuction(host, { title: `Bid panel ${Date.now()}`, startPrice: 500 });

  await uiLogin(page, bidder, `/a/${auctionId}`);
  await page.getByRole("button", { name: /^Bid ₹500/ }).click();
  await expect(page.getByText(/highest bidder at/)).toBeVisible();
  await expect(page.getByText(/winning/).first()).toBeVisible();
});

test("private auction: invite link gate, sign-in, auto-join", async ({ page }) => {
  const host = await createUser("phost", "Private Host");
  const guest = await createUser("guest");
  const { auctionId } = await liveAuction(host, { title: `Private ${Date.now()}`, visibility: "private" });
  const code = await rpc<string>(host, "get_invite_code", { p_auction_id: auctionId });

  await page.goto(`/a/${auctionId}?code=${code}`);
  await expect(page.getByText("Private auction", { exact: true })).toBeVisible();
  await expect(page.getByText("Hosted by Private Host")).toBeVisible();

  await page.getByRole("link", { name: "Sign in to join" }).click();
  await page.getByLabel("Email").fill(guest.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Password").press("Enter");

  await expect(page.getByText("Test lot").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Bid ₹/ })).toBeVisible();
});

test("watchlist: star a lot and see it under My bids > Watching", async ({ page }) => {
  const host = await createUser("whost");
  const user = await createUser("watcher");
  const { auctionId } = await liveAuction(host, { title: `Watch ${Date.now()}` });

  await uiLogin(page, user, `/a/${auctionId}`);
  await page.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(page.getByRole("button", { name: "Watching" })).toBeVisible();

  await page.goto("/me");
  await page.getByRole("button", { name: "Watching" }).click();
  await expect(page.getByText("Test lot")).toBeVisible();
});
