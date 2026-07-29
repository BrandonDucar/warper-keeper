export type WarperAnalyticsEvent =
  | "app_opened"
  | "miniapp_opened"
  | "sign_in_succeeded"
  | "onboarding_completed"
  | "source_added"
  | "repo_import_started"
  | "repo_import_completed"
  | "keeper_created"
  | "trapper_created"
  | "trapper_shared"
  | "proof_viewed"
  | "proof_exported"
  | "miniapp_added";

type AnalyticsMetadata = Partial<
  Record<
    | "auth_method"
    | "mode"
    | "result"
    | "runtime"
    | "source_type"
    | "view",
    string | number | boolean
  >
>;

const endpoint = (
  process.env.NEXT_PUBLIC_PRODUCT_ANALYTICS_URL ??
  "https://dreamnet-product-analytics.dreamnet-intel.workers.dev"
).replace(/\/+$/, "");

let runtime = "web";

function sessionId() {
  const key = "warper-keeper-analytics-session";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

export function setWarperAnalyticsRuntime(inMiniApp: boolean) {
  runtime = inMiniApp ? "farcaster-miniapp" : "web";
}

export function trackWarperEvent(
  eventName: WarperAnalyticsEvent,
  metadata: AnalyticsMetadata = {},
) {
  if (typeof window === "undefined" || typeof fetch === "undefined") return;

  void fetch(`${endpoint}/v1/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      appId: "warper_keeper",
      eventName,
      sessionId: sessionId(),
      path: window.location.pathname,
      runtime,
      source: "product",
      metadata: { ...metadata, runtime },
    }),
    keepalive: true,
  }).catch(() => undefined);
}
