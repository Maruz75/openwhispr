# Desain Bisik

Nama kerja: Bisik. UI berbahasa Indonesia, native SwiftUI. Tujuan utama satu alur pendek: tahan, bicara, lepas, tempel di aplikasi lain.

Rujukan: [OpenAI UI Skills](https://github.com/ihlamury/design-skills/tree/main/skills/openai), dipasang ke Codex. Adaptasi native mengikuti instruksi user: ukuran iPhone/iPad dan editor nyata menggantikan contoh viewport web 1920px/input 0px dalam skill. Tidak menyalin logo atau konten OpenAI.

Permukaan utama putih, permukaan tambahan abu sangat terang, teks gelap dengan kontras minimal 4.5:1, satu aksen ungu untuk fokus. Inter Regular/SemiBold disertakan offline. Jarak memakai kelipatan 4pt; kontrol icon memiliki area sentuh minimal 44pt. Editor adalah isi utama, microphone tindakan primer. Tab memisahkan Riwayat/Kamus/Pengaturan tanpa menyembunyikan record di subhalaman.

State record: idle → preparing (izin/kuota) → recording → processing → idle. Waveform menggunakan level mikrofon, bukan animasi acak. Pratinjau belum final diberi status; app tidak menyatakan hasil sudah tersalin sampai teks final/copy berhasil. Permission/cloud consent/auth disiapkan sebelum memulai audio; pengguna perlu menahan lagi setelah dialog pertama selesai.

Gerakan: feedback microphone scale dan copy check opacity, maksimal 180–200ms. Bar waveform skala vertikal tanpa animasi layout. Reduce Motion menghentikan gerakan dekoratif; VoiceOver menyediakan tindakan start/stop tanpa menahan. Tidak memakai video render atau library JavaScript untuk gerakan UI.

Empty state jujur tanpa seeded history. Error muncul dekat tindakan dengan retry bila ada audio gagal. Hapus history/kamus/akun memakai konfirmasi native. Paywall tetap bisa ditutup untuk membaca dan menyalin history yang sudah ada; kehabisan kuota membatasi perekaman baru.
