import { expect, test } from "@playwright/test";
import { createUser, rpc, uiLogin } from "./helpers";

test("host imports lots from CSV, sees analytics, and duplicates the auction", async ({ page }) => {
  const host = await createUser("thost");
  const bidder = await createUser("tbidder");
  const { data: a, error } = await host.client.from("auctions").insert({ host_id: host.id, title: `CSV ${Date.now()}`, settings: { currency: "INR" } }).select("id").single();
  if (error) throw error;

  await uiLogin(page, host, `/host/a/${a.id}`);
  const csv = 'title,start_price,Condition\n"Brass lamp",200,Good\n"Old map",150,"Fair, torn edge"\nBroken,abc,\n';
  await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles({ name: "lots.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(/Ready to import\s*2\s*lots/)).toBeVisible();
  await expect(page.getByText("Line 4: start price is not a valid number")).toBeVisible();
  await page.getByRole("button", { name: "Import 2" }).click();
  await expect(page.getByText("Imported 2 lots.")).toBeVisible();
  await expect(page.getByText("Brass lamp").first()).toBeVisible();
  await expect(page.getByText("Old map").first()).toBeVisible();

  // Go live, get a bid, and check analytics in the editor
  await rpc(host, "start_auction", { p_auction_id: a.id });
  const { data: lots } = await host.client.from("lots").select("id").eq("auction_id", a.id).order("position");
  await rpc(bidder, "place_bid", { p_lot_id: lots![0].id, p_amount: 200 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByText(/1 bids \(1 manual\)/)).toBeVisible();

  // Duplicate creates a new draft with the same lots
  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.locator("main").getByText("Draft").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title" }).first()).toHaveValue(/\(copy\)$/);
  await expect(page.getByText("Brass lamp").first()).toBeVisible();
});
