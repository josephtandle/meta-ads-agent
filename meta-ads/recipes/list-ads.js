const api = require("../src/api-client");
const {
  buildListResponse,
  extractData,
  readArg,
  summarizeAd,
} = require("../src/recipe-helpers");

module.exports.runRecipe = async function runRecipe(input = {}) {
  const adSetId = readArg(input, ["adSetId", "adsetId", "ad_set_id", "id"], null);
  const adsResponse = await api.listAds(adSetId || null);
  const ads = extractData(adsResponse).map(summarizeAd);

  return buildListResponse({
    title: "Meta Ads ads",
    emptyMessage: "No Meta Ads ads were found.",
    items: ads,
    metadataKey: "ads",
    renderRow: (ad) => {
      const creativeId = ad.creativeId || "no creative";
      return `${ad.name || "Unnamed"} | ${ad.status || "unknown"} | ${creativeId}`;
    },
  });
};
