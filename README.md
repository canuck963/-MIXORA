# MIXORA — music and remix platform (beta)

This change retains the original live DJ page and both manual remix editors, and adds a real, self-hosted community backend. **This is a tested development beta, not a production-ready or deployed service.**

## What works

- `index.html`: existing library, approximate BPM analysis, tempo controls and hybrid transition; added three-band EQ, cue points, whole-track loop, Web Audio gain control for the crossfader, shared compressor and MediaRecorder capture (format depends on browser).
- `Remix.html`: existing waveform selection, timeline reordering, overlays, ducking, cinematic/drop effects and WAV export. Added three deterministic remix suggestions, shared master compression, composite gain envelopes, IndexedDB project save/restore (including sources), and rendered WAV saving into the existing local community database.
- `remix.html`: original basic editor retained at its original URL.
- `local-community.html`: original community demo, retaining `mixora-community-demo` database compatibility. Existing device records remain accessible.
- `community.html` + `server.py`: registration/login/logout, public name/bio profiles, public uploads/playback/link sharing, idempotent likes, comments and owner-only deletion. Reads are public; writes require a session. Twenty-post feed pages, up to 100 recent comments per post.

The three suggestions are **rule-based arrangements**, not AI-generated stems, musical phrase detection, automatic key detection or studio-grade beat matching. They preserve the full A/B selections (including nonzero entry points) and add no synthetic bass effects. Duygusal, Enerjik and Sinematik can be auditioned without changing the timeline or its fade setting, then explicitly applied. Users must still choose and audition musical phrase boundaries; overlapping vocals are not separated. Live playback speed uses the existing browser playback controls. The advanced timeline does not yet offer pitch-preserving time stretch, stem separation or beat-grid editing.

## Run locally

Python 3.12 or newer; no third-party runtime packages required for development:

```sh
python server.py
```

Open `http://localhost:8000`. Use exactly this origin (not the IP alias) for authenticated writes. `MIXORA_ORIGIN` is the allowed browser origin; defaults to `http://localhost:8000`. `MIXORA_DATA` defaults to `./data` and must be writable. The development WSGI server is not intended for production traffic.

GitHub Pages can host the editor and local demo, **but cannot run this Python API**. On static hosting the community page explicitly reports that its backend is unavailable. No cloud credentials or paid services are needed for local testing.

## HTTPS hosting scaffold

The supplied Dockerfile uses Gunicorn; Compose adds Caddy for TLS. On a server whose domain already points to it:

```sh
export MIXORA_HOST=music.example.com
# Configure the real domain before starting; do not use the example domain.
docker compose up --build -d
```

Only the proxy is exposed; the application port stays inside the Docker network. Keep the named `mixora_data` volume. `MIXORA_ORIGIN` is derived from the domain; HTTPS enables Secure cookies and HSTS. No server was provisioned and no DNS, domain, billing, or deployment account was changed by this implementation. Docker/TLS deployment is supplied but has not been exercised here.

## E-posta gönderimi (gerçek kayıtlar için)

`compose.yaml`, SMTP ayarlarını artık uygulama konteynerine aktarır. Gerçek alan adı ve SMTP hesabı sahibi tarafından sağlanmalıdır. Değerleri herkese açık depoya veya ekran görüntülerine yazmayın.

Sunucuda `.env` dosyasına aşağıdaki değişkenleri ekleyin:

```dotenv
MIXORA_HOST=YOUR_OWN_DOMAIN
MIXORA_SMTP_HOST=YOUR_SMTP_HOST
MIXORA_SMTP_PORT=587
MIXORA_SMTP_FROM=YOUR_VERIFIED_SENDER
MIXORA_SMTP_USER=YOUR_SMTP_USERNAME
MIXORA_SMTP_PASSWORD=YOUR_SMTP_SECRET
```

Ardından `docker compose up --build -d` çalıştırın. `MIXORA_SMTP_HOST` ayarlı olduğunda e-posta doğrulaması giriş için zorunlu olur. Bu ortam değişkenleri boş bırakılırsa gerçek e-posta gönderimi çalışmaz; herkese açık kayıt açılmamalıdır.

Gerçek SMTP gönderimi, teslimat, spam klasörü, bağlantı süre sonu ve parola sıfırlama akışları canlı ortamda ayrıca sınanmalıdır. Docker/TLS dağıtımı ve SMTP sağlayıcısı bu depoda otomatik olarak kurulmuş değildir.

## Security and storage boundaries

- Passwords: per-password random salt + scrypt, never plaintext. Sessions: random tokens, hashed in SQLite, HttpOnly/SameSite=Lax cookies, seven-day expiry, revocation on logout; Secure on HTTPS.
- Mutations require an exact Origin match. All SQL values are parameterized; private files and database paths are excluded from the static-file allowlist. User text is rendered via `textContent`.
- Login/write/comment/upload rate limits are stored in SQLite. Behind the included proxy, IP limits are shared by proxy address: production needs a trusted-proxy-aware edge limiter (do not trust arbitrary forwarded headers).
- Upload: 60 MB/file, 300 MB/account, 10 uploads/hour, header-signature validation for MP3/WAV/M4A and an explicit rights acknowledgement. Audio bytes and metadata live together in SQLite so publishing/deletion are transactional. Byte-range responses support seeking. These are plaintext application data: encrypt the server disk/backups operationally.
- Signature checks are **not full decoder validation**. Public launch requires isolated decoder validation/transcoding, moderation/reporting, email verification/password reset, account deletion/export, abuse protection against mass account creation, storage/traffic quotas at the host, dependency review, and load testing. There is no admin moderation interface yet.
- SQLite BLOB storage is suitable for a small pilot, not a high-volume streaming service. Reads/uploads buffer data in memory. Move media to object storage/CDN and the account database to a managed database before scaling.
- Back up using SQLite's backup API (not a live file copy ignoring WAL). For example, with the service data directory mounted locally, `sqlite3.connect(source).backup(sqlite3.connect(destination))`; protect, encrypt and periodically restore-test backups.
- Existing inline scripts require `unsafe-inline` in CSP. New community logic is external and avoids HTML interpolation. A future CSP-hardening pass should externalize all legacy scripts and styles.

## Audio/device limitations

40 MB and seven-minute input limits in the advanced editor; seven-minute WAV export and five-minute local-library render limits. These are safeguards, not guarantees against mobile memory pressure. iOS may suspend playback/recording in the background or when the screen locks. Live capture formats depend on MediaRecorder support; WebM captures cannot yet be uploaded to the community endpoint (export WAV from the editor instead). Source replacement removes only that deck's old timeline clips, avoiding accidental remixes against a different file. IndexedDB is device storage and may be cleared by Safari; keep downloaded backups.

## Verification

```sh
python -m unittest discover -s tests -v
node --test tests/mix-core.test.cjs
node tests/syntax.cjs
# Optional browser integration tests (server must be running):
npm install --no-save playwright@1.62.1
npx playwright install --with-deps chromium webkit
node tests/browser.cjs
```

API tests cover full account/publish/listen/like/comment/delete workflows, owner authorization, foreign-origin rejection, private-file denial, session logout, password hashing, upload validation, limits, malformed input, range requests and cascading deletion. Audio-core tests check three distinct suggestions and timeline math, including very short files. Syntax/link checks cover all pages and scripts.

The browser suite uploads generated tone WAVs, previews all three proposals, exports a non-silent WAV, saves/restores a project, saves to the device library, registers and publishes, likes/comments, checks a 390px layout and exercises the original live deck. It requires both Chromium and WebKit; unavailable browsers fail the test instead of silently passing. Physical iPhone testing and subjective musical-quality review remain required.
