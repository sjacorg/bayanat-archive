/*
 * Search page glue layer.
 * - HTMX: requests/swaps server-rendered fragments
 * - Alpine: local interactive state + template bindings
 * - This file: shared helpers + cross-swap synchronization
 */
(function () {
    function readLabelParams(params) {
        const values = params.getAll('label').flatMap((raw) =>
            String(raw || '').split(',').map((v) => v.trim()).filter(Boolean)
        );
        return [...new Set(values)];
    }

    function facetDetailFromUrl(params) {
        return {
            label: readLabelParams(params),
            location: params.getAll('location'),
            view: params.get('view') || 'grid',
            date_from: params.get('date_from') || '',
            date_to: params.get('date_to') || '',
        };
    }

    function getTimelineConfig(overrideConfig = null) {
        const cfg = overrideConfig && typeof overrideConfig === 'object'
            ? overrideConfig
            : (window.SEARCH_PAGE_CONFIG || {});
        const minYear = Number.parseInt(cfg.minYear, 10);
        const maxYear = Number.parseInt(cfg.maxYear, 10);
        const timelineYears = Array.isArray(cfg.timelineYears)
            ? cfg.timelineYears
                .map((year) => Number.parseInt(year, 10))
                .filter((year) => Number.isInteger(year))
            : [];

        const fallbackYear = new Date().getFullYear();
        const safeMinYear = Number.isInteger(minYear) ? minYear : fallbackYear;
        const safeMaxYear = Number.isInteger(maxYear) ? maxYear : safeMinYear;

        return {
            minYear: safeMinYear,
            maxYear: safeMaxYear,
            timelineYears,
        };
    }

    // Expose for template expressions and event listeners.
    window.readLabelParams = readLabelParams;

    window.searchPageState = function searchPageState(overrideConfig = null) {
        // Timeline math must use the exact years present in bins (not min+index).
        const cfg = getTimelineConfig(overrideConfig);
        const timelineYears = cfg.timelineYears;
        const timelineCount = Math.max(timelineYears.length, 1);

        return {
            open: null,
            view: new URLSearchParams(window.location.search).get('view') || 'grid',
            timePanelOpen: false,
            minYear: cfg.minYear,
            maxYear: cfg.maxYear,
            timelineYears,
            timelineCount,
            yearStart: cfg.minYear,
            yearEnd: cfg.maxYear,
            startIndex: 0,
            endIndex: Math.max(timelineCount - 1, 0),
            timelineApplyTimer: null,
            lastSubmittedYearRange: `${cfg.minYear}-${cfg.maxYear}`,
            mobileDrawerOpen: false,
            mobileFacetOpen: null,
            mobileSearch: { label: '', location: '' },
            mobileSelected: { label: [], location: [] },

            normalizeYear(raw, fallback) {
                const parsed = Number.parseInt(raw, 10);
                if (Number.isNaN(parsed)) return fallback;
                return Math.min(this.maxYear, Math.max(this.minYear, parsed));
            },

            yearToIndex(year, edge = 'nearest') {
                if (!this.timelineYears.length) return 0;
                const target = this.normalizeYear(year, this.minYear);
                const exactIdx = this.timelineYears.indexOf(target);
                if (exactIdx !== -1) return exactIdx;

                // Start/end bounds clamp to the nearest valid year in the requested direction.
                if (edge === 'start') {
                    for (let i = 0; i < this.timelineYears.length; i += 1) {
                        if (this.timelineYears[i] >= target) return i;
                    }
                    return this.timelineYears.length - 1;
                }

                if (edge === 'end') {
                    for (let i = this.timelineYears.length - 1; i >= 0; i -= 1) {
                        if (this.timelineYears[i] <= target) return i;
                    }
                    return 0;
                }

                // Fallback: nearest available year.
                let bestIdx = 0;
                let bestDistance = Infinity;
                for (let i = 0; i < this.timelineYears.length; i += 1) {
                    const distance = Math.abs(this.timelineYears[i] - target);
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestIdx = i;
                    }
                }
                return bestIdx;
            },

            indexToYear(index) {
                const idx = Math.min(this.timelineCount - 1, Math.max(0, index));
                return this.timelineYears[idx] ?? this.minYear;
            },

            syncIndicesFromYears() {
                this.startIndex = this.yearToIndex(this.yearStart, 'start');
                this.endIndex = this.yearToIndex(this.yearEnd, 'end');
                if (this.startIndex > this.endIndex) {
                    this.startIndex = this.endIndex;
                }
                this.syncYearsFromIndices();
            },

            syncYearsFromIndices() {
                this.yearStart = this.indexToYear(this.startIndex);
                this.yearEnd = this.indexToYear(this.endIndex);
            },

            hydrateYearRangeFromUrl(params = new URLSearchParams(window.location.search)) {
                // URL is canonical source when entering/re-entering the page.
                const fromYear = (params.get('date_from') || '').slice(0, 4) || params.get('year_start');
                const toYear = (params.get('date_to') || '').slice(0, 4) || params.get('year_end');
                this.yearStart = this.normalizeYear(fromYear, this.minYear);
                this.yearEnd = this.normalizeYear(toYear, this.maxYear);
                if (this.yearStart > this.yearEnd) {
                    [this.yearStart, this.yearEnd] = [this.yearEnd, this.yearStart];
                }
                this.syncIndicesFromYears();
                this.lastSubmittedYearRange = `${this.yearStart}-${this.yearEnd}`;
            },

            writeInputValue(inputEl, value) {
                if (inputEl) {
                    inputEl.value = String(value);
                }
            },

            commitYearStart(value, inputEl = null) {
                // Commit on blur/change/enter so typing (e.g. Cmd+A replace) stays smooth.
                const normalized = this.normalizeYear(value, this.yearStart);
                const nextStart = Math.min(normalized, this.yearEnd);
                if (nextStart === this.yearStart) {
                    this.writeInputValue(inputEl, this.yearStart);
                    return;
                }

                this.yearStart = nextStart;
                this.syncIndicesFromYears();
                this.writeInputValue(inputEl, this.yearStart);
                this.scheduleTimeRangeApply();
            },

            commitYearEnd(value, inputEl = null) {
                const normalized = this.normalizeYear(value, this.yearEnd);
                const nextEnd = Math.max(normalized, this.yearStart);
                if (nextEnd === this.yearEnd) {
                    this.writeInputValue(inputEl, this.yearEnd);
                    return;
                }

                this.yearEnd = nextEnd;
                this.syncIndicesFromYears();
                this.writeInputValue(inputEl, this.yearEnd);
                this.scheduleTimeRangeApply();
            },

            commitYearStartFromEvent(event) {
                this.commitYearStart(event.target.value, event.target);
            },

            commitYearEndFromEvent(event) {
                this.commitYearEnd(event.target.value, event.target);
            },

            setStartIndex(rawValue, inputEl = null) {
                const parsed = Number.parseInt(rawValue, 10);
                const fallback = this.startIndex;
                const nextStart = Number.isNaN(parsed) ? fallback : parsed;
                const clamped = Math.min(this.endIndex, Math.max(0, nextStart));
                if (clamped === this.startIndex) {
                    if (inputEl) inputEl.value = String(this.startIndex);
                    return;
                }
                this.startIndex = clamped;
                this.syncYearsFromIndices();
                this.scheduleTimeRangeApply();
            },

            setEndIndex(rawValue, inputEl = null) {
                const parsed = Number.parseInt(rawValue, 10);
                const fallback = this.endIndex;
                const nextEnd = Number.isNaN(parsed) ? fallback : parsed;
                const clampedEnd = Math.min(this.timelineCount - 1, Math.max(this.startIndex, nextEnd));
                if (clampedEnd === this.endIndex) {
                    if (inputEl) inputEl.value = String(this.endIndex);
                    return;
                }
                this.endIndex = clampedEnd;
                this.syncYearsFromIndices();
                this.scheduleTimeRangeApply();
            },

            selectSingleYearIndex(rawValue) {
                const parsed = Number.parseInt(rawValue, 10);
                const idx = Number.isNaN(parsed) ? 0 : parsed;
                const clamped = Math.min(this.timelineCount - 1, Math.max(0, idx));
                this.startIndex = clamped;
                this.endIndex = clamped;
                this.syncYearsFromIndices();
                clearTimeout(this.timelineApplyTimer);
                this.applyTimeRange();
            },

            leftSliderStyle() {
                if (this.timelineCount <= 1) return 'left:0; width:100%;';
                const step = 100 / this.timelineCount;
                const offset = 10 * 2;
                return `left:0%; width: calc(100% - ${step}% + ${offset}px);`;
            },

            rightSliderStyle() {
                if (this.timelineCount <= 1) return 'left:0; width:100%;';
                const step = 100 / this.timelineCount;
                const offset = 10 * 2;
                return `left:${step}%; width: calc(100% - ${step}% + ${offset}px);`;
            },

            selectedRangeStyle() {
                const total = this.timelineCount || 1;
                const left = (this.startIndex / total) * 100;
                const right = ((this.endIndex + 1) / total) * 100;
                return `left:${left}%; width:${Math.max(1, right - left)}%;`;
            },

            readSelectedFromUrl() {
                // URL remains source of truth; mobile drawer clones it into draft state.
                const p = new URLSearchParams(window.location.search);
                return {
                    label: readLabelParams(p),
                    location: p.getAll('location'),
                };
            },

            openMobileFilters() {
                this.timePanelOpen = false;
                this.mobileSelected = this.readSelectedFromUrl();
                this.mobileDrawerOpen = true;
                this.mobileFacetOpen = null;
                this.mobileSearch = { label: '', location: '' };
                document.body.classList.add('overflow-hidden');
            },

            closeMobileFilters() {
                this.mobileDrawerOpen = false;
                this.mobileFacetOpen = null;
                document.body.classList.remove('overflow-hidden');
            },

            isMobileSelected(key, value) {
                return (this.mobileSelected[key] || []).includes(value);
            },

            mobileMatches(key, value) {
                const term = (this.mobileSearch[key] || '').trim().toLowerCase();
                if (!term) return true;
                return String(value).toLowerCase().includes(term);
            },

            clearMobileFilters() {
                this.mobileSelected = { label: [], location: [] };
                this.mobileSearch = { label: '', location: '' };
            },

            applyTimeRange() {
                const nextRange = `${this.yearStart}-${this.yearEnd}`;
                if (nextRange === this.lastSubmittedYearRange) return;
                this.lastSubmittedYearRange = nextRange;
                this.$nextTick(() => this.$refs.mobileApplyTrigger?.click());
            },

            toggleTimePanel() {
                if (this.timePanelOpen) {
                    this.timePanelOpen = false;
                    this.applyTimeRange();
                    return;
                }
                this.open = null;
                this.timePanelOpen = true;
            },

            emitFacetSync(detail) {
                // Keep desktop facets, toolbar view toggle, and mobile draft in sync.
                document.dispatchEvent(new CustomEvent('facets-sync', { detail }));
            },

            applyMobileFilters() {
                // 1) broadcast draft selection, 2) close drawer, 3) fire HTMX request.
                this.emitFacetSync({
                    label: [...this.mobileSelected.label],
                    location: [...this.mobileSelected.location],
                    view: this.view,
                    date_from: this.yearStart > this.minYear ? `${this.yearStart}-01-01` : '',
                    date_to: this.yearEnd < this.maxYear ? `${this.yearEnd}-12-31` : '',
                });
                this.closeMobileFilters();
                this.$nextTick(() => this.$refs.mobileApplyTrigger?.click());
            },

            syncMobileFromDetail(detail) {
                this.view = detail?.view || 'grid';
                this.mobileSelected = {
                    label: detail?.label || [],
                    location: detail?.location || [],
                };
                this.yearStart = this.normalizeYear((detail?.date_from || '').slice(0, 4), this.minYear);
                this.yearEnd = this.normalizeYear((detail?.date_to || '').slice(0, 4), this.maxYear);
                if (this.yearStart > this.yearEnd) {
                    [this.yearStart, this.yearEnd] = [this.yearEnd, this.yearStart];
                }
                this.syncIndicesFromYears();
                this.lastSubmittedYearRange = `${this.yearStart}-${this.yearEnd}`;
            },
            scheduleTimeRangeApply() {
                if (!this.timePanelOpen) return;
                clearTimeout(this.timelineApplyTimer);
                this.timelineApplyTimer = setTimeout(() => this.applyTimeRange(), 220);
            },
        };
    };

    if (!window.__searchResultsListenersBound) {
        // Bind once across boosted swaps; this script can execute multiple times.

        // Smooth crossfade on every #results swap.
        document.body.addEventListener('htmx:beforeSwap', function (evt) {
            const detail = evt.detail;
            if (!detail || detail.target?.id !== 'results' || !detail.swapSpec) return;
            detail.swapSpec.transition = true;
        });

        // After each results swap, rehydrate Alpine state from the canonical URL.
        document.body.addEventListener('htmx:afterSettle', function (evt) {
            const detail = evt.detail;
            if (!detail || detail.target?.id !== 'results') return;
            const p = new URLSearchParams(window.location.search);
            document.dispatchEvent(new CustomEvent('facets-sync', {
                detail: facetDetailFromUrl(p),
            }));
        });

        window.__searchResultsListenersBound = true;
    }
})();
