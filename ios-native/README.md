# Bisik — dictation native untuk iOS

Project SwiftUI baru di dalam fork OpenWhispr. Buka **Bisik.xcodeproj** di Mac dengan Xcode 16 atau lebih baru. Minimum iOS 17; mendukung iPhone dan iPad. Tidak memakai React/Expo untuk app ini.

## Yang dibuat

- Home hanya berisi editor transkripsi, tombol copy, waveform dan mikrofon di bawah, tanpa slogan atau kartu kuota. Ketuk kata di editor untuk menempatkan kursor dan membuka keyboard; tombol centang di atas keyboard mengakhiri edit. Tahan mikrofon untuk merekam, lepas untuk memproses. Waveform berasal dari level audio sungguhan.
- Burger menu di kiri atas membuka Rekam, Riwayat, Kamus, Langganan, Paket & kuota, Pengaturan dan tulisan baru. Informasi Free/Pro dan kuota bulanan berada pada layar Paket & kuota.
- Pratinjau transkripsi langsung dengan Apple Speech **di perangkat** jika bahasa/perangkat mendukung. Hasil final melalui backend milik developer. Bila preview lokal tidak tersedia, rekaman tetap diproses saat tombol dilepas.
- Hasil final otomatis disalin ke clipboard (bisa dimatikan), tombol copy berubah centang; clipboard tidak dibaca. Pengguna tinggal menempel di aplikasi lain.
- History lokal yang bisa dicari, dibuka kembali, diedit, disalin dan dihapus. Audio sementara dihapus sesudah sukses/batal; kegagalan upload bisa dicoba lagi selama app aktif.
- Kamus manual dan pembelajaran koreksi kata dari editor. Pembelajaran ini berupa memori kosakata, bukan pelatihan ulang model. Perubahan kalimat besar tidak dijadikan kamus. Kosakata dipakai sebagai konteks untuk STT dan pemetaan ejaan yang konservatif.
- Pengaturan yang relevan: salin otomatis, belajar koreksi, haptics, simpan history dan bahasa. Tidak ada menu pemilihan AI/STT, API key atau endpoint untuk pengguna.
- Persetujuan pemrosesan cloud sebelum pengiriman audio/teks/kamus, Sign in with Apple untuk identitas kuota, token dalam Keychain, logout dan penghapusan akun.
- Paywall bulanan/tahunan dengan StoreKit 2, harga lokal dari App Store, restore, manage subscription, privacy dan terms. Tidak ada pembayaran eksternal.
- Backend FastAPI: pilihan model lewat environment developer, kuota bulanan SQLite yang atomik, durasi terukur ffprobe, idempotency, verifikasi Apple dan pencabutan kredensial akun.
- Desain putih minimal, Inter berlisensi OFL, SF Symbols, safe area, Dynamic Type, VoiceOver, feedback scale/opacity singkat dan Reduce Motion.

Default produk awal: **15 menit gratis** / **300 menit Pro** setiap bulan kalender UTC. Paket tahunan juga mendapat 300 menit setiap bulan; menit tidak diakumulasi. Angka ini keputusan awal yang bisa developer ubah bersama pada konfigurasi app dan server.

## Menjalankan app

1. Pindahkan/clone fork ke Mac. Buka `ios-native/Bisik.xcodeproj`.
2. Pilih target **Bisik → Signing & Capabilities**, ganti Bundle ID dan Development Team dengan milik Anda. Aktifkan Sign in with Apple pada App ID. Perbarui audience/bundle ID yang sama di backend.
3. Deploy backend HTTPS mengikuti `backend/README.md`. Kunci provider dan Apple hanya berada di server.
4. Isi `Config/Developer.xcconfig`: URL API, privacy, terms dan nama provider yang menerima data. Format URL xcconfig: `https:/$()/api.domain-anda.com` (karena `//` memulai komentar).
5. Samakan ID produk di Info.plist, StoreKit config dan backend dengan App Store Connect Anda. Atur plan bulanan dan tahunan dalam satu subscription group; harga nyata ditentukan di App Store Connect.
6. Pilih scheme **Bisik**, simulator atau iPhone, lalu Run. Konfigurasi belum lengkap ditampilkan jelas; app tidak mengarang hasil transkripsi atau memberi kuota berbayar palsu.

Untuk test pembelian UI di simulator ada `Bisik/Resources/Bisik.storekit`, dengan harga **contoh lokal saja**. Server sengaja tidak menerima transaksi bertanda tangan Xcode sebagai bukti langganan produksi. Pengujian seluruh alur entitlement harus memakai App Store Sandbox/TestFlight dan verifier Sandbox. Jangan aktifkan config StoreKit lokal untuk archive produksi.

## Menjalankan backend

```powershell
cd D:\OpenWhispr-iOS\ios-native\backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
# Isi .env dengan konfigurasi sendiri, lalu ikuti backend/README.md.
.\.venv\Scripts\python -m pytest -q
```

App hanya menggunakan HTTPS. Windows dapat mengembangkan/menguji backend dan mengedit source; build/penandatanganan iOS memerlukan Xcode di Mac. Docker backend menyertakan ffmpeg/ffprobe.

## Struktur

| Lokasi | Fungsi |
| --- | --- |
| Bisik/Views | Recorder, history, kamus, settings, consent, paywall |
| Bisik/Core | Model, konfigurasi developer, pembelajaran kata, state hold |
| Bisik/Services | Audio, API, Keychain, persistence, StoreKit, AppModel |
| Bisik/Resources | Info.plist, privacy manifest, font, icon, StoreKit config |
| BisikTests | Invariant koreksi kata, kuota, state hold dan data lokal |
| BisikUITests | Navigasi menu, posisi edit, scroll dan penutupan keyboard |
| backend | API dan test server |
| scripts/generate_project.py | Generator project tanpa dependency untuk Windows/Mac |
| docs | Catatan desain dan penyiapan rilis |

Jika menambah file Swift, jalankan `python ios-native/scripts/generate_project.py` dari root repo agar project Xcode memasukkannya. Generator ini deterministik. Icon sudah disimpan; Pillow hanya dibutuhkan jika ingin menjalankan ulang `scripts/create_assets.py`.

## Validasi dan batas rilis

Workflow `.github/workflows/native-ios.yml` menjalankan backend tests serta build/XCTest dan pengujian interaksi UI di simulator macOS, lalu menyimpan screenshot UI asli. Lihat hasil workflow, bukan keberadaan source saja, untuk memastikan status build terbaru.

Sebelum rilis, wajib isi konfigurasi milik Anda dan lakukan acceptance di perangkat: rekam cepat, tahan/lipat jari, mikrofon ditolak, pindah app/interupsi telepon, offline/retry, clipboard, edit belajar kamus, kuota habis/reset, purchase pending/cancel/refund/expire/restore, penghapusan akun, Dynamic Type dan VoiceOver. Dokumen `docs/RELEASE.md` merinci kebutuhan konkret. Project ini tidak otomatis menerbitkan app ke App Store atau melakukan deployment server.

## Dasar OpenWhispr dan lisensi

Fork: https://github.com/Maruz75/openwhispr — upstream https://github.com/OpenWhispr/openwhispr. Root desktop dan folder Expo upstream tetap tersedia sebagai referensi. App native ini berfokus pada dictation, clipboard, history, kamus dan monetisasi yang diminta; meeting, agents, team spaces dan keyboard extension bukan bagian cakupan app sederhana ini.

Pembelajaran koreksi mengadaptasi ide lexical alignment dari `src/utils/correctionLearner.js` dan `openwhispr-mobile/src/lib/correctionLearner.ts`. Copyright/lisensi MIT OpenWhispr di root tetap berlaku. Font Inter menggunakan OFL (`Bisik/Resources/Inter-LICENSE.txt`). Brand Bisik dan icon dibuat baru agar tidak menyiratkan produk resmi OpenWhispr.
