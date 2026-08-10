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
          Number(style.opacity) === 0 ||
          node.closest("[aria-hidden='true']") !== null ||
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
        // Icon buttons expose their name through aria-label; their visually
        // hidden hover tooltip can legitimately extend beyond the circle.
        const checkClipping =
          (node.matches("button, input, select, textarea") || isActionLink) &&
          !node.matches(".fb-icon-button");

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
            if (child.closest(".admin-table-scroll, .admin-table-wrap")) return false;
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
  const adminEmail = process.env.FAIRFARES_ADMIN_EMAIL;
  const adminPassword = process.env.FAIRFARES_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) throw new Error("Set FAIRFARES_ADMIN_EMAIL and FAIRFARES_ADMIN_PASSWORD for admin visual tests.");
  await page.goto("/login");
  await page.fill("input[name='email']", adminEmail);
  await page.fill("input[name='password']", adminPassword);
  await page.click("button[type='submit']");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.locator("body")).toContainText("Admin");
}

async function expectFeedbackWidget(page) {
  await expect(page.locator("#appFeedbackWidget")).toBeVisible();
  await expect(page.locator(".app-feedback-tab", { hasText: "Website Feedback" })).toBeVisible();
}

test("home page desktop and mobile visual smoke", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await smokePage(page, "/car-rentals", "home-desktop.png");
  await expect(page.getByRole("heading", { name: /Find cheap car rentals in Denver Colorado/i })).toBeVisible();
  await expect(page.locator(".results-promo", { hasText: "Explorer is your Colorado road trip guide." })).toBeVisible();
  await expect(page.locator(".results-ad-card", { hasText: "Affordable car rental across Colorado." })).toBeVisible();
  const filterBox = await page.locator(".results-side-rail .filters").boundingBox();
  const promoBox = await page.locator(".results-side-rail .results-promo").boundingBox();
  expect(filterBox.y, "Apply filter should be above Explorer advertisements").toBeLessThan(promoBox.y);
  await expectFeedbackWidget(page);
  await expectReadableCards(page, ".car-card, .search-panel, .hero-media");

  await page.setViewportSize({ width: 390, height: 1100 });
  await smokePage(page, "/car-rentals", "home-mobile.png");
  await expect(page.getByRole("heading", { name: /Find cheap car rentals in Denver Colorado/i })).toBeVisible();
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
  await page.goto("/admin/system");
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

test("uploaded Explorer avatar follows the user into the header", async ({ page }) => {
  const avatarData =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCA0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjMDBjMmZmIi8+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMTIiIGZpbGw9IiNlZDAwMWMiLz48L3N2Zz4=";
  await loginAsAdmin(page);
  await page.goto("/explorer");
  const saveResult = await page.evaluate(async (src) => {
    const response = await fetch("/profile/photo", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ photo: src }),
    });
    return response.json();
  }, avatarData);
  expect(saveResult.ok).toBeTruthy();
  await page.goto("/manage-booking");
  await expect(page.locator(".user-chip span").first()).toHaveCSS("background-image", /data:image/);
});

test("deals and buy cars pages visual smoke", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await smokePage(page, "/deals", "deals-desktop.png");
  await smokePage(page, "/buy-cars", "buy-cars-desktop.png");

  await page.setViewportSize({ width: 390, height: 1100 });
  await smokePage(page, "/deals", "deals-mobile.png");
  await smokePage(page, "/buy-cars", "buy-cars-mobile.png");
});

test("wiki search respects public and internal visibility", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await smokePage(page, "/wiki", "wiki-desktop.png");
  await expect(page.locator(".wiki-result-card", { hasText: "How FairFares savings work" })).toBeVisible();
  await expect(page.locator("#wikiAgentWidget")).toBeVisible();
  await expect(page.locator(".wiki-agent-prompt")).toContainText(/cheapest cars|refund policy|Explorer memories|pickup documents|student savings/);
  await page.locator(".wiki-agent-orb").click();
  await expect(page.locator(".wiki-agent-panel")).toBeVisible();
  await expect(page.locator(".wiki-agent-backdrop")).toBeVisible();
  await expect(page.locator(".wiki-agent-head")).toContainText("FairFares Assistant");
  await page.locator(".wiki-agent-panel input[name='question']").fill("refund policy");
  await page.locator(".wiki-agent-submit").click();
  await expect(page.locator(".wiki-agent-answer")).toContainText("Refund and cancellation policy");
  await expect(page.locator(".wiki-agent-actions a", { hasText: "Review cancellation" })).toBeVisible();

  await page.goto("/wiki?q=rag");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("body")).not.toContainText("Your files flow into a vector database");

  await page.setViewportSize({ width: 390, height: 1000 });
  await smokePage(page, "/wiki", "wiki-mobile.png");

  await page.setViewportSize({ width: 1280, height: 1000 });
  await loginAsAdmin(page);
  await smokePage(page, "/admin/wiki?q=rag", "admin-wiki-desktop.png");
  await expect(page.locator("body")).toContainText("Your files flow into a vector database");
  await page.locator(".wiki-agent-orb").click();
  await page.locator(".wiki-agent-panel input[name='question']").fill("rag");
  await page.locator(".wiki-agent-submit").click();
  await expect(page.locator(".wiki-agent-answer")).toContainText("OpenAI + RAG knowledge flow");
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
    ["/admin/requests", "admin-requests-desktop.png"],
    ["/admin/tickets", "admin-tickets-desktop.png"],
    ["/admin/discounts", "admin-discounts-desktop.png"],
    ["/admin/wiki", "admin-wiki-loop-desktop.png"],
    ["/admin/email-marketing", "admin-email-marketing-desktop.png"],
    ["/admin/pickup", "admin-pickup-desktop.png"],
    ["/admin/system", "admin-system-desktop.png"],
  ]) {
    await smokePage(page, route, name);
    await expectReadableCards(page, ".admin-card, .admin-hero, .admin-user-card, .pickup-record");
  }

  await page.setViewportSize({ width: 390, height: 1100 });
  for (const [route, name] of [
    ["/admin", "admin-dashboard-mobile.png"],
    ["/admin/bookings", "admin-bookings-mobile.png"],
    ["/admin/users", "admin-users-mobile.png"],
    ["/admin/requests", "admin-requests-mobile.png"],
    ["/admin/tickets", "admin-tickets-mobile.png"],
    ["/admin/discounts", "admin-discounts-mobile.png"],
    ["/admin/wiki", "admin-wiki-mobile.png"],
    ["/admin/email-marketing", "admin-email-marketing-mobile.png"],
    ["/admin/pickup", "admin-pickup-mobile.png"],
    ["/admin/system", "admin-system-mobile.png"],
  ]) {
    await smokePage(page, route, name);
    await expectReadableCards(page, ".admin-card, .admin-hero, .admin-user-card, .pickup-record");
  }
});
