# Local-first QA Workspace

A browser-based scenario/test-case studio and execution-report workspace with a Material 3 / Pixel-inspired, responsive light/dark interface. No remote database or backend is required.

## Open and connect

Serve this directory on **localhost** (for example `npx http-server . -a 127.0.0.1`) or deploy the static files to HTTPS. Open it in desktop **Chrome or Edge**. Keep the same URL/origin when returning so the browser can remember your folder handle. Opening a downloaded HTML file alone is not the supported setup.

1. Enter your name and email as a **local attribution profile**, not an authenticated login.
2. Choose a designated local folder from the welcome screen and grant read/write access. The browser does not allow the app to choose an arbitrary disk path itself.
3. Add a project, then its modules. Switching modules restores that module's independent form, scenarios, test cases/statuses, checklists, defects and screenshots. A project can also have a project-level overview before modules are added.
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
            modules/
              <module-slug-and-sha256>/
                <revision>.json
                evidence/
                  <revision>-evidence.json
```

Readable names plus hashes prevent invalid characters, reserved filenames and similar project names from colliding. Each module revision includes attribution, the execution report and generated suite. Evidence JSON contains image data URLs, so backups remain self-contained. Project/module directories are created even when no record has been filled in yet.

The manifest is committed **after** the module and evidence files close successfully. Failed/interrupted writes leave the previous committed workspace readable. Old/orphaned revisions are intentionally retained rather than deleted automatically; only files referenced by `workspace.json` are current. Do not manually edit this structure while the app is open. Keep one editor per profile/folder. Same-origin tabs use a browser lock and stale revisions are rejected; simultaneous external programs or different origins cannot be fully locked by a browser app.

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

## Validation

Requires Node.js 22+; no test packages are required:

```powershell
node --test .\tests\local-workspace.test.js
node --check .\local-workspace.js
node --check .\workspace-ui.js
```

The storage tests cover project/module and evidence round-trips, profile separation, denied permission, partial/failed writes, stale-tab conflicts and corrupt/unsafe imports. A real browser should also be checked for native folder picking and permission prompts; automated directory mocks cannot validate OS-specific picker UI.