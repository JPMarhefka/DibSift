# Deal Scout

A Chrome Manifest V3 extension for manually saving visible Facebook Marketplace listings, comparing saved items, and analyzing up to 10 selected items with Gemini.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.

## Use

1. Manually open a Facebook Marketplace listing.
2. Press `Command+Shift+S` on Mac or `Ctrl+Shift+S` on Windows, or open the extension popup and click **Save Current Listing**.
3. Open settings with the gear button, paste a Google AI Studio Gemini API key into **Gemini AI**, and click **Save Key**.
4. In the popup, describe what you are shopping for in **What are you looking for today?**
5. Select up to 10 saved items.
6. Click **Analyze with Gemini** to reveal the top 3 items with pros, cons, offer advice, seller questions, and a message draft.
7. Use the gear menu to select the newest 10, remove the last saved item, export CSV, download a text report, or clear saved listings.

## Shortcuts

- `Command+Shift+S` on Mac or `Ctrl+Shift+S` on Windows: save the current listing.
- `Command+Shift+X` on Mac or `Ctrl+Shift+X` on Windows: remove the most recently saved listing.

The extension does not automatically open listings, scrape in the background, or bypass Facebook protections. It only reads the currently visible page after you press the shortcut or popup button.

The Gemini workflow sends only the selected listing JSON and shopping goal to the Gemini API. The API key is stored locally in this Chrome profile for personal testing.

## CSV columns

`title, price, condition, descriptionDetails, location, sellerRating, missingInfoRisk, thumbnailUrl, url, timeOfCopy, fullText`
