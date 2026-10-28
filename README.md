# Tajemniczy Klient

Aplikacja do zarządzania i przeprowadzania audytów dostępności uczelni i obiektów w ramach akcji „Tajemniczy Klient”. Ocenia dwa obszary: **dostępność dla OZN** (architektura, komunikacja, cyfrowa) i **dostępność procesu kształcenia**.

Stos: Node.js ≥ 22.13 (testowane na 26), Express 5, wbudowany `node:sqlite` (czysty SQL, zero natywnych zależności), EJS (SSR), Zod, jose (JWT), multer, PDFKit.

## Szybki start (demo)

```bash
npm install
cp .env.example .env      # domyślnie SZO_AUTH_MODE=dev
npm run demo              # dane testowe + start serwera
```

Otwórz http://localhost:3000/login. W trybie `dev` na stronie logowania są przyciski kont demonstracyjnych:

| Konto | Rola |
|---|---|
| Anna Administrator | Administrator |
| Karol Koordynator | Koordynator (uczelnie: Uniwersytet Przykładowy, Politechnika Demonstracyjna) |
| Ewa Audytorka, Piotr Tajemniczy | Audytor / Tajemniczy Klient |

Dane demo: 2 uczelnie, wydział, budynek, 5 audytów w statusach Przypisany, W trakcie, Złożony i Zatwierdzony (2×) oraz 5 ocen w module „Dostępność kształcenia”.

## Uruchomienie

| Polecenie | Działanie |
|---|---|
| `npm start` | serwer (wczytuje `.env`) |
| `npm run dev` | serwer z automatycznym restartem |
| `npm run notify` | cykl powiadomień: przypomnienia + wysyłka kolejki (dla crona) |
| `npm run db:seed` | uzupełnia pustą bazę kryteriami i scenariuszami (robi to też start serwera) |
| `npm run demo:seed` | dane demonstracyjne (tylko poza produkcją) |
| `npm test` | testy jednostkowe i integracyjne |

Baza SQLite i migracje (`src/db/migrations/*.sql`) tworzą się automatycznie przy starcie.

## Logowanie przez SZO

Aplikacja nie przechowuje haseł. Tożsamość pochodzi z SZO, a po weryfikacji aplikacja wystawia własną, podpisaną sesję (cookie `httpOnly`, `SameSite=Lax`).

| `SZO_AUTH_MODE` | Działanie |
|---|---|
| `szo` | **Zalecany dla SZO FEER.** OAuth 2.0 Authorization Code + PKCE: przekierowanie do `SZO_BASE_URL`, wymiana kodu na token, sprawdzenie scope'u `SZO_SCOPE` (domyślnie `audytor:access`) i natychmiastowe unieważnienie tokenu SZO. Aplikacja zapisuje tylko tożsamość (id, imię i nazwisko, e-mail). |
| `jwt` | SZO wystawia JWT. Aplikacja weryfikuje podpis lokalnie: sekret (`SZO_JWT_SECRET`, HS256) albo klucz publiczny (`SZO_JWT_PUBLIC_KEY`, RS/ES), a także `iss`, `aud`, `exp`. |
| `api` | Aplikacja wysyła token do `SZO_VERIFY_URL` (`Authorization: Bearer`, opcjonalnie `X-Api-Key`). Oczekuje JSON z użytkownikiem (płasko lub w polu `user`); `active:false` odrzuca token. |
| `dev` | Logowanie testowe bez SZO. Aplikacja **odmawia startu** z tym trybem przy `NODE_ENV=production`. |

Wejście do aplikacji:

1. **SSO w przeglądarce**: SZO przekierowuje na `/auth/callback?token=<JWT>` (albo wysyła `POST` z polem `token`). Link „Zaloguj przez SZO” prowadzi do `SZO_LOGIN_URL`.
2. **Nagłówek** `Authorization: Bearer <token>`: token jest weryfikowany przy każdym żądaniu (przydatne dla integracji).

Nazwy pól tokenu ustawiasz w `SZO_CLAIM_*`. Role z SZO mapuje `SZO_ROLE_MAP`, np. `{"szo_admin":"administrator"}`. Gdy token niesie kilka ról, wygrywa najwyższa (administrator > koordynator > audytor). Jeśli SZO nie przekazuje roli, obowiązuje rola nadana w panelu **Użytkownicy**, a dla nowych kont `SZO_DEFAULT_ROLE`.

> **Założenie:** format tokenu i endpointu SZO nie był dostępny przy tworzeniu aplikacji, dlatego pola są w pełni konfigurowalne. Przed wdrożeniem dopasuj `SZO_CLAIM_*`, `SZO_ROLE_MAP` i tryb do rzeczywistego SZO.

## Integracja z SZO: klucz API w panelu

Klucz API z SZO wklejasz w **Administracja → Integracja z SZO** (bez edycji `.env` na serwerze). Jest zapisywany w bazie **zaszyfrowany** (AES-256-GCM, klucz pochodny od `SESSION_SECRET`), nigdy nie jest wyświetlany ponownie (panel pokazuje tylko ostatnie 4 znaki, kto i kiedy go zapisał) i ma pierwszeństwo przed `SZO_API_KEY` z `.env`. Przycisk „Zapisz i sprawdź” (oraz „Sprawdź połączenie i uprawnienia”) weryfikuje, czy klucz działa dla importu użytkowników (`audytor:users`) i wysyłki poczty (`audytor:mail`). Usunięcie klucza z panelu przywraca klucz z `.env` (jeśli jest). Zmiana `SESSION_SECRET` unieważnia zapisany klucz: panel to zgłasza i trzeba wkleić go ponownie. Wysyłkę e-mail włącza dopiero `MAIL_MODE=szo` w `.env`.

## Import użytkowników z SZO

W panelu **Użytkownicy → Importuj z SZO** administrator wybiera osoby z SZO i nadaje im role, zamiast czekać na ich pierwsze logowanie. Lista pochodzi z endpointu SZO `api/v1/audytor_users.php` (aktywne konta z uprawnieniem „Tajemniczy Klient”, tylko id, imię i nazwisko, e-mail). Dane osób są zawsze pobierane z SZO przy zapisie, nie z formularza, a konto ma ten sam identyfikator (`szo:<id>`) co przy logowaniu, więc po pierwszym logowaniu osoba trafia na zaimportowane konto. Wymaga klucza API z uprawnieniem `audytor:users` (wklejonego w panelu lub w `SZO_API_KEY`).

## Role i uprawnienia

- **Administrator**: obiekty, kryteria, scenariusze, użytkownicy, przydzielanie audytów; może też zatwierdzać.
- **Audytor / Tajemniczy Klient**: wypełnia tylko swoje audyty (oceny, komentarze, zdjęcia, PDF), składa je do weryfikacji.
- **Koordynator**: przegląda i zatwierdza audyty obiektów, które koordynuje (oraz podległych), widzi raporty; może zwrócić audyt do poprawy z uzasadnieniem.

Cudze audyty zwracają 404, a nie 403, żeby nie ujawniać ich istnienia.

## Scenariusze

Wspólny słownik, który prowadzi wyłącznie administrator (panel **Scenariusze**); scenariusze do audytów i ocen też przypisuje tylko on.

Scenariusz ma: tytuł, **cel**, **personę** (rodzaj niepełnosprawności, w którą wciela się audytor), opis i instrukcję, **numerowane kroki** (jeden w wierszu), oczekiwany rezultat i szacowany czas. Pole „Dotyczy” określa moduł (*Audyty obiektów*, *Dostępność kształcenia* albo *Oba moduły*). „Zakres kryteriów” (OZN / kształcenie / oba) decyduje o kryteriach audytu i nie ma znaczenia dla scenariuszy używanych tylko w ocenach kształcenia.

- **Wersje:** zmiana treści (tytuł, opisy, persona, czas, zakres, kroki) podnosi numer wersji; zmiana samej aktywności nie.
- **Migawki:** przy przypisaniu audyt lub ocena dostaje kopię scenariusza z krokami i numerem wersji. Edycja słownika nie zmienia prowadzonych ani zatwierdzonych audytów; strona audytu pokazuje, że w słowniku jest nowsza wersja.
- **Odhaczanie kroków:** audytor zaznacza wykonane kroki w formularzu audytu lub oceny (zapis razem z odpowiedziami). Stan kroków jest w CSV i PDF audytu. Kroki nie blokują złożenia.
- **Duplikowanie:** „Duplikuj” tworzy nieaktywny szkic w wersji 1 z kopią kroków.
- **Podgląd** (`/scenarios/:id`): pełna treść oraz lista audytów i ocen używających scenariusza, z wersją użytą przy przypisaniu. Lista scenariuszy ma filtry (moduł, aktywność) i liczniki kroków oraz użyć.
- Scenariusza użytego w audycie lub ocenie nie da się usunąć, można go tylko wyłączyć.

## Załączniki

Załączniki (JPEG, PNG, WebP, PDF) można dodawać do każdego kryterium audytu **i do każdego pytania w „Dostępności kształcenia”**. Typ jest sprawdzany także po sygnaturze pliku; pliki leżą poza katalogiem publicznym i są serwowane po autoryzacji. Autor może je usuwać do złożenia, a skasowanie oceny usuwa jej pliki z dysku.

## Historia zmian

Każdy audyt i ocena ma dziennik zdarzeń (kto, kiedy, co): przydział, rozpoczęcie, złożenie, zatwierdzenie, zwrot z uzasadnieniem, zmiana scenariuszy, dodanie i usunięcie załączników. Widać go na stronie audytu lub oceny. Wpisy dla danych sprzed wprowadzenia dziennika uzupełnia migracja na podstawie znaczników czasu.

## Powiadomienia e-mail

Wiadomości są **wyłącznie czystym tekstem** (bez HTML) i dotyczą: przydziału audytu lub oceny, zmiany scenariuszy, złożenia (do koordynatora obiektu, a gdy go brak do administratorów), zatwierdzenia i zwrotu (do audytora) oraz terminów audytu (na `MAIL_REMINDER_DAYS` dni przed, w dniu terminu i po jego przekroczeniu, każde tylko raz).

- Zdarzenia trafiają do **kolejki w bazie**; wysyłka jest osobna. Nieudane próby są ponawiane (do 5 razy, rosnące opóźnienie), a awaria SMTP nie blokuje pracy w aplikacji.
- `MAIL_MODE`: `off` (domyślnie), `szo` (**zalecany**: wysyłka przez SZO i Microsoft Graph), `smtp` (własny serwer), `log` (konsola, do testów ręcznych). Przy włączonych powiadomieniach wymagane jest `APP_URL`.
- **Tryb `szo`:** aplikacja wywołuje `api/v1/audytor_mail.php` w SZO kluczem `SZO_API_KEY` (uprawnienie `audytor:mail`). SZO wysyła wiadomość swoją kolejką poczty jako **czysty tekst** (`contentType: Text`) z nadawcy systemowego i przyjmuje tylko adresatów będących aktywnymi kontami SZO z uprawnieniem „Tajemniczy Klient”, więc klucz nie służy jako dowolny przekaźnik poczty (limit 50 adresatów na żądanie i 200 wiadomości na godzinę). Odrzucenia trwałe (np. adres spoza uprawnionych) kończą próby od razu, awarie przejściowe (sieć, limit, błąd serwera) są ponawiane.
- **Cron:** `npm run notify` (`node scripts/notify.js`) wysyła przypomnienia i opróżnia kolejkę. Na hostingu, który usypia aplikację po braku ruchu, uruchamiaj go co kilka minut. Równoległe procesy nie wysyłają tej samej wiadomości dwa razy.
- `SMS_MODE`: `off` (domyślnie), `szo` (kody SMS wysyła SZO przez `api/v1/audytor_sms.php`, uprawnienie klucza `audytor:sms`), `log` (konsola; tylko rozwój, w produkcji zabronione). Od `szo` zależy logowanie użytkowników zewnętrznych.
- **Użytkownicy zewnętrzni (spoza Panelu Współpracownika):** konto zakłada wyłącznie administrator (Użytkownicy → „Dodaj użytkownika zewnętrznego”: imię i nazwisko, e-mail, telefon). Osoba dostaje e-mail z jednorazowym linkiem (72 h) do ustawienia hasła; logowanie to e-mail + hasło + kod SMS (6 cyfr, 5 minut, 5 prób, ponowienie po minucie, maks. 3 SMS-y na logowanie). Hasła są w bazie jako scrypt, kody i tokeny tylko jako skróty, konto blokuje się na 15 minut po 5 błędnych hasłach, a nieznany adres i złe hasło dają tę samą odpowiedź. Konto zewnętrzne ma wyłącznie rolę Audytora / Tajemniczego Klienta. Drugi sposób: **zaproszenie kodem** (Użytkownicy → „Zaproś użytkownika zewnętrznego kodem”): administrator podaje e-mail i dostaje 7-cyfrowy kod (ważny 7 dni, jednorazowy, widoczny tylko raz, w bazie HMAC, 5 błędnych prób unieważnia zaproszenie); osoba zakłada konto sama na `/register` (kafelek „Mam kod rejestracyjny”), podając kod, e-mail, imię i nazwisko, telefon i hasło. Ten sposób nie wysyła e-maila, więc nie wymaga szablonu w SZO. Dodawanie jest wyłączone, dopóki nie działają SMS i e-mail.
- **Włączanie na serwerze przez SZO:** utwórz w SZO (Zarządzaj API) klucz z uprawnieniami `audytor:mail` i `audytor:users`, w `.env` ustaw `MAIL_MODE=szo` oraz `SZO_API_KEY=…`, zrestartuj stronę (`devil www restart`) i dodaj cron. Wymaga wdrożonego w SZO endpointu `audytor_mail.php`.
- **Włączanie przez własny SMTP:** w `.env` ustaw `MAIL_MODE=smtp`, `MAIL_FROM` (adres nadawcy, z którego skrzynka ma prawo wysyłać) oraz `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` i zrestartuj stronę (`devil www restart`). Test wysyłki: `node -e "process.loadEnvFile('.env');const {loadConfig}=require('./src/config');require('./src/services/mailer').createMailer(loadConfig().mail).send({to:'adres@example.pl',subject:'Test',text:'Test'}).then(()=>console.log('wysłano'),e=>console.log('błąd:',e.message))"`. Najpierw można ustawić `MAIL_MODE=log`, żeby zobaczyć treść wiadomości w logach bez wysyłania.
- Każdy użytkownik może wyłączyć powiadomienia w **Moje konto**. Pomijani są użytkownicy bez adresu e-mail i konta nieaktywne.

## Statystyki

Panel **Statystyki** (administrator i koordynator, w swoim zakresie): ranking obiektów najwyższego poziomu (miejsca ex aequo) oraz trendy kwartalne ze zmianą w punktach procentowych. Wyniki audytów obiektów i „Dostępności kształcenia” są pokazywane obok siebie, nie mieszane. Eksport: `/stats/ranking.csv` i `/stats/trend.csv`.

## Przepływ audytu

`Przypisany` → (pierwszy zapis) `W trakcie` → `Złożony / oczekuje na weryfikację` → `Zatwierdzony`. Koordynator może zwrócić audyt ze statusu „Złożony” do „W trakcie”.

- Do audytu można przypisać **kilka scenariuszy**. Przy przydziale aktywne kryteria z zakresów wszystkich wybranych scenariuszy są **kopiowane do audytu** (migawka, bez powtórzeń); instrukcje scenariuszy widać na stronie audytu. Późniejsza zmiana kryteriów nie zmienia trwających ani zatwierdzonych wyników.
- Złożenie wymaga odpowiedzi na wszystkie kryteria. „Nie dotyczy” wymaga uzasadnienia w komentarzu.
- Załączniki: JPEG, PNG, WebP, PDF (limit `MAX_UPLOAD_MB`). Typ jest sprawdzany także po sygnaturze pliku. Pliki trafiają poza katalog publiczny i są serwowane tylko po autoryzacji.

## Moduł „Dostępność kształcenia”

Audytor wciela się w **kandydata na wybrany kierunek** (uczelnia, kierunek, poziom i tryb studiów, rodzaj niepełnosprawności) i ocenia **biuro ds. osób z niepełnosprawnościami**: znalezienie i kontakt, doradztwo przed rekrutacją, wsparcie na kierunku, dostępność biura i wrażenie ogólne (14 pytań, edytowalnych przez administratora w „Pytania: kształcenie”).

- Przepływ jak w audytach: W trakcie → Złożony → Zatwierdzony (koordynator zatwierdza lub zwraca z uzasadnieniem). Pytania są kopiowane do oceny przy jej rozpoczęciu.
- Ocenę zakłada audytor (dla siebie) albo administrator (przydziela ją wskazanemu audytorowi). **Scenariusze kontaktu** (kilka naraz, opcjonalnie), np. zapytanie e-mailowe, telefon, wizyta, nadaje wyłącznie administrator: przy przydziale lub później na stronie oceny (do zatwierdzenia). Ich opisy są instrukcją dla audytora; scenariusze nie zmieniają zestawu pytań.
- Wyniki są **raportowane osobno** (`/office/report`, CSV): per uczelnia i kierunek, z wynikami według kategorii. Nie wchodzą do raportów zbiorczych audytów ani do punktacji obszaru kształcenia.
- Audytor widzi swoje oceny, koordynator oceny uczelni, które koordynuje, administrator wszystkie.
- Moduł nie ma załączników ani eksportu PDF; przebieg kontaktu opisuje się w polu tekstowym.

## Punktacja

Każda odpowiedź daje ułamek spełnienia: skala 0–3 → wartość/3; tak = 1, częściowo = 0,5, nie = 0; „nie dotyczy” wypada z oceny.

```
wynik obszaru (%) = Σ(waga × ułamek) / Σ(waga ocenionych kryteriów) × 100
```

Progi: ≥ 85% wysoka, ≥ 60% częściowa, ≥ 30% niska, poniżej bardzo niska. Wynik ogólny liczony jest ze wszystkich ocenionych kryteriów obu obszarów łącznie. Logika jest w `src/domain/scoring.js` (czysta, bez bazy) i ma testy.

## Raporty i eksport

- Raport audytu (wstępny, jeśli nie zatwierdzony): PDF i CSV.
- Raport zbiorczy uczelni: wskaźniki OZN vs proces kształcenia z **zatwierdzonych** audytów uczelni i jej wydziałów, kampusów i budynków; PDF i CSV.
- CSV: UTF-8 z BOM i separator `;` (poprawnie otwiera się w Excelu), komórki zabezpieczone przed wstrzyknięciem formuł.
- PDF używa czcionki DejaVu Sans (polskie znaki). Nie jest to PDF znakowany (tagged); pełną dostępność daje widok HTML i CSV.

## Struktura

```
src/
  config.js            konfiguracja z .env (walidacja Zod)
  app.js, server.js    fabryka aplikacji i start
  db/                  połączenie, migracje SQL, seed kryteriów
  domain/              scoring, workflow, stałe (czysta logika)
  middleware/          autoryzacja, role, ochrona przed CSRF
  routes/              definicje tras
  controllers/         obsługa żądań
  services/            SZO, sesje, dostęp do danych, raporty, eksport
  validation/          schematy Zod
  views/, public/      szablony EJS i style
test/                  node:test (punktacja, workflow, SZO, cały przepływ HTTP)
scripts/               seed.js, demo.js
```

## Bezpieczeństwo i dostępność

- Każda trasa poza `/login`, `/auth/*` i `/healthz` wymaga sesji lub tokenu SZO; role sprawdza middleware.
- CSRF: weryfikacja `Origin` / `Sec-Fetch-Site` + `SameSite=Lax`. Nagłówki Helmet, ścisłe CSP (bez inline JS i stylów), `Cache-Control: no-store`.
- Walidacja wejścia w Zod, zapytania SQL tylko parametryzowane.
- Interfejs: semantyczny HTML, link „Przejdź do treści”, etykiety i komunikaty błędów powiązane `aria-describedby`, kontrast tekstu ≥ 4,5:1, widoczny fokus, status zawsze także tekstem.

## Wdrożenie na MyDevil (audytor.feer.org.pl)

Aplikacja działa pod Phusion Passenger (punkt wejścia: `app.js`, ustawienia z pliku `.env`). Wszystkie zależności są czystym JavaScriptem, więc nie ma kompilacji. Testy przechodzą na FreeBSD z Node 22 i 24; strona używa Node 24.

1. **DNS:** rekord `A audytor.feer.org.pl → 212.91.26.67` w strefie `feer.org.pl` (Cloudflare), najlepiej bez proxy („tylko DNS”), żeby MyDevil mógł wystawić certyfikat.
2. **Strona:** `devil www add audytor.feer.org.pl nodejs /usr/local/bin/node24 production`, potem usuń domyślną stronę `rm ~/domains/audytor.feer.org.pl/public_nodejs/public/index.html`.
3. **Konfiguracja:** skopiuj `.env.production.example` jako `~/domains/audytor.feer.org.pl/public_nodejs/.env` (`chmod 600`), wpisz `SESSION_SECRET` i utwórz katalog danych `~/domains/audytor.feer.org.pl/data`. Baza i załączniki leżą poza katalogiem aplikacji i przetrwają wdrożenia.
4. **Kod:** `deploy/deploy-mydevil.sh` (testy lokalne → rsync → `npm ci --omit=dev` → `devil www restart`). Nie nadpisuje `.env`, `data/` ani `node_modules`.
5. **HTTPS:** po propagacji DNS wystaw certyfikat Let's Encrypt dla `audytor.feer.org.pl` (panel DevilWEB lub `devil ssl www`).
6. **Logowanie przez SZO** (tryb `szo`, OAuth + PKCE, jak w `msues.feer.org.pl`) wymaga w SZO jednorazowej zmiany: zastosuj `deploy/szo-patch.diff` (nowy moduł uprawnień `audytor` i scope `audytor:access`), dopisz w Ustawieniach organizacji do `desktop_allowed_redirects` adres `https://audytor.feer.org.pl/auth/szo/callback`, a potem nadaj użytkownikom uprawnienie „Tajemniczy Klient” (odczyt). Pierwszy administrator pochodzi z `ADMIN_EMAILS`; pozostałe role nadaje się w panelu **Użytkownicy**. **Każda nowa osoba logująca się pierwszy raz przez SZO dostaje rolę audytora** (`SZO_DEFAULT_ROLE`, domyślnie `auditor`; administratora nie da się ustawić jako roli domyślnej).
7. **Powiadomienia:** ustaw SMTP w `.env` i `MAIL_MODE=smtp`, a w cronie dodaj `*/5 * * * * cd ~/domains/audytor.feer.org.pl/public_nodejs && node scripts/notify.js >> ~/audytor_notify.log 2>&1`. Aplikacja usypia się po 24 h bez ruchu, więc to cron gwarantuje przypomnienia i ponawianie wysyłki.
8. **Logi:** `~/domains/audytor.feer.org.pl/logs/error.log`.

## Inne wdrożenia

Ustaw `NODE_ENV=production`, `SESSION_SECRET` (≥ 32 znaki), tryb `szo`, `jwt` lub `api`, `TRUST_PROXY=true` za reverse proxy i HTTPS. Kopię zapasową wykonuj dla `DATABASE_PATH` (tryb WAL: razem z plikami `-wal`/`-shm`) i `UPLOAD_DIR`. Aplikacja nie ma ograniczania liczby prób logowania; w razie potrzeby dodaj je na proxy.
