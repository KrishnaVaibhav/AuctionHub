import { expect, test } from "@playwright/test";
import { createUser, rpc, uiLogin } from "./helpers";

test("category filter, host profile, follow, and rating after a win", async ({ page }) => {
  const host = await createUser("dhost", "Coin Collector");
  const buyer = await createUser("dbuyer", "Buyer Bee");
  const title = `Rare coins ${Date.now()}`;

  const { data: a, error } = await host.client
    .from("auctions")
    .insert({ host_id: host.id, title, category: "coins", tags: ["silver"], settings: { currency: "INR", lot_duration_minutes: 30 } })
    .select("id")
    .single();
  if (error) throw error;
  const { data: lot } = await host.client.from("lots").insert({ auction_id: a.id, title: "1947 rupee", start_price: 100 }).select("id").single();
  await rpc(host, "start_auction", { p_auction_id: a.id });

  // Category chip filters the home grid
  await page.goto("/");
  await page.getByRole("button", { name: /Coins & Stamps/ }).click();
  await expect(page.getByText(title).first()).toBeVisible();

  // Host line -> public profile -> follow
  await uiLogin(page, buyer, `/a/${a.id}`);
  await page.getByRole("link", { name: /Hosted by Coin Collector/ }).click();
  await expect(page.getByRole("heading", { name: "Coin Collector" })).toBeVisible();
  await page.getByRole("button", { name: "Follow" }).click();
  await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
  await expect(page.getByText(/1\s*followers/)).toBeVisible();

  // Win the lot and rate the seller from My bids
  await rpc(buyer, "place_bid", { p_lot_id: lot!.id, p_amount: 100 });
  await rpc(host, "close_lot_now", { p_lot_id: lot!.id });
  await page.goto("/me");
  await page.getByRole("button", { name: /^Won/ }).click();
  await page.getByRole("button", { name: "4 stars" }).click();
  await page.getByPlaceholder("Optional comment").fill("Smooth deal");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Your rating of the seller:")).toBeVisible();

  // Rating shows on the host profile
  await page.goto(`/u/${(await host.client.from("profiles").select("username").eq("id", host.id).single()).data!.username}`);
  await expect(page.getByText("Smooth deal")).toBeVisible();
});
