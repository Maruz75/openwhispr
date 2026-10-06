# Penyiapan rilis

Source bukan bukti app sudah siap submit. Berikut konfigurasi eksternal yang harus developer isi dan uji sebelum distribusi.

## Identitas, backend dan model

- Bundle ID dan Team di Xcode sama dengan Sign in with Apple audience dan App Store verifier pada server.
- URL API HTTPS aktif, domain legal aktif, disclosure provider akurat sesuai STT/cleanup yang dipakai. Perubahan vendor memerlukan pembaruan disclosure/consent, bukan hanya menyembunyikan model dari UI.
- Kunci AI hanya di environment server. App mengirim audio, teks dan entri kamus relevan setelah persetujuan. Tidak menaruh provider key pada Info.plist atau xcconfig.
- Server memerlukan ffprobe, penyimpanan SQLite yang persisten, clock UTC benar, backup sesuai kebijakan, rate limiting dan TLS dari ingress. Untuk banyak instance gunakan storage/database yang koordinasinya sama; jangan memasang beberapa server dengan DB terpisah.
- Sesuaikan retention idempotency, vendor data retention dan logging tanpa audio/teks/token. Privacy policy harus menjelaskan provider dan retention nyata, tidak menjanjikan zero retention tanpa perjanjian provider.
- Apple OAuth credentials serta encrypted refresh-token storage diperlukan agar penghapusan akun juga mencabut Sign in with Apple. Hapus akun tidak otomatis membatalkan langganan App Store; UI harus menjelaskan cara manage/cancel dahulu.

## App Store subscription

- Buat dua auto-renewable subscriptions pada satu group; default ID `com.maruz75.bisik.pro.monthly` / `.annual` hanya contoh identitas milik project.
- Produk memiliki nama, periode, harga, localization dan metadata yang lengkap di App Store Connect.
- Samakan semua ID produk/bundle/team pada app, server, StoreKit config. Root certificate Apple untuk verifier diambil dari Apple PKI, disimpan di server, bukan certificate arbitrer dari JWS.
- Environment Sandbox untuk TestFlight/sandbox, Production untuk rilis. `appAppleId` diperlukan saat production. Server API private key, key ID, issuer ID dan trusted roots harus diisi untuk pemeriksaan subscription terkini.
- Verifikasi purchase, pending, cancel, restore, expiry, refund/revoke dan login ke akun Apple app yang berbeda. Entitlement tidak boleh diberikan jika token akun mismatch/verifier/API Apple gagal. Transaction baru di-finish setelah sync server berhasil.
- Kuota gratis dan Pro reset pada awal bulan kalender UTC. Paket tahunan menggunakan batas bulanan yang sama. Harga pada file `.storekit` adalah contoh test; harga pembelian pengguna dibaca dari StoreKit.
- Privacy policy dan Terms/EULA dapat dibuka dari paywall; restore dan manage subscription tersedia. Jelaskan bahwa renewal otomatis hingga dibatalkan lewat App Store.

## App Review dan privacy

Review menggunakan [safaiyeh/app-store-review-skill](https://github.com/safaiyeh/app-store-review-skill), khususnya aturan business/privacy, dan [Apple Review Guidelines](https://developer.apple.com/app-store/review/guidelines/). Pemakaian skill tidak menjamin approval Apple.

- Persetujuan pemrosesan cloud menyebut provider penerima data sebelum upload. Izin mikrofon dan speech memakai prompt sistem dengan purpose string spesifik. Preview Speech hanya dipakai bila dapat berjalan di perangkat.
- Tidak ada tracking/ad SDK; app tidak membaca clipboard. Privacy manifest mencantumkan audio, konten, user ID dan transaksi yang terkait akun. Audit manifest terhadap implementasi terakhir dan App Privacy di Connect.
- History/kamus tersimpan lokal dengan file protection; audio hanya sementara untuk rekam/retry. Pengguna bisa menonaktifkan penyimpanan, menghapus data dan mencabut persetujuan.
- Penghapusan akun ada dalam app. Backend gagal dengan error bila pencabutan Apple belum terkonfigurasi; selesaikan konfigurasi ini sebelum rilis.
- Siapkan URL support, privacy, terms/EULA dan metadata produk asli. Brand/icon baru dan atribusi MIT/OFL disertakan. Jangan submit harga/contoh/domain kosong dari project awal.
- App membayar layanan cloud tambahan; jangan menggambarkan subscription seolah membayar Apple Speech bawaan.

## Acceptance yang membutuhkan perangkat/layanan nyata

| Skenario | Hasil yang diperiksa |
| --- | --- |
| Hold singkat sebelum izin/network selesai | Tidak muncul perekaman setelah jari dilepas |
| Hold normal + release | Durasi/audio nyata, hasil final history, clipboard sesuai setting |
| VoiceOver start/stop | Dapat merekam tanpa gesture tahan |
| Telepon/interruption/background | Audio dihentikan dan file tidak terunggah tanpa tindakan |
| Bahasa tanpa preview lokal | Waveform tetap ada, hasil final setelah release |
| Network/provider gagal | Tidak mengarang teks, kuota reserve dikompensasi, retry idempotent |
| Edit satu kata vs rewrite | Kata yang cocok dipelajari; rewrite/insert/delete tidak menjadi mapping salah |
| Kuota habis + concurrency | Server menolak overspend; app membuka paywall |
| Purchase pending/cancel | Tidak memberi Pro sebelum verifikasi sukses |
| Restore/refund/expire | Entitlement sesuai status Apple terkini |
| Delete account | Apple credential direvoke, sesi dan data server/local dihapus |
| Small iPhone/iPad + largest text | Editor, tab, paywall bisa digunakan tanpa clipping |

Build simulator/XCTest mengecek kompilasi dan invariant core; tidak dapat menggantikan pengujian microphone hardware, signing Apple, sandbox subscription dan production HTTPS.
