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
- Yeni `tests/beat-align.test.cjs`: **8/8 geçti** (rate-aware delay, on-grid davranışı, invalid BPM/rate, cancel, A pause, ratechange yeniden zamanlama, değişen kaynakta stale play, Safari play rejection ve iOS play izni beklerken iptal sonrası B'nin tekrar susturulması). Test komutu: `node --test tests/beat-align.test.cjs`.
- GitHub branch/PR #8 üzerinde değişiklikler: [3e617fa](https://github.com/canuck963/-MIXORA/commit/3e617fad48eac96ebbfc47e4a1fb629e3d8da931) modül, [c01ce11](https://github.com/canuck963/-MIXORA/commit/c01ce11f5c96049ab2494bb030fda4445945bb70) test, [5481bb4](https://github.com/canuck963/-MIXORA/commit/5481bb4e23b357bd73faadbb6ba9bd3c198776a0) DJ Studio bağlantısı.
- Push sonrası tam `node --test tests/*.test.cjs`, `node tests/syntax.cjs`, Python unittest ve Chromium/WebKit CI sonucu ayrıca doğrulanmalı. Fiziksel iPhone Safari, gerçek müzikle kulak testi ve canlı dağıtım yapılmadı.

### Devam işleri
1. Yeni commit için GitHub Actions tüm Node/syntax/Python/browser adımlarını kontrol et; başarısızlığı düzelt.
2. iPhone Safari'de A'yı durdurma, rate slider değiştirme, hızlı parça değişimi ve izin reddi sırasında B'nin yanlış başlamadığını doğrula.
3. Gerçek ilk vuruş/downbeat fazını tahmin edip kullanıcıya güven puanı sun; track-zero varsayımını kaldırmadan önce gerçek davul/senkop örneklerinde ölç.
4. Issue #2'nin pitch-preserving time-stretch, cümle/kesit kalitesi, WAV/önizleme eşitliği ve gerçek müzik değerlendirmesi hâlâ açık.

### 14 Kasım CI ara sonucu — run #135

- [GitHub Actions #135](https://github.com/canuck963/-MIXORA/actions/runs/43602433169), test commit `647fe02` için: `node --test tests/*.test.cjs`, `node tests/syntax.cjs` ve `python -m unittest discover -s tests -v` adımları **başarılı**.
- Playwright kurulumu (Chromium/WebKit) o anda devam ediyordu; browser test adımı henüz başlamadığı için bu run tam yeşil olarak raporlanmıyor. Fiziksel iPhone testi yine ayrıca gerekli.

## 15 Kasım 2026 — DJ beat phase kestirimi

- assets/beat-align.js içine cihazda çözümlenen ses buffer'ından 10 ms RMS saldırı (onset) zarfıyla beat-grid fazı kestirimi eklendi. Bu bir downbeat/phrase tanıyıcı değildir; yalnızca girilen BPM'e göre düzenli saldırıların fazını bulur.
- DJ Studio'daki B'yi sonraki vuruşta başlat artık A dosyasını yerelde decode edip fazı tahmin eder; güven düşükse açıkça 0 sn fallback uyarısı verir. Dosya değişimi veya A'nın durması decode sırasında kontrol edilir. AudioContext kapanır ve buton tekrar etkinleşir.
- nextBeatDelaySeconds ve scheduler faz parametresiyle çalışır; playback-rate değişiminde aynı grid fazı korunur.
- tests/beat-align.test.cjs: sıfır olmayan faz, BPM uyuşmazlığı, faza göre zamanlayıcı ve önceki iptal/izin yarışları kapsanıyor.
- Kod commitleri: [ff717eb](https://github.com/canuck963/-MIXORA/commit/ff717eb5d1cd10945d5cdaf8e0e41c74f4aa08b9), [02e0d85](https://github.com/canuck963/-MIXORA/commit/02e0d85842d0b783a882e0efa725e7d557ba11de), [de1e4f6](https://github.com/canuck963/-MIXORA/commit/de1e4f62891e7b5da40f4cf9f43b57691ede211d), test kaynak düzeltmesi [0b8797c](https://github.com/canuck963/-MIXORA/commit/0b8797c3fca10d5e72bbb083cd3a9609a1e5235b), kapsam açıklaması [49e19d6](https://github.com/canuck963/-MIXORA/commit/49e19d6ee8da8358e598c31d27483393d7f0ab7f).
- Bu run'da GitHub Actions'ın önceki run #139 sonucu success idi (Node, syntax, Python ve browser workflow tamamlandı). Yeni faz değişikliği için CI henüz bekleniyor; GitHub bağlantısı nedeniyle container'da repo klonlayıp Node testlerini yerel çalıştırmak mümkün olmadı.
- Sonraki kontrol: yeni CI beat-phase testini doğrula; gerçek müzikte faz false-positive oranını dinleyerek değerlendir; iPhone Safari decode bellek/izin davranışını ölç. Faz güveni yalnızca onset uyumudur, müzikal downbeat garantisi değildir.
- Ek HTML regresyonu, DJ düğmesinin seçili yerel A dosyasını decode ettiğini, faz sonucunu scheduler'a aktardığını ve decode sırasında eski dosya referansını reddettiğini doğrular. [Test commit f09134c](https://github.com/canuck963/-MIXORA/commit/f09134cdf36697f1d6b6eea3b7e2bf9bf3d8753b); bu son test commit'i için CI bekleniyor.

## 17 Kasım 2026 — DJ deck B manuel başlatma yarışı

- Önceki scheduler, B deck kullanıcı tarafından geri sayım sırasında elle başlatılırsa bekleyen timer'ı iptal etmiyordu. Timer sonunda `play()` çağrısı zaten çalan parçaya ulaşabiliyor ve arayüz yanlış biçimde “tahmini vuruşta başlatıldı” diyebiliyordu.
- Scheduler artık B zaten çalıyorsa hizalı başlatmayı reddeder. Bekleme sırasında B'nin `play` olayı kullanıcı tarafından tetiklenirse timer ve dinleyiciler temizlenir; mevcut manuel oynatma durdurulmaz.
- Scheduler'ın kendi başlattığı `play` olayı `attemptedAudio` ile ayırt edilir; bu olay kendi zamanlayıcısını iptal etmez. Timer anında B'nin hâlâ duraklatılmış ve aynı kaynakta olduğu tekrar doğrulanır.
- Yeni regresyonlar: B önceden çalarken reddetme, geri sayım sırasında manuel B başlatıldığında iptal, scheduler kaynaklı B play olayının başarıyla tamamlanması.
- Yerel Node testleri bu otomasyon çalışma alanında doğrudan çalıştırılmadı; commit sonrası GitHub Actions sonucu izlenecek. Fiziksel iPhone Safari ve gerçek müzikle gecikme/ritim doğrulaması hâlâ gerekli.

### CI düzeltmesi — run #159

- İlk CI çalışması [#159](https://github.com/canuck963/-MIXORA/actions/runs/44098623856) yeni scheduler mantığındaki üretim hatasını değil, test çiftindeki varsayılanı yakaladı: FakeAudio B kanalı gerçek HTMLAudioElement gibi varsayılan olarak duraklatılmış başlamalıydı. Önceki test double `paused=false` verdiği için yeni güvenlik kontrolü mevcut testlerde beklenen şekilde zamanlayıcıyı reddetti.
- FakeAudio varsayılanı `paused=true` yapıldı; A testlerinde açıkça `false` verilmeye devam ediyor. Yeni manuel başlatma testleri B'yi özellikle `false` yaparak yarış durumunu sınar.
- Commit anında CI bekleniyordu; düzeltme sonrası sonuç aşağıdaki run #161 kaydında başarılı olarak doğrulandı.


### CI sonucu — run #161 (17 Kasım 2026)

- [GitHub Actions #161](https://github.com/canuck963/-MIXORA/actions/runs/44098892853) **başarılı**.
- Node: **50/50 test geçti** (yeni 3 B-play yarış testi dahil).
- `node tests/syntax.cjs`: başarılı.
- Python sunucu paketi: **12/12 test geçti**.
- Playwright: Chromium ve WebKit mobil stüdyo/topluluk akışları geçti; üç remix önizlemesi, WAV dışa aktarma, proje geri yükleme, yerel kayıt, hesap, yayınlama, beğeni, yorum ve eski canlı deck senaryoları PASS.
- CI'nin ilk localhost sağlık kontrolü sunucu açılmadan önce bağlantı reddetti; workflow retry döngüsü içinde sunucu hazır oldu ve browser testi başarılı tamamlandı.
- Bu CI fiziksel iPhone Safari veya gerçek müzikle öznel miks kalitesi doğrulaması değildir.


## 18 Kasım 2026 — Belirsiz vuruş fazında güvenli fallback

- DJ beat-phase analizine ikinci bir güven ölçüsü eklendi: **alternatif faz ayrımı**. En iyi grid skoru, en iyi fazın ana tolerans penceresi dışındaki en güçlü rakip grid ile karşılaştırılır.
- Aynı güçte beat ve offbeat saldırıları iki eşdeğer fazı destekliyorsa analiz artık rastgele birini seçmez; phaseMargin < 0.12 olduğunda sonuç reddedilir ve DJ Studio açıkça 0 saniye fallback mesajı gösterir.
- Ana vuruş saldırıları belirgin, senkoplu/offbeat saldırılar daha zayıf olduğunda baskın grid korunur. Mevcut saldırı uyumu (confidence) API alanı korunmuştur; yeni phaseMargin alanı eklenmiştir.
- Bu değer downbeat veya müzikal cümle güveni değildir; yalnızca girilen BPM'e göre en iyi ve rakip onset-grid ayrımını ölçer. Audio tarayıcıda analiz edilir ve sunucuya yüklenmez.
- Yeni regresyonlar: eşit güçte yarım-vuruş gridlerinin reddi, daha zayıf offbeat saldırılarında baskın fazın korunması ve UI'nın alternatif faz ayrımını kontrol etmesi.
- Commitler: algoritma [349cd1c](https://github.com/canuck963/-MIXORA/commit/349cd1c705234128dc83799545c5f72e7199da0e), sentetik regresyonlar [95d5b78](https://github.com/canuck963/-MIXORA/commit/95d5b782a9994c6d5fd08ce32f22785b5d051202), DJ Studio fallback mesajı [4da79ed](https://github.com/canuck963/-MIXORA/commit/4da79ed03128617b415104c1080feb227061380c), UI regresyon kontrolü [9322867](https://github.com/canuck963/-MIXORA/commit/9322867fd6343fb316057761613b979180ddf16e).
- [GitHub Actions #172](https://github.com/canuck963/-MIXORA/actions/runs/44318084797) **başarılı**: Node **52/52**, HTML/JS syntax, Python **12/12**, Playwright Chromium ve WebKit mobil stüdyo/topluluk senaryoları geçti. Browser adımında ilk localhost sağlık isteği sunucu hazır olmadan reddedildi; workflow retry ile servis hazır oldu ve iki tarayıcı da PASS verdi.
- Fiziksel iPhone Safari, gerçek davul/senkop parçalarıyla faz false-positive ölçümü ve pitch-preserving time-stretch hâlâ açık. CI sentetik sinyal ve tarayıcı akışını doğrular; gerçek müzikal downbeat veya ses kalitesi garantisi değildir.

## 19 Kasım 2026 — DJ beat scheduler zamanlayıcı gecikmesine karşı koruma

- `assets/beat-align.js` artık bir sonraki vuruşu yalnızca milisaniye gecikmesi olarak değil, A parçasının **hedef medya zamanı** olarak hesaplıyor. `setTimeout` erken tetiklenirse A'nın gerçek `currentTime` değeri hedefe yaklaşana kadar yeniden kontrol ediliyor.
- Tarayıcı ana iş parçacığı veya iOS arka plan zamanlayıcısı hedef vuruşu kaçırırsa B eski vuruşa geç kalmış biçimde başlatılmıyor; sonraki grid vuruşu bekleniyor. Böylece gecikmiş callback yanlış senkronizasyon başarısı üretmiyor.
- Geri sayım sırasında A kullanıcının seek/scrub işlemiyle konum değiştirirse bekleyen B başlatması iptal ediliyor.
- Yeni testler: hedef medya zamanı, erken callback yeniden kontrolü, kaçırılan vuruşta sonraki grid'e geçiş ve seek iptali. Fake clock artık medya saatinin callback anındaki konumunu açıkça simüle ediyor.
- Bu iyileştirme HTMLAudioElement + JavaScript zamanlayıcısının hassasiyet sınırlarını kaldırmaz; sample-accurate beat sync, downbeat/phrase tespiti veya pitch-preserving time-stretch değildir. Fiziksel iPhone Safari ve gerçek müzikle gecikme ölçümü hâlâ gerekli.
- GitHub Actions [#44538209059](https://github.com/canuck963/-MIXORA/actions/runs/44538209059) **başarılı**: Node **56/56**, HTML/JS sözdizimi ve yerel bağlantılar, Python **12/12**, Playwright Chromium ve WebKit mobil stüdyo/topluluk akışları geçti.
- Fiziksel iPhone Safari ve gerçek müzikle gecikme/kalite ölçümü hâlâ gerekli. PR #1 ayrı taslak, issue #2 açık; `main` ve PR #1 kapsamı değiştirilmedi.

## 20 Kasım 2026 — iOS play() izin yarışı ve eski scheduler sahipliği

- İncelemede şu yarış doğrulandı: B'nin `HTMLMediaElement.play()` çağrısı iOS izin/etkileşim beklerken A'nın `ratechange` olayı yeni bir vuruş planı oluşturabiliyor. Eski promise sonradan `play` olayı üreterek yeni geri sayımı manuel oynatma sanıp iptal edebiliyor; daha geç çözülürse yeni başlayan B'yi de durdurabiliyor.
- `assets/beat-align.js` her oynatma çağrısı için ayrı token tutuyor. İptal edilmiş fakat hâlâ bekleyen promise'ler izleniyor; onların `play` olayı yeni scheduler tarafından manuel başlatma sayılmıyor. Eski promise yalnızca aynı B kaynağı için daha yeni bir scheduler başlatması sahiplik almamışsa B'yi tekrar durdurabiliyor. Eski promise yeni denemenin listener/state alanını temizleyemiyor.
- Yeni regresyonlar: (1) eski izin promise'i yeni vuruş timer'ı beklerken çözülürse timer korunur ve eski ses durdurulur; (2) yeni B oynatması başarıyla başladıktan sonra eski promise çözülürse yeni oynatma durdurulmaz.
- Commitler: [ad7e2f7](https://github.com/canuck963/-MIXORA/commit/ad7e2f7d924e949035f5b88939dbad3cba687b33), [caa1280](https://github.com/canuck963/-MIXORA/commit/caa1280dbf16670940e1b04cfcebe6d2101b5daa), [0da6d9d](https://github.com/canuck963/-MIXORA/commit/0da6d9d10ca5d71901254f390494d8c7d3fb1502).
- [GitHub Actions #44748453647](https://github.com/canuck963/-MIXORA/actions/runs/44748453647) tam başarılı: Node test paketi, HTML/JS syntax, Python sunucu testleri ve Playwright Chromium + WebKit tarayıcı akışı geçti.
- Bu ortamda yerel checkout denenmiş ancak ağ DNS'i `github.com` adresini çözemedi; bu nedenle tam test/build doğrulaması GitHub Actions üzerinden yapılıyor. Ayrı frontend build sistemi yok.
- Kalan: fiziksel iPhone Safari'de ses izni açıkken hız değiştirme, B deck'i elle başlatma, hızlı tekrar hizalama ve dosya değiştirme senaryoları; iki gerçek şarkıyla kulak testi. Downbeat/phrase detection, pitch-preserving time-stretch ve üç remix WAV kalite karşılaştırması issue #2 kapsamında açık kalır. PR #1 taslak ses motoru ayrı korunur; main ve PR #5 değiştirilmedi.


## 21 Kasım 2026 — Senkop ve yarım/çift tempo belirsizliğini güvenli gösterme

- `assets/tempo.js` artık tek bir medyan onset aralığına güvenmek yerine 60–180 BPM arasında sınırlı tempo-grid taraması yapıyor. 10 ms pozitif-RMS onset'leri 32 faz örneğinde puanlanıyor; daha zayıf senkoplu saldırılar ana pulse'u otomatik olarak daha hızlı BPM'e zorlamıyor.
- Güven, toplam onset enerjisinin seçilen grid toleransına giren payı olarak korunuyor. 72/144 gibi eşit derecede makul yarım/çift zaman yorumları `candidateBpms` ve `ambiguous` ile raporlanıyor. Düşük destekli veya octave-ambiguous sonuçta `estimateTempo` null döner; kesit hizalama ve overlay giriş hizalaması belirsiz grid'i otomatik uygulamaz.
- Remix Studio tempo düğmesi ve iki BPM karşılaştırması belirsizliği açıkça gösterir. Ana DJ Studio'nun ayrı, eski autocorrelation tahmini kaldırıldı; aynı yerel analiz modülünü kullanıyor ve belirsiz sonuçta BPM alanını doldurmuyor. Dosyalar cihazdan çıkmaz.
- Yeni sentetik regresyonlar: zayıf offbeat vuruşlarında 120 BPM ana grid'i koruma, 72/144 octave belirsizliği, eşit güçlü beat/offbeat grid'inde güvenli ret, UI uyarısı ve canlı DJ sayfasında ortak analiz modülü.
- CI push ile otomatik çalışacak. Yerel prototipte 72/100/120/128/160 BPM ve zayıf/eşit offbeat örnekleri denendi; tam depo test paketi henüz çalıştırılmadı.
- Sınırlar: bu hâlâ 10 ms RMS onset + algoritmik grid puanlamasıdır; müzikal downbeat/4-8-16 bar phrase, tonalite, AI/stem separation veya pitch-preserving time-stretch değildir. 30 saniyeye kadar 241 BPM adayı ve 32 faz taraması iPhone'da gerçek dosyalarla performans ölçümü gerektirir.
- Sonraki: GitHub CI'nın tüm Node/syntax/Python/Chromium/WebKit adımlarını kontrol et; iPhone Safari'de 72/144 ve senkop örneklerini doğrula; iki izinli gerçek parçayla üç remix WAV/önizleme eşitliğini dinle. Issue #2 ve PR #1 ayrı açık kalır.


## 21 Kasım 2026 — BPM güven eşiği ve kesit hizalama raporu düzeltmesi

- İlk CI incelemesinde son tempo-grid commit'inin tam test paketi 60/63 geçti; üç başarısızlığın ikisi eski mix-core testinin 72 BPM'i kesin kabul etmesinden (yeni analiz doğru biçimde 72/144 belirsizliği bildiriyor) ve düzensiz transient dizisinin %62,5 onset enerjisiyle yanlışlıkla kesin sayılmasından kaynaklandı. Üçüncü hata UI testinin optional chaining (tempo?.ambiguous) sözdizimini regex'te hesaba katmamasıydı.
- Güvenli otomatik BPM eşiği %58'den %70'e yükseltildi. 70% altı enerji desteğinde analiz sonucu kullanıcıya belirsiz gösterilir ve otomatik BPM/beat-snap uygulanmaz. Eski 72/144 belirsizliği davranışı korunur; 100/128/160 BPM düzenli sentetik örnekleri kesin kalır.
- snapRangeToBeats artık yalnızca gerçekten hizalanan kenarın analizini raporlar. Bir kenarın analiz penceresi belirsiz/boş, diğer kenar güvenilir olduğunda ekranda kullanılmayan pencerenin BPM ve güven yüzdesi gösterilmez.
- Yeni regresyon, aynı dosyanın ilk bölümünde belirsiz 72/144, sonraki bölümünde güvenilir 120 BPM varken yalnızca bitiş kenarının hizalanıp 120 BPM raporlanmasını kontrol eder.
- İlgili testler: eski 72 BPM beklentisi yeni güvenli sözleşmeye uyarlandı; düzensiz transient reddi korunuyor; optional chaining UI kontrolü düzeltildi. GitHub Actions #44913193898/#44913187817'de ilk Node adımı 60/63 geçti ve sonraki adımlar bu nedenle çalışmadı. Yeni commit için tüm CI yeniden çalıştırılacak.
- Kalan: fiziksel iPhone Safari performansı ve gerçek müzikte BPM/beat-grid doğruluğu; pitch-preserving time-stretch ve üç farklı remix WAV kalite karşılaştırması. PR #1 taslak ve issue #2 açık kalır; main değiştirilmez.


### CI sonucu — 21 Kasım, commit 537a6c7

- [PR CI #44913966947](https://github.com/canuck963/-MIXORA/actions/runs/44913966947) ve [push CI #44913962305](https://github.com/canuck963/-MIXORA/actions/runs/44913962305) **başarılı**.
- Node: **64/64**, HTML/JavaScript syntax: başarılı, Python: **12/12**, Playwright Chromium + WebKit kurulum ve browser akışı: başarılı.
- Bu doğrulama GitHub Actions üzerinde yapıldı. Depoda `package.json` veya ayrı frontend build script'i bulunmuyor; CI'nın gerçek kontrol zinciri Node testleri, syntax, Python sunucu testleri ve Playwright tarayıcı senaryolarıdır.
- Fiziksel iPhone Safari, iki gerçek lisanslı/izinli müzik dosyasıyla dinleme testi, perde korumalı time-stretch ve üç WAV kalite karşılaştırması hâlâ yapılmadı.


## 22 Kasım 2026 — Sinematik overlay için iki kaynaklı vuruş fazı eşleştirmesi
- Sinematik öneri artık yalnızca A parçasındaki giriş vuruşunu aramaz: A'nın planlanan overlay anı ve B'nin seçili başlangıcı kendi güvenilir beat-grid'lerine göre ayrı ayrı en yakın gözlenen vuruşa yaklaştırılır.
- Öneri yalnızca iki analiz de belirsiz değilse, her iki giriş yakın bir vuruş içindeyse ve kalan gerçek overlap boyunca hesaplanan tempo kaynaklı faz kayması 100 ms'yi aşmıyorsa uygulanır. Aksi durumda hem B kesit başlangıcı hem overlay gecikmesi orijinal seçime döner.
- Bu işlem yalnızca iki başlangıç fazını eşleştirir; playback rate değiştirmez, pitch-preserving time-stretch veya downbeat/phrase tespiti değildir. Uzun süreli tempo farkı olan parçalar güvenli biçimde fallback kullanır.
- `tests/mix-core.test.cjs` senaryosu aynı tempolu iki sentetik kaynağın A ve B girişlerini ayrı ayrı hizaladığını, 120/110 BPM örneğinde tahmini kayma sınırı aşıldığı için varsayılan planı koruduğunu doğrular.
- GitHub Actions yeni commit üzerinde Node, syntax, Python ve Chromium/WebKit akışlarını çalıştıracak. Fiziksel iPhone Safari ve izinli gerçek müzikle dinleme testi hâlâ gereklidir.
- Sonraki işler: gerçek şarkılarda beat-grid/phase doğruluğunu ölç; pitch-preserving time-stretch'i ayrı bir ses motoru olarak tasarla ve CPU/bellek sınırlarını test et; üç önerinin WAV çıktısını aynı kaynaklarla karşılaştır. Issue #2 ve PR #1 ayrı açık kalır; ana dal ve diğer PR dalları değiştirilmez.


### 22 Kasım — çift kaynak hizalama test eşiği düzeltmesi
- İlk CI (#45030418255 / #45030423470) 63/64 Node testi geçti. Yeni sinematik testte A vuruşu planlanan girişten 160 ms uzaktı; algoritmanın çeyrek-vuruş toleransı 120 BPM'de 125 ms olduğundan güvenli fallback doğru çalıştı. Hata algoritmada değil, testin hizalanabilir örnek varsayımındaydı.
- Sentetik A vuruşu 100 ms farkla hizalanabilir konuma alındı; 120/110 BPM drift reddi ayrı senaryo olarak korunuyor. Yeni CI çalışması bu test düzeltmesini doğrulayacak.


### Son CI doğrulaması — 22 Kasım 2026, commit 53fcfd7
- [Push workflow #45030548801](https://github.com/canuck963/-MIXORA/actions/runs/45030548801) ve [PR workflow #45030555127](https://github.com/canuck963/-MIXORA/actions/runs/45030555127) **başarılı**.
- Node: **64/64**; HTML/JavaScript syntax: başarılı; Python sunucu testleri: **12/12**; Playwright Chromium + WebKit kurulumu ve browser akışı: başarılı.
- İlk kod commit'inde 63/64 testi geçiren yeni test fixture'ı çeyrek-beat toleransını 35 ms aşıyordu; güvenli fallback doğru davranmıştı. Fixture 100 ms yakınlığa alındı, 120/110 BPM drift fallback senaryosu korundu ve sonraki iki CI çalışması tamamen geçti.
- Fiziksel iPhone Safari ve iki gerçek, kullanım hakkı bulunan parça ile ses kalitesi/tempo drift doğrulaması yapılmadı. Bu sonuçlar canlı cihaz veya müzikal kalite onayı değildir.


### 22 Kasım — WebKit beğeni testi için kart bazlı bekleme
- Dokümantasyon commit'inin PR CI ilk denemesinde Chromium geçti; WebKit, beğeni API'si 200 döndükten sonra global akışta tam olarak `♥ 1` ararken zaman aşımına uğradı. Bu kontrol, akışta başka beğeniler varsa veya ilk eşleşen kart farklıysa kırılgandı.
- `tests/browser.cjs` artık global ve sabit sayıyı aramak yerine tıklanan kartın düğmesinin beğenilmiş duruma geçmesini bekler. Böylece test, doğru kartın gerçek UI durumunu doğrular.
- Düzeltme commit'i: [b710d49](https://github.com/canuck963/-MIXORA/commit/b710d49d34d97fc975936dd3b52ef67b82401c49). Yeni CI sonucu ayrıca kontrol edilecek; ilk WebKit başarısızlığı gizlenmedi.


### 22 Kasım — Beğeni tarayıcı testi hedefini yeni yayımlanan karta sabitleme
- İlk kart-bazlı bekleme denemesi de WebKit'te kalp karakterine göre locator ararken zaman aşımına uğradı. Bu nedenle test, Unicode kalp metnine göre kart bulmak yerine yayımlama sonrası URL'deki `post` kimliğini alır ve yalnızca `#post-<id>` kartının ilk `.actions` düğmesini kullanır.
- Yeni remix'in başlangıçta beğenilmemiş olduğu doğrulanır; POST yanıtından sonra aynı düğmenin beğenilmiş duruma geçtiği beklenir. Böylece hem kart seçimi hem durum geçişi açıkça sınanır.
- Düzeltme commit'i: [a130ce6](https://github.com/canuck963/-MIXORA/commit/a130ce638b57c9b44bb4d25d1530c0d6a72f6dc0). Push ve PR Chromium/WebKit CI sonucu bekleniyor.


### 22 Kasım — Yayın tamamlanmadan akış kartını seçme yarışını giderme
- WebKit'te yeni post için `waitForSelector('.post audio')` eski akış kartı nedeniyle erken tamamlanabiliyordu. Bu yüzden URL henüz `?post=<id>` olmadan test eski kartı seçiyor ve yeni post ID'sini bulamıyordu.
- Browser testi artık yayın düğmesinden sonra uygulamanın `Remixin yayımlandı` durumunu bekliyor; ardından URL'deki yeni post ID ve o karta ait beğeni düğmesi doğrulanıyor.
- Düzeltme commit'i: [c775745](https://github.com/canuck963/-MIXORA/commit/c775745363f1a9a04466e12d1e7c5a1df2d43174). Yeni CI sonucu bekleniyor.


### Nihai doğrulama — 22 Kasım 2026, PR head 23ae7141
- [Push CI #45031722363](https://github.com/canuck963/-MIXORA/actions/runs/45031722363) ve [PR CI #45031726697](https://github.com/canuck963/-MIXORA/actions/runs/45031726697) **başarılı**.
- Node **64/64**, syntax başarılı, Python **12/12**, Playwright Chromium + WebKit kurulum ve browser akışları başarılı.
- WebKit akış testinde önce eski kartın erken bulunması ve sabit beğeni sayısı varsayımı vardı. Test, yayın tamamlanmasını bekleyip URL'deki yeni post ID'sini ve o karta ait beğeni durumunu doğrulayacak şekilde düzeltildi.
- Sonraki işler: fiziksel iPhone Safari; kullanım hakkı bulunan gerçek iki şarkıyla beat-grid/phase ve drift dinleme ölçümü; pitch-preserving time-stretch; üç remix WAV çıktısının kalite karşılaştırması; gerçek e-posta teslimatı/üretim dağıtımı. Bu CI sonuçları gerçek cihaz veya müzikal kalite onayı değildir.


## 22 Kasım 2026 — WAV dışa aktarmada örnek tepe seviyesi güvenliği
- `assets/mix-core.js` içine `applyPeakCeiling(buffer, -1)` eklendi. Render edilmiş AudioBuffer'ın bütün kanallarını tarar; örneklerde NaN/Infinity varsa dışa aktarmayı reddeder. Tepe -1 dBFS sınırını aşıyorsa tüm kanallara aynı attenuation uygulanır; stereo denge/faz korunur ve düşük seviyeli miks asla yükseltilmez.
- Gelişmiş `Remix.html` WAV dışa aktarma akışı, OfflineAudioContext render'ından sonra ve 16-bit PCM kodlamasından önce bu işlemi çağırır. Arayüz kullanıcıya örnek tepe sınırını bildirir.
- `tests/mix-core.test.cjs`: çok kanallı attenuation, sessiz/quiet sinyalde gain=1, geçersiz sınır ve non-finite örnek testleri eklendi. `tests/browser.cjs` indirilen gerçek WAV örneklerini okuyup sample peak'in -1 dBFS tavanını aşmadığını doğrular.
- Sınır: bu sample-peak ceiling'dir; inter-sample true-peak limiter, LUFS loudness normalization veya mastering değildir. Çok yüksek miksleri yalnızca kısar; preview ile mutlak loudness farkı olabilir. Gerçek müzikte dinleme ve iPhone bellek testi hâlâ gerekir.
- Sonraki: yeni push/PR CI'da Node, syntax, Python, Chromium ve WebKit sonuçlarını kontrol et; iki kullanım hakkı bulunan parçada preview/WAV peak ve subjektif geçiş kalitesini dinle; iPhone Safari'de uzun export bellek davranışını ölç. Pitch-preserving time-stretch, phrase/downbeat tespiti, gerçek SMTP ve canlı dağıtım açık.


### CI düzeltmesi — WAV peak ceiling test fixture'ı
- İlk push CI #45032841318'de 65/66 Node testi geçti. Algoritma sonucu doğruydu; test, Float32Array'in 0.1 gibi değerleri ikili kayan nokta hassasiyetiyle saklamasını hesaba katmadan normal JS sayılarıyla deep-equal yaptı.
- Quiet-signal testi artık aynı Float32Array'in kayıt öncesi snapshot'ıyla karşılaştırıyor. Non-finite testine iki kanal eklendi; ikinci kanaldaki NaN nedeniyle hata oluştuğunda ilk yüksek kanala kısmi attenuation uygulanmadığı da doğrulanıyor.
- Düzeltme commit'i ayrı olacak; önceki CI başarısızlığı açıkça kaydedildi. Yeni Node, syntax, Python ve Chromium/WebKit sonucu bekleniyor.


### Nihai CI doğrulaması — WAV peak ceiling, 22 Kasım 2026
- [Push workflow #45032927608](https://github.com/canuck963/-MIXORA/actions/runs/45032927608) **başarılı**.
- Node **66/66**, JavaScript/HTML syntax başarılı, Python **12/12**, Playwright Chromium ve WebKit akışları başarılı.
- Browser testi indirilen 16-bit WAV dosyasını okuyup sample peak'in -1 dBFS tavanı içinde kaldığını, sesin sessiz olmadığını; üç öneri önizlemesi, proje kaydı/geri yükleme ve topluluk akışını doğruladı.
- İlk CI'daki tek hata Float32Array test fixture hassasiyetiydi; 237a199 düzeltmesi sonrasında push workflow tamamen geçti. PR workflow #45032931884 aynı commit için son kontrolde hâlâ çalışıyordu.
- Bu CI fiziksel iPhone Safari, true-peak, gerçek parça dinleme veya mastering kalitesi onayı değildir.


## 23 Kasım 2026 — Gelişmiş Remix Studio önizleme ses yolunda düğüm yeniden kullanımı

- Remix.html içindeki her önizlemede yeni DynamicsCompressorNode oluşturulması yerine, canlı AudioContext için tek bir master compressor bus yeniden kullanılıyor. Her yeni önizleme kendi kaynak/gain düğümlerini oluşturmaya devam eder; OfflineAudioContext WAV render'ı kendi bağlamına ait bağımsız bus kullanır.
- Sayfa pagehide olduğunda aktif kaynaklar durdurulur ve canlı master bus bağlantısı kesilip referansı bırakılır. Bu değişiklik, tekrarlı önizlemelerde gereksiz compressor/destination bağlantısı birikmesini önlemeyi ve iPhone Safari'de ses grafiği churn'ünü azaltmayı amaçlar; fiziksel cihaz bellek profili henüz alınmadı.
- tests/mix-core.test.cjs yeni regresyonu doğrular: aynı preview context'te iki schedule çağrısı tek compressor/tek destination bağlantısı oluşturur; offline context ayrı compressor kullanır ve her audition kendi source'unu planlar.
- Tam doğrulama, yeni commit için GitHub Actions Node, syntax, Python, Chromium ve WebKit adımlarıyla yapılacak. Fiziksel iPhone Safari, gerçek müzik dinleme/tempo drift, pitch-preserving time-stretch, üç WAV kalite karşılaştırması, gerçek SMTP ve üretim dağıtımı açık işler.

### Nihai CI doğrulaması — 23 Kasım 2026, preview master bus
- Push workflow [#45188829921](https://github.com/canuck963/-MIXORA/actions/runs/45188829921) ve PR workflow [#45188841228](https://github.com/canuck963/-MIXORA/actions/runs/45188841228) başarılı tamamlandı.
- Node testleri, JavaScript/HTML syntax, Python sunucu testleri, Chromium ve WebKit browser akışı geçti. Browser senaryosu iki mobil motor üzerinde üç öneri önizlemesi, WAV export, proje geri yükleme, yerel kayıt, hesap/yayın/beğeni/yorum ve eski live deck akışlarını çalıştırdı.
- Yeni regresyon, aynı canlı AudioContext'te iki schedule çağrısının tek compressor bus ve tek destination bağlantısı kullandığını; OfflineAudioContext'in ayrı bus oluşturduğunu doğruladı.
- Bu CI fiziksel iPhone Safari bellek profili veya gerçek müzik kalitesi testi değildir. Gerçek cihaz ve lisanslı/izinli parça ile kulak doğrulaması hâlâ gereklidir.

## 24 Kasım 2026 — Bütün WAV dışa aktarma yollarında örnek tepe seviyesi güvenliği

- 22 Kasım'da eklenen -1 dBFS sample-peak ceiling yalnızca gelişmiş `Remix.html` indirme düğmesinde uygulanıyordu. Kod incelemesinde iki ayrı yolun bu korumayı atladığı bulundu: `assets/studio.js` içindeki **Remixi cihaz kütüphaneme kaydet** (IndexedDB/topluluk yerel kaydı) ve eski `remix.html` manuel editörünün `toWav` dışa aktarması.
- Yerel kütüphane kaydı artık OfflineAudioContext render'ından sonra ve WAV PCM kodlamasından önce `MixCore.applyPeakCeiling(rendered, -1)` çağırır; kullanıcıya yalnızca kısma gerektiğinde bilgi verilir.
- Eski `remix.html` ortak `assets/mix-core.js` modülünü yükler ve indirme öncesinde `MixCore.applyPeakCeiling(result, -1)` uygular. Mevcut kesit, crossfade ve WAV kodlama davranışı korunur.
- `tests/mix-core.test.cjs` üç WAV yolunun ortak ceiling fonksiyonunu çağırdığını regresyon testiyle sabitler. `tests/browser.cjs` Chromium/WebKit'te IndexedDB'ye kaydedilen gerçek WAV'ın örnek tepe seviyesini okur; eski editörde yüksek seviyeli sentetik iki kaynakla indirilen WAV'ın -1 dBFS sınırını doğrular. Gelişmiş editörün mevcut indirilen WAV testi korunur.
- İlk PR CI denemeleri (#45409256527 ve #45409398990) iki test altyapısı sorununu görünür kıldı: yeni kaynak-regresyonunda kaçış karakteri nedeniyle geçersiz regex ve yerel kayıt testinin artık gerçek AudioBuffer alanlarını sağlayamaması. Regex kontrolleri açık string eşitliğine çevrildi ([149ab94](https://github.com/canuck963/-MIXORA/commit/149ab94601211fcee4412648f52e9e3c49e2a21b)); kayıt testi geçerli tek kanallı render tamponu kullanacak şekilde düzeltildi ([416c8a2](https://github.com/canuck963/-MIXORA/commit/416c8a2cf7ff4d2adcb6dd03e5f2fa882e256d35)).
- Sınır: bu işlem yalnızca sample-peak attenuation'dır; true-peak limiter, LUFS normalizasyonu veya mastering değildir. Gerçek cihazda uzun WAV bellek ölçümü, pitch-preserving time-stretch, üç remix WAV/önizleme kalite karşılaştırması, gerçek SMTP ve üretim dağıtımı açık kalır.


### Nihai CI doğrulaması — 24 Kasım 2026, tüm WAV yolları

- [PR workflow #45409469677](https://github.com/canuck963/-MIXORA/actions/runs/45409469677) **başarılı** (PR run #240).
- Node: **68/68**; JavaScript/HTML syntax: başarılı; Python sunucu testleri: **12/12**.
- Playwright Chromium ve WebKit mobil akışları başarılı. Yeni kontroller: IndexedDB'ye kaydedilen remix WAV'ında ceiling çağrısı ve gerçek PCM örnek tepe seviyesi; eski `remix.html` editöründe yüksek seviyeli sentetik iki kaynakla indirilen WAV'ın -1 dBFS ceiling altında kalması. Mevcut gelişmiş editör WAV export testi de geçti.
- Bu CI, fiziksel iPhone Safari veya gerçek şarkıların öznel miks kalitesi/tempo drift testi değildir. Sample-peak ceiling true-peak/LUFS mastering sağlamaz.


## 25 Kasım 2026 — Proje kaydetme/geri açma tutarlılığı

- Kod incelemesinde kaydetme yolunun geri yükleme yolundan daha gevşek olduğu doğrulandı: kaydetme 40 MB üzeri veya 420 saniyeyi aşan kaynakları kabul edebiliyor, ancak geri yükleme bunları reddediyordu. Eski bir çizelge kesiti yeni yüklenen kaynağın süresini aşsa veya fade 5 saniyeyi geçse de geri açılamayan proje kaydedilebiliyordu.
- `assets/studio.js` kaydetmeden önce iki kaynak için geri yüklemeyle aynı 40 MB ve 0,15–420 saniye sınırlarını, seçili aralıkları, mevcut kaynağı aşan klipleri ve 0–5 saniye fade aralığını doğrular.
- Her dosyanın `arrayBuffer()` sonucu beklenen `file.size` ile eşleşmeden IndexedDB yazımı yapılmaz; eksik okuma mevcut kaydı değiştirmez.
- `tests/studio-project.test.cjs` dört yeni regresyon senaryosu ekler: 40 MB sınırı, 420 saniye/eskimiş klip, fade sınırı ve kesik dosya okuması. Snapshot testi de gerçek dosya boyutuyla hizalandı.
- Kod/test commit'i: [a0baab2](https://github.com/canuck963/-MIXORA/commit/a0baab296e17705aba03a50ac75958cc8ee83c60).
- [GitHub Actions #45628627937](https://github.com/canuck963/-MIXORA/actions/runs/45628627937) **başarılı**: Node **72/72**, JavaScript/HTML syntax, Python **12/12**, Playwright Chromium ve WebKit. Browser akışında proje kaydetme/geri yükleme, üç remix önizlemesi, WAV export, yerel kayıt ve topluluk hesap/yayın/beğeni/yorum senaryoları geçti.
- Yerel container'dan GitHub klonu DNS çözümleme hatası nedeniyle açılamadı; tam test paketi GitHub Actions tarafından doğrudan aynı commit üzerinde çalıştırıldı. Depoda ayrı bir frontend bundle/build script'i yok; CI'nin syntax ve tarayıcı entegrasyon adımları kullanıldı.
- Bu CI fiziksel iPhone Safari, gerçek müziklerle subjektif miks kalitesi/tempo drift veya cihaz depolama kotası testi değildir. Pitch-preserving time-stretch, üç gerçek WAV çıktısının kalite karşılaştırması, gerçek SMTP ve üretim dağıtımı açık kalır.
- PR #8 güncellendi; PR #1 taslak olarak ayrı, Issue #2 açık bırakıldı. `main` değiştirilmedi ve canlı dağıtım yapılmadı.

## 26 Kasım 2026 — Enerjik remix için sürdürülen enerji yükselişi ve güvenilir vuruş girişi

- assets/tempo.js içine energeticDropEntry eklendi. B kesitinin ilk 12 saniyesinde 750 ms pencerelerle RMS enerji karşılaştırması yapar; ilk 1,5 saniyelik temel seviyeye göre en az %50 ve mutlak 0,012 RMS artış arar. Tek transient yerine sürdürülen pencere kullanılır.
- Aday giriş, yalnızca analyzeTempo güvenilir ve belirsiz olmayan bir grid döndürürse en yakın gözlenen vuruşa (en fazla 250 ms) taşınır. BPM/half-double belirsizliği, yeterli enerji kontrastı veya yakın vuruş yoksa orijinal Enerjik giriş korunur. Bu heuristik phrase/downbeat tespiti, time-stretch veya ML değildir.
- assets/studio.js Enerjik öneride önce mevcut sessiz giriş kısaltmasını korur; ardından yeni enerji yükselişi seçicisini çağırır. Duygusal ve Sinematik planlar ile manuel düzenleme akışı değiştirilmedi.
- tests/tempo-match.test.cjs içine sentetik 120 BPM enerji yükselişi, sabit enerji fallback'i, belirsiz beat/offbeat fallback'i ve üç öneri UI entegrasyon testi eklendi.
- Yeni kod commit'i için Node, syntax, Python, Chromium ve WebKit CI sonucu aşağıya eklenecek. Fiziksel iPhone Safari ve kullanım hakkı bulunan gerçek iki şarkıyla kulak/tempo drift testi hâlâ gerekli.
- Kalan işler: pitch-preserving time-stretch; üç önerinin gerçek WAV çıktılarının aynı kaynaklarla ses kalitesi/ayrışma karşılaştırması; downbeat/phrase analizi; gerçek SMTP/üretim yapılandırması ve canlı dağıtım. PR #1 taslak, PR #6/#7 ayrı, issue #2 açık; main değiştirilmez.

### 26 Kasım — Enerji yükselişi seçicisinde sabit ritim regresyonu

- İlk CI run #45835694240 yeni testte uniform 120 BPM pulse train için yanlış pozitif buldu: 1,5 saniyelik baseline ile 750 ms aday penceresi farklı uzunlukta olduğundan düzenli seyrek vuruşlar yapay enerji artışı gibi görünüyordu.
- Algoritma düzeltildi: baseline artık aynı 750 ms uzunluğundaki iki başlangıç penceresinin daha yüksek RMS değerini kullanıyor. Böylece sabit ritim için pencere uzunluğundan doğan sahte 2× enerji farkı oluşmuyor; gerçek 4. saniye enerji yükselişi korunuyor.
- Uniform pulse regression testi aynı şekilde tutuldu; yeni commit için tüm CI yeniden çalıştırılacak.