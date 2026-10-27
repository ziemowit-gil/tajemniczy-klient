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
| `npm run db:seed` | uzupełnia pustą bazę kryteriami i scenariuszami (robi to też start serwera) |
| `npm run demo:seed` | dane demonstracyjne (tylko poza produkcją) |
| `npm test` | testy jednostkowe i integracyjne |

Baza SQLite i migracje (`src/db/migrations/*.sql`) tworzą się automatycznie przy starcie.

## Logowanie przez SZO

Aplikacja nie przechowuje haseł. Tożsamość pochodzi z SZO, a po weryfikacji aplikacja wystawia własną, podpisaną sesję (cookie `httpOnly`, `SameSite=Lax`).

| `SZO_AUTH_MODE` | Działanie |
|---|---|
| `jwt` | SZO wystawia JWT. Aplikacja weryfikuje podpis lokalnie: sekret (`SZO_JWT_SECRET`, HS256) albo klucz publiczny (`SZO_JWT_PUBLIC_KEY`, RS/ES), a także `iss`, `aud`, `exp`. |
| `api` | Aplikacja wysyła token do `SZO_VERIFY_URL` (`Authorization: Bearer`, opcjonalnie `X-Api-Key`). Oczekuje JSON z użytkownikiem (płasko lub w polu `user`); `active:false` odrzuca token. |
| `dev` | Logowanie testowe bez SZO. Aplikacja **odmawia startu** z tym trybem przy `NODE_ENV=production`. |

Wejście do aplikacji:

1. **SSO w przeglądarce**: SZO przekierowuje na `/auth/callback?token=<JWT>` (albo wysyła `POST` z polem `token`). Link „Zaloguj przez SZO” prowadzi do `SZO_LOGIN_URL`.
2. **Nagłówek** `Authorization: Bearer <token>`: token jest weryfikowany przy każdym żądaniu (przydatne dla integracji).

Nazwy pól tokenu ustawiasz w `SZO_CLAIM_*`. Role z SZO mapuje `SZO_ROLE_MAP`, np. `{"szo_admin":"administrator"}`. Gdy token niesie kilka ról, wygrywa najwyższa (administrator > koordynator > audytor). Jeśli SZO nie przekazuje roli, obowiązuje rola nadana w panelu **Użytkownicy**, a dla nowych kont `SZO_DEFAULT_ROLE`.

> **Założenie:** format tokenu i endpointu SZO nie był dostępny przy tworzeniu aplikacji, dlatego pola są w pełni konfigurowalne. Przed wdrożeniem dopasuj `SZO_CLAIM_*`, `SZO_ROLE_MAP` i tryb do rzeczywistego SZO.

## Role i uprawnienia

- **Administrator**: obiekty, kryteria, scenariusze, użytkownicy, przydzielanie audytów; może też zatwierdzać.
- **Audytor / Tajemniczy Klient**: wypełnia tylko swoje audyty (oceny, komentarze, zdjęcia, PDF), składa je do weryfikacji.
- **Koordynator**: przegląda i zatwierdza audyty obiektów, które koordynuje (oraz podległych), widzi raporty; może zwrócić audyt do poprawy z uzasadnieniem.

Cudze audyty zwracają 404, a nie 403, żeby nie ujawniać ich istnienia.

## Scenariusze

Wspólny słownik (panel **Scenariusze**). Pole „Dotyczy” określa, gdzie scenariusz można wybrać: *Audyty obiektów*, *Dostępność kształcenia* albo *Oba moduły*. „Zakres kryteriów” (OZN / kształcenie / oba) decyduje o kryteriach audytu i nie ma znaczenia dla scenariuszy używanych tylko w ocenach kształcenia. Scenariusza użytego w audycie lub ocenie nie da się usunąć, można go tylko wyłączyć.

## Przepływ audytu

`Przypisany` → (pierwszy zapis) `W trakcie` → `Złożony / oczekuje na weryfikację` → `Zatwierdzony`. Koordynator może zwrócić audyt ze statusu „Złożony” do „W trakcie”.

- Do audytu można przypisać **kilka scenariuszy**. Przy przydziale aktywne kryteria z zakresów wszystkich wybranych scenariuszy są **kopiowane do audytu** (migawka, bez powtórzeń); instrukcje scenariuszy widać na stronie audytu. Późniejsza zmiana kryteriów nie zmienia trwających ani zatwierdzonych wyników.
- Złożenie wymaga odpowiedzi na wszystkie kryteria. „Nie dotyczy” wymaga uzasadnienia w komentarzu.
- Załączniki: JPEG, PNG, WebP, PDF (limit `MAX_UPLOAD_MB`). Typ jest sprawdzany także po sygnaturze pliku. Pliki trafiają poza katalog publiczny i są serwowane tylko po autoryzacji.

## Moduł „Dostępność kształcenia”

Audytor wciela się w **kandydata na wybrany kierunek** (uczelnia, kierunek, poziom i tryb studiów, rodzaj niepełnosprawności) i ocenia **biuro ds. osób z niepełnosprawnościami**: znalezienie i kontakt, doradztwo przed rekrutacją, wsparcie na kierunku, dostępność biura i wrażenie ogólne (14 pytań, edytowalnych przez administratora w „Pytania: kształcenie”).

- Przepływ jak w audytach: W trakcie → Złożony → Zatwierdzony (koordynator zatwierdza lub zwraca z uzasadnieniem). Pytania są kopiowane do oceny przy jej rozpoczęciu.
- Ocena może mieć **scenariusze kontaktu** (opcjonalnie, kilka naraz), np. zapytanie e-mailowe, telefon, wizyta; ich opisy są instrukcją dla audytora. Scenariusze nie zmieniają zestawu pytań.
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

## Wdrożenie

Ustaw `NODE_ENV=production`, `SESSION_SECRET` (≥ 32 znaki), tryb `jwt` lub `api`, `TRUST_PROXY=true` za reverse proxy i HTTPS. Kopię zapasową wykonuj dla `DATABASE_PATH` (tryb WAL: razem z plikami `-wal`/`-shm`) i `UPLOAD_DIR`. Aplikacja nie ma ograniczania liczby prób logowania; w razie potrzeby dodaj je na proxy.
