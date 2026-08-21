Bundled example ZIPs live in this folder:

- `starter-project.zip`
- `demo_backup.zip`

How to create it:

1. Build the project template in the app.
2. Use "Download project" from the home card menu.
3. Rename the exported file to the filename used by the route you want to add or update.
4. Put it in `apps/app/public/examples/`.

Runtime behavior:

- The example card imports `starter-project.zip` when the user opens it.
- The hosted `/demo` and `/demo_backup` routes import their corresponding ZIP directly in disposable demo mode.
- If a user never opens a demo, nothing is imported.
