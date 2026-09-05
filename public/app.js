import { dateLabel, detailsMetadata, externalLinks, fullDate, groupMovies, isRepertoireStale, mergeDaysByDate, metadata, nextAvailableDate, parseViewerParams, previousAvailableDate, searchMatches, showingMatchesHall, showingMatchesTime, sortMovies, viewerParams } from "./lib.js";

const VIEW_STORAGE_KEY = "muza-view";
const storedView = (() => {
  try {
    const value = localStorage.getItem(VIEW_STORAGE_KEY);
    return ["days", "movies"].includes(value) ? value : "days";
  } catch {
    return "days";
  }
})();
const initialParams = parseViewerParams(window.location.search, storedView);
const state = { index: null, currentDays: [], dayCache: new Map(), view: initialParams.view, query: initialParams.query, startTime: initialParams.startTime, endTime: initialParams.endTime, hallValues: [], halls: null, sortBy: initialParams.sortBy, dateFrom: initialParams.dateFrom, dateTo: initialParams.dateTo, selectedDate: initialParams.selectedDate, dayStripScrollLeft: 0 };
const content = document.querySelector("#content");
const updated = document.querySelector("#updated");
const freshnessWarning = document.querySelector("#freshness-warning");
const status = document.querySelector("#status");
const search = document.querySelector("#search");
const startTime = document.querySelector("#start-time");
const endTime = document.querySelector("#end-time");
const hallDropdown = document.querySelector("#hall-dropdown");
const hallSummary = document.querySelector("#hall-summary");
const hallOptions = document.querySelector("#hall-options");
const hallSelectAll = document.querySelector("#hall-select-all");
const hallSelectNone = document.querySelector("#hall-select-none");
const sort = document.querySelector("#sort");
const filterClear = document.querySelector("#filter-clear");
const searchRow = document.querySelector("#search-row");
const dateFilters = [...document.querySelectorAll(".date-filter")];
const dateFrom = document.querySelector("#date-from");
const dateTo = document.querySelector("#date-to");
const nativeFilterInputs = [dateFrom, dateTo, startTime, endTime];
const tabs = [...document.querySelectorAll("[role=tab]")];
const themeToggle = document.querySelector("#theme-toggle");
const themeColor = document.querySelector("#theme-color");
let detailsId = 0;
let movieListObserver = null;
let dayStripResizeObserver = null;
const MOVIE_RENDER_BATCH = 20;
search.value = state.query;
startTime.value = state.startTime;
endTime.value = state.endTime;
dateFrom.value = state.dateFrom;
dateTo.value = state.dateTo;
sort.value = state.sortBy;
for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.view === state.view));
for (const filter of dateFilters) filter.hidden = state.view !== "movies";

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const activeTheme = () => document.documentElement.dataset.theme || (systemTheme.matches ? "dark" : "light");

function updateThemeButton() {
  const dark = activeTheme() === "dark";
  themeToggle.querySelector("span").textContent = dark ? "☀" : "☾";
  themeToggle.setAttribute("aria-label", dark ? "Włącz jasny motyw" : "Włącz ciemny motyw");
  themeToggle.title = dark ? "Włącz jasny motyw" : "Włącz ciemny motyw";
  themeColor.content = dark ? "#171717" : "#ffffff";
}

themeToggle.addEventListener("click", () => {
  const theme = activeTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("muza-theme", theme);
  } catch {
    // Przełączenie działa także bez dostępu do pamięci lokalnej.
  }
  updateThemeButton();
});
systemTheme.addEventListener("change", updateThemeButton);
updateThemeButton();

function nativeFilterLabel(input) {
  if (!input.value) return "";
  if (input.type !== "date") return input.value;
  const [year, month, day] = input.value.split("-");
  return `${day}.${month}.${year}`;
}

function updateNativeFilterDisplay(input) {
  document.querySelector(`#${input.id}-value`).textContent = nativeFilterLabel(input);
}

function updateNativeFilterDisplays() {
  for (const input of nativeFilterInputs) updateNativeFilterDisplay(input);
}

for (const input of nativeFilterInputs) {
  input.addEventListener("click", () => {
    if (typeof input.showPicker !== "function") return;
    try {
      input.showPicker();
    } catch {
      // Samo kliknięcie nadal obsługuje natywny picker w przeglądarkach bez showPicker().
    }
  });
}

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function link(label, href, className = "text-link") {
  const node = element("a", className, label);
  try {
    const url = new URL(href, window.location.href);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported protocol");
    node.href = url.href;
  } catch {
    node.href = "#";
    node.setAttribute("aria-disabled", "true");
  }
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}

function matches(movie) {
  return searchMatches(movie, state.query);
}

function filteredMovies(days, from = "", to = "") {
  const movies = groupMovies(days.filter((day) => {
    const date = fullDate(day);
    return (!from || date >= from) && (!to || date <= to);
  }).map((day) => ({
    ...day,
    repertoire: (day?.repertoire || []).filter((show) => (
      matches(show)
      && showingMatchesTime(show, show.duration, state.startTime, state.endTime)
      && showingMatchesHall(show, state.halls)
    )),
  })));
  return sortMovies(movies, state.sortBy);
}

function timeFiltersActive() {
  return Boolean(state.startTime || state.endTime);
}

function dateFiltersActive() {
  return Boolean(state.dateFrom || state.dateTo);
}

function hallFilterActive() {
  return state.halls !== null && state.halls.size !== state.hallValues.length;
}

function updateHallControls() {
  const selected = state.halls || new Set(state.hallValues);
  const allSelected = selected.size === state.hallValues.length;
  hallSummary.textContent = allSelected
    ? "Wszystkie"
    : selected.size === 0
      ? "Brak"
      : [...selected].sort((left, right) => left.localeCompare(right, "pl", { numeric: true })).join(", ");
  hallSelectAll.disabled = allSelected;
  hallSelectNone.disabled = selected.size === 0;
}

function selectHalls(values) {
  state.halls = new Set(values);
  for (const checkbox of hallOptions.querySelectorAll("input")) checkbox.checked = state.halls.has(checkbox.value);
  updateHallControls();
  updateFilterClear();
  render();
}

function updateFilterClear() {
  const visible = timeFiltersActive() || hallFilterActive() || (state.view === "movies" && dateFiltersActive());
  filterClear.hidden = !visible;
  searchRow.classList.toggle("has-clear", visible);
}

function movieLinks(movie) {
  const wrapper = element("span", "links");
  const external = externalLinks(movie);
  const number = new Intl.NumberFormat("pl-PL");
  const score = (name, rating, votes, percent = false) => {
    if (rating == null) return votes == null ? name : `${name} (${number.format(votes)})`;
    const value = percent ? `${rating}%` : number.format(rating);
    return votes == null ? `${name} ${value}` : `${name} ${value} (${number.format(votes)})`;
  };
  wrapper.append(
    link(score("Filmweb", movie.external?.filmweb?.rating, movie.external?.filmweb?.votes), external.filmweb),
    link(score("IMDb", movie.external?.imdb?.rating, movie.external?.imdb?.votes), external.imdb),
    link(score("Rotten Tomatoes", movie.external?.rottenTomatoes?.criticsRating, movie.external?.rottenTomatoes?.criticsVotes, true), external.rottenTomatoes),
  );
  return wrapper;
}

function details(movie) {
  const hasLongDescription = movie.longDescription && movie.longDescription.trim() !== movie.description?.trim();
  const button = element("button", "details-toggle", "Szczegóły");
  const body = element("div", "details-body");
  const id = `movie-details-${++detailsId}`;
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", id);
  body.id = id;
  body.hidden = true;
  const facts = detailsMetadata(movie);
  if (facts.length) {
    const list = element("dl", "details-meta");
    for (const [name, value] of facts) {
      list.append(element("dt", "details-name", name), element("dd", "details-value", value));
    }
    body.append(list);
  }
  if (hasLongDescription) body.append(element("p", "description long-description", movie.longDescription));
  button.addEventListener("click", () => {
    body.hidden = !body.hidden;
    button.setAttribute("aria-expanded", String(!body.hidden));
  });
  return { button: facts.length || hasLongDescription ? button : null, body };
}

function titleBlock(movie) {
  const block = element("div", "title-block");
  const heading = element("h3", "movie-title");
  const title = movie.movieLink
    ? link(movie.title, movie.movieLink, "movie-title-link")
    : element("span", "movie-title-text", movie.title);
  if (movie.originalTitle && movie.originalTitle !== movie.title) title.append(element("span", "original-title", ` (${movie.originalTitle})`));
  heading.append(title);
  block.append(heading);
  const meta = metadata(movie);
  if (meta.length) {
    const metaLine = element("p", "meta");
    for (const value of meta) metaLine.append(element("span", "meta-item", value));
    block.append(metaLine);
  }
  if (movie.description) block.append(element("p", "short-description", movie.description));
  const expanded = details(movie);
  const actions = element("div", "movie-actions");
  actions.append(movieLinks(movie));
  if (expanded.button) {
    actions.append(expanded.button);
    block.append(actions, expanded.body);
  } else {
    block.append(actions);
  }
  return block;
}

function movieBlock(movie) {
  const wrapper = element("div", "movie-info");
  if (movie.poster) {
    const poster = element("img", "movie-poster");
    poster.src = `./${String(movie.poster).replace(/^\.?\//, "")}`;
    poster.alt = "";
    poster.width = 96;
    poster.height = 138;
    poster.loading = "lazy";
    poster.decoding = "async";
    poster.addEventListener("error", () => {
      poster.remove();
      wrapper.classList.remove("has-poster");
    });
    wrapper.classList.add("has-poster");
    wrapper.append(poster);
  }
  wrapper.append(titleBlock(movie));
  return wrapper;
}

function timeWithHall(show) {
  const item = show.ticketLink ? link("", show.ticketLink, "showtime") : element("span", "showtime no-ticket");
  item.append(element("strong", "show-hour", show.hour));
  if (show.hall) item.append(element("span", "show-hall", `sala ${show.hall}`));
  return item;
}

function fitDayLabels(dayStrip) {
  const labels = [...dayStrip.querySelectorAll(".day-label.has-short")];
  for (const label of labels) label.classList.remove("is-compact");
  for (const label of labels) {
    const full = label.querySelector(".day-label-full");
    label.classList.toggle("is-compact", full.scrollWidth > label.clientWidth);
  }
}

function enableDayStripDragging(dayStrip) {
  let pointerId = null;
  let startX = 0;
  let startScrollLeft = 0;
  let dragged = false;
  let suppressClick = false;

  dayStrip.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startScrollLeft = dayStrip.scrollLeft;
    dragged = false;
  });
  dayStrip.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    const distance = event.clientX - startX;
    if (Math.abs(distance) > 4) {
      dragged = true;
      dayStrip.classList.add("dragging");
      if (!dayStrip.hasPointerCapture(pointerId)) dayStrip.setPointerCapture(pointerId);
    }
    if (!dragged) return;
    event.preventDefault();
    dayStrip.scrollLeft = startScrollLeft - distance;
  });
  const finishDragging = (event) => {
    if (event.pointerId !== pointerId) return;
    if (dragged) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    dayStrip.classList.remove("dragging");
    if (dayStrip.hasPointerCapture(pointerId)) dayStrip.releasePointerCapture(pointerId);
    pointerId = null;
  };
  dayStrip.addEventListener("pointerup", finishDragging);
  dayStrip.addEventListener("pointercancel", finishDragging);
  dayStrip.addEventListener("click", (event) => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  dayStrip.addEventListener("dragstart", (event) => event.preventDefault());
}

function renderDayPicker(days, target) {
  const picker = element("div", "day-picker");
  const dayStrip = element("div", "day-strip");
  picker.setAttribute("aria-label", "Wybierz dzień");
  dayStrip.addEventListener("scroll", () => {
    state.dayStripScrollLeft = dayStrip.scrollLeft;
  }, { passive: true });
  enableDayStripDragging(dayStrip);
  const previousDate = previousAvailableDate(state.index.availableDates, state.selectedDate);
  const nextDate = nextAvailableDate(state.index.availableDates, state.selectedDate);
  const navigationButton = (label, date, direction) => {
    const button = element("button", "date-arrow", label);
    button.type = "button";
    button.disabled = !date;
    button.title = `${direction} dzień`;
    button.setAttribute("aria-label", `${direction} dostępny dzień`);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await loadDay(date);
        state.selectedDate = date;
        render();
      } catch {
        button.disabled = false;
        status.textContent = "Nie udało się wczytać wybranego dnia.";
      }
    });
    return button;
  };
  picker.append(navigationButton("‹", previousDate, "Poprzedni"));
  for (const day of days) {
    const date = fullDate(day);
    const button = element("button", "day-button");
    const fullLabel = dateLabel(day).split(",")[0];
    const label = element("span", "day-label");
    const shortLabel = date
      ? new Intl.DateTimeFormat("pl-PL", { weekday: "short" }).format(new Date(`${date}T12:00:00`))
      : fullLabel;
    button.type = "button";
    button.setAttribute("aria-label", dateLabel(day));
    button.classList.toggle("active", date === state.selectedDate);
    label.append(element("span", "day-label-full", fullLabel));
    if (fullLabel.length > 7) {
      label.classList.add("has-short");
      label.append(element("span", "day-label-short", shortLabel));
    }
    button.append(label, element("strong", "day-date", day.date));
    button.addEventListener("click", () => {
      state.selectedDate = date;
      render();
    });
    dayStrip.append(button);
  }
  picker.append(dayStrip, navigationButton("›", nextDate, "Następny"));
  target.append(picker);
  return dayStrip;
}

function revealSelectedDay(dayStrip) {
  const selected = dayStrip.querySelector(".day-button.active");
  if (!selected) return;
  const stripRect = dayStrip.getBoundingClientRect();
  const selectedRect = selected.getBoundingClientRect();
  if (selectedRect.left < stripRect.left) {
    dayStrip.scrollLeft += selectedRect.left - stripRect.left;
  } else if (selectedRect.right > stripRect.right) {
    dayStrip.scrollLeft += selectedRect.right - stripRect.right;
  }
  state.dayStripScrollLeft = dayStrip.scrollLeft;
}

function renderDays() {
  const previousStrip = content.querySelector(".day-strip");
  if (previousStrip) state.dayStripScrollLeft = previousStrip.scrollLeft;
  const wrapper = element("div");
  const pickerDays = mergeDaysByDate(state.currentDays, state.dayCache.values());
  const dayStrip = renderDayPicker(pickerDays, wrapper);
  const day = state.dayCache.get(state.selectedDate) || state.currentDays[0];
  const movies = filteredMovies([day]);
  const heading = element("div", "list-heading");
  heading.append(element("h2", "view-title", dateLabel(day)), element("span", "count", `${movies.length} tytułów`));
  wrapper.append(heading);
  if (day.info?.length) {
    for (const item of day.info) wrapper.append(element("p", "notice", typeof item === "string" ? item : JSON.stringify(item)));
  }
  const list = element("div", "compact-list");
  for (const movie of movies) {
    const row = element("article", "movie-row");
    row.append(movieBlock(movie));
    const times = element("div", "times");
    for (const show of movie.showings) times.append(timeWithHall(show));
    row.append(times);
    list.append(row);
  }
  if (!movies.length) list.append(element("p", "empty", state.query ? "Brak pasujących filmów." : "Brak zaplanowanych seansów."));
  wrapper.append(list);
  content.replaceChildren(wrapper);
  dayStrip.scrollLeft = state.dayStripScrollLeft;
  revealSelectedDay(dayStrip);
  fitDayLabels(dayStrip);
  if ("ResizeObserver" in window) {
    dayStripResizeObserver = new ResizeObserver(() => fitDayLabels(dayStrip));
    dayStripResizeObserver.observe(dayStrip);
  }
  status.textContent = "";
}

function groupedShowings(showings) {
  const groups = new Map();
  for (const show of showings) {
    const key = show.datetime?.slice(0, 10) || show.date;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(show);
  }
  return [...groups.values()];
}

function titleViewRow(movie) {
  const row = element("article", "movie-row title-view-row");
  row.append(movieBlock(movie));
  const schedule = element("div", "date-groups");
  for (const shows of groupedShowings(movie.showings)) {
    const group = element("div", "date-group");
    const date = new Date(`${shows[0].datetime.slice(0, 10)}T12:00:00`);
    group.append(element("span", "date-name", new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short" }).format(date)));
    const times = element("span", "date-times");
    for (const show of shows) times.append(timeWithHall(show));
    group.append(times);
    schedule.append(group);
  }
  row.append(schedule);
  return row;
}

function renderMovies(days) {
  const movies = filteredMovies(days, state.dateFrom, state.dateTo);
  const wrapper = element("div");
  const list = element("div", "compact-list");
  let rendered = 0;
  const appendBatch = () => {
    const fragment = document.createDocumentFragment();
    const limit = Math.min(rendered + MOVIE_RENDER_BATCH, movies.length);
    while (rendered < limit) fragment.append(titleViewRow(movies[rendered++]));
    list.append(fragment);
  };

  if (movies.length) {
    appendBatch();
  } else {
    list.append(element("p", "empty", "Brak pasujących seansów."));
  }
  wrapper.append(list);
  const sentinel = rendered < movies.length ? element("div", "render-sentinel") : null;
  if (sentinel) {
    sentinel.setAttribute("aria-hidden", "true");
    wrapper.append(sentinel);
  }
  content.replaceChildren(wrapper);

  if (sentinel && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      appendBatch();
      if (rendered >= movies.length) {
        observer.disconnect();
        if (movieListObserver === observer) movieListObserver = null;
        sentinel.remove();
      }
    }, { rootMargin: "800px 0px" });
    movieListObserver = observer;
    observer.observe(sentinel);
  } else if (sentinel) {
    while (rendered < movies.length) appendBatch();
    sentinel.remove();
  }
  status.textContent = state.query || timeFiltersActive() || hallFilterActive() || dateFiltersActive() ? `Znaleziono: ${movies.length}` : "";
}

function render() {
  if (!state.index) return;
  const url = new URL(window.location.href);
  url.search = viewerParams(state, state.hallValues).toString();
  window.history.replaceState(null, "", url);
  if (dayStripResizeObserver) {
    dayStripResizeObserver.disconnect();
    dayStripResizeObserver = null;
  }
  if (movieListObserver) {
    movieListObserver.disconnect();
    movieListObserver = null;
  }
  if (state.view === "days") renderDays();
  else renderMovies(state.currentDays);
}

async function loadDay(date) {
  if (state.dayCache.has(date)) return state.dayCache.get(date);
  const response = await fetch(`./data/days/${date}.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  state.dayCache.set(date, payload.day);
  return payload.day;
}

async function load() {
  try {
    const response = await fetch("./data/index.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.index = await response.json();
    state.currentDays = await Promise.all(state.index.currentDates.map(loadDay));
    const halls = [...new Set(state.currentDays.flatMap((day) => day.repertoire || []).map((show) => String(show.hall || "").trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "pl", { numeric: true }));
    state.hallValues = halls;
    state.halls = initialParams.halls === null
      ? new Set(halls)
      : new Set(initialParams.halls.filter((hall) => halls.includes(hall)));
    for (const value of halls) {
      const label = element("label", "hall-option");
      const checkbox = element("input", "hall-checkbox");
      checkbox.type = "checkbox";
      checkbox.value = value;
      checkbox.checked = state.halls.has(value);
      checkbox.setAttribute("aria-label", `Sala ${value}`);
      label.append(checkbox, element("span", "", value));
      hallOptions.append(label);
    }
    updateHallControls();
    const availableDates = state.currentDays.map(fullDate).filter(Boolean).sort();
    if (availableDates.length) {
      for (const input of [dateFrom, dateTo]) {
        input.min = availableDates[0];
        input.max = availableDates.at(-1);
      }
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
    if (!initialParams.present && !state.dateFrom) state.dateFrom = today;
    dateFrom.value = state.dateFrom;
    dateTo.value = state.dateTo;
    updateNativeFilterDisplays();
    const availableArchive = state.index.availableDates || state.index.currentDates;
    if (state.selectedDate && availableArchive.includes(state.selectedDate)) {
      await loadDay(state.selectedDate);
    } else {
      state.selectedDate = state.index.currentDates.includes(today) ? today : state.index.currentDates[0];
    }
    const date = new Date(state.index.fetchedAt);
    updated.textContent = `Aktualizacja: ${new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date)}`;
    freshnessWarning.hidden = !isRepertoireStale(state.index.fetchedAt);
    updateFilterClear();
    render();
  } catch (error) {
    content.replaceChildren(element("p", "load-error", "Nie udało się wczytać repertuaru."));
    updated.textContent = `Błąd: ${error.message}`;
  }
}

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    state.view = tab.dataset.view;
    for (const filter of dateFilters) filter.hidden = state.view !== "movies";
    updateFilterClear();
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, state.view);
    } catch {
      // Widok nadal działa, nawet gdy przeglądarka blokuje pamięć lokalną.
    }
    for (const item of tabs) item.setAttribute("aria-selected", String(item === tab));
    render();
  });
}

search.addEventListener("input", () => {
  state.query = search.value.trim();
  render();
});

for (const input of [dateFrom, dateTo]) {
  const updateDateFilters = () => {
    if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) {
      if (input === dateFrom) dateTo.value = dateFrom.value;
      else dateFrom.value = dateTo.value;
    }
    state.dateFrom = dateFrom.value;
    state.dateTo = dateTo.value;
    updateNativeFilterDisplays();
    updateFilterClear();
    render();
  };
  input.addEventListener("input", updateDateFilters);
  input.addEventListener("change", updateDateFilters);
}

function updateTimeFilters() {
  state.startTime = startTime.value;
  state.endTime = endTime.value;
  updateNativeFilterDisplays();
  updateFilterClear();
  render();
}

for (const input of [startTime, endTime]) {
  input.addEventListener("input", updateTimeFilters);
  input.addEventListener("change", updateTimeFilters);
}

sort.addEventListener("change", () => {
  state.sortBy = sort.value;
  render();
});

hallOptions.addEventListener("change", () => {
  state.halls = new Set([...hallOptions.querySelectorAll("input:checked")].map((input) => input.value));
  updateHallControls();
  updateFilterClear();
  render();
});

hallSelectAll.addEventListener("click", () => selectHalls(state.hallValues));
hallSelectNone.addEventListener("click", () => selectHalls([]));

document.addEventListener("click", (event) => {
  if (hallDropdown.open && !hallDropdown.contains(event.target)) hallDropdown.open = false;
});
hallDropdown.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  hallDropdown.open = false;
  hallSummary.focus();
});

filterClear.addEventListener("click", () => {
  dateFrom.value = "";
  dateTo.value = "";
  startTime.value = "";
  endTime.value = "";
  state.dateFrom = "";
  state.dateTo = "";
  state.startTime = "";
  state.endTime = "";
  updateNativeFilterDisplays();
  selectHalls(state.hallValues);
});

load();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
