# Hesap güvenliği devam kaydı — 27 Ekim 2026

PR #1, issue #2 ve PR #3 incelendi. Ana dal ve PR #3 ağacında AGENTS.md bulunmadı. Bu değişiklik PR #3'ün ead27273a547f5bfd21677c85ef79eeda277d17d sürümünü temel alır; mevcut remix çalışmalarını değiştirmez.

## Tamamlananlar
- SMTP ile doğrulama etkinse kayıt artık oturum vermez; doğrulama sonrası giriş gerekir. Önceden açılmış doğrulanmamış oturumlar da reddedilir.
- Şifremi unuttum ve doğrulama e-postasını yeniden gönder kontrolleri topluluk sayfasına bağlandı; bekleyen doğrulama cevabı arayüzde hata vermeden gösterilir.
- Şifre sıfırlama/doğrulama jetonu tüketimi SQLite yazma kilidiyle sıralanır. Aynı sıfırlama jetonuyla iki eşzamanlı isteğin yalnızca biri başarılı olur; eski oturumlar iptal edilir.
- SMTP gönderimi başarısızsa hesap/jeton değişiklikleri geri alınır. Eksik SMTP yapılandırmasında mevcut ve bulunmayan e-posta için aynı 503 yanıtı döner. E-posta bağlantısının satır sonu düzeltildi.

## Doğrulama
- `python -m unittest discover -s tests -v`: 7 test geçti (eşzamanlı sıfırlama, doğrulama zorunluluğu, SMTP hata geri alma dahil).
- `node --test tests/mix-core.test.cjs`: 4 test geçti.
- `node tests/syntax.cjs`, `node --check tests/browser.cjs`, `python -m py_compile server.py`: geçti.
- Ayrı paketleme/build sistemi yok; statik HTML/JS ve Python WSGI uygulaması.
- `node tests/browser.cjs`: yerel Chromium yürütülebilir dosyası yok; tarayıcı kontrolü çalıştırılamadı. Chromium/WebKit senaryolarına yeni hesap ekranı kontrolleri eklendi; CI sonucu ayrıca izlenmeli.

## Sonraki işler ve yayın sınırı
1. Gerçek SMTP/TLS sunucusunda teslimat, yeniden gönderme ve şifre yenileme bağlantısını uçtan uca doğrula. SMTP anahtarları yalnızca ortam değişkenlerinde tutulmalı. Bu çalışmada gerçek e-posta gönderilmedi.
2. Şifre sıfırlama sayfasına ağ hatası/istek sürüyor durumu ve erişilebilir form etiketleri ekle; geçersiz/süresi dolmuş bağlantı deneyimini test et.
3. E-posta teslimatını kuyruk/outbox ile veritabanı işlemlerinden ayır; SMTP kesintilerindeki zamanlama farkları ve hesap keşfi riskini azalt. Şu anda senkron SMTP çağrısı veritabanı yazma işlemini bekletebilir.
4. Doğrulama GET bağlantılarının e-posta güvenlik tarayıcılarınca tüketilmesini önlemek için açık onay POST akışına geçir.
5. Moderasyon, ses çözücüyle dosya doğrulama, veri dışa aktarma, yedek/geri yükleme ve fiziksel iPhone testleri hâlâ gerekli. Issue #2 için güvenilir BPM/beat-grid ve gerçek müzik kalite testi tamamlanmadı.

Canlı dağıtım yapılmadı; PR beta/taslak olarak kalır. SMTP yapılandırılmamış geliştirme modunda önceki doğrudan kayıt/giriş davranışı korunur; bu mod herkese açık üretim için yeterli değildir.

## 28 Ekim — bağlantı tarayıcılarına karşı açık doğrulama onayı

Güncel PR #1, issue #2 ve PR #3 incelendi; `dbd260aa3099307f9bc0ea0efe2a82ff086f05c3` temel alındı. Bu ağaçta ve ana dalda AGENTS.md yok. Bugünkü SMTP/readiness değişiklikleri korundu.

- `/api/verify-email` GET artık yalnızca mobil onay sayfasını sunar; e-posta tarayıcısı bağlantıyı açtığında jeton tüketilmez ve hesap doğrulanmaz.
- Kullanıcının düğmeye basması aynı origin POST isteği gönderir; doğrulama jetonu atomik, tek kullanımlık ve 30 dakika süreli kalır.
- Sayfa ağ hatasında yeniden deneme, işlem sürüyor durumu, erişilebilir canlı sonuç ve giriş/yeni bağlantı yolu sağlar. Jeton URL'den kaldırılır; yanıtların Referrer-Policy değeri no-referrer olarak sıkılaştırıldı.
- 8 Python entegrasyon testi ve 4 Node remix testi geçti. Tekrarlanan GET, eşzamanlı POST, yabancı origin, yanlış amaçlı/süresi geçmiş/geçersiz jetonlar kapsandı. HTML/JS sözdizimi, bağlantı ve Python derleme kontrolleri geçti. Ayrı frontend build sistemi yok.
- Chromium/WebKit mobil senaryolarına kullanıcı onayı, ağ hatası sonrası tekrar deneme, eksik bağlantı ve URL temizliği eklendi. Yerelde Chromium yürütülebilir dosyası bulunmadığı için tarayıcı testleri çalışmadı; CI sonucunu takip et. Fiziksel iPhone, gerçek SMTP teslimatı ve Docker/TLS dağıtımı doğrulanmadı; canlıya dağıtılmadı.

### Sonraki somut işler
1. CI Chromium/WebKit sonucunu doğrula; gerçek iPhone'da e-posta uygulamasından bağlantı açıp onayla/giriş akışını dene.
2. Şifre yenileme sayfasına da ağ hatası, işlem sürüyor durumu ve erişilebilir etiketler ekle (önceki madde 2 hâlâ açık).
3. SMTP outbox/kuyruk, ses dosyasının gerçek çözücüyle kontrolü, moderasyon ve yedek/geri yükleme işleri açık.
4. Issue #2 BPM/beat-grid, pitch-preserving time-stretch ve müzik kalite testleri tamamlanmadı. Bu değişiklik ses motorunu veya mevcut üç öneriyi değiştirmiyor.
5. GET artık doğrulama yapmadığından API kullanan istemciler doğrulama için JSON `{token}` gövdeli POST kullanmalı. Mevcut e-posta bağlantıları yeni onay sayfasıyla çalışır. Sayfa yenilendiğinde jeton bellekte kalmaz; e-postadaki bağlantı yeniden açılmalı.
