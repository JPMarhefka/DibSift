(function attachMarketplaceCopyHelperParser(global) {
  const DETAIL_PAIR_LABELS = new Set([
    "brand",
    "color",
    "frame material",
    "frame size",
    "material",
    "model",
    "model year",
    "type",
    "wheel size"
  ]);

  function parseListingText(fullText, options = {}) {
    const lines = normalizeText(fullText)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const detailsIndex = findAfter(lines, /^details$/i, 0);
    const listedIndex = findBefore(lines, /^listed\b.+\bin\b/i, detailsIndex);
    const locationApproxIndex = findAfter(lines, /location is approximate/i, detailsIndex);
    const sellerInfoIndex = findAfter(lines, /^seller information$/i, detailsIndex);
    const priceIndex = findPriceIndex(lines, listedIndex, detailsIndex);

    const title = extractTitle(lines, priceIndex, listedIndex, options.documentTitle);
    const price = extractPrice(lines, priceIndex);
    const location = extractLocation(lines, listedIndex, locationApproxIndex);
    const condition = extractCondition(lines, detailsIndex);
    const descriptionDetails = extractDescriptionDetails(
      lines,
      detailsIndex,
      locationApproxIndex,
      sellerInfoIndex
    );
    const sellerRating = extractSellerRating(lines, sellerInfoIndex, options.domSellerRating);

    return {
      title,
      price,
      condition,
      descriptionDetails,
      location,
      sellerRating
    };
  }

  function extractTitle(lines, priceIndex, listedIndex, documentTitle) {
    if (priceIndex > 0) {
      const candidate = previousUsefulLine(lines, priceIndex);
      if (candidate) {
        return candidate;
      }
    }

    if (listedIndex > 0) {
      const candidate = previousUsefulLine(lines, listedIndex);
      if (candidate) {
        return candidate;
      }
    }

    const cleanedDocumentTitle = normalizeInlineText(documentTitle || "")
      .replace(/\s*\|\s*Facebook Marketplace\s*$/i, "")
      .replace(/\s*\|\s*Facebook\s*$/i, "");
    if (cleanedDocumentTitle && !isIgnoredTitle(cleanedDocumentTitle)) {
      return cleanedDocumentTitle;
    }

    return firstUsefulLine(lines) || "";
  }

  function extractPrice(lines, priceIndex) {
    if (priceIndex < 0) {
      return "";
    }

    const priceMatch = lines[priceIndex].match(/\$[\d,]+(?:\.\d{2})?|FREE/i);
    return priceMatch ? priceMatch[0] : "";
  }

  function extractLocation(lines, listedIndex, locationApproxIndex) {
    if (listedIndex >= 0) {
      const listedMatch = lines[listedIndex].match(/\bin\s+(.+)$/i);
      if (listedMatch) {
        return listedMatch[1].trim();
      }
    }

    if (locationApproxIndex > 0) {
      const candidate = previousUsefulLine(lines, locationApproxIndex);
      if (candidate) {
        return candidate;
      }
    }

    const cityStateLine = lines.find((line) =>
      /\b[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(line)
    );
    return cityStateLine || "";
  }

  function extractCondition(lines, detailsIndex) {
    if (detailsIndex < 0) {
      return "";
    }

    const conditionIndex = findAfter(lines, /^condition$/i, detailsIndex + 1);
    if (conditionIndex < 0 || conditionIndex >= detailsIndex + 8) {
      return "";
    }

    return lines[conditionIndex + 1] || "";
  }

  function extractDescriptionDetails(lines, detailsIndex, locationApproxIndex, sellerInfoIndex) {
    if (detailsIndex < 0) {
      return "";
    }

    const endIndex = firstPositiveIndex([
      locationApproxIndex > 0 ? locationApproxIndex - 1 : -1,
      sellerInfoIndex
    ]);
    const detailLines = lines.slice(
      detailsIndex + 1,
      endIndex >= 0 ? endIndex : lines.length
    );
    const cleanedLines = removeConditionPair(detailLines);

    const formattedLines = [];
    for (let index = 0; index < cleanedLines.length; index += 1) {
      const line = cleanedLines[index];
      const next = cleanedLines[index + 1];

      if (isDetailPairLabel(line) && next) {
        formattedLines.push(`${line}: ${next}`);
        index += 1;
      } else {
        formattedLines.push(line);
      }
    }

    return formattedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function extractSellerRating(lines, sellerInfoIndex, domSellerRating) {
    const values = [];
    const addValue = (value) => {
      const normalized = normalizeInlineText(value || "");
      if (normalized && !values.includes(normalized)) {
        values.push(normalized);
      }
    };

    addValue(domSellerRating);

    if (sellerInfoIndex >= 0) {
      const sellerLines = lines.slice(sellerInfoIndex, sellerInfoIndex + 12);
      const reviewCount = sellerLines.find((line) => /^\(\d+\)$/.test(line));
      const highlyRated = sellerLines.find((line) => /highly rated on marketplace/i.test(line));
      addValue(reviewCount);
      addValue(highlyRated);
    }

    return values.join("; ");
  }

  function removeConditionPair(lines) {
    const output = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (/^condition$/i.test(lines[index])) {
        index += 1;
        continue;
      }
      output.push(lines[index]);
    }
    return output;
  }

  function findPriceIndex(lines, listedIndex, detailsIndex) {
    if (listedIndex > 0) {
      const nearbyIndex = findBefore(lines, looksLikePriceLine, listedIndex);
      if (nearbyIndex >= 0 && listedIndex - nearbyIndex <= 3) {
        return nearbyIndex;
      }
    }

    const searchEnd = detailsIndex > 0 ? detailsIndex : Math.min(lines.length, 40);
    return lines.findIndex((line, index) => index < searchEnd && looksLikePriceLine(line));
  }

  function looksLikePriceLine(line) {
    return /^(?:\$[\d,]+(?:\.\d{2})?|FREE)(?:\$[\d,]+(?:\.\d{2})?)?$/i.test(
      line.trim()
    );
  }

  function isDetailPairLabel(line) {
    return DETAIL_PAIR_LABELS.has(line.trim().toLowerCase());
  }

  function previousUsefulLine(lines, beforeIndex) {
    for (let index = beforeIndex - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!isIgnoredTitle(line) && !looksLikePriceLine(line)) {
        return line;
      }
    }
    return "";
  }

  function firstUsefulLine(lines) {
    return (
      lines.find(
        (line) =>
          line.length > 2 &&
          line.length < 180 &&
          !isIgnoredTitle(line) &&
          !looksLikePriceLine(line)
      ) || ""
    );
  }

  function isIgnoredTitle(text) {
    return /^(facebook|marketplace|search results|notifications|messenger|browse all|jobs|inbox|marketplace access|buying|selling|create new listing|create multiple listings|location|categories|message|save|share|menu)$/i.test(
      text.trim()
    );
  }

  function findBefore(lines, patternOrPredicate, beforeIndex) {
    if (beforeIndex < 0) {
      return -1;
    }

    const predicate = toPredicate(patternOrPredicate);
    for (let index = beforeIndex - 1; index >= 0; index -= 1) {
      if (predicate(lines[index])) {
        return index;
      }
    }
    return -1;
  }

  function findAfter(lines, patternOrPredicate, startIndex) {
    const predicate = toPredicate(patternOrPredicate);
    for (let index = Math.max(0, startIndex); index < lines.length; index += 1) {
      if (predicate(lines[index])) {
        return index;
      }
    }
    return -1;
  }

  function firstPositiveIndex(indexes) {
    return indexes.filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? -1;
  }

  function toPredicate(patternOrPredicate) {
    if (typeof patternOrPredicate === "function") {
      return patternOrPredicate;
    }
    return (line) => patternOrPredicate.test(line);
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeInlineText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  global.MarketplaceCopyHelperParser = {
    parseListingText,
    normalizeText,
    normalizeInlineText
  };
})(globalThis);
