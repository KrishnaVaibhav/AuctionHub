import { expect, test } from "@playwright/test";
import { createUser, rpc, uiLogin } from "./helpers";

test("team league: owner sees the player on the block, bids, and sees a rival bid live", async ({ page }) => {
  const host = await createUser("lhost");
  const one = await createUser("teamone");
  const two = await createUser("teamtwo");

  const { data: a, error } = await host.client
    .from("auctions")
    .insert({
      host_id: host.id,
      title: `E2E League ${Date.now()}`,
      mode: "league",
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      settings: {
        currency: "INR",
        compact: true,
        increments: [[0, 500000]],
        league: { purse: 100000000, squad_max: 5, lot_seconds: 60, bid_seconds: 15, break_seconds: 0 },
      },
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: lot } = await host.client.from("lots").insert({ auction_id: a.id, position: 0, title: "Star Player", start_price: 2000000 }).select("id").single();
  await rpc(host, "schedule_auction", { p_auction_id: a.id });
  await rpc(one, "join_league", { p_auction_id: a.id, p_name: "Team One", p_short_name: "ONE" });
  await rpc(two, "join_league", { p_auction_id: a.id, p_name: "Team Two", p_short_name: "TWO" });
  await rpc(host, "start_auction", { p_auction_id: a.id });

  await uiLogin(page, one, `/a/${a.id}`);
  await expect(page.getByRole("heading", { name: "Star Player" })).toBeVisible();
  await expect(page.getByText("Team One").first()).toBeVisible();

  await page.getByRole("button", { name: "₹20L", exact: true }).click();
  await expect(page.getByText("Your team has the highest bid")).toBeVisible();

  await rpc(two, "league_bid", { p_lot_id: lot!.id, p_amount: 2500000 });
  await expect(page.getByText("₹25L").first()).toBeVisible();
  await expect(page.getByText("Team Two").first()).toBeVisible();
});
