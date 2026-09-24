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

function minimumPickupDate() {
  return pickupDate?.min || todayInputDate();
}

function nextFullHourLabel() {
  const now = new Date();
  if (now.getMinutes() || now.getSeconds() || now.getMilliseconds()) {
    now.setHours(now.getHours() + 1);
  }
  now.setMinutes(0, 0, 0);
  let hours = now.getHours();
  const period = hours >= 12 ? "PM" : "AM";
  hours %= 12;
  if (hours === 0) hours = 12;
  return `${hours}:00 ${period}`;
}

function timeTextToMinutes(timeText) {
  const [hoursText, minutesText] = timeTo24(timeText).split(":");
  return (Number(hoursText) * 60) + Number(minutesText);
}

function minimumPickupTimeToday() {
  return pickupDate?.dataset.minTimeToday || nextFullHourLabel();
}

function syncPickupTimeLimits() {
  if (!pickupDate || !pickupTime) return;
  const sameDayMinimum = minimumPickupDate();
  const isMinimumDate = pickupDate.value === sameDayMinimum;
  const minimumMinutes = timeTextToMinutes(minimumPickupTimeToday());
  let firstAllowed = "";
  Array.from(pickupTime.options).forEach((option) => {
    const disabled = isMinimumDate && timeTextToMinutes(option.value || option.textContent) < minimumMinutes;
    option.disabled = disabled;
    if (!disabled && !firstAllowed) firstAllowed = option.value || option.textContent;
  });
  if (isMinimumDate && pickupTime.selectedOptions[0]?.disabled && firstAllowed) {
    pickupTime.value = firstAllowed;
  }
}

function syncRentalDateLimits() {
  if (!pickupDate || !returnDate) return;
  const today = minimumPickupDate();
  pickupDate.min = today;
  returnDate.min = pickupDate.value && pickupDate.value > today ? pickupDate.value : today;
  if (returnDate.value && pickupDate.value && returnDate.value <= pickupDate.value) {
    const next = new Date(`${pickupDate.value}T00:00:00`);
    next.setDate(next.getDate() + 1);
    returnDate.value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  }
  syncPickupTimeLimits();
}

function setDateValidationMessage(message) {
  if (!discountMessage) return;
  discountMessage.textContent = message;
  discountMessage.classList.add("is-error");
  discountMessage.dataset.validationSource = "dates";
}

function clearDateValidationMessage() {
  if (!discountMessage || discountMessage.dataset.validationSource !== "dates") return;
  discountMessage.textContent = "";
  discountMessage.classList.remove("is-error");
  delete discountMessage.dataset.validationSource;
}

function validateRentalWindow(showMessage = true) {
  if (!pickupDate || !returnDate) return true;
  syncRentalDateLimits();
  const today = minimumPickupDate();
  let message = "";
  if (!pickupDate.value || !returnDate.value) {
    message = "Please select pickup and return dates.";
  } else if (pickupDate.value < today) {
    message = "Pickup date cannot be in the past.";
  } else {
    const pickup = new Date(`${pickupDate.value}T${timeTo24(pickupTime?.value)}`);
    const dropoff = new Date(`${returnDate.value}T${timeTo24(returnTime?.value)}`);
    const minimumTodayMinutes = timeTextToMinutes(minimumPickupTimeToday());
    if (!Number.isFinite(pickup.getTime()) || !Number.isFinite(dropoff.getTime())) {
      message = "Please select valid pickup and return dates.";
    } else if (pickupDate.value === today && timeTextToMinutes(pickupTime?.value) < minimumTodayMinutes) {
      message = `For pickup today, choose ${minimumPickupTimeToday()} or later.`;
    } else if (dropoff <= pickup) {
      message = "Return date and time must be after pickup date and time.";
    }
  }
  if (message) {
    if (showMessage) setDateValidationMessage(message);
    return false;
  }
  clearDateValidationMessage();
  return true;
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

function applySearchParamsFromUrl() {
  if (!searchForm) return;
  const params = new URLSearchParams(window.location.search);
  const fieldMap = [
    [pickupDate, "pickup_date"],
    [returnDate, "return_date"],
    [pickupTime, "pickup_time"],
    [returnTime, "return_time"],
    [locationSelect, "pickup_location"],
    [discountCode, "discount_code"],
  ];
  fieldMap.forEach(([field, key]) => {
    const value = params.get(key);
    if (field && value) field.value = value;
  });
  const requestedType = (params.get("car_type") || "").toLowerCase();
  if (requestedType) {
    typeFilters.forEach((input) => {
      input.checked = String(input.value || "").toLowerCase().includes(requestedType);
    });
  }
  if (discountCode?.value) validateDiscount();
}

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
  const bookingId = document.querySelector('#cancelForm input[name="booking_id"]')?.value || "";
  fetch("/bookings/request-cancel", { method: "POST", body: new URLSearchParams({ booking_id: bookingId }) })
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then((payload) => {
      const notice = document.getElementById("requestNotice");
      if (notice) notice.remove();
      if (bookingStatusBadge && payload.status_label) {
        bookingStatusBadge.textContent = payload.status_label;
        bookingStatusBadge.className = `status-badge ${payload.status_class || "status-confirmed"}`;
      }
      reloadManageBooking();
    });
});

document.getElementById("refreshStatus")?.addEventListener("click", () => {
  document.getElementById("statusMessage").textContent = "Live status checked just now.";
});

document.getElementById("textStatus")?.addEventListener("click", () => {
  document.getElementById("statusMessage").textContent = "Text updates enabled for this booking.";
});

if (detailTabs.length) {
  if (window.location.hash === "#housing" && document.querySelector('[data-detail-tab="housing"]')) {
    showManagePanel("details", { centerAction: false });
    showDetailPanel("housing");
    syncManageDetailJumpState(document.querySelector('[data-detail-jump="housing"]'));
  } else {
    showDetailPanel("student");
  }
}
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
        lockSavedCustomerForm(form);
        if (payload.pricing_updated) {
          window.setTimeout(() => window.location.reload(), 500);
          return;
        }
        openCheckoutPaymentWindow();
      }
      showBookingReferralModal(form, payload);
    })
    .catch((payload) => {
      if (status) status.textContent = payload?.message || "Please check your details and try again.";
    });
});

function lockSavedCustomerForm(form) {
  form.querySelectorAll("input, select, textarea").forEach((field) => {
    field.disabled = true;
  });
  form.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
}

function openCheckoutPaymentWindow() {
  const panel = document.getElementById("bookingHoldPanel");
  panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  const restartButton = document.getElementById("continueHoldButton");
  if (restartButton) {
    const status = document.getElementById("paymentHoldStatus");
    if (status) status.textContent = "Details saved. Restarting the checkout window...";
    window.setTimeout(() => restartButton.click(), 300);
    return;
  }
  const paymentForm = document.getElementById("paymentHoldForm");
  const firstPaymentButton = paymentForm?.querySelector("button");
  firstPaymentButton?.focus({ preventScroll: true });
}

const checkoutAddDriverToggle = document.getElementById("checkoutAddDriverToggle");
const checkoutDriverFields = document.querySelector(".checkout-driver-fields");
const checkoutDriverInputs = [...(checkoutDriverFields?.querySelectorAll("input, select") || [])];

function syncCheckoutDriverFields(toggle = document.getElementById("checkoutAddDriverToggle")) {
  if (!toggle) return;
  const form = toggle.closest("form") || document;
  const fieldGroup = form.querySelector(".checkout-driver-fields");
  const inputs = [...(fieldGroup?.querySelectorAll("input, select") || [])];
  const enabled = toggle.checked;
  fieldGroup?.classList.toggle("is-disabled", !enabled);
  inputs.forEach((field) => {
    field.disabled = !enabled;
  });
}

syncCheckoutDriverFields();
checkoutAddDriverToggle?.addEventListener("change", (event) => syncCheckoutDriverFields(event.currentTarget));
document.addEventListener("change", (event) => {
  if (event.target?.id === "checkoutAddDriverToggle") {
    syncCheckoutDriverFields(event.target);
  }
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

document.getElementById("securityDepositForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById("securityDepositStatus");
  const submitButton = event.submitter || form.querySelector("button[type='submit']");
  const originalLabel = submitButton ? submitButton.innerHTML : "";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = "<span>Opening secure deposit checkout...</span>";
  }
  if (status) status.textContent = "Opening Stripe to authorize the refundable $250 hold...";
  fetch("/payment/security-deposit-session", {
    method: "POST",
    body: new URLSearchParams(new FormData(form)),
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
      if (status) status.textContent = payload?.message || "Stripe deposit checkout could not be opened.";
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
      let response;
      let lastNetworkError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await fetch("/admin/identity/stripe-session", {
            method: "POST",
            body: payload,
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
              "X-Requested-With": "fetch",
            },
          });
          break;
        } catch (error) {
          lastNetworkError = error;
          if (attempt === 0) {
            if (status) status.textContent = "The server connection dropped. Retrying Stripe Identity...";
            await new Promise((resolve) => window.setTimeout(resolve, 900));
          }
        }
      }
      if (!response) {
        throw new Error(`Could not reach FairFares to start Stripe Identity. Check the connection and try again.${lastNetworkError?.message ? ` (${lastNetworkError.message})` : ""}`);
      }
      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(response.ok
          ? "FairFares returned an invalid Stripe Identity response."
          : `FairFares could not start Stripe Identity (${response.status}).`);
      }
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
      if (!result.url) throw new Error("Stripe did not return a secure checkout link.");
      if (status) status.textContent = `${result.amount || "$250.00"} authorization checkout opened. Complete it with card, Apple Pay, or Google Pay.`;
      button.textContent = "Opening Stripe...";
      window.location.href = result.url;
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

function initFairFaresFixedFooter() {
  if (document.getElementById("fairfaresFixedFooter")) return;
  const footer = document.createElement("aside");
  footer.className = "fairfares-fixed-footer";
  footer.id = "fairfaresFixedFooter";
  footer.innerHTML = `
    <button type="button" data-fixed-feedback-open><span aria-hidden="true">✎</span>Feedback</button>
    <button type="button" data-fixed-share><span aria-hidden="true">↗</span>Share</button>
    <a href="tel:+19372518688"><span aria-hidden="true">☎</span>+1 9372518688</a>
    <a href="mailto:fairfaresltd@gmail.com"><span aria-hidden="true">✉</span>fairfaresltd@gmail.com</a>
  `;
  document.body.appendChild(footer);
  footer.querySelector("[data-fixed-feedback-open]")?.addEventListener("click", () => {
    document.querySelector(".app-feedback-tab")?.click();
  });
  footer.querySelector("[data-fixed-share]")?.addEventListener("click", async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title || "FairFares", url: window.location.href });
      } else {
        await copyTextToClipboard(window.location.href);
      }
    } catch (error) {
      if (error?.name !== "AbortError") console.info("Share skipped", error);
    }
  });
}

initFairFaresFixedFooter();

function initProfileDrawer() {
  const drawer = document.querySelector("[data-profile-drawer]");
  if (!drawer) return;
  const openButtons = document.querySelectorAll("[data-profile-drawer-open]");
  const closeButtons = drawer.querySelectorAll("[data-profile-drawer-close]");
  const setOpen = (open) => {
    drawer.classList.toggle("is-open", open);
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.classList.toggle("profile-drawer-open", open);
  };
  openButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setOpen(true);
    });
  });
  closeButtons.forEach((button) => {
    button.addEventListener("click", () => setOpen(false));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.classList.contains("is-open")) setOpen(false);
  });
}

initProfileDrawer();

function initMobileHousingMoreSheet() {
  const sheet = document.querySelector("[data-mobile-more-sheet]");
  if (!sheet) return;
  const openButtons = document.querySelectorAll("[data-mobile-more-open]");
  const closeButtons = document.querySelectorAll("[data-mobile-more-close]");
  const setOpen = (open) => {
    sheet.classList.toggle("is-open", open);
    sheet.setAttribute("aria-hidden", open ? "false" : "true");
  };
  openButtons.forEach((button) => {
    button.addEventListener("click", () => setOpen(true));
  });
  closeButtons.forEach((button) => {
    button.addEventListener("click", () => setOpen(false));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sheet.classList.contains("is-open")) setOpen(false);
  });
}

initMobileHousingMoreSheet();

function initWikiAgentWidget() {
  if (document.getElementById("wikiAgentWidget")) return;
  const prompts = [
    "cheapest cars",
    "cancel my booking",
    "my pickup time",
    "refund policy",
    "book an SUV",
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
          <span>Ask about cars, bookings, refunds, discounts, or support. Actions still ask you to confirm.</span>
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
      <div class="wiki-agent-results" aria-label="Available cars"></div>
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
  const resultsBox = widget.querySelector(".wiki-agent-results");
  const actionsBox = widget.querySelector(".wiki-agent-actions");
  const submit = widget.querySelector(".wiki-agent-submit");
  let promptIndex = 0;
  const escapeAgentHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));

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
      answer.textContent = "Ask something like cheapest cars, refund policy, .";
      return;
    }
    submit.disabled = true;
    answer.textContent = "Checking FairFares data...";
    if (resultsBox) resultsBox.innerHTML = "";
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
        if (resultsBox) {
          const cards = Array.isArray(payload.cards) ? payload.cards : [];
          resultsBox.innerHTML = cards
            .map((card) => `
              <a class="wiki-agent-result-card" href="${escapeAgentHtml(card.href || "#")}">
                <img src="${escapeAgentHtml(card.image || "/static/img/booking-confirmation-promise.webp")}"
                  alt="${escapeAgentHtml(card.alt || card.title || "FairFares rental car")}"
                  loading="lazy" decoding="async">
                <span>
                  <em>${escapeAgentHtml(card.badge || "Available")}</em>
                  <b>${escapeAgentHtml(card.title || "FairFares car")}</b>
                  <small>${escapeAgentHtml(card.subtitle || "Review booking")}</small>
                </span>
                <strong>Book</strong>
              </a>
            `)
            .join("");
        }
        if (actionsBox && Array.isArray(payload.actions)) {
          actionsBox.innerHTML = payload.actions
            .map((action) => {
              const confirmAction = action.requires_confirmation === "1";
              const note = action.note || (confirmAction ? "Confirmation required." : "");
              return `
                <a href="${escapeAgentHtml(action.href || "#")}"
                  data-agent-action="${escapeAgentHtml(action.kind || "open")}"
                  data-agent-risk="${escapeAgentHtml(action.risk || "safe")}"
                  data-agent-confirm="${confirmAction ? "1" : "0"}">
                  <b>${escapeAgentHtml(action.label || "Open")}</b>
                  ${note ? `<small>${escapeAgentHtml(note)}</small>` : ""}
                </a>
              `;
            })
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

  actionsBox?.addEventListener("click", (event) => {
    const link = event.target.closest("[data-agent-action]");
    if (!link || link.dataset.agentConfirm !== "1") return;
    const message = link.querySelector("small")?.textContent || "This opens a FairFares screen where you must confirm before anything changes. Continue?";
    if (!window.confirm(message)) {
      event.preventDefault();
    }
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

function initMemberAccommodationSearch() {
  document.querySelectorAll("[data-member-accommodation-search]").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      const params = new URLSearchParams({ q: query });
      window.location.href = `/accommodations?${params.toString()}`;
    });
  });
}

initMemberAccommodationSearch();

function initPublicHeaderCompactMode() {
  const topBrand = document.querySelector(".top-brand");
  const mainNav = document.querySelector(".main-nav");
  if (!topBrand || !mainNav) return;
  if (document.body.classList.contains("public-header-compact")) return;

  const update = () => {
    document.body.classList.toggle("public-header-compact", window.scrollY > 72);
  };

  update();
  window.addEventListener("scroll", update, { passive: true });
}

initPublicHeaderCompactMode();
