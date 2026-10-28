/**
 * Paczki przykładowych scenariuszy do jednorazowego importu przez administratora (panel Scenariusze lub
 * `npm run scenarios:import`). Import jest idempotentny: scenariusz o tym samym tytule jest pomijany, więc
 * usunięte lub zmienione przez administratora scenariusze nie są nadpisywane ani odtwarzane automatycznie.
 *
 * Paczka „uczelnie” przenosi na grunt szkolnictwa wyższego układ scenariuszy testowych stosowany przy ocenie
 * obsługi osób ze szczególnymi potrzebami: informacje na stronie → kontakt i prośba o spotkanie → spotkanie
 * z asystą/tłumaczem → formularz i ankieta → omówienie poprawek. Dla każdej z siedmiu grup potrzeb są dwa warianty:
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
  {
    usage: E, persona: 'psychiczna', estimatedMinutes: 75,
    title: 'Osoba z ADHD: kontakt z uczelnią, jasne instrukcje i spokojne spotkanie',
    description: 'Wciel się w kandydata lub studenta z ADHD (neuroróżnorodność): trudno Ci utrzymać uwagę przy długich, nieuporządkowanych informacjach, łatwo gubisz terminy i męczą Cię bodźce. Nie ujawniaj diagnozy ponad to, co konieczne do uzyskania dostosowań.',
    goal: 'Ocenić, czy uczelnia komunikuje się krótko i konkretnie, pomaga pilnować terminów i oferuje dostosowania dla osób z ADHD.',
    expectedResult: 'Ocena czytelności informacji i formularzy, sposobu przypominania o terminach, warunków spotkania (spokój, tempo, podsumowanie pisemne) oraz dostępnych dostosowań na zajęciach i egzaminach.',
    steps: [
      'Przeczytaj na stronie uczelni informacje o wsparciu i oceń ich przydatność: czy są krótkie, uporządkowane, z listą kroków, terminami i wyróżnionymi najważniejszymi sprawami.',
      'Skontaktuj się z uczelnią (mail, SMS lub formularz) z prośbą o spotkanie i informację, jak zgłosić potrzebę dostosowań. Zanotuj dostępne kanały, czas odpowiedzi i to, czy odpowiedź jest zwięzła i zawiera konkretne kolejne kroki.',
      'Umów spotkanie. Zanotuj, czy zaproponowano przypomnienie o terminie (mail lub SMS), krótsze spotkanie albo możliwość przerwy.',
      'Na spotkaniu oceń warunki: miejsce bez rozpraszaczy, jedna sprawa naraz, spokojne tempo. Poproś o pisemne podsumowanie kroków i terminów. Wypełnij z pracownikiem formularz zgłoszenia potrzeb i ankietę.',
      'Zapytaj o dostosowania typowe dla ADHD: dodatkowy czas i osobne, ciche pomieszczenie na egzaminach, przerwy, elastyczne terminy zadań, materiały podzielone na części oraz wsparcie w planowaniu nauki. Zanotuj odpowiedzi.',
      'Omów, co można poprawić: przypomnienia o terminach, długość i układ informacji, formularze, sposób prowadzenia rozmowy.',
    ],
  },
  {
    usage: E, persona: null, estimatedMinutes: 120,
    title: 'Kandydat zainteresowany kierunkiem: to samo pytanie przy różnych niepełnosprawnościach',
    description: 'Wybierz jeden kierunek i sprawdź, jak uczelnia odpowiada kandydatom z różnymi niepełnosprawnościami. Wykonaj scenariusz co najmniej dwa razy, za każdym razem jako osobną ocenę z tym samym kierunkiem i inną wybraną grupą potrzeb (pole „Wcielam się w osobę z”): np. ruchowa, wzroku, słuchu, poznawcza lub neuroróżnorodność. Nie ujawniaj diagnozy ponad to, co konieczne.',
    goal: 'Ocenić, czy uczelnia rzetelnie, konkretnie i jednakowo życzliwie odpowiada na pytanie „czy mogę studiować ten kierunek” niezależnie od rodzaju niepełnosprawności.',
    expectedResult: 'Porównanie odpowiedzi uczelni dla różnych niepełnosprawności tego samego kierunku (rzetelność, konkretność, przejrzystość wymagań zdrowotnych i dostosowań) oraz lista rekomendacji, w tym czego brakuje w opisie kierunku.',
    steps: [
      'Wybierz kierunek studiów, którym jesteś zainteresowany, i zapisz jego nazwę, poziom i tryb studiów (te dane wpisujesz przy rozpoczęciu oceny).',
      'Przeczytaj na stronie kierunku i uczelni informacje przydatne kandydatowi z niepełnosprawnością: wymagania rekrutacyjne i zdrowotne, opis zajęć praktycznych, laboratoriów, praktyk i egzaminów oraz informacje o dostosowaniach. Oceń, czy da się z nich ustalić, czy kierunek jest dla Ciebie dostępny.',
      'Wciel się w pierwszą wybraną grupę potrzeb i napisz do uczelni (mail, formularz lub SMS) z pytaniem, czy możesz studiować ten kierunek i jakie dostosowania zaproponują w zajęciach praktycznych, laboratoriach, praktykach, wyjazdach i na egzaminach. Zanotuj kanał, czas i treść odpowiedzi.',
      'Powtórz kontakt jako osobna ocena dla drugiej, innej grupy potrzeb (i kolejnych, jeśli to możliwe), zadając to samo pytanie o ten sam kierunek.',
      'Porównaj odpowiedzi: czy uczelnia traktuje wszystkie grupy równie rzetelnie i konkretnie, czy odpowiada ogólnikami, zniechęca, wymaga zbędnych dokumentów albo ujawniania diagnozy.',
      'Zapytaj o rozmowę z osobą z biura wsparcia i z opiekunem kierunku oraz o możliwość kontaktu ze studentem lub absolwentem z podobną niepełnosprawnością (jeśli uczelnia to oferuje).',
      'Zapisz, co można poprawić: informacje o dostępności w opisie kierunku, jednolitość odpowiedzi, szybkość reakcji i konkretność dostosowań.',
    ],
  },
  {
    usage: E, persona: null, estimatedMinutes: 90,
    title: 'Wizyta w Centrum Dostępności uczelni: oferta wsparcia i sprzęt asystujący',
    description: 'Odwiedź Centrum Dostępności (lub biuro ds. osób z niepełnosprawnościami) wybranej uczelni jako kandydat lub student. Wizytę umów wcześniej albo przyjdź w godzinach przyjęć; wciel się w wybraną grupę potrzeb (pole „Wcielam się w osobę z”).',
    goal: 'Ocenić, czy Centrum Dostępności jest łatwe do znalezienia i dostępne, czy oferuje konkretne wsparcie i sprzęt oraz czy procedura zgłoszenia potrzeb jest prosta.',
    expectedResult: 'Ocena informacji o centrum, dojścia i lokalu, wyposażenia (pętla indukcyjna, stanowisko z czytnikiem ekranu, powiększalnik, druk Braille’a), oferty wsparcia, procedury zgłoszenia i taktu pracowników oraz lista rekomendacji.',
    steps: [
      'Sprawdź na stronie uczelni, czy działa Centrum Dostępności lub biuro ds. osób z niepełnosprawnościami: czy łatwo je znaleźć, czy podano adres, godziny przyjęć, kontakt i informację o dostępności lokalu.',
      'Umów wizytę lub przyjdź w godzinach przyjęć. Zanotuj, jak łatwo było się umówić i czy zaproponowano formę dostosowaną do Twoich potrzeb (asysta, tłumacz, cichy pokój).',
      'Oceń dojście do centrum i sam lokal: oznaczenia, wejście, drzwi, winda, toaleta oraz miejsce do rozmowy bez rozpraszaczy.',
      'Sprawdź wyposażenie: pętla indukcyjna, stanowisko z czytnikiem ekranu, powiększalnik, druk powiększony lub Braille’a, sprzęt do wypożyczenia. Zapytaj, czy zespół umie z niego korzystać.',
      'Zapytaj o ofertę wsparcia: asystent, tłumacz PJM, notatki, dostosowanie materiałów i egzaminów, kontakt z wykładowcami, doradztwo zawodowe. Zanotuj konkretne informacje.',
      'Przejdź procedurę zgłoszenia potrzeb: jakie dokumenty są wymagane, ile trwa załatwienie sprawy i czy musisz ujawniać diagnozę. Wypełnij formularz zgłoszenia potrzeb i ankietę oceny.',
      'Omów, co można poprawić w działaniu i wyposażeniu centrum oraz w informacjach o nim.',
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
  {
    usage: A, areas: 'BOTH', persona: 'psychiczna', estimatedMinutes: 45,
    title: 'Bez zapowiedzi: osoba z ADHD w dziekanacie w godzinach największego ruchu',
    description: 'Wizyta „tajemniczego klienta” bez uprzedzenia. Wciel się w osobę z ADHD, która przychodzi do dziekanatu w godzinach największego ruchu i potrzebuje załatwić sprawę wymagającą kilku kroków. Nie ujawniaj diagnozy, dopóki pracownik o nią nie zapyta lub nie będzie to konieczne.',
    goal: 'Sprawdzić, czy obsługa i otoczenie są przyjazne dla osoby, której przeszkadzają bodźce i długie, rozproszone instrukcje.',
    expectedResult: 'Ocena hałasu i rozpraszaczy, czytelności kolejki i oznaczeń, sposobu dzielenia sprawy na kroki, pisemnych podsumowań oraz możliwości przerwy lub spokojniejszego miejsca.',
    steps: [
      'Wejdź w godzinach największego ruchu. Oceń hałas, tłok, czytelność kolejki (numerki, tablica) i oznaczeń oraz to, czy łatwo zorientować się, do kogo podejść.',
      'Poproś o załatwienie sprawy wymagającej kilku kroków (np. zaświadczenie i ustalenie terminu odbioru). Obserwuj, czy pracownik dzieli sprawę na kroki, mówi krótko i sprawdza, czy rozumiesz.',
      'Poproś o spisanie kroków i terminów (kartka, mail lub wiadomość). Zanotuj, czy otrzymujesz pisemne podsumowanie.',
      'Zapytaj, czy możliwa jest chwila przerwy lub rozmowa w spokojniejszym miejscu. Zanotuj odpowiedź.',
      'Zapytaj o przypomnienie o terminie (mail lub SMS) i zanotuj czas obsługi oraz komfort rozmowy.',
    ],
  },
  {
    usage: A, areas: 'BOTH', persona: null, estimatedMinutes: 60,
    title: 'Wizyta w Centrum Dostępności: dojście, lokal i wyposażenie',
    description: 'Wizyta audytora w Centrum Dostępności uczelni (lub biurze ds. osób z niepełnosprawnościami) jako w obiekcie: oceń dostępność samego lokalu i jego wyposażenia. Możesz przyjść bez zapowiedzi jako „tajemniczy klient” albo umówić wizytę.',
    goal: 'Ocenić, czy lokal Centrum Dostępności i jego wyposażenie są dostępne dla osób z różnymi niepełnosprawnościami.',
    expectedResult: 'Opis trasy do lokalu, lista barier architektonicznych i komunikacyjnych oraz ocena wyposażenia asystującego, oznaczeń i zachowania pracownika.',
    steps: [
      'Przejdź trasę od wejścia do budynku do Centrum Dostępności: oznaczenia, tyflomapa lub plan, winda, kontrast i szerokość korytarzy.',
      'Oceń wejście do lokalu: drzwi, progi, szerokość, sposób otwierania, oznaczenie i kontrast.',
      'Oceń przestrzeń wewnątrz: miejsce manewru wózkiem, wysokość stanowiska obsługi, meble, oświetlenie i poziom hałasu.',
      'Sprawdź wyposażenie: oznaczoną i działającą pętlę indukcyjną, stanowisko komputerowe z czytnikiem ekranu i powiększalnikiem.',
      'Zapytaj o informacje w formatach alternatywnych (druk powiększony, Braille, wersja łatwa do czytania, PJM) i sprawdź, czy są dostępne na miejscu.',
      'Sprawdź, czy w pobliżu jest toaleta dostosowana, i zanotuj jej stan.',
      'Zanotuj czas obsługi oraz zachowanie pracownika wobec osoby z niepełnosprawnością.',
    ],
  },
];

const PACKS = {
  uczelnie: {
    label: 'Przykładowe scenariusze dla uczelni',
    description: 'Siedem grup potrzeb (Głusi, niedosłyszący, ruchowe, wzroku, poznawcze, kryzys psychiczny, ADHD), każda w wariancie zaplanowanym (Dostępność kształcenia) i wizyty bez zapowiedzi (audyty obiektów), oraz scenariusze: porównawczy (ten sam kierunek przy różnych niepełnosprawnościach) i wizyta w Centrum Dostępności (zaplanowana i kontrola lokalu).',
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
