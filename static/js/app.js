const siteLoader = document.getElementById("siteLoader");

function hideSiteLoader() {
  if (!siteLoader) return;
  siteLoader.classList.add("is-hidden");
  siteLoader.setAttribute("aria-hidden", "true");
}

function showSiteLoader() {
  if (!siteLoader) return;
  siteLoader.classList.remove("is-hidden");
  siteLoader.setAttribute("aria-hidden", "false");
}

if (siteLoader) {
  document.addEventListener("DOMContentLoaded", hideSiteLoader, { once: true });
  window.addEventListener("pageshow", hideSiteLoader);
  window.addEventListener("load", () => window.setTimeout(hideSiteLoader, 220));
  window.setTimeout(hideSiteLoader, 450);
  window.setTimeout(hideSiteLoader, 1400);
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const link = target?.closest("a[href]");
    if (!link) return;
    const href = link.getAttribute("href") || "";
    if (
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      link.target ||
      link.hasAttribute("download")
    ) {
      return;
    }
    const nextUrl = new URL(link.href, window.location.href);
    if (nextUrl.origin !== window.location.origin) return;
    if (nextUrl.pathname === window.location.pathname && nextUrl.hash) return;
    showSiteLoader();
  });
}

function placeAdminSubnavInHero() {
  const adminHero = document.querySelector(".admin-screen .admin-hero");
  const adminSubnav = document.querySelector(".admin-screen .admin-subnav");
  if (!adminHero || !adminSubnav || adminHero.contains(adminSubnav)) return;
  adminHero.appendChild(adminSubnav);
}

placeAdminSubnavInHero();

function setOncallDockOffset() {
  const header = document.querySelector(".admin-shell-header");
  if (!header) return;
  const bottom = Math.max(76, Math.ceil(header.getBoundingClientRect().bottom));
  document.documentElement.style.setProperty("--admin-oncall-top", `${bottom}px`);
}

setOncallDockOffset();
window.addEventListener("resize", setOncallDockOffset);

const oncallDock = document.querySelector("[data-oncall-dock]");
const oncallToggle = document.querySelector("[data-oncall-toggle]");
const oncallClose = document.querySelector("[data-oncall-close]");

if (oncallDock && oncallDock.parentElement !== document.body) {
  document.body.appendChild(oncallDock);
}

function closeOncallDrawer() {
  if (!oncallDock) return;
  oncallDock.classList.remove("is-open");
  oncallToggle?.setAttribute("aria-expanded", "false");
}

function toggleOncallDrawer() {
  if (!oncallDock) return;
  const isOpen = oncallDock.classList.toggle("is-open");
  oncallToggle?.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

oncallToggle?.addEventListener("click", toggleOncallDrawer);
oncallClose?.addEventListener("click", closeOncallDrawer);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOncallDrawer();
});

const oncallDayButtons = document.querySelectorAll("[data-oncall-day-toggle]");

function closeOncallDayEditors(exceptCard = null) {
  document.querySelectorAll(".oncall-day.is-editing").forEach((card) => {
    if (card === exceptCard) return;
    card.classList.remove("is-editing");
    card.querySelector("[data-oncall-day-toggle]")?.setAttribute("aria-expanded", "false");
    const editor = card.querySelector(".oncall-day-editor");
    if (editor) editor.hidden = true;
  });
}

oncallDayButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".oncall-day");
    const editor = card?.querySelector(".oncall-day-editor");
    if (!card || !editor) return;
    const isOpen = !editor.hidden;
    closeOncallDayEditors(card);
    editor.hidden = isOpen;
    card.classList.toggle("is-editing", !isOpen);
    button.setAttribute("aria-expanded", isOpen ? "false" : "true");
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOncallDayEditors();
});

document.querySelectorAll("[data-dashboard-action]").forEach((button) => {
  button.addEventListener("click", () => {
    console.info("[FairFares admin dashboard]", button.dataset.dashboardAction);
  });
});

document.querySelectorAll("[data-workspace-profile-card]").forEach((card) => {
  card.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (target?.closest("a, button, input, label")) return;
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    card.classList.toggle("is-open");
  });
});

document.querySelectorAll("[data-policy-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".checkout-policy-card");
    if (!card) return;
    const expanded = card.classList.toggle("is-expanded");
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.textContent = expanded ? "Show less" : "See more";
  });
});

const workspacePostModal = document.getElementById("workspacePostModal");

function closeWorkspacePostModal() {
  if (!workspacePostModal) return;
  workspacePostModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function openWorkspacePostModal(openPhoto = false) {
  if (!workspacePostModal) return;
  workspacePostModal.hidden = false;
  document.body.classList.add("modal-open");
  const textarea = workspacePostModal.querySelector("textarea[name='body']");
  const fileInput = workspacePostModal.querySelector("[data-workspace-post-image]");
  window.setTimeout(() => {
    if (openPhoto && fileInput instanceof HTMLInputElement) {
      fileInput.click();
      return;
    }
    textarea?.focus();
  }, 40);
}

document.querySelectorAll("[data-workspace-post-open]").forEach((button) => {
  button.addEventListener("click", () => {
    openWorkspacePostModal(button.hasAttribute("data-workspace-post-photo"));
  });
});

document.querySelectorAll("[data-workspace-post-close]").forEach((button) => {
  button.addEventListener("click", closeWorkspacePostModal);
});

workspacePostModal?.addEventListener("click", (event) => {
  if (event.target === workspacePostModal) closeWorkspacePostModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && workspacePostModal && !workspacePostModal.hidden) {
    closeWorkspacePostModal();
  }
});

function replaceTextareaSelection(textarea, nextValue, selectStart, selectEnd) {
  textarea.value = nextValue;
  textarea.focus();
  textarea.setSelectionRange(selectStart, selectEnd);
}

function applyWorkspaceEditorCommand(button) {
  const form = button.closest(".workspace-post-form");
  const textarea = form?.querySelector("textarea[name='body']");
  if (!(textarea instanceof HTMLTextAreaElement)) return;
  const command = button.dataset.editorCommand || "";
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const before = textarea.value.slice(0, start);
  const selected = textarea.value.slice(start, end);
  const after = textarea.value.slice(end);
  const fallback = selected || "text";
  let insert = selected;
  let nextStart = start;
  let nextEnd = end;

  if (command === "bold") {
    insert = `**${fallback}**`;
    nextStart = start + 2;
    nextEnd = nextStart + fallback.length;
  } else if (command === "italic") {
    insert = `*${fallback}*`;
    nextStart = start + 1;
    nextEnd = nextStart + fallback.length;
  } else if (command === "underline") {
    insert = `__${fallback}__`;
    nextStart = start + 2;
    nextEnd = nextStart + fallback.length;
  } else if (command === "bullet") {
    insert = (selected || "List item")
      .split("\n")
      .map((line) => line.trim() ? `- ${line.replace(/^[-\d.)\s]+/, "")}` : "- ")
      .join("\n");
    nextStart = start;
    nextEnd = start + insert.length;
  } else if (command === "number") {
    insert = (selected || "List item")
      .split("\n")
      .map((line, index) => `${index + 1}. ${line.replace(/^[-\d.)\s]+/, "") || "List item"}`)
      .join("\n");
    nextStart = start;
    nextEnd = start + insert.length;
  } else if (command === "quote") {
    insert = (selected || "Quote")
      .split("\n")
      .map((line) => `> ${line.replace(/^>\s*/, "") || "Quote"}`)
      .join("\n");
    nextStart = start;
    nextEnd = start + insert.length;
  } else if (command === "link") {
    const url = window.prompt("Paste a link");
    if (!url) return;
    insert = `[${selected || "Link text"}](${url.trim()})`;
    nextStart = start + 1;
    nextEnd = nextStart + (selected || "Link text").length;
  } else if (command === "clear") {
    const source = selected || textarea.value;
    insert = source
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^\s*[-*>]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "");
    if (!selected) {
      replaceTextareaSelection(textarea, insert, 0, insert.length);
      return;
    }
    nextStart = start;
    nextEnd = start + insert.length;
  } else {
    return;
  }

  replaceTextareaSelection(textarea, `${before}${insert}${after}`, nextStart, nextEnd);
}

document.querySelectorAll("[data-editor-command]").forEach((button) => {
  button.addEventListener("click", () => applyWorkspaceEditorCommand(button));
});

function closeWorkspacePostMenus(except = null) {
  document.querySelectorAll(".workspace-post-menu").forEach((menu) => {
    if (menu === except) return;
    menu.hidden = true;
    menu.closest(".admin-feed-head")?.querySelector("[data-workspace-post-menu]")?.setAttribute("aria-expanded", "false");
  });
}

document.querySelectorAll("[data-workspace-post-menu]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = button.closest(".admin-feed-head")?.querySelector(".workspace-post-menu");
    if (!menu) return;
    const willOpen = menu.hidden;
    closeWorkspacePostMenus(menu);
    menu.hidden = !willOpen;
    button.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });
});

document.querySelectorAll("[data-workspace-post-edit]").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".workspace-post-card");
    const menu = button.closest(".workspace-post-menu");
    const form = card?.querySelector(".workspace-post-edit-form");
    if (!form) return;
    menu.hidden = true;
    form.hidden = false;
    form.querySelector("textarea[name='body']")?.focus();
  });
});

document.querySelectorAll("[data-workspace-post-cancel]").forEach((button) => {
  button.addEventListener("click", () => {
    const form = button.closest(".workspace-post-edit-form");
    if (form) form.hidden = true;
  });
});

document.querySelectorAll("[data-workspace-comment-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".workspace-post-card");
    const form = card?.querySelector(".workspace-comment-form");
    if (!form) return;
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector("input[name='body']")?.focus();
  });
});

async function submitWorkspaceForm(form, extra = {}) {
  const data = new FormData(form);
  Object.entries(extra).forEach(([key, value]) => data.set(key, value));
  const body = new URLSearchParams(data);
  const response = await fetch(form.action, {
    method: "POST",
    body,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "X-Requested-With": "fetch",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Workspace update failed.");
  }
  return payload;
}

function ensureWorkspacePostId(form) {
  const postInput = form?.querySelector("input[name='post_id']");
  const card = form?.closest(".workspace-post-card");
  const formPostId = Number(postInput?.value || 0);
  const cardPostId = Number(card?.dataset.workspacePostId || 0);
  const postId = Number.isFinite(formPostId) && formPostId > 0 ? formPostId : cardPostId;
  if (postInput instanceof HTMLInputElement && Number.isFinite(postId) && postId > 0) {
    postInput.value = String(postId);
  }
  return Number.isFinite(postId) && postId > 0 ? postId : 0;
}

document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  const reactionButton = target?.closest(".workspace-reaction-tray button");
  if (!reactionButton) return;
  const form = reactionButton.closest("[data-workspace-reaction-form]");
  const card = reactionButton.closest(".workspace-post-card");
  if (!form || !card) return;
  event.preventDefault();
  if (!ensureWorkspacePostId(form)) {
    window.alert("Missing post.");
    return;
  }
  const reaction = reactionButton.value || "LIKE";
  const reactionValue = form.querySelector("[data-workspace-reaction-value]");
  if (reactionValue instanceof HTMLInputElement) reactionValue.value = reaction;
  try {
    const payload = await submitWorkspaceForm(form, { reaction });
    card.querySelector("[data-workspace-reaction-count]").textContent = payload.reaction_summary || `${payload.reaction_count || 0} reactions`;
    card.querySelector("[data-workspace-reaction-emoji]").textContent = payload.emoji || "👍";
    card.querySelector("[data-workspace-reaction-label]").textContent = payload.label || "Like";
    if (reactionValue instanceof HTMLInputElement) reactionValue.value = payload.reaction || "LIKE";
  } catch (error) {
    window.alert(error.message);
  }
});

document.addEventListener("submit", async (event) => {
  const reactionForm = event.target.closest("[data-workspace-reaction-form]");
  if (!reactionForm) return;
  event.preventDefault();
  if (!ensureWorkspacePostId(reactionForm)) {
    window.alert("Missing post.");
    return;
  }
  const card = reactionForm.closest(".workspace-post-card");
  try {
    const payload = await submitWorkspaceForm(reactionForm);
    const count = card?.querySelector("[data-workspace-reaction-count]");
    const emoji = card?.querySelector("[data-workspace-reaction-emoji]");
    const label = card?.querySelector("[data-workspace-reaction-label]");
    const reactionValue = reactionForm.querySelector("[data-workspace-reaction-value]");
    count?.replaceChildren(document.createTextNode(payload.reaction_summary || `${payload.reaction_count || 0} reactions`));
    emoji?.replaceChildren(document.createTextNode(payload.emoji || "👍"));
    label?.replaceChildren(document.createTextNode(payload.label || "Like"));
    if (reactionValue instanceof HTMLInputElement) reactionValue.value = payload.reaction || "LIKE";
  } catch (error) {
    window.alert(error.message);
  }
});

document.addEventListener("submit", async (event) => {
  const commentForm = event.target.closest(".workspace-comment-form");
  if (!commentForm) return;
  event.preventDefault();
  const card = commentForm.closest(".workspace-post-card");
  try {
    const payload = await submitWorkspaceForm(commentForm);
    const comments = card?.querySelector("[data-workspace-comments]");
    const count = card?.querySelector("[data-workspace-comment-count]");
    if (comments) comments.innerHTML = payload.comments_html || "";
    count?.replaceChildren(document.createTextNode(`${payload.comment_count || 0} comments`));
    commentForm.reset();
    commentForm.hidden = true;
  } catch (error) {
    window.alert(error.message);
  }
});

document.addEventListener("submit", async (event) => {
  const shareForm = event.target.closest("[data-workspace-share-form]");
  if (!shareForm) return;
  event.preventDefault();
  if (!ensureWorkspacePostId(shareForm)) {
    window.alert("Missing post.");
    return;
  }
  const button = shareForm.querySelector("button[type='submit']");
  const originalText = button?.textContent || "Share to Slack";
  if (button instanceof HTMLButtonElement) {
    button.disabled = true;
    button.textContent = "Sharing...";
  }
  try {
    const payload = await submitWorkspaceForm(shareForm);
    if (button instanceof HTMLButtonElement) {
      button.textContent = payload.message ? "Shared" : "Shared";
      window.setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1400);
    }
  } catch (error) {
    if (button instanceof HTMLButtonElement) {
      button.textContent = originalText;
      button.disabled = false;
    }
    window.alert(error.message);
  }
});

document.addEventListener("click", () => closeWorkspacePostMenus());

const workspaceGroupsDrawer = document.getElementById("workspaceGroupsDrawer");
const workspaceGroupsOpen = document.querySelector("[data-workspace-groups-open]");
const workspaceGroupsClose = document.querySelector("[data-workspace-groups-close]");

function setWorkspaceGroupsOpen(open) {
  if (!workspaceGroupsDrawer) return;
  workspaceGroupsDrawer.hidden = !open;
  workspaceGroupsOpen?.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) workspaceGroupsDrawer.querySelector("[data-workspace-group-search]")?.focus();
}

workspaceGroupsOpen?.addEventListener("click", () => setWorkspaceGroupsOpen(workspaceGroupsDrawer?.hidden));
workspaceGroupsClose?.addEventListener("click", () => setWorkspaceGroupsOpen(false));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && workspaceGroupsDrawer && !workspaceGroupsDrawer.hidden) {
    setWorkspaceGroupsOpen(false);
  }
});

document.querySelectorAll("[data-workspace-group-search]").forEach((input) => {
  input.addEventListener("input", () => {
    const query = String(input.value || "").trim().toLowerCase();
    const panel = input.closest(".workspace-group-panel") || input.closest(".workspace-groups-drawer");
    panel?.querySelectorAll("[data-workspace-group-item]").forEach((item) => {
      const name = String(item.dataset.groupName || item.textContent || "").toLowerCase();
      item.hidden = Boolean(query && !name.includes(query));
    });
  });
});

document.querySelectorAll("[data-workspace-post-image]").forEach((input) => {
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    const form = input.closest(".workspace-post-form");
    const target = form?.querySelector("[data-workspace-post-image-data]");
    const preview = form?.querySelector("[data-workspace-post-preview]");
    const label = form?.querySelector("[data-workspace-post-file-label]");
    if (!file || !target || !file.type.startsWith("image/")) return;
    if (label) label.textContent = file.name || "Photo attached";
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("load", () => {
        const maxSize = 1200;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context?.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
        target.value = dataUrl;
        if (preview instanceof HTMLImageElement) {
          preview.src = dataUrl;
          preview.hidden = false;
        }
      });
      image.src = String(reader.result || "");
    });
    reader.readAsDataURL(file);
  });
});

function updateWorkspaceProfileAvatars(src) {
  document.querySelectorAll("[data-admin-profile-avatar]").forEach((avatar) => {
    avatar.style.backgroundImage = `url("${src}")`;
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundPosition = "center";
    avatar.querySelectorAll("span").forEach((span) => {
      span.textContent = "";
    });
    if (!avatar.querySelector("span")) {
      avatar.textContent = "";
    }
  });
}

function imageFileToDataUrl(file, maxSize = 900, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", reject);
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("error", reject);
      image.addEventListener("load", () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context?.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      });
      image.src = String(reader.result || "");
    });
    reader.readAsDataURL(file);
  });
}

document.querySelectorAll("[data-admin-profile-photo]").forEach((input) => {
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const src = await imageFileToDataUrl(file);
      updateWorkspaceProfileAvatars(src);
      const response = await fetch("/profile/photo", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ photo: src }),
      });
      const payload = await response.json();
      if (payload?.ok && payload.photo) {
        updateWorkspaceProfileAvatars(String(payload.photo));
      }
    } catch {
      // Keep the current avatar if upload fails.
    }
  });
});

const bookingCalendarModal = document.getElementById("bookingCalendarModal");

function closeBookingCalendarModal() {
  if (!bookingCalendarModal) return;
  bookingCalendarModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function openBookingCalendarModal(button) {
  if (!bookingCalendarModal || !button) return;
  const fieldMap = {
    booking: button.dataset.booking,
    status: button.dataset.status,
    vehicle: button.dataset.vehicle,
    customer: button.dataset.customer,
    email: button.dataset.email,
    phone: button.dataset.phone,
    pickup: button.dataset.pickup,
    return: button.dataset.return,
    total: button.dataset.total,
    location: button.dataset.location,
  };
  Object.entries(fieldMap).forEach(([key, value]) => {
    const target = bookingCalendarModal.querySelector(`[data-booking-modal-field="${key}"]`);
    if (target) target.textContent = value || "";
  });
  const image = bookingCalendarModal.querySelector("[data-booking-modal-image]");
  if (image) {
    if (button.dataset.image) {
      image.src = button.dataset.image;
      image.alt = button.dataset.vehicle || "Booked vehicle";
      image.hidden = false;
    } else {
      image.removeAttribute("src");
      image.hidden = true;
    }
  }
  bookingCalendarModal.hidden = false;
  document.body.classList.add("modal-open");
}

document.querySelectorAll("[data-booking-calendar-open]").forEach((button) => {
  button.addEventListener("click", () => openBookingCalendarModal(button));
});

bookingCalendarModal?.querySelectorAll("[data-booking-calendar-close]").forEach((button) => {
  button.addEventListener("click", closeBookingCalendarModal);
});

bookingCalendarModal?.addEventListener("click", (event) => {
  if (event.target === bookingCalendarModal) closeBookingCalendarModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && bookingCalendarModal && !bookingCalendarModal.hidden) {
    closeBookingCalendarModal();
  }
});

const carList = document.getElementById("carList");
const sortCars = document.getElementById("sortCars");
const resultCount = document.getElementById("resultCount");
const typeFilters = [...document.querySelectorAll(".type-filter")];
const fuelFilters = [...document.querySelectorAll(".fuel-filter")];
const clearFilters = document.getElementById("clearFilters");
const resetCarFilters = document.getElementById("resetCarFilters");
const noCarResults = document.getElementById("noCarResults");
const searchForm = document.getElementById("searchForm");
const locationSelect = document.getElementById("location");
const discountCode = document.getElementById("discountCode");
const discountMessage = document.getElementById("discountMessage");
const pickupDate = document.getElementById("pickupDate");
const returnDate = document.getElementById("returnDate");
const pickupTime = document.getElementById("pickupTime");
const returnTime = document.getElementById("returnTime");
const rentalLengthLabel = document.getElementById("rentalLengthLabel");
const quoteMatchLabel = document.getElementById("quoteMatchLabel");
const filterToggle = document.getElementById("filterToggle");
const filterOptions = document.getElementById("filterOptions");
const mobileQuery = window.matchMedia("(max-width: 760px)");
const discountDataNode = document.getElementById("discountData");

function todayInputDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function clampRentalDateInputs() {
  if (!pickupDate || !returnDate) return;
  const today = todayInputDate();
  pickupDate.min = today;
  returnDate.min = pickupDate.value && pickupDate.value > today ? pickupDate.value : today;
  if (pickupDate.value && pickupDate.value < today) {
    pickupDate.value = today;
  }
  if (returnDate.value && pickupDate.value && returnDate.value <= pickupDate.value) {
    const next = new Date(`${pickupDate.value}T00:00:00`);
    next.setDate(next.getDate() + 1);
    returnDate.value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  }
}

function parseJsonData(node, fallback = []) {
  if (!node) return fallback;
  try {
    return JSON.parse(node.textContent || "[]");
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.innerHTML = node.textContent || "[]";
      return JSON.parse(textarea.value);
    } catch {
      return fallback;
    }
  }
}

const activeDiscounts = parseJsonData(discountDataNode);
const guestOfferModal = document.getElementById("guestOfferModal");
const bookingReferralModal = document.getElementById("bookingReferralModal");
const referralClaimModal = document.getElementById("referralClaimModal");

const explorerForm = document.getElementById("explorerForm");
const moodGrid = document.getElementById("moodGrid");
const explorerMoodHelper = document.getElementById("explorerMoodHelper");
const questOutput = document.getElementById("questOutput");
const questTitle = document.getElementById("questTitle");
const questMeta = document.getElementById("questMeta");
const questMap = document.getElementById("questMap");
const questRouteDetails = document.getElementById("questRouteDetails");
const questStops = document.getElementById("questStops");
const questComplete = document.getElementById("questComplete");
const explorerXp = document.getElementById("explorerXp");
const explorerLevel = document.getElementById("explorerLevel");
const explorerBadges = document.getElementById("explorerBadges");
const detectExplorerLocation = document.getElementById("detectExplorerLocation");
const setExplorerCity = document.getElementById("setExplorerCity");
const explorerCity = document.getElementById("explorerCity");
const explorerCityLat = document.getElementById("explorerCityLat");
const explorerCityLng = document.getElementById("explorerCityLng");
const explorerLocationStatus = document.getElementById("explorerLocationStatus");
const explorerBonusCard = document.getElementById("explorerBonusCard");
const explorerXpMeter = document.getElementById("explorerXpMeter");
const explorerXpProgressLabel = document.getElementById("explorerXpProgressLabel");
const questDescription = document.getElementById("questDescription");
const questDifficulty = document.getElementById("questDifficulty");
const questReward = document.getElementById("questReward");
const questStopCount = document.getElementById("questStopCount");
const questProgressText = document.getElementById("questProgressText");
const questProgressFill = document.getElementById("questProgressFill");
const questBadgeText = document.getElementById("questBadgeText");
const questBoostText = document.getElementById("questBoostText");
const questBoostCard = document.getElementById("questBoostCard");
const questWeatherSummary = document.getElementById("questWeatherSummary");
const explorerCommunity = document.getElementById("explorerCommunity");
const memoryGallery = document.getElementById("memoryGallery");
const passportPrimary = document.getElementById("passportPrimary");
const passportNearby = document.getElementById("passportNearby");
const passportRegional = document.getElementById("passportRegional");
const passportFuture = document.getElementById("passportFuture");
const explorerMemoryRailButton = document.getElementById("explorerMemoryRailButton");
const explorerMemoryDrawer = document.getElementById("explorerMemoryDrawer");
const explorerMemoryDrawerClose = document.getElementById("explorerMemoryDrawerClose");
const explorerMemoryBackdrop = document.getElementById("explorerMemoryBackdrop");
const explorerUserPhoto = document.getElementById("explorerUserPhoto");
const explorerUserPhotoInput = document.getElementById("explorerUserPhotoInput");
const explorerUserPhotoPreview = document.getElementById("explorerUserPhotoPreview");
const serverProfilePhoto = document.body?.dataset.profilePhoto || "";
const explorerCityStep = document.getElementById("explorerCityStep");
const explorerBookingStep = document.getElementById("explorerBookingStep");
const explorerMoodStep = document.getElementById("explorerMoodStep");
const explorerPrefsStep = document.getElementById("explorerPrefsStep");
const explorerCitySummary = document.getElementById("explorerCitySummary");
const explorerBookingSummary = document.getElementById("explorerBookingSummary");
const explorerMoodSummary = document.getElementById("explorerMoodSummary");
const changeExplorerCityStep = document.getElementById("changeExplorerCityStep");
const changeExplorerBookingStep = document.getElementById("changeExplorerBookingStep");
const explorerBookingChoice = document.getElementById("explorerBookingChoice");
const explorerSocialGrid = document.getElementById("explorerSocialGrid");
let currentExplorerQuest = null;
let explorerDirectionsRenderer = null;
const EXPLORER_PHOTO_STORAGE_KEY = "fairfaresExplorerProfilePhoto";

function syncStoredProfilePhotoToNav(src = savedExplorerUserPhoto()) {
  if (!src) return;
  document.querySelectorAll(".user-chip span").forEach((avatar) => {
    avatar.style.setProperty("background-image", `url("${src}")`, "important");
    avatar.style.setProperty("background-size", "cover", "important");
    avatar.style.setProperty("background-position", "center", "important");
  });
}

function setExplorerUserPhoto(src) {
  syncStoredProfilePhotoToNav(src);
  if (!explorerUserPhoto || !explorerUserPhotoPreview) return;
  if (src) {
    explorerUserPhotoPreview.src = src;
    explorerUserPhotoPreview.hidden = false;
    explorerUserPhoto.classList.add("has-photo");
    explorerUserPhoto.classList.remove("has-empty-photo");
    const hint = explorerUserPhoto.querySelector("em");
    if (hint) hint.textContent = "Change photo";
  } else {
    explorerUserPhotoPreview.removeAttribute("src");
    explorerUserPhotoPreview.hidden = true;
    explorerUserPhoto.classList.remove("has-photo");
    explorerUserPhoto.classList.add("has-empty-photo");
    const hint = explorerUserPhoto.querySelector("em");
    if (hint) hint.textContent = "Upload your photo";
  }
}

function savedExplorerUserPhoto() {
  try {
    return window.localStorage?.getItem(EXPLORER_PHOTO_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

setExplorerUserPhoto(serverProfilePhoto || savedExplorerUserPhoto());

explorerUserPhoto?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  explorerUserPhotoInput?.click();
});

explorerUserPhotoInput?.addEventListener("change", () => {
  const file = explorerUserPhotoInput.files?.[0];
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    const src = String(reader.result || "");
    setExplorerUserPhoto(src);
    try {
      window.localStorage?.setItem(EXPLORER_PHOTO_STORAGE_KEY, src);
      syncStoredProfilePhotoToNav(src);
    } catch {
      // Large local photos may exceed storage; preview still works for this session.
    }
    try {
      const response = await fetch("/profile/photo", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ photo: src }),
      });
      const payload = await response.json();
      if (payload?.ok && payload.photo) {
        setExplorerUserPhoto(String(payload.photo));
      }
    } catch {
      // Guests still get a local preview; signed-in users get persistence when the network call succeeds.
    }
  });
  reader.readAsDataURL(file);
});

syncStoredProfilePhotoToNav();

function setExplorerMemoryDrawer(open) {
  if (!explorerMemoryDrawer || !explorerMemoryRailButton) return;
  explorerMemoryDrawer.classList.toggle("is-open", open);
  explorerMemoryDrawer.setAttribute("aria-hidden", open ? "false" : "true");
  explorerMemoryRailButton.setAttribute("aria-expanded", open ? "true" : "false");
  document.body.classList.toggle("memory-drawer-open", open);
  if (explorerMemoryBackdrop) explorerMemoryBackdrop.hidden = !open;
}

explorerMemoryRailButton?.addEventListener("click", () => {
  const isOpen = explorerMemoryDrawer?.classList.contains("is-open") || false;
  setExplorerMemoryDrawer(!isOpen);
});

explorerMemoryDrawerClose?.addEventListener("click", () => setExplorerMemoryDrawer(false));
explorerMemoryBackdrop?.addEventListener("click", () => setExplorerMemoryDrawer(false));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && explorerMemoryDrawer?.classList.contains("is-open")) {
    setExplorerMemoryDrawer(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setExplorerMemoryDrawer(false);
});

function showGuestOfferModal(nextHref = "") {
  if (!guestOfferModal) return false;
  hideSiteLoader();
  guestOfferModal.dataset.nextHref = nextHref;
  guestOfferModal.hidden = false;
  document.body.classList.add("modal-open");
  guestOfferModal.querySelector("[data-offer-apply]")?.focus();
  return true;
}

function closeGuestOfferModal(continueToNext = false) {
  if (!guestOfferModal) return;
  const nextHref = guestOfferModal.dataset.nextHref || "";
  guestOfferModal.hidden = true;
  document.body.classList.remove("modal-open");
  guestOfferModal.dataset.nextHref = "";
  if (continueToNext && nextHref) {
    window.location.href = nextHref;
  }
}

guestOfferModal?.querySelector("[data-offer-apply]")?.addEventListener("click", () => {
  if (discountCode) {
    discountCode.value = "REFER_DUDE143";
    discountCode.dispatchEvent(new Event("input", { bubbles: true }));
    discountCode.dispatchEvent(new Event("change", { bubbles: true }));
    discountMessage.textContent = "Referral deal loaded. Use this code when you search.";
    const nextHref = guestOfferModal.dataset.nextHref || "";
    if (nextHref) {
      const url = new URL(nextHref, window.location.origin);
      url.searchParams.set("discount_code", "REFER_DUDE143");
      guestOfferModal.dataset.nextHref = `${url.pathname}${url.search}`;
      closeGuestOfferModal(true);
      return;
    }
    closeGuestOfferModal(false);
    return;
  }
  closeGuestOfferModal(true);
});

guestOfferModal?.querySelector("[data-offer-decline]")?.addEventListener("click", () => {
  closeGuestOfferModal(true);
});

guestOfferModal?.querySelector("[data-offer-close]")?.addEventListener("click", () => {
  closeGuestOfferModal(false);
});

guestOfferModal?.addEventListener("click", (event) => {
  if (event.target === guestOfferModal) closeGuestOfferModal(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && guestOfferModal && !guestOfferModal.hidden) {
    closeGuestOfferModal(false);
  }
  if (event.key === "Escape" && bookingReferralModal && !bookingReferralModal.hidden) {
    closeBookingReferralModal();
  }
  if (event.key === "Escape" && referralClaimModal && !referralClaimModal.hidden) {
    closeReferralClaimModal();
  }
});

function moneyRange(low, high) {
  return `$${Math.round(low)}-${Math.round(high)}`;
}

function durationRateTier(days) {
  if (days >= 30) return { rate: 0.25, label: "Monthly rate" };
  if (days >= 7) return { rate: 0.12, label: "Weekly rate" };
  return { rate: 0, label: "Standard rate" };
}

function getRentalDays() {
  if (!pickupDate?.value || !returnDate?.value) return 10;
  const pickup = new Date(`${pickupDate.value}T00:00:00`);
  const dropoff = new Date(`${returnDate.value}T00:00:00`);
  const diff = Math.ceil((dropoff - pickup) / 86400000);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

function timeTo24(timeText) {
  const match = String(timeText || "10:00 AM").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return "10:00";
  let hours = Number(match[1]);
  const minutes = match[2];
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

function parseCardAvailabilityDate(dateText, timeText) {
  if (!dateText) return null;
  const parsed = new Date(`${dateText} ${timeText || "10:00 AM"}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function selectedPickupDateTime() {
  if (!pickupDate?.value) return null;
  const parsed = new Date(`${pickupDate.value}T${timeTo24(pickupTime?.value)}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sameCalendarDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function rentalLengthText(days) {
  if (days >= 30) {
    const months = days / 30;
    const rounded = Number.isInteger(months) ? String(months) : months.toFixed(1);
    return `${days} days · about ${rounded} months`;
  }
  return `${days} days`;
}

function updateRentalRanges() {
  clampRentalDateInputs();
  const days = getRentalDays();
  const durationTier = durationRateTier(days);
  if (rentalLengthLabel) rentalLengthLabel.textContent = days > 0 ? rentalLengthText(days) : "Choose valid dates";
  if (quoteMatchLabel) {
    if (durationTier.rate > 0) {
      quoteMatchLabel.textContent = `${durationTier.label} selected. Each car shows estimated savings versus standard daily pricing.`;
    } else {
      quoteMatchLabel.textContent = "Found a lower comparable price for rental cars in Denver or Colorado? FairFares will match it and add 10% off after review.";
    }
  }
  document.querySelectorAll(".car-card").forEach((card) => {
    const daily = Number(card.dataset.price || 0);
    const effectiveDaily = daily * (1 - durationTier.rate);
    const average = Math.round(effectiveDaily);
    const serverLow = Number(card.dataset.priceLow || 0);
    const serverHigh = Number(card.dataset.priceHigh || 0);
    const fallbackLow = Math.max(25, average - 5);
    const fallbackHigh = Math.max(fallbackLow, average + 5);
    const dailyLow = serverLow > 0 ? Math.max(25, Math.round(serverLow * (1 - durationTier.rate))) : fallbackLow;
    const dailyHigh = serverHigh > 0 ? Math.max(dailyLow, Math.round(serverHigh * (1 - durationTier.rate))) : fallbackHigh;
    const dailyTarget = card.querySelector("[data-price-range]");
    if (dailyTarget) dailyTarget.textContent = moneyRange(dailyLow, dailyHigh);
    const durationNote = card.querySelector("[data-duration-savings-note]");
    if (durationNote) {
      if (durationTier.rate > 0 && days > 0) {
        const savings = daily * days * durationTier.rate;
        durationNote.textContent = `${durationTier.label}: save about $${savings.toFixed(2)} vs daily pricing.`;
      } else {
        durationNote.textContent = "Standard daily rate";
      }
    }
  });
}

function updateCars() {
  if (!carList) return;
  const selectedTypes = typeFilters.filter((input) => input.checked).map((input) => input.value);
  const selectedFuel = fuelFilters.filter((input) => input.checked).map((input) => input.value);
  const selectedLocation = locationSelect?.value || "";
  const selectedPickup = selectedPickupDateTime();
  const cards = [...carList.querySelectorAll(".car-card")];

  cards.forEach((card) => {
    const typeMatch = selectedTypes.length === 0 || selectedTypes.includes(card.dataset.category);
    const fuelMatch = selectedFuel.length === 0 || selectedFuel.includes(card.dataset.fuel);
    const cardLocations = cardLocationValues(card);
    const selectedLocationKey = normalizeLocationKey(selectedLocation);
    const locationMatch = !selectedLocationKey || cardLocations.some((location) => normalizeLocationKey(location) === selectedLocationKey);
    const availableAfter = parseCardAvailabilityDate(card.dataset.bookedUntilDate, card.dataset.bookedUntilTime);
    const availabilityNote = card.querySelector("[data-availability-note]");
    const selectButton = card.querySelector(".select-button");
    let availabilityMatch = true;
    if (availabilityNote) availabilityNote.textContent = "";
    card.classList.remove("is-available-after");
    if (selectButton) selectButton.textContent = "Select";
    if (selectedPickup && availableAfter && selectedPickup < availableAfter) {
      if (sameCalendarDay(selectedPickup, availableAfter)) {
        card.classList.add("is-available-after");
        if (availabilityNote) availabilityNote.textContent = `Available after ${card.dataset.bookedUntilTime}`;
        if (selectButton) selectButton.textContent = `Select after ${card.dataset.bookedUntilTime}`;
      } else {
        availabilityMatch = false;
      }
    }
    const visible = typeMatch && fuelMatch && locationMatch && availabilityMatch;
    card.hidden = !visible;
  });

  cards
    .sort((a, b) => {
      const delta = Number(a.dataset.price) - Number(b.dataset.price);
      return sortCars?.value === "high" ? -delta : delta;
    })
    .forEach((card) => carList.appendChild(card));

  const visibleCount = cards.filter((card) => !card.hidden).length;
  if (resultCount) resultCount.textContent = visibleCount || "0";
  if (noCarResults) {
    noCarResults.classList.toggle("is-hidden", visibleCount > 0);
    const message = noCarResults.querySelector("span");
    if (message) {
      message.textContent = cards.length
        ? "Clear filters or choose All available locations to see the full feed."
        : "No cars are currently available in inventory. Please check back soon or contact support.";
    }
  }
}

function cardLocationValues(card) {
  return (card?.dataset.locations || card?.dataset.location || "")
    .split("|")
    .map((location) => location.trim())
    .filter(Boolean);
}

function normalizeLocationKey(location) {
  return String(location || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function selectedOrCardLocation(card) {
  return locationSelect?.value || cardLocationValues(card)[0] || "";
}

typeFilters.forEach((input) => input.addEventListener("change", updateCars));
fuelFilters.forEach((input) => input.addEventListener("change", updateCars));
locationSelect?.addEventListener("change", updateCars);
sortCars?.addEventListener("change", updateCars);
pickupDate?.addEventListener("change", updateRentalRanges);
returnDate?.addEventListener("change", updateRentalRanges);
pickupDate?.addEventListener("change", updateCars);
pickupTime?.addEventListener("change", updateCars);
returnDate?.addEventListener("change", updateCars);
returnTime?.addEventListener("change", updateCars);
clampRentalDateInputs();

function clearCarFilters() {
  typeFilters.forEach((input) => {
    input.checked = false;
  });
  fuelFilters.forEach((input) => {
    input.checked = false;
  });
  if (locationSelect) locationSelect.value = "";
  updateCars();
}

clearFilters?.addEventListener("click", clearCarFilters);
resetCarFilters?.addEventListener("click", clearCarFilters);

function validateDiscount() {
  if (!discountCode || !discountMessage) return;
  const code = discountCode.value.trim().toUpperCase();
  if (!code) {
    discountMessage.textContent = "";
    discountMessage.classList.remove("is-error");
    return;
  }
  const discount = activeDiscounts.find((item) => item.code.toUpperCase() === code);
  if (!discount) {
    discountMessage.textContent = "Discount code not found.";
    discountMessage.classList.add("is-error");
    return;
  }
  const expires = new Date(`${discount.validThrough}T23:59:59`);
  if (Number.isNaN(expires.getTime()) || expires < new Date()) {
    discountMessage.textContent = "Discount code expired.";
    discountMessage.classList.add("is-error");
    return;
  }
  if (Number(discount.maxUses || 0) > 0 && Number(discount.usedCount || 0) >= Number(discount.maxUses)) {
    discountMessage.textContent = "Discount code referral limit reached.";
    discountMessage.classList.add("is-error");
    return;
  }
  discountMessage.textContent = discount.type === "PERCENT"
    ? `${discount.value}% discount will apply at booking.`
    : `$${Number(discount.value).toFixed(2)} discount will apply at booking.`;
  discountMessage.classList.remove("is-error");
}

discountCode?.addEventListener("input", validateDiscount);

document.querySelectorAll(".select-button[href^='/manage-booking?car_id=']").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (getRentalDays() <= 0) {
      if (discountMessage) {
        discountMessage.textContent = "Return date and time must be after pickup date and time.";
        discountMessage.classList.add("is-error");
      }
      return;
    }
    const url = new URL(button.getAttribute("href"), window.location.origin);
    const card = button.closest(".car-card");
    const selectedPickup = selectedPickupDateTime();
    const availableAfter = card ? parseCardAvailabilityDate(card.dataset.bookedUntilDate, card.dataset.bookedUntilTime) : null;
    const adjustedPickupTime = selectedPickup && availableAfter && selectedPickup < availableAfter && sameCalendarDay(selectedPickup, availableAfter)
      ? card.dataset.bookedUntilTime
      : pickupTime?.value;
    url.searchParams.set("days", String(getRentalDays()));
    const selectedLocation = selectedOrCardLocation(card);
    if (selectedLocation) url.searchParams.set("pickup_location", selectedLocation);
    if (selectedLocation) url.searchParams.set("return_location", selectedLocation);
    if (pickupDate?.value) url.searchParams.set("pickup_date", pickupDate.value);
    if (returnDate?.value) url.searchParams.set("return_date", returnDate.value);
    if (adjustedPickupTime) url.searchParams.set("pickup_time", adjustedPickupTime);
    if (returnTime?.value) url.searchParams.set("return_time", returnTime.value);
    if (discountCode?.value.trim()) {
      const code = discountCode.value.trim().toUpperCase();
      const discount = activeDiscounts.find((item) => item.code.toUpperCase() === code);
      if (discount && !discountMessage?.classList.contains("is-error")) {
        url.searchParams.set("discount_code", code);
      }
    }
    if (guestOfferModal) {
      showGuestOfferModal(`${url.pathname}${url.search}`);
      return;
    }
    window.location.href = `${url.pathname}${url.search}`;
  });
});

function setFilterOptions(open) {
  if (!filterToggle || !filterOptions) return;
  filterOptions.hidden = !open;
  filterToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function syncFilterOptions() {
  if (!filterToggle || !filterOptions) return;
  setFilterOptions(!mobileQuery.matches);
}

filterToggle?.addEventListener("click", () => {
  setFilterOptions(filterOptions.hidden);
});

mobileQuery.addEventListener?.("change", syncFilterOptions);
syncFilterOptions();

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
});

updateCars();
updateRentalRanges();

const heroFold = document.querySelector("[data-hero-fold]");
const heroFoldTrigger = heroFold?.querySelector(".hero-fold-trigger");
const heroFoldVideo = heroFold?.querySelector("[data-video-src]");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let heroFoldTimer;
let heroFoldRunning = false;
let heroVideoAvailable;

function closeHeroFold() {
  if (!heroFold || !heroFoldVideo) return;
  window.clearTimeout(heroFoldTimer);
  heroFold.classList.remove("is-playing", "is-folding");
  heroFoldRunning = false;
  heroFoldVideo.removeAttribute("src");
}

function previewHeroFold() {
  if (!heroFold || heroFoldRunning || reduceMotion.matches) return;
  heroFoldRunning = true;
  heroFold.classList.add("is-folding");
  heroFoldTimer = window.setTimeout(() => {
    heroFold.classList.add("is-playing");
    heroFold.classList.remove("is-folding");
    heroFoldTimer = window.setTimeout(closeHeroFold, 900);
  }, 260);
}

function ensureHeroVideoSource() {
  if (!heroFoldVideo?.dataset.videoSrc) return Promise.resolve(false);
  if (heroFoldVideo.getAttribute("src")) return Promise.resolve(true);
  if (heroVideoAvailable === false) return Promise.resolve(false);
  heroFoldVideo.setAttribute("src", heroFoldVideo.dataset.videoSrc);
  heroVideoAvailable = true;
  return Promise.resolve(true);
}

function startHeroFoldPlayback() {
  heroFoldRunning = true;
  heroFold.classList.add("is-folding");
  heroFoldTimer = window.setTimeout(() => {
    heroFold.classList.add("is-playing");
    heroFold.classList.remove("is-folding");
    const isLive = heroFoldVideo.dataset.live === "1";
    if (!isLive) {
      const duration = Number(heroFoldVideo.dataset.duration || 12);
      heroFoldTimer = window.setTimeout(closeHeroFold, Math.max(duration, 6) * 1000);
    }
  }, 260);
}

function playHeroFold(options = {}) {
  if (!heroFold || !heroFoldVideo || heroFoldRunning || reduceMotion.matches) return;
  ensureHeroVideoSource().then((available) => {
    if (available) {
      startHeroFoldPlayback();
    } else if (options.previewWhenMissing) {
      previewHeroFold();
    }
  });
}

heroFoldTrigger?.addEventListener("click", () => playHeroFold({ previewWhenMissing: true }));
heroFoldVideo?.addEventListener("error", () => {
  heroVideoAvailable = false;
  if (heroFoldRunning) heroFoldTimer = window.setTimeout(closeHeroFold, 1200);
});

if (heroFold && !reduceMotion.matches) {
  window.setTimeout(playHeroFold, 1200);
}

const mainNav = document.querySelector(".main-nav");
const menuButton = document.querySelector(".menu-button");
const mobileMenu = document.createElement("div");

if (mainNav && menuButton) {
  mobileMenu.className = "mobile-menu";
  mobileMenu.hidden = true;

  const seenMobileItems = new Set();
  const hiddenNavItems = [
    ...document.querySelectorAll(".nav-links a"),
    ...document.querySelectorAll(".nav-actions > a:not(.user-chip)"),
  ].filter((item) => {
    const href = item.getAttribute("href") || "";
    const label = item.textContent.trim().replace(/\s+/g, " ");
    const key = `${href}|${label}`;
    if (!href || href === "/wiki" || seenMobileItems.has(key)) return false;
    seenMobileItems.add(key);
    return true;
  });

  hiddenNavItems.forEach((item) => {
    const clone = item.cloneNode(true);
    clone.classList.remove("active");
    mobileMenu.appendChild(clone);
  });

  mainNav.appendChild(mobileMenu);
  menuButton.setAttribute("aria-expanded", "false");

  menuButton.addEventListener("click", () => {
    const isOpen = !mobileMenu.hidden;
    mobileMenu.hidden = isOpen;
    menuButton.setAttribute("aria-expanded", isOpen ? "false" : "true");
  });

  mobileMenu.addEventListener("click", (event) => {
    if (!event.target.closest("a")) return;
    mobileMenu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  });
}

const manageTabs = [...document.querySelectorAll("[data-manage-tab]")];
const managePanels = [...document.querySelectorAll("[data-manage-panel]")];
const tripActions = document.querySelector(".trip-actions");
let tripActionScrollTimer;

function centerActiveTripAction(panelName) {
  const activeAction = tripActions?.querySelector(`[data-manage-tab="${panelName}"]`);
  if (!activeAction) return;
  activeAction.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

function showManagePanel(panelName, options = {}) {
  const { centerAction = true } = options;
  manageTabs.forEach((tab) => {
    const active = tab.dataset.manageTab === panelName;
    tab.classList.toggle("active", active);
    tab.classList.toggle("side-active", active && tab.closest(".manage-sidebar"));
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  managePanels.forEach((panel) => {
    const visible = panel.dataset.managePanel === panelName;
    panel.classList.toggle("is-hidden", !visible);
    panel.classList.toggle("active", visible);
  });
  if (centerAction) centerActiveTripAction(panelName);
}

function selectCenteredTripAction() {
  if (!tripActions) return;
  const actionButtons = [...tripActions.querySelectorAll("[data-manage-tab]")];
  const stripCenter = tripActions.getBoundingClientRect().left + tripActions.clientWidth / 2;
  const centeredAction = actionButtons.reduce((closest, action) => {
    const box = action.getBoundingClientRect();
    const distance = Math.abs(box.left + box.width / 2 - stripCenter);
    return !closest || distance < closest.distance ? { action, distance } : closest;
  }, null)?.action;

  if (centeredAction && !centeredAction.classList.contains("active")) {
    showManagePanel(centeredAction.dataset.manageTab, { centerAction: false });
  }
}

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-manage-tab]");
  if (!tab) return;
  event.preventDefault();
  showManagePanel(tab.dataset.manageTab);
  if (tab.dataset.detailJump) {
    showDetailPanel(tab.dataset.detailJump);
  }
});

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-support-escalate]");
  if (!link) return;
  if (link.dataset.manageTab !== "support") return;
  if (supportTopic) supportTopic.value = "Emergency roadside help";
  if (urgentSupport) urgentSupport.checked = true;
  const message = document.getElementById("supportMessage");
  if (message && !message.value.trim()) {
    message.value = "Accident or roadside issue. Please include location, photos, police report number if available, other driver information, and what happened.";
  }
  syncSupportTopic();
  if (supportStatus) supportStatus.textContent = "Urgent roadside support selected. Add details, then create the ticket.";
});

if (manageTabs.length) {
  showManagePanel(manageTabs.find((tab) => tab.classList.contains("active"))?.dataset.manageTab || "modify");
}

tripActions?.addEventListener("scroll", () => {
  window.clearTimeout(tripActionScrollTimer);
  tripActionScrollTimer = window.setTimeout(selectCenteredTripAction, 90);
});

const modifyForm = document.getElementById("modifyForm");
const addDriverToggle = document.getElementById("addDriverToggle");
const driverFields = [...document.querySelectorAll(".driver-fields input, .driver-fields select")];
const driverFieldGroup = document.querySelector(".driver-fields");
const vehicleSelect = document.getElementById("vehicleSelect");
const summaryVehicle = document.getElementById("summaryVehicle");
const summaryPrice = document.getElementById("summaryPrice");
const summaryPickup = document.getElementById("summaryPickup");
const summaryReturn = document.getElementById("summaryReturn");
const modifyStatus = document.getElementById("modifyStatus");

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function updateModifySummary() {
  if (!modifyForm) return;
  const vehicle = modifyForm.querySelector('input[name="vehicle"]:checked');
  const pickup = document.getElementById("modifyPickupLocation")?.value || "";
  const returnDate = document.getElementById("modifyReturnDate")?.value || "";
  const returnTime = document.getElementById("modifyReturnTime")?.value || "";
  const selectedVehicle = vehicleSelect?.value || vehicle?.value || "";
  summaryVehicle.textContent = selectedVehicle || "No vehicle change";
  summaryPrice.textContent = selectedVehicle
    ? (vehicle?.closest("label")?.querySelector("strong")?.textContent || "Estimated range")
    : (summaryPrice.dataset.currentPrice || "Current booking total");
  summaryPickup.textContent = pickup;
  summaryReturn.textContent = `${formatDate(returnDate)} | ${returnTime}`;
}

vehicleSelect?.addEventListener("change", () => {
  const matchingVehicle = [...(modifyForm?.querySelectorAll('input[name="vehicle"]') || [])]
    .find((vehicle) => vehicle.value === vehicleSelect.value);
  if (matchingVehicle) matchingVehicle.checked = true;
  modifyStatus.textContent = "";
  updateModifySummary();
});

modifyForm?.querySelectorAll('input[name="vehicle"]').forEach((vehicle) => {
  vehicle.addEventListener("change", () => {
    if (vehicle.checked && vehicleSelect) vehicleSelect.value = vehicle.value;
  });
});

addDriverToggle?.addEventListener("change", () => {
  const enabled = addDriverToggle.checked;
  driverFields.forEach((field) => {
    field.disabled = !enabled;
  });
  driverFieldGroup?.classList.toggle("is-disabled", !enabled);
});

modifyForm?.addEventListener("input", () => {
  modifyStatus.textContent = "";
  updateModifySummary();
});

modifyForm?.addEventListener("change", () => {
  modifyStatus.textContent = "";
  updateModifySummary();
});

modifyForm?.addEventListener("reset", () => {
  window.setTimeout(() => {
    addDriverToggle.checked = false;
    driverFields.forEach((field) => {
      field.disabled = true;
    });
    driverFieldGroup?.classList.add("is-disabled");
    modifyStatus.textContent = "";
    updateModifySummary();
  }, 0);
});

modifyForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  updateModifySummary();
  fetch("/bookings/modify", {
    method: "POST",
    body: new URLSearchParams(new FormData(modifyForm)),
  })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
    .then((payload) => {
      modifyStatus.textContent = payload.message || "Reservation changes saved for review.";
      if (bookingStatusBadge) {
        bookingStatusBadge.textContent = payload.status_label || "Modification sent to admin";
        bookingStatusBadge.className = `status-badge ${payload.status_class || "status-confirmed"}`;
      }
    })
    .catch((payload) => {
      modifyStatus.textContent = payload?.message || "Unable to save this modification.";
    });
});

updateModifySummary();

const cancelForm = document.getElementById("cancelForm");
const cancelReason = document.getElementById("cancelReason");
const refundMethod = document.getElementById("refundMethod");
const refundTimeline = document.getElementById("refundTimeline");
const cancelStatus = document.getElementById("cancelStatus");
const bookingStatusBadge = document.getElementById("bookingStatusBadge");

refundMethod?.addEventListener("change", () => {
  refundTimeline.textContent = refundMethod.value.includes("credit")
    ? "Travel credit can be issued after admin approval."
    : (refundTimeline.dataset.defaultNote || "Refund timeline starts after admin approval.");
  cancelStatus.textContent = "";
});

cancelReason?.addEventListener("change", () => {
  cancelStatus.textContent = "";
});

cancelForm?.addEventListener("reset", () => {
  window.setTimeout(() => {
    refundTimeline.textContent = refundTimeline.dataset.defaultNote || "Refund timeline starts after admin approval.";
    cancelStatus.textContent = "";
  }, 0);
});

cancelForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!cancelReason.value) {
    cancelStatus.textContent = "Choose a cancellation reason to continue.";
    return;
  }
  const payload = new URLSearchParams();
  payload.set("reason", cancelReason.value);
  payload.set("note", document.getElementById("cancelNote")?.value || "");
  payload.set("refund_method", refundMethod.value);
  fetch("/bookings/cancel", {
    method: "POST",
    body: payload,
  })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
    .then((data) => {
      cancelStatus.textContent = data.message || `Cancellation request sent to admin. Refund method: ${refundMethod.value}.`;
      if (bookingStatusBadge && data.status_label) {
        bookingStatusBadge.textContent = data.status_label;
        bookingStatusBadge.className = `status-badge ${data.status_class || "status-pending"}`;
      }
    })
    .catch((payload) => {
      cancelStatus.textContent = payload?.message || "Unable to submit this cancellation request.";
    });
});

const documentPreview = document.getElementById("documentPreview");
const documentStatus = document.getElementById("documentStatus");
const documentEmail = document.getElementById("documentEmail");
const bookingDocumentsNode = document.getElementById("bookingDocuments");
const documentTools = document.querySelector(".document-tools");
const documentHistory = document.getElementById("documentHistory");
const bookingDocumentPayload = bookingDocumentsNode ? JSON.parse(bookingDocumentsNode.textContent || "{}") : {};
const legacyDocumentsLocked = bookingDocumentsNode?.dataset.locked === "1" || documentTools?.dataset.documentsLocked === "1";
const bookingDocumentSets = Array.isArray(bookingDocumentPayload.sets)
  ? bookingDocumentPayload.sets
  : [{
    id: "current",
    bookingId: "Current booking",
    vehicle: "Current booking",
    dates: "",
    statusLabel: legacyDocumentsLocked ? "Not picked up" : "Ready",
    locked: legacyDocumentsLocked,
    lockMessage: "Documents can be retrieved once pickup is completed.",
    docs: bookingDocumentPayload || {},
  }];
let activeDocumentSet = bookingDocumentSets.find((set) => String(set.id) === String(bookingDocumentPayload.activeId))
  || bookingDocumentSets[0]
  || { docs: {}, locked: true, lockMessage: "Book a car first, then documents can be retrieved once pickup is completed." };
let activeDocumentName = "Invoice / Receipt";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function activeDocumentsAreLocked() {
  return Boolean(activeDocumentSet?.locked);
}

function syncDocumentLockState() {
  const locked = activeDocumentsAreLocked();
  if (documentTools) {
    documentTools.classList.toggle("documents-locked", locked);
    documentTools.dataset.documentsLocked = locked ? "1" : "0";
  }
  const lockMessage = documentTools?.querySelector(".documents-lock-message");
  if (lockMessage) {
    lockMessage.textContent = activeDocumentSet?.lockMessage || "Documents can be retrieved once pickup is completed.";
  }
}

function renderDocumentHistory() {
  if (!documentHistory) return;
  if (!bookingDocumentSets.length) {
    documentHistory.innerHTML = "";
    return;
  }
  const options = bookingDocumentSets.map((set) => {
    const state = set.locked ? "Locked until pickup" : (set.statusLabel || "Documents ready");
    const selected = String(set.id) === String(activeDocumentSet?.id) ? "selected" : "";
    return `<option value="${escapeHtml(set.id)}" ${selected}>${escapeHtml(set.bookingId || "Booking")} · ${escapeHtml(set.vehicle || "Vehicle")} · ${escapeHtml(set.dates || "")} · ${escapeHtml(state)}</option>`;
  }).join("");
  documentHistory.innerHTML = `
    <label class="document-booking-select">
      <span>Choose booking documents</span>
      <select id="documentBookingSelect">${options}</select>
    </label>
  `;
}

function renderBookingDocument(name) {
  if (!documentPreview) return;
  activeDocumentName = name;
  syncDocumentLockState();
  renderDocumentHistory();
  if (activeDocumentsAreLocked()) {
    if (documentStatus) {
      documentStatus.textContent = `${activeDocumentSet?.bookingId || "This booking"} is locked until pickup is completed.`;
    }
    return;
  }
  const docs = activeDocumentSet?.docs || {};
  const doc = docs[name] || {
    title: name,
    content: "This document is not generated yet. Ask admin to complete pickup, payment, insurance, or agreement data.",
    status: "Waiting for admin data.",
  };
  documentPreview.innerHTML = `<h3>${escapeHtml(doc.title)}</h3><p>${escapeHtml(doc.content).replaceAll("\n", "<br>")}</p><small>${escapeHtml(doc.status)}</small>`;
  if (documentStatus) documentStatus.textContent = `${doc.title} generated for ${activeDocumentSet?.bookingId || "this booking"}.`;
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

document.addEventListener("click", (event) => {
  const docButton = event.target.closest("[data-doc-name]");
  if (!docButton) return;
  const name = docButton.dataset.docName;
  document.querySelectorAll("[data-doc-name]").forEach((button) => {
    button.classList.toggle("active", button === docButton);
  });
  renderBookingDocument(name);
});

documentHistory?.addEventListener("change", (event) => {
  const select = event.target.closest("#documentBookingSelect");
  if (!select) return;
  const nextSet = bookingDocumentSets.find((set) => String(set.id) === String(select.value));
  if (!nextSet) return;
  activeDocumentSet = nextSet;
  renderBookingDocument(activeDocumentName);
});

document.getElementById("emailDocuments")?.addEventListener("click", () => {
  if (activeDocumentsAreLocked()) {
    documentStatus.textContent = activeDocumentSet?.lockMessage || "Documents can be retrieved once pickup is completed.";
    return;
  }
  const payload = new URLSearchParams();
  payload.set("booking_id", activeDocumentSet?.id || "");
  payload.set("email", documentEmail.value || "");
  documentStatus.textContent = `Sending documents for ${activeDocumentSet?.bookingId || "this booking"}...`;
  fetch("/documents/email", {
    method: "POST",
    body: payload,
  })
    .then((response) => response.ok ? response.json() : response.json().then((data) => Promise.reject(data)))
    .then((data) => {
      documentStatus.textContent = data.message || `Documents emailed to ${documentEmail.value || "your email"}.`;
    })
    .catch((data) => {
      documentStatus.textContent = data?.message || "Unable to send documents right now.";
    });
});

document.getElementById("downloadAllDocuments")?.addEventListener("click", () => {
  if (activeDocumentsAreLocked()) {
    documentStatus.textContent = activeDocumentSet?.lockMessage || "Documents can be retrieved once pickup is completed.";
    return;
  }
  const bundle = Object.values(activeDocumentSet?.docs || {})
    .map((doc) => `${doc.title}\n\n${doc.content}\n\n${doc.status}`)
    .join("\n\n------------------------------\n\n");
  if (bundle) downloadTextFile(`fairfares-${activeDocumentSet?.bookingId || "booking"}-documents.txt`, bundle);
  documentStatus.textContent = `Documents for ${activeDocumentSet?.bookingId || "this booking"} are ready to download.`;
});

syncDocumentLockState();
renderDocumentHistory();
renderBookingDocument("Invoice / Receipt");

const detailTabs = [...document.querySelectorAll("[data-detail-tab]")];
const detailPanels = [...document.querySelectorAll("[data-detail-panel]")];

function showDetailPanel(panelName) {
  detailTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.detailTab === panelName);
  });
  detailPanels.forEach((panel) => {
    const visible = panel.dataset.detailPanel === panelName;
    panel.classList.toggle("active", visible);
    panel.classList.toggle("is-hidden", !visible);
  });
}

detailTabs.forEach((tab) => {
  tab.addEventListener("click", () => showDetailPanel(tab.dataset.detailTab));
});

document.getElementById("studentForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  fetch("/student-verification", {
    method: "POST",
    body: new URLSearchParams(new FormData(form)),
  })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
    .then((payload) => {
      document.getElementById("studentStatus").textContent = payload.message || "Student verification details updated.";
      const verifiedBox = document.getElementById("studentVerifiedBox");
      const verifiedLabel = document.getElementById("studentVerifiedLabel");
      const discountLabel = document.getElementById("studentDiscountLabel");
      const verifiedChecks = document.getElementById("studentVerifiedChecks");
      if (verifiedLabel && payload.verified_label) verifiedLabel.textContent = payload.verified_label;
      if (discountLabel && payload.discount_label) discountLabel.textContent = payload.discount_label;
      if (verifiedChecks && payload.checks_html) verifiedChecks.innerHTML = payload.checks_html;
      verifiedBox?.classList.toggle("is-pending", !payload.verified);
    })
    .catch((payload) => {
      document.getElementById("studentStatus").textContent = payload?.message || "Sign in to update student verification.";
    });
});

function selectedExplorerMoods() {
  return [...document.querySelectorAll("#moodGrid input[name='moods']:checked")].map((input) => input.value);
}

function formatExplorerCity(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(",")
    .map((part) => part.trim().replace(/\b\w/g, (letter) => letter.toUpperCase()))
    .filter(Boolean)
    .join(", ");
}

function updateExplorerPassport(cityValue) {
  const cityName = (formatExplorerCity(cityValue).split(",", 1)[0] || "Denver").trim();
  const nearby = {
    Denver: ["Boulder", "Colorado Springs", "Las Vegas"],
    Boulder: ["Denver", "Colorado Springs", "Moab"],
    "Colorado Springs": ["Denver", "Boulder", "Santa Fe"],
    "Las Vegas": ["Red Rock Canyon", "Hoover Dam", "Los Angeles"],
  };
  const places = nearby[cityName] || ["Nearby Gems", "Regional Route", "Next City"];
  if (passportPrimary) passportPrimary.textContent = cityName;
  if (passportNearby) passportNearby.textContent = places[0];
  if (passportRegional) passportRegional.textContent = places[1];
  if (passportFuture) passportFuture.textContent = places[2];
}

function syncExplorerBookingChoice() {
  document.querySelectorAll("input[name='fairfares_booked']").forEach((input) => {
    input.closest("label")?.classList.toggle("is-selected", input.checked);
  });
}

function setExplorerFlowStage(stage) {
  if (!explorerForm) return;
  explorerForm.dataset.flowStage = stage;
  [
    ["city", explorerCityStep],
    ["booking", explorerBookingStep],
    ["mood", explorerMoodStep],
    ["preferences", explorerPrefsStep],
  ].forEach(([name, step]) => {
    if (!step) return;
    const isActive = name === stage;
    const isComplete = (
      (name === "city" && ["booking", "mood", "preferences"].includes(stage)) ||
      (name === "booking" && ["mood", "preferences"].includes(stage)) ||
      (name === "mood" && stage === "preferences")
    );
    step.classList.toggle("is-active", isActive);
    step.classList.toggle("is-complete", isComplete);
  });
}

  function updateExplorerCitySummary() {
    if (!explorerCitySummary) return;
    const label = explorerCitySummary.querySelector("b");
    if (label) label.textContent = explorerCity?.value || "Denver, Colorado";
    explorerCitySummary.hidden = false;
  }

function completeExplorerCityStep() {
  updateExplorerCitySummary();
  setExplorerFlowStage("booking");
  explorerBookingStep?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function explorerBookingLabel(value) {
  if (value === "yes") return "Booked through FairFares";
  if (value === "no") return "Using my own car";
  return "Just exploring";
}

function updateExplorerBookingSummary() {
  if (!explorerBookingSummary) return;
  const selected = document.querySelector("input[name='fairfares_booked']:checked")?.value || "exploring";
  const summary = explorerBookingSummary.querySelector("span");
  if (summary) summary.textContent = explorerBookingLabel(selected);
  explorerBookingSummary.hidden = false;
}

function completeExplorerBookingStep() {
  updateExplorerBookingSummary();
  explorerBookingChoice?.classList.add("is-collapsed");
  setExplorerFlowStage("mood");
  explorerMoodStep?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function updateExplorerMoodSummary() {
  if (!explorerMoodSummary) return;
  const moods = selectedExplorerMoods();
  const summary = explorerMoodSummary.querySelector("span");
  if (summary) summary.textContent = moods.length ? `Vibes: ${moods.join(", ")}` : "Choose your vibes";
  explorerMoodSummary.hidden = moods.length === 0;
}

function geocodeExplorerCity(source = "typed") {
  if (!explorerCity) return Promise.resolve("");
  const typed = formatExplorerCity(explorerCity.value);
  explorerCity.value = typed || "Denver, Colorado";
  updateExplorerPassport(explorerCity.value);
  if (!window.google?.maps?.Geocoder) {
    if (explorerLocationStatus) {
      explorerLocationStatus.textContent = `${source === "typed" ? "City set" : "Location set"} to ${explorerCity.value}. Generate a quest when you are ready.`;
    }
    return Promise.resolve(explorerCity.value);
  }
  const geocoder = new google.maps.Geocoder();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    window.setTimeout(() => {
      updateExplorerPassport(explorerCity.value);
      if (explorerLocationStatus) {
        explorerLocationStatus.textContent = `City set to ${explorerCity.value}. Live map lookup is taking longer, so Explorer will use your typed city.`;
      }
      finish(explorerCity.value);
    }, 1800);
    geocoder.geocode({ address: explorerCity.value }, (results, status) => {
      if (settled) return;
      const result = status === "OK" && results?.[0] ? results[0] : null;
      if (result) {
        explorerCity.value = result.formatted_address.split(",").slice(0, 2).join(", ");
        if (explorerCityLat) explorerCityLat.value = String(result.geometry.location.lat());
        if (explorerCityLng) explorerCityLng.value = String(result.geometry.location.lng());
      }
      updateExplorerPassport(explorerCity.value);
      if (explorerLocationStatus) {
        explorerLocationStatus.textContent = result
          ? `Explorer set to ${explorerCity.value}.`
          : `City set to ${explorerCity.value}.`;
      }
      finish(explorerCity.value);
    });
  });
}

  moodGrid?.addEventListener("change", (event) => {
    let moods = selectedExplorerMoods();
    if (moods.length > 5 && event.target?.checked) {
      event.target.checked = false;
      event.target.closest("label")?.classList.remove("is-selected");
      moods = selectedExplorerMoods();
      updateExplorerMoodSummary();
      if (explorerMoodHelper) explorerMoodHelper.textContent = "Choose up to 5 vibes so the route stays focused.";
      return;
    }
    event.target?.closest("label")?.classList.toggle("is-selected", Boolean(event.target?.checked));
    moods = selectedExplorerMoods();
    updateExplorerMoodSummary();
    if (explorerMoodHelper) {
      explorerMoodHelper.textContent = moods.length < 3
        ? `Pick ${3 - moods.length} more vibe${3 - moods.length === 1 ? "" : "s"} to generate a stronger quest.`
        : `${moods.length}/5 vibes selected. Explorer will tune the feed around these choices.`;
  }
    if (moods.length >= 3) {
      setExplorerFlowStage("preferences");
    } else {
      setExplorerFlowStage("mood");
    }
  });

detectExplorerLocation?.addEventListener("click", () => {
  if (!navigator.geolocation) {
    explorerLocationStatus.textContent = "Location is not available in this browser. Enter your city instead.";
    return;
  }
  explorerLocationStatus.textContent = "Checking location...";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (explorerCityLat) explorerCityLat.value = String(position.coords.latitude || 0);
      if (explorerCityLng) explorerCityLng.value = String(position.coords.longitude || 0);
      if (window.google?.maps?.Geocoder && explorerCity) {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: { lat: position.coords.latitude, lng: position.coords.longitude } }, (results, status) => {
          if (status === "OK" && results?.[0]) {
            const locality = results[0].address_components?.find((part) => part.types.includes("locality"))?.long_name;
            const state = results[0].address_components?.find((part) => part.types.includes("administrative_area_level_1"))?.long_name;
            explorerCity.value = [locality, state].filter(Boolean).join(", ") || explorerCity.value;
          }
          updateExplorerPassport(explorerCity.value);
          explorerLocationStatus.textContent = `Location detected near ${explorerCity.value}.`;
          completeExplorerCityStep();
        });
      } else {
        updateExplorerPassport(explorerCity?.value || "Denver, Colorado");
        explorerLocationStatus.textContent = "Location detected. Explorer will start from your current area.";
        completeExplorerCityStep();
      }
    },
    () => {
      explorerLocationStatus.textContent = "Permission denied. Enter a city to keep exploring.";
    },
    { enableHighAccuracy: false, timeout: 6000 },
  );
});

setExplorerCity?.addEventListener("click", () => {
  geocodeExplorerCity("typed").then(() => completeExplorerCityStep());
});

explorerCity?.addEventListener("change", () => {
  explorerCity.value = formatExplorerCity(explorerCity.value);
  updateExplorerPassport(explorerCity.value);
});

function updateExplorerBonusCard() {
  if (!explorerBonusCard) return;
  const selected = document.querySelector("input[name='fairfares_booked']:checked")?.value;
  explorerBonusCard.hidden = selected !== "yes";
}

document.querySelectorAll("input[name='fairfares_booked']").forEach((input) => {
  input.addEventListener("change", () => {
    updateExplorerBonusCard();
    syncExplorerBookingChoice();
    completeExplorerBookingStep();
  });
});
  updateExplorerBonusCard();
  syncExplorerBookingChoice();
  updateExplorerPassport(explorerCity?.value || "Denver, Colorado");
  if (explorerCitySummary) explorerCitySummary.hidden = true;
  if (explorerBookingSummary) explorerBookingSummary.hidden = true;
  if (explorerMoodSummary) explorerMoodSummary.hidden = true;
  setExplorerFlowStage("city");

  changeExplorerCityStep?.addEventListener("click", () => {
    setExplorerFlowStage("city");
    if (explorerCitySummary) explorerCitySummary.hidden = true;
    if (explorerBookingSummary) explorerBookingSummary.hidden = true;
    explorerBookingChoice?.classList.remove("is-collapsed");
  });

  changeExplorerBookingStep?.addEventListener("click", () => {
    explorerBookingChoice?.classList.remove("is-collapsed");
    if (explorerBookingSummary) explorerBookingSummary.hidden = true;
    setExplorerFlowStage("booking");
  });

explorerSocialGrid?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-follow-profile]");
  if (!button) return;
  button.classList.toggle("is-following");
  button.textContent = button.classList.contains("is-following") ? "Following" : "Follow";
});

explorerSocialGrid?.addEventListener("click", (event) => {
  const tile = event.target.closest(".social-reel-tile");
  if (!tile || event.target.closest("button")) return;
  setExplorerMemoryDrawer(true);
});

function explorerProfileValue(node) {
  return Number(node?.textContent || 0) || 0;
}

function updateExplorerProfile(xpEarned) {
  if (!explorerXp || !xpEarned) return;
  const xp = explorerProfileValue(explorerXp) + xpEarned;
  explorerXp.textContent = String(xp);
  if (explorerLevel) explorerLevel.textContent = String(Math.max(1, Math.floor(xp / 250) + 1));
  if (explorerBadges && xp >= 250) explorerBadges.textContent = String(Math.max(2, explorerProfileValue(explorerBadges)));
  if (explorerXpMeter) explorerXpMeter.value = String(Math.min(250, xp % 250 || (xp ? 250 : 0)));
  if (explorerXpProgressLabel) explorerXpProgressLabel.textContent = `${xp % 250 || (xp ? 250 : 0)} / 250 XP`;
}

function explorerPointFrom(value, fallbackLabel = "") {
  if (!value || !Number(value.lat) || !Number(value.lng)) return null;
  return {
    lat: Number(value.lat),
    lng: Number(value.lng),
    label: value.label || value.name || fallbackLabel || "Explorer stop",
  };
}

function explorerRoutePoints(quest) {
  const start = explorerPointFrom({
    lat: quest.start_lat || explorerCityLat?.value,
    lng: quest.start_lng || explorerCityLng?.value,
    label: quest.start_label || quest.city || explorerCity?.value || "Your location",
  }, "Your location");
  const stops = (quest.stops || [])
    .map((stop, index) => explorerPointFrom({
      lat: stop.lat,
      lng: stop.lng,
      label: Number(stop.is_secret || 0) ? `Mystery Stop ${index + 1}` : stop.name || `Stop ${index + 1}`,
    }, `Stop ${index + 1}`))
    .filter(Boolean);
  return [start, ...stops].filter(Boolean);
}

function haversineMiles(a, b) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const earthMiles = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthMiles * Math.asin(Math.sqrt(h));
}

function formatExplorerMinutes(minutes) {
  const rounded = Math.max(1, Math.round(Number(minutes) || 0));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins ? `${hours} hr ${mins} min` : `${hours} hr`;
}

function formatExplorerMiles(miles) {
  const value = Number(miles) || 0;
  return value >= 10 ? `${Math.round(value)} miles` : `${value.toFixed(1)} miles`;
}

function explorerNavigationUrl(destination) {
  if (!destination) return "#";
  const origin = explorerCityLat?.value && explorerCityLng?.value
    ? `${explorerCityLat.value},${explorerCityLng.value}`
    : "current location";
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

function explorerFullRouteUrl(points) {
  if (!points.length) return "#";
  const origin = points[0] || null;
  const destination = points[points.length - 1] || null;
  const waypoints = points.slice(1, -1);
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin ? `${origin.lat},${origin.lng}` : "current location");
  url.searchParams.set("destination", destination ? `${destination.lat},${destination.lng}` : "current location");
  if (waypoints.length) {
    url.searchParams.set("waypoints", waypoints.map((point) => `${point.lat},${point.lng}`).join("|"));
  }
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

function explorerShareMessage() {
  const city = explorerCity?.value || currentExplorerQuest?.city || "your city";
  const title = currentExplorerQuest?.title || "FairFares Explorer";
  return `I am building a ${title} in ${city}. Real places, missions, XP, and travel memories with FairFares Explorer: ${window.location.origin}/explorer`;
}

function setTemporaryButtonText(button, text) {
  if (!button) return;
  const original = button.textContent;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1800);
}

function buildFallbackRouteLegs(points) {
  return points.slice(1).map((point, index) => {
    const previous = points[index];
    const miles = haversineMiles(previous, point) * 1.22;
    return {
      from: previous.label || (index === 0 ? "Your location" : `Stop ${index}`),
      to: point.label || `Stop ${index + 1}`,
      miles,
      durationMinutes: Math.max(5, Math.round((miles / 24) * 60)),
    };
  });
}

function renderExplorerRouteDetails(points, legs, source = "estimated") {
  if (!questRouteDetails || points.length < 2 || !legs.length) return;
  const totalMiles = legs.reduce((sum, leg) => sum + Number(leg.miles || 0), 0);
  const totalMinutes = legs.reduce((sum, leg) => sum + Number(leg.durationMinutes || 0), 0);
  const nextStop = points[1];
  questRouteDetails.hidden = false;
  questRouteDetails.innerHTML = `
    <div class="route-summary-card">
      <div>
        <p class="eyebrow">Driving Route</p>
        <h3>${formatExplorerMiles(totalMiles)} · ${formatExplorerMinutes(totalMinutes)}</h3>
        <span>${source === "google" ? "Live Google driving route" : "Estimated route until Google Directions responds"}</span>
      </div>
      <a class="route-link" href="${explorerFullRouteUrl(points)}" target="_blank" rel="noopener">Open Full Route</a>
    </div>
    <div class="next-stop-card">
      <div>
        <p class="eyebrow">Next Stop</p>
        <h3>${escapeHtml(nextStop.label || "Stop 1")}</h3>
        <span>From ${escapeHtml(legs[0].from || "your location")}: ${formatExplorerMinutes(legs[0].durationMinutes)} · ${formatExplorerMiles(legs[0].miles)}</span>
      </div>
      <a class="primary-route-link" href="${explorerNavigationUrl(nextStop)}" target="_blank" rel="noopener">Start Navigation</a>
    </div>
    <ol class="route-leg-list">
      ${legs.map((leg) => `
        <li>
          <b>${escapeHtml(leg.from)} → ${escapeHtml(leg.to)}</b>
          <span>${formatExplorerMinutes(leg.durationMinutes)} · ${formatExplorerMiles(leg.miles)}</span>
        </li>
      `).join("")}
    </ol>
  `;
}

function showExplorerMapZoomIntro(mapCanvas, routePoints) {
  if (!mapCanvas || !routePoints.length || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const destination = routePoints[routePoints.length - 1] || routePoints[0];
  const cityLabel = escapeHtml(destination.label || currentExplorerQuest?.city || explorerCity?.value || "your route");
  const existingIntro = mapCanvas.querySelector(".map-zoom-intro");
  existingIntro?.remove();
  const intro = document.createElement("div");
  intro.className = "map-zoom-intro";
  intro.setAttribute("aria-hidden", "true");
  intro.innerHTML = `
    <div class="map-zoom-space">
      <div class="map-zoom-stars"></div>
      <div class="map-zoom-earth">
        <span></span>
        <i></i>
      </div>
      <svg class="map-zoom-orbit" viewBox="0 0 320 180" focusable="false">
        <path d="M28 126 C88 34 188 34 292 84" />
      </svg>
      <div class="map-zoom-pulse"></div>
      <div class="map-zoom-label">
        <b>Finding your Explorer route</b>
        <span>Zooming into ${cityLabel}</span>
      </div>
    </div>
  `;
  mapCanvas.append(intro);
  window.setTimeout(() => intro.classList.add("is-leaving"), 2400);
  window.setTimeout(() => intro.remove(), 3300);
}

function renderExplorerGoogleMap(quest, attempt = 0) {
  const mapCanvas = document.getElementById("questMapCanvas");
  if (!mapCanvas) return;
  const routePoints = explorerRoutePoints(quest);
  const visibleStops = (quest.stops || []).filter((stop) => Number(stop.lat) && Number(stop.lng));
  if (!visibleStops.length) {
    mapCanvas.innerHTML = "<b>Map preview</b><span>Stops will appear here after the quest has location data.</span>";
    if (questRouteDetails) questRouteDetails.hidden = true;
    return;
  }
  if (!window.google?.maps) {
    const mapsEnabled = window.FAIRFARES_EXPLORER_MAPS_ENABLED === true;
    if (mapsEnabled && attempt < 20) {
      mapCanvas.innerHTML = "<b>Loading Google Map</b><span>Explorer is connecting your route pins.</span>";
      window.setTimeout(() => renderExplorerGoogleMap(quest, attempt + 1), 350);
      return;
    }
    mapCanvas.innerHTML = mapsEnabled
      ? "<b>Map could not load</b><span>Google Maps is enabled, but the browser did not finish loading it. Refresh once or check the Maps key restrictions.</span>"
      : "<b>Map ready on Render</b><span>Google Maps will render here when GOOGLE_MAPS_API_KEY is available for this deployment.</span>";
    if (routePoints.length > 1) renderExplorerRouteDetails(routePoints, buildFallbackRouteLegs(routePoints));
    showExplorerMapZoomIntro(mapCanvas, routePoints);
    return;
  }
  const center = routePoints[0] || { lat: Number(visibleStops[0].lat), lng: Number(visibleStops[0].lng) };
  mapCanvas.innerHTML = "";
  const map = new google.maps.Map(mapCanvas, {
    center,
    zoom: 12,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });
  if (explorerDirectionsRenderer) explorerDirectionsRenderer.setMap(null);
  explorerDirectionsRenderer = null;
  const bounds = new google.maps.LatLngBounds();
  if (routePoints[0]) {
    bounds.extend(routePoints[0]);
    new google.maps.Marker({
      map,
      position: routePoints[0],
      label: "S",
      title: `Start near ${quest.start_label || quest.city || "your location"}`,
    });
  }
  visibleStops.forEach((stop, index) => {
    const position = { lat: Number(stop.lat), lng: Number(stop.lng) };
    bounds.extend(position);
    new google.maps.Marker({
      map,
      position,
      label: Number(stop.is_secret || 0) ? "?" : String(index + 1),
      title: Number(stop.is_secret || 0) ? `Mystery Stop ${index + 1}` : (stop.name || `Stop ${index + 1}`),
    });
  });
  if (routePoints.length > 1 && google.maps.DirectionsService && google.maps.DirectionsRenderer) {
    const origin = routePoints[0];
    const destination = routePoints[routePoints.length - 1];
    const waypoints = routePoints.slice(1, -1).map((point) => ({
      location: { lat: point.lat, lng: point.lng },
      stopover: true,
    }));
    const service = new google.maps.DirectionsService();
    explorerDirectionsRenderer = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true,
      preserveViewport: true,
      polylineOptions: {
        strokeColor: "#1266f1",
        strokeOpacity: 0.92,
        strokeWeight: 5,
      },
    });
    service.route({
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      waypoints,
      optimizeWaypoints: false,
      travelMode: google.maps.TravelMode.DRIVING,
    }, (result, status) => {
      if (status === "OK" && result?.routes?.[0]?.legs?.length) {
        explorerDirectionsRenderer.setDirections(result);
        const legs = result.routes[0].legs.map((leg, index) => ({
          from: routePoints[index]?.label || leg.start_address || `Stop ${index}`,
          to: routePoints[index + 1]?.label || leg.end_address || `Stop ${index + 1}`,
          miles: Number(leg.distance?.value || 0) / 1609.344,
          durationMinutes: Number(leg.duration?.value || 0) / 60,
        }));
        renderExplorerRouteDetails(routePoints, legs, "google");
        const routeBounds = result.routes[0].bounds;
        if (routeBounds) map.fitBounds(routeBounds);
      } else {
        new google.maps.Polyline({
          map,
          path: routePoints,
          strokeColor: "#1266f1",
          strokeOpacity: 0.75,
          strokeWeight: 4,
        });
        renderExplorerRouteDetails(routePoints, buildFallbackRouteLegs(routePoints));
      }
    });
  } else if (routePoints.length > 1) {
    new google.maps.Polyline({
      map,
      path: routePoints,
      strokeColor: "#1266f1",
      strokeOpacity: 0.85,
      strokeWeight: 4,
    });
    renderExplorerRouteDetails(routePoints, buildFallbackRouteLegs(routePoints));
  }
  map.fitBounds(bounds);
  showExplorerMapZoomIntro(mapCanvas, routePoints);
}

function renderExplorerReviews(stop) {
  const reviews = Array.isArray(stop.reviews) ? stop.reviews : [];
  const fallback = [
    {
      author: "Google review summary",
      rating: stop.rating || "",
      text: stop.review_count
        ? `${stop.review_count} Google reviews are linked to this live place result. Open the listing for the full thread.`
        : "Live Google comments appear here when Places returns review text.",
    },
  ];
  const reviewList = reviews.length ? reviews : fallback;
  return `
    <div class="quest-place-reviews">
      <b class="review-loop-title">Explorer review loop</b>
      <div class="quest-review-strip" aria-label="Google comments">
      ${reviewList.slice(0, 6).map((review) => `
        <blockquote>
          <b>${escapeHtml(review.author || "Google reviewer")} ${review.rating ? `· ${escapeHtml(review.rating)}★` : ""}</b>
          <span>${escapeHtml(review.text || "")}</span>
        </blockquote>
      `).join("")}
      </div>
    </div>
  `;
}

function renderExplorerMedia(stop) {
  const media = Array.isArray(stop.reference_media_urls) && stop.reference_media_urls.length
    ? stop.reference_media_urls
    : (stop.reference_photo_url ? [stop.reference_photo_url] : []);
  if (!media.length) return `<div class="quest-photo-placeholder">Reference media carousel</div>`;
  const slides = media.slice(0, 5);
  return `
    <div class="quest-media-carousel" style="--media-duration:${slides.length * 4}s">
      ${slides.map((url, index) => `
        <img src="${escapeHtml(url)}" alt="${escapeHtml(stop.name || "Explorer stop")} media ${index + 1}">
      `).join("")}
    </div>
  `;
}

function explorerCompletionState() {
  const stops = [...document.querySelectorAll(".quest-stop")];
  const total = stops.length || 0;
  const completed = stops.filter((stop) => stop.classList.contains("is-complete")).length;
  return { total, completed };
}

function updateExplorerQuestProgress() {
  const { total, completed } = explorerCompletionState();
  const percent = total ? Math.round((completed / total) * 100) : 0;
  if (questProgressText) questProgressText.textContent = `${completed}/${total || 5} stops complete · ${percent}%`;
  if (questProgressFill) questProgressFill.style.width = `${percent}%`;
  if (questBadgeText) questBadgeText.textContent = `Hidden Gem Hunter: ${Math.min(completed, 5)}/5`;
}

function renderMissionChecklist(stop) {
  const items = Array.isArray(stop.checklist) && stop.checklist.length
    ? stop.checklist
    : ["Check in at the stop", "Capture a photo", "Rate the experience 1-5"];
  return `
    <ul class="mission-checklist">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderUploadChallenge(stop) {
  return `
    <div class="mission-upload">
      <div>
        <b>Memory Challenge</b>
        <span>Capture a photo, video, or reel proof for +${Number(stop.photo_bonus_xp || 25)} bonus XP.</span>
      </div>
      <div class="memory-actions">
        <button type="button" class="memory-plus" data-memory-toggle aria-label="Add memory">+</button>
        <div class="memory-menu" hidden>
          <label>
            <input type="file" accept="image/*" capture="environment" data-memory-upload data-memory-type="photo">
            <span>Take photo</span>
          </label>
          <label>
            <input type="file" accept="image/*" data-memory-upload data-memory-type="photo">
            <span>Upload image</span>
          </label>
          <label>
            <input type="file" accept="video/*" capture="environment" data-memory-upload data-memory-type="video">
            <span>Take video / reel</span>
          </label>
          <label>
            <input type="file" accept="video/*" data-memory-upload data-memory-type="video">
            <span>Upload video / reel</span>
          </label>
        </div>
      </div>
    </div>
  `;
}

function renderExplorerStopInsights(stop) {
  const mood = stop.mood || (Array.isArray(stop.tags) ? stop.tags[0] : "") || "Explorer";
  const bestTime = stop.best_time || "Flexible";
  const timeReason = stop.time_reason || "Explorer picked this timing from your selected mood.";
  const verdict = stop.weather_verdict || "Check weather";
  const weatherNote = stop.weather_note || "Check current conditions before you go.";
  return `
    <div class="stop-insight-row">
      <span><b>${escapeHtml(mood)}</b>Mood match</span>
      <span><b>${escapeHtml(bestTime)}</b>${escapeHtml(timeReason)}</span>
      <span class="${verdict === "Wait or swap" ? "is-warning" : verdict === "Go prepared" ? "is-caution" : "is-good"}"><b>${escapeHtml(verdict)}</b>${escapeHtml(weatherNote)}</span>
    </div>
  `;
}

function appendMemoryGalleryItem(file, memoryType, stopName) {
  if (!memoryGallery || !file) return;
  memoryGallery.querySelector("span")?.remove();
  const item = document.createElement("div");
  item.className = "memory-gallery-item";
  if (memoryType === "photo") {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.alt = `${stopName || "Explorer"} memory`;
    item.appendChild(img);
  } else {
    item.innerHTML = "<b>Video / Reel</b>";
  }
  const label = document.createElement("small");
  label.textContent = stopName || file.name;
  item.appendChild(label);
  memoryGallery.appendChild(item);
}

function replaceExplorerStop(stopElement) {
  const index = Number(stopElement?.dataset.stopIndex ?? -1);
  if (!currentExplorerQuest || index < 0) return false;
  const alternatives = Array.isArray(currentExplorerQuest.alternatives) ? currentExplorerQuest.alternatives : [];
  const usedNames = new Set((currentExplorerQuest.stops || []).map((stop) => String(stop.name || "").toLowerCase()));
  const nextIndex = alternatives.findIndex((stop) => stop?.name && !usedNames.has(String(stop.name).toLowerCase()));
  if (nextIndex < 0) return false;
  const [replacement] = alternatives.splice(nextIndex, 1);
  currentExplorerQuest.stops[index] = {
    ...replacement,
    order: index + 1,
    is_secret: 0,
    locked: 0,
    completed: 0,
  };
  renderExplorerQuest(currentExplorerQuest, { preserveScroll: true });
  window.setTimeout(() => {
    questStops?.querySelector(`[data-stop-index="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 50);
  return true;
}

function renderExplorerQuest(quest, options = {}) {
  if (!questOutput || !questStops || !questMap) return;
  currentExplorerQuest = quest;
  questOutput.hidden = false;
  if (questTitle) questTitle.textContent = quest.title;
  if (questDescription) questDescription.textContent = quest.description || "Complete the route, unlock the mystery stop, and collect XP.";
  if (questMeta) questMeta.textContent = `${quest.stops.length} stops · ${quest.total_hours} hours · ${quest.total_miles} miles`;
  if (questWeatherSummary) {
    const weather = quest.weather || {};
    questWeatherSummary.hidden = !weather.summary;
    questWeatherSummary.textContent = weather.summary ? `Weather fit: ${weather.summary}` : "";
  }
  if (questDifficulty) questDifficulty.textContent = `${"★".repeat(Number(quest.difficulty || 2))}${"☆".repeat(Math.max(0, 5 - Number(quest.difficulty || 2)))}`;
  if (questReward) questReward.textContent = `${quest.total_xp} XP`;
  if (questStopCount) questStopCount.textContent = String(quest.stop_count || quest.stops.length);
  if (questBoostText) {
    questBoostText.textContent = quest.fairfares_booked
      ? "Nissan Sentra-style rental boost active: +100 XP and mystery stop access."
      : "Book through FairFares to activate +100 XP and premium mystery routes.";
  }
  questBoostCard?.classList.toggle("is-active", Boolean(quest.fairfares_booked));
  if (explorerCommunity) explorerCommunity.hidden = false;
  questMap.innerHTML = quest.stops.map((stop, index) => `
    <span class="${stop.is_secret ? "is-secret" : ""} ${index === 0 ? "is-current" : ""}">
      ${stop.is_secret ? "?" : index === 0 ? "START" : index + 1}
    </span>
  `).join("");
  renderExplorerGoogleMap(quest);
  questStops.innerHTML = quest.stops.map((stop, index) => {
    const stopName = escapeHtml(stop.name);
    const stopChallenge = escapeHtml(stop.challenge);
    const address = escapeHtml(stop.address || "");
    const rating = Number(stop.rating || 0);
    const reviewCount = Number(stop.review_count || 0);
    const completed = Boolean(Number(stop.completed || 0));
    const isFinalStop = index === quest.stops.length - 1;
    const secret = Boolean(Number(stop.is_secret || 0)) && isFinalStop;
    const locked = !completed && secret;
    const missionTitle = escapeHtml(stop.mission_title || (secret ? "Mystery Stop Unlock" : "Explorer Field Mission"));
    const photoBonus = Number(stop.photo_bonus_xp || 25);
    const placeMeta = !stop.is_secret && (rating || address || stop.google_url) ? `
      <div class="quest-place-meta">
        ${rating ? `<span>${rating.toFixed(1)}★ · ${reviewCount || 0} Google reviews</span>` : ""}
        ${address ? `<span>${address}</span>` : ""}
        ${stop.google_url ? `<a href="${escapeHtml(stop.google_url)}" target="_blank" rel="noopener">Open in Google Maps</a>` : ""}
      </div>
    ` : "";
    return `
    <article class="quest-stop ${locked || secret ? "is-locked" : ""} ${completed ? "is-complete" : ""}" data-stop-index="${index}" data-stop-id="${escapeHtml(stop.stop_id || "")}" data-stop-name="${stopName}" data-stop-challenge="${stopChallenge}" data-photo-bonus="${photoBonus}">
      <div>
        <small>${secret ? "Mystery Stop" : locked ? "Locked Mission" : completed ? "Checked In" : `Active Mission`}</small>
        <h3>${secret ? "Unlock after previous stop" : stopName}</h3>
        ${placeMeta}
        <div class="mission-title">${secret ? "Unlock the next adventure" : missionTitle}</div>
        ${secret ? "" : renderExplorerStopInsights(stop)}
        <p><b>Challenge:</b> ${secret ? "Complete the previous mission to reveal this stop." : stopChallenge}</p>
        ${secret ? "" : renderMissionChecklist(stop)}
        <p><b>Stop tips:</b> ${secret ? "The surprise location unlocks after your previous check-in." : escapeHtml(stop.tips || "Use current hours and safe parking before you go.")}</p>
        ${secret ? `<div class="quest-photo-placeholder">Mystery media unlocks later</div>` : renderExplorerMedia(stop)}
        ${secret ? "" : renderUploadChallenge(stop)}
        ${secret ? "" : renderExplorerReviews(stop)}
        <div class="mission-reward"><span>${stop.xp_reward} XP</span><span>+${photoBonus} photo bonus</span></div>
      </div>
      <div class="quest-stop-actions">
        <button type="button" ${secret || locked || completed ? "disabled" : ""}>${completed ? "Checked In" : secret || locked ? "Locked" : "I'm at this stop"}</button>
        ${secret ? "" : `<button type="button" class="light-button choose-other-stop" data-refresh-stop>Choose other places</button>`}
      </div>
    </article>
  `;
  }).join("");
  updateExplorerQuestProgress();
  if (!options.preserveScroll) questOutput.scrollIntoView({ behavior: "smooth", block: "start" });
}

explorerForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const moods = selectedExplorerMoods();
  if (moods.length < 3) {
    if (explorerMoodHelper) explorerMoodHelper.textContent = "Choose at least 3 vibes before generating your quest.";
    moodGrid?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  geocodeExplorerCity("typed").finally(() => {
    const formData = new FormData(explorerForm);
    const payload = new URLSearchParams(formData);
    payload.set("moods", moods.join(","));
    fetch("/explorer/quest", {
      method: "POST",
      body: payload,
    })
      .then((response) => response.ok ? response.json() : response.json().then((body) => Promise.reject(body)))
      .then((payload) => {
        renderExplorerQuest(payload.quest);
        updateExplorerProfile(Number(payload.quest?.fairfares_bonus || 0));
      })
      .catch(() => {
        if (questOutput) questOutput.hidden = true;
      });
  });
});

questStops?.addEventListener("click", (event) => {
  const memoryToggle = event.target.closest("[data-memory-toggle]");
  if (memoryToggle) {
    const menu = memoryToggle.closest(".memory-actions")?.querySelector(".memory-menu");
    if (menu) menu.hidden = !menu.hidden;
    return;
  }
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  if (button.matches("[data-refresh-stop]")) {
    button.textContent = "Finding another place...";
    const replaced = replaceExplorerStop(button.closest(".quest-stop"));
    if (!replaced) {
      button.textContent = "No more nearby options";
      button.disabled = true;
    }
    return;
  }
  const stop = button.closest(".quest-stop");
  if (!stop) return;
  stop.classList.add("is-complete");
  button.textContent = "Checked In";
  button.disabled = true;
  stop.querySelectorAll("[data-refresh-stop]").forEach((item) => {
    item.disabled = true;
  });
  const next = stop.nextElementSibling;
  if (next?.classList.contains("is-locked")) {
    next.classList.remove("is-locked");
    const nextStatus = next.querySelector("small");
    const nextTitle = next.querySelector("h3");
    if (nextStatus) nextStatus.textContent = "Active Mission";
    if (nextTitle) nextTitle.textContent = next.dataset.stopName || "Mystery Stop Unlocked";
    const mission = next.querySelector("p");
    if (mission) mission.innerHTML = `<b>Challenge:</b> ${escapeHtml(next.dataset.stopChallenge || "Your hidden stop is ready. Complete the final challenge.")}`;
    const nextButton = next.querySelector(".quest-stop-actions button:not([data-refresh-stop])");
    if (nextButton) {
      nextButton.disabled = false;
      nextButton.textContent = "I'm at this stop";
    }
    const mapPin = questMap?.querySelectorAll("span")?.[Number(next.dataset.stopIndex || 0)];
    mapPin?.classList.add("is-current");
  }
  const xp = Number(stop.querySelector(".mission-reward span")?.textContent?.match(/\d+/)?.[0] || 20);
  updateExplorerProfile(xp);
  updateExplorerQuestProgress();
  const stopId = stop.dataset.stopId || "";
  if (stopId) {
    fetch("/explorer/checkin", {
      method: "POST",
      body: new URLSearchParams({ stop_id: stopId }),
    }).catch(() => {});
  }
  const remaining = [...questStops.querySelectorAll(".quest-stop-actions button:not([data-refresh-stop])")].some((item) => !item.disabled);
  if (!remaining && questComplete) questComplete.hidden = false;
});

questStops?.addEventListener("change", (event) => {
  const input = event.target.closest("[data-memory-upload]");
  if (!input || !input.files?.length) return;
  const stop = input.closest(".quest-stop");
  const bonus = Number(stop?.dataset.photoBonus || 25);
  input.closest(".mission-upload")?.classList.add("is-uploaded");
  const menu = input.closest(".memory-menu");
  if (menu) menu.hidden = true;
  const upload = input.closest(".mission-upload");
  const status = upload?.querySelector(".memory-status") || document.createElement("span");
  const file = input.files[0];
  const memoryType = input.dataset.memoryType === "video" ? "video/reel" : "photo";
  status.className = "memory-status";
  status.textContent = `${memoryType} added: ${file.name}`;
  upload?.appendChild(status);
  appendMemoryGalleryItem(file, input.dataset.memoryType === "video" ? "video" : "photo", stop?.dataset.stopName || "");
  if (stop && stop.dataset.photoBonusAwarded !== "1") {
    stop.dataset.photoBonusAwarded = "1";
    stop.dataset.memoryCaptured = "1";
    updateExplorerProfile(bonus);
  }
});

document.querySelectorAll("[data-share-channel]").forEach((button) => {
  button.addEventListener("click", async () => {
    const channel = button.dataset.shareChannel;
    const text = explorerShareMessage();
    const encodedText = encodeURIComponent(text);
    const pageUrl = encodeURIComponent(`${window.location.origin}/explorer`);
    if (channel === "whatsapp") {
      window.open(`https://wa.me/?text=${encodedText}`, "_blank", "noopener");
      return;
    }
    if (channel === "facebook") {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${pageUrl}&quote=${encodedText}`, "_blank", "noopener");
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: "FairFares Explorer", text, url: `${window.location.origin}/explorer` });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setTemporaryButtonText(button, "Copied for Instagram");
    }
  });
});

document.getElementById("createMemoryVideo")?.addEventListener("click", () => {
  const captured = [...document.querySelectorAll(".quest-stop")]
    .filter((stop) => stop.dataset.memoryCaptured === "1").length;
  const status = document.getElementById("memoryVideoStatus");
  if (!status) return;
  status.hidden = false;
  status.textContent = captured
    ? `Memory video draft ready from ${captured} stop${captured === 1 ? "" : "s"}. Background music and rendering will connect in the next media sprint.`
    : "Add at least one photo, video, or reel at a stop to create a memory video.";
});

document.getElementById("resetQuest")?.addEventListener("click", () => {
  if (questOutput) questOutput.hidden = true;
  if (questComplete) questComplete.hidden = true;
});

const tripFilterButtons = [...document.querySelectorAll("[data-trip-filter]")];
const tripRows = [...document.querySelectorAll("[data-trip-type]")];
const tripDetailModal = document.getElementById("tripDetailModal");
const tripDetailContent = document.getElementById("tripDetailContent");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function filterTrips(type) {
  tripFilterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tripFilter === type);
  });
  tripRows.forEach((row) => {
    row.classList.toggle("is-hidden", !row.dataset.tripType.includes(type));
  });
}

tripFilterButtons.forEach((button) => {
  button.addEventListener("click", () => filterTrips(button.dataset.tripFilter));
});

tripRows.forEach((row) => {
  row.addEventListener("click", (event) => {
    if (event.target.closest("[data-unsave-car-id]")) return;
    if (!tripDetailModal || !tripDetailContent) return;
    if (!row.dataset.tripDetails) return;
    let details = {};
    try {
      details = JSON.parse(row.dataset.tripDetails || "{}");
    } catch {
      return;
    }
    const image = escapeHtml(details.image || "");
    const car = escapeHtml(details.car || "Trip details");
    tripDetailContent.innerHTML = `
      ${image ? `<img class="trip-modal-image" src="${image}" alt="${car}">` : ""}
      <p class="eyebrow">${escapeHtml(details.statusText || details.status || "Trip")}</p>
      <h2>${car}</h2>
      <dl>
        <div><dt>Booking ID</dt><dd>${escapeHtml(details.bookingId || "-")}</dd></div>
        <div><dt>Provider</dt><dd>${escapeHtml(details.provider || "-")}</dd></div>
        <div><dt>Pickup</dt><dd>${escapeHtml(details.pickup || "-")}</dd></div>
        <div><dt>Drop-off</dt><dd>${escapeHtml(details.dropoff || "-")}</dd></div>
        <div><dt>Status / Request</dt><dd>${escapeHtml(details.reason || details.status || "-")}</dd></div>
        <div><dt>Payment</dt><dd>${escapeHtml(details.payment || "-")}</dd></div>
        <div><dt>Paid</dt><dd>${escapeHtml(details.paid || "$0.00")}</dd></div>
        <div><dt>Pickup Balance</dt><dd>${escapeHtml(details.pickupBalance || "-")}</dd></div>
        <div><dt>Price</dt><dd>${escapeHtml(details.price || "-")}</dd></div>
      </dl>
    `;
    tripDetailModal.showModal();
  });
});

document.getElementById("closeTripDetail")?.addEventListener("click", () => {
  tripDetailModal?.close();
});

document.addEventListener("click", (event) => {
  const saveButton = event.target.closest(".save-search-trip");
  if (!saveButton) return;
  const card = saveButton.closest(".car-card");
  const payload = new URLSearchParams();
  payload.set("car_id", saveButton.dataset.carId || "");
  payload.set("pickup_location", selectedOrCardLocation(card));
  payload.set("pickup_date", pickupDate?.value || "");
  payload.set("pickup_time", pickupTime?.value || "");
  payload.set("return_date", returnDate?.value || "");
  payload.set("return_time", returnTime?.value || "");
  payload.set("discount_code", discountCode?.value || "");
  payload.set("action", saveButton.dataset.saved === "true" ? "unsave" : "save");
  fetch("/saved-cars", {
    method: "POST",
    body: payload,
  })
    .then((response) => response.ok ? response.json() : response.json().then((data) => Promise.reject(data)))
    .then((data) => {
      saveButton.dataset.saved = data.saved ? "true" : "false";
      saveButton.textContent = data.message || (data.saved ? "Unsave" : "Save Trip");
    })
    .catch((data) => {
      saveButton.textContent = data?.login_required ? "Sign in to save" : "Try again";
    });
});

document.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-unsave-car-id]");
  if (!removeButton) return;
  event.preventDefault();
  event.stopPropagation();
  const payload = new URLSearchParams();
  payload.set("car_id", removeButton.dataset.unsaveCarId || "");
  payload.set("action", "unsave");
  fetch("/saved-cars", {
    method: "POST",
    body: payload,
  })
    .then((response) => response.ok ? response.json() : response.json().then((data) => Promise.reject(data)))
    .then(() => {
      removeButton.closest(".mini-trip")?.remove();
    })
    .catch((data) => {
      removeButton.textContent = data?.login_required ? "Sign in required" : "Try again";
    });
});

document.getElementById("cancelPendingRequest")?.addEventListener("click", () => {
  fetch("/bookings/request-cancel", { method: "POST" })
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then((payload) => {
      const notice = document.getElementById("requestNotice");
      if (notice) notice.remove();
      if (bookingStatusBadge && payload.status_label) {
        bookingStatusBadge.textContent = payload.status_label;
        bookingStatusBadge.className = `status-badge ${payload.status_class || "status-confirmed"}`;
      }
    });
});

document.getElementById("refreshStatus")?.addEventListener("click", () => {
  document.getElementById("statusMessage").textContent = "Live status checked just now.";
});

document.getElementById("textStatus")?.addEventListener("click", () => {
  document.getElementById("statusMessage").textContent = "Text updates enabled for this booking.";
});

if (detailTabs.length) showDetailPanel("student");
if (tripFilterButtons.length) filterTrips("upcoming");

const supportSummary = document.getElementById("supportSummary");
const supportStatus = document.getElementById("supportStatus");
const urgentSupport = document.getElementById("urgentSupport");
const supportTopic = document.getElementById("supportTopic");
const supportContact = document.getElementById("supportContact");
const supportTopicCopy = {
  "Pickup help": ["Pickup help selected", "We can help with counter location, pickup timing, and rental readiness.", "Chat in browser"],
  "Chat support help": ["Chat support selected", "Create a ticket and FairFares support will route it by priority.", "Chat in browser"],
  "Emergency roadside help": ["Emergency roadside selected", "Urgent roadside tickets are escalated to the fastest available support path.", "Phone call"],
  "Provider contact help": ["Provider contact selected", supportSummary?.dataset.providerSummary || "Provider contact details are based on your current booking.", "Phone call"],
  "Billing question": ["Billing help selected", "Support can review receipts, charges, taxes, and fees.", "Email"],
  "Vehicle issue": ["Vehicle issue selected", "We can help with vehicle problems, swaps, and provider escalation.", "Phone call"],
  "Modify/cancel help": ["Modify or cancel help selected", "Support can help review trip changes, cancellation, and refund options.", "Chat in browser"],
  "Student discount help": ["Student discount help selected", "We can review verification and student savings for this booking.", "Email"],
};

function syncSupportTopic() {
  if (!supportSummary || !supportTopic) return;
  const copy = supportTopicCopy[supportTopic.value] || supportTopicCopy["Pickup help"];
  supportSummary.innerHTML = `<b>${copy[0]}</b><span>${copy[1]}</span>`;
  if (supportContact) {
    supportContact.value = copy[2];
  }
  supportStatus.textContent = "";
}

supportTopic?.addEventListener("change", syncSupportTopic);

urgentSupport?.addEventListener("change", () => {
  if (urgentSupport.checked) {
    if (supportTopic) supportTopic.value = "Emergency roadside help";
    syncSupportTopic();
    supportStatus.textContent = "Urgent support enabled. Roadside assistance prioritized.";
  } else {
    supportStatus.textContent = "";
  }
});

document.getElementById("providerContact")?.addEventListener("click", () => {
  if (supportTopic) supportTopic.value = "Provider contact help";
  syncSupportTopic();
  supportStatus.textContent = supportSummary?.dataset.providerSummary || "Provider contact details are based on your current booking.";
});

document.querySelectorAll("[data-support-continue]").forEach((button) => {
  button.addEventListener("click", () => {
    const ticketId = button.dataset.ticketId || "previous ticket";
    const bookingId = button.dataset.bookingId || "old booking";
    const topic = button.dataset.topic || "Support";
    if (supportTopic && [...supportTopic.options].some((option) => option.value === topic)) {
      supportTopic.value = topic;
      syncSupportTopic();
    }
    const message = document.getElementById("supportMessage");
    if (message) {
      message.value = `Continuing ${ticketId} for booking ${bookingId}: `;
      message.focus();
    }
    if (supportStatus) {
      supportStatus.textContent = `Continuing old conversation ${ticketId} related to booking ${bookingId}.`;
    }
  });
});

document.getElementById("supportForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = new URLSearchParams();
  payload.set("topic", supportTopic?.value || "Pickup help");
  payload.set("preferred_contact", supportContact?.value || "Chat in browser");
  payload.set("message", document.getElementById("supportMessage")?.value || "");
  payload.set("urgent", urgentSupport?.checked ? "1" : "0");
  fetch("/support/tickets", {
    method: "POST",
    body: payload,
  })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
    .then((data) => {
      supportStatus.textContent = data.message || `Ticket ${data.ticket_id} created. FairFares support will follow up soon.`;
    })
    .catch((payload) => {
      supportStatus.textContent = payload?.message || "Sign in to create a support ticket.";
    });
});

syncSupportTopic();

document.getElementById("customerInfoForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById("customerInfoStatus");
  const endpoint = form.dataset.guestBooking === "true" ? "/guest-booking" : "/profile/update";
  fetch(endpoint, {
    method: "POST",
    body: new URLSearchParams(new FormData(form)),
  })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
    .then((payload) => {
      if (status) status.textContent = payload.message || "Your contact details are saved for this booking.";
      if (payload.booking_id) {
        const bookingId = document.querySelector("[data-booking-id-label]");
        if (bookingId) bookingId.textContent = payload.booking_id;
      }
      const guestActions = document.getElementById("guestAfterSaveActions");
      if (guestActions) guestActions.hidden = false;
      if (form.dataset.guestBooking !== "true") {
        form.classList.add("is-saved");
        document.getElementById("bookingHoldPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      showBookingReferralModal(form, payload);
    })
    .catch((payload) => {
      if (status) status.textContent = payload?.message || "Please check your details and try again.";
    });
});

document.getElementById("paymentHoldForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById("paymentHoldStatus");
  const submitButton = event.submitter || form.querySelector("button[type='submit']");
  const originalLabel = submitButton ? submitButton.innerHTML : "";
  const paymentOption = submitButton?.value || "hold";
  if (submitButton) submitButton.disabled = true;
  if (submitButton) submitButton.innerHTML = "<span>Opening Stripe...</span>";
  if (status) status.textContent = "Opening secure Stripe checkout...";
  const payload = new URLSearchParams(new FormData(form));
  payload.set("payment_option", paymentOption);
  fetch("/payment/stripe-session", {
    method: "POST",
    body: payload,
  })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
    .then((payload) => {
      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
      throw payload;
    })
    .catch((payload) => {
      if (status) status.textContent = payload?.message || "Stripe checkout could not be opened.";
      if (submitButton) submitButton.disabled = false;
      if (submitButton && originalLabel) submitButton.innerHTML = originalLabel;
    });
});

document.getElementById("stripeIdentityButton")?.addEventListener("click", (event) => {
  const button = event.currentTarget;
  const status = document.getElementById("stripeIdentityStatus");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Opening Stripe Identity...";
  if (status) status.textContent = "Opening secure identity verification...";
  fetch("/identity/stripe-session", { method: "POST" })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
    .then((payload) => {
      if (payload.verified) {
        if (status) status.textContent = payload.message || "Identity is already verified.";
        button.hidden = true;
        return;
      }
      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
      throw payload;
    })
    .catch((payload) => {
      if (status) status.textContent = payload?.message || "Stripe Identity could not be opened.";
      button.disabled = false;
      button.textContent = originalLabel || "Verify with Stripe Identity";
    });
});

document.querySelectorAll("[data-admin-stripe-identity-button]").forEach((button) => {
  button.addEventListener("click", async () => {
    const form = button.closest(".pickup-form");
    const panel = button.closest("[data-admin-stripe-identity]");
    const status = panel?.querySelector("[data-admin-stripe-identity-status]");
    const bookingInput = form?.querySelector('input[name="booking_id"]');
    if (!(bookingInput instanceof HTMLInputElement)) return;
    const originalLabel = button.textContent;
    const payload = new URLSearchParams();
    payload.set("booking_id", bookingInput.value);
    button.disabled = true;
    button.textContent = "Opening Stripe Identity...";
    if (status) status.textContent = "Opening secure DL and selfie verification for pickup...";
    try {
      const response = await fetch("/admin/identity/stripe-session", {
        method: "POST",
        body: payload,
        headers: {
          Accept: "application/json",
          "X-Requested-With": "fetch",
        },
      });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.message || "Stripe Identity could not be opened.");
      if (result.verified) {
        if (status) status.textContent = result.message || "Identity is already verified.";
        button.textContent = "Verified";
        return;
      }
      if (result.url) {
        window.location.href = result.url;
        return;
      }
      throw new Error(result.message || "Stripe Identity could not be opened.");
    } catch (error) {
      if (status) status.textContent = error.message || "Stripe Identity could not be opened.";
      button.disabled = false;
      button.textContent = originalLabel || "Start Stripe Identity";
    }
  });
});

document.querySelectorAll("[data-admin-pickup-payment-button]").forEach((button) => {
  button.addEventListener("click", async () => {
    const form = button.closest(".pickup-form");
    const panel = button.closest("[data-admin-pickup-payment]");
    const status = panel?.querySelector("[data-admin-pickup-payment-status]");
    const bookingInput = form?.querySelector('input[name="booking_id"]');
    if (!(bookingInput instanceof HTMLInputElement)) return;
    const originalLabel = button.textContent;
    const payload = new URLSearchParams();
    payload.set("booking_id", bookingInput.value);
    button.disabled = true;
    button.textContent = "Creating payment...";
    if (status) status.textContent = "Creating a booking-linked in-person Stripe payment...";
    try {
      const response = await fetch("/admin/payment/pickup-balance", {
        method: "POST",
        body: payload,
        headers: {
          Accept: "application/json",
          "X-Requested-With": "fetch",
        },
      });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.message || "Could not create pickup balance payment.");
      if (status) {
        status.textContent = `${result.amount || "Payment"} created: ${result.payment_intent_id || "Stripe PaymentIntent"}. Collect with Terminal/Tap to Pay; this booking updates after webhook confirmation.`;
        if (result.dashboard_url) {
          const link = document.createElement("a");
          link.href = result.dashboard_url;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = " Open in Stripe";
          status.appendChild(link);
        }
      }
      button.textContent = "Payment created";
    } catch (error) {
      if (status) status.textContent = error.message || "Could not create pickup balance payment.";
      button.disabled = false;
      button.textContent = originalLabel || "Create in-person payment";
    }
  });
});

document.querySelectorAll("[data-admin-security-deposit-button]").forEach((button) => {
  button.addEventListener("click", async () => {
    const form = button.closest(".pickup-form");
    const panel = button.closest("[data-admin-security-deposit]");
    const status = panel?.querySelector("[data-admin-security-deposit-status]");
    const bookingInput = form?.querySelector('input[name="booking_id"]');
    if (!(bookingInput instanceof HTMLInputElement)) return;
    const originalLabel = button.textContent;
    const payload = new URLSearchParams();
    payload.set("booking_id", bookingInput.value);
    button.disabled = true;
    button.textContent = "Creating deposit...";
    if (status) status.textContent = "Creating refundable security deposit authorization...";
    try {
      const response = await fetch("/admin/payment/security-deposit", {
        method: "POST",
        body: payload,
        headers: {
          Accept: "application/json",
          "X-Requested-With": "fetch",
        },
      });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.message || "Could not create deposit authorization.");
      if (status) {
        status.textContent = `${result.amount || "Deposit"} authorization created: ${result.payment_intent_id || "Stripe PaymentIntent"}. Collect with Terminal/Tap to Pay, then release after return review if clear.`;
        if (result.dashboard_url) {
          const link = document.createElement("a");
          link.href = result.dashboard_url;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = " Open in Stripe";
          status.appendChild(link);
        }
      }
      button.textContent = "Deposit created";
    } catch (error) {
      if (status) status.textContent = error.message || "Could not create deposit authorization.";
      button.disabled = false;
      button.textContent = originalLabel || "Create deposit authorization";
    }
  });
});

document.getElementById("continueHoldButton")?.addEventListener("click", (event) => {
  const button = event.currentTarget;
  const status = document.getElementById("paymentHoldStatus");
  button.disabled = true;
  fetch("/booking/hold/continue", { method: "POST" })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
    .then((payload) => {
      if (status) status.textContent = payload.message || "Checkout window restarted.";
      window.setTimeout(() => window.location.reload(), 450);
    })
    .catch((payload) => {
      if (status) status.textContent = payload?.message || "Unable to continue checkout.";
      button.disabled = false;
    });
});

document.getElementById("removeHoldButton")?.addEventListener("click", (event) => {
  const button = event.currentTarget;
  const status = document.getElementById("paymentHoldStatus");
  button.disabled = true;
  fetch("/booking/hold/remove", { method: "POST" })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
    .then((payload) => {
      if (status) status.textContent = payload.message || "Removed from checkout.";
      window.setTimeout(() => {
        window.location.href = payload.redirect || "/#results";
      }, 650);
    })
    .catch((payload) => {
      if (status) status.textContent = payload?.message || "Unable to remove this car.";
      button.disabled = false;
    });
});

function startBookingCountdown() {
  const timer = document.querySelector("[data-hold-seconds]");
  const label = document.getElementById("holdCountdown");
  if (!timer || !label) return;
  let seconds = Number.parseInt(timer.getAttribute("data-hold-seconds") || "0", 10);
  const format = (value) => {
    const safe = Math.max(0, value);
    const minutes = Math.floor(safe / 60);
    const remainder = String(safe % 60).padStart(2, "0");
    return `${minutes}:${remainder}`;
  };
  label.textContent = format(seconds);
  const tick = window.setInterval(() => {
    seconds -= 1;
    label.textContent = format(seconds);
    if (seconds <= 0) {
      window.clearInterval(tick);
      timer.classList.add("is-expired");
      const status = document.getElementById("paymentHoldStatus");
      if (status) status.textContent = "Payment window closed. Restart checkout or remove this vehicle.";
      window.setTimeout(() => window.location.reload(), 900);
    }
  }, 1000);
}

startBookingCountdown();

function referralNameSlug(form) {
  const firstName = form?.querySelector("[name='first_name']")?.value || "";
  const lastName = form?.querySelector("[name='last_name']")?.value || "";
  const email = form?.querySelector("[name='email']")?.value || "";
  const base = `${firstName}_${lastName}`.trim() || email.split("@")[0] || "FAIRFARES";
  return base.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase() || "FAIRFARES";
}

function showBookingReferralModal(form, payload = {}) {
  if (!bookingReferralModal) return;
  hideSiteLoader();
  const code = payload.referral_code || `${referralNameSlug(form)}_REFER_COUPON`;
  const signupUrl = new URL("/signup", window.location.origin);
  signupUrl.searchParams.set("referral_code", code);
  const message = `FairFares gives students fair car rental pricing with no hidden-fee surprises. Use my referral link to create your account and get 10% off your first booking. After three friends sign up, FairFares also sends me a thank-you coupon. ${signupUrl.toString()}`;
  const codeTarget = document.getElementById("bookingReferralCode");
  const whatsapp = document.getElementById("shareReferralWhatsapp");
  const email = document.getElementById("shareReferralEmail");
  const signup = document.getElementById("bookingReferralSignup");
  const phone = document.getElementById("referralSharePhone");
  if (codeTarget) codeTarget.textContent = code;
  if (phone) phone.value = form?.querySelector("[name='phone']")?.value || phone.value || "";
  if (whatsapp) whatsapp.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  if (email) {
    email.href = `mailto:?subject=${encodeURIComponent("Get 10% off your first FairFares booking")}&body=${encodeURIComponent(message)}`;
  }
  if (signup) signup.href = "/signup";
  bookingReferralModal.hidden = false;
  document.body.classList.add("modal-open");
  whatsapp?.focus();
}

function closeBookingReferralModal() {
  if (!bookingReferralModal) return;
  bookingReferralModal.hidden = true;
  document.body.classList.remove("modal-open");
}

bookingReferralModal?.querySelectorAll("[data-referral-close]").forEach((button) => {
  button.addEventListener("click", closeBookingReferralModal);
});

bookingReferralModal?.addEventListener("click", (event) => {
  if (event.target === bookingReferralModal) closeBookingReferralModal();
});

function showReferralClaimModal() {
  if (!referralClaimModal) return;
  hideSiteLoader();
  referralClaimModal.hidden = false;
  document.body.classList.add("modal-open");
  document.getElementById("claimReferralReward")?.focus();
}

function closeReferralClaimModal() {
  if (!referralClaimModal) return;
  referralClaimModal.hidden = true;
  document.body.classList.remove("modal-open");
}

if (referralClaimModal?.dataset.autoShow === "true") {
  window.setTimeout(showReferralClaimModal, 450);
}

document.getElementById("claimReferralReward")?.addEventListener("click", () => {
  const status = document.getElementById("referralClaimStatus");
  fetch("/referrals/claim", { method: "POST", body: new URLSearchParams() })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
    .then((payload) => {
      if (status) status.textContent = payload.message || "Referral coupon claimed.";
      window.setTimeout(closeReferralClaimModal, 1400);
    })
    .catch((payload) => {
      if (status) status.textContent = payload?.message || "We could not claim this coupon yet.";
    });
});

referralClaimModal?.querySelectorAll("[data-claim-close]").forEach((button) => {
  button.addEventListener("click", closeReferralClaimModal);
});

referralClaimModal?.addEventListener("click", (event) => {
  if (event.target === referralClaimModal) closeReferralClaimModal();
});

const accordionTabs = [...document.querySelectorAll("[data-accordion-tab]")];
const accordionToggles = [...document.querySelectorAll("[data-accordion-toggle]")];
const accordionPanels = [...document.querySelectorAll("[data-accordion-panel]")];
const whyStatus = document.getElementById("whyStatus");
const savingsStatus = document.getElementById("savingsStatus");

function showBookingAccordion(panelName) {
  accordionTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.accordionTab === panelName);
  });
  accordionPanels.forEach((panel) => {
    const active = panel.dataset.accordionPanel === panelName;
    panel.classList.toggle("active", active);
    const body = panel.querySelector(".accordion-body");
    if (body) body.hidden = !active;
    const chevron = panel.querySelector(".accordion-head b");
    if (chevron) chevron.textContent = active ? "⌃" : "⌄";
  });
  if (whyStatus) whyStatus.textContent = "";
  if (savingsStatus) savingsStatus.textContent = "";
}

accordionTabs.forEach((button) => {
  button.addEventListener("click", () => showBookingAccordion(button.dataset.accordionTab));
});

accordionToggles.forEach((button) => {
  button.addEventListener("click", () => showBookingAccordion(button.dataset.accordionToggle));
});

document.getElementById("applyStudentSavings")?.addEventListener("click", () => {
  showBookingAccordion("why");
  whyStatus.textContent = "Student savings are already applied to this booking.";
});

document.getElementById("activateSavingsTool")?.addEventListener("click", () => {
  showBookingAccordion("savings");
  savingsStatus.textContent = "Savings tools enabled. Open Modify Reservation to review cheaper dates and alerts.";
});

accordionPanels.forEach((panel) => {
  panel.classList.remove("active");
  const body = panel.querySelector(".accordion-body");
  if (body) body.hidden = true;
});

const pickupSearch = document.getElementById("pickupSearch");
const pickupRecords = [...document.querySelectorAll(".pickup-record")];
const adminUserSearch = document.getElementById("adminUserSearch");
const adminUserCards = [...document.querySelectorAll("[data-admin-user-card]")];

pickupSearch?.addEventListener("input", () => {
  const query = pickupSearch.value.trim().toLowerCase();
  pickupRecords.forEach((record) => {
    record.hidden = query && !record.dataset.search.includes(query);
  });
});

adminUserSearch?.addEventListener("input", () => {
  const query = adminUserSearch.value.trim().toLowerCase();
  adminUserCards.forEach((card) => {
    card.hidden = query && !card.dataset.search.includes(query);
  });
});

document.querySelectorAll("[data-print-record]").forEach((button) => {
  button.addEventListener("click", () => {
    pickupRecords.forEach((record) => record.classList.remove("is-printing"));
    button.closest(".pickup-record")?.classList.add("is-printing");
    window.print();
  });
});

document.querySelectorAll("[data-dl-camera], [data-photo-capture]").forEach((input) => {
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    const field = input.closest(".dl-capture-field");
    const target = field?.querySelector("input[type='hidden']");
    const status = field?.querySelector("small");
    if (!file || !target) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 1200;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context?.drawImage(image, 0, 0, canvas.width, canvas.height);
        target.value = canvas.toDataURL("image/jpeg", 0.78);
        if (status) status.textContent = "Picture ready to save";
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
});

function pickupFieldLabel(name) {
  const labels = {
    customer_name: "customer name",
    address: "address",
    date_of_birth: "date of birth",
    license_number: "DL number",
    license_state: "DL state",
    license_expiry: "DL expiry",
    insurance_provider: "insurance provider",
    insurance_type: "insurance type",
    coverage_amount: "coverage amount",
  };
  return labels[name] || name.replace(/_/g, " ");
}

document.querySelectorAll("[data-pickup-prefill-button]").forEach((button) => {
  button.addEventListener("click", async () => {
    const form = button.closest(".pickup-form");
    const panel = button.closest("[data-pickup-prefill]");
    const status = panel?.querySelector("[data-pickup-prefill-status]");
    if (!form) return;
    const payload = new URLSearchParams();
    ["front_image_url", "back_image_url", "insurance_document_url"].forEach((name) => {
      const input = form.querySelector(`input[name="${name}"]`);
      if (input instanceof HTMLInputElement && input.value) payload.set(name, input.value);
    });
    if (!payload.toString()) {
      if (status) status.textContent = "Take or upload DL/insurance photos first.";
      return;
    }
    button.disabled = true;
    if (status) status.textContent = "Reading photos...";
    try {
      const response = await fetch("/admin/pickup/prefill", {
        method: "POST",
        body: payload,
        headers: {
          Accept: "application/json",
          "X-Requested-With": "fetch",
        },
      });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.message || "Photo prefill failed.");
      const fields = result.fields || {};
      const filled = [];
      Object.entries(fields).forEach(([name, value]) => {
        const input = form.querySelector(`[name="${name}"]`);
        if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement)) return;
        if (input.value.trim()) return;
        input.value = String(value || "");
        if (input.value) filled.push(pickupFieldLabel(name));
      });
      const missing = Array.isArray(result.missing_fields) ? result.missing_fields.filter(Boolean) : [];
      const filledCopy = filled.length ? `Filled: ${filled.join(", ")}.` : "No blank fields were filled.";
      const missingCopy = missing.length ? ` Ask user/admin for: ${missing.join(", ")}.` : "";
      if (status) status.textContent = `${filledCopy}${missingCopy} ${result.message || "Review before saving."}`;
    } catch (error) {
      if (status) status.textContent = error.message || "Photo prefill failed. Enter fields manually.";
    } finally {
      button.disabled = false;
    }
  });
});

document.querySelectorAll("[data-idscan-check-button]").forEach((button) => {
  button.addEventListener("click", async () => {
    const form = button.closest(".pickup-form");
    const panel = button.closest("[data-idscan-check]");
    const status = panel?.querySelector("[data-idscan-status]");
    if (!form) return;
    const payload = new URLSearchParams();
    ["booking_id", "front_image_url", "back_image_url"].forEach((name) => {
      const input = form.querySelector(`input[name="${name}"]`);
      if (input instanceof HTMLInputElement && input.value) payload.set(name, input.value);
    });
    button.disabled = true;
    if (status) status.textContent = "Sending DL images to IDScan...";
    try {
      const response = await fetch("/admin/identity/idscan", {
        method: "POST",
        body: payload,
        headers: {
          Accept: "application/json",
          "X-Requested-With": "fetch",
        },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "IDScan verification failed.");
      if (status) status.textContent = `${result.status || "REVIEW_REQUIRED"}: ${result.message || "Check saved."}`;
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      if (status) status.textContent = error.message || "IDScan verification failed.";
    } finally {
      button.disabled = false;
    }
  });
});

function initAppFeedbackWidget() {
  if (document.getElementById("appFeedbackWidget")) return;
  const widget = document.createElement("section");
  widget.className = "app-feedback-widget";
  widget.id = "appFeedbackWidget";
  widget.innerHTML = `
    <button class="app-feedback-tab" type="button" aria-expanded="false" aria-controls="appFeedbackPanel">
      <span>Website Feedback</span>
    </button>
    <form class="app-feedback-panel" id="appFeedbackPanel" hidden>
      <div class="app-feedback-head">
        <div>
          <b>Rate this website</b>
          <span>Leave your valuable website feedback</span>
        </div>
        <button type="button" class="app-feedback-close" aria-label="Close feedback">x</button>
      </div>
      <div class="app-feedback-stars" role="radiogroup" aria-label="Rate this website">
        ${[1, 2, 3, 4, 5].map((value) => `<button type="button" role="radio" data-feedback-rating="${value}" aria-checked="false" aria-label="${value} star${value === 1 ? "" : "s"}">★</button>`).join("")}
      </div>
      <input type="hidden" name="rating" value="">
      <label>
        <span>Your feedback</span>
        <textarea name="message" rows="4" maxlength="1200" placeholder="Tell us what felt good, confusing, or missing."></textarea>
      </label>
      <button class="app-feedback-submit" type="submit">Submit feedback</button>
      <p class="app-feedback-status" aria-live="polite"></p>
    </form>
  `;
  document.body.appendChild(widget);

  const tab = widget.querySelector(".app-feedback-tab");
  const panel = widget.querySelector(".app-feedback-panel");
  const close = widget.querySelector(".app-feedback-close");
  const ratingInput = widget.querySelector("input[name='rating']");
  const stars = [...widget.querySelectorAll("[data-feedback-rating]")];
  const status = widget.querySelector(".app-feedback-status");

  const setOpen = (open) => {
    panel.hidden = !open;
    tab.setAttribute("aria-expanded", open ? "true" : "false");
    widget.classList.toggle("is-open", open);
  };

  const setRating = (rating) => {
    ratingInput.value = String(rating);
    stars.forEach((star) => {
      const active = Number(star.dataset.feedbackRating) <= rating;
      star.classList.toggle("is-active", active);
      star.setAttribute("aria-checked", Number(star.dataset.feedbackRating) === rating ? "true" : "false");
    });
  };

  tab.addEventListener("click", () => setOpen(panel.hidden));
  close.addEventListener("click", () => setOpen(false));
  stars.forEach((star) => {
    star.addEventListener("click", () => setRating(Number(star.dataset.feedbackRating || 0)));
  });

  panel.addEventListener("submit", (event) => {
    event.preventDefault();
    const rating = Number(ratingInput.value || 0);
    if (!rating) {
      status.textContent = "Please choose a star rating first.";
      return;
    }
    status.textContent = "Sending feedback...";
    const formData = new FormData(panel);
    formData.set("page", window.location.pathname);
    fetch("/feedback", {
      method: "POST",
      body: new URLSearchParams(formData),
    })
      .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
      .then((payload) => {
        status.textContent = payload.message || "Thank you for your valuable website feedback.";
        window.setTimeout(() => setOpen(false), 1400);
      })
      .catch((payload) => {
        status.textContent = payload?.message || "Feedback could not be submitted right now.";
      });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) setOpen(false);
  });
}

initAppFeedbackWidget();

function initWikiAgentWidget() {
  if (document.getElementById("wikiAgentWidget")) return;
  const prompts = [
    "cheapest cars",
    "cancel my booking",
    "my pickup time",
    "refund policy",
    "book an SUV",
    "Explorer memories",
    "pickup documents",
    "support help",
  ];
  const widget = document.createElement("section");
  widget.className = "wiki-agent-widget";
  widget.id = "wikiAgentWidget";
  widget.innerHTML = `
    <button class="wiki-agent-backdrop" type="button" aria-label="Close FairFares Assistant" hidden></button>
    <div class="wiki-agent-prompt" aria-live="polite"><span>${prompts[0]}</span></div>
    <button class="wiki-agent-orb" type="button" aria-expanded="false" aria-controls="wikiAgentPanel" aria-label="Ask FairFares Assistant">
      <b>Ask</b>
    </button>
    <form class="wiki-agent-panel" id="wikiAgentPanel" hidden>
      <div class="wiki-agent-head">
        <div>
          <b>FairFares Assistant</b>
          <span>Ask about cars, bookings, refunds, Explorer trips, discounts, or support. Actions still ask you to confirm.</span>
        </div>
        <button type="button" class="wiki-agent-close" aria-label="Close FairFares Assistant">x</button>
      </div>
      <div class="wiki-agent-chips" aria-label="Suggested questions">
        ${prompts.slice(0, 6).map((prompt) => `<button type="button" data-agent-question="${prompt}">${prompt}</button>`).join("")}
      </div>
      <label>
        <span>Your question</span>
        <input name="question" autocomplete="off" placeholder="Ask to book, cancel, compare cars, or find a policy">
      </label>
      <button class="wiki-agent-submit" type="submit">Ask</button>
      <div class="wiki-agent-answer" aria-live="polite">Pick a suggestion or ask anything about FairFares.</div>
      <div class="wiki-agent-actions" aria-label="Assistant actions"></div>
    </form>
  `;
  document.body.appendChild(widget);

  const backdrop = widget.querySelector(".wiki-agent-backdrop");
  const promptBubble = widget.querySelector(".wiki-agent-prompt");
  const promptText = promptBubble?.querySelector("span");
  const orb = widget.querySelector(".wiki-agent-orb");
  const panel = widget.querySelector(".wiki-agent-panel");
  const close = widget.querySelector(".wiki-agent-close");
  const input = widget.querySelector("input[name='question']");
  const answer = widget.querySelector(".wiki-agent-answer");
  const actionsBox = widget.querySelector(".wiki-agent-actions");
  const submit = widget.querySelector(".wiki-agent-submit");
  let promptIndex = 0;

  const setOpen = (open) => {
    panel.hidden = !open;
    backdrop.hidden = !open;
    orb.setAttribute("aria-expanded", open ? "true" : "false");
    widget.classList.toggle("is-open", open);
    if (open) input?.focus();
  };

  const rotatePrompt = () => {
    if (!promptBubble || !promptText || widget.classList.contains("is-open")) return;
    promptBubble.classList.add("is-switching");
    window.setTimeout(() => {
      promptIndex = (promptIndex + 1) % prompts.length;
      promptText.textContent = prompts[promptIndex];
      promptBubble.classList.remove("is-switching");
    }, 240);
  };

  window.setInterval(rotatePrompt, 2000);
  orb.addEventListener("click", () => setOpen(panel.hidden));
  close.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));

  widget.querySelectorAll("[data-agent-question]").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.dataset.agentQuestion || "";
      panel.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  });

  panel.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) {
      answer.textContent = "Ask something like cheapest cars, refund policy, or Explorer memories.";
      return;
    }
    submit.disabled = true;
    answer.textContent = "Checking FairFares data...";
    if (actionsBox) actionsBox.innerHTML = "";
    fetch("/wiki/ask", {
      method: "POST",
      body: new URLSearchParams({ question }),
    })
      .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(payload)))
      .then((payload) => {
        const sourceText = Array.isArray(payload.sources) && payload.sources.length
          ? ` Sources: ${payload.sources.map((source) => source.title).join(", ")}.`
          : "";
        answer.textContent = `${payload.answer || payload.message || "No answer found."}${sourceText}`;
        if (actionsBox && Array.isArray(payload.actions)) {
          actionsBox.innerHTML = payload.actions
            .map((action) => `<a href="${action.href || "#"}" data-agent-action="${action.kind || "open"}">${action.label || "Open"}</a>`)
            .join("");
        }
      })
      .catch((payload) => {
        answer.textContent = payload?.message || "FairFares Assistant could not answer right now.";
      })
      .finally(() => {
        submit.disabled = false;
      });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) setOpen(false);
  });
}

initWikiAgentWidget();

function openManageTabFromAgentQuery() {
  const params = new URLSearchParams(window.location.search);
  const target = params.get("agent") || window.location.hash.replace("#", "");
  if (!target) return;
  const allowed = new Set(["modify", "cancel", "documents", "details", "support"]);
  if (!allowed.has(target)) return;
  if (typeof showManagePanel === "function") {
    showManagePanel(target);
  }
}

openManageTabFromAgentQuery();

function initPublicHeaderCompactMode() {
  const topBrand = document.querySelector(".top-brand");
  const mainNav = document.querySelector(".main-nav");
  if (!topBrand || !mainNav) return;

  const update = () => {
    document.body.classList.toggle("public-header-compact", window.scrollY > 72);
  };

  update();
  window.addEventListener("scroll", update, { passive: true });
}

initPublicHeaderCompactMode();
