/**
 * Paczki przykładowych scenariuszy do jednorazowego importu przez administratora (panel Scenariusze lub
 * `npm run scenarios:import`). Import jest idempotentny: scenariusz o tym samym tytule jest pomijany, więc
 * usunięte lub zmienione przez administratora scenariusze nie są nadpisywane ani odtwarzane automatycznie.
 *
 * Paczka „uczelnie” przenosi na grunt szkolnictwa wyższego układ scenariuszy testowych stosowany przy ocenie
 * obsługi osób ze szczególnymi potrzebami: informacje na stronie → kontakt i prośba o spotkanie → spotkanie
 * z asystą/tłumaczem → formularz i ankieta → omówienie poprawek. Dla każdej grupy potrzeb są dwa warianty:
 *   • scenariusz zaplanowany (moduł „Dostępność kształcenia”: audytor jako kandydat lub student),
 *   • wizyta „tajemniczego klienta” bez zapowiedzi (audyty obiektów).
 */

const E = 'education';
const A = 'audit';

const UCZELNIE = [
  /* ------------------------- scenariusze zaplanowane (Dostępność kształcenia) ------------------------- */
  {
    usage: E, persona: 'sluchu', estimatedMinutes: 90,
    title: 'Osoba Głucha: kontakt z uczelnią i wideorozmowa z tłumaczem PJM',
    description: 'Wciel się w kandydata lub studenta Głuchego, dla którego polski język migowy jest językiem pierwszym. Nie dzwoń: korzystaj wyłącznie z kanałów pisemnych i wideo.',
    goal: 'Ocenić, czy osoba Głucha samodzielnie znajdzie informacje, umówi spotkanie i załatwi sprawę z udziałem tłumacza PJM.',
    expectedResult: 'Ocena informacji na stronie, dostępnych kanałów kontaktu bez telefonu, czasu odpowiedzi, jakości tłumaczenia PJM i zachowania pracownika oraz lista rekomendacji.',
    steps: [
      'Przeczytaj na stronie uczelni informacje o wsparciu osób z niepełnosprawnościami i oceń ich przydatność (język prosty, wersja w PJM, napisy, dane kontaktowe bez numeru telefonu).',
      'Napisz maila, wyślij SMS albo wypełnij formularz kontaktowy z prośbą o spotkanie i wideorozmowę z tłumaczem PJM. Zanotuj, jakie kanały były dostępne.',
      'Zanotuj czas i treść odpowiedzi. Umów termin spotkania z osobą z biura wsparcia lub koordynatorem dostępności.',
      'Na spotkaniu, z pomocą tłumacza PJM (na miejscu lub online), wypełnij formularz zgłoszenia potrzeb albo inny wskazany dokument oraz ankietę oceny.',
      'Omów z pracownikiem, co można jeszcze poprawić: tłumacz, napisy, informacje, sposób umawiania spotkań.',
    ],
  },
  {
    usage: E, persona: 'sluchu', estimatedMinutes: 75,
    title: 'Osoba niedosłysząca (z aparatem): spotkanie w ciszy lub z pętlą indukcyjną',
    description: 'Wciel się w kandydata lub studenta z niedosłuchem, który korzysta z aparatu słuchowego i potrzebuje dobrych warunków akustycznych.',
    goal: 'Ocenić, czy uczelnia zapewnia warunki rozmowy dostosowane do osoby niedosłyszącej oraz czy pracownik wie, jak z nią rozmawiać.',
    expectedResult: 'Ocena informacji o pętli indukcyjnej i cichych pomieszczeniach, warunków spotkania i zachowania pracownika oraz lista braków.',
    steps: [
      'Przeczytaj na stronie uczelni informacje o wsparciu i oceń ich przydatność (czy wspominają o pętlach indukcyjnych, cichych pokojach, kontakcie pisemnym).',
      'Napisz maila, wyślij SMS albo wypełnij formularz z prośbą o spotkanie w wyciszonym pomieszczeniu lub z użyciem pętli indukcyjnej.',
      'Umów spotkanie. Zanotuj, czy pracownik zapytał o preferowany sposób komunikacji.',
      'Na spotkaniu sprawdź warunki akustyczne i działanie pętli (przełącznik „T” w aparacie). Wypełnij z pracownikiem formularz zgłoszenia potrzeb i ankietę; w razie potrzeby poproś o wideotłumacza lub zapis pisemny.',
      'Omów, co można poprawić: pętla w salach i dziekanacie, sposób mówienia, napisy w materiałach.',
    ],
  },
  {
    usage: E, persona: 'ruchowa', estimatedMinutes: 90,
    title: 'Osoba z potrzebami ruchowymi: spotkanie z asystą od drzwi',
    description: 'Wciel się w kandydata lub studenta poruszającego się na wózku albo z ograniczoną mobilnością, który prosi o asystę od wejścia do budynku.',
    goal: 'Ocenić, czy uczelnia zapewnia dostępną drogę do biura wsparcia i czy asysta jest zorganizowana i życzliwa.',
    expectedResult: 'Opis trasy od wejścia, ocena asysty, wyposażenia i stanowiska komputerowego oraz lista brakującego sprzętu i wyposażenia.',
    steps: [
      'Przeczytaj na stronie uczelni informacje o dostępności budynków i wsparciu oraz oceń ich przydatność (opis wejść, wind, parkingu, kontakt do osoby odpowiedzialnej).',
      'Skontaktuj się z uczelnią z prośbą o spotkanie i asystę od drzwi budynku lub od przystanku.',
      'Umów termin z pracownikiem biura wsparcia. Zanotuj, czy uzgodniono miejsce i godzinę spotkania z asystą.',
      'Na spotkaniu przejdź trasę od wejścia do biura. Wypełnij z pracownikiem formularz zgłoszenia potrzeb i ankietę oceny.',
      'Sprawdź wyposażenie: stanowisko komputerowe lub salę (wysokość biurka, miejsce manewru), dostęp do strony uczelni.',
      'Omów, jakiego sprzętu i wyposażenia brakuje oraz co można poprawić.',
    ],
  },
  {
    usage: E, persona: 'wzroku', estimatedMinutes: 90,
    title: 'Osoba z potrzebami wzroku: asysta od przystanku i stanowisko z czytnikiem ekranu',
    description: 'Wciel się w kandydata lub studenta niewidomego lub słabowidzącego, który korzysta z czytnika ekranu (np. NVDA) i prosi o asystę od wybranego przystanku.',
    goal: 'Ocenić, czy osoba z niepełnosprawnością wzroku samodzielnie skorzysta ze strony i dojdzie na spotkanie oraz jak działa asysta.',
    expectedResult: 'Ocena dostępności strony i dokumentów z czytnikiem ekranu, organizacji asysty od przystanku i stanowiska komputerowego oraz lista rekomendacji.',
    steps: [
      'Przejrzyj informacje na stronie uczelni z czytnikiem ekranu (NVDA) i klawiaturą. Oceń ich przydatność i dostępność (nagłówki, formularze, dokumenty PDF).',
      'Skontaktuj się z uczelnią z prośbą o spotkanie i asystę od wskazanego przystanku. Zanotuj dostępne kanały kontaktu.',
      'Umów spotkanie. Zanotuj, czy uzgodniono sposób rozpoznania się z asystentem i trasę.',
      'Na spotkaniu oceń orientację w budynku (oznaczenia, tyflomapa, pomoc asystenta). Wypełnij z pracownikiem formularz zgłoszenia potrzeb i ankietę.',
      'Jeśli to możliwe, sprawdź stanowisko komputerowe z NVDA oraz dostępność materiałów w alternatywnych formatach.',
      'Omów, co można poprawić.',
    ],
  },
  {
    usage: E, persona: 'inna', estimatedMinutes: 75,
    title: 'Osoba z potrzebami poznawczymi: informacja prostym językiem i spokojne spotkanie',
    description: 'Wciel się w kandydata lub studenta, któremu trudności poznawcze lub neuroatypowość utrudniają rozumienie złożonych informacji, szybkie tempo rozmowy i dużą ilość bodźców.',
    goal: 'Ocenić, czy uczelnia tłumaczy zrozumiale, czym zajmuje się biuro wsparcia, i czy spotkanie odbywa się w spokojnym tempie.',
    expectedResult: 'Ocena zrozumiałości informacji (język prosty, wersja łatwa do czytania), tempa i sposobu prowadzenia spotkania oraz lista rekomendacji.',
    steps: [
      'Przeczytaj na stronie uczelni informacje o wsparciu i oceń ich przydatność: czy są zrozumiałe, krótkie i uporządkowane, czy istnieje wersja łatwa do czytania.',
      'Skontaktuj się z uczelnią z prośbą o spotkanie i krótkie wyjaśnienie, czym zajmuje się biuro wsparcia i jak przebiega rekrutacja.',
      'Umów spotkanie. Zanotuj, czy pracownik zaproponował spokojne miejsce, podział informacji na części lub pisemne podsumowanie.',
      'Na spotkaniu wysłuchaj opisu działań uczelni i z pomocą pracownika wypełnij formularz zgłoszenia potrzeb oraz ankietę. Oceń tempo, język i cierpliwość.',
      'Omów, co można poprawić i jakich materiałów lub rozwiązań brakuje.',
    ],
  },
  {
    usage: E, persona: 'psychiczna', estimatedMinutes: 60,
    title: 'Osoba w kryzysie psychicznym lub psychologicznym: kontakt z uczelnianym wsparciem',
    description: 'Wciel się w osobę w trudnej sytuacji psychicznej, która szuka wsparcia na uczelni. Opisuj sytuację ogólnie, bez odgrywania realnego kryzysu i bez narażania pracowników na stres; za zgodą uczelni uprzedź koordynatora o scenariuszu.',
    goal: 'Ocenić, czy uczelnia jasno informuje o dostępnej pomocy psychologicznej i czy pracownik potrafi życzliwie skierować osobę do właściwego wsparcia.',
    expectedResult: 'Ocena informacji o pomocy psychologicznej i doradztwie, szybkości umówienia wizyty, taktu pracownika oraz lista rekomendacji.',
    steps: [
      'Przeczytaj na stronie uczelni informacje o wsparciu psychologicznym i doradczym. Oceń ich przydatność: czy łatwo je znaleźć, czy podają kontakt i godziny, czy wskazują pomoc w nagłych sytuacjach.',
      'Skontaktuj się z uczelnią z prośbą o spotkanie z doradcą lub psychologiem albo o informację, czym zajmuje się biuro wsparcia.',
      'Zanotuj czas odpowiedzi i sposób zwracania się pracownika. Umów wizytę lub poproś o wskazanie właściwej jednostki.',
      'Na spotkaniu oceń, czy pracownik przekazał jasną informację o działaniu uczelni i umówił wizytę u doradcy. Wypełnij formularz zgłoszenia potrzeb i ankietę.',
      'Omów, co można poprawić: dostępność terminów, informacje w nagłych sytuacjach, poufność.',
    ],
  },

  /* ------------------------- wizyty bez zapowiedzi (audyty obiektów) ------------------------- */
  {
    usage: A, areas: 'BOTH', persona: 'sluchu', estimatedMinutes: 45,
    title: 'Bez zapowiedzi: osoba Głucha w dziekanacie',
    description: 'Wizyta „tajemniczego klienta” bez uprzedzenia. Wciel się w osobę Głuchą, która przychodzi do dziekanatu lub biura obsługi studentów i nie rozmawia głosowo.',
    goal: 'Sprawdzić, czy pracownicy są przygotowani do obsługi osoby Głuchej bez wcześniejszego umówienia.',
    expectedResult: 'Ocena komunikacji pisemnej, dostępu do wideotłumacza PJM na żądanie, informacji w punkcie obsługi oraz zachowania pracownika.',
    steps: [
      'Wejdź do dziekanatu lub biura obsługi bez zapowiedzi i przekaż na piśmie lub w telefonie, że jesteś osobą Głuchą i potrzebujesz pomocy.',
      'Obserwuj reakcję: czy pracownik komunikuje się pisemnie, wolno i twarzą do Ciebie, czy nie wymusza rozmowy głosem.',
      'Zapytaj, czy możliwa jest wideorozmowa z tłumaczem PJM lub umówienie spotkania z tłumaczem. Zanotuj odpowiedź.',
      'Spróbuj załatwić prostą sprawę (np. uzyskać informację o terminie lub dokumentach) i zanotuj czas oraz trudności.',
      'Sprawdź, czy w punkcie obsługi są informacje o możliwościach kontaktu dla osób Głuchych.',
    ],
  },
  {
    usage: A, areas: 'BOTH', persona: 'sluchu', estimatedMinutes: 45,
    title: 'Bez zapowiedzi: osoba niedosłysząca w dziekanacie',
    description: 'Wizyta „tajemniczego klienta” bez uprzedzenia. Wciel się w osobę niedosłyszącą z aparatem, która przychodzi do dziekanatu w godzinach największego ruchu.',
    goal: 'Sprawdzić, czy obsługa i otoczenie umożliwiają rozmowę osobie niedosłyszącej.',
    expectedResult: 'Ocena pętli indukcyjnej, hałasu i możliwości przejścia do cichego pomieszczenia oraz zachowania pracownika.',
    steps: [
      'Podejdź do okienka lub biurka i poinformuj, że słabo słyszysz.',
      'Sprawdź, czy w punkcie obsługi jest oznaczona i działająca pętla indukcyjna (przełącznik „T” w aparacie).',
      'Oceń poziom hałasu i zapytaj, czy możliwa jest rozmowa w cichszym pomieszczeniu.',
      'Obserwuj, czy pracownik mówi wyraźnie i twarzą do Ciebie, powtarza informacje i oferuje zapis pisemny.',
      'Załatw prostą sprawę i zanotuj czas oraz utrudnienia.',
    ],
  },
  {
    usage: A, areas: 'BOTH', persona: 'ruchowa', estimatedMinutes: 60,
    title: 'Bez zapowiedzi: osoba poruszająca się na wózku od drzwi do dziekanatu',
    description: 'Wizyta „tajemniczego klienta” bez uprzedzenia. Wciel się w osobę na wózku, która pierwszy raz przychodzi na uczelnię i prosi o pomoc od wejścia.',
    goal: 'Sprawdzić, czy osoba na wózku samodzielnie lub z pomocą dotrze do dziekanatu i załatwi sprawę bez wcześniejszego uprzedzenia.',
    expectedResult: 'Opis trasy od parkingu lub przystanku do dziekanatu, lista barier architektonicznych i ocena pomocy pracowników.',
    steps: [
      'Dotrzyj pod budynek. Oceń miejsce parkingowe, dojście i oznaczenie wejścia dostępnego.',
      'Wejdź głównym wejściem. Jeśli jest niedostępne, zanotuj, jak wskazano drogę i czy ktoś zaoferował pomoc.',
      'Dojedź windą do dziekanatu. Sprawdź szerokość drzwi, progi i oznaczenia.',
      'Oceń wysokość lady, miejsce manewru oraz zachowanie pracownika (czy zwraca się bezpośrednio do Ciebie).',
      'Skorzystaj z toalety dostosowanej i zanotuj jej stan.',
    ],
  },
  {
    usage: A, areas: 'BOTH', persona: 'wzroku', estimatedMinutes: 60,
    title: 'Bez zapowiedzi: osoba niewidoma lub słabowidząca od przystanku do biura',
    description: 'Wizyta „tajemniczego klienta” bez uprzedzenia. Wciel się w osobę niewidomą lub słabowidzącą (z białą laską), która szuka biura wsparcia lub dziekanatu.',
    goal: 'Sprawdzić, czy osoba z niepełnosprawnością wzroku odnajdzie drogę i uzyska pomoc na miejscu.',
    expectedResult: 'Ocena oznaczeń (kontrast, Braille, tyflomapa), pomocy pracowników i dostępności dokumentów oraz lista barier orientacyjnych.',
    steps: [
      'Dotrzyj od przystanku do budynku. Oceń oznaczenie wejścia, ścieżki prowadzące i bezpieczeństwo trasy.',
      'W recepcji lub przy wejściu poproś o wskazanie drogi do dziekanatu. Zanotuj, czy ktoś zaoferował asystę.',
      'Oceń oznaczenia w budynku: kontrast, druk powiększony, Braille, oznaczenia dotykowe na schodach i w windzie.',
      'W dziekanacie poproś o informację o formatach materiałów dla osób niewidomych i o dostęp do dokumentów w formie elektronicznej.',
      'Zanotuj sposób, w jaki pracownik prowadzi, opisuje otoczenie i kończy rozmowę.',
    ],
  },
  {
    usage: A, areas: 'BOTH', persona: 'inna', estimatedMinutes: 45,
    title: 'Bez zapowiedzi: osoba z potrzebami poznawczymi w biurze obsługi studentów',
    description: 'Wizyta „tajemniczego klienta” bez uprzedzenia. Wciel się w osobę, której trudności poznawcze utrudniają rozumienie dużej ilości informacji i szybkiego tempa rozmowy.',
    goal: 'Sprawdzić, czy pracownik potrafi wyjaśnić sprawę prostym językiem, w spokojnym tempie i z pomocą pisemnych podsumowań.',
    expectedResult: 'Ocena zrozumiałości wyjaśnień, tempa, cierpliwości pracownika oraz czytelności oznaczeń i formularzy.',
    steps: [
      'Poproś o wyjaśnienie, czym zajmuje się biuro i jak załatwić prostą sprawę (np. uzyskać zaświadczenie).',
      'Obserwuj język pracownika: czy unika żargonu, mówi krótko i sprawdza, czy rozumiesz.',
      'Poproś o powtórzenie i o pisemną instrukcję krok po kroku. Zanotuj odpowiedź.',
      'Oceń czytelność oznaczeń w biurze i formularzy (proste słowa, duża czcionka, piktogramy).',
      'Zanotuj, czy zaproponowano spokojniejsze miejsce lub więcej czasu.',
    ],
  },
  {
    usage: A, areas: 'BOTH', persona: 'psychiczna', estimatedMinutes: 45,
    title: 'Bez zapowiedzi: osoba w trudnej sytuacji psychicznej szukająca wsparcia na uczelni',
    description: 'Wizyta „tajemniczego klienta” bez uprzedzenia. Wciel się w osobę, która jest w trudnej sytuacji i pyta, gdzie na uczelni może uzyskać pomoc. Opisuj sytuację ogólnie, bez odgrywania realnego kryzysu; za zgodą uczelni uprzedź koordynatora o scenariuszu.',
    goal: 'Sprawdzić, czy pracownik obsługi potrafi życzliwie skierować osobę do właściwego wsparcia psychologicznego.',
    expectedResult: 'Ocena wiedzy pracownika o wsparciu, taktu i poufności, jasności informacji o pomocy oraz lista rekomendacji.',
    steps: [
      'W biurze obsługi lub dziekanacie powiedz ogólnie, że jesteś w trudnej sytuacji i szukasz wsparcia.',
      'Obserwuj reakcję: czy pracownik słucha, nie ocenia i zachowuje poufność rozmowy.',
      'Zapytaj, dokąd możesz zgłosić się po pomoc (psycholog, doradca, centrum wsparcia) i jak umówić wizytę. Zanotuj podane informacje.',
      'Sprawdź, czy otrzymujesz dane kontaktowe lub pisemną informację oraz wskazówki, co robić w nagłej sytuacji.',
      'Zanotuj, czy pracownik zaproponował umówienie wizyty od razu.',
    ],
  },
];

const PACKS = {
  uczelnie: {
    label: 'Przykładowe scenariusze dla uczelni',
    description: 'Sześć grup potrzeb (Głusi, niedosłyszący, ruchowe, wzroku, poznawcze, kryzys psychiczny), każda w wariancie zaplanowanym (Dostępność kształcenia) i wizyty bez zapowiedzi (audyty obiektów).',
    scenarios: UCZELNIE,
  },
};

/**
 * Importuje paczkę. Zwraca { added: [tytuły], skipped: [tytuły] }; scenariusze o istniejącym tytule są pomijane.
 */
function importPack(db, key) {
  const pack = PACKS[key];
  if (!pack) throw new Error(`Nieznana paczka scenariuszy: ${key}`);
  const exists = db.prepare('SELECT 1 FROM scenarios WHERE title = ? COLLATE NOCASE');
  const insert = db.prepare(`INSERT INTO scenarios (title, description, areas, usage, goal, persona, expected_result, estimated_minutes, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  const step = db.prepare('INSERT INTO scenario_steps (scenario_id, position, text) VALUES (?, ?, ?)');
  const added = [];
  const skipped = [];

  db.exec('BEGIN');
  try {
    for (const sc of pack.scenarios) {
      if (exists.get(sc.title)) { skipped.push(sc.title); continue; }
      const info = insert.run(sc.title, sc.description, sc.areas || 'KSZTALCENIE', sc.usage, sc.goal, sc.persona, sc.expectedResult, sc.estimatedMinutes);
      sc.steps.forEach((text, i) => step.run(info.lastInsertRowid, i + 1, text));
      added.push(sc.title);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { added, skipped };
}

module.exports = { PACKS, importPack };
