# Driftskalender

Fælles kalender og opgaveoverblik for flere afdelinger: hvem kan bidrage i driften hvilke dage (som Gulvvagt, På kald eller til administrative opgaver), og hvilke opgaver ligger hos hvem.

## Sådan hænger det sammen

- **Siden** (denne mappe) er ren HTML, CSS og JavaScript uden byggetrin. Den ligger på GitHub Pages.
- **Data og login** ligger i Supabase-projektet `performance-board`, i et eget schema (`driftskalender`), som ikke er eksponeret via Supabase's API og ikke deler tabeller med KPI-projektet.
- **Edge function** `driftskalender` er den eneste vej ind til data. Den videresender kald til databasefunktionen `driftskalender.api()`, hvor al logik og adgangskontrol ligger.
- **Login** er et eget invitationsbaseret system (ikke Supabase Auth): administratoren inviterer via e-mail, personen opretter selv sin adgangskode via et engangslink. Adgangskoder gemmes med bcrypt, og for mange mislykkede forsøg spærrer login i 15 minutter.

## Afdelinger

Kalenderen deles af flere afdelinger. I dag er der to: **Teknisk Support** og **Kundeservice**. Hver afdeling har sine egne medarbejdere, teamledere, tilmeldinger, opgaver og ønsker om støtte, og ser ikke de andres.

- Administrator bestemmer under Medarbejdere (grupperet efter afdeling), hvilken **afdeling** hver person hører til, og hvem der er **teamleder** for hver TUK og ProblemManager. En teamleder kan kun vælges blandt teamledere i samme afdeling. Skifter en medarbejder afdeling, mister vedkommende sin teamleder. En teamleder med medarbejdere kan ikke skifte afdeling, rolle eller deaktiveres, før medarbejderne har en anden teamleder.
- **Administrator** og **Drift** ser alle afdelinger, én ad gangen, med en afdelingsvælger i toppen. Alle andre ser kun deres egen afdeling, og det håndhæves i databasefunktionen (en afdeling man ikke hører til, kan ikke hentes, uanset hvad siden sender).
- Afdelingernes regler ligger i tabellen `driftskalender.departments`:
  - Teknisk Support: tilmelding som Gulvvagt eller På kald. Ønsker: Gulvvagt og Stafet (dækkes af gulvvagt-tilmeldinger), På kald og Administrative opgaver (øvrige ønsker uden dækningsstatus). Ingen åbningstid.
  - Kundeservice: tilmelding som På kald eller Administrative opgaver (der er ingen gulvvagter eller stafetter). Ønsker: På kald og Administrative opgaver, begge med tidsrum og dækningsstatus: På kald dækkes af tilmeldinger som På kald, Administrative opgaver af tilmeldinger som Administrative opgaver. Åbningstiden 08-16 er standard i tidsvælgerne. Hjælp uden for åbningstiden kan tilbydes eller ønskes ved at sætte flueben ved "Uden for åbningstid". Åbningstiden er kun en hjælp i siden, ikke en spærring i databasen.
- Kundeservice har foreløbig kun TUK som medarbejderrolle (ProblemManager kan teknisk vælges, men er ikke tænkt til den afdeling).

## Rettigheder

- Man ser tilgængelighed, opgaver og ønsker for sin egen afdeling (administrator og Drift for alle).
- Man kan kun rette sin egen tilgængelighed. Administrator kan rette alles.
- **Opgaver** ligger kun hos TUK'er og ProblemManager (teamledere vises ikke under Opgaver og kan ikke vælges som ansvarlig). Man kan oprette, rette, afslutte og slette opgaver for sig selv. En **teamleder** kan det også for sine egne medarbejdere (dem, administrator har sat vedkommende som teamleder for), og **administrator** for alle. TUK'er og ProblemManager kan se hinandens opgaver i samme afdeling, men ikke ændre dem. Det håndhæves i databasefunktionen. En TUK eller ProblemManager med åbne opgaver kan ikke skifte til teamleder, før opgaverne er flyttet.
- En teamleder ser alle medarbejdere i sin afdeling i kalenderen og har en skrivebeskyttet fane Medarbejdere for afdelingen (navne, roller og teamleder, uden e-mailadresser).
- En opgave kan have en deadline (én dato) eller en periode (fra og til), eller ingen af delene. Aldrig begge dele på samme opgave.
- Åbne opgaver med periode vises i kalenderen som bjælker i ansvarligs farve, og i dagspanelet for hver dag de dækker.
- **Ønsker om støtte fra driften** markeres på en dato i kalenderen og hører til en afdeling. Typerne afhænger af afdelingen (se ovenfor). I Teknisk Support er Gulvvagt og Stafet særlige ønsker (begge med tidsrum; Stafet foreslår aftenen 16-21), mens På kald og Administrative opgaver er øvrige ønsker (lilla). Alle i afdelingen kan oprette dem fra dagspanelet, også Drift (i enhver afdeling). Alle andre end Drift kan rette og slette alle ønsker i afdelingen. Drift kan kun rette og slette sine egne.
- Dækning beregnes ud fra tilmeldinger i tidsrummet: grøn = dækket, gul = delvist (hullet vises, med knap til at skrive sig på), rød = mangler. Teksten i mærket viser typen ("GV dækket", "Stafet dækket", "Mangler stafet", "Kald dækket", "Adm. delvist"). I Teknisk Support dækker kun gulvvagt-tilmeldinger en Gulvvagt eller Stafet. Øvrige ønsker har ingen dækningsstatus.
- **Besked om et ønske:** ved oprettelsen (eller med knappen Send besked) vælges grupperne Teamledere, TUK'er og ProblemManager. Siden henter modtagernes adresser (aktive medarbejdere i grupperne i ønskets afdeling, ikke en selv og ikke Drift) og åbner en mail med tekst og modtagere udfyldt, som man selv sender. Der sendes ingen mails fra serveren. Adresserne gives kun ud til den, der opretter eller sender beskeden om sit ønske (Drift kun for egne ønsker).
- Kun administrator kan invitere, flytte mellem afdelinger, bestemme teamleder, deaktivere og nulstille adgang.
- **Drift** er en rolle med kun læseadgang til begge afdelinger: kalender, opgaver og medarbejderliste (navne og roller, uden e-mailadresser). Drift har ingen afdeling og kan ikke tilmelde sig eller oprette, rette eller afslutte opgaver, og kan ikke være administrator. Eneste undtagelse er ønsker om støtte, som Drift kan oprette i begge afdelinger og rette/slette egne af. Det håndhæves i databasefunktionen, ikke kun i siden. Kun skift af egen adgangskode og log ud er tilladt. Drift indgår ikke som person i kalender, opgavekolonner eller tilmeldingsvalg.

## Drift

- Ny medarbejder: fanen Medarbejdere, Inviter medarbejder, vælg rolle, afdeling og (for TUK og ProblemManager) teamleder, og send linket (det gælder i 14 dage og kan bruges én gang). Vælg rollen "Drift (kun læseadgang)" til dem, der kun skal kunne se. Afdeling og teamleder kan altid ændres bagefter i listen.
- Ny afdeling: tilføjes som en række i `driftskalender.departments` (navn, hvilke tilmeldinger og ønsker der findes, hvad der dækker hvad, evt. åbningstid). Siden retter sig efter tabellen.
- Glemt adgangskode: Medarbejdere, Nyt invitationslink. Personen logges ud og vælger en ny adgangskode.
- Ændringer på siden: ret filerne her og push til `main`. GitHub Pages opdaterer selv.
- Skrifttyperne (Bricolage Grotesque og Atkinson Hyperlegible, begge under SIL Open Font License) ligger i `fonts/`, så siden ikke henter noget fra tredjepart.
