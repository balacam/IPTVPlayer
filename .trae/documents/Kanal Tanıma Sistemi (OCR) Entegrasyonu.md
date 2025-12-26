# Kanal Tanıma Özelliği Geliştirme Planı

Bu plan, video akışından anlık görüntü alarak ekrandaki metinleri (kanal isimleri vb.) tanımlamayı amaçlar.

## 1. Bağımlılıkların Kurulumu
- `tesseract.js` kütüphanesi projeye eklenecek. Bu kütüphane resim üzerindeki yazıları okumak (OCR) için kullanılır.

## 2. Backend (Electron) Geliştirmesi (`electron/main.cjs`)
- **`capture-frame` Fonksiyonu:** FFmpeg kullanarak mevcut video akışından tek bir karelik resim (.png/.jpg) kaydeden bir fonksiyon yazılacak.
- **OCR İşlemi:** Yakalanan bu resmi `tesseract.js` ile işleyip içindeki metinleri çıkaran bir IPC (Inter-Process Communication) servisi oluşturulacak.
- **İletişim:** Bu servis, bulduğu metni (örn: "TRT1", "CANLI", vb.) React arayüzüne geri gönderecek.

## 3. Frontend (React) Geliştirmesi
- **Player Arayüzü:** Video oynatıcının olduğu ekrana (muhtemelen `Player.jsx` veya bir test butonu olarak) "Kanalı Tanı / Nedir bu?" butonu eklenecek.
- **Sonuç Gösterimi:** Backend'den gelen metin cevabı ekranda kullanıcıya gösterilecek.

## Kısıtlamalar
- Bu yöntem **metin tabanlı** logoları (örn: "TRT1", "CNN", "FOX") tanımakta başarılıdır.
- Sadece şekilden oluşan (yazısız) logoları tanımayabilir.
