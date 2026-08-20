"use strict";

function setUrlSearchParams(url, params = {}, { stringifyObjectValues = false, skipNullish = true } = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (skipNullish && (value === undefined || value === null)) continue;
    const normalized = stringifyObjectValues && value && typeof value === "object"
      ? JSON.stringify(value)
      : value;
    url.searchParams.set(key, normalized);
  }
  return url;
}

function buildJsonFetchOptions({ method = "GET", body = null, headers = {} } = {}) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };
  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }
  return options;
}

function buildFormUrlEncodedBody(baseParams = {}, body = null, { includeBaseWhenBodyMissing = false } = {}) {
  if (!body && !includeBaseWhenBodyMissing) return null;
  return new URLSearchParams({
    ...baseParams,
    ...(body || {}),
  }).toString();
}

function parseJsonText(text, errorPrefix = "Failed to parse response") {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${errorPrefix}: ${String(text || "").slice(0, 200)}`);
  }
}

function throwConfiguredApiError(data, config = {}) {
  const {
    type,
    fallbackStatusCode,
  } = config;

  if (type === "gumroad") {
    if (data?.success === false) {
      throw new Error(data.message || `API error: ${fallbackStatusCode}`);
    }
    return data;
  }

  if (type === "meta") {
    if (data?.error) {
      throw new Error(`Meta API Error: ${data.error.message} (code ${data.error.code})`);
    }
    return data;
  }

  if (type === "zoho") {
    if (data?.code !== 0) {
      throw new Error(`Zoho API error (${data.code}): ${data.message}`);
    }
    return data;
  }

  return data;
}

module.exports = {
  buildFormUrlEncodedBody,
  buildJsonFetchOptions,
  parseJsonText,
  setUrlSearchParams,
  throwConfiguredApiError,
};
