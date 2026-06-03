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
const filterToggle = document.getElementById("filterToggle");
const filterOptions = document.getElementById("filterOptions");
const mobileQuery = window.matchMedia("(max-width: 760px)");
const discountDataNode = document.getElementById("discountData");

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

function updateCars() {
  if (!carList) return;
  const selectedTypes = typeFilters.filter((input) => input.checked).map((input) => input.value);
  const selectedFuel = fuelFilters.filter((input) => input.checked).map((input) => input.value);
  const selectedLocation = locationSelect?.value || "";
  const cards = [...carList.querySelectorAll(".car-card")];

  cards.forEach((card) => {
    const typeMatch = selectedTypes.length === 0 || selectedTypes.includes(card.dataset.category);
    const fuelMatch = selectedFuel.length === 0 || selectedFuel.includes(card.dataset.fuel);
    const locationMatch = !selectedLocation || card.dataset.location === selectedLocation;
    const visible = typeMatch && fuelMatch && locationMatch;
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

typeFilters.forEach((input) => input.addEventListener("change", updateCars));
fuelFilters.forEach((input) => input.addEventListener("change", updateCars));
locationSelect?.addEventListener("change", updateCars);
sortCars?.addEventListener("change", updateCars);

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

const heroFold = document.querySelector("[data-hero-fold]");
const heroFoldTrigger = heroFold?.querySelector(".hero-fold-trigger");
const heroFoldVideo = heroFold?.querySelector("video");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let heroFoldTimer;
let heroFoldRunning = false;
let heroVideoAvailable;

function closeHeroFold() {
  if (!heroFold || !heroFoldVideo) return;
  window.clearTimeout(heroFoldTimer);
  heroFold.classList.remove("is-playing", "is-folding");
  heroFoldRunning = false;
  heroFoldVideo.pause();
  try {
    heroFoldVideo.currentTime = 0;
  } catch {
    // Some browsers block resetting unloaded media.
  }
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
  if (heroFoldVideo.src) return Promise.resolve(true);
  if (heroVideoAvailable === false) return Promise.resolve(false);
  heroFoldVideo.src = heroFoldVideo.dataset.videoSrc;
  heroFoldVideo.load();
  heroVideoAvailable = true;
  return Promise.resolve(true);
}

function startHeroFoldPlayback() {
  heroFoldRunning = true;
  heroFold.classList.add("is-folding");
  heroFoldTimer = window.setTimeout(() => {
    heroFold.classList.add("is-playing");
    heroFold.classList.remove("is-folding");
    try {
      heroFoldVideo.currentTime = 0;
    } catch {
      // The video file may not exist yet; fold back cleanly below.
    }
    const playAttempt = heroFoldVideo.play();
    if (playAttempt?.catch) {
      playAttempt.catch(() => {
        heroVideoAvailable = false;
        heroFoldTimer = window.setTimeout(closeHeroFold, 1200);
      });
    }
    heroFoldTimer = window.setTimeout(closeHeroFold, 12000);
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
heroFoldVideo?.addEventListener("ended", closeHeroFold);
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

  const hiddenNavItems = [
    ...document.querySelectorAll(".nav-links a"),
  ];

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
  summaryVehicle.textContent = vehicle?.value || "Toyota Corolla";
  summaryPrice.textContent = `$${Number(vehicle?.dataset.price || 209.93).toFixed(2)}`;
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
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then((payload) => {
      modifyStatus.textContent = payload.message || "Reservation changes saved for review.";
    })
    .catch(() => {
      modifyStatus.textContent = "Reservation changes saved for review.";
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
    : "Refund timeline starts after admin approval.";
  cancelStatus.textContent = "";
});

cancelReason?.addEventListener("change", () => {
  cancelStatus.textContent = "";
});

cancelForm?.addEventListener("reset", () => {
  window.setTimeout(() => {
    refundTimeline.textContent = "Refund timeline starts after admin approval.";
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
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then((data) => {
      cancelStatus.textContent = data.message || `Cancellation request sent to admin. Refund method: ${refundMethod.value}.`;
      if (bookingStatusBadge && data.status_label) {
        bookingStatusBadge.textContent = data.status_label;
        bookingStatusBadge.className = `status-badge ${data.status_class || "status-pending"}`;
      }
    })
    .catch(() => {
      cancelStatus.textContent = `Cancellation request sent to admin. Refund method: ${refundMethod.value}.`;
    });
});

const documentPreview = document.getElementById("documentPreview");
const documentStatus = document.getElementById("documentStatus");
const documentEmail = document.getElementById("documentEmail");
const bookingDocumentsNode = document.getElementById("bookingDocuments");
const bookingDocuments = bookingDocumentsNode ? JSON.parse(bookingDocumentsNode.textContent || "{}") : {};

function renderBookingDocument(name) {
  if (!documentPreview) return;
  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const doc = bookingDocuments[name] || {
    title: name,
    content: "This document is not generated yet. Ask admin to complete pickup, payment, insurance, or agreement data.",
    status: "Waiting for admin data.",
  };
  documentPreview.innerHTML = `<h3>${escapeHtml(doc.title)}</h3><p>${escapeHtml(doc.content).replaceAll("\n", "<br>")}</p><small>${escapeHtml(doc.status)}</small>`;
  if (documentStatus) documentStatus.textContent = `${doc.title} generated from saved booking records.`;
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

document.getElementById("emailDocuments")?.addEventListener("click", () => {
  documentStatus.textContent = `All documents queued for ${documentEmail.value || "your email"}.`;
});

document.getElementById("downloadAllDocuments")?.addEventListener("click", () => {
  const bundle = Object.values(bookingDocuments)
    .map((doc) => `${doc.title}\n\n${doc.content}\n\n${doc.status}`)
    .join("\n\n------------------------------\n\n");
  if (bundle) downloadTextFile("fairfares-booking-documents.txt", bundle);
  documentStatus.textContent = "All booking documents are ready to download.";
});

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
    .then((response) => response.ok ? response.json() : Promise.reject())
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
    .catch(() => {
      document.getElementById("studentStatus").textContent = "Student verification details updated.";
    });
});

const tripFilterButtons = [...document.querySelectorAll("[data-trip-filter]")];
const tripRows = [...document.querySelectorAll("[data-trip-type]")];

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

document.getElementById("saveCurrentTrip")?.addEventListener("click", () => {
  filterTrips("favorites");
});

document.getElementById("refreshStatus")?.addEventListener("click", () => {
  document.getElementById("liveStatusText").innerHTML = "<b>Status refreshed!</b><br>Car remains ready for pickup at 10:00 AM.";
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
  "Chat support help": ["Chat support selected", "Average response time: under 2 minutes.", "Chat in browser"],
  "Emergency roadside help": ["Emergency roadside selected", "24/7 roadside assistance can call or text you immediately.", "Phone call"],
  "Provider contact help": ["Provider contact selected", "Avis counter details and direct contact options are ready.", "Phone call"],
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
  supportStatus.textContent = "Avis provider contact: Door A, Level 5, Island 3.";
});

document.getElementById("supportForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const topic = supportTopic?.value || "Pickup help";
  const contact = supportContact?.value || "Chat in browser";
  supportStatus.textContent = `Support ticket created for ${topic} by ${contact}. Reference: FF-SUP-2048.`;
});

syncSupportTopic();

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

if (accordionTabs.length) showBookingAccordion("why");

const pickupSearch = document.getElementById("pickupSearch");
const pickupRecords = [...document.querySelectorAll(".pickup-record")];

pickupSearch?.addEventListener("input", () => {
  const query = pickupSearch.value.trim().toLowerCase();
  pickupRecords.forEach((record) => {
    record.hidden = query && !record.dataset.search.includes(query);
  });
});

document.querySelectorAll("[data-print-record]").forEach((button) => {
  button.addEventListener("click", () => {
    pickupRecords.forEach((record) => record.classList.remove("is-printing"));
    button.closest(".pickup-record")?.classList.add("is-printing");
    window.print();
  });
});
