/**
 * Domyślny katalog kryteriów i scenariuszy „Tajemniczego Klienta”.
 * Seed jest idempotentny: wstawia dane tylko do pustych tabel, więc nie nadpisuje zmian administratora.
 * Format kryterium: [kod, obszar, kategoria, treść, podpowiedź, waga 1–5, typ oceny, pozycja]
 */
const { transaction } = require('./index');

const OZN = 'OZN';
const EDU = 'KSZTALCENIE';

const CRITERIA = [
  // --- Dostępność dla OZN: architektura ---
  ['OZN-01', OZN, 'Wejścia i komunikacja', 'Główne wejście do budynku jest dostępne bez pokonywania schodów (wejście równe z terenem, pochylnia lub podnośnik).', 'Oceń wejście, z którego korzystają wszyscy; wejście „od zaplecza” to najwyżej 1.', 5, 'scale'],
  ['OZN-02', OZN, 'Wejścia i komunikacja', 'Pochylnie mają bezpieczne nachylenie, obustronne poręcze, antypoślizgową nawierzchnię i krawężniki ochronne.', 'Zmierz lub oszacuj nachylenie; zalecane maks. 5–6%.', 4, 'scale'],
  ['OZN-03', OZN, 'Wejścia i komunikacja', 'Drzwi mają światło przejścia co najmniej 90 cm, nie mają progów i otwierają się bez dużej siły lub automatycznie.', null, 4, 'scale'],
  ['OZN-04', OZN, 'Wejścia i komunikacja', 'Winda jest dostępna: mieści osobę na wózku, ma komunikaty głosowe oraz oznaczenia Braille’a i wypukłe przy przyciskach.', 'Jeśli budynek ma jedną kondygnację, wybierz „nie dotyczy” i uzasadnij.', 5, 'scale'],
  ['OZN-05', OZN, 'Wejścia i komunikacja', 'W budynku jest toaleta dostosowana dla osób z niepełnosprawnościami (miejsce manewru, uchwyty, przycisk alarmowy).', null, 5, 'scale'],
  ['OZN-06', OZN, 'Wejścia i komunikacja', 'Przy budynku są oznaczone miejsca parkingowe dla osób z niepełnosprawnościami, w pobliżu dostępnego wejścia.', null, 3, 'ternary'],
  // --- Orientacja i komunikacja ---
  ['OZN-07', OZN, 'Orientacja i komunikacja', 'Krawędzie stopni, drzwi szklane i przeszkody są oznaczone kontrastowo.', null, 3, 'scale'],
  ['OZN-08', OZN, 'Orientacja i komunikacja', 'Tablice informacyjne i numery sal mają opis w alfabecie Braille’a lub druk powiększony, umieszczone na wysokości dostępnej dla każdego.', null, 3, 'scale'],
  ['OZN-09', OZN, 'Orientacja i komunikacja', 'Dostępne są systemy naprowadzania: ścieżki prowadzące, tyflomapa lub plan budynku w formie dotykowej.', null, 2, 'ternary'],
  ['OZN-10', OZN, 'Orientacja i komunikacja', 'W dziekanacie, biurze obsługi i salach wykładowych działa pętla indukcyjna, a miejsca są oznaczone piktogramem.', 'Sprawdź przełącznikiem „T” w aparacie lub miernikiem, jeśli to możliwe.', 4, 'ternary'],
  ['OZN-11', OZN, 'Orientacja i komunikacja', 'Uczelnia zapewnia tłumacza polskiego języka migowego lub komunikację online z tłumaczem oraz informuje o tym.', null, 3, 'ternary'],
  ['OZN-12', OZN, 'Orientacja i komunikacja', 'Alarm pożarowy ma sygnalizację dźwiękową i wizualną, a plan ewakuacji uwzględnia osoby z niepełnosprawnościami.', null, 4, 'scale'],
  // --- Dostępność cyfrowa ---
  ['OZN-13', OZN, 'Dostępność cyfrowa', 'Strona internetowa uczelni jest zgodna z WCAG 2.1 AA: kontrast, obsługa klawiaturą, teksty alternatywne, czytelne nagłówki.', 'Wykonaj test: nawigacja Tab, powiększenie 200%, czytnik ekranu.', 5, 'scale'],
  ['OZN-14', OZN, 'Dostępność cyfrowa', 'Deklaracja dostępności jest opublikowana, aktualna i zawiera dane kontaktowe do zgłaszania barier.', null, 3, 'ternary'],
  ['OZN-15', OZN, 'Dostępność cyfrowa', 'Platforma e-learningowa jest dostępna: współpracuje z czytnikami ekranu, ma obsługę klawiaturą i napisy do materiałów wideo.', null, 5, 'scale'],
  ['OZN-16', OZN, 'Dostępność cyfrowa', 'Dokumenty i formularze elektroniczne (PDF, Word, formularze online) są dostępne: struktura, tagi, etykiety pól.', null, 3, 'scale'],
  // --- Proces kształcenia: wsparcie ---
  ['KSZ-01', EDU, 'Wsparcie studentów', 'Informacja o wsparciu dla studentów z niepełnosprawnościami jest łatwa do znalezienia (strona, dziekanat) i napisana zrozumiałym językiem.', null, 3, 'scale'],
  ['KSZ-02', EDU, 'Wsparcie studentów', 'Pracownik dziekanatu obsługuje osobę z niepełnosprawnością z uwzględnieniem jej potrzeb i zna procedury wsparcia.', 'Opisz przebieg rozmowy w komentarzu.', 5, 'scale'],
  ['KSZ-03', EDU, 'Wsparcie studentów', 'Istnieje pełnomocnik lub biuro ds. osób z niepełnosprawnościami z jasno opisaną procedurą zgłoszenia potrzeb.', null, 4, 'ternary'],
  ['KSZ-04', EDU, 'Wsparcie studentów', 'Wykładowcy znają zalecone dostosowania i stosują je na zajęciach bez konieczności wielokrotnego tłumaczenia potrzeb.', null, 4, 'scale'],
  // --- Materiały dydaktyczne ---
  ['KSZ-05', EDU, 'Materiały dydaktyczne', 'Materiały dydaktyczne są dostępne w formatach alternatywnych: edytowalny tekst, druk powiększony, Braille, audio.', null, 5, 'scale'],
  ['KSZ-06', EDU, 'Materiały dydaktyczne', 'Nagrania wykładów i materiały wideo mają napisy lub transkrypcję oraz audiodeskrypcję tam, gdzie to potrzebne.', null, 4, 'scale'],
  ['KSZ-07', EDU, 'Materiały dydaktyczne', 'Materiały w formacie alternatywnym są dostarczane na czas, przed zajęciami lub w ustalonym terminie.', null, 3, 'scale'],
  // --- Lektoraty i praktyki ---
  ['KSZ-08', EDU, 'Lektoraty i praktyki', 'Lektoraty językowe mają dostosowania: alternatywne formy zaliczeń, materiały audio/wizualne, zwolnienia z wybranych elementów.', null, 4, 'scale'],
  ['KSZ-09', EDU, 'Lektoraty i praktyki', 'Uczelnia wspiera studenta w znalezieniu dostępnego miejsca praktyk i dostosowaniu jej przebiegu.', null, 3, 'scale'],
  // --- Egzaminy ---
  ['KSZ-10', EDU, 'Egzaminy', 'Obowiązuje procedura dostosowania warunków egzaminów: dodatkowy czas, forma pytań, oddzielne pomieszczenie, sprzęt asystujący.', null, 5, 'scale'],
  ['KSZ-11', EDU, 'Egzaminy', 'Dostosowanie egzaminu jest stosowane sprawnie, bez zbędnych formalności i bez narażania studenta na ujawnianie diagnozy.', null, 3, 'ternary'],
  ['KSZ-12', EDU, 'Egzaminy', 'Na zajęciach i egzaminach możliwa jest pomoc asystenta lub tłumacza języka migowego.', null, 3, 'ternary'],
];

const SCENARIOS = [
  ['Pełna ocena dostępności obiektu', 'Kompleksowa wizyta: dotarcie do budynku, poruszanie się, kontakt z dziekanatem, sprawdzenie strony i platformy e-learningowej oraz procedur wsparcia.', 'BOTH'],
  ['Kandydat na studia z niepełnosprawnością ruchową', 'Wejdź do budynku jako osoba poruszająca się na wózku: dojazd, wejście, winda, toaleta, dziekanat. Zwróć uwagę na dostępność i postawę pracowników.', 'OZN'],
  ['Student niewidomy lub słabowidzący', 'Sprawdź orientację w budynku, oznaczenia dotykowe i kontrastowe, dostępność materiałów, strony i platformy z czytnikiem ekranu oraz warunki egzaminów.', 'BOTH'],
  ['Student niesłyszący lub słabosłyszący', 'Sprawdź komunikację w dziekanacie (pętla indukcyjna, PJM, pisemne ustalenia), napisy w materiałach wideo i sposób dostosowania zajęć.', 'BOTH'],
  ['Proces kształcenia: wsparcie i egzaminy', 'Zgłoś potrzeby studenta, przejdź procedurę dostosowań: materiały, lektoraty, praktyki i warunki egzaminów.', 'KSZTALCENIE'],
];

const OFFICE_QUESTIONS = [
  // [kod, kategoria, treść, podpowiedź, waga, typ]
  ['BOZN-01', 'Znalezienie i kontakt', 'Biuro ds. osób z niepełnosprawnościami (lub pełnomocnika) łatwo znaleźć na stronie uczelni i przy opisie kierunku.', 'Zanotuj, ile kliknięć zajęło dotarcie do danych kontaktowych.', 4, 'scale'],
  ['BOZN-02', 'Znalezienie i kontakt', 'Dostępne są różne kanały kontaktu dostosowane do niepełnosprawności: e-mail, telefon, SMS, formularz, czat, tłumacz PJM online.', null, 4, 'scale'],
  ['BOZN-03', 'Znalezienie i kontakt', 'Biuro odpowiedziało na zapytanie w rozsądnym czasie (do 3 dni roboczych) i konkretnie.', 'Wpisz w uwagach datę wysłania i datę odpowiedzi.', 4, 'scale'],
  ['BOZN-04', 'Doradztwo przed rekrutacją', 'Pracownik biura zna ofertę wybranego kierunku i potrafi doradzić, czy da się go realizować przy danej niepełnosprawności.', null, 5, 'scale'],
  ['BOZN-05', 'Doradztwo przed rekrutacją', 'Biuro przekazało informacje o dostosowaniu rekrutacji i egzaminów wstępnych.', null, 4, 'scale'],
  ['BOZN-06', 'Doradztwo przed rekrutacją', 'Procedura zgłoszenia potrzeb jest jasna i nie wymaga zbędnych dokumentów ani wielokrotnego tłumaczenia sytuacji.', null, 4, 'scale'],
  ['BOZN-07', 'Doradztwo przed rekrutacją', 'Biuro szanuje prywatność: nie wymusza ujawniania diagnozy ponad to, co niezbędne do dostosowań.', null, 3, 'ternary'],
  ['BOZN-08', 'Wsparcie na kierunku', 'Biuro zaproponowało konkretne dostosowania dla wybranego kierunku (zajęcia, laboratoria, praktyki, egzaminy).', null, 5, 'scale'],
  ['BOZN-09', 'Wsparcie na kierunku', 'Biuro koordynuje kontakt z dziekanatem i prowadzącymi kierunek, a student nie musi załatwiać wszystkiego sam.', null, 4, 'scale'],
  ['BOZN-10', 'Wsparcie na kierunku', 'Dostępne jest wsparcie asystenta, tłumacza lub sprzętu i oprogramowania asystującego.', null, 3, 'ternary'],
  ['BOZN-11', 'Dostępność biura', 'Biuro jest dostępne architektonicznie (dojście, wejście, winda) i cyfrowo (strona, formularze).', null, 4, 'scale'],
  ['BOZN-12', 'Dostępność biura', 'Można umówić spotkanie w dogodnej formie: stacjonarnie lub zdalnie.', null, 3, 'ternary'],
  ['BOZN-13', 'Wrażenie ogólne', 'Kontakt z biurem sprawił, że czułbym się/czułabym się mile widziany(-a) i bezpieczny(-a) jako kandydat.', null, 3, 'scale'],
  ['BOZN-14', 'Wrażenie ogólne', 'Poleciłbym/poleciłabym ten kierunek na tej uczelni osobie z taką niepełnosprawnością.', null, 3, 'scale'],
];

function seedCatalog(db) {
  transaction(db, () => {
    if (db.prepare('SELECT COUNT(*) AS n FROM criteria').get().n === 0) {
      const insert = db.prepare(`INSERT INTO criteria (code, area, category, text, hint, weight, answer_type, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      CRITERIA.forEach(([code, area, category, text, hint, weight, type], i) => insert.run(code, area, category, text, hint, weight, type, (i + 1) * 10));
    }
    if (db.prepare('SELECT COUNT(*) AS n FROM office_questions').get().n === 0) {
      const insert = db.prepare(`INSERT INTO office_questions (code, category, text, hint, weight, answer_type, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      OFFICE_QUESTIONS.forEach(([code, category, text, hint, weight, type], i) => insert.run(code, category, text, hint, weight, type, (i + 1) * 10));
    }
    if (db.prepare('SELECT COUNT(*) AS n FROM scenarios').get().n === 0) {
      const insert = db.prepare('INSERT INTO scenarios (title, description, areas) VALUES (?, ?, ?)');
      for (const s of SCENARIOS) insert.run(...s);
    }
  });
}

module.exports = { seedCatalog, CRITERIA, SCENARIOS, OFFICE_QUESTIONS };
