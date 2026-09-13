# F7 · Data ingestion

**Covers** FR-47…FR-55 · **Fixes** M3, M4, M7, M8, M9, M27, M28 · **Tier** V1

Framework detail in **[`../07-ingestion.md`](../07-ingestion.md)**. This file is the feature view.

## Purpose

Get data in from anywhere, repeatably, with every row accounted for. The old system supported
exactly one source (a first-worksheet Excel file), hardcoded to one job board's column names,
with no validation, no error report, and a dedup rule that merged unrelated people.

Every competitor has "import CSV" and nothing else. A real ingestion framework is one of the
clearest gaps in the market (`../03-competitive-analysis.md`).

## User stories

- As a user I upload a spreadsheet, map its columns visually, preview exactly what will happen,
  and then commit.
- As a user I get a file of just the rows that failed, with a reason column, so I can fix and
  re-upload only those.
- As a user I connect a Google Sheet once and have it sync on a schedule.
- As a user I re-import an older, sparser file and it does not destroy the richer data I have.
- As a developer I add a new source type by writing one class.

## Acceptance criteria

- **AC-1** Files are processed entirely server-side and streamed; the browser sends a mapping,
  never the data (M3).
- **AC-2** A dry run is **mandatory** before commit and shows create/update/skip/error counts
  plus a sample diff of what a merge would overwrite.
- **AC-3** One bad row never aborts a run. Runs always complete; every row lands in
  `import_row` with an outcome (M4).
- **AC-4** Failed rows are downloadable as a spreadsheet with an `_error` column.
- **AC-5** Identity resolution is an ordered, configurable rule list; empty values never
  match (M7).
- **AC-6** Phone normalisation to E.164 is mandatory with a per-source default country;
  unparseable values become row errors (M8).
- **AC-7** Per-field merge policy is honoured; `fill_if_empty` is the default (M9).
- **AC-8** Runs are idempotent and resumable — a killed worker continues from the last
  committed batch, not from the beginning.
- **AC-9** Scheduled syncs read incrementally via a cursor, with per-source concurrency limits.
- **AC-10** All sources — Excel, CSV, Google Sheets, REST, webhook — pass the same
  `SourceConnector` contract suite.
- **AC-11** A 50,000-row file imports without the API process holding an open request (M27).

## Test cases

| id | Case | Expect |
|---|---|---|
| TC-7.1 | 50k rows, deliberately hostile fixture | Completes; every row imported or explained |
| TC-7.2 | Mixed date formats, `19 Year(s) 0 Month(s)`, lakh/crore salaries | Parsed per configured locale, or flagged — never silently wrong |
| TC-7.3 | Two rows, both blank email | Two contacts (M7 regression) |
| TC-7.4 | Phones in five formats, same number | One contact (M8 regression) |
| TC-7.5 | Re-import a sparser version of an existing file | No data lost (M9 regression) |
| TC-7.6 | Kill the worker at 60% | Resumes from the last batch; no duplicates |
| TC-7.7 | Non-UTF8 bytes in the file | Handled or reported per row; run completes |
| TC-7.8 | Dry run vs commit | Identical outcome counts |
| TC-7.9 | Download failed rows, fix, re-upload | Only those rows processed |
| TC-7.10 | REST source pointed at `169.254.169.254` | SSRF guard blocks it |
| TC-7.11 | Scheduled sync runs twice concurrently | Second defers; no double-write |
