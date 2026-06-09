const { test, expect } = require("@playwright/test");
const path = require("node:path");

const visualDir = path.join("test-results", "visual");

async function generateQuest(page) {
  await page.goto("/explorer");
  await expect(page.locator("h2", { hasText: "What's today's vibe?" })).toBeVisible();
  for (const vibe of ["Food", "Adventure", "Nature"]) {
    await page.locator(".mood-grid label", { hasText: vibe }).click();
  }
  await page.locator("button", { hasText: "Generate Explorer Quest" }).click();
  await expect(page.locator(".quest-output")).toBeVisible();
  await expect(page.locator(".quest-stop").first()).toBeVisible();
  await expect(page.locator("#questRouteDetails")).toBeVisible();
  await expect(page.locator(".route-leg-list li").first()).toBeVisible();
}

async function expectNoVisibleTextClipping(page) {
  const clipped = await page.locator(".mood-grid label, .segmented-choice label, .quest-stop-actions button, .memory-menu label, .memory-share-actions button, .route-link, .primary-route-link").evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const text = node.innerText.replace(/\s+/g, " ").trim();
        const textNodes = [...node.querySelectorAll(".mood-name, input, span, button")].filter((child) => {
          const styles = getComputedStyle(child);
          return styles.display !== "none" && styles.visibility !== "hidden";
        });
        const hasOutsideChild = textNodes.some((child) => {
          const childRect = child.getBoundingClientRect();
          return childRect.right > rect.right + 1 || childRect.left < rect.left - 1 || childRect.bottom > rect.bottom + 1;
        });
        const usableTextWidth = node.querySelector(".mood-name")?.getBoundingClientRect().width ?? rect.width;
        return {
          text,
          clipped:
            node.scrollWidth > node.clientWidth + 1 ||
            node.scrollHeight > node.clientHeight + 1 ||
            hasOutsideChild ||
            (node.matches(".mood-grid label") && usableTextWidth < 70),
        };
      })
      .filter((item) => item.clipped)
  );
  expect(clipped, `Clipped Explorer controls: ${JSON.stringify(clipped)}`).toEqual([]);
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  expect(overflow, `Page has horizontal overflow of ${overflow}px`).toBeLessThanOrEqual(2);
}

async function expectVisibleControlBorders(page) {
  const weakControls = await page.locator(".explorer-form input[type='radio'], .explorer-form input[type='checkbox']").evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const styles = getComputedStyle(node);
        return {
          name: node.value || node.name,
          borderWidth: parseFloat(styles.borderTopWidth || "0"),
          borderColor: styles.borderTopColor,
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        };
      })
      .filter((item) => item.borderWidth < 1 || item.width < 14 || item.height < 14)
  );
  expect(weakControls, `Controls missing visible borders: ${JSON.stringify(weakControls)}`).toEqual([]);
}

async function expectQuestStopsFitViewport(page) {
  const brokenStops = await page.locator(".quest-stop").evaluateAll((nodes) =>
    nodes
      .slice(0, 4)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const children = [...node.querySelectorAll("h3, p, .quest-place-meta, .quest-media-carousel, .mission-upload, .quest-stop-actions")];
        const outsideChildren = children
          .filter((child) => {
            const styles = getComputedStyle(child);
            if (styles.display === "none" || styles.visibility === "hidden") return false;
            const childRect = child.getBoundingClientRect();
            return childRect.right > rect.right + 2 || childRect.left < rect.left - 2;
          })
          .map((child) => child.className || child.tagName);
        return {
          width: rect.width,
          left: rect.left,
          right: rect.right,
          viewport: window.innerWidth,
          outsideChildren,
        };
      })
      .filter((item) => item.width < item.viewport * 0.82 || item.right > item.viewport + 2 || item.outsideChildren.length)
  );
  expect(brokenStops, `Quest stops do not fit viewport: ${JSON.stringify(brokenStops)}`).toEqual([]);
}

test("Explorer desktop UI is aligned and interactive", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await generateQuest(page);
  await expectNoVisibleTextClipping(page);
  await expectVisibleControlBorders(page);
  await expectNoHorizontalOverflow(page);
  await expectQuestStopsFitViewport(page);
  await expect(page.locator("[data-share-channel='whatsapp']")).toBeVisible();
  await expect(page.locator("[data-share-channel='instagram']")).toBeVisible();
  await expect(page.locator("[data-share-channel='facebook']")).toBeVisible();
  await expect(page.locator(".primary-route-link").first()).toHaveAttribute("href", /google\.com\/maps\/dir/);

  const firstImage = page.locator(".quest-stop:not(.is-locked) .quest-media-carousel, .quest-stop:not(.is-locked) .quest-photo-placeholder").first();
  await expect(firstImage).toBeVisible();
  const mediaBox = await firstImage.boundingBox();
  expect(mediaBox.height, `Mission image too tall: ${mediaBox.height}`).toBeLessThanOrEqual(280);
  expect(mediaBox.width, `Mission image too wide: ${mediaBox.width}`).toBeLessThanOrEqual(700);

  await page.locator(".memory-plus").first().click();
  const memoryMenu = page.locator(".memory-menu").first();
  await expect(memoryMenu).toBeVisible();
  await expectNoVisibleTextClipping(page);

  const firstStopName = (await page.locator(".quest-stop:not(.is-locked) h3").first().innerText()).trim();
  await page.locator("[data-refresh-stop]").first().click();
  await expect(page.locator(".quest-stop:not(.is-locked) h3").first()).not.toHaveText(firstStopName);
  const replacedStopName = (await page.locator(".quest-stop:not(.is-locked) h3").first().innerText()).trim();
  expect(replacedStopName).not.toBe(firstStopName);

  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(visualDir, "explorer-desktop.png"), fullPage: true });
});

test("Explorer mobile UI keeps controls readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1100 });
  await generateQuest(page);
  await expectNoVisibleTextClipping(page);
  await expectVisibleControlBorders(page);
  await expectNoHorizontalOverflow(page);
  await expectQuestStopsFitViewport(page);

  await page.locator(".memory-plus").first().click();
  await expect(page.locator(".memory-menu").first()).toBeVisible();
  await expectNoVisibleTextClipping(page);

  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(visualDir, "explorer-mobile.png"), fullPage: true });
});
