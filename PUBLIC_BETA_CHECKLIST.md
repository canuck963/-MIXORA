# MIXORA Public Beta — yayın öncesi kontrol listesi

Durum: **Henüz herkese açık yayına hazır değil.** Bu liste, mevcut beta kodunun README.md sınırlarını esas alır; tamamlanan her madde gerçek test/kanıt bağlantısıyla işaretlenmelidir.

## P0 — Genel kullanıcı kabulünden önce zorunlu
- [ ] Gerçek HTTPS alan adı ve sunucu üzerinde Docker/Compose + Caddy dağıtımını doğrula; `MIXORA_ORIGIN` doğru ve çerezler Secure.
- [ ] E-posta adresi doğrulama, güvenli şifre sıfırlama ve kullanıcı hesap silme/veri dışa aktarma akışlarını uygula ve test et.
- [ ] Kullanıcı içeriği için şikâyet, moderasyon, kaldırma ve telif ihlali başvuru akışlarını uygula; yönetici yetkilerini test et.
- [ ] Yüklenen sesleri izole ortamda gerçekten çözümle/doğrula; yalnızca dosya imzasına güvenme. Boyut, süre ve kaynak tüketimi sınırları uygula.
- [ ] Ters vekil arkasında gerçek istemciye göre güvenilir hız sınırı ve sahte hesap açma koruması uygula; sahte `X-Forwarded-For` başlıklarına güvenme.
- [ ] Veritabanı ve medya için şifreli yedek, geri yükleme denemesi ve hata izleme kur.
- [ ] Gizlilik politikası, kullanım koşulları, yükleme hakları onayı ve veri saklama/silme açıklamalarını yayınla.
- [ ] Fiziksel iPhone/Safari üzerinde üyelik, iki sesle miks, üç öneri, WAV çıktısı, paylaşım, yorum, oturum ve kilit ekranı davranışını test et.
- [ ] Bağımlılık/güvenlik incelemesi, çok kullanıcılı yük ve kota testlerini tamamla.
- [ ] Önce küçük davetli pilotu, ardından herkese açık beta için açık yayın onayı al.

## P1 — Pilot sonrası ölçeklenme
- [ ] Büyük ses dosyalarını SQLite BLOB yerine nesne depolamaya; medya dağıtımını CDN'e taşı.
- [ ] Sunucu trafiği, depolama maliyeti ve abuse eşikleri için uyarılar kur.
- [ ] iOS arka plan sesini güvenilir biçimde desteklemek için yerel uygulama yaklaşımını değerlendir.
- [ ] BPM/beat-grid, ton analizi, pitch-preserving time stretch ve vokal ayrımı için ayrı ürün aşamaları oluştur.

## Doğrulama kayıtları
Her madde için: tarih, commit/PR, test komutu, test sonucu, üretim ortamı ve varsa engel kaydedilmeli.

## Güvenli çalışma kuralları
- Ana dala zorla yazma; mevcut PR #3'ü inceleme ve test bitmeden birleştirme.
- Kullanıcı verisi veya erişim anahtarlarını repoya yazma.
- Ücretli sunucu/domain satın alma veya canlıya açma işlemi için kullanıcıdan açık onay al.
- Otomatik testlerin yeşil olması fiziksel iPhone testinin veya prod güvenliğinin yerine geçmez.
