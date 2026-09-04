# Repertuar Kina Muza

Szybki i nieoficjalny podgląd repertuaru Kina Muza w Poznaniu.

## [Otwórz repertuar](https://kbpk.github.io/kino-muza-repertuar/)

Strona pokazuje seanse bez czekania na załadowanie pełnego serwisu kina. Możesz przeglądać repertuar według dat albo tytułów oraz filtrować seanse według dnia, godziny rozpoczęcia i najpóźniejszej godziny zakończenia.

Przy filmach znajdziesz:

- godziny i sale,
- krótki oraz pełny opis z Kina Muza,
- gatunki filmów z Filmwebu,
- język, napisy albo informację o dubbingu,
- plakaty,
- odnośniki i dostępne oceny z IMDb, Filmwebu oraz Rotten Tomatoes,
- bezpośredni link do zakupu biletu.

Domyślnie wyświetlany jest dzisiejszy repertuar. Starsze zapisane dni pozostają dostępne przyciskiem `‹`. Wybrany widok i motyw są zapamiętywane w przeglądarce, a układ działa na komputerach i telefonach.

## Dane i aktualizacje

Dane pochodzą z publicznego repertuaru [Kina Muza](https://www.kinomuza.pl/repertuar/). Strona jest projektem nieoficjalnym i nie jest powiązana z kinem. Informacje o seansach mogą się zmienić, dlatego przed zakupem warto sprawdzić dane na stronie Muzy.

Repertuar jest aktualizowany codziennie około 12:00 i 18:00 czasu polskiego, a we wtorki dodatkowo około 14:00 i 16:00. Dla każdego terminu GitHub dostaje dwie próby poza szczytem pełnej godziny oraz próbę ratunkową w kolejnej godzinie. Pierwszy sukces zapisany w `fetchedAt` blokuje duplikaty. Każda aktualizacja jest testowana, zapisywana w osobnym PR-ze i automatycznie publikowana na GitHub Pages. Jeśli mimo bufora dane pozostają starsze od ostatniej oczekiwanej aktualizacji, viewer pokazuje ostrzeżenie.

Cały aktualny repertuar jest dostępny również jako jeden dokument JSON:

`https://kbpk.github.io/kino-muza-repertuar/data/repertoire.json`

## Jak to działa

Viewer jest statyczną stroną bez serwera aplikacyjnego i kluczy API. GitHub Actions pobiera repertuar do pierwszego pustego dnia, zachowuje każdy dzień jako osobny plik JSON i optymalizuje plakaty do małych plików WebP. Podczas publikacji pliki dzienne są składane w zbiorczy `data/repertoire.json`, który nie jest dublowany w historii repozytorium. Opisy są pobierane podczas aktualizacji, a nie w przeglądarce użytkownika. Service Worker przechowuje ostatnią poprawną wersję do użycia podczas krótkiej awarii sieci.

Dopasowania do zewnętrznych baz wykorzystują polski i oryginalny tytuł, rok oraz reżysera. Jeśli dopasowanie nie jest wystarczająco pewne, link prowadzi do wyników wyszukiwania zamiast do potencjalnie błędnego filmu.

## Uruchomienie lokalne

Wymagany jest Node.js 20 lub nowszy.

```bash
npm ci
npm test
npm run build:data
npm start
```

Strona będzie dostępna pod `http://localhost:8080`.

## Licencja

Kod źródłowy jest dostępny na licencji [MIT](LICENSE). Licencja nie obejmuje repertuaru, opisów, ocen, plakatów, znaków towarowych ani innych materiałów pobieranych z zewnętrznych serwisów. Prawa do nich należą do ich właścicieli.

## Automatyzacja

- `.github/workflows/update-repertoire.yaml` pobiera dane, uruchamia testy, tworzy PR i automatycznie scala aktualizację.
- `.github/workflows/deploy-pages.yaml` testuje `main` i publikuje katalog `public` na GitHub Pages.

Konfigurację repozytorium wykonuje się przez GitHub CLI:

```bash
gh api --method PUT repos/kbpk/kino-muza-repertuar/actions/permissions/workflow \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=true

gh api --method POST repos/kbpk/kino-muza-repertuar/pages \
  -f build_type=workflow
```

Drugie polecenie jest potrzebne tylko raz, przy włączaniu GitHub Pages. Ręczne uruchomienie aktualizacji lub samej publikacji:

```bash
gh workflow run update-repertoire.yaml --repo kbpk/kino-muza-repertuar
gh workflow run deploy-pages.yaml --repo kbpk/kino-muza-repertuar
```

Skrypt pobierający rozpoznaje zmienne `MUZA_SOURCE_URL`, `MUZA_DAYS`, `OUTPUT_DIR`, `SKIP_IMAGES`, `SKIP_EXTERNAL` i `SKIP_MUZA_DETAILS`.

Oceny IMDb pochodzą z [IMDb Non-Commercial Datasets](https://developer.imdb.com/non-commercial-datasets/).
