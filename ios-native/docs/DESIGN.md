# Desain Bisik

Nama kerja: Bisik. Native SwiftUI, UI bahasa Indonesia dan Inggris. Alur utama: tahan, bicara, lepas, tempel di aplikasi lain.

Rujukan: [OpenAI UI Skills](https://github.com/ihlamury/design-skills/tree/main/skills/openai) dan [ChatGPT Voice](https://chatgpt.com/features/voice/). Adaptasi native mengikuti ukuran iPhone/iPad, editor nyata, safe area dan target sentuh 44pt. Orb dibuat baru dengan gradient, TimelineView dan Canvas SwiftUI; tidak mengambil logo, video atau kode internal OpenAI.

Home putih: editor kosong tanpa heading, slogan atau placeholder, tombol copy di kanan bawah field, dan orb mikrofon di bawah. Copy memakai SF Symbol doc.on.doc.fill berukuran 22pt semibold dalam lingkaran gelap 48pt, berubah centang setelah menyalin. Tombol plus di kanan atas berupa icon dalam lingkaran 44pt tanpa label terlihat. Inter Regular/SemiBold disertakan offline, jarak memakai kelipatan 4pt, warna teks gelap dan panel abu sangat terang.

Burger menu kiri atas menampilkan Rekam, tulisan baru, Riwayat, Kamus, Paket & kuota, Langganan dan Pengaturan. Swipe horizontal dari margin kiri 20pt membuka menu yang sama; gesture tidak menutupi editor. Kuota dan free tier hanya muncul pada layar khusus. Membuka menu menyimpan koreksi dan menutup keyboard tanpa menghapus draf.

TextEditor native mempertahankan scroll, menempatkan kursor pada kata yang diketuk dan membuka keyboard. Centang pada toolbar keyboard menutup keyboard dan menyimpan koreksi. Tidak ada tombol keyboard terpisah. Mikrofon disembunyikan selama edit untuk menyediakan ruang keyboard.

State rekam: idle → preparing → recording → processing → idle. Orb adalah satu kontrol dengan awan gradient biru di tengah dan 48 batang waveform radial di sekelilingnya. Batang membaca buffer RMS mikrofon; pola tidak dibuat acak. Awan bergerak dekoratif pada 30fps saat rekam/pemrosesan, berhenti saat idle atau app tidak aktif. Tekan memakai scale 180ms dan respons amplitudo 120ms. Reduce Motion mematikan drift/scale dekoratif, sambil mempertahankan informasi level suara. VoiceOver menyediakan start/stop tanpa menahan. Tidak memakai video atau library JavaScript.

Splash berupa orb dan nama Bisik di tengah, sekitar satu detik saat cold launch, dengan fade 180ms bila Reduce Motion tidak aktif. Penyelesaian splash tidak menunggu request backend. Splash tidak diulang setiap kembali dari background.

Bahasa UI mengikuti sistem (Indonesia atau Inggris sebagai fallback) dan bisa diganti di Pengaturan tanpa keluar aplikasi. Bahasa ucapan, isi draf, history dan kamus tetap terpisah. Localizable.strings dan InfoPlist.strings mencakup UI, accessibility, error, izin mikrofon dan speech. Disclosure penyedia AI tersedia dalam kedua bahasa di konfigurasi developer.

Copy dinonaktifkan selama rekam/pemrosesan/pratinjau belum final. Permission, consent dan autentikasi disiapkan sebelum audio; pengguna menahan kembali setelah dialog pertama selesai. Batas durasi internal tetap melindungi audio/kuota tanpa tulisan pada home. Error muncul dekat tindakan dengan retry bila audio gagal; empty state tanpa seeded history. Paywall bisa ditutup untuk membaca dan menyalin history lama.

Pengujian UI memakai draft yang benar-benar diketik melalui keyboard native. Render animasi XCTest memakai komponen orb produksi dengan fixture level audio dan waktu deterministik; fixture bukan bukti sesi transkripsi sungguhan. Workflow menyimpan screenshot interaksi, render splash dan frame orb untuk inspeksi.
