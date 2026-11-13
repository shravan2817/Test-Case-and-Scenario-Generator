# Local-first QA Workspace

A browser-based scenario/test-case studio and execution-report workspace with a Material 3 / Pixel-inspired, responsive light/dark interface. No remote database or backend is required.

The compact module menu opens below its field. Use the + beside the module label to add a module; hover a row to reveal its copy action (also visible on keyboard focus and touch devices). Copying does not switch modules. Arrow keys move between module rows, Tab reaches the copy buttons, and Escape closes the menu. A compact horizontal section bar tracks the visible block at every screen size. Main report and Studio cards start expanded and can be independently collapsed with keyboard-accessible controls, without expansion animation.

The Execution Report / Test Studio tabs and the Studio result tabs announce their selected state and linked panels. Use Left/Right Arrow to switch tabs, or Home/End for the first/last tab; Tab moves out of the tab strip.

The section navigation uses a **MagnifyingDock** treatment: neighbouring glyphs respond smoothly to mouse proximity or keyboard focus while labels/hit targets stay stable, without bounce. Touch remains ordinary tap/scroll navigation, with no drag-to-select or hover animation. There is no duplicate navigation.

Use the expanding **Search** icon or **Ctrl/Cmd+K** inside the report/studio workspace to find projects, modules, test cases and scenarios in the loaded local workspace. Matching includes unsaved active-module text, test IDs, steps, expected results, category and status; words can be combined. Results are limited to the first 30 with a refine-search hint. Arrow keys select, Enter opens, Escape closes and Tab leaves search. Opening a result uses save-before-switch; if a folder needs reconnecting, edits stay in memory with a warning and navigation continues. Other save failures keep the current module and show the error. Test/scenario results open their Studio tab and reveal the matching row. Search does not access other profiles, unopened folders, metrics export history or remote services.

Search and MagnifyingDock are native vanilla-JavaScript adaptations of the supplied [Bencho](https://bencho.dev/licence) MIT components. Applicable geometry comments are preserved alongside the adapted logic; styling is scoped to the components and mapped to existing app tokens. No React, icon package or permanent animation loop is introduced.

The dashboard/profile, Report, Studio, folder states, pickers, dialogs, search/navigation and Metrics use a consistent native Material 3-inspired control language: tonal selection, outlined fields, rounded containers, visible keyboard focus and smooth state layers in both themes. No React or MUI/Material Web runtime is required. Exported report pages and the Excel sheet layout keep their original document formatting.

Progress follows the [Material Web progress guidance](https://github.com/material-components/material-web/blob/main/docs/components/progress.md): with a connected folder, workspace autosave shows three animated dots while pending or writing, **Saved to folder** only after the latest edit is confirmed, and **Save failed** when a save/import operation reports an error. Without folder access, the status instead says **In memory only** or distinguishes a downloaded backup from a completed folder save. Metrics export uses a circular busy action; longer guarded folder/workspace operations show a contained shape-morphing status adapted from the supplied Material Design recording. The horizontal section bar has one sliding active-section pill, with scrollspy still controlling the selection. Shape morphing and the screenshot-inspired rounded track/stop dot are native adaptations, not claims about Material Web's expressive component support. Indicators exist only during real operations, do not invent percentages, and stop on completion or failure. Reduced-motion mode keeps a static indicator and the same status text. The original Figma URL returned HTTP 403; implementation references the subsequently supplied recordings/screenshot, not unseen Figma content.

Initial entry is gated by real UI initialization and icon-font readiness, with an accessible full-screen loading state rather than a flash of icon ligature names. The icon stylesheet is non-render-blocking. If icons fail or take more than 3.5 seconds, local inline-SVG masks replace the glyphs (including dynamically updated icons); a small Reload/Dismiss notice explains recovery. UI initialization has a 6-second recovery notice, and failure to load the bootstrap script itself gives a Reload action after 8 seconds instead of a permanent spinner. Metrics uses the same readiness gate without an external icon-font dependency. These limits are failure bounds, not artificial minimum loading delays. Form label/action rows share responsive grid tracks, so wrapped labels do not push neighbouring controls out of alignment; add-project and add-module actions both live beside their labels.

Fresh modules and resets start with empty fields, not example business data. Saved user values and explicitly imported legacy data are preserved. The removed account-reference field is no longer required for exports; previously saved references remain in their records.

Email syntax checks reject incomplete addresses, malformed domains and invalid dot placement. This does **not** verify mailbox ownership or provide authentication; OTP is deferred. Selected module names can also be copied by hovering/focusing the closed field. Header utilities, including theme, preview and exports, are in the More actions menu. Opening a workspace uses a brief portal transition; reduced motion is respected.

## Open and connect

Serve this directory on **localhost** (for example `npx http-server . -a 127.0.0.1`) or deploy the static files to HTTPS. For folder autosave, use a supported desktop browser such as **Chrome or Edge**. If the app runs in a browser without folder picking, its editing, report, Studio, Quality Metrics, and JSON backup/import remain available without autosave. Keep the same URL/origin when returning so a supported browser can remember your folder handle. Opening a downloaded HTML file alone is not the supported setup.

1. Enter your name and email as a **local attribution profile**, not an authenticated login.
2. In a supported browser, choose a designated local folder from the welcome screen and grant read/write access. The browser does not allow the app to choose an arbitrary disk path itself. Disconnect, import, backup and folder help are under **Backup & storage options**. Without folder access, use **Import JSON backup** or **Download JSON backup** instead.
3. Add a project, then its modules. Switching modules restores that module's independent form, scenarios, test cases/statuses, checklists, defects and screenshots. A project can also have a project-level overview before modules are added. Project folders include `project.json` with the full project/module names.
   Open **Activity history** and choose **Projects** or **Timeline**. Open a project, then its Reports, Test Scenarios or Test Cases folder to see the relevant modules, stored descriptions and direct-open actions. Timeline shows recorded activity with date and time. Clearing activity does not remove projects or their contents.
4. With a connected folder, changes auto-save after three seconds; Ctrl/Cmd+S saves immediately. Without a folder, changes remain in memory for the current tab: **Download JSON backup** or Ctrl/Cmd+S downloads a copy, and a leave-page warning appears while edits are unsaved. Download a fresh backup after further edits. The status shows the difference between an in-memory draft, a downloaded backup, and a successful folder save.

Execution evidence can be added as repeatable rows, each pairing a navigation path with one or more screenshots. Rows and images can be edited or removed independently; incomplete path/screenshot pairs are kept in the workspace but must be completed before export. Existing screenshots without a path remain available in the legacy evidence area and are retained in backups and exports. Paired paths stay directly above their screenshots in preview, Word, PDF/print, and the saved screenshot gallery; `-->` is rendered as `→`, with the path shown in normal weight and no generated “Navigation path” prefix. Screenshot exports embed the original image pixels without downsampling or JPEG recompression, preserve aspect ratio and never enlarge small sources. Portrait screenshots can now use up to 8.5 inches of page height instead of being squeezed into 3.5 inches; landscape screenshots fit the page width. Very tall or low-resolution sources may still need closer crops for readable text. Word can apply its own compression when resaving; choose **File > Options > Advanced > Image Size and Quality > Do not compress images in file** and **High fidelity** where available. Report exports retain the supplied reference's Letter page size, margins, Arial typography, and paragraph spacing. A faint transparent APCFSS mark appears behind app screens and report pages without changing content opacity.

Test Studio preview and PDF/print lay out each test case as a readable section so long scenarios, steps and expected results can flow across pages. Word and CSV exports keep their existing table formats.

Report export/print and Studio generation require both **Test URL** and **Build Version**. Defect severity, priority and status include common Jira and Mantis choices; existing custom values remain available when a record is reopened. Jira and Mantis workflows can be customized, so these lists are not exhaustive.

Test Studio can read an FRS/BRS PDF, DOCX or UTF-8 TXT locally. Select a file or enter an explanation; the original file and extracted source text are not saved as a document. Generated cases are saved normally and can include requirement wording, so review them before sharing a backup. There is no requirement-line count limit: offline templates process every nonempty requirement, without truncation or lossy summarization. Long Ollama inputs are automatically split into sequential requests of at most 20,000 characters, preserving all input text; progress shows the current batch. All batches must succeed before replacing the current drafts, and Cancel keeps the old drafts. Model output remains a reviewable draft, not proof of complete coverage; real-model accuracy on large documents is unverified. Files must still be at most 10 MB and extracted text at most 200,000 characters to bound browser memory use. Scanned PDFs require text recognition first; locked, damaged and unsupported files show an error. Re-select a document after changing modules or reloading. The included PDF.js and Mammoth browser readers and their licenses are in `assets/vendor`; they do not upload documents.

New generation focuses on main functional workflows and an explicitly named end-to-end case, not extra generic negative/basic checks. Offline templates retain each requirement in a functional workflow and propose a combined end-to-end checklist in document order; review that order and separate unrelated workflows before execution. Ollama is instructed to generate business-functional and end-to-end cases with basic UI/login checks only as relevant prerequisites. Its interpretation is not guaranteed. Existing saved cases of every category remain unchanged until you explicitly confirm replacement.

If Studio reports that generation files could not load, save to the connected folder or download a JSON backup before hard-reloading the page. App asset URLs are versioned to reduce mixed cached files; a hard reload may still be needed to fetch an updated HTML page. When deploying a changed app or updating `cloud-config.js`, update the asset version in `index.html` so browsers request the new files.

Hover over an image for two seconds to see a larger preview; moving away or scrolling closes it. Screenshot thumbnails and document preview images can also be focused and opened with Enter or Space. Touch users can tap screenshots to open them.

The app stores only the theme/profile preference in localStorage and an optional folder handle in IndexedDB. Workspace content and evidence are saved to the selected folder; **failed writes never silently fall back to browser storage**. In a browser without the File System Access picker, there is no supported way for this static app to write to an arbitrary folder; HTTPS does not add a missing browser API. You can still edit, use reports/Studio/Quality Metrics, and import or download validated JSON backups. Without folder autosave, edits exist only in the open tab until backed up. Do not leave with pending edits unless you intend to discard them.

## Folder layout

```text
<selected folder>
  qa-workspace/
    users/
      <email-slug-and-sha256>/
        workspace.json
        projects/
          <project-slug-and-sha256>/
            project.json
            QA metrics/
              <export-id>/
                projectname_YYYY-MM_qualitymetrics.xlsx
                metrics.json
                complete.json
            modules/
              <module-slug-and-sha256>/
                module.json
                <revision>.json
                evidence/
                  <revision>.json
                screenshots/
                  <revision>/
                    screenshots.html
                    prod-1.png
                    exec-1.png
                mantisreport/
                  <revision>/
                    report.html
                    report.json
                test-cases/
                  <revision>/
                    test-cases.html
                    test-cases.json
```

Compact readable names plus hashes avoid invalid characters and reduce Windows path-length failures. The profile folder is retained so different users' data does not overwrite each other. Existing longer profile paths and evidence filenames remain readable. Choose a short root such as `C:\QA` if your browser reports a missing directory while saving to a deeply nested folder. Each module revision includes attribution, the execution report and generated suite. Evidence JSON contains image data URLs, so backups remain self-contained. Project/module directories and their organized subfolders are created even when no record has been filled in yet. Open the HTML files directly for readable Mantis reports, test cases and screenshot galleries; the screenshots themselves are ordinary image files. Older data is not moved or deleted; organized copies are created on the next successful workspace save even if an older module has not been edited. Module revision JSON includes `organizedFiles` paths for the corresponding copies.

The manifest is committed **after** the module and evidence files close successfully. Failed/interrupted writes leave the previous committed workspace readable. Old/orphaned revisions are intentionally retained rather than deleted automatically; only files referenced by `workspace.json` are current. Do not manually edit this structure while the app is open. Keep one editor per profile/folder. Same-origin tabs use a browser lock and stale revisions are rejected; simultaneous external programs or different origins cannot be fully locked by a browser app.

If the browser reports stale cached file state (`InvalidStateError`), the app reacquires a fresh file snapshot when reading, or refreshes folder handles and retries a save once **only if the committed manifest is unchanged**. If the exact attempted manifest was already committed despite the reported error, it is recognized without another write. A changed manifest is never overwritten by recovery. When a folder is missing, denied or changed, navigation remains available and edits are explicitly marked as **in memory only**. Download a JSON backup before leaving, then use **Reconnect folder**. Other save failures still stop navigation to protect unsaved edits. Reopening a populated folder still asks before replacing your memory view.

If `workspace.json` references a missing module folder, record or evidence file, opening now reports **workspace is incomplete**, not that the selected root folder is missing. Restore a complete JSON backup or select the original complete workspace; repeatedly reconnecting cannot recreate missing data. No records are silently skipped and no files are removed. A failed replacement folder leaves a healthy current connection intact. A failed stale-handle reconnect lets the next attempt open the picker instead of repeatedly using the broken handle.

Manual folder loading and remembering the selected handle each have a 30-second limit after the picker closes; time spent choosing a folder is not limited. Folder saves have a 60-second limit, including waiting for the browser lock. Disconnect waits at most four seconds for a pending save or handle deletion instead of blocking editing indefinitely. A timeout releases the UI, keeps unsaved edits dirty and does not let a late load replace the view or a late save claim success. An already-running native disk write might still finish; queued timed-out writes are cancelled, and the save queue is retained to avoid overlapping writes. If a disk operation remains stuck, download a JSON backup before closing/reopening the tab and choosing a writable folder again.

## Returning, migration and recovery

- On reopening, an already-granted remembered folder is loaded; otherwise use **Reconnect folder** to explicitly request permission again. Denial, removed files, full disks, corrupted data and unavailable handle storage are surfaced. If browser site data was cleared, choose the same root folder again.
- If the saved folder is missing, denied or takes too long to restore, use **Forget saved folder**, then **Choose folder** on the welcome screen. This removes only the remembered browser handle, not the folder or its files. Your open edits stay in memory; download a JSON backup before reloading or leaving. If the browser cannot forget the handle, the app reports the failure and you can retry.
- **Import browser data** explicitly reads the original app's localStorage form/catalog and IndexedDB screenshots on the same origin. It attributes that old shared workspace to the selected profile, with confirmation. Original browser data is **never deleted or overwritten**. If the origin changed, export a JSON backup from the original app first.
- **Backup** exports every project/module, current in-memory edits, evidence, activity and attribution. A download is a recovery copy, not a successful folder save. Keep backups in a safe location.
- **Import backup** accepts the old version-2 format and the new version-3 format. It validates before merging, confirms replacement of matching module records, keeps unrelated modules, and retains imported attribution. On folder-write failure the imported data stays in memory so it can be backed up or retried.
- Changing folders first saves pending changes to the current connection. If a folder is not connected, a new empty folder can adopt your memory draft; opening a populated folder requires explicit confirmation before replacing the view.
- To recover from a stale-tab conflict or inaccessible folder, download a backup, then use **Disconnect**. No disk files are deleted; edits stay in memory. Choose the root again to reopen the last committed version (with confirmation), or choose a new empty root to save your retained edits there.
- **Clear current module** clears only the selected module, not other modules, profiles, old browser data or retained disk revisions. Download a backup first when needed.

## Privacy and team metrics

Profiles separate and attribute files; **they are not authentication or access control**. Anyone with operating-system access to the selected folder can read all profiles. Use a user-private folder and OS permissions for real protection. Files/backups are plaintext; enter test account references, never passwords, API keys or production secrets into workspace fields. Existing optional Gemini-key settings remain browser-local and are not included in workspace backups.

### Optional local Ollama generation

Test Studio starts with offline functional/end-to-end templates and makes no AI connection by default. Enter a requirement or upload a document, then choose **Generate test cases**; **More details & screenshots** is optional, and the work type defaults to **General workflow**. Test URL and Build Version are still required. For AI, turn on **Use local AI**: the app connects to Ollama and automatically selects your saved model if available, otherwise the first installed local model. **Change model** opens the model picker; the server address and troubleshooting live under **Connection settings & help**. A failed connection stays visibly in AI mode with **Retry connection**; turn off the toggle explicitly to use templates. There is no silent fallback. Cloud generation and the separate Gemini key menu remain hidden and disabled, with their code and settings retained. Review generated cases before use; they do not prove coverage or execution. Existing suites are confirmed before replacement and stay unchanged on AI failures.

To use AI generation, [install Ollama](https://ollama.com/download), start it, and install a local model using the [Ollama model library](https://ollama.com/library), then enable **Use local AI** in Studio. No API key or manual connection test is needed for the default `http://localhost:11434` address. **More → Local Ollama settings** remains available for advanced setup; **Find models** refreshes the installed model list. The app does not install Ollama or download models. Cloud model names are not offered; for an Ollama server-wide local-only setting, Ollama documents `OLLAMA_NO_CLOUD=1`.

Before generating, the app reads the selected model's `/api/show` metadata once per run. It requests `think: false` only when the model explicitly supports it, otherwise `think: "low"` if advertised; models without those controls keep their defaults. See [Ollama thinking controls](https://docs.ollama.com/capabilities/thinking). Prompts request concise actions and outcomes without dropping supplied business rules; the output token ceiling is unchanged to avoid extra truncation. These settings apply only to this app's requests, not Ollama globally. Large CPU-only models can still take minutes, and generated coverage and accuracy still require review.

The browser sends only the testing scope, requirement explanation and selected document text, UI fields and impacted module names to the Ollama process on the **same device**. It does not send the profile, project/module names, test URL, login reference, screenshots or saved workspace. Requirement text is still sent to the local model, so do not include passwords, API keys or other secrets in it.

Browser CORS policy can block the local request. Keep Ollama bound to its default localhost address; **do not** set `OLLAMA_HOST=0.0.0.0`, expose the service to your LAN, install a proxy, or disable browser security. If needed, allow only the exact origin serving this app with Ollama's [`OLLAMA_ORIGINS`](https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins) setting, then restart Ollama. For example, when the app is served at `http://localhost:8000`, add exactly `http://localhost:8000`; include the scheme and port. On Windows, quit Ollama from the taskbar, add `OLLAMA_ORIGINS` under your user environment variables, and start Ollama again. Ollama allows loopback origins such as `127.0.0.1` by default, but the exact `localhost` origin may need to be added.

GitHub Pages remains a static site: Ollama must be running on each user's own device. A Pages user would need to allow that exact Pages HTTPS origin in `OLLAMA_ORIGINS`; browser rules may still prevent an HTTPS page from calling local HTTP services. If that happens, use the app served from localhost instead. Never bypass browser protections to make it work. If the connection or generation fails, the app shows a local-server/CORS/model/context error and keeps the existing cases and edits; it never silently switches to template output. If a local model takes too long, use **Cancel generation** to return to the workspace without replacing cases. Each generation batch times out after five minutes, including while reading the response; the preliminary model-details lookup has a ten-second timeout.

### Disabled cloud example (retained for reference)

Cloud generation is currently hidden and disabled, even if a proxy URL is configured. The following describes the retained example only; do not deploy it expecting the current app to use it. If cloud is deliberately re-enabled in a future change, it would ask for confirmation before sending the requirement explanation and selected document text, testing scope, UI fields and connected modules to the configured proxy and Google Gemini. The original document file, profile, project/module names, test URL, login reference and screenshots are not sent. Do not send secrets or sensitive requirements without authorization. The provider may retain or use submitted data according to its terms and account settings; review those before enabling this feature. Cloud output is a draft, not guaranteed accurate or complete. Failures never switch to offline or replace existing cases.

The owner configures the service once:

1. Deploy `tools/cloud-proxy.js` and `ollama-client.js` together on a Node.js 20+ server, behind an HTTPS reverse proxy. The example listens only on `127.0.0.1:8788` by default; forward `/generate` to it. Do not publish the Node port directly or enable public access without appropriate protections.
2. Set `GEMINI_API_KEY` **only in the server's secret manager/environment**, never in browser files, the repository or a command saved in shell history. Set `ALLOWED_ORIGIN` to the exact HTTPS origin serving the app, e.g. `https://workspace.example.com` (no path or trailing slash). Optionally set `GEMINI_MODEL` to an available structured-output model; the example defaults to `gemini-3.8-flash`. Set `PORT` if needed. Start with `node tools/cloud-proxy.js`.
3. Configure HTTPS routing, for example an Nginx `location /generate { proxy_pass http://127.0.0.1:8788/generate; }` inside an already configured TLS server. Keep the Node port private. Consult the hosting provider's instructions for TLS, startup and secrets.
4. If cloud is re-enabled in a future change, the deployed app's `cloud-config.js` can set `QA_CLOUD_PROXY_URL` to the complete HTTPS proxy URL, for example `https://proxy.example.com/generate`. This is a public endpoint address, **not a key**. Setting it does not enable cloud generation in the current app.

For owner-only local testing, the proxy accepts an HTTP loopback origin and the browser setting may use `http://127.0.0.1:8788/generate`; set `ALLOWED_ORIGIN` to the exact local app origin, such as `http://127.0.0.1:8765`. The server still needs the owner's Gemini key. Requests use the proxy's exact `/generate` path; the app sends no cookies and rejects URL credentials, query strings, redirects and non-HTTPS non-local endpoints.

**Important security and cost limits:** the example's in-memory limit is 10 requests per minute per socket IP, per process. Behind a reverse proxy all clients may share one socket IP; it intentionally does not trust forwarded IP headers. Limits reset on restart and do not coordinate across instances. CORS and Origin checks are not authentication and can be spoofed outside a browser. Before exposing the proxy, the owner must apply a trusted network/IP allowlist or comparable access control, distributed rate limits, provider quotas and billing alerts at the hosting edge. This example does not identify or authenticate users, and the app's local profile is not authentication. Never log request bodies or provider keys. Limit input to 20,000 requirement characters and 100 lines; generation can still fail if the provider/model has different limits. A real Google request and its output accuracy have not been verified in this workspace.

There is no automatic manager/team synchronization, authenticated team visibility or weekly team aggregation. Those need an explicit sharing/import policy or a later authenticated backend; a browser identity cannot safely provide them. Existing per-module test-status counts remain available in the studio.

Google Fonts are optional network resources for typography/icons; no workspace content is sent to them. Core persistence and offline template generation do not depend on a remote service. Motion respects reduced-motion settings.

## Quality Metrics

Quality Metrics entry points in the workspace are temporarily hidden; its implementation and saved data are retained. The standalone `quality-metrics.html` page remains available for download-only use, with report/studio links opening the main app in another tab to keep the metrics draft intact. Enter a month, project and metrics in the **Engineering Metrics** and **Operations Metrics** sheets, then select **Download .xlsx**. The **Formulas** sheet explains calculations. Use the week buttons to jump through the spreadsheet; keyboard arrow keys switch worksheet tabs.

When the workspace entry points are restored, **Save & download .xlsx** saves the workbook and entered metrics to that project's **QA metrics** folder, then requests the browser download. Choose/reconnect a workspace folder first. Existing project names are suggested; a new name creates a project with no modules. Each export uses a unique subfolder to retain earlier files without overwriting them. `complete.json` marks an export whose workbook and draft both finished writing; interrupted exports without this marker are not complete. The saved path appears below the form. Failure is shown explicitly and retains the draft; no silent download-only fallback occurs. The standalone page remains download-only, with no workspace-folder connection.

The download filename is **`projectname_YYYY-MM_qualitymetrics.xlsx`** (for example `My_Project_2026-01_qualitymetrics.xlsx`); filename-unsafe characters become underscores. Metrics are not auto-saved on every edit and are not written to localStorage, IndexedDB or a server. Drafts remain in memory when switching sheets/modules; leaving with edits prompts a warning. Save/download before closing. Clear removes only the tab's metrics draft, not saved files or project data. Sample business data and source-workbook author metadata are not shipped. Workspace JSON backups cover report/studio records, not the separate metrics export history; keep the downloaded workbook or back up the project's **QA metrics** folder as well.

The sanitized template retains the supplied workbook's three sheet names, merged ranges, borders, alignment, fonts/fills, row heights, column widths and print margins. It starts with the original 74 feature rows. Use **+ beside any row → Insert above / Insert below** to add exactly where needed, including between existing entries (up to 1,000 feature rows per sheet). The row control stays visible while scrolling horizontally; Escape closes its menu. Rows are independent in Engineering and Operations. Existing entries move with their rows; week/month/project merges, dates and Excel formulas adjust automatically. Inserted rows stay in the selected row's week, inherit its styling, and share a merged date when inserted inside that group; otherwise they have their own date. The UI-only row controls are not exported. Clear resets added rows too. Scroll horizontally to reach all metrics. The engineering sheet's first header row is hidden in the source workbook and remains hidden in Excel; the entry UI shows it for readability. Dates export as `DD/MM/YYYY` text because the source date cells use General formatting. Original business values, dates and example calculations are removed. Cost of Quality includes all four cost categories; coverage, density, leakage and MTTR have formulas plus cached results and recalculate in Excel. Empty/zero denominators stay blank rather than producing divide errors.

No Excel library or network service is required. `quality-metrics-template.js` is generated from the supplied layout; to deliberately replace it using a workbook you are authorized to use:

```powershell
.\tools\build-quality-template.ps1 -Source 'C:\path\Quality_Metrics.xlsx'
```

The builder targets this specific three-sheet layout, not arbitrary workbook import.

## Validation

Requires Node.js 22+; no test packages are required:

```powershell
node --test .\tests\email-validation.test.js .\tests\local-workspace.test.js .\tests\workspace-save.test.js .\tests\workspace-accordions.test.js .\tests\evidence-export-format.test.js .\tests\quality-metrics.test.js .\tests\ui-bootstrap.test.js .\tests\ollama-client.test.js
node --check .\local-workspace.js
node --check .\workspace-ui.js
node --check .\ui-bootstrap.js
node --check .\ollama-client.js
```

The tests cover project/module and evidence round-trips, profile separation, denied permission, partial/failed writes, stale snapshots and cached-state failures at each write stage, concurrent disk edits, bounded retries, retained UI drafts, corrupt/unsafe imports, search matching/unsaved overlays and save-guarded search navigation. A real browser should also be checked for native folder picking and permission prompts; automated directory mocks cannot validate OS-specific picker UI or reproduce every disk/provider-specific failure.