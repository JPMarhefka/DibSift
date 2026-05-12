if (!window.__marketplaceCopyHelperInjected) {
  window.__marketplaceCopyHelperInjected = true;

const SEE_MORE_TEXT = new Set(["see more"]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "EXTRACT_MARKETPLACE_LISTING") {
    extractVisibleListing()
      .then((listing) => sendResponse({ ok: true, listing }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "MARKETPLACE_COPY_HELPER_TOAST") {
    showToast(message.message || "Saved");
    return false;
  }

  return false;
});

async function extractVisibleListing() {
  if (!isMarketplaceListingPage(location.href)) {
    throw new Error("This does not look like a Facebook Marketplace listing page.");
  }

  await expandVisibleSeeMoreButtons();
  await wait(350);

  const fullText = normalizeText(document.body?.innerText || "");
  const parsed = MarketplaceCopyHelperParser.parseListingText(fullText, {
    documentTitle: document.title,
    domSellerRating: extractSellerRatingFromDom()
  });
  const timeOfCopy = formatLocalDateTime(new Date());

  return {
    title: parsed.title,
    price: parsed.price,
    condition: parsed.condition,
    descriptionDetails: parsed.descriptionDetails,
    description: parsed.descriptionDetails,
    location: parsed.location,
    sellerRating: parsed.sellerRating,
    thumbnailUrl: extractThumbnailUrl(),
    timeOfCopy,
    url: location.href,
    dateSaved: new Date().toISOString(),
    fullText
  };
}

async function expandVisibleSeeMoreButtons() {
  const candidates = Array.from(
    document.querySelectorAll('button, [role="button"], a[role="button"]')
  ).filter((element) => {
    const text = normalizeInlineText(element.innerText || element.textContent || "");
    return isVisible(element) && SEE_MORE_TEXT.has(text.toLowerCase());
  });

  for (const element of candidates.slice(0, 12)) {
    element.click();
    await wait(120);
  }
}

function extractSellerRatingFromDom() {
  const ratingTexts = Array.from(document.querySelectorAll("[aria-label], [title]"))
    .flatMap((element) => [element.getAttribute("aria-label"), element.getAttribute("title")])
    .map(normalizeInlineText)
    .filter((text) => /(?:rating|rated|stars?|out of 5)/i.test(text));

  return ratingTexts.find((text) => /\d/.test(text)) || "";
}

function extractThumbnailUrl() {
  const imageCandidates = Array.from(document.images).map((image) => ({
    element: image,
    src: image.currentSrc || image.src || ""
  }));
  const backgroundCandidates = Array.from(document.querySelectorAll("*"))
    .map((element) => ({
      element,
      src: extractCssBackgroundUrl(getComputedStyle(element).backgroundImage)
    }))
    .filter((candidate) => candidate.src);

  const images = imageCandidates
    .concat(backgroundCandidates)
    .filter((candidate) => isVisible(candidate.element))
    .map((candidate) => {
      const rect = candidate.element.getBoundingClientRect();
      return {
        src: candidate.src,
        area: rect.width * rect.height,
        width: rect.width,
        height: rect.height
      };
    })
    .filter((image) => {
      return (
        image.src &&
        image.width >= 160 &&
        image.height >= 120 &&
        !image.src.startsWith("data:") &&
        !/static|emoji|profile|avatar/i.test(image.src)
      );
    })
    .sort((a, b) => b.area - a.area);

  return images[0]?.src || "";
}

function extractCssBackgroundUrl(backgroundImage) {
  const match = String(backgroundImage || "").match(/^url\(["']?(.+?)["']?\)$/);
  return match ? match[1] : "";
}

function formatLocalDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
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

function isMarketplaceListingPage(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.endsWith("facebook.com") &&
      /\/marketplace\/(?:item\/)?\d+|\/marketplace\/item\//.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function normalizeText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInlineText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showToast(message) {
  const existing = document.getElementById("marketplace-copy-helper-toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = "marketplace-copy-helper-toast";
  toast.textContent = message;
  toast.style.cssText = [
    "position: fixed",
    "right: 18px",
    "bottom: 18px",
    "z-index: 2147483647",
    "background: #1877f2",
    "color: #fff",
    "font: 600 14px/1.3 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "padding: 10px 14px",
    "border-radius: 8px",
    "box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22)"
  ].join(";");

  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

}
