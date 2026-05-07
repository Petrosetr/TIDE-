function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeFieldNames(value) {
  if (Array.isArray(value)) return value.map((entry) => normalizeString(entry)).filter(Boolean);
  const single = normalizeString(value);
  return single ? [single] : [];
}

function pickParsedEventId(event, fieldNames) {
  const data = event?.parsedJson || {};
  for (const fieldName of fieldNames) {
    const direct = normalizeString(data[fieldName]);
    if (direct) return direct;
    const nested = normalizeString(data[fieldName]?.id);
    if (nested) return nested;
  }
  return "";
}

export function getSuiTransactionDigest(result) {
  return normalizeString(
    result?.digest ||
      result?.effects?.transactionDigest ||
      result?.transaction?.digest ||
      result?.transactionDigest,
  );
}

export function resolveSuiObjectFromTransaction({
  result = null,
  confirmation = null,
  expectedObjectType = "",
  expectedEventType = "",
  eventIdFields = [],
  fallbackObjectId = "",
  label = "object",
} = {}) {
  const objectType = normalizeString(expectedObjectType);
  const eventType = normalizeString(expectedEventType);
  const fields = normalizeFieldNames(eventIdFields);
  const sources = [
    { name: "result", value: result },
    { name: "confirmation", value: confirmation },
  ];
  const digest = getSuiTransactionDigest(result) || getSuiTransactionDigest(confirmation);
  const fallback = normalizeString(fallbackObjectId);

  for (const source of sources) {
    if (!source.value) continue;
    for (const change of normalizeList(source.value.objectChanges)) {
      if (!change || change.type !== "created") continue;
      if (objectType && normalizeString(change.objectType) !== objectType) continue;
      const objectId = normalizeString(change.objectId);
      if (objectId) {
        return {
          ok: true,
          objectId,
          digest,
          source: `${source.name}.objectChanges`,
          reason: "",
        };
      }
    }
  }

  if (eventType && fields.length) {
    for (const source of sources) {
      if (!source.value) continue;
      for (const event of normalizeList(source.value.events)) {
        if (normalizeString(event?.type) !== eventType) continue;
        const objectId = pickParsedEventId(event, fields);
        if (objectId) {
          return {
            ok: true,
            objectId,
            digest,
            source: `${source.name}.events`,
            reason: "",
          };
        }
      }
    }
  }

  if (fallback) {
    return {
      ok: true,
      objectId: fallback,
      digest,
      source: "fallback",
      reason: "",
    };
  }

  const reason = `${label}-object-id-missing`;
  return {
    ok: false,
    objectId: "",
    digest,
    source: "",
    reason,
  };
}
