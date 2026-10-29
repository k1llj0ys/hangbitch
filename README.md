# Hangbitch

A cheeky, seven-life Hangman game **and** a public-key encryptor — wearing a
classic **Microsoft Paint / Windows XP** costume. Everything runs in the
browser: no accounts, no backend, and no network requests during play.

Hangbitch is a **standalone, self-contained app**: everything it needs ships in
the `app/` folder, and it never reaches outside this project.

> **Zero setup.** One **built-in key pair** ships with the app, so both jobs work
> the moment you open it. The built-in private key is **public by design** (it is
> published with the page): a convenience default, not a secret. Want your own?
> **Key settings → Change key pair.**

---

## 1. The two jobs

| Job | What it does |
|---|---|
| **Play a game** | Type a word yourself, **or** paste an encrypted word someone sent you. Seven lives, one beer. |
| **Generate a word** | Type a secret, encrypt it in your browser, and send the host the payload. The plaintext never leaves your device. |

```
  HOST (runs the game)                        COWORKER
  --------------------                        --------
  1. Opens the app
  2. Shares the app URL
  3. Receives the "BHANGMAN1.…" payload  ◄─── 4. "Generate a word"
                                               5. Types a secret word + hint
                                                  (encrypted in their browser)
                                               6. Copies the payload
                                               7. Sends it in Teams
  8. "Play a game" → paste the payload
  9. It decrypts locally;
     everyone guesses out loud
```

---

## 2. Folder structure

```
hangbitch/
├── app/                      ← THE APP (this folder is what gets published)
│   ├── index.html            the one page: home / play / game / encrypt / keys
│   ├── paint.css             Windows XP / Paint theme (gray face, bevels, white canvas)
│   ├── app.js                UI controller (Paint chrome + the five views)
│   ├── crypto.js             the crypto core (hybrid AES-GCM + RSA-OAEP)
│   ├── default-keys.js       the BUILT-IN key pair (zero-setup default)
│   ├── game-logic.js         pure seven-life rules (no DOM)
│   ├── key-management.js     storage, clipboard and file helpers (hb.* keys)
│   ├── manifest.json         PWA manifest ("Hangbitch")
│   ├── service-worker.js     offline cache (same-origin files only)
│   └── assets/icon.svg       inline app icon
├── shared/
│   └── payload-format.md     the documented payload / backup format
├── tests/
│   ├── hangbitch-tests.js    automated checks (see §7)
│   └── harness.js            a tiny dependency-free test harness
├── tools/
│   └── serve.js              Node.js fallback local server
├── .github/workflows/pages.yml   publishes app/ to GitHub Pages
├── start-game.bat            Windows launcher (double-click this)
├── .gitignore                keeps key backups and payloads out of Git
└── README.md                 you are here
```

---

## 3. Requirements

- **Windows 10 or 11** with a modern browser (Microsoft Edge, Chrome, Firefox).
- **One** of the following, already installed, to run the local server:
  - **Python 3** (any recent version) — *preferred*, standard library only, **or**
  - **Node.js 18+** — used automatically if Python is missing.
- **Nothing else.** No `pip`, no `npm install`, no admin rights, no downloads.

If neither Python nor Node is installed, you can still *open* `app/index.html`
from `file://`, but browsers disable the Web Crypto API there. **Play a game →
type a word** still works; encryption and decryption do not.

---

## 4. Run the app

1. Double-click **`start-game.bat`**.
2. A console window opens, picks a free port between **8777 and 8796**, and opens
   your browser at `http://127.0.0.1:<port>/`.
3. **Keep the console window open while you use the app.** Closing it stops the
   server.
4. The menu bar shows a **key chip** ("Built-in key" or "Custom key active"). That
   plus `127.0.0.1` means you are on a secure context, so Web Crypto works.

**Manual fallback (if the `.bat` is blocked by policy):**

```powershell
# from the hangbitch folder
python -m http.server 8777 --bind 127.0.0.1 --directory app   # open http://127.0.0.1:8777/
# or, with Node.js:
node tools/serve.js 8777 app
```

---

## 5. Playing

- **Type a word** — put the secret in *Secret word or phrase*, add an optional
  hint, and press **Start game**. Needs no key and no payload.
- **Paste an encrypted word** — paste the `BHANGMAN1.…` text and press **Unlock &
  start**. It decrypts locally with this app's key.
- Guess with the on-screen **A–Z** buttons **or** your physical keyboard.
  Correct guesses reveal every occurrence; a repeat costs nothing.
- **Spaces, punctuation and digits are shown automatically** and never cost a
  life. Guessing **E** reveals **É** (Unicode NFC folding).
- The illustration follows the **exact seven-life progression**:
  `gallows → head → body → left arm → right arm → left leg+foot → right leg+foot
  → beer mug`. The **beer mug appears only after the seventh wrong guess** and ends
  the round. The figure is drawn as crude hand-drawn strokes on a white canvas you
  can also scribble on.

---

## 6. The Paint chrome

- **Title bar** (Windows-XP blue) with working **minimise / maximise / close**.
- A real **menu bar** — File, Edit, View, Help — every item performs a real action
  and the menus close on select or on a click outside.
- A **tool bar** (pencil, eraser, clear, new game, restart round, hint) and a
  **28-swatch palette**. Picking a colour changes what you draw on the canvas.
- A **status bar**, group boxes with overlapping labels, and Tahoma/Arial fonts.
  No glassmorphism, no rounded cards, no external fonts, CDNs or remote images.

---

## 7. Testing

Run the suite yourself (Node.js required):

```powershell
node tests/hangbitch-tests.js
```

The crypto round-trip needs Web Crypto; on Node 18 add
`--experimental-global-webcrypto`:

```powershell
node --experimental-global-webcrypto tests/hangbitch-tests.js
```

It checks that the app is complete and self-contained (every file it needs is
inside `app/`, with no parent-relative paths), that the seven-life rules, payload
format and built-in key are intact, that the illustration has exactly the seven
switchable parts (beer last), that every element lookup and every menu/tool
action resolves, that the palette really sets the drawing colour, that the theme
is all-local, that the offline cache and `hb.*` storage are its own, and that the
built-in key encrypts and decrypts a payload on its own.

**Manual checks that cannot be automated from Node** (do these in a browser):

- Confirm it looks like classic Microsoft Paint.
- Open each File / Edit / View / Help menu item; confirm it does something and closes.
- Pick a colour, draw on the picture, then clear the doodles.
- Watch the seven illustration stages appear in order, ending with the beer mug.
- Encrypt a word, then paste the payload back through **Play a game**.
- Disconnect from the internet and finish a round.

---

## 8. Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repository, open **Settings → Pages → Build and deployment → Source**
   and choose **GitHub Actions**.
3. The included workflow
   [.github/workflows/pages.yml](.github/workflows/pages.yml) publishes the
   **`app/`** folder. Watch the **Actions** tab until the run is green.
4. Copy the URL GitHub shows you (e.g. `https://<user>.github.io/<repo>/`) and
   share it. Relative paths mean it works from a project sub-path or a custom
   domain.

---

## 9. Security and privacy — the honest version

- The sender encrypts with the **public** key; only the matching **private** key
  decrypts. The ciphertext is **authenticated** (AES-256-GCM): tampered payloads
  are rejected.
- The payload is **self-contained**: no server lookup and no per-message
  passphrase. The only secret needed to read it is the private key.
- The secret word and hint live **in memory for the active round only**; they are
  never logged, and the un-revealed letters are never written into the page.
- The built-in private key is **public**. It is a convenience default — use
  **Key settings → Change key pair** for anything that matters. Your own key is
  remembered in this browser only and never committed.
- Hangbitch makes **no analytics, no telemetry and no network requests** during
  play. The service worker caches only this app's own files.

---

## 10. Quick reference

| I want to… | Do this |
|---|---|
| Play on my own, no keys | Double-click `start-game.bat` → **Play a game** → type a word → **Start game** |
| Play a coworker's submission | **Play a game** → paste the `BHANGMAN1.…` payload → **Unlock & start** |
| Send someone a secret word | **Generate a word** → type it → **Encrypt** → **Copy encrypted payload** |
| Just get started | Nothing — the built-in key already runs both jobs |
| Use my own key | **Key settings → Generate a new key pair** (with a passphrase) |
| Go back to the built-in key | **Key settings → Use built-in key** |
| Move my key to a new PC | **Key settings → Restore from a backup** |
| Give coworkers the tool | Publish this folder to GitHub Pages, share the URL |
| Run the tests | `node tests/hangbitch-tests.js` |
