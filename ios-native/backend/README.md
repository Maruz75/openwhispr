# Bisik developer API

FastAPI + SQLite untuk aplikasi SwiftUI Bisik. Server memilih model dan provider, menghitung kuota dari audio yang diukur, memverifikasi langganan Apple, dan mengelola sesi. Tidak ada API key AI atau pilihan model yang dikirim ke iPhone.

Implementasi ini dapat dijalankan dan diuji secara lokal. Transkripsi, masuk Apple, serta pembelian nyata memerlukan konfigurasi developer di bawah; konfigurasi kosong menghasilkan error aman, bukan hasil contoh atau langganan palsu.

## Menjalankan di Windows / macOS / Linux

Gunakan Python 3.12 dan `ffprobe` dari FFmpeg pada PATH. Di PowerShell, dari folder ini:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
# Isi .env, lalu:
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000 --limit-concurrency 4 --no-access-log
.\.venv\Scripts\python.exe -m pytest -q
```

macOS/Linux memakai `.venv/bin/python`. Untuk server produksi, instal `requirements.txt`; file ini mengunci dependensi runtime. `requirements-dev.txt` menambahkan alat tes. Tes memakai provider dan status Apple yang dimock, sedangkan tes JWT memakai tanda tangan RSA/ES256 nyata dan tes durasi menjalankan ffprobe bila tersedia. Tes tidak menghubungi AI maupun melakukan pembelian.

`GET /health` memberikan `status` dan `configured`. Nilai `configured: false` berarti konfigurasi layanan belum lengkap; keberhasilan health check belum membuktikan kredensial valid. Pada `BISIK_ENVIRONMENT=development`, dokumentasi OpenAPI tersedia di `/docs`.

## Konfigurasi developer

Salin `.env.example` menjadi `.env`, yang diabaikan Git. Gunakan secret manager untuk produksi. Bundle ID harus sama dengan Xcode, App Store Connect, dan Sign in with Apple. Product ID bawaan adalah `com.maruz75.bisik.pro.monthly` dan `com.maruz75.bisik.pro.annual`; samakan allowlist server dan konfigurasi aplikasi jika menggantinya.

### Sign in with Apple dan penghapusan akun

1. Aktifkan Sign in with Apple pada App ID. Buat key Sign in with Apple; isi `BISIK_SIGNIN_TEAM_ID`, `BISIK_SIGNIN_KEY_ID`, `BISIK_SIGNIN_PRIVATE_KEY_PATH`, dan `BISIK_BUNDLE_ID`.
2. Buat dua secret independen sekali. Kunci enkripsi: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` → `BISIK_REFRESH_ENCRYPTION_KEY`. Kunci identitas: `python -c "import secrets; print(secrets.token_hex(32))"` → `BISIK_ACCOUNT_ID_KEY` (minimal 32 byte). Backup keduanya dalam secret manager. Rotasi encryption key memerlukan enkripsi ulang refresh token; menggantinya sembarang akan menghalangi pencabutan token Apple sampai pengguna masuk ulang. Mengganti account ID key mengubah UUID akun yang direkonstruksi dan dapat memutus restore pembelian setelah penghapusan.
3. Aplikasi mengirim `identityToken`, raw `nonce`, dan `authorizationCode` dari credential Apple. Nonce dalam JWT harus sama dengan SHA256 raw nonce. Server memvalidasi JWKS Apple, RS256, issuer, audience, expiry, iat, serta nonce. Token login yang sama tidak dapat dipakai ulang; jika respons login hilang, buka Sign in with Apple lagi untuk credential baru.
4. Akun baru wajib menyertakan authorization code. Server menukarnya langsung ke Apple, memastikan identity hasil exchange milik subjek yang sama, lalu menyimpan refresh token terenkripsi. Akun lama dapat masuk tanpa code jika credential pencabutan masih tersedia.
5. `DELETE /v1/account` mencabut credential ke Apple sebelum menghapus akun, semua sesi, usage, dan cache. Kegagalan Apple/config tidak dilaporkan sebagai penghapusan berhasil. Sesi akun diblokir selama proses; lease penghapusan yang ditinggalkan proses crash dipulihkan oleh maintenance. Pencabutan yang telah tercatat tidak diulang saat pengguna mencoba kembali. Penghapusan akun tidak membatalkan penagihan langganan App Store; aplikasi menyediakan pengelolaan langganan Apple.

Token akses adalah nilai acak 256 bit; hanya SHA256-nya disimpan. Masa berlaku bawaan 30 hari; logout mencabut satu sesi dan penghapusan akun mencabut semuanya. Database tidak menyimpan nama/email/Apple sub mentah, hanya hash sub dan UUID akun (`accountToken`). UUID diturunkan dengan HMAC-SHA256 secret identitas + Bundle ID + Apple subject; login Apple yang sama setelah penghapusan penuh merekonstruksi UUID yang sama tanpa menyimpan data pengguna yang telah dihapus. Hal ini memungkinkan restore transaksi dengan appAccountToken lama. Record akun, sesi, replay-login, usage, dan cache semuanya dihapus; secret global developer tetap ada.

### Model speech-to-text dan perapihan AI

`BISIK_STT_BASE_URL`, `BISIK_STT_API_KEY`, dan `BISIK_STT_MODEL` wajib diisi untuk transkripsi. Provider harus kompatibel dengan `POST <base>/audio/transcriptions`, multipart `file`, `model`, `language`, `prompt`, dan respons JSON `{ "text": "..." }`. Base URL lazimnya sudah berakhir `/v1`. Kosakata kamus dikirim sebagai hint dan penggantian berbatas kata diterapkan satu kali setelah hasil final.

Perapihan opsional memakai `<base>/chat/completions`; isi ketiga `BISIK_CLEANUP_*` untuk mengaktifkan. Prompt meminta perapihan tanda baca dan kata pengisi tanpa mengubah bahasa/makna. Model ini juga dipilih developer. API provider yang dipilih harus mendukung parameter tersebut. Produksi hanya menerima URL HTTPS; HTTP localhost hanya untuk development. Kegagalan STT maupun cleanup mengembalikan error, melepaskan reservasi kuota, dan tidak membuat transkrip buatan.

Kebijakan privasi dan consent aplikasi harus menyebut provider yang benar dan menjelaskan pengiriman audio/teks/kosakata. Penghapusan data provider, lokasi pemrosesan, serta retensi di pihak provider mengikuti kontrak provider yang dipilih; penghapusan cache lokal server tidak menghapus otomatis data yang mungkin ditahan provider.

### Langganan StoreKit 2

1. Buat subscription group dan dua produk auto-renewable bulanan/tahunan di App Store Connect. Paket tahunan tetap memperoleh kuota setiap bulan kalender UTC. Gunakan harga dan durasi nyata StoreKit di UI, beserta restore, manage subscription, privacy, serta EULA.
2. Unduh root certificate Apple yang sesuai dari [Apple PKI](https://www.apple.com/certificateauthority/). Isi daftar path DER certificate dipisah koma pada `BISIK_APPLE_ROOT_PATHS`; trust root dipasang developer, bukan diterima dari perangkat.
3. Buat **In-App Purchase key** di App Store Connect Users and Access → Integrations; isi `BISIK_APPLE_KEY_ID`, `BISIK_APPLE_ISSUER_ID`, `BISIK_APPLE_PRIVATE_KEY_PATH`. Key ini terpisah dari key Sign in with Apple.
4. Isi numeric App Apple ID (`BISIK_APPLE_APP_ID`), Bundle ID, dan environment. Produksi mensyaratkan `BISIK_APPLE_ENVIRONMENT=Production`; pengujian sandbox memakai `BISIK_ENVIRONMENT=development` dan `BISIK_APPLE_ENVIRONMENT=Sandbox` dengan database terpisah. Transaksi local StoreKit/Xcode tidak diterima sebagai pembelian server.
5. Aplikasi membeli dengan StoreKit `appAccountToken` UUID dari login server. Client mengirim signed JWS ke `/v1/subscriptions/verify`. Server memakai [library resmi Apple](https://github.com/apple/app-store-server-library-python) `SignedDataVerifier`, online certificate checks, Bundle ID, environment, dan App Apple ID produksi. Kemudian server memanggil App Store Server API dan memverifikasi JWS transaksi terbaru sebelum memberi kuota Pro. Receipt lama sendiri tidak dapat membuka Pro.

Hanya status **active**, jenis auto-renewable, produk allowlist, account token cocok, expiry masa depan, dan transaksi yang tidak dicabut/digantikan yang memperoleh Pro. Grace period dan billing retry tidak memberi Pro dalam implementasi konservatif ini. Receipt yang valid dan cocok tetapi sudah tidak aktif menghasilkan 200 dengan kuota saat ini agar aplikasi dapat menuntaskan transaksi StoreKit; receipt tersebut tidak membuka Pro atau menurunkan langganan aktif lain. Family sharing tanpa appAccountToken yang cocok tidak didukung; jangan aktifkan Family Sharing untuk produk ini. Restore setelah penghapusan akun dapat dilakukan oleh Apple identity yang sama dengan account ID key developer yang tetap; identity berbeda tidak dapat mengklaim pembelian akun tersebut.

Status Apple dicek lagi sebelum quota dan upload bagi akun yang mempunyai subscription ID. Refund, expiry, dan pembaruan terdeteksi saat pemakaian berikutnya. Gangguan Apple mengembalikan 503 dan tidak mempercayai entitlement yang tersimpan. Tidak perlu endpoint notifications untuk correctness alur ini; untuk skala besar, gunakan verified App Store Server Notifications V2 serta antrean refresh agar jumlah panggilan API lebih efisien.

## API dan batas pemakaian

Semua response JSON menggunakan camelCase. Semua error memakai `{ "code": "...", "message": "..." }`; JWT, bearer token, audio, transcript, maupun body error provider tidak direfleksikan dalam error. Endpoint yang memerlukan login memakai `Authorization: Bearer <opaque token>`.

| Method / path | Input / hasil |
| --- | --- |
| `POST /v1/auth/apple` | `{identityToken, nonce, authorizationCode?}` → `{accessToken, accountToken, quota}` |
| `POST /v1/auth/logout` | Cabut sesi ini → `{ok:true}` |
| `DELETE /v1/account` | Revoke credential Apple + hapus data server → `{ok:true}` |
| `GET /v1/quota` | `{usedSeconds, limitSeconds, resetAt, plan}` |
| `POST /v1/transcriptions` | Multipart `file`, UUID `requestID`, JSON string `dictionary`, `language` → `{text, quota}` |
| `POST /v1/subscriptions/verify` | `{signedTransaction}` → `{quota}` |

Kuota default gratis **900 detik (15 menit)** dan Pro **18.000 detik (300 menit)**, dapat diubah hanya melalui environment developer. Reset pada pukul 00:00 tanggal 1 setiap bulan **UTC**, bukan 30 hari sejak login atau tanggal pembelian. Menit tidak rollover; batas ini adalah akses layanan bulanan, bukan saldo kredit yang dijual terpisah.

Audio harus file **m4a atau wav**, maksimal **24 MiB**; request multipart maksimal **25 MiB**, termasuk transfer chunked. Parser multipart ditahan di RAM; size middleware menolak upload sebelum file dapat dipindahkan ke spool disk. Server membatasi durasi audio **600 detik**, sedangkan UI iOS membatasi satu rekaman **300 detik**. WAV PCM16 mono16kHz dari aplikasi sekitar 9,6 MB per 300 detik. `ffprobe` mengukur durasi format/stream audio; server membulatkan ke atas satu detik. Durasi atau kuota yang diklaim client tidak dipakai.

Kamus maksimal **100** hint, `source` dan `replacement` **1–80 karakter** tanpa whitespace di tepi atau control character. Field teks multipart maksimal 64 KiB, satu file, tiga field. Bahasa berupa locale seperti `id-ID` atau `en-US`. Aplikasi dapat menyimpan kamus lebih besar tetapi mengirim subset terbaru yang berbatas size. Durasi, ukuran, model, dan kuota harus diselaraskan saat mengubah limit developer.

SQLite memakai `BEGIN IMMEDIATE` untuk reservasi kuota, sehingga dua request tidak dapat menghabiskan detik yang sama. Kuota `usedSeconds` termasuk reservasi yang berjalan. Keberhasilan memindahkan reservasi menjadi penggunaan; error/cancel melepaskannya. Lease 300 detik memulihkan pekerjaan yang ditinggalkan proses crash; deadline provider keseluruhan 150 detik. Jangan menurunkan lease di bawah deadline.

`requestID` terikat ke akun dan fingerprint audio+bahasa+kamus. Retry identik mengembalikan hasil cache tanpa billing ulang; payload berbeda memberi `409 request_conflict`; request bersamaan memberi `409 request_in_progress`. Cache teks default **5 menit**. Setelah dihapus, tombstone metadata tetap ada sampai penghapusan akun dan memberi `409 result_expired`, sehingga request lama tidak diam-diam ditagih lagi. UI menyimpan hasil lokal untuk history. Upload gagal dapat diulang dengan UUID/file/hint yang sama setelah backend error. `402 quota_exceeded` memicu paywall.

## Retensi dan deployment

Server tidak menyimpan audio secara permanen. File sementara ffprobe dihapus dalam `finally`; Docker compose menyediakan `/tmp` sebagai RAM tmpfs supaya crash tidak meninggalkan audio di volume disk. Pada Windows/local development, file sementara bisa bertahan jika proses/mesin mati tiba-tiba; jangan memakai temp disk biasa untuk deployment sensitif. Teks hanya disimpan sebagai cache TTL (dibersihkan setiap 30 detik dan pada reservasi), bukan history. SQLite menggunakan `secure_delete` dan checkpoint WAL; backup database lama tetap mempunyai retensi tersendiri dan harus dikelola developer.

Docker opsional:

```sh
# Isi .env dan taruh key/certificate pada secrets/ (diabaikan Git).
# Ubah path secret menjadi /run/secrets/<nama>, temp directory menjadi /tmp.
docker compose up --build -d
```

Compose mengikat API ke `127.0.0.1:8000`; pasang reverse proxy HTTPS di depan dan URL API HTTPS yang sama pada Xcode configuration. Konfigurasi contoh memakai satu process, filesystem read-only, non-root user, persistent SQLite volume, dan tmpfs 128 MiB. Batas concurrency Uvicorn empat menjaga buffering audio tetap terkendali; sediakan setidaknya 1 GB RAM dan ukur beban nyata. Terapkan request body limit, timeout, connection limit, rate limit login/upload, serta TLS di reverse proxy. Jangan memercayai `X-Forwarded-For` dari internet tanpa konfigurasi trusted proxy. Nonaktifkan request body/authorization logging pada proxy dan observability.

SQLite cocok untuk satu instance dengan storage lokal. Jangan menaruh database pada filesystem jaringan atau menjalankan beberapa replica dengan volume terpisah: quota akan terpisah. Skala horizontal memerlukan satu database transaksional bersama dan mekanisme reservasi yang setara. Backup encryption key dan ledger usage secara aman; menjalankan ulang dengan database kosong akan mereset akun/kuota. Health endpoint saja tidak membuktikan konfigurasi Apple/AI; uji Sign in with Apple, penghapusan akun, transkripsi, transaksi sandbox, restore, refund, dan jaringan lambat di perangkat sebelum rilis.

Dokumentasi sumber: [Apple token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens), [Apple token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens), [Apple App Store Server Library](https://github.com/apple/app-store-server-library-python), [PyJWT](https://pyjwt.readthedocs.io/en/stable/usage.html), [FFprobe](https://ffmpeg.org/ffprobe.html), [FastAPI upload files](https://fastapi.tiangolo.com/tutorial/request-files/).
