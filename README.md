# Notes

A small note-taking PWA styled after Apple Notes. The editor shows formatting
as you write: select text and press Bold and it turns bold, or press Bold and
keep typing. Notes are stored as Markdown (the GitHub-comment kind), so backups
are readable text. There are no uploads. Notes are kept in the browser
(`localStorage`) and you can back them up to a JSON file and restore them.

Built with plain Vite + React + TypeScript. There are no other runtime
dependencies.

## Run

```sh
npm install
npm run dev        # development server (the service worker is off in dev)
npm run build      # type-check and build to dist/
npm run preview    # serve dist/ to try the PWA and offline mode
```

Deploy by uploading `dist/` to any static host. The build uses relative paths,
so a sub-folder works too. Installing as an app and offline use need HTTPS
(`localhost` also works).

## Features

- **Layout**: a sidebar and editor on wide screens. On phones you get the
  iOS-style list, which slides into the editor; the back gesture and back
  button close the note.
- **Organising**: notes are grouped into Pinned, Today, Yesterday, Previous 7
  Days, Previous 30 Days, then by month and year. The first line of a note is
  its title. Notes you leave empty are discarded. There is search, pinning, and
  delete with Undo.
- **Formatting**: the toolbar has heading, bold, italic, quote, code, link,
  and numbered, bulleted and checklist lists, and its buttons light up for the
  formatting under the caret. Shortcuts: `⌘/Ctrl+B` `I` `E` `K`,
  `⌘/Ctrl+Shift+.` `7` `8` `L`. The first line is shown as the title.
  Return continues a list and Return on an empty item ends it; Tab and
  Shift+Tab indent list items. Click a checklist circle to tick it. Code
  formats a word inline or, over several lines, makes a code block.
  `⌘/Ctrl`-click a link to open it, or put the caret in it and press Link to
  edit, open or remove it. Formatting goes through the browser's own undo
  stack, so `⌘Z` works.
- **Markdown as you type**: starting a line with `- `, `1. `, `[ ] `, `## `
  or `> ` makes that block; ```` ``` ```` + Return starts a code block and
  `---` + Return draws a line. Typing `**bold**`, `*italic*`, `` `code` `` or
  `~~strike~~` formats it, and a web address followed by a space becomes a
  link.
- **Clipboard**: copying puts Markdown on the clipboard as plain text, so it
  pastes formatted into GitHub and the like. Pasting Markdown text or web
  content keeps its formatting (cleaned to what Markdown can hold). Pasting a
  URL over selected text makes a link.
- **Backup**: from the ••• menu, *Back Up Notes* saves
  `notes-backup-YYYY-MM-DD.json` (the share sheet on phones).
  *Restore from Backup…* can **Merge** (keeps the newer copy of each note) or
  **Replace All Notes**.
- **PWA**: there is a manifest with icons and a *New Note* shortcut
  (`./?new`). A service worker precaches the whole build so the app works
  offline.

## Layout

```
src/
  App.tsx              state, navigation, persistence, backup/restore
  components/          Editor (toolbar + rich-text editing), NoteList, Menu, Alert, Toast, Icon
  lib/markdown.ts      Markdown → editor HTML, and any DOM (editor or pasted HTML) → Markdown
  lib/notes.ts         note model, storage, backup parsing and merging
  lib/dates.ts         list grouping and date labels
sw/sw.js               service worker template
vite.config.ts         writes dist/sw.js with the list of built files to precache
```

The editor is a `contenteditable` element driven by the browser's editing
commands (`execCommand`), which keeps native undo, spellcheck and IME input.
Each Markdown line is one block in the editor, and the Markdown is read back
from the editor on every change, so the stored text round-trips line for line.
Inline code is a `<font face="monospace">`, because that is what the
browser's own font command produces, so it toggles with the caret like bold.

The service worker serves cached files first and refreshes them in the
background. After a deploy, the new version appears on the next launch.
