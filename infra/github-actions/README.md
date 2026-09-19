# Obecny pipeline: GitHub Actions i GitHub Pages

To jest **aktywny produkcyjny wariant aktualizacji repertuaru**. Nie usuwamy ani nie wyłączamy jego harmonogramu, dopóki nowy pipeline nie przejdzie prób równoległych oraz świadomego cutoveru.

Wariant korzysta z dwóch workflow:

- [update-repertoire.yaml](../../.github/workflows/update-repertoire.yaml) pobiera i zapisuje dane;
- [deploy-pages.yaml](../../.github/workflows/deploy-pages.yaml) buduje oraz publikuje GitHub Pages.

## Przepływ danych

```text
GitHub schedule / workflow_dispatch
              |
              v
       schedule-gate
       sprawdza fetchedAt
              |
              v
  testy -> scraper -> walidacja zapisu
              |
              v
  branch automation/repertoire-<run_id>
              |
              v
       Pull Request -> squash do main
              |
              v
  build-current-json -> artefakt Pages -> deploy
```

1. Job `schedule-gate` pobiera aktualne `main` i uruchamia `scripts/check-update-due.mjs`.
2. Dla wywołania harmonogramowego skrypt odczytuje `public/data/index.json` i porównuje `fetchedAt` z ostatnim wymaganym oknem w strefie `Europe/Warsaw`. Ręczne `workflow_dispatch` zawsze przechodzi dalej.
3. Job `update` instaluje zależności, przywraca `.cache` z GitHub Actions, uruchamia `npm test` i `npm run build:data`.
4. Scraper zachowuje 7 pełnych dni wstecz względem bieżącej daty Muzy, usuwa starsze pliki dni, a następnie usuwa plakaty nieużywane przez żaden zachowany dzień.
5. Jeżeli dane się zmieniły, workflow dodaje do commita tylko `public/data/index.json`, `public/data/days/` oraz `public/media/posters/` na tymczasowej gałęzi `automation/repertoire-<run_id>`. Obejmuje to również usunięcia wynikające z retencji.
6. Workflow tworzy Pull Request, scala go metodą squash i usuwa tymczasową gałąź. Brak zmian kończy przebieg bez PR-a.
7. Publikacja Pages ponownie uruchamia testy, wykonuje `npm run build:json`, pakuje katalog `public/` jako artefakt Pages i publikuje go w środowisku `github-pages`.

`public/data/repertoire.json` jest generowany podczas publikacji z bieżących dat repertuaru i nie jest przechowywany w historii Git. Retencja nie przepisuje historii Git — usuwa stare pliki z aktualnej gałęzi. Cache zewnętrznych metadanych również nie trafia do repozytorium — jego trwałość zależy od `actions/cache`.

## Harmonogram i idempotencja

Docelowe godziny aktualizacji w Polsce to 12:00 i 18:00, a we wtorki dodatkowo 14:00 i 16:00. GitHub cron działa w UTC i nie obsługuje nazwanej strefy czasowej, dlatego workflow uruchamia szerszy zestaw prób uwzględniający CET/CEST:

```yaml
- cron: "7,37 10-12,16-18 * * *"
- cron: "7,37 13-15 * * 2"
```

Nadmiarowe wywołania są celowe. `schedule-gate` oblicza właściwe okno w `Europe/Warsaw`; poprawne `fetchedAt` powoduje pominięcie kolejnej próby tego samego okna. Dzięki temu opóźniony cron może nadrobić aktualizację, a poprawny wcześniejszy przebieg nie tworzy duplikatu danych.

Workflow aktualizacji używa grupy współbieżności `repertoire-update` z `cancel-in-progress: false`, więc dwie aktualizacje nie wykonują się równocześnie. Workflow Pages analogicznie używa grupy `pages`. Zwykły push do `main` uruchamia publikację. Zmiany wykonane przy użyciu `${{ github.token }}` nie wyzwalają kolejnych workflow przez zdarzenie `push`, dlatego po automatycznym scaleniu pipeline jawnie uruchamia `deploy-pages.yaml` przez `workflow_dispatch`. Nie jest to drugi, nadmiarowy deploy.

## Uprawnienia i konfiguracja repozytorium

Pipeline nie wymaga własnego PAT ani statycznych sekretów. Używa krótkotrwałego `${{ github.token }}` przyznawanego dla przebiegu.

Workflow aktualizacji wymaga:

- `contents: write` do gałęzi automatycznej i commita;
- `pull-requests: write` do utworzenia oraz scalenia PR-a;
- `actions: write` do ręcznego uruchomienia publikacji.

Workflow publikacji wymaga `contents: read`, `pages: write` i `id-token: write`. Repozytorium musi pozwalać GitHub Actions tworzyć oraz zatwierdzać Pull Requesty, a źródłem Pages ma być GitHub Actions:

```bash
gh api --method PUT repos/kbpk/kino-muza-repertuar/actions/permissions/workflow \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=true

gh api --method POST repos/kbpk/kino-muza-repertuar/pages \
  -f build_type=workflow
```

Drugie polecenie wykonuje się tylko przy pierwszym włączeniu Pages. Reguły ochrony `main` muszą dopuszczać przyjęty sposób automatycznego scalania; jeśli wymagają dodatkowych checków lub auto-merge, workflow trzeba dostosować zamiast omijać ochronę gałęzi.

## Obsługa ręczna

Ręczne pobranie zawsze omija decyzję harmonogramu:

```bash
gh workflow run update-repertoire.yaml --repo kbpk/kino-muza-repertuar
```

Samą ponowną publikację istniejących danych uruchamia:

```bash
gh workflow run deploy-pages.yaml --repo kbpk/kino-muza-repertuar
```

Stan przebiegów i ich logi można sprawdzić poleceniami:

```bash
gh run list --workflow update-repertoire.yaml --repo kbpk/kino-muza-repertuar
gh run list --workflow deploy-pages.yaml --repo kbpk/kino-muza-repertuar
```

Awaria pobierania nie zmienia `main` ani Pages. Awaria po scaleniu danych, ale przed publikacją, pozostawia poprawne dane w Git; wtedy wystarczy ponowić `deploy-pages.yaml`. Brak świeżych danych sygnalizuje również viewer na podstawie `fetchedAt`.

## Późniejsze przełączenie na inny wariant

Nowy wariant może działać równolegle w trybie testowym, ale podczas tego etapu nie powinien zapisywać do `main` ani publikować Pages. Obecny pipeline pozostaje źródłem produkcyjnych danych.

Harmonogram `update-repertoire.yaml` wyłączamy dopiero po spełnieniu wszystkich warunków:

1. nowy wariant przechodzi kilka pełnych okien harmonogramu, w tym wtorkowe;
2. jego snapshoty, obrazy i `fetchedAt` są porównane z wynikiem obecnego scrapera;
3. publikacja Pages z nowego źródła została sprawdzona ręcznie;
4. monitoring oraz procedura ponowienia działają;
5. wskazano dokładny commit wyłączający stary harmonogram i przygotowano prosty rollback.

Cutover powinien wyłączyć tylko trigger `schedule` starego workflow. `workflow_dispatch` warto początkowo zachować jako ręczną drogę awaryjną. Nie przepisujemy historii Git w ramach przełączenia; zwykła retencja nadal usuwa z bieżącego drzewa pliki dni starsze niż 7 dni i osierocone plakaty.
