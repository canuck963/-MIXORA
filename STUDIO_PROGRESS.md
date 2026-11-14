# Remix Studio devam kaydı — 30 Ekim 2026

Temel: `codex/mixora-platform-beta`, `9c693a7747bc7d1135a0fcac10686782e4c345c6`.
PR #1, issue #2, açık PR #3/#4/#5 ve PR #1/#3 tartışmaları incelendi. Temel ağacın tüm dosyalarında AGENTS.md yok. PR #4 hesap kurtarma, PR #5 mobil tasarım çalışmaları ayrı tutuldu; ana dala veya canlı servise yazılmadı.

## Tamamlanan davranış
- Kaydet düğmesine basıldığı anda iki kaynak dosyası, çizelge, geçiş süresi, ad ve A/B seçili aralıkları birlikte yakalanır. Dosyalar okunurken yapılan değişiklikler eski/yeni kaynakları aynı kayıtta karıştırmaz.
- Proje açılırken kaynak seçimi veya çizelge/ad/aralık/geçiş değişirse işlem anlaşılır mesajla iptal olur; güncel çalışma korunur. Daha önce başlamış dosya çözümlemeleri açılan projenin üzerine yazamaz.
- İki ses de çözülüp doğrulanmadan çalışma değişmez. Kaynaklara mevcut 40 MB/7 dakika sınırı uygulanır. Eski File tabanlı kayıtlar ve yeni ArrayBuffer kayıtları desteklenir. Yeni kayıtlar seçili aralıkları da geri getirir.
- Aynı işlem ikinci kez başlatılmaz; yerel WAV kaydının adı render başlangıcındaki adla eşleşir.
- CI tüm Node test dosyalarını çalıştırır; stüdyo testleri sunucu testlerinden önce raporlanır.

## Doğrulama
- `node --test tests/*.test.cjs`: **13/13 geçti** (9 stüdyo yarış durumu/geri yükleme testi, 4 mevcut remix testi).
- `node tests/syntax.cjs`, `node --check tests/browser.cjs`, `python -m py_compile server.py`, `git diff --check`: geçti. Ayrı frontend build sistemi yok.
- `python -m unittest discover -s tests -v`: **6/8 geçti**. Aynı iki hata değiştirilmemiş temel sunucuyla da tekrarlandı; stüdyo değişikliklerinden kaynaklanmıyor:
  1. `test_email_delivery_failure_rolls_back_and_missing_config_is_uniform`: test yalnızca SMTP host ayarlıyor; mevcut kod dört SMTP alanını gerektiriyor, bu nedenle 503 yerine geliştirme modu 200 dönüyor. PR #4 bu test kurulumunu düzeltme işini zaten içeriyor; tekrar uygulanmadı.
  2. `test_verification_rejects_invalid_expired_and_wrong_purpose_tokens`: `no-referrer` beklenirken temel sürüm `strict-origin-when-cross-origin` gönderiyor. Güncel sunucu başlıklarında doğrulama/şifre sıfırlama sayfalarına özel gizlilik kuralı yeniden uygulanmalı ve test edilmeli.
- `node tests/browser.cjs`: Chromium yürütülebilir dosyası kurulu değil; çalıştırılamadı. Mevcut Chromium/WebKit senaryosuna geri yüklemede seçili aralıkların korunması kontrolü eklendi. Node testleri gerçek IndexedDB, Safari veya ses çözücüsü yerine kontrollü taklitler kullanır; fiziksel iPhone doğrulamasının yerine geçmez.

## Sonraki somut işler
1. PR #4 test yapılandırmasını beta dalına kontrollü şekilde entegre et; yukarıdaki Referrer-Policy gerilemesini düzelt. Sunucu testleri yeşil olmadan genel yayın hazır kabul edilmemeli.
2. CI ve fiziksel iPhone Safari'de iki farklı gerçek sesle kayıt/açma, işlem sırasında dosya değiştirme, seçili aralıklar, IndexedDB kota hatası ve eski kayıt uyumluluğunu doğrula.
3. Issue #2: çevrimdışı BPM/vuruş güven puanı, beat-grid, ritme uygun kesitler ve pitch-preserving time-stretch hâlâ yok. Mevcut üç öneri kurallıdır; bu PR bu müzik analizlerini gerçekleştirdiğini iddia etmez.
4. Gerçek e-posta teslimatı, lisanslı katalog/remix izinleri, moderasyon, ses çözücüyle sunucu doğrulaması, yedek geri yükleme ve yük testleri ayrı açık işlerdir. Yeni ücretli hizmet açılmadı.

Bu PR kod incelemesine hazırdır; canlı dağıtım ve genel üretim hazırlığı iddiası içermez.

 
## 13 Kasım 2026 — Kesit kenarlarını gözlenen vuruşa hizalama
- Her iki stüdyo sayfasında A ve B seçimi için ayrı, kullanıcı kontrollü **Vuruşa hizala** düğmesi eklendi. Otomatik olarak kesit veya çizelge değiştirmez; yalnızca yakın ve güvenilir vuruş bulunan kenarı günceller. Kullanıcı sonucu kontrol edip çizelgeye ekler.
- Yeni `snapRangeToBeats` yardımcı işlevi BPM analizinin gözlenen düzenli beat konumlarını kullanır. Varsayılan tolerans çeyrek vuruştur (0,08–0,30 sn sınırları); iki kenar da yakın değilse, aralık geçersizse veya hizalama 0,15 sn'den kısa kalıyorsa `null` döner. Bir kenar hizalanırsa diğer kenar aynen korunur.
- 4 regresyon testi: iki kenar/tek kenar hizalama, tolerans dışı ve sessiz içerik, geçersiz aralıklar, iki HTML sayfasındaki gerçek düğme bağları ve VM UI davranışı. Tam Node/Python ve browser CI sonucu commit sonrası kontrol edilmeli; fiziksel iPhone Safari doğrulaması hâlâ gerekli.
- Tempo tahmini algoritmik ve yerel kalır; bu değişiklik pitch-preserving time-stretch veya otomatik BPM uygulaması değildir. PR #1 ses motoru ve issue #2'nin kalan müzik kalite hedefleri ayrı.

## 14 Kasım 2026 — DJ deck vuruş başlatma yarışını giderme

- Canlı DJ Studio'daki **B'yi sonraki vuruşta başlat** işlemi artık `assets/beat-align.js` içindeki tek kullanımlı/cancellable scheduler üzerinden yürür. Önceki düz `setTimeout` bekleyişi durdurma veya parça değiştirme sonrasında B'yi gecikmeli başlatabiliyordu.
- A duraklatılır/sona erer, A veya B kaynak dosyası değişir, kullanıcı manuel olarak iki deck'i başlatır, sayfa kapanır ya da scheduler iptal edilirse bekleyen B başlatması temizlenir. Zamanlayıcı çalıştığında kaynak URL'leri tekrar doğrular; Safari `play()` reddini yakalayıp kullanıcıya tekrar dokunma mesajı verir.
- A'nın oynatma hızı değişirse bekleme yeniden hesaplanır; wall-clock gecikmesi `playbackRate` ile ölçeklenir. Tam grid noktasında 0 ms yarışına girmemek için bir sonraki tam beat beklenir.
- Grid hâlâ parça zamanının 0 saniyesine göre varsayılır; gerçek downbeat/ilk vuruş fazı algılanmıyor. Bu nedenle kesin beat-sync veya pitch-preserving time-stretch değildir; arayüz bu sınırı açıkça bildirir.
- Yeni `tests/beat-align.test.cjs`: **7/7 geçti** (rate-aware delay, on-grid davranışı, invalid BPM/rate, cancel, A pause, ratechange yeniden zamanlama, değişen kaynakta stale play ve Safari play rejection). Test komutu: `node --test tests/beat-align.test.cjs`.
- GitHub branch/PR #8 üzerinde değişiklikler: [3e617fa](https://github.com/canuck963/-MIXORA/commit/3e617fad48eac96ebbfc47e4a1fb629e3d8da931) modül, [c01ce11](https://github.com/canuck963/-MIXORA/commit/c01ce11f5c96049ab2494bb030fda4445945bb70) test, [5481bb4](https://github.com/canuck963/-MIXORA/commit/5481bb4e23b357bd73faadbb6ba9bd3c198776a0) DJ Studio bağlantısı.
- Push sonrası tam `node --test tests/*.test.cjs`, `node tests/syntax.cjs`, Python unittest ve Chromium/WebKit CI sonucu ayrıca doğrulanmalı. Fiziksel iPhone Safari, gerçek müzikle kulak testi ve canlı dağıtım yapılmadı.

### Devam işleri
1. Yeni commit için GitHub Actions tüm Node/syntax/Python/browser adımlarını kontrol et; başarısızlığı düzelt.
2. iPhone Safari'de A'yı durdurma, rate slider değiştirme, hızlı parça değişimi ve izin reddi sırasında B'nin yanlış başlamadığını doğrula.
3. Gerçek ilk vuruş/downbeat fazını tahmin edip kullanıcıya güven puanı sun; track-zero varsayımını kaldırmadan önce gerçek davul/senkop örneklerinde ölç.
4. Issue #2'nin pitch-preserving time-stretch, cümle/kesit kalitesi, WAV/önizleme eşitliği ve gerçek müzik değerlendirmesi hâlâ açık.