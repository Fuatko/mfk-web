# CLAUDE.md — mfk-web çalışma kuralları

## Production onayı

**Production'a hiçbir şekilde dokunulmaz — ne `vercel --prod`, ne `vercel --prod=false`, ne main'e merge — Fuat'ın açık "go" onayı olmadan.**

Bu kural istisnasız geçerlidir; acil durum, test, doğrulama veya başka herhangi bir gerekçeyle devre dışı bırakılamaz.

Onay gerektiren işlemler:
- `vercel --prod` veya `vercel --prod=true`
- `git merge` / `git push` → main dalı
- Production ortam değişkenlerinin doğrudan değiştirilmesi (Preview için onay gerekmez)

Onay istemeden önce yapılması gerekenler:
- Yayınlanacak değişiklikleri özetle
- Hangi komutun çalıştırılacağını belirt
- Fuat'ın "go" demesini bekle

## Veritabanı kuralları

- `inspira360x_prod` veritabanına hiçbir şekilde dokunulmaz
- Her DDL adımı Fuat'a gösterilir, onaylanmadan uygulanmaz
- Faz raporlarında gerçek veritabanı çağrılarının sonuçları yer alır

## Dal stratejisi

- Ana geliştirme dalı: `nabiz`
- `main` → production (Vercel)
- `nabiz` → Fuat onayı olmadan `main`'e birleştirilmez
