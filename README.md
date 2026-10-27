# Driftskalender

Fælles kalender og opgaveoverblik for driftsgruppen: hvem kan bidrage i driften hvilke dage (som Gulvvagt eller På kald), og hvilke opgaver ligger hos hvem.

## Sådan hænger det sammen

- **Siden** (denne mappe) er ren HTML, CSS og JavaScript uden byggetrin. Den ligger på GitHub Pages.
- **Data og login** ligger i Supabase-projektet `performance-board`, i et eget schema (`driftskalender`), som ikke er eksponeret via Supabase's API og ikke deler tabeller med KPI-projektet.
- **Edge function** `driftskalender` er den eneste vej ind til data. Den videresender kald til databasefunktionen `driftskalender.api()`, hvor al logik og adgangskontrol ligger.
- **Login** er et eget invitationsbaseret system (ikke Supabase Auth): administratoren inviterer via e-mail, personen opretter selv sin adgangskode via et engangslink. Adgangskoder gemmes med bcrypt, og for mange mislykkede forsøg spærrer login i 15 minutter.

## Rettigheder

- Alle inviterede kan se alles tilgængelighed og alle opgaver.
- Man kan kun rette sin egen tilgængelighed. Administrator kan rette alles.
- Alle kan tilføje, rette, afslutte og slette opgaver for alle.
- En opgave kan have en deadline (én dato) eller en periode (fra og til), eller ingen af delene. Aldrig begge dele på samme opgave.
- Kun administrator kan invitere, deaktivere og nulstille adgang.

## Drift

- Ny medarbejder: fanen Medarbejdere, Inviter medarbejder, send linket (det gælder i 14 dage og kan bruges én gang).
- Glemt adgangskode: Medarbejdere, Nyt invitationslink. Personen logges ud og vælger en ny adgangskode.
- Ændringer på siden: ret filerne her og push til `main`. GitHub Pages opdaterer selv.
- Skrifttyperne (Bricolage Grotesque og Atkinson Hyperlegible, begge under SIL Open Font License) ligger i `fonts/`, så siden ikke henter noget fra tredjepart.
