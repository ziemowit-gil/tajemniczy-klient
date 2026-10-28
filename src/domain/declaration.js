/**
 * Treść oświadczenia o poufności składanego elektronicznie przy logowaniu do aplikacji.
 * Skrót SHA-256 treści identyfikuje wersję: zmiana jakiegokolwiek znaku wymaga ponownego złożenia oświadczenia.
 */
const crypto = require('node:crypto');

const DECLARATION_TITLE = 'Oświadczenie składane elektronicznie';

const DECLARATION_PARAGRAPHS = [
  'Ja, niżej podpisany/a, jako osoba logująca się do aplikacji „Tajemniczy Klient”, oświadczam, że aplikacja jest aplikacją wewnętrzną Fundacji Edukacji Empatii Rozwoju „FEER” i służy do przeprowadzania audytów dostępnościowych uczelni w ramach działalności statutowej Fundacji.',
  'Zobowiązuję się zachować w tajemnicy dane i informacje niepubliczne, w tym dane osobowe, do których uzyskam dostęp za pośrednictwem aplikacji lub w związku z przeprowadzaniem audytów dostępnościowych, oraz nie udostępniać ich osobom nieupoważnionym. Zobowiązuję się wykorzystywać je wyłącznie w zakresie niezbędnym do realizacji wskazanych celów, z uwzględnieniem obowiązujących przepisów prawa.',
  'Oświadczenie składam elektronicznie za pośrednictwem aplikacji.',
];

const DECLARATION_TEXT = [DECLARATION_TITLE.toUpperCase(), ...DECLARATION_PARAGRAPHS].join('\n\n');
const DECLARATION_HASH = crypto.createHash('sha256').update(DECLARATION_TEXT).digest('hex');

module.exports = { DECLARATION_TITLE, DECLARATION_PARAGRAPHS, DECLARATION_TEXT, DECLARATION_HASH };
