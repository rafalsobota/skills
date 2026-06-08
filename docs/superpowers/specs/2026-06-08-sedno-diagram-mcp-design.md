# sedno — MCP do krystalizacji myśli w diagramy

**Data:** 2026-06-08
**Status:** projekt zatwierdzony (przed planem implementacji)
**Cel platformy:** macOS 14+ (najpierw)

---

## 1. Istota

Lokalny serwer MCP dla Claude Code, który wzbogaca dialog użytkownika z Claude poprzez
**krystalizowanie myśli i abstrakcji w diagramy**. Claude bardzo dobrze generuje diagramy
jako SVG; zamiast zapisywać je na dysk, przekazuje SVG przez MCP do **natywnego okna**, które
pokazuje diagram użytkownikowi i zbiera jego **intencje** zwrotne.

Kluczowa zasada modelu: **Claude jest jedynym właścicielem grafu.** Okno to „warsztat
intencji" — wyświetla diagram oraz pozwala użytkownikowi dopisywać komentarze i wskazywać
elementy. Okno **nigdy nie edytuje geometrii**; zmiany struktury wykonuje wyłącznie Claude,
przebudowując SVG na podstawie zebranych intencji.

## 2. Doświadczenie użytkownika

Pętla pracy:

1. Claude generuje SVG i woła `render_diagram` → diagram pojawia się w oknie.
2. Użytkownik patrzy, klika element (lub zaznacza obszar, lub nic = komentarz globalny),
   wpisuje komentarz. Pod ręką **emoji-podpowiedzi** do szybkiego ostemplowania intencji:
   🔍 pogłęb · ✗ błędne · ✂️ uprość · ? pytanie. Emoji są sugestiami w treści komentarza,
   nie sztywnym enumem — Claude interpretuje je naturalnie.
3. Użytkownik klika **„Wyślij do Claude"** (commituje batch komentarzy do bufora).
4. Claude pozyskuje komentarze (mechanizm w §4), przebudowuje SVG, woła `render_diagram`
   ponownie. Okno pokazuje nową wersję; poprzednie wersje dostępne na **osi historii**.

Okno pokazuje **najnowszy diagram + oś historii wersji ze stabilnymi id** (`v1`, `v2`, … +
opcjonalny tytuł). Zarówno użytkownik (klik na osi), jak i Claude (`show_version`) mogą
**skakać** do dowolnej wersji. Powrót do wcześniejszej wersji i dalsza edycja zapisuje
rodowód (`basedOn`), więc „wróć do v3, była lepsza" działa wprost — przez id, dla obu stron.

## 3. Architektura — dwa procesy

```
Claude Code ⇄ (stdio JSON-RPC) ⇄ Serwer MCP (Bun, rodzic) ⇄ (localhost WS) ⇄ Okno (widok)
                                         │
                                         └─ jest też channelem (notifications/claude/channel → Claude)
```

### Serwer MCP (proces-rodzic, czysty Bun — NIE Electrobun)
- Uruchamiany przez Claude Code: `bun run /abs/path/server.ts`.
- `stdin`/`stdout` **wyłącznie** dla newline-delimited JSON-RPC. **Logi tylko na `stderr`.**
  Żaden `console.log` na `stdout` (patrz Ryzyko #1).
- Trzyma cały stan: **historię wersji** (uporządkowana lista `{ id, svg, title?, basedOn?,
  createdAt }`, in-memory na sesję), wskaźnik bieżąco wyświetlanej wersji oraz **bufor
  oczekujących komentarzy**.
- Uruchamia serwer WebSocket (`Bun.serve({ port: 0 })`, bind `127.0.0.1`, efemeryczny port
  + token handshake przekazany do widoku przez argv/env).
- Pełni rolę **channelu**: deklaruje `capabilities.experimental['claude/channel']` i może
  wysyłać `notifications/claude/channel`.
- SDK: `@modelcontextprotocol/sdk@^1.29` (linia stabilna; **nie** v2-alpha z README),
  `McpServer` + `registerTool` (zod **raw-shape** inputSchema, np. `{ svg: z.string() }`)
  + `StdioServerTransport`. Channel: dostęp do niskopoziomowego `server.server.notification(...)`
  oraz deklaracja capability w konstruktorze.

### Widok (warstwa wymienna za tym samym interfejsem WS)
- **Faza 1:** strona w przeglądarce serwowana lokalnie, livereload przez WS. Najtańsza
  walidacja całej pętli i schematu komentarzy.
- **Faza 2:** okno **Electrobun** — jedno trwałe `BrowserWindow`, lazy-spawn przy pierwszym
  renderze (exec wewnętrznego binarium `.app/Contents/MacOS/<bin>` z **własnym stdio**, nie
  przez `open`). Treść wstrzykiwana przez RPC (`win.webview.rpc.send.setSvg`/
  `executeJavascript`); zdarzenia z webview wracają przez RPC → most WS → serwer MCP.
- **Interaktywność dostarcza widok, nie Claude.** Widok znajduje elementy z
  `data-node-id`/`data-edge-id`, dodaje hover-highlight i klik-do-komentarza. Claude dostarcza
  tylko treść SVG + stabilne id.

### IPC
- Serwer MCP ⇄ widok: **localhost WebSocket** (bidirekcyjny, ramkowany; pierwszorzędny w Bun
  po obu stronach; to też wewnętrzny wzorzec Electrobuna). Push SVG w jedną stronę, zdarzenia
  w drugą.
- Serwer MCP ⇄ Claude Code: MCP po stdio (narzędzia, zasoby) **oraz** channel (push). To dwa
  różne kanały — nie mylić z WS do widoku.

## 4. Mechanizm feedbacku (warstwowy nad jednym buforem)

Wszystkie warianty czytają **ten sam bufor oczekujących komentarzy**.

### Baseline (v1, uniwersalny, nieblokujący)
- Narzędzie `get_feedback()` — zwraca i czyści bufor oczekujących komentarzy.
- Zasób `diagram://pending` — pull oczekujących intencji.
- Wyzwalacz: użytkownik pisze w sesji **„zobacz teraz"** → Claude woła `get_feedback()` →
  przebudowuje. Działa wszędzie, bez flag, nigdy nie blokuje rozmowy.

### Warstwa channel (ulepszenie, gdy włączone)
- Ten sam przycisk „Wyślij do Claude": gdy channels włączone → serwer wysyła
  `notifications/claude/channel` jako **sygnał obudzenia** (krótko: „feedback gotowy, N
  komentarzy — wywołaj `get_feedback()`") → Claude **budzi się bez pisania** i sam woła
  `get_feedback()`, które zwraca i **czyści** bufor. Dzięki temu konsumpcja zawsze idzie
  jednym kanałem (`get_feedback`) — brak podwójnego odczytu, niezależnie od ścieżki (pull czy
  channel). Gdy channels wyłączone → przycisk tylko commituje batch do bufora i podpowiada
  „napisz 'zobacz teraz'". Zachowanie adaptuje się; bez wyboru z góry.
- Start Claude Code dla tej warstwy: `claude --dangerously-load-development-channels server:sedno`.
- Status: research preview (v2.1.80+) — stąd to warstwa, nie fundament.

### Poza v1 (YAGNI)
- Narzędzie blokujące `present_and_await_feedback` (hard-stop „twój ruch"). Niepotrzebne przy
  modelu pull, bo Claude nigdy nie zamarza. Możliwe do dodania później.

## 5. Kontrakt narzędzi i zasobów (v1)

Narzędzia:
- `render_diagram({ svg: string, title?: string, basedOn?: string })` — **nieblokujące**.
  Tworzy **nową wersję** ze stabilnym id (`v1`, `v2`, …), zapisuje w historii (z `basedOn`,
  jeśli powstała z wcześniejszej wersji — np. po powrocie do v3), wypycha do okna przez WS,
  ustawia jako wyświetlaną, wraca natychmiast. Opis narzędzia instruuje Claude, by osadzał
  stabilne `data-node-id`/`data-edge-id` na elementach.
- `show_version({ id: string })` — **nieblokujące**. Przełącza wyświetlaną wersję w oknie na
  istniejące id, bez regeneracji — skakanie po historii (np. „wróć do v3").
- `get_feedback()` — zwraca oczekujące komentarze i czyści bufor.

Zasoby:
- `diagram://current` — bieżąco wyświetlana wersja (id + SVG).
- `diagram://history` — uporządkowana lista wersji (id, tytuł, `basedOn`, czas).
- `diagram://version/{id}` — SVG konkretnej wersji (by Claude mógł kontynuować od starej).
- `diagram://pending` — oczekujące komentarze (pull, bez czyszczenia).

## 6. Kontrakt tożsamości elementów

- Claude osadza stabilne `data-node-id` na węzłach i `data-edge-id` na połączeniach SVG.
- Widok czyni klikalnymi tylko elementy z tymi atrybutami i raportuje id przy komentarzu.
- Komentarz serializowany jako: `{ versionId: string, target: { kind: "element", id } | { kind: "region", ids: string[] } | { kind: "global" }, text: string }`
  — `versionId` mówi, na której wersji komentarz powstał (tekst może zaczynać się od
  emoji-podpowiedzi).
- `get_feedback()` zwraca listę takich komentarzy. Claude wiąże je z wersją i elementami po id
  i przebudowuje graf (zwykle jako nową wersję `basedOn` tej, której dotyczył feedback).

## 7. Cykl życia i higiena (domyślne)

- **Fokus:** okno pasywne (`NSApplication activationPolicy(.accessory)` / `LSUIElement`).
  Wysuwa się na wierzch tylko przy **nowym** diagramie, nie przy każdej aktualizacji.
- **Zakres okna:** jedno okno na instancję serwera (czyli na sesję Claude Code). Efemeryczny
  port WS unika kolizji między równoległymi sesjami.
- **Sprzątanie:** serwer ubija widok przy EOF `stdin` / SIGTERM / wyjściu procesu. Electrobun
  ma watchdog: gdy WS padnie (serwer zniknął), sam się zamyka (`Utils.quit()`) — żadne sieroce
  okno nie przeżyje serwera.
- **Bezpieczeństwo IPC:** bind `127.0.0.1`, efemeryczny port poza pasmem (argv/env) + token
  współdzielony w handshake WS, by inne lokalne procesy nie podpięły się do kanału diagramu.

## 8. Stos i rejestracja

- Runtime: **Bun** (potwierdzić minimalną wersję wobec repo Electrobun przed Fazą 2).
- Pakiety: `@modelcontextprotocol/sdk@^1.29`, `zod`. (Faza 2: `electrobun`.)
- Rejestracja w Claude Code przez `.mcp.json`:
  ```json
  { "mcpServers": { "sedno": { "command": "bun", "args": ["run", "/abs/path/server.ts"] } } }
  ```
- Zwracanie treści: bloki `content` (`text`; opcjonalnie `image` jako PNG/SVG do podglądu w
  transkrypcie Claude, z tekstowym fallbackiem).

## 9. Ryzyka

1. **Kontaminacja `stdout` (najważniejsze).** Każdy zapis na `stdout` w procesie MCP (zbłąkany
   `console.log`, SDK, albo logi frameworka/native Electrobuna) cicho psuje ramkowanie
   JSON-RPC. Dlatego: Electrobun w **osobnym procesie z własnym stdio**, proces MCP loguje
   **tylko na `stderr`**, dziecko spawnowane z własnym `stdout`. Pomyłka tu = nic innego nie ma
   znaczenia.
2. **Channels = research preview** (v2.1.80+); składnia flagi/protokołu może się zmienić.
   Mitygacja: pull jest fundamentem; channel to wymienialna warstwa.
3. **Sieroce okna / lifecycle.** `open` nie daje uchwytu dziecka. Mitygacja: exec wewnętrznego
   binarium + watchdog rozłączenia WS.
4. **Kradzież fokusu** przez GUI spawnowane z procesu w tle. Mitygacja: `.accessory`/`LSUIElement`,
   foreground tylko przy nowym diagramie.
5. **Młodość Electrobuna** (v1, mały zespół) + Bun przepisuje rdzeń Zig→Rust (ryzyko dla
   bindings). Mitygacja: podejście etapowe izoluje Electrobun do późnej, wymienialnej warstwy.
6. **Pułapka wersji SDK:** README na `main` dokumentuje nieopublikowane v2-alpha
   (`@modelcontextprotocol/server`, `inputSchema: z.object(...)`). Trzymać się `^1.29` i
   raw-shape inputSchema.
7. **Różnice WebView per-OS** (SVG/CSS). Mitygacja: cel macOS 14+ najpierw; CEF jako furtka
   spójności później, gdyby trzeba.

## 10. Strategia budowy (etapowa)

- **Faza 1 — pętla i kontrakt (niskie ryzyko):** serwer MCP (Bun) + `render_diagram` +
  `get_feedback` + zasoby + bufor + serwer WS + **widok w przeglądarce** (livereload).
  Walidacja: pełna pętla render → komentarz → „zobacz teraz" → przebudowa; schemat komentarzy;
  kontrakt `data-node-id`.
- **Faza 2 — natywne okno:** podmiana widoku na **Electrobun** za tym samym interfejsem WS
  (jedno trwałe okno, lazy-spawn, RPC, watchdog, fokus `.accessory`).
- **Faza 3 — warstwa channel:** capability `claude/channel` + push przy „Wyślij do Claude";
  przycisk adaptuje się do dostępności channels.

## 11. Zakres v1 i świadome wykluczenia (YAGNI)

**Poza v1:** edycja geometrii w oknie; galeria wielu diagramów obok siebie; współdzielone okno
między sesjami; rysowanie odręczne; eksport/persystencja na dysk; narzędzie blokujące;
**rozgałęziona historia (drzewo gałęzi)** — v1 ma listę + rodowód; **persystencja wersji
między sesjami** — historia jest in-memory na sesję; platformy poza macOS 14+.

## 12. Otwarte kwestie do potwierdzenia w planie

- Minimalna wersja Bun wymagana przez Electrobun (zweryfikować wobec repo przed Fazą 2).
- Dokładny kształt zwrotu `get_feedback()` oraz treści sygnału obudzenia w
  `notifications/claude/channel` (czytelność dla Claude vs zwięzłość).
- Czy historia wersji ma limit (np. ostatnie N) czy pełna sesja.
- Sposób zaznaczania obszaru (marquee → zbiór id) — szczegół UI Fazy 1.

## 13. Model współbieżności

stdio jest 1:1 — każda sesja Claude Code spawnuje **własny** podproces serwera. Stąd:

- **Osobne sesje są w pełni izolowane:** N instancji `claude` = N niezależnych serwerów =
  N efemerycznych portów WS = N osobnych okien, każde z własną historią i buforem. Zero
  kolizji (po to `port: 0`). To naturalna i pożądana granica izolacji: jeden użytkownik =
  jedna sesja = jedno okno.
- **Subagenci w obrębie jednej sesji współdzielą jeden serwer:** dziedziczą narzędzia MCP
  sesji-rodzica i nie startują własnych serwerów. Wszystkie ich wywołania idą przez ten sam
  podproces → wspólne okno, historia i bufor. Brak awarii/korupcji (serwer jednowątkowy na
  pętli zdarzeń; `stdout` czyste dzięki zasadzie zero `console.log`), ale **logicznie**
  diagramy wielu subagentów przeplatają się w jednym oknie i jednej osi wersji.
- **Brak tożsamości wywołującego:** MCP przekazuje serwerowi tylko `{ name, arguments }` —
  żadnego id sesji ani subagenta. Serwer **nie może** sam rozdzielić subagentów na osobne
  okna/tory.

**Decyzja v1:** izolacja na granicy sesji (jak wyżej); współdzielenie wewnątrz sesji jest
akceptowane jako „jedno okno na sesję". **Poza v1** (możliwe rozszerzenie): jawny argument
`lane`/`agentId` w `render_diagram`, po którym serwer kluczowałby osobne okna/tory dla wielu
równoległych agentów w jednej sesji.
