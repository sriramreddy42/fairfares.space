const { test, expect } = require("@playwright/test");
const path = require("node:path");

const visualDir = path.join("test-results", "visual");

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  expect(overflow, `Page has horizontal overflow of ${overflow}px`).toBeLessThanOrEqual(2);
}

async function expectPrimaryControlsFit(page) {
  const broken = await page.locator("a, button, input, select, textarea").evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const hidden =
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.width === 0 ||
          rect.height === 0 ||
          rect.bottom < 0 ||
          rect.top > window.innerHeight;
        if (hidden) return null;

        const label =
          node.getAttribute("aria-label") ||
          node.innerText?.replace(/\s+/g, " ").trim() ||
          node.getAttribute("placeholder") ||
          node.getAttribute("name") ||
          node.tagName;
        const isTinyControl = node.matches("input[type='checkbox'], input[type='radio']");

        const isActionLink = node.matches("a.select-button, a.light-button, a.nav-button, a.button, a.user-chip, a.explorer-inline-button");
        const checkClipping = node.matches("button, input, select, textarea") || isActionLink;

        return {
          label,
          tag: node.tagName,
          width: rect.width,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          clipped: checkClipping && (node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2),
          outside: rect.left < -2 || rect.right > window.innerWidth + 2,
          tooSmall: isTinyControl ? rect.width < 14 || rect.height < 14 : false,
        };
      })
      .filter(Boolean)
      .filter((item) => item.clipped || item.outside || item.tooSmall)
  );

  expect(broken, `Controls clipped/outside viewport: ${JSON.stringify(broken.slice(0, 12))}`).toEqual([]);
}

async function expectReadableCards(page, selector) {
  const broken = await page.locator(selector).evaluateAll((nodes) =>
    nodes
      .slice(0, 8)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const children = [...node.querySelectorAll("h1,h2,h3,p,a,button,input,select,span,b,strong")];
        const outsideChildren = children
          .filter((child) => {
            const style = getComputedStyle(child);
            if (style.display === "none" || style.visibility === "hidden") return false;
            const childRect = child.getBoundingClientRect();
            return childRect.right > rect.right + 3 || childRect.left < rect.left - 3;
          })
          .map((child) => child.innerText?.replace(/\s+/g, " ").trim() || child.tagName);
        return {
          width: rect.width,
          left: rect.left,
          right: rect.right,
          viewport: window.innerWidth,
          outsideChildren,
        };
      })
      .filter((item) => item.right > item.viewport + 2 || item.left < -2 || item.outsideChildren.length)
  );

  expect(broken, `${selector} layout issues: ${JSON.stringify(broken.slice(0, 8))}`).toEqual([]);
}

async function smokePage(page, route, screenshotName) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalOverflow(page);
  await expectPrimaryControlsFit(page);
  await page.screenshot({ path: path.join(visualDir, screenshotName), fullPage: true });
}

async function loginAsAdmin(page) {
  await page.goto("/login");
  await page.fill("input[name='email']", "admin@fairfares.com");
  await page.fill("input[name='password']", "ChangeMe123!");
  await page.click("button[type='submit']");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/admin|\/activation-pending/);
}

async function expectFeedbackWidget(page) {
  await expect(page.locator("#appFeedbackWidget")).toBeVisible();
  await expect(page.locator(".app-feedback-tab", { hasText: "Feedback" })).toBeVisible();
}

test("home page desktop and mobile visual smoke", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await smokePage(page, "/", "home-desktop.png");
  await expect(page.locator("text=Let's find your perfect car")).toBeVisible();
  await expect(page.locator(".results-promo", { hasText: "Use Explorer as your free trip adviser." })).toBeVisible();
  await expect(page.locator(".results-ad-card", { hasText: "Rental confidence for students." })).toBeVisible();
  await expectFeedbackWidget(page);
  await expectReadableCards(page, ".car-card, .search-panel, .hero-media");

  await page.setViewportSize({ width: 390, height: 1100 });
  await smokePage(page, "/", "home-mobile.png");
  await expect(page.locator("text=Let's find your perfect car")).toBeVisible();
  await expectFeedbackWidget(page);
  await expectReadableCards(page, ".car-card, .search-panel");
});

test("website feedback submits and appears in admin", async ({ page }) => {
  const message = `Website feedback test ${Date.now()}`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expectFeedbackWidget(page);
  await page.locator(".app-feedback-tab").click();
  await expect(page.locator(".app-feedback-panel", { hasText: "Rate this website" })).toBeVisible();
  await page.locator("[data-feedback-rating='5']").click();
  await page.locator(".app-feedback-panel textarea[name='message']").fill(message);
  await page.locator(".app-feedback-submit").click();
  await expect(page.locator(".app-feedback-status")).toContainText("website feedback");

  await loginAsAdmin(page);
  await expect(page.locator(".website-feedback-card", { hasText: "Website Feedback" })).toBeVisible();
  await expect(page.locator(".website-feedback-card")).toContainText(message);
});

test("manage booking page desktop and mobile visual smoke", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await smokePage(page, "/manage-booking", "manage-booking-desktop.png");
  await expectReadableCards(page, ".booking-card, .docs-card, .profile-panel, .empty-booking-promo");

  await page.setViewportSize({ width: 390, height: 1100 });
  await smokePage(page, "/manage-booking", "manage-booking-mobile.png");
  await expectReadableCards(page, ".booking-card, .docs-card, .profile-panel, .empty-booking-promo");
});

test("deals and buy cars pages visual smoke", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await smokePage(page, "/deals", "deals-desktop.png");
  await smokePage(page, "/buy-cars", "buy-cars-desktop.png");

  await page.setViewportSize({ width: 390, height: 1100 });
  await smokePage(page, "/deals", "deals-mobile.png");
  await smokePage(page, "/buy-cars", "buy-cars-mobile.png");
});

test("auth pages desktop and mobile visual smoke", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await smokePage(page, "/login", "login-desktop.png");
  await smokePage(page, "/signup", "signup-desktop.png");
  await expectReadableCards(page, ".auth-card, .login-poster");

  await page.setViewportSize({ width: 390, height: 1100 });
  await smokePage(page, "/login", "login-mobile.png");
  await smokePage(page, "/signup", "signup-mobile.png");
  await expectReadableCards(page, ".auth-card, .login-poster");
});

test("admin pages desktop and mobile visual smoke", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1000 });
  await loginAsAdmin(page);

  for (const [route, name] of [
    ["/admin", "admin-dashboard-desktop.png"],
    ["/admin/bookings", "admin-bookings-desktop.png"],
    ["/admin/users", "admin-users-desktop.png"],
    ["/admin/tickets", "admin-tickets-desktop.png"],
    ["/admin/discounts", "admin-discounts-desktop.png"],
    ["/admin/email-marketing", "admin-email-marketing-desktop.png"],
    ["/admin/pickup", "admin-pickup-desktop.png"],
  ]) {
    await smokePage(page, route, name);
    await expectReadableCards(page, ".admin-card, .admin-hero, .admin-user-card, .pickup-record");
  }

  await page.setViewportSize({ width: 390, height: 1100 });
  for (const [route, name] of [
    ["/admin", "admin-dashboard-mobile.png"],
    ["/admin/bookings", "admin-bookings-mobile.png"],
    ["/admin/users", "admin-users-mobile.png"],
    ["/admin/tickets", "admin-tickets-mobile.png"],
    ["/admin/discounts", "admin-discounts-mobile.png"],
    ["/admin/email-marketing", "admin-email-marketing-mobile.png"],
    ["/admin/pickup", "admin-pickup-mobile.png"],
  ]) {
    await smokePage(page, route, name);
    await expectReadableCards(page, ".admin-card, .admin-hero, .admin-user-card, .pickup-record");
  }
});
