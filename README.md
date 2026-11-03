# Local-first QA Workspace

A browser-based scenario/test-case studio and execution-report workspace with a Material 3 / Pixel-inspired, responsive light/dark interface. No remote database or backend is required.

The compact module menu opens below its field. Use the + beside the module label to add a module; hover a row to reveal its copy action (also visible on keyboard focus and touch devices). Copying does not switch modules. Arrow keys move between module rows, Tab reaches the copy buttons, and Escape closes the menu. The floating section navigation tracks the visible block and accounts for its sticky position when jumping between sections; reduced-motion preferences disable animated scrolling.

The existing section navigation now uses a **MagnifyingDock** treatment: neighbouring glyphs respond smoothly to mouse proximity or keyboard focus while labels/hit targets stay stable, without bounce. Header actions expand smoothly to reveal their labels. On narrow screens the dock shows accessible, tooltip-labelled icons. Touch remains ordinary tap/scroll navigation, with no drag-to-select or hover animation. There is no duplicate navigation.

Use the expanding **Search** icon or **Ctrl/Cmd+K** inside the report/studio workspace to find projects, modules, test cases and scenarios in the loaded local workspace. Matching includes unsaved active-module text, test IDs, steps, expected results, category and status; words can be combined. Results are limited to the first 30 with a refine-search hint. Arrow keys select, Enter opens, Escape closes and Tab leaves search. Opening a result respects the existing save-before-switch flow; a failed save keeps the current module/edits and shows the error. Test/scenario results open their Studio tab and reveal the matching row. Search does not access other profiles, unopened folders, metrics export history or remote services.

Search and MagnifyingDock are native vanilla-JavaScript adaptations of the supplied [Bencho](https://bencho.dev/licence) MIT components. Applicable geometry comments are preserved alongside the adapted logic; styling is scoped to the components and mapped to existing app tokens. No React, icon package or permanent animation loop is introduced.

The dashboard/profile, Report, Studio, folder states, pickers, dialogs, search/navigation and Metrics use a consistent native Material 3-inspired control language: tonal selection, outlined fields, rounded containers, visible keyboard focus and smooth state layers in both themes. No React or MUI/Material Web runtime is required. Exported report pages and the Excel sheet layout keep their original document formatting.

Progress follows the [Material Web progress guidance](https://github.com/material-components/material-web/blob/main/docs/components/progress.md): saving uses an indeterminate linear track and compact circular status; Metrics export uses a circular busy action; longer guarded folder/workspace operations show a contained shape-morphing status adapted from the supplied Material Design recording. The floating navigation has one sliding active-section pill, with scrollspy still controlling the selection. Shape morphing and the screenshot-inspired rounded track/stop dot are native adaptations, not claims about Material Web's expressive component support. Indicators exist only during real operations, do not invent percentages, and stop on completion or failure. Reduced-motion mode keeps a static indicator and the same status text. The original Figma URL returned HTTP 403; implementation references the subsequently supplied recordings/screenshot, not unseen Figma content.

Initial entry is gated by real UI initialization and icon-font readiness, with an accessible full-screen loading state rather than a flash of icon ligature names. The icon stylesheet is non-render-blocking. If icons fail or take more than 3.5 seconds, local inline-SVG masks replace the glyphs (including dynamically updated icons); a small Reload/Dismiss notice explains recovery. UI initialization has a 6-second recovery notice, and failure to load the bootstrap script itself gives a Reload action after 8 seconds instead of a permanent spinner. Metrics uses the same readiness gate without an external icon-font dependency. These limits are failure bounds, not artificial minimum loading delays. Form label/action rows share responsive grid tracks, so wrapped labels do not push neighbouring controls out of alignment; add-project and add-module actions both live beside their labels.

Fresh modules and resets start with empty fields, not example business data. Saved user values and explicitly imported legacy data are preserved. The removed account-reference field is no longer required for exports; previously saved references remain in their records.

Email syntax checks reject incomplete addresses, malformed domains and invalid dot placement. This does **not** verify mailbox ownership or provide authentication; OTP is deferred. Selected module names can also be copied by hovering/focusing the closed field. Header action icons expand into labeled pills on hover/keyboard focus, and section changes use restrained feedback; reduced motion is respected.

## Open and connect

Serve this directory on **localhost** (for example `npx http-server . -a 127.0.0.1`) or deploy the static files to HTTPS. Open it in desktop **Chrome or Edge**. Keep the same URL/origin when returning so the browser can remember your folder handle. Opening a downloaded HTML file alone is not the supported setup.

1. Enter your name and email as a **local attribution profile**, not an authenticated login.
2. Choose a designated local folder from the welcome screen and grant read/write access. The browser does not allow the app to choose an arbitrary disk path itself.
3. Add a project, then its modules. Switching modules restores that module's independent form, scenarios, test cases/statuses, checklists, defects and screenshots. A project can also have a project-level overview before modules are added. Project folders include `project.json` with the full project/module names.
4. Changes auto-save after three seconds; Ctrl/Cmd+S saves immediately. The persistent status bar distinguishes pending edits, writes in progress, permission errors and completed folder saves.

The app stores only the theme/profile preference in localStorage and an optional folder handle in IndexedDB. Workspace content and evidence are saved to the selected folder; **failed writes never silently fall back to browser storage**. Unsupported browsers can edit in memory and import/download JSON backups, but cannot auto-save to a chosen folder. Do not close a page with pending edits without saving or downloading a backup.

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

If the browser reports stale cached file state (`InvalidStateError`), the app reacquires a fresh file snapshot when reading, or refreshes folder handles and retries a save once **only if the committed manifest is unchanged**. If the exact attempted manifest was already committed despite the reported error, it is recognized without another write. A changed manifest is never overwritten by recovery. Persistent errors keep edits unsaved in memory: **Backup** first, then **Reconnect folder**. Reopening a populated folder still asks before replacing your memory view.

## Returning, migration and recovery

- On reopening, an already-granted remembered folder is loaded; otherwise use **Reconnect folder** to explicitly request permission again. Denial, removed files, full disks, corrupted data and unavailable handle storage are surfaced. If browser site data was cleared, choose the same root folder again.
- **Import browser data** explicitly reads the original app's localStorage form/catalog and IndexedDB screenshots on the same origin. It attributes that old shared workspace to the selected profile, with confirmation. Original browser data is **never deleted or overwritten**. If the origin changed, export a JSON backup from the original app first.
- **Backup** exports every project/module, current in-memory edits, evidence, activity and attribution. A download is a recovery copy, not a successful folder save. Keep backups in a safe location.
- **Import backup** accepts the old version-2 format and the new version-3 format. It validates before merging, confirms replacement of matching module records, keeps unrelated modules, and retains imported attribution. On folder-write failure the imported data stays in memory so it can be backed up or retried.
- Changing folders first saves pending changes to the current connection. If a folder is not connected, a new empty folder can adopt your memory draft; opening a populated folder requires explicit confirmation before replacing the view.
- To recover from a stale-tab conflict or inaccessible folder, download a backup, then use **Disconnect**. No disk files are deleted; edits stay in memory. Choose the root again to reopen the last committed version (with confirmation), or choose a new empty root to save your retained edits there.
- **Clear current module** clears only the selected module, not other modules, profiles, old browser data or retained disk revisions. Download a backup first when needed.

## Privacy and team metrics

Profiles separate and attribute files; **they are not authentication or access control**. Anyone with operating-system access to the selected folder can read all profiles. Use a user-private folder and OS permissions for real protection. Files/backups are plaintext; enter test account references, never passwords, API keys or production secrets into workspace fields. Existing optional Gemini-key settings remain browser-local and are not included in workspace backups.

This phase is deliberately local-only. There is no automatic manager/team synchronization, authenticated team visibility or weekly team aggregation. Those need an explicit sharing/import policy or a later authenticated backend; a browser identity cannot safely provide them. Existing per-module test-status counts remain available in the studio.

Google Fonts are optional network resources for typography/icons; no workspace content is sent to them. Core persistence and generation do not depend on a remote service. Motion respects reduced-motion settings.

## Quality Metrics

Open **Quality Metrics** beside Execution Report / Test Studio, from the workspace chooser or the More menu. It opens inside the existing app; **Execution Report** and **Test Studio** remain visible in its workspace navigation and return directly to those views without reloading either draft. **Back to workspace** returns to the previous view. Enter a month, project and metrics in the **Engineering Metrics** and **Operations Metrics** sheets, then select **Download .xlsx**. The **Formulas** sheet explains calculations. Use the week buttons to jump through the spreadsheet; keyboard arrow keys switch worksheet tabs. On the standalone `quality-metrics.html` page, the report/studio links open the main app in another tab to keep the metrics draft intact; enter your local profile if needed.

Inside QA Workspace, **Save & download .xlsx** saves the workbook and entered metrics to that project's **QA metrics** folder, then requests the browser download. Choose/reconnect a workspace folder first. Existing project names are suggested; a new name creates a project with no modules. Each export uses a unique subfolder to retain earlier files without overwriting them. `complete.json` marks an export whose workbook and draft both finished writing; interrupted exports without this marker are not complete. The saved path appears below the form. Failure is shown explicitly and retains the draft; no silent download-only fallback occurs. The standalone page remains download-only, with no workspace-folder connection.

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
node --test .\tests\email-validation.test.js .\tests\local-workspace.test.js .\tests\workspace-save.test.js .\tests\quality-metrics.test.js .\tests\ui-bootstrap.test.js
node --check .\local-workspace.js
node --check .\workspace-ui.js
node --check .\ui-bootstrap.js
```

The tests cover project/module and evidence round-trips, profile separation, denied permission, partial/failed writes, stale snapshots and cached-state failures at each write stage, concurrent disk edits, bounded retries, retained UI drafts, corrupt/unsafe imports, search matching/unsaved overlays and save-guarded search navigation. A real browser should also be checked for native folder picking and permission prompts; automated directory mocks cannot validate OS-specific picker UI or reproduce every disk/provider-specific failure.