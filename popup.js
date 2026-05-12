const STORAGE_KEY = "marketplaceCopyHelper.listings";
const GOAL_STORAGE_KEY = "marketplaceCopyHelper.shoppingGoal";
const LATEST_ANALYSIS_KEY = "marketplaceCopyHelper.latestGeminiAnalysis";
const MAX_SELECTED_LISTINGS = 10;

const countElement = document.getElementById("listing-count");
const alertBoxElement = document.getElementById("alert-box");
const settingsToggleButton = document.getElementById("settings-toggle");
const settingsPanelElement = document.getElementById("settings-panel");
const shoppingGoalInput = document.getElementById("shopping-goal");
const geminiApiKeyInput = document.getElementById("gemini-api-key");
const saveGeminiSettingsButton = document.getElementById("save-gemini-settings");
const clearGeminiSettingsButton = document.getElementById("clear-gemini-settings");
const saveButton = document.getElementById("save-current");
const analyzeGeminiButton = document.getElementById("analyze-gemini");
const selectNewestButton = document.getElementById("select-newest");
const removeLastButton = document.getElementById("remove-last");
const exportButton = document.getElementById("export-csv");
const downloadReportButton = document.getElementById("download-report");
const clearButton = document.getElementById("clear-listings");
const comparisonSummaryElement = document.getElementById("comparison-summary");
const selectionSummaryElement = document.getElementById("selection-summary");
const comparisonListElement = document.getElementById("comparison-list");
const aiResultsElement = document.getElementById("ai-results");
const resultsSummaryElement = document.getElementById("results-summary");
const analysisModelElement = document.getElementById("analysis-model");

let goalSaveTimer = 0;
let selectedListingIds = new Set();
let currentListings = [];
let latestAnalysis = null;
let isAnalyzing = false;
let alertClearTimer = 0;

document.addEventListener("DOMContentLoaded", initializePopup);
document.addEventListener("keydown", handleDocumentKeydown);
document.addEventListener("click", handleOutsideSettingsClick);
addSafeListener(settingsToggleButton, "click", toggleSettingsPanel);
addSafeListener(shoppingGoalInput, "input", scheduleShoppingGoalSave);
addSafeListener(shoppingGoalInput, "change", saveShoppingGoal);
addSafeListener(saveGeminiSettingsButton, "click", saveGeminiSettings);
addSafeListener(clearGeminiSettingsButton, "click", clearGeminiSettings);
addSafeListener(saveButton, "click", saveCurrentListing);
addSafeListener(analyzeGeminiButton, "click", analyzeSelectedListings);
addSafeListener(selectNewestButton, "click", selectNewestListings);
addSafeListener(removeLastButton, "click", removeLastListing);
addSafeListener(exportButton, "click", exportCsv);
addSafeListener(downloadReportButton, "click", downloadTextReport);
addSafeListener(clearButton, "click", clearListings);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (changes[STORAGE_KEY]) {
    refreshListingsView();
  }
  if (changes[LATEST_ANALYSIS_KEY]) {
    latestAnalysis = changes[LATEST_ANALYSIS_KEY].newValue || null;
    renderAnalysis(latestAnalysis);
  }
});

function addSafeListener(element, eventName, handler) {
  if (element) {
    element.addEventListener(eventName, handler);
  }
}

function toggleSettingsPanel(event) {
  event?.stopPropagation();
  const isOpen = Boolean(settingsPanelElement && !settingsPanelElement.hidden);
  if (isOpen) {
    closeSettingsPanel();
  } else {
    openSettingsPanel();
  }
}

function openSettingsPanel() {
  if (!settingsPanelElement || !settingsToggleButton) {
    return;
  }
  settingsPanelElement.hidden = false;
  settingsToggleButton.setAttribute("aria-expanded", "true");
}

function closeSettingsPanel() {
  if (!settingsPanelElement || !settingsToggleButton) {
    return;
  }
  settingsPanelElement.hidden = true;
  settingsToggleButton.setAttribute("aria-expanded", "false");
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape") {
    closeSettingsPanel();
  }
}

function handleOutsideSettingsClick(event) {
  if (!settingsPanelElement || settingsPanelElement.hidden) {
    return;
  }
  const target = event.target;
  if (
    target instanceof Node &&
    !settingsPanelElement.contains(target) &&
    !settingsToggleButton?.contains(target)
  ) {
    closeSettingsPanel();
  }
}

async function initializePopup() {
  const [settingsResponse, stored] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_GEMINI_SETTINGS" }).catch((error) => ({
      ok: false,
      error: error.message
    })),
    chrome.storage.local.get({
      [GOAL_STORAGE_KEY]: "",
      [LATEST_ANALYSIS_KEY]: null
    })
  ]);

  if (shoppingGoalInput) {
    shoppingGoalInput.value = stored[GOAL_STORAGE_KEY] || "";
  }
  latestAnalysis = stored[LATEST_ANALYSIS_KEY] || null;

  if (settingsResponse?.ok && geminiApiKeyInput) {
    geminiApiKeyInput.value = settingsResponse.settings?.apiKey || "";
  }

  await refreshListingsView();
  renderAnalysis(latestAnalysis);
}

async function saveCurrentListing() {
  showAlert("Saving current listing...", "info");
  setBusy(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_ACTIVE_LISTING"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not save this listing.");
    }

    countElement.textContent = String(response.count);
    await refreshListingsView();
    showAlert("Saved current listing.", "success");
  } catch (error) {
    showAlert(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function saveGeminiSettings() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_GEMINI_SETTINGS",
      settings: {
        apiKey: geminiApiKeyInput?.value || ""
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not save Gemini settings.");
    }
    showAlert("Gemini API key saved locally.", "success");
    closeSettingsPanel();
    updateSelectionState();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function clearGeminiSettings() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "CLEAR_GEMINI_SETTINGS"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not clear Gemini settings.");
    }
    if (geminiApiKeyInput) {
      geminiApiKeyInput.value = "";
    }
    showAlert("Gemini API key cleared from Chrome storage.", "success");
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function analyzeSelectedListings() {
  const selectedListings = currentListings.filter((listing) =>
    selectedListingIds.has(listing.listingId)
  );

  if (selectedListings.length === 0) {
    showAlert("Select at least one listing to analyze.", "warning");
    return;
  }
  if (selectedListings.length > MAX_SELECTED_LISTINGS) {
    showAlert(`Select ${MAX_SELECTED_LISTINGS} or fewer listings.`, "warning");
    return;
  }

  showAlert(`Sending ${selectedListings.length} listing${selectedListings.length === 1 ? "" : "s"} to Gemini...`, "info");
  setBusy(true);
  isAnalyzing = true;
  renderAnalysisLoading();

  try {
    await saveGeminiSettingsForAnalysis();
    const response = await chrome.runtime.sendMessage({
      type: "ANALYZE_LISTINGS_WITH_GEMINI",
      payload: {
        shoppingGoal: getShoppingGoal(),
        listings: selectedListings.map(formatListingForGemini)
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Gemini analysis failed.");
    }

    latestAnalysis = response.analysis;
    renderAnalysis(latestAnalysis);
    showAlert("Gemini analysis complete.", "success");
  } catch (error) {
    renderAnalysis(latestAnalysis);
    showAlert(error.message, "error");
  } finally {
    isAnalyzing = false;
    setBusy(false);
  }
}

async function saveGeminiSettingsForAnalysis() {
  const response = await chrome.runtime.sendMessage({
    type: "SAVE_GEMINI_SETTINGS",
    settings: {
      apiKey: geminiApiKeyInput?.value || ""
    }
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Could not save Gemini settings.");
  }
}

async function copyAllListings() {
  const listings = await getHydratedListings();
  if (listings.length === 0) {
    setStatus("No saved listings to copy.");
    return;
  }

  const text = formatListingsForChatGPT(listings);
  await copyText(text);
  setStatus(`Copied ${listings.length} listing${listings.length === 1 ? "" : "s"}.`);
}

async function copyAnalysisPrompt() {
  const listings = await getHydratedListings();
  if (listings.length === 0) {
    setStatus("Save at least one listing before copying an analysis prompt.");
    return;
  }

  const prompt = buildAnalysisPrompt(getShoppingGoal(), listings);
  await copyText(prompt);
  setStatus("Copied analysis prompt.");
}

async function downloadTextReport() {
  const listings = await getHydratedListings();
  if (listings.length === 0) {
    setStatus("No saved listings to include in a report.");
    return;
  }

  const report = latestAnalysis
    ? formatGeminiReport(latestAnalysis, listings)
    : buildAnalysisPrompt(getShoppingGoal(), listings);
  const url = URL.createObjectURL(
    new Blob([report], { type: "text/plain;charset=utf-8" })
  );
  const date = new Date().toISOString().slice(0, 10);

  await chrome.downloads.download({
    url,
    filename: `marketplace-analysis-${date}.txt`,
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 30000);
  setStatus("Downloaded text report.");
}

async function removeLastListing() {
  const listings = await getHydratedListings();
  if (listings.length === 0) {
    setStatus("No saved listings to remove.");
    return;
  }

  const lastListing = listings[listings.length - 1];
  const response = await chrome.runtime.sendMessage({ type: "REMOVE_LAST_LISTING" });
  if (!response?.ok) {
    setStatus(response?.error || "Could not remove the last saved listing.");
    return;
  }

  selectedListingIds.delete(lastListing.listingId);
  countElement.textContent = String(response.count);
  await refreshListingsView();
  setStatus(`Removed: ${lastListing.title || "last saved listing"}`);
}

async function removeSavedListing(listing) {
  const response = await chrome.runtime.sendMessage({
    type: "REMOVE_LISTING",
    listingId: listing.listingId
  });
  if (!response?.ok) {
    showAlert(response?.error || "Could not remove that saved listing.", "error");
    return;
  }

  selectedListingIds.delete(listing.listingId);
  if (countElement) {
    countElement.textContent = String(response.count);
  }
  await refreshListingsView();
  showAlert(`Removed: ${listing.title || "saved listing"}`, "success");
}

async function exportCsv() {
  const listings = await getHydratedListings();
  if (listings.length === 0) {
    setStatus("No saved listings to export.");
    return;
  }

  const csv = buildCsv(listings);
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" })
  );
  const date = new Date().toISOString().slice(0, 10);

  await chrome.downloads.download({
    url,
    filename: `marketplace-listings-${date}.csv`,
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 30000);
  setStatus(`Exported ${listings.length} listing${listings.length === 1 ? "" : "s"}.`);
}

async function clearListings() {
  const listings = await getHydratedListings();
  if (listings.length === 0) {
    setStatus("No saved listings to clear.");
    return;
  }

  if (!confirm(`Clear ${listings.length} saved listing${listings.length === 1 ? "" : "s"}?`)) {
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "CLEAR_LISTINGS" });
  if (!response?.ok) {
    setStatus(response?.error || "Could not clear saved listings.");
    return;
  }

  selectedListingIds.clear();
  countElement.textContent = "0";
  await refreshListingsView();
  setStatus("Cleared saved listings.");
}

async function refreshListingsView() {
  currentListings = await getHydratedListings();
  pruneSelectedListings();
  countElement.textContent = String(currentListings.length);
  renderComparison(currentListings);
  updateSelectionState();
}

async function getHydratedListings() {
  return (await getListings()).map(hydrateListing);
}

async function getListings() {
  const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

function selectNewestListings() {
  selectedListingIds = new Set(
    currentListings.slice(-MAX_SELECTED_LISTINGS).map((listing) => listing.listingId)
  );
  renderComparison(currentListings);
  updateSelectionState();
  setStatus(`Selected newest ${selectedListingIds.size} listing${selectedListingIds.size === 1 ? "" : "s"}.`);
}

function clearSelectedListings() {
  selectedListingIds.clear();
  renderComparison(currentListings);
  updateSelectionState();
  setStatus("Selection cleared.");
}

function pruneSelectedListings() {
  const validIds = new Set(currentListings.map((listing) => listing.listingId));
  selectedListingIds = new Set(
    Array.from(selectedListingIds).filter((listingId) => validIds.has(listingId))
  );
}

function scheduleShoppingGoalSave() {
  clearTimeout(goalSaveTimer);
  goalSaveTimer = setTimeout(() => {
    saveShoppingGoal();
  }, 250);
}

function saveShoppingGoal() {
  clearTimeout(goalSaveTimer);
  chrome.storage.local.set({ [GOAL_STORAGE_KEY]: getShoppingGoal() });
}

function getShoppingGoal() {
  return MarketplaceCopyHelperParser.normalizeInlineText(shoppingGoalInput.value || "");
}

function renderComparison(listings) {
  comparisonListElement.replaceChildren();
  comparisonSummaryElement.textContent = buildComparisonSummary(listings);

  if (listings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Save Marketplace listings, then select up to 10 for Gemini.";
    comparisonListElement.append(empty);
    return;
  }

  listings.forEach((listing, index) => {
    comparisonListElement.append(buildListingCard(listing, index));
  });
}

function buildListingCard(listing, index) {
  const card = document.createElement("article");
  card.className = "listing-card";
  if (selectedListingIds.has(listing.listingId)) {
    card.classList.add("is-selected");
  }

  const selector = document.createElement("label");
  selector.className = "listing-selector";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selectedListingIds.has(listing.listingId);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked && selectedListingIds.size >= MAX_SELECTED_LISTINGS) {
      checkbox.checked = false;
      setStatus(`Gemini can analyze up to ${MAX_SELECTED_LISTINGS} listings at once.`);
      return;
    }
    if (checkbox.checked) {
      selectedListingIds.add(listing.listingId);
    } else {
      selectedListingIds.delete(listing.listingId);
    }
    renderComparison(currentListings);
    updateSelectionState();
  });

  selector.append(checkbox, document.createTextNode("Analyze"));

  const cardActions = document.createElement("div");
  cardActions.className = "listing-card-actions";
  cardActions.append(selector);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "trash-button";
  deleteButton.setAttribute("aria-label", `Delete ${listing.title || `saved listing ${index + 1}`}`);
  deleteButton.textContent = "🗑";
  deleteButton.addEventListener("click", () => {
    removeSavedListing(listing).catch((error) => showAlert(error.message, "error"));
  });
  cardActions.append(deleteButton);

  const media = document.createElement("div");
  media.className = "listing-media";

  if (listing.thumbnailUrl) {
    const image = document.createElement("img");
    image.src = listing.thumbnailUrl;
    image.alt = "";
    image.loading = "lazy";
    media.append(image);
  } else {
    media.textContent = String(index + 1);
  }

  const body = document.createElement("div");
  body.className = "listing-body";

  const titleRow = document.createElement("div");
  titleRow.className = "listing-title-row";

  const title = document.createElement(listing.url ? "a" : "h3");
  title.className = "listing-title";
  title.textContent = listing.title || `Saved listing ${index + 1}`;
  if (listing.url) {
    title.href = listing.url;
    title.target = "_blank";
    title.rel = "noreferrer";
  }

  const price = document.createElement("span");
  price.className = "listing-price";
  price.textContent = listing.price || "No price";

  titleRow.append(title, price);

  const facts = document.createElement("dl");
  facts.className = "listing-facts";
  addFact(facts, "Condition", listing.condition || "Unknown");
  addFact(facts, "Location", listing.location || "Unknown");

  const description = document.createElement("p");
  description.className = "listing-description";
  description.textContent = getShortDescription(listing);

  body.append(cardActions, titleRow, facts, description);
  card.append(media, body);

  return card;
}

function renderAnalysis(analysis) {
  aiResultsElement.replaceChildren();

  if (!analysis || !Array.isArray(analysis.topItems) || analysis.topItems.length === 0) {
    resultsSummaryElement.textContent = "Run Gemini analysis to reveal the top 3.";
    analysisModelElement.textContent = "Not run";

    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "AI results will appear here with pros, cons, offers, questions, and seller messages.";
    aiResultsElement.append(empty);
    return;
  }

  resultsSummaryElement.textContent = analysis.summary || "Gemini ranked your selected listings.";
  analysisModelElement.textContent = analysis.model || "Gemini";

  analysis.topItems.slice(0, 3).forEach((item, index) => {
    aiResultsElement.append(buildResultCard(item, index));
  });

  if (Array.isArray(analysis.allItems) && analysis.allItems.length > 0) {
    aiResultsElement.append(buildAllItemsSummary(analysis.allItems));
  }
}

function renderAnalysisLoading() {
  aiResultsElement.replaceChildren();
  resultsSummaryElement.textContent = "Gemini is comparing your selected listings...";
  analysisModelElement.textContent = "Running";

  const loader = document.createElement("div");
  loader.className = "analysis-loader";
  loader.innerHTML = "<span></span><span></span><span></span>";
  aiResultsElement.append(loader);
}

function buildResultCard(item, index) {
  const details = document.createElement("details");
  details.className = "result-card reveal-card";
  details.open = index === 0;

  const summary = document.createElement("summary");
  summary.className = "result-summary";

  const rank = document.createElement("span");
  rank.className = "rank-badge";
  rank.textContent = `#${item.rank || index + 1}`;

  const titleWrap = document.createElement("span");
  titleWrap.className = "result-title-wrap";

  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = item.title || `Top pick ${index + 1}`;

  const verdict = document.createElement("span");
  verdict.className = "result-verdict";
  verdict.textContent = `${formatScore(item.score)} | ${item.verdict || "Review"}`;

  titleWrap.append(title, verdict);
  summary.append(rank, titleWrap);

  const content = document.createElement("div");
  content.className = "result-content";

  const why = document.createElement("p");
  why.className = "why-ranked";
  why.textContent = item.whyItRanked || "Gemini did not provide a ranking note.";

  const metricGrid = document.createElement("div");
  metricGrid.className = "metric-grid";
  addMetric(metricGrid, "Offer", item.suggestedOffer || "Ask seller");
  addMetric(metricGrid, "Max", item.maxPrice || "Not estimated");
  addMetric(metricGrid, "Confidence", item.confidence || "Unclear");

  const columns = document.createElement("div");
  columns.className = "result-columns";
  columns.append(
    buildTextList("Pros", item.pros),
    buildTextList("Cons", item.cons),
    buildTextList("Risks", item.risks),
    buildTextList("Questions", item.sellerQuestions)
  );

  const messageBlock = document.createElement("div");
  messageBlock.className = "seller-message";

  const messageHeading = document.createElement("div");
  messageHeading.className = "message-heading";
  const messageTitle = document.createElement("strong");
  messageTitle.textContent = "Seller message";
  const copyMessageButton = document.createElement("button");
  copyMessageButton.type = "button";
  copyMessageButton.className = "small-button";
  copyMessageButton.textContent = "Copy";
  copyMessageButton.addEventListener("click", async () => {
    await copyText(item.sellerMessage || "");
    setStatus("Copied seller message.");
  });
  messageHeading.append(messageTitle, copyMessageButton);

  const messageText = document.createElement("p");
  messageText.textContent = item.sellerMessage || "No message provided.";
  messageBlock.append(messageHeading, messageText);

  const linkRow = document.createElement("div");
  linkRow.className = "result-link-row";
  if (item.url) {
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Open Marketplace listing";
    linkRow.append(link);
  }

  content.append(why, metricGrid, columns, messageBlock, linkRow);
  details.append(summary, content);
  return details;
}

function buildAllItemsSummary(items) {
  const wrapper = document.createElement("details");
  wrapper.className = "all-items-summary";

  const summary = document.createElement("summary");
  summary.textContent = "All analyzed listings";

  const list = document.createElement("ol");
  items.forEach((item) => {
    const row = document.createElement("li");
    row.textContent = `${item.title || "Listing"} - ${formatScore(item.score)} - ${item.verdict || "Review"} (${item.confidence || "confidence unclear"})`;
    list.append(row);
  });

  wrapper.append(summary, list);
  return wrapper;
}

function addMetric(container, label, value) {
  const metric = document.createElement("div");
  metric.className = "metric";
  const term = document.createElement("span");
  term.textContent = label;
  const description = document.createElement("strong");
  description.textContent = value;
  metric.append(term, description);
  container.append(metric);
}

function buildTextList(title, values) {
  const section = document.createElement("section");
  section.className = "text-list";

  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);

  const list = document.createElement("ul");
  const cleanValues = Array.isArray(values) && values.length > 0 ? values : ["Not provided."];
  cleanValues.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  });
  section.append(list);
  return section;
}

function updateSelectionState() {
  const count = selectedListingIds.size;
  if (selectionSummaryElement) {
    selectionSummaryElement.textContent = `${count} selected, ${MAX_SELECTED_LISTINGS} max for Gemini.`;
  }
  if (analyzeGeminiButton) {
    analyzeGeminiButton.disabled = isAnalyzing || count === 0 || count > MAX_SELECTED_LISTINGS;
  }
}

function addFact(container, label, value) {
  const term = document.createElement("dt");
  term.textContent = label;

  const description = document.createElement("dd");
  description.textContent = value;

  container.append(term, description);
}

function buildComparisonSummary(listings) {
  if (listings.length === 0) {
    return "No items";
  }

  const prices = listings.map((listing) => parsePriceValue(listing.price)).filter(Boolean);
  const priceSummary =
    prices.length >= 2
      ? `${formatMoney(Math.min(...prices))}-${formatMoney(Math.max(...prices))}`
      : `${listings.length} item${listings.length === 1 ? "" : "s"}`;

  return priceSummary;
}

function getMissingInfoLabel(listing) {
  const missing = getMissingInfo(listing);
  if (missing.length >= 4) {
    return `High: ${missing.join(", ")}`;
  }
  if (missing.length >= 2) {
    return `Medium: ${missing.join(", ")}`;
  }
  if (missing.length === 1) {
    return `Low: ${missing[0]}`;
  }
  return "Low";
}

function getMissingInfo(listing) {
  const missing = [];
  if (!listing.price) {
    missing.push("price");
  }
  if (!listing.condition) {
    missing.push("condition");
  }
  if (!listing.location) {
    missing.push("location");
  }
  if (!listing.sellerRating) {
    missing.push("seller");
  }
  if (!getDescriptionText(listing) || getDescriptionText(listing).length < 40) {
    missing.push("details");
  }
  return missing;
}

function getShortDescription(listing) {
  const text = getDescriptionText(listing);
  if (!text) {
    return "No useful description details found yet.";
  }
  return text.length > 170 ? `${text.slice(0, 167).trim()}...` : text;
}

function getDescriptionText(listing) {
  return MarketplaceCopyHelperParser.normalizeInlineText(
    listing.descriptionDetails || listing.description || ""
  );
}

function formatListingsForChatGPT(listings) {
  const sections = listings.map((listing, index) => formatListingForPrompt(listing, index));

  return [
    `Facebook Marketplace listings (${listings.length})`,
    "Use these saved visible listing snapshots for comparison, summarization, or analysis.",
    "",
    sections.join("\n\n---\n\n")
  ].join("\n");
}

function buildAnalysisPrompt(goal, listings) {
  const shoppingGoal =
    goal || "I am comparing these Facebook Marketplace listings and want the best purchase decision.";

  return [
    "I am comparing Facebook Marketplace listings and want practical purchase advice.",
    "",
    `What I am looking for: ${shoppingGoal}`,
    "",
    "Your job is to help me decide which item is most worth buying. This can be any product category, so infer the most relevant evaluation criteria from my goal and the listing text.",
    "",
    "Important rules:",
    "* Do not invent facts, specs, included accessories, condition details, or market values.",
    "* If information is missing or uncertain, mark it clearly and tell me what to verify with the seller.",
    "* Use normal consumer decision factors: price versus likely value, condition, repair or replacement risk, seller/location confidence, completeness of information, deal urgency, hidden costs, and whether the item matches my actual goal.",
    "* For specialized categories, adapt the criteria. For furniture, check size, transport, materials, stains, and fit. For electronics, check specs, age, battery/health, warranty, locks, accessories, and compatibility. For vehicles and sporting goods, check fit, age, components, maintenance, and safety. For appliances, check dimensions, age, install needs, and failure risk.",
    "",
    "Step 1: Clean and interpret each listing",
    "* Identify the likely product type, brand/model if available, condition, included items, location, and key unknowns.",
    "* Call out missing details that could change the buying decision.",
    "",
    "Step 2: Score every listing from 1 to 10",
    "* Goal match score",
    "* Price/value score",
    "* Condition/risk score",
    "* Seller confidence score",
    "* Convenience score",
    "* Missing-information risk score",
    "* Overall buy score",
    "",
    "Step 3: Estimate value and costs",
    "* Estimate a fair market value range when possible.",
    "* Estimate likely extra costs such as repairs, cleaning, missing accessories, transport, setup, compatibility parts, or inspection.",
    "* Calculate adjusted cost = asking price + realistic extra costs.",
    "* Label each listing as excellent value, good value, fair value, overpriced, or avoid.",
    "",
    "Step 4: Give me a ranking table",
    "Include rank, item, asking price, likely fair value range, adjusted cost, main strengths, main risks, suggested opening offer, max price I should pay, and verdict.",
    "",
    "Step 5: Deep dive the best options",
    "Give detailed notes for the top 3 to 5 listings only, including why each ranked highly, what to verify, negotiation advice, and a short Facebook Marketplace message I can send.",
    "",
    "Step 6: Final answer",
    "End with the best overall item, best value, safest pick, best item to negotiate on, riskiest item, items to avoid, and the first 3 sellers I should message.",
    "",
    "Saved listing data:",
    "",
    listings.map((listing, index) => formatListingForPrompt(listing, index)).join("\n\n---\n\n")
  ].join("\n");
}

function formatListingForPrompt(listing, index) {
  return [
    `Listing ${index + 1}`,
    `Title: ${listing.title || ""}`,
    `Price: ${listing.price || ""}`,
    `Condition: ${listing.condition || ""}`,
    `Location: ${listing.location || ""}`,
    `Seller rating: ${listing.sellerRating || ""}`,
    `Missing info risk: ${getMissingInfoLabel(listing)}`,
    `Thumbnail URL: ${listing.thumbnailUrl || ""}`,
    `URL: ${listing.url || ""}`,
    `Time copied: ${listing.timeOfCopy || ""}`,
    "",
    "Description/details:",
    listing.descriptionDetails || listing.description || "",
    "",
    "Full visible page text:",
    listing.fullText || ""
  ].join("\n");
}

function formatListingForGemini(listing) {
  return {
    listingId: listing.listingId,
    title: listing.title || "",
    price: listing.price || "",
    condition: listing.condition || "",
    location: listing.location || "",
    sellerRating: listing.sellerRating || "",
    missingInfoRisk: getMissingInfoLabel(listing),
    description: listing.descriptionDetails || listing.description || "",
    url: listing.url || "",
    timeOfCopy: listing.timeOfCopy || ""
  };
}

function formatGeminiReport(analysis, listings) {
  return [
    "Gemini Marketplace Analysis",
    `Model: ${analysis.model || ""}`,
    `Goal: ${analysis.shoppingGoal || getShoppingGoal()}`,
    `Created: ${analysis.createdAt || ""}`,
    "",
    "Summary:",
    analysis.summary || "",
    "",
    "Top picks:",
    ...(analysis.topItems || []).map((item) =>
      [
        `#${item.rank}: ${item.title}`,
        `Score: ${formatScore(item.score)}`,
        `Verdict: ${item.verdict || ""}`,
        `Suggested offer: ${item.suggestedOffer || ""}`,
        `Max price: ${item.maxPrice || ""}`,
        `Pros: ${(item.pros || []).join("; ")}`,
        `Cons: ${(item.cons || []).join("; ")}`,
        `Risks: ${(item.risks || []).join("; ")}`,
        `Questions: ${(item.sellerQuestions || []).join("; ")}`,
        `Message: ${item.sellerMessage || ""}`,
        `URL: ${item.url || ""}`
      ].join("\n")
    ),
    "",
    "Saved listing data:",
    formatListingsForChatGPT(listings)
  ].join("\n\n");
}

function buildCsv(listings) {
  const columns = [
    "title",
    "price",
    "condition",
    "descriptionDetails",
    "location",
    "sellerRating",
    "missingInfoRisk",
    "thumbnailUrl",
    "url",
    "timeOfCopy",
    "fullText"
  ];
  const rows = listings.map((listing) =>
    columns
      .map((column) => {
        const value = column === "missingInfoRisk" ? getMissingInfoLabel(listing) : listing[column];
        return escapeCsvCell(value || "");
      })
      .join(",")
  );

  return [columns.join(","), ...rows].join("\r\n");
}

function hydrateListing(listing, index) {
  const parsed = MarketplaceCopyHelperParser.parseListingText(listing.fullText || "", {
    documentTitle: listing.title || ""
  });
  const hydrated = {
    ...listing,
    title: listing.title && listing.title !== "Search results" ? listing.title : parsed.title,
    price: listing.price || parsed.price,
    condition: listing.condition || parsed.condition,
    descriptionDetails:
      listing.descriptionDetails || listing.description || parsed.descriptionDetails,
    location: listing.location || parsed.location,
    timeOfCopy: listing.timeOfCopy || formatStoredDate(listing.dateSaved),
    sellerRating: listing.sellerRating || parsed.sellerRating,
    thumbnailUrl: listing.thumbnailUrl || ""
  };

  return {
    ...hydrated,
    listingId: getListingId(hydrated, index)
  };
}

function getListingId(listing, index) {
  const source = [listing.url, listing.dateSaved, listing.title, index].filter(Boolean).join("|");
  let hash = 0;
  for (let charIndex = 0; charIndex < source.length; charIndex += 1) {
    hash = (hash * 31 + source.charCodeAt(charIndex)) >>> 0;
  }
  return `listing-${hash.toString(16)}-${index}`;
}

function parsePriceValue(value) {
  const match = String(value || "").match(/\$?([\d,]+)(?:\.\d{2})?/);
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

function formatMoney(value) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "No score";
  }
  return `${Math.round(number * 10) / 10}/10`;
}

function escapeCsvCell(value) {
  const text = String(value).replace(/\r?\n/g, "\r\n");
  return `"${text.replace(/"/g, '""')}"`;
}

function formatStoredDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (part) => String(part).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds())
  ].join("");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function setStatus(message) {
  showAlert(message, "info");
}

function showAlert(message, type = "info") {
  if (!alertBoxElement) {
    return;
  }

  clearTimeout(alertClearTimer);
  const normalizedType = ["error", "warning", "success", "info"].includes(type)
    ? type
    : "info";

  alertBoxElement.textContent = message || "";
  alertBoxElement.className = `alert alert-${normalizedType}`;
  alertBoxElement.hidden = !message;

  if (message) {
    alertClearTimer = setTimeout(clearAlert, 5000);
  }
}

function clearAlert() {
  if (!alertBoxElement) {
    return;
  }
  clearTimeout(alertClearTimer);
  alertBoxElement.textContent = "";
  alertBoxElement.hidden = true;
  alertBoxElement.className = "alert";
}

function setBusy(isBusy) {
  if (saveButton) {
    saveButton.disabled = isBusy;
  }
  if (analyzeGeminiButton) {
    analyzeGeminiButton.disabled = isBusy || selectedListingIds.size === 0;
  }
  if (saveGeminiSettingsButton) {
    saveGeminiSettingsButton.disabled = isBusy;
  }
  if (clearGeminiSettingsButton) {
    clearGeminiSettingsButton.disabled = isBusy;
  }
}
