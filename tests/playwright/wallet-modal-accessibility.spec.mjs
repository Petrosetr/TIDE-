import { expect, test } from "@playwright/test";

const E2E_WALLET_ADDRESS = `0x${"7".repeat(64)}`;
const E2E_WALLET_NAME = "TIDE Modal Wallet";

async function installMockWallet(page) {
  await page.addInitScript(({ address, walletName }) => {
    const account = {
      address,
      chains: ["sui:testnet"],
      features: ["standard:connect", "standard:disconnect"],
    };
    const wallet = {
      version: "1.0.0",
      name: walletName,
      icon: "",
      chains: ["sui:testnet"],
      accounts: [account],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => ({ accounts: [account] }),
        },
        "standard:disconnect": {
          version: "1.0.0",
          disconnect: async () => {},
        },
      },
    };

    window.addEventListener("wallet-standard:app-ready", (event) => {
      event.detail?.register?.(wallet);
    });
  }, { address: E2E_WALLET_ADDRESS, walletName: E2E_WALLET_NAME });
}

async function isFocusInsideWalletDialog(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector(".wm-modal");
    return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
  });
}

test.describe("wallet modal accessibility", () => {
  test("keeps focus modal and restores it to the trigger on Escape", async ({ page }) => {
    await installMockWallet(page);
    await page.goto("/setup?judge=1", { waitUntil: "domcontentloaded" });

    const trigger = page.getByRole("button", { name: /Connect Wallet/i });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Connect a Wallet" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAttribute("aria-labelledby", "wallet-modal-title");
    await expect(dialog).toHaveAttribute("aria-describedby", "wallet-modal-description");
    await expect(page.locator("#wallet-modal-title")).toHaveText("Connect a Wallet");
    await expect(page.locator("#wallet-modal-description")).toContainText("Choose an installed Sui wallet");

    await expect(page.getByRole("button", { name: E2E_WALLET_NAME })).toBeFocused();
    await expect.poll(() => isFocusInsideWalletDialog(page)).toBe(true);

    await expect.poll(async () => page.evaluate(() => (
      Array.from(document.body.children)
        .filter((element) => !element.classList.contains("wm-overlay"))
        .every((element) => element.inert === true || element.getAttribute("aria-hidden") === "true")
    ))).toBe(true);

    for (let index = 0; index < 10; index += 1) {
      await page.keyboard.press("Tab");
      await expect.poll(() => isFocusInsideWalletDialog(page)).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await expect.poll(async () => page.evaluate(() => (
      Array.from(document.body.children)
        .filter((element) => !element.classList.contains("wm-overlay"))
        .every((element) => element.inert !== true && element.getAttribute("aria-hidden") !== "true")
    ))).toBe(true);
  });
});
