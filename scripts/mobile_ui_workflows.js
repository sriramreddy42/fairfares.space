const { chromium } = require("playwright");

const baseURL = process.env.MOBILE_PREVIEW_URL || "http://127.0.0.1:8000";
const viewports = [
  ["small-phone", 320, 568],
  ["iphone", 390, 844],
  ["large-phone", 430, 932],
  ["tablet", 768, 1024],
  ["landscape", 1024, 768],
];

function bootstrap() {
  return {
    ok: true,
    user: { id: 50, name: "UI Test User", email: "ui.user@example.test", phone: "3035550199", role: "user", isAdmin: false, isVerified: true },
    location: { city: "Denver, CO", selected: "Denver, CO", suggested: "Aurora, CO" },
    housing: [],
    communities: [],
    chat: { unreadCount: 0, conversations: [] },
    dashboard: { housingPosts: 0, messages: 0 },
  };
}

async function mockApi(page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    let body = { ok: true };
    if (url.includes("/bootstrap")) body = bootstrap();
    else if (url.includes("/ride-places")) body = { ok: true, suggestions: [{ label: "University of Dayton, 300 College Park, Dayton, OH 45469", main: "University of Dayton", secondary: "300 College Park, Dayton, OH 45469", distanceMiles: 0, lat: 39.74, lng: -84.18, source: "ui-test" }] };
    else if (url.includes("/rides/driver-profile")) body = { ok: true, profile: { readyForOffers: false, missing: ["vehicle"] } };
    else if (url.includes("/rides/activity") || url.includes("/mobile/rides")) body = { ok: true, rides: [] };
    else if (url.includes("/rentals/bookings")) body = { ok: true, bookings: [] };
    else if (url.includes("/rentals")) body = { ok: true, cars: [] };
    else if (url.includes("/chat/conversations")) body = { ok: true, conversations: [] };
    else if (url.includes("/chat/communities")) body = { ok: true, communities: [] };
    else if (url.endsWith("/api/site")) body = { services: [] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function assertViewport(page, label) {
  const layout = await page.evaluate(() => ({
    overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    outside: [...document.querySelectorAll("button,input,[role=button]")]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (!rect.width || !rect.height || style.display === "none" || style.visibility === "hidden") return false;
        return rect.left < -2 || rect.right > innerWidth + 2;
      })
      .slice(0, 10)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { label: node.getAttribute("aria-label") || node.getAttribute("placeholder") || node.textContent?.trim() || node.tagName, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
      }),
  }));
  if (layout.overflow > 2 || layout.outside.length) throw new Error(`${label} layout failure: ${JSON.stringify(layout)}`);
}

async function openApp(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await mockApi(page);
  await page.goto(baseURL, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(3600);
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const [name, width, height] of viewports) {
      const page = await openApp(browser, width, height);
      await assertViewport(page, `${name}:home`);
      for (const text of ["Housing", "Carpool", "Rental Cars"]) {
        if (!(await page.getByText(text, { exact: true }).count())) throw new Error(`${name}: missing ${text}`);
      }
      await page.getByText("Carpool", { exact: true }).click();
      await assertViewport(page, `${name}:carpool`);
      await page.getByText("Rental Cars", { exact: true }).click();
      await assertViewport(page, `${name}:rentals`);
      await page.screenshot({ path: `/private/tmp/fairfares-${name}.png`, fullPage: false });
      results.push({ name, width, height, home: "pass", carpool: "pass", rentals: "pass" });
      await page.close();
    }

    const page = await openApp(browser, 390, 844);
    for (const flow of ["I need a place", "I need roommates", "I have a place"]) {
      await page.getByText(flow, { exact: true }).first().click();
      if (flow === "I have a place") {
        if (!(await page.getByPlaceholder("Start typing the property address*").count())) throw new Error("property address field missing");
      } else {
        const location = page.getByPlaceholder("Start typing an area, campus, building, or landmark*");
        await location.fill("University of Dayton");
        await page.waitForTimeout(450);
        await page.getByText("University of Dayton", { exact: true }).click();
        if ((await page.getByPlaceholder("City* eg Denver, CO").inputValue()) !== "Dayton, OH") throw new Error(`${flow}: city was not populated`);
      }
      const date = page.getByLabel(/^(Available from|Move-in from)/);
      await date.scrollIntoViewIfNeeded();
      await date.click();
      if (!(await page.getByText("CALENDAR", { exact: true }).count())) throw new Error(`${flow}: calendar did not open`);
      await page.getByLabel("Close date and time picker").click();
      await assertViewport(page, flow);
      await page.getByText("Cancel", { exact: true }).click();
    }

    await page.getByText("Account", { exact: true }).last().click();
    if (!(await page.getByText("Name, email, phone and profile photo", { exact: true }).count())) throw new Error("profile details should start collapsed");
    await page.getByText("Profile details", { exact: true }).click();
    if (!(await page.getByText("Hide personal information", { exact: true }).count())) throw new Error("profile details did not expand");
    if (!(await page.getByText("Help & Support", { exact: true }).count())) throw new Error("support link missing");
    if (!(await page.getByText("Log out of FairFares", { exact: true }).count())) throw new Error("logout missing");
    await assertViewport(page, "profile");

    for (const tab of ["Services", "Activity", "Fchat", "Home"]) {
      await page.getByText(tab, { exact: true }).last().click();
      await page.waitForTimeout(100);
      await assertViewport(page, tab);
    }
    results.push({ detailedMobileWorkflows: "pass", flows: ["need-place", "need-roommates", "have-place", "calendar", "location", "profile", "support", "services", "activity", "fchat"] });
    await page.close();
    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
