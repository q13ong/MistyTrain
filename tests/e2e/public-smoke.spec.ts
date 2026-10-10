import { expect, test, type Page } from "@playwright/test";

function uniqueName(prefix: string) {
  return `${prefix}${Date.now().toString().slice(-7)}`;
}

async function register(page: Page, nickname: string) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "注册" }).click();
  await page.getByPlaceholder("全局唯一昵称").fill(nickname);
  await page.getByPlaceholder("you@example.com").fill(`user${Date.now()}@example.com`);
  await page.getByPlaceholder("至少 8 位").fill("password123");
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("public deployment supports account, room and realtime connection", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await register(host, uniqueName("公网车长"));
  await host.getByRole("button", { name: "创建房间" }).click();
  await expect(host).toHaveURL(/\/room\//);
  const code = (await host.locator(".room-code").innerText()).trim();

  await register(guest, uniqueName("公网乘客"));
  await guest.goto(`/join/${code}`);
  await expect(guest).toHaveURL(/\/room\//);
  await expect(host.getByText("实时连接")).toBeVisible();
  await expect(guest.getByText("实时连接")).toBeVisible();

  await guest.getByRole("button", { name: "准备登车" }).click();
  await expect(host.getByRole("button", { name: "开始游戏" })).toBeEnabled();
  await host.getByRole("button", { name: "开始游戏" }).click();
  await expect(host.getByRole("heading", { name: "选择本局身份" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "选择本局身份" })).toBeVisible();
  await expect(host.getByRole("button", { name: /猎人/ })).toBeVisible();
  await expect(host.getByRole("button", { name: /列车长/ })).toBeVisible();
  await expect(host.getByRole("button", { name: /粉刷匠/ })).toBeVisible();
  await host.getByRole("button", { name: /猎人/ }).click();
  await guest.getByRole("button", { name: /猎人/ }).click();
  await expect(host.getByText(/选择了角色：猎人/).first()).toBeVisible();
  await expect(guest.getByText(/选择了角色：猎人/).first()).toBeVisible();

  await host.goto("/");
  await host.getByRole("button", { name: new RegExp(`回到房间 ${code}`) }).click();
  await expect(host).toHaveURL(/\/room\//);
  await expect(host.getByText(`房间 ${code}`)).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});
