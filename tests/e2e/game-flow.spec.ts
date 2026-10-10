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

async function registerAndCreateRoom(page: Page, nickname: string) {
  await register(page, nickname);
  await expect(page.getByRole("button", { name: /普通列车/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /豪华列车/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /雾之村/ })).toBeDisabled();
  await page.getByRole("button", { name: "创建房间" }).click();
  await expect(page).toHaveURL(/\/room\//);
  await expect(page.locator(".room-meta").getByText("普通列车")).toBeVisible();
  const code = (await page.locator(".room-code").innerText()).trim();
  return code;
}

async function helpCurrentPlacement(page: Page) {
  const cells = page.locator(".board-cell.interactive:not([disabled])");
  if ((await cells.count()) === 0) return false;
  await cells.first().evaluate((element) => (element as HTMLElement).click());
  const nextCells = page.locator(".board-cell.selected-section.interactive:not([disabled])");
  const appeared = await nextCells
    .first()
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;
  await nextCells.first().evaluate((element) => (element as HTMLElement).click());
  return true;
}

async function choosePlacementCarriage(page: Page, label: string) {
  const selectedCells = page.locator(
    ".board-cell.selected-section.interactive:not([disabled])",
  );
  if ((await selectedCells.count()) > 0) {
    await selectedCells.first().evaluate((element) => (element as HTMLElement).click());
    return true;
  }
  const sectionCells = page.locator(
    `.board-cell[aria-label^="${label}，"]:not([disabled])`,
  );
  if ((await sectionCells.count()) === 0) return false;
  await sectionCells.first().evaluate((element) => (element as HTMLElement).click());
  const appeared = await selectedCells
    .first()
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;
  await selectedCells.first().evaluate((element) => (element as HTMLElement).click());
  return true;
}

async function moveWithoutDrinking(page: Page) {
  const token = page.locator(".player-token.self").first();
  const x = Number(await token.getAttribute("data-x"));
  const y = Number(await token.getAttribute("data-y"));
  const inFirstCarriage = y >= 2 && y <= 5;
  const startY = inFirstCarriage ? 2 : 6;
  const endY = inFirstCarriage ? 5 : 9;
  let label = "";
  if (y > startY) label = "上";
  else if (y < endY) label = "下";
  else if (x < 2) label = "右";
  else label = "左";
  await page
    .getByRole("button", { name: label, exact: true })
    .evaluate((element) => (element as HTMLElement).click());
}

test("two players can create, join, ready, select and move without position leaks", async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const hostName = uniqueName("车长");
  const guestName = uniqueName("乘客");
  const code = await registerAndCreateRoom(host, hostName);

  await register(guest, guestName);
  await guest.goto(`/join/${code}`);
  await expect(guest).toHaveURL(/\/room\//);
  await host.getByLabel("聊天内容").fill("准备出发");
  await host.getByTitle("发送").click();
  await expect(guest.getByText("准备出发")).toBeVisible();
  await guest.getByRole("button", { name: "准备登车" }).click();
  await expect(host.getByRole("button", { name: "开始游戏" })).toBeEnabled();
  await host.getByRole("button", { name: "开始游戏" }).click();

  await expect(host.getByRole("heading", { name: "选择本局身份" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "选择本局身份" })).toBeVisible();
  await expect(host.getByRole("tab", { name: "基础组" })).toBeVisible();
  await expect(host.getByRole("tab", { name: "F·R特供组" })).toBeVisible();
  await expect(host.getByRole("tab", { name: "豪华列车限定组" })).toBeVisible();
  await expect(host.getByRole("tab", { name: "雾之村限定组" })).toBeVisible();
  await host.getByRole("button", { name: /盲僧/ }).click();
  await expect(host.getByRole("dialog", { name: "角色尚未开放" })).toBeVisible();
  await expect(host.getByText("该角色尚未开放")).toBeVisible();
  await host.getByRole("button", { name: "知道了" }).click();
  await host.getByRole("button", { name: /倒霉蛋/ }).click();
  await guest.getByRole("button", { name: /倒霉蛋/ }).click();

  await expect(host.locator(".board-frame")).toBeVisible();
  await expect(guest.locator(".board-frame")).toBeVisible();
  const firstCellBox = await host.locator(".board-cell").first().boundingBox();
  expect(firstCellBox).not.toBeNull();
  expect(Math.abs(firstCellBox!.width - firstCellBox!.height)).toBeLessThan(1);

  const spectatorContext = await browser.newContext();
  const spectator = await spectatorContext.newPage();
  await register(spectator, uniqueName("观战"));
  await spectator.goto(`/join/${code}`);
  await expect(spectator).toHaveURL(/\/room\//);
  await expect(spectator.locator(".control-pad")).toHaveCount(1);
  await expect(spectator.locator(".control-pad button:not([disabled])")).toHaveCount(0);
  await expect(spectator.getByLabel("聊天内容")).toBeDisabled();

  for (let attempt = 0; attempt < 16; attempt += 1) {
    if ((await host.locator(".control-pad button:not([disabled])").count()) > 0) break;
    const hostBanner = await host.locator(".activity-banner").textContent().catch(() => "");
    const guestBanner = await guest.locator(".activity-banner").textContent().catch(() => "");
    if (hostBanner?.includes(hostName)) {
      await helpCurrentPlacement(host);
    } else if (guestBanner?.includes(guestName)) {
      await helpCurrentPlacement(guest);
    }
    await host.waitForTimeout(300);
  }

  await expect
    .poll(async () => {
      return (
        (await host.locator(".control-pad button:not([disabled])").count()) > 0 ||
        (await guest.locator(".control-pad button:not([disabled])").count()) > 0
      );
    })
    .toBe(true);
  await expect(host.locator(".player-token")).toHaveCount(1);
  await expect(guest.locator(".player-token")).toHaveCount(1);
  await expect(spectator.locator(".player-token")).toHaveCount(2);

  const activePage =
    (await host.locator(".control-pad button:not([disabled])").count()) > 0 ? host : guest;
  const otherPage = activePage === host ? guest : host;
  await activePage.getByRole("button", { name: "雾视" }).click();
  const fogOverlay = activePage.locator(".fog-decision-overlay");
  await expect(fogOverlay).toBeVisible();
  await expect(fogOverlay.getByRole("heading", { name: "有人正在进行雾视" })).toBeVisible();
  await expect(fogOverlay).toHaveCSS("position", "fixed");
  const overlayBox = await fogOverlay.boundingBox();
  const viewport = activePage.viewportSize();
  expect(overlayBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(overlayBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(overlayBox!.height).toBeGreaterThanOrEqual(viewport!.height - 1);
  await expect(activePage.locator(".fog-vision-active")).toHaveCount(1);
  await expect(activePage.locator(".fog-position-marker")).toHaveCount(1);
  await expect(otherPage.locator(".fog-position-marker")).toHaveCount(0);
  await expect
    .poll(() => otherPage.locator(".control-pad button:not([disabled])").count())
    .toBeGreaterThan(0);
  await moveWithoutDrinking(otherPage);
  await expect(activePage.locator(".fog-vision-active")).toHaveCount(0);
  await expect(activePage.locator(".fog-position-marker")).toHaveCount(1);

  await expect(host.locator(".board-frame")).toBeVisible();
  await expect(guest.locator(".board-frame")).toBeVisible();

  for (let action = 0; action < 70; action += 1) {
    if (await host.locator(".leaderboard-panel").isVisible().catch(() => false)) break;
    let actor: Page | null = null;
    for (const page of [host, guest]) {
      const availableMoves = page.locator(".control-pad button:not([disabled])");
      if ((await availableMoves.count()) > 0) {
        actor = page;
        break;
      }
    }
    if (!actor) {
      await host.waitForTimeout(120);
      continue;
    }
    await moveWithoutDrinking(actor);
    await host.waitForTimeout(220);
  }

  await expect(host.locator(".leaderboard-panel")).toBeVisible();
  await expect(host.locator(".rank-1")).toHaveCount(2);
  await expect(host.locator(".replay-layout.embedded")).toBeVisible();
  await expect(host.getByText(/轨迹回放 · 普通列车/)).toBeVisible();
  const nextRound = host.getByTitle("下一轮");
  for (let round = 0; round < 12; round += 1) {
    if (await nextRound.isDisabled()) break;
    await nextRound.click();
  }
  await expect(host.locator(".replay-layout.embedded .board-paths polyline")).toHaveCount(2);
  const pathPoints = await host
    .locator(".replay-layout.embedded .board-paths polyline")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("points") ?? ""));
  expect(pathPoints.some((points) => points.split(" ").length > 1)).toBe(true);
  expect(
    await host.locator(".replay-layout.embedded .event-marker").count(),
  ).toBeGreaterThanOrEqual(3);
  await host.getByRole("button", { name: "回到房间" }).click();
  await expect(host.locator(".room-code")).toBeVisible();
  await expect(guest.locator(".room-code")).toBeVisible();
  await host.goto("/");
  await host.getByRole("button", { name: "排行榜" }).click();
  const leaderboard = host.getByRole("dialog", { name: "玩家排行榜" });
  await expect(leaderboard).toBeVisible();
  await expect(leaderboard.getByText(hostName).first()).toBeVisible();
  await expect(leaderboard.getByText(guestName).first()).toBeVisible();
  await expect(leaderboard.getByText("10.00").first()).toBeVisible();

  await hostContext.close();
  await guestContext.close();
  await spectatorContext.close();
});

test("mobile home and auth views fit the viewport", async ({ page }) => {
  await register(page, uniqueName("移动"));
  await expect(page.getByRole("heading", { name: /在看不见彼此/ })).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("min-width", "320px");
  await page.getByRole("button", { name: /更新日志/ }).click();
  const changelog = page.getByRole("dialog", { name: "更新日志" });
  await expect(changelog).toBeVisible();
  await expect(changelog.getByText("v1.10.6").first()).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "游戏介绍" }).click();
  await expect(page.getByRole("dialog", { name: "游戏介绍" })).toBeVisible();
  await page.getByRole("button", { name: "角色介绍" }).click();
  await page.getByRole("button", { name: /猎人/ }).click();
  await expect(page.getByRole("heading", { name: "猎人" })).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-home.png", fullPage: true });
});

test("host can add a bot, remove it, and start with a standard bot", async ({ page }) => {
  await register(page, uniqueName("人机房主"));
  await page.getByRole("button", { name: "创建房间" }).click();
  await expect(page).toHaveURL(/\/room\//);

  await page.getByRole("button", { name: "添加纯入机" }).click();
  await expect(page.locator(".member-row.bot-member")).toHaveCount(1);
  await expect(page.getByText("纯入机").first()).toBeVisible();
  await page.locator(".member-row.bot-member .member-remove").click();
  await expect(page.locator(".member-row.bot-member")).toHaveCount(0);

  await page.getByRole("button", { name: "添加标准电脑" }).click();
  await expect(page.locator(".member-row.bot-member")).toHaveCount(1);
  await expect(page.getByText("标准").first()).toBeVisible();
  const removeBox = await page.locator(".member-row.bot-member .member-remove").boundingBox();
  const readyBox = await page.locator(".member-row.bot-member .ready-dot").boundingBox();
  expect(removeBox).not.toBeNull();
  expect(readyBox).not.toBeNull();
  expect(
    removeBox!.x < readyBox!.x + readyBox!.width &&
      removeBox!.x + removeBox!.width > readyBox!.x &&
      removeBox!.y < readyBox!.y + readyBox!.height &&
      removeBox!.y + removeBox!.height > readyBox!.y,
  ).toBe(false);
  const addBotBox = await page.getByRole("button", { name: "添加标准电脑" }).boundingBox();
  const addBotIconBox = await page
    .getByRole("button", { name: "添加标准电脑" })
    .locator("svg")
    .boundingBox();
  expect(addBotBox).not.toBeNull();
  expect(addBotIconBox).not.toBeNull();
  expect(addBotIconBox!.x).toBeGreaterThanOrEqual(addBotBox!.x);
  expect(addBotIconBox!.x + addBotIconBox!.width).toBeLessThanOrEqual(
    addBotBox!.x + addBotBox!.width,
  );
  await page.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.getByRole("heading", { name: "选择本局身份" })).toBeVisible();
  await page.getByRole("button", { name: /倒霉蛋/ }).click();
  await expect(page.getByText(/选择了角色/).first()).toBeVisible({ timeout: 5_000 });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await page.locator(".control-pad button:not([disabled])").count()) > 0) break;
    const banner = await page.locator(".activity-banner").textContent().catch(() => "");
    if (banner?.includes("人机房主")) {
      await helpCurrentPlacement(page);
    }
    await page.waitForTimeout(300);
  }
  await expect
    .poll(() => page.locator(".control-pad button:not([disabled])").count())
    .toBeGreaterThan(0);
});

test("creating another room automatically leaves the previous room", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const hostName = uniqueName("跨房房主");
  const guestName = uniqueName("留守乘客");

  const oldCode = await registerAndCreateRoom(host, hostName);
  await register(guest, guestName);
  await guest.goto(`/join/${oldCode}`);
  await expect(host.locator(".member-row")).toHaveCount(2);

  await host.goto("/");
  await host.getByRole("button", { name: "创建房间" }).click();
  await expect(host).toHaveURL(/\/room\//);
  const newCode = (await host.locator(".room-code").innerText()).trim();
  expect(newCode).not.toBe(oldCode);

  await expect(guest.locator(".member-row")).toHaveCount(1);
  await expect(guest.getByText(hostName)).toHaveCount(0);
  await guest.getByLabel("聊天内容").fill("仅旧房间可见");
  await guest.getByTitle("发送").click();
  await expect(guest.getByText("仅旧房间可见")).toBeVisible();
  await expect(host.getByText("仅旧房间可见")).toHaveCount(0);

  await hostContext.close();
  await guestContext.close();
});

test("thief can select hook targets after entering another player's initial carriage", async ({
  browser,
}) => {
  const thiefContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const thief = await thiefContext.newPage();
  const other = await otherContext.newPage();
  const thiefName = uniqueName("钩子小偷");
  const otherName = uniqueName("占位乘客");

  const code = await registerAndCreateRoom(thief, thiefName);
  await register(other, otherName);
  await other.goto(`/join/${code}`);
  await other.getByRole("button", { name: "准备登车" }).click();
  await expect(thief.getByRole("button", { name: "开始游戏" })).toBeEnabled();
  await thief.getByRole("button", { name: "开始游戏" }).click();
  await thief.getByRole("button", { name: /小偷/ }).click();
  await other.getByRole("button", { name: /倒霉蛋/ }).click();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const thiefBanner = await thief.locator(".activity-banner").textContent().catch(() => "");
    const otherBanner = await other.locator(".activity-banner").textContent().catch(() => "");
    if (thiefBanner?.includes(thiefName)) {
      await choosePlacementCarriage(thief, "车厢 1");
    } else if (otherBanner?.includes(otherName)) {
      await choosePlacementCarriage(other, "车厢 2");
    }
    if (
      (await thief.locator(".control-pad button:not([disabled])").count()) > 0 ||
      (await other.locator(".control-pad button:not([disabled])").count()) > 0
    ) {
      break;
    }
    await thief.waitForTimeout(150);
  }

  await expect
    .poll(async () => {
      return (
        (await thief.locator(".control-pad button:not([disabled])").count()) > 0 ||
        (await other.locator(".control-pad button:not([disabled])").count()) > 0
      );
    })
    .toBe(true);

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const thiefHasTurn =
      (await thief.locator(".control-pad button:not([disabled])").count()) > 0;
    const otherHasTurn =
      (await other.locator(".control-pad button:not([disabled])").count()) > 0;
    if (thiefHasTurn) {
      const y = Number(
        await thief.locator(".player-token.self").first().getAttribute("data-y"),
      );
      if (y >= 6) {
        await thief.getByRole("button", { name: "钩子" }).click();
        const hookTargets = thief.locator(
          ".board-cell.interactive:not([disabled])",
        );
        await expect
          .poll(() => hookTargets.count())
          .toBeGreaterThan(0);
        await hookTargets.first().evaluate((element) =>
          (element as HTMLElement).click(),
        );
        await expect(thief.locator(".event-marker.marker-hook")).toHaveCount(2);
        break;
      }
      await thief
        .getByRole("button", { name: "下", exact: true })
        .evaluate((element) => (element as HTMLElement).click());
      await expect
        .poll(
          () => thief.locator(".control-pad button:not([disabled])").count(),
          { timeout: 5_000 },
        )
        .toBe(0);
    } else if (otherHasTurn) {
      const x = Number(
        await other.locator(".player-token.self").first().getAttribute("data-x"),
      );
      await other
        .getByRole("button", { name: x < 2 ? "右" : "左", exact: true })
        .evaluate((element) => (element as HTMLElement).click());
      await expect
        .poll(
          () => other.locator(".control-pad button:not([disabled])").count(),
          { timeout: 5_000 },
        )
        .toBe(0);
    }
    await thief.waitForTimeout(120);
  }

  await expect(thief.locator(".event-marker.marker-hook")).toHaveCount(2);
  await thiefContext.close();
  await otherContext.close();
});
