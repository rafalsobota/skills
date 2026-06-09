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

Skill o nazwie **`diagram-review`** — katalog zawierający tylko **dwa pliki**:

| Plik | Rola |
|------|------|
| `template.html` | **Samowystarczalny szkielet** — CSS i JS nakładki już wbudowane inline. Placeholdery: `{{VERSION}}`, `{{FILE}}` i slot na SVG (`<!-- SVG -->`). |
| `SKILL.md` | Instrukcja dla Claude: jak generować SVG, jak wypełnić szablon, gdzie zapisać plik, że robi `open`, jak czytać wklejony feedback. |

Wygenerowany artefakt to **pojedynczy, samowystarczalny plik `.html`** (SVG +
nakładka + metadane w jednym pliku). Otwiera się w dowolnej przeglądarce,
działa offline, bez CDN, bez CORS, bez supply-chain.

Składanie pliku jest trywialne i bez buildu: Claude kopiuje `template.html` i
podmienia trzy placeholdery (`cp` + Edit), nie re-emitując statycznego CSS/JS.
Dlatego **nie ma osobnego `overlay.js` ani kroku „assemble"** — cała nakładka
żyje w `template.html`.

## Przepływ end-to-end

```
Claude generuje SVG (elementy commentowalne mają atrybut data-id)
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
- **konkretny element** (kliknięty `data-id`),
- **całość** (przycisk „Komentarz do całości").

Świadomie **wycięte** (YAGNI): osobna kategoria krawędzi, zaznaczanie regionów
(wielu elementów naraz), znaczniki intencji (emoji 🔍/✗/✂️/❓).

## Szablon HTML i metadane

`template.html` zawiera u góry blok metadanych z placeholderami wypełnianymi
przez Claude przy generacji:

```html
<script>window.diagramMeta = { version: "{{VERSION}}", file: "{{FILE}}" };</script>
```

Niżej w tym samym pliku siedzi inline `<style>` (CSS nakładki) oraz
`<script type="module">` budujący nakładkę. Po załadowaniu skrypt odczytuje
`window.diagramMeta`, żeby wstawić poprawny nagłówek do kopiowanego tekstu.

## Zachowanie nakładki (inline w `template.html`)

1. Po załadowaniu modułu: skanuje `[data-id]`, dorzuca do każdego elementu
   hover-highlight oraz handler kliknięcia. UI budowane przez
   `createElement`/`textContent` (bez `innerHTML` na danych użytkownika).
2. Klik w element → popover przy elemencie z `<textarea>` i przyciskiem „Dodaj".
   „Dodaj" dopisuje komentarz `{ target: <data-id>, text }` do tablicy w pamięci.
3. Stały pasek (np. dół ekranu): licznik „N komentarzy", przycisk
   **„Komentarz do całości"** (popover bez konkretnego elementu, `target: global`)
   oraz przycisk **„Kopiuj dla Claude"**.
4. „Kopiuj dla Claude" składa Markdown (format niżej) z `window.diagramMeta` +
   listy komentarzy i woła `navigator.clipboard.writeText`.

Stan (lista komentarzy) trzymany wyłącznie w pamięci karty. Brak persystencji
komentarzy — po skopiowaniu i regeneracji powstaje nowa wersja, nowy plik.

## Format kopiowanego tekstu (kontrakt nakładka → Claude)

Markdown, samoopisowy (Claude dostaje go jako wklejkę bez dodatkowego kontekstu):

```
## Feedback do diagramu v2 (plik: diagram-v2.html)

- **[element: auth-service]** nie powinno zależeć od cache
- **[element: gateway]** czy to na pewno potrzebne?
- **[całość]** da się to rozbić na dwie warstwy?
```

Elementy formatu:
- nagłówek z **id wersji** (Claude wie, na czym bazować) i nazwą pliku,
- każdy komentarz mówi, czego dotyczy: `[element: <data-id>]` lub `[całość]`,
- po znaczniku — wolny tekst komentarza.

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
