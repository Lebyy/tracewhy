import type {
  Comparison,
  Finding,
  NormalizedEvent,
  RecordingSummary,
} from "@tracewhy/schema";

const COLORS: Record<Finding["confidence"], string> = {
  high: "#ff6b57",
  medium: "#f5b942",
  low: "#8190a5",
};

const OFFLINE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function formatTerminal(comparison: Comparison): string {
  const lines = [
    `TraceWhy compared “${comparison.good.name}” with “${comparison.bad.name}”`,
    "",
  ];
  const leading = comparison.findings[0];
  if (!leading) {
    lines.push(
      "NO ACTIONABLE DIVERGENCE FOUND",
      "",
      "The captured runs contain no deterministic difference covered by TraceWhy's v1 rules.",
    );
  } else {
    lines.push(
      `${findingLabel(leading)}  [${leading.confidence.toUpperCase()} CONFIDENCE]`,
      leading.title,
      "",
      leading.summary,
      "",
      "Why it matters",
    );
    for (const reason of leading.reasons) lines.push(`  ${reason}`);
    const evidence = evidenceLines(comparison, leading);
    if (evidence.length) {
      lines.push("", "Evidence", ...evidence.map((line) => `  ${line}`));
    }
    lines.push("", `Other differences: ${Math.max(0, comparison.findings.length - 1)}`);
  }
  if (comparison.warnings.length) {
    lines.push(
      "",
      "Capture warnings",
      ...comparison.warnings.map((warning) => `  • ${warning}`),
    );
  }
  return lines.join("\n");
}

function findingLabel(finding: Finding): string {
  return finding.classification === "likely_cause" ? "LIKELY CAUSE" : "SUPPORTING DIFFERENCE";
}

function evidenceLines(comparison: Comparison, finding: Finding): string[] {
  const index = new Map<string, NormalizedEvent>([
    ...comparison.events.good.map((event) => [event.event_id, event] as const),
    ...comparison.events.bad.map((event) => [event.event_id, event] as const),
  ]);
  return [...finding.good_event_ids, ...finding.bad_event_ids].map((id) => {
    const event = index.get(id);
    if (!event) return id;
    const result = event.result.kind === "error"
      ? `-1 ${event.result.code}`
      : event.result.value ?? "success";
    return `${id}: ${event.operation}(“${event.resource ?? ""}”) = ${result}`;
  });
}

export function selfContainedHtml(comparison: Comparison): string {
  // Escaping '<' prevents comparison data from terminating the inline script element.
  const data = JSON.stringify(comparison).replace(/</g, "\\u003c");
  const leading = comparison.findings[0];
  const title = leading?.title ?? "No actionable divergence found";
  const summary = leading?.summary
    ?? "The captured runs contain no deterministic difference covered by TraceWhy’s v1 rules.";
  const confidenceColor = COLORS[leading?.confidence ?? "low"];
  const classification = leading?.classification.replaceAll("_", " ") ?? "complete comparison";
  const confidence = leading?.confidence.toUpperCase() ?? "NO";
  const reasons = leading
    ? `<p>${leading.reasons.map(escapeHtml).join("<br>")}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${OFFLINE_CONTENT_SECURITY_POLICY}">
  <title>TraceWhy — ${escapeHtml(comparison.good.name)} vs ${escapeHtml(comparison.bad.name)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0e12;
      --panel: #12171e;
      --line: #26303c;
      --text: #edf2f7;
      --muted: #91a0b3;
      --accent: #ff6b57;
      --good: #58d68d;
      --bad: #ff6b6b;
      font: 15px/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at 80% -10%, #1b2a36 0, transparent 34%), var(--bg);
      color: var(--text);
    }
    main { max-width: 1180px; margin: auto; padding: 32px 20px 80px; }
    header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      margin-bottom: 28px;
    }
    .brand {
      font-size: 14px;
      letter-spacing: .18em;
      text-transform: uppercase;
      color: #b7c3d2;
    }
    .brand b { color: var(--accent); }
    h1 {
      max-width: 860px;
      margin: 28px 0 12px;
      font-size: clamp(28px, 5vw, 54px);
      line-height: 1.05;
      letter-spacing: -.04em;
    }
    .sub { color: var(--muted); font-size: 17px; }
    .badge {
      display: inline-flex;
      border: 1px solid var(--line);
      border-radius: 99px;
      padding: 7px 11px;
      font-size: 11px;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .hero, .card {
      border: 1px solid var(--line);
      border-radius: 16px;
      background: color-mix(in srgb, var(--panel) 94%, transparent);
    }
    .hero { margin: 24px 0; padding: 26px; }
    .score { color: ${confidenceColor}; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { padding: 20px; }
    .label {
      color: var(--muted);
      font-size: 11px;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 13px;
      word-break: break-word;
    }
    .finding { border-top: 1px solid var(--line); padding: 18px 0; }
    .finding:first-child { border-top: 0; }
    .event {
      display: grid;
      grid-template-columns: 90px 1fr auto;
      gap: 12px;
      border-top: 1px solid var(--line);
      padding: 10px 0;
    }
    .error { color: var(--bad); }
    .success { color: var(--good); }
    details { margin-top: 24px; }
    summary { cursor: pointer; font-weight: 650; }
    button {
      border: 0;
      border-radius: 8px;
      padding: 9px 13px;
      background: #fff;
      color: #111;
      font-weight: 650;
      cursor: pointer;
    }
    @media (max-width: 720px) {
      header { display: block; }
      .grid { grid-template-columns: 1fr; }
      .event { grid-template-columns: 70px 1fr; }
      .event span:last-child { grid-column: 2; }
    }
    @media print {
      button { display: none; }
      body { background: #fff; color: #111; }
      .hero, .card { border-color: #bbb; background: #fff; }
      :root { --muted: #555; --line: #ccc; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="brand"><b>Trace</b>Why / deterministic evidence</div>
        <h1>${escapeHtml(title)}</h1>
        <div class="sub">${escapeHtml(summary)}</div>
      </div>
      <button onclick="print()">Print report</button>
    </header>
    <section class="hero">
      <span class="badge">${escapeHtml(classification)}</span>
      <span class="score">${escapeHtml(confidence)} CONFIDENCE</span>
      ${reasons}
    </section>
    <section class="grid">
      ${renderRunCard("Good", comparison.good)}
      ${renderRunCard("Bad", comparison.bad)}
    </section>
    <section class="card" style="margin-top:16px">
      <div class="label">Ranked findings</div>
      ${renderFindings(comparison.findings)}
    </section>
    <details class="card">
      <summary>Normalized event timeline (${eventCount(comparison)})</summary>
      <div id="events"></div>
    </details>
    <details class="card">
      <summary>Ignored noise (${comparison.ignored_differences.length})</summary>
      ${renderIgnoredDifferences(comparison)}
    </details>
  </main>
  <script>
    const data = ${data};
    const timeline = document.querySelector("#events");
    const rows = [
      ...data.events.good.map((event) => ["good", event]),
      ...data.events.bad.map((event) => ["bad", event]),
    ]
      .sort((left, right) => left[1].sequence - right[1].sequence)
      .slice(0, 5000);
    for (const [side, event] of rows) {
      const row = document.createElement("div");
      const id = document.createElement("code");
      const operation = document.createElement("span");
      const result = document.createElement("span");
      row.className = "event";
      id.textContent = side + " " + event.event_id;
      operation.textContent = event.operation + " " + (event.resource || "");
      result.className = event.result.kind === "error" ? "error" : "success";
      result.textContent = event.result.code || event.result.value || event.result.kind;
      row.append(id, operation, result);
      timeline.append(row);
    }
  </script>
</body>
</html>`;
}

function renderRunCard(label: "Good" | "Bad", run: RecordingSummary): string {
  const resultClass = run.exit.success ? "success" : "error";
  const result = run.exit.success
    ? "Succeeded"
    : `Exited ${run.exit.code ?? run.exit.signal ?? "unknown"}`;
  return `<article class="card">
    <div class="label">${label} run</div>
    <h2>${escapeHtml(run.name)}</h2>
    <code>${escapeHtml([run.command, ...run.args].join(" "))}</code>
    <p class="${resultClass}">${escapeHtml(result)}</p>
    <small>${escapeHtml(run.cwd)}</small>
  </article>`;
}

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) return "<p>No findings.</p>";
  return findings.map((finding) => `<article class="finding">
    <b>${escapeHtml(finding.title)}</b>
    <span class="score">${finding.score} / ${escapeHtml(finding.confidence)}</span>
    <p>${escapeHtml(finding.summary)}</p>
    <small>${finding.reasons.map(escapeHtml).join(" · ")}</small>
  </article>`).join("\n");
}

function renderIgnoredDifferences(comparison: Comparison): string {
  if (comparison.ignored_differences.length === 0) return "<p>No ignored noise.</p>";
  return comparison.ignored_differences.map((item) => {
    const eventId = item.good_event_id ?? item.bad_event_id ?? "";
    return `<p>${escapeHtml(item.reason)} — <code>${escapeHtml(eventId)}</code></p>`;
  }).join("\n");
}

function eventCount(comparison: Comparison): number {
  return comparison.events.good.length + comparison.events.bad.length;
}

function escapeHtml(value: unknown): string {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(value).replace(/[&<>"']/g, (character) => replacements[character]!);
}
