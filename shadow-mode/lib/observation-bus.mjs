// In-process observation bus.
//
// V1 is deliberately small: no persistence, no replay, no transport.
// It gives verifier/indexer/keeper work a named seam without adding
// runtime infrastructure to the browser path.

export const OBSERVATION_EVENT_KINDS = Object.freeze([
  "proof-built",
  "mint-submitted",
  "mint-confirmed",
  "mint-failed",
]);

const OBSERVATION_EVENT_KIND_SET = new Set(OBSERVATION_EVENT_KINDS);
const WILDCARD_KIND = "*";
const subscribers = new Map();

function assertKind(kind, { allowWildcard = false } = {}) {
  const normalized = String(kind || "").trim();
  if (allowWildcard && normalized === WILDCARD_KIND) return normalized;
  if (!OBSERVATION_EVENT_KIND_SET.has(normalized)) {
    throw new Error(`Unsupported observation event kind: ${normalized || "(empty)"}`);
  }
  return normalized;
}

function clonePayload(payload) {
  if (payload == null) return {};
  const proto = typeof payload === "object" ? Object.getPrototypeOf(payload) : null;
  if (
    typeof payload !== "object"
    || Array.isArray(payload)
    || (proto !== Object.prototype && proto !== null)
  ) {
    throw new Error("Observation payload must be a plain object.");
  }
  return JSON.parse(JSON.stringify(payload));
}

function getSubscriberSet(kind) {
  let set = subscribers.get(kind);
  if (!set) {
    set = new Set();
    subscribers.set(kind, set);
  }
  return set;
}

function notify(kind, event) {
  const listeners = [
    ...Array.from(subscribers.get(kind) || []),
    ...Array.from(subscribers.get(WILDCARD_KIND) || []),
  ];
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      if (globalThis?.console?.error) {
        globalThis.console.error("[observation-bus] subscriber failed", error);
      }
    }
  }
}

export function emitObservation(kind, payload = {}, context = {}) {
  const eventKind = assertKind(kind);
  const event = {
    kind: eventKind,
    at: new Date().toISOString(),
    payload: clonePayload(payload),
  };
  if (context?.source) event.source = String(context.source);
  notify(eventKind, event);
  return event;
}

export function subscribeObservation(kind, listener) {
  const eventKind = assertKind(kind, { allowWildcard: true });
  if (typeof listener !== "function") {
    throw new Error("Observation listener must be a function.");
  }
  const set = getSubscriberSet(eventKind);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) subscribers.delete(eventKind);
  };
}

export function clearObservationSubscribers() {
  subscribers.clear();
}
