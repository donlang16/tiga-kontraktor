HERO — IMAGE SEQUENCE
=====================

Hero scroll-cinema memakai image sequence WebP (bukan <video>), agar
scrubbing instan dua arah tanpa decoder video:

  seq/hd/f_0001.webp … f_0603.webp   (1600px, desktop, ±34 MB)
  seq/sd/f_0001.webp … f_0603.webp   ( 800px, mobile,  ±14 MB)

Preloader hanya menunggu 1 dari tiap 6 frame (±5,7 MB desktop / 2,3 MB
mobile); sisanya dimuat di latar belakang dan playback menajam sendiri.

Dihasilkan dari "tiga kontraktor video.mov" (60,3 dtk) dengan:

  ffmpeg -i "tiga kontraktor video.mov" -vf "fps=10,scale=1600:-2" -c:v libwebp -quality 74 seq/hd/f_%04d.webp
  ffmpeg -i "tiga kontraktor video.mov" -vf "fps=10,scale=800:-2"  -c:v libwebp -quality 70 seq/sd/f_%04d.webp

Untuk mengganti video: jalankan ulang kedua perintah di atas dengan
sumber baru, lalu sesuaikan SEQ.count di js/main.js bila jumlah frame
berubah. Frame pertama harus identik dengan frame terakhir agar
infinite loop tak terlihat.
