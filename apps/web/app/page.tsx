"use client";

import type {
  CapabilityId,
  Comparison,
  ComparisonSuite,
  DiagnosticCase,
  Finding,
  NormalizedEvent,
  ProcessNode,
  ReportPayload,
} from "@tracewhy/schema";
import { useEffect, useMemo, useState } from "react";
import { isComparisonSuite, parseReportPayload } from "./report-data";

type Side = "good" | "bad";
type Filter = "all" | "process" | "file" | "permission" | "executable" | "library";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All evidence" },
  { value: "process", label: "Processes" },
  { value: "file", label: "Files" },
  { value: "permission", label: "Permissions" },
  { value: "executable", label: "Executables" },
  { value: "library", label: "Libraries" },
];

interface CapabilityDefinition {
  id: CapabilityId;
  label: string;
  detail: string;
  caseId: string;
}

const CAPABILITIES: CapabilityDefinition[] = [
  {
    id: "process_tree",
    label: "Process trees",
    detail: "Parent and child execution",
    caseId: "child-failure",
  },
  {
    id: "file_access",
    label: "File access",
    detail: "Successful and failed syscalls",
    caseId: "missing-config",
  },
  {
    id: "permissions",
    label: "Permissions",
    detail: "EACCES and EPERM contrasts",
    caseId: "permission-denied",
  },
  {
    id: "executable_selection",
    label: "Executables",
    detail: "The binary actually executed",
    caseId: "wrong-executable",
  },
  {
    id: "path_resolution",
    label: "PATH resolution",
    detail: "Command lookup environment",
    caseId: "wrong-executable",
  },
  {
    id: "working_directory",
    label: "Working directory",
    detail: "Relative resource resolution",
    caseId: "wrong-working-directory",
  },
  {
    id: "child_exit",
    label: "Child exits",
    detail: "Failure attached to its process",
    caseId: "child-failure",
  },
  {
    id: "shared_libraries",
    label: "Shared libraries",
    detail: "Dynamic loader differences",
    caseId: "shared-library",
  },
];

export default function ReportPage() {
  const [payload, setPayload] = useState<ReportPayload>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedFinding, setSelectedFinding] = useState(0);
  const [selectedCaseId, setSelectedCaseId] = useState<string>();
  const [visibleEvents, setVisibleEvents] = useState(120);
  const [showNoise, setShowNoise] = useState(false);

  useEffect(() => {
    fetch("/api/comparison", { cache: "no-store" })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(responseError(body));
        setPayload(parseReportPayload(body));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const suite = payload && isComparisonSuite(payload) ? payload : undefined;
  const activeCase = suite?.cases.find((item) => item.case_id === selectedCaseId) ?? suite?.cases[0];
  const comparison = activeCase?.comparison ?? (payload && !isComparisonSuite(payload) ? payload : undefined);

  const filteredEvents = useMemo(() => {
    if (!comparison) return [];
    return (["good", "bad"] as Side[])
      .flatMap((side) => comparison.events[side].map((event) => ({ side, event })))
      .filter(({ event }) => filter === "all" || event.category === filter)
      .sort((a, b) => a.event.sequence - b.event.sequence);
  }, [comparison, filter]);

  if (error) return <EmptyState title="Report unavailable" detail={error} />;
  if (!payload) return <LoadingState />;
  if (suite && suite.cases.length === 0) {
    return (
      <EmptyState
        title="Casebook is empty"
        detail="No diagnostic comparisons are attached to this report."
      />
    );
  }
  if (!comparison) return <LoadingState />;

  const leading = comparison.findings[0];
  const activeFinding = comparison.findings[selectedFinding] ?? leading;
  const evidenceIds = new Set([...(activeFinding?.good_event_ids ?? []), ...(activeFinding?.bad_event_ids ?? [])]);
  const evidence = {
    good: comparison.events.good.filter((event) => evidenceIds.has(event.event_id)),
    bad: comparison.events.bad.filter((event) => evidenceIds.has(event.event_id)),
  };
  const selectCase = (caseId: string) => {
    setSelectedCaseId(caseId);
    setSelectedFinding(0);
    setFilter("all");
    setVisibleEvents(120);
    setShowNoise(false);
  };

  return (
    <main id="top">
      <nav className="topbar" aria-label="Report controls">
        <a className="wordmark" href="#top" aria-label="TraceWhy report home">
          <span>Trace</span>Why
        </a>
        <div className="localPill">
          <i /> Local-only report
        </div>
        <div className="navActions">
          <button
            className="quietButton"
            onClick={() => downloadJson(
              payload,
              suite
                ? "tracewhy-full-casebook.json"
                : `${comparison.good.name}-vs-${comparison.bad.name}.json`,
            )}
          >
            {suite ? "Export casebook" : "Export JSON"}
          </button>
          <button className="primaryButton" onClick={() => window.print()}>
            Print report
          </button>
        </div>
      </nav>

      {suite && activeCase && (
        <SuiteOverview
          suite={suite}
          activeCase={activeCase}
          onSelect={selectCase}
        />
      )}

      <header className="reportHeader">
        <div>
          <p className="eyebrow">
            {activeCase ? `${activeCase.label} / ` : "Comparison / "}
            {comparison.comparison_id.slice(-8)}
          </p>
          <h1>{leading?.title ?? "No actionable divergence found"}</h1>
          <p className="lede">
            {leading?.summary
              ?? "The recorded runs contain no harmful deterministic difference covered by TraceWhy’s current rules."}
          </p>
        </div>
        <ConfidenceDial confidence={leading?.confidence} score={leading?.score} />
      </header>

      {comparison.warnings.length > 0 && (
        <aside className="warning" role="status">
          <b>Capture limitations</b>
          <span>{comparison.warnings.join(" ")}</span>
        </aside>
      )}

      <section className="runGrid" aria-label="Run summary">
        <RunCard side="good" run={comparison.good} />
        <RunCard side="bad" run={comparison.bad} />
      </section>

      <section className="section evidenceSection" aria-labelledby="evidence-title">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">Direct contrast</p>
            <h2 id="evidence-title">Evidence behind the finding</h2>
          </div>
          {activeFinding && (
            <span className={`confidenceTag ${activeFinding.confidence}`}>
              {activeFinding.confidence} / {activeFinding.score}
            </span>
          )}
        </div>
        {activeFinding ? (
          <>
            <p className="findingWhy">{activeFinding.reasons.join(" ")}</p>
            <div className="evidenceGrid">
              <EvidenceColumn side="good" events={evidence.good} />
              <EvidenceColumn side="bad" events={evidence.bad} />
            </div>
          </>
        ) : (
          <p className="muted">No direct evidence pair was identified.</p>
        )}
      </section>

      <section className="section" aria-labelledby="findings-title">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">Deterministic ranking</p>
            <h2 id="findings-title">All findings</h2>
          </div>
          <span className="count">{comparison.findings.length}</span>
        </div>
        <div className="findingsList">
          {comparison.findings.map((finding, index) => (
            <button
              className={`findingRow ${selectedFinding === index ? "selected" : ""}`}
              key={finding.finding_id}
              onClick={() => setSelectedFinding(index)}
              aria-pressed={selectedFinding === index}
            >
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <span className="findingBody">
                <b>{finding.title}</b>
                <small>{finding.summary}</small>
              </span>
              <span className={`confidenceTag ${finding.confidence}`}>
                {finding.confidence}
              </span>
              <span className="score">{finding.score}</span>
            </button>
          ))}
          {comparison.findings.length === 0 && (
            <p className="emptyInline">No findings were produced.</p>
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="process-title">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">Execution shape</p>
            <h2 id="process-title">Process-tree comparison</h2>
          </div>
        </div>
        <div className="processGrid">
          <ProcessTree side="good" processes={comparison.processes.good} />
          <ProcessTree side="bad" processes={comparison.processes.bad} />
        </div>
      </section>

      <section className="section" aria-labelledby="timeline-title">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">Normalized trace</p>
            <h2 id="timeline-title">Event timeline</h2>
          </div>
          <span className="count">{filteredEvents.length}</span>
        </div>
        <div className="filterBar" role="toolbar" aria-label="Filter events">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              onClick={() => {
                setFilter(item.value);
                setVisibleEvents(120);
              }}
              className={filter === item.value ? "active" : ""}
              aria-pressed={filter === item.value}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="timeline" role="table" aria-label="Normalized events">
          <div className="timelineHeader" role="row">
            <span>Run / event</span>
            <span>Process</span>
            <span>Operation & resource</span>
            <span>Result</span>
          </div>
          {filteredEvents.slice(0, visibleEvents).map(({ side, event }) => (
            <EventRow
              key={`${side}:${event.event_id}`}
              side={side}
              event={event}
              highlighted={evidenceIds.has(event.event_id)}
            />
          ))}
        </div>
        {visibleEvents < filteredEvents.length && (
          <button
            className="loadMore"
            onClick={() => setVisibleEvents((count) => count + 250)}
          >
            Show 250 more events
          </button>
        )}
      </section>

      <section className="section noiseSection" aria-labelledby="noise-title">
        <button
          className="noiseToggle"
          onClick={() => setShowNoise((shown) => !shown)}
          aria-expanded={showNoise}
        >
          <span>
            <span className="eyebrow">Inspectability</span>
            <b id="noise-title">Ignored noise</b>
            <small>Known runtime differences excluded from diagnosis</small>
          </span>
          <span>
            {comparison.ignored_differences.length} {showNoise ? "−" : "+"}
          </span>
        </button>
        {showNoise && (
          <div className="noiseList">
            {comparison.ignored_differences.map((item, index) => (
              <p key={`${item.good_event_id ?? item.bad_event_id}:${index}`}>
                <code>{item.good_event_id ?? item.bad_event_id ?? "difference"}</code>
                {item.reason}
              </p>
            ))}
          </div>
        )}
      </section>

      <footer>
        <span><b>TraceWhy</b> v{comparison.tracewhy_version}</span>
        <span>Evidence before claims · no AI · no telemetry</span>
      </footer>
    </main>
  );
}

function RunCard({ side, run }: { side: Side; run: Comparison[Side] }) {
  const result = run.exit.success
    ? "Succeeded"
    : run.exit.signal
      ? `Signal ${run.exit.signal}`
      : `Exit ${run.exit.code ?? "unknown"}`;
  return (
    <article className={`runCard ${side}`}>
      <div className="runLabel">
        <span><i /> {side} run</span>
        <b>{result}</b>
      </div>
      <code className="command">$ {[run.command, ...run.args].join(" ")}</code>
      <dl>
        <div>
          <dt>Working directory</dt>
          <dd>{run.cwd}</dd>
        </div>
        <div>
          <dt>Environment</dt>
          <dd>
            {run.system.distribution ?? run.system.platform} · {run.system.architecture}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function ConfidenceDial({ confidence, score }: { confidence?: Finding["confidence"]; score?: number }) {
  return (
    <div
      className={`dial ${confidence ?? "none"}`}
      aria-label={`${confidence ?? "no"} confidence, score ${score ?? 0}`}
    >
      <span>{score ?? "—"}</span>
      <small>{confidence ?? "no finding"}<br />confidence</small>
    </div>
  );
}

function EvidenceColumn({ side, events }: { side: Side; events: NormalizedEvent[] }) {
  return (
    <article className={`evidenceColumn ${side}`}>
      <h3><i /> {side === "good" ? "Good evidence" : "Bad evidence"}</h3>
      {events.map((event) => (
        <div className="evidenceLine" key={event.event_id}>
          <span>{event.event_id}</span>
          <code>{event.operation}(“{event.resource ?? ""}”)</code>
          <b className={event.result.kind}>
            {event.result.code ?? event.result.value ?? event.result.kind}
          </b>
          <small>{event.raw_ref.file}:{event.raw_ref.line}</small>
        </div>
      ))}
      {events.length === 0 && <p className="muted">No linked event on this side.</p>}
    </article>
  );
}

function ProcessTree({ side, processes }: { side: Side; processes: ProcessNode[] }) {
  return (
    <article className={`processTree ${side}`}>
      <h3><i /> {side} process tree</h3>
      {processes.map((process) => (
        <div
          className="processNode"
          key={process.process_id}
          style={{ marginLeft: `${Math.min(depthFor(process, processes), 5) * 18}px` }}
        >
          <span>{process.process_id}</span>
          <code>{process.executable ?? "process"}</code>
          <b className={(process.exit_code ?? 0) === 0 && !process.signal ? "success" : "error"}>
            {process.signal ?? `exit ${process.exit_code ?? "—"}`}
          </b>
        </div>
      ))}
      {processes.length === 0 && <p className="muted">No process events were captured.</p>}
    </article>
  );
}

function depthFor(process: ProcessNode, processes: ProcessNode[]): number {
  const byId = new Map(processes.map((node) => [node.process_id, node]));
  let depth = 0;
  let parent = process.parent_process_id;
  // The cap keeps malformed or cyclic imported process graphs from hanging the report.
  while (parent && depth < 10) {
    depth += 1;
    parent = byId.get(parent)?.parent_process_id;
  }
  return depth;
}

function EventRow({ side, event, highlighted }: { side: Side; event: NormalizedEvent; highlighted: boolean }) {
  return (
    <div className={`eventRow ${highlighted ? "highlighted" : ""}`} role="row">
      <span>
        <b className={side}>{side}</b>
        <code>{event.event_id}</code>
      </span>
      <code>{event.process_id}</code>
      <span>
        <b>{event.operation}</b>
        <code title={event.resource}>{event.resource ?? "—"}</code>
      </span>
      <b className={event.result.kind}>
        {event.result.code ?? event.result.value ?? event.result.kind}
      </b>
    </div>
  );
}

function LoadingState() {
  return (
    <main className="statePage">
      <div className="wordmark"><span>Trace</span>Why</div>
      <div className="scanner" />
      <h1>Reading local evidence</h1>
      <p>No data leaves this machine.</p>
    </main>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="statePage">
      <div className="wordmark"><span>Trace</span>Why</div>
      <p className="eyebrow">Local report</p>
      <h1>{title}</h1>
      <p>{detail}</p>
      <code>tracewhy view good bad</code>
    </main>
  );
}

function SuiteOverview({
  suite,
  activeCase,
  onSelect,
}: {
  suite: ComparisonSuite;
  activeCase: DiagnosticCase;
  onSelect: (caseId: string) => void;
}) {
  const eventCount = suite.cases.reduce(
    (total, item) => total + item.comparison.events.good.length + item.comparison.events.bad.length,
    0,
  );
  return (
    <section className="suiteOverview" aria-labelledby="suite-title">
      <div className="suiteHero">
        <div>
          <p className="eyebrow">Complete v1 capability coverage</p>
          <h1 id="suite-title">Every diagnostic path, backed by evidence.</h1>
          <p className="lede">{suite.description}</p>
        </div>
        <dl className="suiteMetrics">
          <div><dt>Incidents</dt><dd>{suite.cases.length}</dd></div>
          <div><dt>Capabilities</dt><dd>{CAPABILITIES.length}</dd></div>
          <div><dt>Trace events</dt><dd>{eventCount}</dd></div>
        </dl>
      </div>
      <div className="capabilityGrid" aria-label="TraceWhy v1 diagnostic capabilities">
        {CAPABILITIES.map((capability) => {
          const diagnosticCase = suite.cases.find((item) => item.case_id === capability.caseId);
          const active = activeCase.capabilities.includes(capability.id);
          return (
            <button
              key={capability.id}
              className={active ? "active" : ""}
              aria-pressed={active}
              disabled={!diagnosticCase}
              onClick={() => diagnosticCase && onSelect(diagnosticCase.case_id)}
            >
              <span className="coverageStatus"><i /> Covered</span>
              <b>{capability.label}</b>
              <small>{capability.detail}</small>
              <code>{diagnosticCase?.label ?? "No evidence case"}</code>
            </button>
          );
        })}
      </div>
      <div className="caseSelector" aria-label="Diagnostic cases">
        <span>Selected incident</span>
        <div>
          {suite.cases.map((item, index) => {
            const active = item.case_id === activeCase.case_id;
            return (
              <button
                key={item.case_id}
                className={active ? "active" : ""}
                aria-pressed={active}
                onClick={() => onSelect(item.case_id)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.label}
                <b>{item.comparison.findings[0]?.score ?? "—"}</b>
              </button>
            );
          })}
        </div>
        <p>{activeCase.description}</p>
      </div>
    </section>
  );
}

function downloadJson(value: ReportPayload, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function responseError(value: unknown): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return "Could not load the comparison.";
}
