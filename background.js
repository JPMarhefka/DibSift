const STORAGE_KEY = "marketplaceCopyHelper.listings";
const GEMINI_SETTINGS_KEY = "marketplaceCopyHelper.geminiSettings";
const LATEST_ANALYSIS_KEY = "marketplaceCopyHelper.latestGeminiAnalysis";
const GEMINI_MODEL_FALLBACKS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const GEMINI_MODEL = GEMINI_MODEL_FALLBACKS[0];
const GEMINI_503_RETRY_DELAY_MS = 900;
const MAX_ANALYSIS_LISTINGS = 10;

chrome.runtime.onInstalled.addListener(updateBadgeCount);
chrome.runtime.onStartup.addListener(updateBadgeCount);

chrome.commands.onCommand.addListener((command) => {
  if (command === "save-current-listing") {
    saveActiveListing().catch((error) => {
      console.warn("Marketplace Copy Helper:", error);
    });
    return;
  }

  if (command === "remove-last-listing") {
    removeLastListing()
      .then((response) =>
        notifyActiveTab(response.removed ? "Removed last listing" : "No saved listings to remove")
      )
      .catch((error) => {
        console.warn("Marketplace Copy Helper:", error);
      });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "SAVE_ACTIVE_LISTING") {
    saveActiveListing()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_LISTING_COUNT") {
    getListings()
      .then((listings) => sendResponse({ ok: true, count: listings.length }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CLEAR_LISTINGS") {
    chrome.storage.local
      .set({ [STORAGE_KEY]: [] })
      .then(() => updateBadgeCount())
      .then(() => sendResponse({ ok: true, count: 0 }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "REMOVE_LISTING") {
    removeListing(message.listingId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "REMOVE_LAST_LISTING") {
    removeLastListing()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_GEMINI_SETTINGS") {
    getGeminiSettings()
      .then((settings) =>
        sendResponse({
          ok: true,
          settings: {
            hasApiKey: Boolean(settings.apiKey),
            apiKey: settings.apiKey || "",
            model: GEMINI_MODEL,
            fallbackModels: GEMINI_MODEL_FALLBACKS
          }
        })
      )
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "SAVE_GEMINI_SETTINGS") {
    saveGeminiSettings(message.settings || {})
      .then(() => sendResponse({ ok: true, model: GEMINI_MODEL }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CLEAR_GEMINI_SETTINGS") {
    clearGeminiSettings()
      .then(() => sendResponse({ ok: true, model: GEMINI_MODEL }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "ANALYZE_LISTINGS_WITH_GEMINI") {
    analyzeListingsWithGemini(message.payload || {})
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function saveActiveListing() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== "number") {
    throw new Error("No active tab found.");
  }

  if (!isFacebookTab(tab.url || "")) {
    throw new Error("Open a Facebook Marketplace listing tab first.");
  }

  const response = await extractListingFromTab(tab.id);

  if (!response || !response.ok) {
    throw new Error(response?.error || "Could not read the current listing.");
  }

  const listings = await getListings();
  listings.push(response.listing);
  await chrome.storage.local.set({ [STORAGE_KEY]: listings });
  await updateBadgeCount(listings.length);

  chrome.tabs
    .sendMessage(tab.id, {
      type: "MARKETPLACE_COPY_HELPER_TOAST",
      message: "Listing saved"
    })
    .catch(() => {});

  return { ok: true, count: listings.length, listing: response.listing };
}

async function getListings() {
  const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

async function removeLastListing() {
  const listings = await getListings();
  if (listings.length === 0) {
    return { ok: true, count: 0, removed: null };
  }

  const removed = listings.pop();
  await chrome.storage.local.set({ [STORAGE_KEY]: listings });
  await updateBadgeCount(listings.length);

  return {
    ok: true,
    count: listings.length,
    removed
  };
}

async function removeListing(listingId) {
  if (!listingId) {
    throw new Error("Missing listing ID.");
  }

  const listings = await getListings();
  const index = listings.findIndex((listing, listingIndex) => {
    return getStoredListingId(listing, listingIndex) === listingId;
  });

  if (index < 0) {
    throw new Error("Could not find that saved listing.");
  }

  const [removed] = listings.splice(index, 1);
  await chrome.storage.local.set({ [STORAGE_KEY]: listings });
  await updateBadgeCount(listings.length);

  return {
    ok: true,
    count: listings.length,
    removed
  };
}

async function getGeminiSettings() {
  const result = await chrome.storage.local.get({
    [GEMINI_SETTINGS_KEY]: { apiKey: "", model: GEMINI_MODEL }
  });
  const settings = result[GEMINI_SETTINGS_KEY] || {};
  return {
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey.trim() : "",
    model: GEMINI_MODEL,
    fallbackModels: GEMINI_MODEL_FALLBACKS
  };
}

async function saveGeminiSettings(settings) {
  const apiKey = typeof settings.apiKey === "string" ? settings.apiKey.trim() : "";
  await chrome.storage.local.set({
    [GEMINI_SETTINGS_KEY]: {
      apiKey,
      model: GEMINI_MODEL,
      fallbackModels: GEMINI_MODEL_FALLBACKS,
      savedAt: new Date().toISOString()
    }
  });
}

async function clearGeminiSettings() {
  await chrome.storage.local.remove(GEMINI_SETTINGS_KEY);
}

async function analyzeListingsWithGemini(payload) {
  const settings = await getGeminiSettings();
  if (!settings.apiKey) {
    throw new Error("Add your Gemini API key before running AI analysis.");
  }

  const shoppingGoal = normalizeInlineText(payload.shoppingGoal || "");
  const listings = Array.isArray(payload.listings) ? payload.listings : [];

  if (listings.length === 0) {
    throw new Error("Select at least one saved listing to analyze.");
  }
  if (listings.length > MAX_ANALYSIS_LISTINGS) {
    throw new Error(`Gemini analysis is limited to ${MAX_ANALYSIS_LISTINGS} listings at a time.`);
  }

  const compactListings = listings.map(compactListingForGemini);
  const requestBody = buildGeminiRequestBody({
    shoppingGoal,
    listings: compactListings
  });

  const result = await runGeminiAnalysisWithFallback(settings.apiKey, requestBody);
  const cleanedAnalysis = normalizeAnalysisDealTerms(result.analysis, compactListings);
  const enrichedAnalysis = {
    ...cleanedAnalysis,
    model: result.model,
    shoppingGoal,
    listingCount: listings.length,
    createdAt: new Date().toISOString()
  };

  await chrome.storage.local.set({ [LATEST_ANALYSIS_KEY]: enrichedAnalysis });
  return { ok: true, analysis: enrichedAnalysis };
}

async function runGeminiAnalysisWithFallback(apiKey, requestBody) {
  const attemptedModels = [];
  let lastError = null;

  for (const model of GEMINI_MODEL_FALLBACKS) {
    attemptedModels.push(model);

    try {
      return await requestGeminiAnalysis(model, apiKey, requestBody);
    } catch (error) {
      lastError = error;

      if (error.status === 503) {
        await delay(GEMINI_503_RETRY_DELAY_MS);
        try {
          return await requestGeminiAnalysis(model, apiKey, requestBody);
        } catch (retryError) {
          lastError = retryError;
          if (!shouldTryNextGeminiModel(retryError)) {
            throw retryError;
          }
          continue;
        }
      }

      if (!shouldTryNextGeminiModel(error)) {
        throw error;
      }
    }
  }

  throw new Error(formatGeminiFallbackError(attemptedModels, lastError));
}

async function requestGeminiAnalysis(model, apiKey, requestBody) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(formatGeminiError(response.status, data));
    error.status = response.status;
    throw error;
  }

  const text = extractGeminiText(data);
  if (!text) {
    throw new Error("Gemini returned an empty analysis.");
  }

  const analysis = parseGeminiAnalysis(text);
  return { analysis, model };
}

function buildGeminiRequestBody(payload) {
  return {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "You are a practical Marketplace shopping assistant.",
              "Compare the selected Facebook Marketplace listings and return only JSON matching the schema.",
              "Do not invent details. Mark uncertainty clearly. Use the user's goal to infer category-specific buying factors.",
              "Rank the best three listings and include seller messages that sound natural, concise, and specific.",
              "Use score only as the overall buy score on a 0.0 to 10.0 scale, not a 0 to 1 scale. Use one decimal place when it helps distinguish close listings.",
              "For suggestedOffer, give an opening offer below the asking price when an asking price is known.",
              "For maxPrice, give the highest price the buyer should pay, usually at or below the asking price.",
              "For sellerMessage, write a direct message to the seller that includes the suggested offer and 1-2 important verification questions.",
              "",
              "Input JSON:",
              JSON.stringify(payload)
            ].join("\n")
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.35,
      responseMimeType: "application/json",
      responseJsonSchema: buildAnalysisSchema()
    }
  };
}

function buildAnalysisSchema() {
  const stringArray = {
    type: "array",
    items: { type: "string" }
  };

  const itemResult = {
    type: "object",
    properties: {
      rank: { type: "integer" },
      listingId: { type: "string" },
      title: { type: "string" },
      score: {
        type: "number",
        minimum: 0,
        maximum: 10,
        description: "Overall buy score from 0.0 to 10.0, not 0 to 1."
      },
      verdict: { type: "string" },
      confidence: { type: "string" },
      whyItRanked: { type: "string" },
      pros: stringArray,
      cons: stringArray,
      risks: stringArray,
      suggestedOffer: {
        type: "string",
        description: "Opening offer below asking price when asking price is known."
      },
      maxPrice: {
        type: "string",
        description: "Highest price the buyer should pay, usually at or below asking price."
      },
      sellerQuestions: stringArray,
      sellerMessage: {
        type: "string",
        description: "Direct seller message including the suggested offer and 1-2 verification questions."
      },
      url: { type: "string" }
    },
    required: [
      "rank",
      "listingId",
      "title",
      "score",
      "verdict",
      "confidence",
      "whyItRanked",
      "pros",
      "cons",
      "risks",
      "suggestedOffer",
      "maxPrice",
      "sellerQuestions",
      "sellerMessage",
      "url"
    ]
  };

  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      topItems: {
        type: "array",
        items: itemResult
      },
      allItems: {
        type: "array",
        items: {
          type: "object",
          properties: {
            listingId: { type: "string" },
            title: { type: "string" },
            score: {
              type: "number",
              minimum: 0,
              maximum: 10,
              description: "Overall buy score from 0.0 to 10.0, not 0 to 1."
            },
            verdict: { type: "string" },
            confidence: { type: "string" }
          },
          required: ["listingId", "title", "score", "verdict", "confidence"]
        }
      }
    },
    required: ["summary", "topItems", "allItems"]
  };
}

function compactListingForGemini(listing) {
  return {
    listingId: String(listing.listingId || ""),
    title: truncateText(listing.title, 160),
    price: truncateText(listing.price, 48),
    condition: truncateText(listing.condition, 80),
    location: truncateText(listing.location, 120),
    sellerRating: truncateText(listing.sellerRating, 120),
    missingInfoRisk: truncateText(listing.missingInfoRisk, 180),
    description: truncateText(listing.description, 1800),
    url: truncateText(listing.url, 500),
    timeOfCopy: truncateText(listing.timeOfCopy, 80)
  };
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("").trim();
}

function parseGeminiAnalysis(text) {
  try {
    const parsed = JSON.parse(text);
    return {
      summary: normalizeInlineText(parsed.summary || ""),
      topItems: Array.isArray(parsed.topItems) ? parsed.topItems.slice(0, 3) : [],
      allItems: Array.isArray(parsed.allItems) ? parsed.allItems : []
    };
  } catch {
    throw new Error("Gemini returned analysis that was not valid JSON.");
  }
}

function normalizeAnalysisDealTerms(analysis, listings) {
  const listingsById = new Map(
    listings.map((listing) => [String(listing.listingId || ""), listing])
  );

  return {
    ...analysis,
    topItems: (analysis.topItems || []).map((item) =>
      normalizeTopItemDealTerms(item, listingsById.get(String(item.listingId || "")))
    )
  };
}

function normalizeTopItemDealTerms(item, listing) {
  const askingPrice = parseMoneyAmount(listing?.price);
  const offerPrice = parseMoneyAmount(item.suggestedOffer);
  const rawMaxPrice = parseMoneyAmount(item.maxPrice);

  let normalizedOffer = offerPrice;
  let normalizedMax = rawMaxPrice;

  if (askingPrice !== null) {
    if (normalizedOffer === null || normalizedOffer >= askingPrice) {
      normalizedOffer = calculateOpeningOffer(askingPrice);
    }

    if (normalizedMax === null || normalizedMax <= normalizedOffer) {
      normalizedMax = askingPrice;
    }

    if (normalizedMax > askingPrice) {
      normalizedMax = askingPrice;
    }
  }

  const suggestedOffer =
    normalizedOffer !== null ? formatMoneyAmount(normalizedOffer) : item.suggestedOffer;
  const maxPrice = normalizedMax !== null ? formatMoneyAmount(normalizedMax) : item.maxPrice;

  return {
    ...item,
    suggestedOffer,
    maxPrice,
    sellerMessage: normalizeSellerMessage({
      item,
      listing,
      suggestedOffer
    })
  };
}

function calculateOpeningOffer(askingPrice) {
  const discounted = Math.floor(askingPrice * 0.85);
  return Math.max(0, Math.min(discounted, askingPrice - 1));
}

function normalizeSellerMessage({ item, listing, suggestedOffer }) {
  const originalMessage = normalizeInlineText(item.sellerMessage || "");
  const questions = Array.isArray(item.sellerQuestions)
    ? item.sellerQuestions.map(normalizeInlineText).filter(Boolean).slice(0, 2)
    : [];

  if (isUsableSellerMessage(originalMessage, suggestedOffer, questions)) {
    return originalMessage;
  }

  const fallbackQuestion = "Is it still available?";
  const messageQuestions = questions.length > 0 ? questions : [fallbackQuestion];
  return [
    "Hi, is this still available?",
    ...messageQuestions.filter((question) => question !== fallbackQuestion),
    suggestedOffer ? `Would you be willing to take ${suggestedOffer} for it?` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function isUsableSellerMessage(message, suggestedOffer, questions) {
  if (!message) {
    return false;
  }

  const lowerMessage = message.toLowerCase();
  const speaksToSeller =
    /\b(hi|hello|hey)\b/i.test(message) ||
    /\b(you|your|available|would you|can you|could you)\b/i.test(message);
  const includesOffer = !suggestedOffer || message.includes(suggestedOffer);
  const includesQuestion =
    message.includes("?") ||
    questions.some((question) => lowerMessage.includes(question.toLowerCase().replace(/\?$/, "")));

  return speaksToSeller && includesOffer && includesQuestion;
}

function parseMoneyAmount(value) {
  const match = String(value || "").match(/\$?\s*([\d,]+)(?:\.(\d{1,2}))?/);
  if (!match) {
    return null;
  }

  const dollars = Number(match[1].replace(/,/g, ""));
  const cents = match[2] ? Number(`0.${match[2].padEnd(2, "0")}`) : 0;
  const amount = dollars + cents;
  return Number.isFinite(amount) ? amount : null;
}

function formatMoneyAmount(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  const rounded = Math.round(value);
  return `$${rounded.toLocaleString("en-US")}`;
}

function formatGeminiError(status, data) {
  const message = data?.error?.message || "Gemini request failed.";
  if (status === 400) {
    return `Gemini could not analyze that request: ${message}`;
  }
  if (status === 401 || status === 403) {
    return "Gemini rejected the API key. Check that your key is copied correctly and enabled for the Gemini API.";
  }
  if (status === 429) {
    return "Gemini rate limit reached. Wait a bit and try again with fewer listings.";
  }
  if (status === 503) {
    return "Gemini service is temporarily overloaded or unavailable.";
  }
  return `Gemini error ${status}: ${message}`;
}

function shouldTryNextGeminiModel(error) {
  return error?.status === 429 || error?.status === 503;
}

function formatGeminiFallbackError(attemptedModels, lastError) {
  const modelList = attemptedModels.join(" -> ");
  const lastMessage = lastError?.message || "Gemini request failed.";
  return `Gemini could not complete the analysis after trying ${modelList}. Last error: ${lastMessage}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function updateBadgeCount(existingCount) {
  const count =
    typeof existingCount === "number" ? existingCount : (await getListings()).length;

  await chrome.action.setBadgeBackgroundColor({ color: "#1877f2" });
  await chrome.action.setBadgeText({
    text: count > 0 ? String(Math.min(count, 999)) : ""
  });
}

async function notifyActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  chrome.tabs
    .sendMessage(tab.id, {
      type: "MARKETPLACE_COPY_HELPER_TOAST",
      message
    })
    .catch(() => {});
}

function isFacebookTab(url) {
  try {
    return new URL(url).hostname.endsWith("facebook.com");
  } catch {
    return false;
  }
}

async function extractListingFromTab(tabId) {
  const message = { type: "EXTRACT_MARKETPLACE_LISTING" };

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["listingParser.js", "content.js"]
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

function truncateText(value, maxLength) {
  const text = normalizeInlineText(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function normalizeInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getStoredListingId(listing, index) {
  const source = [listing.url, listing.dateSaved, listing.title, index].filter(Boolean).join("|");
  let hash = 0;
  for (let charIndex = 0; charIndex < source.length; charIndex += 1) {
    hash = (hash * 31 + source.charCodeAt(charIndex)) >>> 0;
  }
  return `listing-${hash.toString(16)}-${index}`;
}
