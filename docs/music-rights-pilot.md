# MIXORA — katalog ve hak yönetimi (pilot)

Bu belge teknik geliştirme rehberidir, lisans veya hukuk görüşü değildir. **YouTube Data API anahtarı müzik yayınlama, ses ayırma, indirme veya remix hakkı vermez.**

## Yayınlama koşulları

Bir kayıt MIXORA'nın bağımsız oynatıcısına ancak aşağıdaki kanıtlar doğrulandıktan sonra eklenebilir:

- Eser (beste/söz) için gerekli dijital kullanım izinleri.
- Master (ses kaydı) için gerekli yayın/streaming izinleri.
- İlgili icracı/komşu hakları ve ülke/bölge kısıtları.
- İzin verilen bölgeler, süre, kullanım türü ve sözleşme kimliği.

**DJ stüdyosu ayrı hak kontrolü kullanır:** dinleme izni, remix/türev eser, kayıt alma veya kullanıcılar arasında paylaşma izni anlamına gelmez.

## Katalog kayıt şeması (öneri)

```json
{
  "track_id": "internal-id",
  "title": "Örnek parça",
  "artist": "Örnek sanatçı",
  "audio_source": "licensed-storage-reference",
  "rights_holder": "Hak sahibi",
  "agreement_reference": "contract-id",
  "territories": ["TR"],
  "valid_from": "2026-10-30",
  "valid_until": "2027-10-30",
  "permissions": {
    "stream": true,
    "offline": false,
    "dj_mix": false,
    "remix_export": false,
    "public_share": false
  },
  "review_status": "approved"
}
```

Bu örnek gerçek bir parça veya lisans içermez. Sözleşme doğrulanmadan `review_status=approved` yapılamaz. Süresi dolmuş veya bölge dışı parçalar sunucuda engellenmelidir; yalnızca arayüzde gizlemek yeterli değildir.

## Pilot için sıralama

1. Arama ve bağımsız oynatıcıyı yalnızca açıkça izinli test dosyalarıyla doğrula.
2. Hak sahibi onayı, sözleşme kaydı, bölge/süre kontrolü ve izin denetimi ekle.
3. Streaming ve remix izinlerini birbirinden bağımsız uygula.
4. Gerçek katalog anlaşmaları ve fiyat teklifleri için hak sahipleri/meslek birlikleriyle görüş.
5. Telif şikâyeti, kaldırma ve tekrar ihlal süreçlerini canlı yayın öncesinde kur.

**Mevcut durum:** Bu dosya politika/şema taslağıdır; katalog entegrasyonu, lisans anlaşması veya çalışan sunucu denetimi değildir.
