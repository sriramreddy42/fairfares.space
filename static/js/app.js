const carList = document.getElementById("carList");
const sortCars = document.getElementById("sortCars");
const resultCount = document.getElementById("resultCount");
const typeFilters = [...document.querySelectorAll(".type-filter")];
const clearFilters = document.getElementById("clearFilters");
const searchForm = document.getElementById("searchForm");
const filterToggle = document.getElementById("filterToggle");
const filterOptions = document.getElementById("filterOptions");
const mobileQuery = window.matchMedia("(max-width: 760px)");

function updateCars() {
  if (!carList) return;
  const selectedTypes = typeFilters.filter((input) => input.checked).map((input) => input.value);
  const cards = [...carList.querySelectorAll(".car-card")];

  cards.forEach((card) => {
    const visible = selectedTypes.length === 0 || selectedTypes.includes(card.dataset.category);
    card.hidden = !visible;
  });

  cards
    .sort((a, b) => {
      const delta = Number(a.dataset.price) - Number(b.dataset.price);
      return sortCars?.value === "high" ? -delta : delta;
    })
    .forEach((card) => carList.appendChild(card));

  resultCount.textContent = cards.filter((card) => !card.hidden).length || "0";
}

typeFilters.forEach((input) => input.addEventListener("change", updateCars));
sortCars?.addEventListener("change", updateCars);
clearFilters?.addEventListener("click", () => {
  typeFilters.forEach((input) => {
    input.checked = false;
  });
  updateCars();
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
  modifyStatus.textContent = "Reservation changes saved for review.";
});

updateModifySummary();

const cancelForm = document.getElementById("cancelForm");
const cancelReason = document.getElementById("cancelReason");
const refundMethod = document.getElementById("refundMethod");
const refundTimeline = document.getElementById("refundTimeline");
const cancelStatus = document.getElementById("cancelStatus");

refundMethod?.addEventListener("change", () => {
  refundTimeline.textContent = refundMethod.value.includes("credit")
    ? "Travel credit is available immediately after cancellation."
    : "Refund arrives in 3-5 business days.";
  cancelStatus.textContent = "";
});

cancelReason?.addEventListener("change", () => {
  cancelStatus.textContent = "";
});

cancelForm?.addEventListener("reset", () => {
  window.setTimeout(() => {
    refundTimeline.textContent = "Refund arrives in 3-5 business days.";
    cancelStatus.textContent = "";
  }, 0);
});

cancelForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!cancelReason.value) {
    cancelStatus.textContent = "Choose a cancellation reason to continue.";
    return;
  }
  cancelStatus.textContent = `Cancellation request created. Refund method: ${refundMethod.value}.`;
});

const documentPreview = document.getElementById("documentPreview");
const documentStatus = document.getElementById("documentStatus");
const documentEmail = document.getElementById("documentEmail");
const documentCopy = {
  "Invoice / Receipt": "Payment summary, taxes, rental dates, and provider details.",
  "Rental Agreement": "Driver responsibilities, vehicle terms, pickup rules, and return policy.",
  "Taxes & Fees Breakdown": "Airport fee, local tax, student discount, and final total breakdown.",
};

document.addEventListener("click", (event) => {
  const docButton = event.target.closest("[data-doc-name]");
  if (!docButton) return;
  const name = docButton.dataset.docName;
  document.querySelectorAll("[data-doc-name]").forEach((button) => {
    button.classList.toggle("active", button === docButton);
  });
  documentPreview.innerHTML = `<h3>${name}</h3><p>${documentCopy[name]}</p><small>Ready to download for booking FF123456789.</small>`;
  documentStatus.textContent = `${name} is ready.`;
});

document.getElementById("emailDocuments")?.addEventListener("click", () => {
  documentStatus.textContent = `All documents queued for ${documentEmail.value || "your email"}.`;
});

document.getElementById("downloadAllDocuments")?.addEventListener("click", () => {
  documentStatus.textContent = "All booking documents are ready to download.";
});

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
  document.getElementById("studentStatus").textContent = "Student verification details updated.";
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

const whyButtons = [...document.querySelectorAll("[data-why]")];
const whyDetail = document.getElementById("whyDetail");
const whyStatus = document.getElementById("whyStatus");
const whyCopy = {
  prices: ["Best Student Prices", "Verified students get exclusive rates and discounts applied before checkout.", "Current booking savings: 15% student discount applied."],
  fees: ["No Hidden Fees", "Every required fee is shown in the booking total, including taxes and airport charges.", "Your displayed total remains $209.93 for this trip."],
  cancel: ["Free Cancellation", "Cancel before the free-cancellation deadline and keep your refund eligibility clear.", "Deadline: Jun 8, 2025 at 10:00 AM."],
  support: ["24/7 Support", "Get help through chat, roadside assistance, or provider contact at any time.", "Average chat response: under 2 minutes."],
};

function showWhyBenefit(key) {
  whyButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.why === key);
  });
  const copy = whyCopy[key] || whyCopy.prices;
  whyDetail.innerHTML = `<b>${copy[0]}</b><span>${copy[1]}</span><small>${copy[2]}</small>`;
  if (whyStatus) whyStatus.textContent = "";
}

whyButtons.forEach((button) => {
  button.addEventListener("click", () => showWhyBenefit(button.dataset.why));
});

document.getElementById("applyStudentSavings")?.addEventListener("click", () => {
  showWhyBenefit("prices");
  whyStatus.textContent = "Student savings are already applied to this booking.";
});

if (whyButtons.length) showWhyBenefit("prices");

const savingsButtons = [...document.querySelectorAll("[data-saving]")];
const savingsDetail = document.getElementById("savingsDetail");
const savingsStatus = document.getElementById("savingsStatus");
const savingsCopy = {
  dates: ["AI Cheapest Date Suggestions", "Shift your pickup or return dates to compare lower student rates.", "Potential savings: $18.40 if pickup moves by one day.", "Date suggestions enabled. Open Modify Reservation to review cheaper dates."],
  alerts: ["Price Drop Alerts", "We watch your booked route and notify you when the daily price drops.", "Watching Toyota Corolla at Denver International Airport.", "Price drop alerts enabled for this booking."],
};

function showSavingsTool(key) {
  savingsButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.saving === key);
  });
  const copy = savingsCopy[key] || savingsCopy.dates;
  savingsDetail.innerHTML = `<b>${copy[0]}</b><span>${copy[1]}</span><small>${copy[2]}</small>`;
  if (savingsStatus) savingsStatus.textContent = "";
}

savingsButtons.forEach((button) => {
  button.addEventListener("click", () => showSavingsTool(button.dataset.saving));
});

document.getElementById("activateSavingsTool")?.addEventListener("click", () => {
  const active = document.querySelector("[data-saving].active")?.dataset.saving || "dates";
  savingsStatus.textContent = savingsCopy[active][3];
});

if (savingsButtons.length) showSavingsTool("dates");
