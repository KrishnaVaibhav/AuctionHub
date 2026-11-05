import { expect, test } from "@playwright/test";
import { createUser, liveAuction, rpc, uiLogin } from "./helpers";

test("viewer guesses the price, sees the host's announcement and the live stage", async ({ page }) => {
  const host = await createUser("funhost");
  const viewer = await createUser("funviewer", "Fun Viewer");
  const { auctionId } = await liveAuction(host, { title: `Fun ${Date.now()}`, startPrice: 200 });

  await uiLogin(page, viewer, `/a/${auctionId}`);
  await expect(page.getByRole("region", { name: "Live now" })).toBeVisible();
  await page.getByLabel("Your guess").first().fill("450");
  await page.getByRole("button", { name: "Guess", exact: true }).first().click();
  await expect(page.getByText("Locked in. Scored when the lot closes.").first()).toBeVisible();

  await rpc(host, "host_set_announcement", { p_auction_id: auctionId, p_text: "Next lot in two minutes" });
  await expect(page.getByText("Next lot in two minutes")).toBeVisible();

  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByText("Room bingo")).toBeVisible();
});

test("host turns a room feature off from the room controls", async ({ page }) => {
  const host = await createUser("ctrlhost");
  const { auctionId } = await liveAuction(host, { title: `Controls ${Date.now()}` });

  await uiLogin(page, host, `/a/${auctionId}`);
  await page.getByRole("button", { name: "Room" }).click();
  const dialog = page.getByRole("dialog", { name: "Room controls" });
  await dialog.getByRole("checkbox", { name: /Live reactions/ }).uncheck();
  await expect(dialog.getByText("Turned off")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("group", { name: "React" })).toHaveCount(0);
});
