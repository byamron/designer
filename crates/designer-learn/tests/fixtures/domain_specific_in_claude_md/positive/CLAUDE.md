# Project conventions

## Frontend

Prefer functional components in .tsx files; no class components.
Style with Tailwind tokens; do not invent CSS.
Compose menus and dialogs with Radix primitives wrapped by our shell.

## Backend

Backend code in crates/ uses tokio for async runtime.
Tauri command handlers live in apps/desktop/src-tauri/.

## Testing

Run pytest before pushing if any .py file changed.
