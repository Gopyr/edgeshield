# edgeshield

**edgeshield** adalah reverse proxy shield lokal yang dirancang untuk melindungi layanan berskala kecil dari serangan Layer 7 dan overload. Shield ini duduk di depan aplikasi Anda, memfilter lalu lintas sebelum mencapai origin, dengan fitur-fitur inti seperti rate limiting per-IP, escalasi auto-ban, pembatasan konkurensi, slowloris timeout, serta engine aturan sederhana. Zero dependensi, berjalan di Node 18+.

Shield ini adalah setengah dari portofolio pertahanan: GP-1 mengukur perilaku layanan di bawah beban, sementara edgeshield menjaga layanan tetap hidup saat beban bersifat hostile.

## Melindungi dari

| Jenis Serangan | Pertahanan | Status Code |
|---|---|---|
| Botnet flood dari banyak IP | Token bucket per-IP (burst + refill) | 429 |
| Penyalahgunaan berulang dari satu IP | Auto-ban dengan tier eskalasi (1m → 5m → 15m) | 429 |
| Connection flood / Slowloris | `headersTimeout` + `requestTimeout` pada socket proxy | 408/close |
| Path/product abuse (scraping, admin probing) | Engine aturan: blokir berdasarkan path, method, user-agent, IP, CIDR | 403 |
| Oversized bodies / URL patologis | `maxBodyBytes`, `maxPathLen` | 413 / 414 |
| Beban paralel berlebihan pada origin | Concurrency gauge (batas in-flight) | 503 |
| Probing langsung ke origin | Shield adalah satu-satunya entri; origin bind loopback | n/a |

## Instalasi

```bash
npm install -g .
# atau jalankan tanpa instalasi global
node src/cli.mjs --config config.example.json
```

## Penggunaan

```bash
edgeshield # Jalankan dengan default: target 127.0.0.1:3000, listen 0.0.0.0:8080
edgeshield --config config.json
edgeshield --target 127.0.0.1:3000 --port 8080    # default minimal
edgeshield --block-ip 1.2.3.4 --config config.json # blokir manual sementara
```

Jalankan layanan target di `127.0.0.1:3000`, arahkan shield ke sana, dan rutekan lalu lintas melalui port shield. Origin tetap terikat pada loopback sehingga probing langsung gagal di lapisan jaringan.

## Dashboard Live

Saat berjalan, buka `http://localhost:8080/__shield` untuk dashboard live bertema gelap yang modern (meminta data setiap 2 detik, tanpa aset eksternal): menampilkan konter lalu lintas diizinkan/diblokir, ban aktif, puncak konkurensi, byte yang diteruskan, dan tabel keputusan terbaru yang menunjukkan alasan pasti setiap permintaan diblokir.

![edgeshield Dashboard Live](screenshots/dashboard-live.png)

## Konfigurasi

Lihat [`config.example.json`](config.example.json) untuk contoh konfigurasi detail. Aturan mendukung `ip`, `cidr`, `path` (exact atau sufiks `*`), `method`, `userAgent` (regex), dan `query` (key atau key=value). Aturan yang cocok pertama akan dieksekusi.

## Cara Kerja

1. `Shield.evaluate()` berjalan berurutan: cek ban → aturan → panjang path → ukuran body → token bucket per-IP → window global → concurrency gauge.
2. Pelanggaran rate-limit memicu `BanManager.strike(ip)`: pelanggaran berturut-turut dalam `forgetMs` meningkatkan durasi ban melalui tingkatan.
3. Permintaan yang diizinkan diproksi ke target dengan `http.request`; error upstream mengembalikan 502.
4. `/__shield` dan `/__shield/stats` dilayani oleh shield itu sendiri dan tidak pernah diproksi.

## Filosofi Desain (Mengapa Memiliki Batasan Ini)

edgeshield dirancang untuk kesederhanaan dan kinerja tinggi pada layanan tunggal. Batasan-batasan ini adalah pilihan desain yang disengaja untuk menjaga overhead minimal dan fokus pada kasus penggunaan spesifik:

-   **Skala Lokal & Efisien**: Didesain sebagai proses tunggal dengan state hanya di memori. Ini memastikan latensi rendah dan footprint sumber daya yang kecil, ideal untuk deployment di VPS atau di samping aplikasi backend kecil.
-   **Tanpa Abstraksi Berlebihan**: Tidak ada terminasi TLS, HTTP/2, atau proxying WebSocket. Ini menjaga codebase tetap ramping, aman, dan mudah diaudit, menghindari kompleksitas yang tidak diperlukan untuk kasus penggunaan targetnya.
-   **Kejelasan Konfigurasi**: `trustProxy` mempercayai header `X-Forwarded-For` secara langsung, memberikan kontrol eksplisit kepada pengguna mengenai asumsi keamanan di lingkungan proxy.
-   **Proteksi Fokus**: Ia melakukan throttling dan blocking berdasarkan _bentuk_ lalu lintas (rate, ukuran, pola path), bukan inspeksi konten payload mendalam (ini adalah fungsi WAF, bukan shield ringan).

## Pengembangan

```bash
npm test        # unit: limiters, rules
node test/integration.mjs   # end-to-end: jalankan shield, serang, verifikasi
```

## Lisensi

[MIT License](LICENSE)
