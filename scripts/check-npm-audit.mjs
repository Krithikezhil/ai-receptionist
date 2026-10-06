// Fails CI on any high or critical npm advisory that is not explicitly allowlisted
// below. Replaces a plain `npm audit --audit-level=high` so that one advisory with no
// available fix can be excepted without lowering the audit level for anything else.
// Fails closed on any unexpected npm output.

import { spawnSync } from "node:child_process";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const KNOWN_SEVERITIES = new Set(["info", "low", "moderate", "high", "critical"]);
const ADVISORY_URL =
  /^https:\/\/github\.com\/advisories\/(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})$/;
const GHSA_ID = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// An entry only matches an advisory with the same GHSA id, package, range and severity,
// and only until reviewBy (inclusive, UTC). An entry whose advisory no longer appears
// fails the check, so exceptions are removed instead of lingering.
const ALLOWLIST = [
  {
    ghsa: "GHSA-vfj7-8cjw-p6xm",
    package: "braces",
    range: "<=3.0.3",
    severity: "high",
    reviewBy: "2026-11-06",
    reason:
      "No patched braces release exists (affected <=3.0.3, no first patched version). " +
      "Reached only through dev tooling, via two independent paths: (1) apps/web's " +
      "eslint-config-next -> @next/eslint-plugin-next -> fast-glob@3.3.1 (exact pin) -> " +
      "micromatch -> braces, and (2) load-test's artillery -> chokidar -> braces. Remove " +
      "when braces ships a fix, @next/eslint-plugin-next stops pinning fast-glob@3.3.1, " +
      "or chokidar/artillery drop their braces dependency.",
  },
];

function fail(message, detail) {
  console.error(`\nnpm audit check FAILED: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function validateAllowlist() {
  for (const entry of ALLOWLIST) {
    const validDate =
      ISO_DATE.test(entry.reviewBy) &&
      new Date(`${entry.reviewBy}T00:00:00Z`).toISOString().startsWith(entry.reviewBy);
    if (
      !GHSA_ID.test(entry.ghsa) ||
      typeof entry.package !== "string" ||
      entry.package === "" ||
      typeof entry.range !== "string" ||
      entry.range === "" ||
      !BLOCKING_SEVERITIES.has(entry.severity) ||
      !validDate ||
      typeof entry.reason !== "string" ||
      entry.reason === ""
    ) {
      fail("invalid allowlist entry", JSON.stringify(entry, null, 2));
    }
  }
}

// When run through npm (npm run / npm exec), npm_execpath points at the npm CLI that
// launched us, and Node runs it directly. Otherwise use `npm` from PATH, which on Linux
// and macOS is a directly executable file. Neither path uses a shell.
function npmCommand() {
  if (process.env.npm_execpath) {
    return { file: process.execPath, args: [process.env.npm_execpath] };
  }
  if (process.platform === "win32") {
    fail(
      "on Windows, npm is a .cmd shim that cannot be started without a shell",
      'Run this check through npm instead: npm exec -c "node scripts/check-npm-audit.mjs"',
    );
  }
  return { file: "npm", args: [] };
}

function runNpmAudit() {
  const { file, args } = npmCommand();
  const result = spawnSync(file, [...args, "audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  if (result.error) fail(`could not run npm audit: ${result.error.message}`);
  if (result.signal) fail(`npm audit was terminated by signal ${result.signal}`, result.stderr);
  // npm audit exits 1 when it finds vulnerabilities; any other status is unexpected.
  if (result.status !== 0 && result.status !== 1) {
    fail(`npm audit exited with status ${result.status}`, result.stderr);
  }
  if (typeof result.stdout !== "string" || result.stdout.trim() === "") {
    fail("npm audit produced no output", result.stderr);
  }
  return result.stdout;
}

function parseReport(raw) {
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    fail("npm audit did not return valid JSON", raw.slice(0, 2000));
  }
  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    fail("npm audit report is not an object");
  }
  if (report.error) fail("npm audit reported an error", JSON.stringify(report.error, null, 2));
  if (report.auditReportVersion !== 2) {
    fail(`unsupported auditReportVersion: ${report.auditReportVersion}`);
  }
  const { vulnerabilities, metadata } = report;
  if (vulnerabilities === null || typeof vulnerabilities !== "object" || Array.isArray(vulnerabilities)) {
    fail("npm audit report has no vulnerabilities object");
  }
  const totals = metadata?.vulnerabilities;
  if (
    totals === null ||
    typeof totals !== "object" ||
    !["high", "critical"].every((level) => Number.isInteger(totals[level]))
  ) {
    fail("npm audit report has no metadata.vulnerabilities totals");
  }
  return { vulnerabilities, totals };
}

// Only object entries in `via` are advisories. String entries name another vulnerable
// package; that package's own advisories appear as objects under its own entry.
function collectAdvisories(vulnerabilities) {
  const advisories = new Map();
  for (const [name, vuln] of Object.entries(vulnerabilities)) {
    if (!Array.isArray(vuln?.via) || !KNOWN_SEVERITIES.has(vuln.severity)) {
      fail(`malformed report entry for ${name}`, JSON.stringify(vuln, null, 2));
    }
    for (const via of vuln.via) {
      if (typeof via === "string") continue;
      const ghsa = typeof via?.url === "string" ? ADVISORY_URL.exec(via.url)?.[1] : undefined;
      if (
        via === null ||
        typeof via !== "object" ||
        typeof via.name !== "string" ||
        typeof via.title !== "string" ||
        typeof via.range !== "string" ||
        !KNOWN_SEVERITIES.has(via.severity) ||
        !ghsa
      ) {
        fail(`malformed advisory under ${name}`, JSON.stringify(via, null, 2));
      }
      advisories.set(`${ghsa}:${via.name}:${via.range}`, {
        ghsa,
        package: via.name,
        severity: via.severity,
        range: via.range,
        title: via.title,
      });
    }
  }
  return [...advisories.values()];
}

function classify(advisory, today) {
  if (!BLOCKING_SEVERITIES.has(advisory.severity)) return { status: "BELOW-THRESHOLD" };
  const entry = ALLOWLIST.find((e) => e.ghsa === advisory.ghsa && e.package === advisory.package);
  if (!entry) return { status: "BLOCKING", why: "not allowlisted" };
  if (entry.range !== advisory.range) {
    return {
      status: "BLOCKING",
      why: `allowlisted for range ${entry.range} but npm reports ${advisory.range}; review the exception`,
    };
  }
  if (entry.severity !== advisory.severity) {
    return {
      status: "BLOCKING",
      why: `allowlisted as ${entry.severity} but npm reports ${advisory.severity}; review the exception`,
    };
  }
  if (today > entry.reviewBy) {
    return {
      status: "BLOCKING",
      why: `allowlist entry expired on ${entry.reviewBy}; review it, then renew or remove it`,
    };
  }
  return { status: "ALLOWLISTED", why: `${entry.reason} Review by ${entry.reviewBy}.` };
}

validateAllowlist();
const today = new Date().toISOString().slice(0, 10);
const { vulnerabilities, totals } = parseReport(runNpmAudit());
const advisories = collectAdvisories(vulnerabilities);

// npm's own --audit-level=high decision is "metadata high + critical > 0". A package can
// only be high or critical if a high or critical advisory sits beneath it, so the two
// views must agree; if they do not, the report is not one this script understands.
const npmWouldFail = totals.high + totals.critical > 0;
const hasBlockingAdvisory = advisories.some((a) => BLOCKING_SEVERITIES.has(a.severity));
if (npmWouldFail !== hasBlockingAdvisory) {
  fail("npm audit totals disagree with the advisories in the report", JSON.stringify(totals));
}

console.log(`npm audit totals (vulnerable packages): ${JSON.stringify(totals)}`);
console.log("\nAdvisories:");
let blocking = 0;
for (const advisory of advisories) {
  const { status, why } = classify(advisory, today);
  if (status === "BLOCKING") blocking += 1;
  console.log(
    `  ${status.padEnd(16)} ${advisory.severity.padEnd(9)} ${advisory.package} ${advisory.range}` +
      `  ${advisory.ghsa}  ${advisory.title}`,
  );
  if (why) console.log(`    ${why}`);
}

const stale = ALLOWLIST.filter(
  (e) => !advisories.some((a) => a.ghsa === e.ghsa && a.package === e.package),
);
for (const entry of stale) {
  console.error(
    `\nSTALE allowlist entry: ${entry.ghsa} (${entry.package}) is no longer reported by npm audit. ` +
      "Remove it from ALLOWLIST in scripts/check-npm-audit.mjs.",
  );
}

if (blocking > 0 || stale.length > 0) {
  fail(`${blocking} blocking advisory(ies), ${stale.length} stale allowlist entry(ies)`);
}
console.log("\nnpm audit check passed: no high or critical advisories outside the allowlist.");
