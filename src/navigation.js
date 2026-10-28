/** Struktura menu zależna od roli: używana przez przycisk „Menu” w nagłówku i kafelki na pulpicie. */
function menuFor(role) {
  const work = [
    { href: '/', label: 'Pulpit', icon: 'home', desc: 'Co wymaga Twojej uwagi' },
    { href: '/audits', label: role === 'auditor' ? 'Moje audyty' : 'Audyty', icon: 'audits', desc: role === 'auditor' ? 'Audyty i oceny przydzielone Tobie' : 'Wszystkie audyty i oceny' },
    { href: '/office', label: 'Dostępność kształcenia', icon: 'education', desc: 'Oceny biur ds. osób z niepełnosprawnościami' },
  ];
  const manage = role === 'administrator' || role === 'coordinator' ? [
    { href: '/objects', label: 'Obiekty', icon: 'objects', desc: 'Obiekty i uczelnie' },
    { href: '/reports', label: 'Raporty', icon: 'reports', desc: 'Raporty z audytów' },
    { href: '/stats', label: 'Statystyki', icon: 'stats', desc: 'Podsumowania i wskaźniki' },
    { href: '/archive', label: 'Archiwum', icon: 'archive', desc: 'Zarchiwizowane audyty i oceny' },
  ] : [];
  const admin = role === 'administrator' ? [
    { href: '/criteria', label: 'Kryteria audytu', icon: 'criteria', desc: 'Kryteria i wagi' },
    { href: '/scenarios', label: 'Scenariusze', icon: 'scenarios', desc: 'Scenariusze i kroki' },
    { href: '/office/questions', label: 'Pytania: kształcenie', icon: 'questions', desc: 'Ankieta dostępności kształcenia' },
    { href: '/users', label: 'Użytkownicy', icon: 'users', desc: 'Konta, role i zaproszenia' },
    { href: '/log', label: 'Dziennik operacji', icon: 'log', desc: 'Archiwizacje i usunięcia' },
    { href: '/settings/szo', label: 'Integracja z SZO', icon: 'integration', desc: 'Klucz API, poczta i SMS' },
  ] : [];
  return [
    { id: 'work', title: 'Praca', links: work },
    ...(manage.length ? [{ id: 'manage', title: 'Zarządzanie', links: manage }] : []),
    ...(admin.length ? [{ id: 'admin', title: 'Administracja', links: admin }] : []),
  ];
}

/** Adres pozycji menu pasujący do bieżącej ścieżki (najdłuższy pasujący prefiks). */
function currentHref(groups, currentPath) {
  const all = groups.flatMap((g) => g.links.map((l) => l.href));
  return all.filter((h) => (h === '/' ? currentPath === '/' : currentPath === h || currentPath.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0] || null;
}

module.exports = { menuFor, currentHref };
