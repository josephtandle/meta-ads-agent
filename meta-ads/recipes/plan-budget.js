const { readArg } = require("../src/recipe-helpers");

const OFFER_BUDGET_SPLITS = {
  high_ticket: {
    provenPercent: 80,
    testPercent: 20,
    adjustment: "Protect the proven qualified-event control because high-ticket volume is scarce. Test only a small number of isolated changes.",
  },
  software: {
    provenPercent: 70,
    testPercent: 30,
    adjustment: "Keep a larger discovery lane for founder-demo concepts and activation-quality learning, while preserving a proven control.",
  },
  course: {
    provenPercent: 75,
    testPercent: 25,
    adjustment: "Keep the general doctrine split while testing new course angles and proof without draining the proven lane.",
  },
};

function positiveNumber(input, name) {
  const value = Number(readArg(input, name));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

module.exports.runRecipe = async function runRecipe(input = {}) {
  const monthlyBudget = positiveNumber(input, "monthlyBudget");
  const targetCpa = positiveNumber(input, "targetCpa");
  const offerType = String(readArg(input, "offerType", "")).trim();
  const doctrine = OFFER_BUDGET_SPLITS[offerType];
  if (!doctrine) throw new Error("offerType must be one of: high_ticket, software, course");

  const dailyBudget = roundCurrency(monthlyBudget / 30);
  const minimumDailyBudget = roundCurrency(targetCpa * 50 / 7);
  const fullLearningAdSetsSupported = Math.floor(dailyBudget / minimumDailyBudget);
  const provenBudget = roundCurrency(monthlyBudget * doctrine.provenPercent / 100);
  const testBudget = roundCurrency(monthlyBudget * doctrine.testPercent / 100);
  const shallowEventRecommendation = fullLearningAdSetsSupported === 0
    ? "This budget supports 0 full-learning ad sets at the selected CPA. Optimise to a truthful shallower event, while sending the deeper event through CAPI."
    : `This budget honestly supports ${fullLearningAdSetsSupported} full-learning ad set${fullLearningAdSetsSupported === 1 ? "" : "s"} at the selected CPA.`;

  return {
    status: "ok",
    reply: [
      `Meta Ads budget plan for ${offerType}`,
      `- Monthly budget: $${monthlyBudget.toFixed(2)} ($${dailyBudget.toFixed(2)}/day using a 30-day month)`,
      `- Proven: ${doctrine.provenPercent}% ($${provenBudget.toFixed(2)}); test: ${doctrine.testPercent}% ($${testBudget.toFixed(2)})`,
      `- Minimum daily budget per ad set: $${minimumDailyBudget.toFixed(2)} (target CPA $${targetCpa.toFixed(2)} x 50 / 7)`,
      `- ${shallowEventRecommendation}`,
      `- Offer adjustment: ${doctrine.adjustment}`,
      "- Scale stable winners by 15 to 20% every 3 to 4 days, then evaluate the blended trend.",
    ].join("\n"),
    metadata: {
      monthlyBudget,
      dailyBudget,
      targetCpa,
      offerType,
      provenPercent: doctrine.provenPercent,
      testPercent: doctrine.testPercent,
      provenBudget,
      testBudget,
      minimumDailyBudget,
      fullLearningAdSetsSupported,
      recommendsShallowerEvent: fullLearningAdSetsSupported === 0,
    },
  };
};
