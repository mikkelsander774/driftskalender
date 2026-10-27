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
- Åbne opgaver med periode vises i kalenderen som bjælker i ansvarligs farve, og i dagspanelet for hver dag de dækker.
- **Særligt ønske om støtte fra driften** markeres på en dato i kalenderen. Typer: Gulvvagt, På kald (begge med tidsrum), Stafet og Administrative opgaver (tidsrum valgfrit; tekst påkrævet ved administrative opgaver). Alle kan oprette dem fra dagspanelet, også Drift. Alle andre end Drift kan rette og slette alle ønsker. Drift kan kun rette og slette sine egne.
- Dækning beregnes automatisk for Gulvvagt og På kald ud fra tilmeldinger af samme slags i tidsrummet: grøn = dækket, gul = delvist (hullet vises, med knap til at skrive sig på), rød = mangler. At stå på kald dækker ikke et ønske om gulvvagt, og omvendt.
- **Besked om et ønske:** ved oprettelsen (eller med knappen Send besked) vælges grupperne Teamledere, TUK'er og ProblemManager. Siden henter modtagernes adresser (aktive medarbejdere i grupperne, ikke en selv og ikke Drift) og åbner en mail med tekst og modtagere udfyldt, som man selv sender. Der sendes ingen mails fra serveren. Adresserne gives kun ud til den, der opretter eller sender beskeden om sit ønske (Drift kun for egne ønsker).
- Kun administrator kan invitere, deaktivere og nulstille adgang.
- **Drift** er en rolle med kun læseadgang: kalender, opgaver og medarbejderliste (navne og roller, uden e-mailadresser). Drift kan ikke tilmelde sig eller oprette, rette eller afslutte opgaver, og kan ikke være administrator. Eneste undtagelse er ønsker om støtte, som Drift kan oprette og rette/slette egne af. Det håndhæves i databasefunktionen, ikke kun i siden. Kun skift af egen adgangskode og log ud er tilladt. Drift indgår ikke som person i kalender, opgavekolonner eller tilmeldingsvalg.

## Drift

- Ny medarbejder: fanen Medarbejdere, Inviter medarbejder, send linket (det gælder i 14 dage og kan bruges én gang). Vælg rollen "Drift (kun læseadgang)" til dem, der kun skal kunne se.
- Glemt adgangskode: Medarbejdere, Nyt invitationslink. Personen logges ud og vælger en ny adgangskode.
- Ændringer på siden: ret filerne her og push til `main`. GitHub Pages opdaterer selv.
- Skrifttyperne (Bricolage Grotesque og Atkinson Hyperlegible, begge under SIL Open Font License) ligger i `fonts/`, så siden ikke henter noget fra tredjepart.
