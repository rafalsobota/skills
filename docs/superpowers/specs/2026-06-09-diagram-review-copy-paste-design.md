# diagram-review — radykalnie uproszczona pętla feedbacku (kopiuj-wklej)

**Data:** 2026-06-09
**Status:** projekt zaakceptowany, do implementacji
**Zastępuje:** architekturę MCP + Unix socket + Electrobun (`2026-06-08-sedno-diagram-mcp-design.md`)

## Problem

Obecny obieg komunikacji jest złożony: MCP server (stdio) ⟷ Unix socket (własny
protokół wire, backpressure, watchdog) ⟷ natywne okno Electrobun. To trzy procesy
i ~10 komponentów do utrzymania, żeby zrealizować jedną pętlę: pokaż diagram →
zbierz komentarze → oddaj je Claude.

Celem jest **radykalne uproszczenie**: ta sama pętla pojęciowa, ale bez serwera,
bez socketów, bez natywnego okna i bez automatycznego kanału powrotnego.

## Zasada (przeżywa z poprzedniej architektury)

Claude jest właścicielem struktury grafu. Strona tylko **wyświetla** diagram i
**zbiera** komentarze — nigdy nie edytuje geometrii. Zmienia się wyłącznie
transport feedbacku: zamiast automatycznego kanału, powrót realizuje człowiek
przez schowek (kopiuj → wklej do rozmowy).

## Co znika, co zostaje

**Znika w całości:** MCP server, Unix socket, protokół wire, backpressure,
watchdog, natywne okno Electrobun, cały katalog `viewer-app/`, cała warstwa
`src/` obsługująca transport.

**Pojawia się:** jeden skill z trzema plikami. Zero zależności runtime, zero
buildu, zero hostingu, zero procesów w tle, zero sieci.

## Architektura

Skill o nazwie **`diagram-review`** — katalog zawierający **trzy pliki**:

| Plik | Rola |
|------|------|
| `template.html` | Malutki szkielet HTML: placeholdery `{{VERSION}}`, `{{FILE}}`, slot na SVG (`<!-- SVG -->`) i jeden `<script src="overlay.js">`. |
| `overlay.js` | **Współdzielona nakładka** — CSS + JS w jednym pliku (klasyczny skrypt w IIFE). Kopiowany raz do folderu docelowego, referowany przez każdy `diagram-vN.html`. |
| `SKILL.md` | Instrukcja dla Claude: jak generować SVG, jak wypełnić szablon, gdzie zapisać plik, że robi `open`, jak czytać wklejony feedback. |

**Dlaczego osobny `overlay.js`, a nie inline:** przy wielu wersjach (np. 100
diagramów) inline'owana nakładka duplikowałaby ~10 KB w każdym pliku. Współdzielony
`overlay.js` (kopiowany raz do folderu) sprawia, że każdy `diagram-vN.html` to
tylko mały SVG (~1 KB), a aktualizacja nakładki odświeża wszystkie diagramy naraz.

**Świadomy trade-off:** pojedynczy HTML **nie jest** samowystarczalny — jest ważny
tylko obok `overlay.js` w tym samym folderze. Przy efemerycznych plikach w temp to
bez znaczenia.

**Klasyczny skrypt, nie moduł:** `overlay.js` ładowany jako `<script src>` (nie
`type="module"`), bo moduły ES są blokowane przez CORS na `file://`; klasyczne
skrypty z tego samego folderu — nie. Kod jest opakowany w IIFE, bez `import/export`.

Składanie pliku jest trywialne i bez buildu: Claude kopiuje `template.html`,
podmienia trzy placeholdery (`cp` + Edit) i kopiuje `overlay.js` do folderu —
nie re-emitując statycznego CSS/JS.

## Przepływ end-to-end

```
Claude generuje SVG (elementy commentowalne mają atrybut data-id)
   → kopiuje overlay.js do folderu docelowego (raz, idempotentnie)
   → wybiera numer wersji N (max istniejących w katalogu + 1)
   → kopiuje template.html i podmienia placeholdery: {{VERSION}}, {{FILE}}, <!-- SVG -->
   → zapisuje plik diagram-vN.html w domyślnej lokalizacji
   → uruchamia `open <ścieżka>`
        ↓
Użytkownik: klik w element → element się podświetla → popover z <textarea> →
            „Dodaj"  (albo przycisk „Komentarz do całości")
   → lista komentarzy w karcie rośnie
   → klik „Kopiuj dla Claude" → Markdown ląduje w schowku
        ↓
Użytkownik wkleja tekst do rozmowy z Claude
   → Claude czyta nagłówek (zna wersję bazową), regeneruje → vN+1 → open
   → pętla się powtarza
```

Historia wersji żyje w dwóch miejscach: pliki `diagram-vN.html` na dysku (do
restartu) oraz przebieg rozmowy z Claude (trwale).

## Lokalizacja generowanych plików

- **Domyślnie:** katalog tymczasowy systemu, podkatalog `diagram-review`, np.
  `$TMPDIR/diagram-review/diagram-v1.html`, `diagram-v2.html`, …
  Nie zaśmieca repozytorium, nie wymaga wpisu w `.gitignore`, a historia w
  ramach sesji jest zachowana (pliki przeżywają do restartu systemu, co przy
  modelu kopiuj-wklej w zupełności wystarcza).
- **Preferencje użytkownika nadpisują default.** Jeśli np. CLAUDE.md mówi
  „trzymaj artefakty w `./diagrams/`", skill honoruje tę lokalizację.

Numer wersji N ustala Claude, skanując katalog docelowy w poszukiwaniu
najwyższego istniejącego `diagram-vN.html` i dodając 1 (start od v1).

## Element commentowalny

Jeden atrybut: **`data-id="auth-service"`**. Dowolny element SVG oznaczony tym
atrybutem staje się klikalny. Brak rozróżnienia węzeł/krawędź — krawędzie też
mogą dostać `data-id`, ale w feedbacku wszystko jest jednolicie „elementem".

Targetowanie ograniczone do dwóch przypadków:
- **konkretny element** (pin przy klikniętym `data-id`, jeden komentarz na element),
- **całość diagramu** (jeden komentarz „overall" na górze panelu).

Świadomie **wycięte** (YAGNI): wiele komentarzy do całości, osobna kategoria
krawędzi, zaznaczanie regionów (wielu elementów naraz), znaczniki intencji
(emoji 🔍/✗/✂️/❓), wątki/odpowiedzi na komentarzach.

## Szablon HTML i metadane

`template.html` zawiera u góry blok metadanych z placeholderami wypełnianymi
przez Claude przy generacji:

```html
<script>window.diagramMeta = { version: "{{VERSION}}", file: "{{FILE}}" };</script>
```

Niżej w `<body>` jest slot na SVG i pojedynczy `<script src="overlay.js">`. Cały
CSS i logika żyją w `overlay.js`; po załadowaniu skrypt odczytuje
`window.diagramMeta`, żeby wstawić poprawny nagłówek do kopiowanego tekstu.

## Zachowanie nakładki (`overlay.js`)

UI w całości po **angielsku**; wzorowane na profesjonalnych narzędziach do
review (Figma comments / Linear). UI budowane przez `createElement`/`textContent`
(bez `innerHTML` na danych użytkownika). Tryb ciemny przez `prefers-color-scheme`.

1. Po załadowaniu skryptu: wstrzykuje `<style>`, skanuje `[data-id]`, dorzuca do
   każdego elementu hover-highlight oraz handler kliknięcia.
2. **Prawy sidebar** (dokowany, 340px) — `body { margin-right }` sprawia, że diagram
   **nigdy nie jest zasłaniany**. Nagłówek (tytuł „Review" + pill wersji + chevron),
   na górze **jeden** komentarz do całości (pole jak commit message), niżej
   lista-nawigacja komentarzy elementów, stopka z „Copy for AI".
3. **Jeden komentarz do całości** (`overall`, string) — pojedyncze, zawsze dostępne
   pole, analogicznie do wiadomości commита. Nie ma wielu globalnych komentarzy.
4. **Komentarze elementów po Figmowemu — inline na płótnie.** Klik elementu → pin
   `{ id, target: <data-id>, text }` + popover-edytor przy pinie (autosave). **Hover
   pinu** → dymek z treścią (read); **klik pinu** → edycja inline. Jeden komentarz na
   element. Pusty na `blur` → pin znika. Lista w sidebarze to tylko nawigacja (klik
   wiersza → przewija do elementu i otwiera edytor). Piny pozycjonowane wg
   `getBoundingClientRect`, korygowane na resize/scroll.
5. **Podgląd kopii + „Copy for AI" (agnostyczne).** Hover na przycisku „Copy for AI"
   pokazuje dymek z dokładnym Markdownem, który trafi do schowka. Klik kopiuje
   (z fallbackiem `<textarea>`). Treść jest uniwersalna — działa z dowolnym agentem AI.
6. **Zwijanie panelu.** Chevron chowa sidebar (`translateX`), diagram zajmuje pełną
   szerokość, a w rogu zostaje pływający pill „Review · N" do rozwinięcia. Piny
   zostają na diagramie.

Stan trzymany wyłącznie w pamięci karty. Brak persystencji — po skopiowaniu i
regeneracji powstaje nowa wersja, nowy plik.

## Format kopiowanego tekstu (kontrakt nakładka → agent AI)

Markdown, samoopisowy (agent dostaje go jako wklejkę bez dodatkowego kontekstu):

```
## Feedback on diagram v2 (file: diagram-v2.html)

> split this into two layers

- **[element: auth-service]** should not depend on cache
- **[element: gateway]** is this really needed?
```

Elementy formatu:
- nagłówek z **id wersji** (agent wie, na czym bazować) i nazwą pliku,
- opcjonalny `>` blockquote = jeden komentarz do całości diagramu,
- każdy bullet `- **[element: <data-id>]**` celuje w jeden element + wolny tekst.

## Obsługa błędów

Jedyne realne ryzyko techniczne to schowek. `navigator.clipboard.writeText` na
`file://` zwykle działa (bezpieczny kontekst + gest użytkownika z kliknięcia),
ale bywa kapryśny w zależności od przeglądarki.

**Fallback:** jeśli `writeText` rzuci wyjątek lub odrzuci obietnicę — nakładka
pokazuje `<textarea>` z gotowym tekstem zaznaczonym w całości i podpowiedzią
„naciśnij Ctrl+C / ⌘C". Skopiowanie jest zawsze możliwe.

## Testowanie

- Deliverable to statyczny, samowystarczalny asset (CSS+JS inline), więc nie ma
  modułu do importu w unit-teście; Bun nie ma DOM, a dokładanie jsdom/happy-dom
  przeczyłoby zasadzie „zero zależności".
- Weryfikacja przez **smoke-test manualny**: otwórz wygenerowany `diagram-v1.html`,
  kliknij element, dodaj komentarz, „Kopiuj dla Claude", sprawdź, że skopiowany
  Markdown zgadza się z oczekiwanym formatem. Dokładne kroki w planie implementacji.
- Brak warstwy transportu = brak testów integracyjnych socketu/wire/bridge.

## Migracja

Stary stack (`src/`, `viewer-app/`) zostaje usunięty po potwierdzeniu, że nowy
skill realizuje pełną pętlę. Spec `2026-06-08-sedno-diagram-mcp-design.md`
pozostaje w repo jako zapis historyczny poprzedniej architektury.
