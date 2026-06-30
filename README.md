# RSI Scanner Cloud

Bulutta calisan RSI Scanner - PC kapali olsa da sinyal gonderir!

## Nasil Yuklenir (Render.com - Ucretsiz)

### Adim 1: GitHub'a Yukle
1. https://github.com/new adresine git
2. Repository adi: `rsi-scanner` yaz
3. `Create repository` tikla
4. Bu dosyalari yukle (index.js, package.json, README.md)

### Adim 2: Render.com'a Kaydol
1. https://render.com/ adresine git
2. `Get Started for Free` tikla
3. GitHub hesabinla giris yap

### Adim 3: Service Olustur
1. Dashboard'da `New +` > `Background Worker` sec
2. GitHub repository'ni sec
3. Ayarlar:
   - Name: `rsi-scanner`
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. `Create Background Worker` tikla

### Adim 4: Tamamlandi!
- Scanner otomatik baslar
- Telegram'dan komut gonderebilirsin
- PC kapali olsa da calisir

## Telegram Komutlari
- `/start` - Baslat
- `/dur` - Durdur
- `/devam` - Devam et
- `/scan` - Hemen tara
- `/durum` - Durum bilgisi
