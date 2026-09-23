#!/usr/bin/env python3
"""Upload the official DOCX 8/9 pair, run analysis, and save the actual API result.

Start the backend with ANALYSIS_MODE=fast first. This command makes a paid live
model request through that server; it never substitutes synthetic findings.
"""

import argparse
import json
import time
from pathlib import Path

import httpx

BACKEND_DIR = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=float, default=330)
    args = parser.parse_args()
    fixture = json.loads((BACKEND_DIR / "fixtures/demo_analysis.json").read_text())

    def checked(response: httpx.Response):
        response.raise_for_status()
        return response.json()

    with httpx.Client(base_url=args.base_url, timeout=60) as client:
        health = checked(client.get("/api/health"))
        if not health["ai_configured"]:
            raise SystemExit("Configure the backend AI provider before running this command.")
        analysis = checked(client.post(
            "/api/analyses", json={"title": "Быстрый анализ DOCX: редакция 8 → 9"},
        ))
        analysis_id = analysis["id"]
        for definition in fixture["documents"]:
            path = BACKEND_DIR.parent / definition["source_path"]
            document = checked(client.post(
                f"/api/analyses/{analysis_id}/documents",
                data={"side": definition["side"]},
                files={"file": (path.name, path.read_bytes(),
                                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            ))
            checked(client.patch(
                f"/api/analyses/{analysis_id}/documents/{document['id']}",
                json={"revision_label": definition["revision_label"]},
            ))
            print(f"{definition['side']}: {document['block_count']} blocks", flush=True)
        started = time.monotonic()
        accepted = checked(client.post(
            f"/api/analyses/{analysis_id}/runs",
            json={"output_language": "ru", "allow_partial": True},
        ))
        run_id = accepted["run_id"]
        destination = BACKEND_DIR / "storage/reports" / run_id
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "analysis.json").write_text(json.dumps(analysis, ensure_ascii=False, indent=2))
        print(f"analysis_id={analysis_id} run_id={run_id}", flush=True)
        previous = None
        while True:
            run = checked(client.get(f"/api/runs/{run_id}"))
            (destination / "run.json").write_text(json.dumps(run, ensure_ascii=False, indent=2))
            coverage = run["coverage"]
            status = (run["state"], run["stage"], coverage["processed_sources"], run["finding_count"])
            if status != previous:
                print(f"{time.monotonic() - started:.1f}s: {status}", flush=True)
                previous = status
            if run["state"] not in {"queued", "running"}:
                break
            if time.monotonic() - started > args.timeout:
                raise SystemExit(f"Polling timed out; inspect run {run_id}. It was not cancelled.")
            time.sleep(2)
        findings = checked(client.get(f"/api/runs/{run_id}/findings"))
        (destination / "findings.json").write_text(json.dumps(findings, ensure_ascii=False, indent=2))
        if run["state"] in {"partial", "completed"}:
            report = client.get(f"/api/runs/{run_id}/report", params={"lang": "ru", "format": "html"})
            report.raise_for_status()
            (destination / "report.html").write_text(report.text)
        print(json.dumps({"state": run["state"], "elapsed_seconds": round(time.monotonic() - started, 1),
                          "findings": len(findings), "errors": run["errors"],
                          "artifacts": str(destination)}, ensure_ascii=False), flush=True)
        if run["state"] not in {"partial", "completed"} or not findings:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
