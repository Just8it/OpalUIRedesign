import { openSurface, closeSurface } from '../motion';
/* ━━ Calendar Widget ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Real calendar with month/week views, ICS events, OPAL events.
 * View switches based on widget HEIGHT:
 *   h >= 5  →  Month view (full month grid + day detail)
 *   h <  5  →  Week view (7-day strip + event list)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { formatDate } from '../i18n/core.ts';
import { t } from '../i18n/messages/widgets.ts';
import type { Widget, CalendarData } from '../types.ts';
import { escapeHtml } from '../utils';
import { getEventCourseColor } from '../course-matcher';
import { bindDialogKeyboard, switchRow } from '../settings';
import {
  type CalendarEvent,
  loadCalendarEvents,
  expandRecurring,
  getEventsForDay,
  getEventsForMonth,
  getWeekStart,
  addCustomEvent,
} from '../calendar-store.ts';

/* ── Types ─────────────────────────────────────────────────── */

interface CalendarState {
  events: CalendarEvent[];
  selectedDate: Date;
  viewMonth: number;   // 0-11
  viewYear: number;
  widgetH: number;     // grid height units
}

/* ── Module state ──────────────────────────────────────────── */

const calState: CalendarState = {
  events: [],
  selectedDate: new Date(),
  viewMonth: new Date().getMonth(),
  viewYear: new Date().getFullYear(),
  widgetH: 3,
};

let eventsLoaded = false;

/* ── Event colors ──────────────────────────────────────────── */

const EVENT_COLORS = [
  'var(--color-opal-accent)', 'var(--color-module-pink)', 'var(--color-opal-success)', 'var(--color-opal-warning)', 'var(--color-module-blue)',
  'var(--color-module-violet)', 'var(--color-opal-danger)', 'var(--color-module-teal)', 'var(--color-module-orange)', 'var(--color-module-indigo)',
];

function getEventColor(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash) + title.charCodeAt(i);
  }
  return EVENT_COLORS[Math.abs(hash) % EVENT_COLORS.length];
}

/* Colours reach a style attribute, and ev.color comes from stored or imported
 * data. Only a hex value or one of the token references this code produces
 * gets through; anything else falls back to a neutral token. */
const SAFE_COLOR = /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|var\(--color-(?:opal|module)-[a-z0-9-]+\))$/i;
const NEUTRAL_COLOR = 'var(--color-opal-text-muted)';

function safeColor(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && SAFE_COLOR.test(v) ? v : null;
}

function eventColor(ev: CalendarEvent): string {
  return safeColor(ev.color) ?? safeColor(getEventCourseColor(ev.title)) ?? safeColor(getEventColor(ev.title)) ?? NEUTRAL_COLOR;
}

/* ── Time formatting ───────────────────────────────────────── */

function formatTime(isoStr: string): string {
  return formatDate(new Date(isoStr), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function formatDuration(start: string, end: string): string {
  return t('calendarTimeRange', { start: formatTime(start), end: formatTime(end) });
}

/* ── Shared markup ─────────────────────────────────────────── */

const ICON_PREV = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const ICON_NEXT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
const ICON_ADD = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

function navButton(action: string, label: string, icon: string): string {
  return `<button type="button" class="cal-nav-btn" data-cal-action="${action}" aria-label="${label}" title="${label}">${icon}</button>`;
}

function dayLabel(d: Date): string {
  return formatDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function dayButtonLabel(d: Date, isToday: boolean, hasEvents: boolean): string {
  const date = dayLabel(d);
  if (isToday) return t(hasEvents ? 'calendarTodayWithEvents' : 'calendarToday', { date });
  return hasEvents ? t('calendarWithEvents', { date }) : date;
}

function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

function renderEventList(dayEvents: CalendarEvent[], limit: number, day: Date): string {
  if (dayEvents.length === 0) {
    return `
      <div class="opal-empty py-2">
        <p class="opal-empty-title">${t('calendarNoEvents', { date: formatDate(day, { day: 'numeric', month: 'long' }) })}</p>
        <p class="opal-empty-hint">${t('calendarNoEventsHint')}</p>
      </div>`;
  }
  return dayEvents.slice(0, limit).map(ev => `
        <div class="cal-event-item">
          <div class="cal-event-color" style="background:${eventColor(ev)}"></div>
          <div class="cal-event-info">
            <span class="cal-event-time">${formatDuration(ev.start, ev.end)}</span>
            <span class="cal-event-title">${escapeHtml(ev.title)}</span>
            ${ev.location ? `<span class="cal-event-location">${escapeHtml(ev.location)}</span>` : ''}
          </div>
        </div>`).join('');
}

/* ── Build month grid ──────────────────────────────────────── */

function buildMonthView(state: CalendarState): string {
  const { viewYear, viewMonth, selectedDate, events } = state;
  const today = new Date();

  // Expand recurring events for this month
  const monthStart = new Date(viewYear, viewMonth, 1);
  const monthEnd = new Date(viewYear, viewMonth + 1, 0, 23, 59, 59);
  const expanded = expandRecurring(events, monthStart, monthEnd);
  const monthEvents = getEventsForMonth(expanded, viewYear, viewMonth);

  // Build a set of days that have events
  const eventDays = new Set<number>();
    for (let day = 1; day <= new Date(viewYear, viewMonth + 1, 0).getDate(); day++) {
        if (getEventsForDay(monthEvents, new Date(viewYear, viewMonth, day)).length) eventDays.add(day);
    }

  // Calendar grid setup
  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // Monday=0
  const daysInMonth = lastDay.getDate();

  // Day headers
  const headers = weekDays(getWeekStart(firstDay)).map(d =>
    `<div class="cal-day-header" aria-hidden="true">${formatDate(d, { weekday: 'short' })}</div>`
  ).join('');

  // Day cells
  const cells: string[] = [];
  // Leading empty cells
  for (let i = 0; i < startDow; i++) {
    cells.push('<div class="cal-day cal-day-empty" aria-hidden="true"></div>');
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
    const isSelected = d === selectedDate.getDate() && viewMonth === selectedDate.getMonth() && viewYear === selectedDate.getFullYear();
    const hasEvents = eventDays.has(d);
    const classes = [
      'cal-day',
      isToday ? 'cal-day-today' : '',
      isSelected ? 'cal-day-selected' : '',
      hasEvents ? 'cal-day-has-events' : '',
    ].filter(Boolean).join(' ');

    const dots = hasEvents ? '<span class="cal-event-dot-container" aria-hidden="true"><span class="cal-event-dot"></span></span>' : '';
    const label = dayButtonLabel(new Date(viewYear, viewMonth, d), isToday, hasEvents);

    cells.push(`<button type="button" class="${classes}" data-cal-day="${d}" aria-label="${label}" aria-pressed="${isSelected}"${isToday ? ' aria-current="date"' : ''}>${d}${dots}</button>`);
  }

  // Events for selected day
  const selectedDayEvents = getEventsForDay(
    expandRecurring(events, new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()),
      new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 23, 59, 59)),
    selectedDate
  );

  return `
    <div class="cal-container cal-month-view">
      <div class="cal-nav">
        ${navButton('prev-month', t('calendarPreviousMonth'), ICON_PREV)}
        <span class="cal-nav-title">${formatDate(monthStart, { month: 'long', year: 'numeric' })}</span>
        <div class="flex items-center gap-0.5">
          ${navButton('next-month', t('calendarNextMonth'), ICON_NEXT)}
          ${navButton('add-event', t('calendarAddEvent'), ICON_ADD)}
        </div>
      </div>
      <div class="cal-month-grid">
        ${headers}
        ${cells.join('')}
      </div>
      <div class="cal-day-events" aria-label="${t('calendarEventsOn', { date: dayLabel(selectedDate) })}" role="region">
        ${renderEventList(selectedDayEvents, 5, selectedDate)}
      </div>
    </div>`;
}

/* ── Build week view ───────────────────────────────────────── */

function buildWeekView(state: CalendarState): string {
  const { selectedDate, events } = state;
  const today = new Date();
  const weekStart = getWeekStart(selectedDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59);

  // Expand recurring events for this week
  const expanded = expandRecurring(events, weekStart, weekEnd);

  // Build week day strip
  const dayStrip = weekDays(weekStart).map(d => {
    const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    const isSelected = d.getDate() === selectedDate.getDate() && d.getMonth() === selectedDate.getMonth() && d.getFullYear() === selectedDate.getFullYear();
    const dayEvents = getEventsForDay(expanded, d);
    const hasEvents = dayEvents.length > 0;
    const classes = [
      'cal-week-day',
      isToday ? 'cal-day-today' : '',
      isSelected ? 'cal-day-selected' : '',
      hasEvents ? 'cal-day-has-events' : '',
    ].filter(Boolean).join(' ');
    const ariaLabel = dayButtonLabel(d, isToday, hasEvents);

    return `<button type="button" class="${classes}" data-cal-day="${d.getDate()}" data-cal-month="${d.getMonth()}" data-cal-year="${d.getFullYear()}" aria-label="${ariaLabel}" aria-pressed="${isSelected}"${isToday ? ' aria-current="date"' : ''}>
      <span class="cal-week-label" aria-hidden="true">${formatDate(d, { weekday: 'short' })}</span>
      <span class="cal-week-date" aria-hidden="true">${d.getDate()}</span>
      ${hasEvents ? '<span class="cal-event-dot" aria-hidden="true"></span>' : ''}
    </button>`;
  }).join('');

  // Events of the selected day
  const todayEvents = getEventsForDay(expanded, selectedDate);

  const monthLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? formatDate(weekStart, { month: 'long', year: 'numeric' })
    : t('calendarMonthRange', {
      start: formatDate(weekStart, { month: 'long' }).slice(0, 3),
      end: formatDate(weekEnd, { month: 'long' }).slice(0, 3),
      year: formatDate(weekStart, { year: 'numeric' }),
    });

  return `
    <div class="cal-container cal-week-view">
      <div class="cal-nav">
        ${navButton('prev-week', t('calendarPreviousWeek'), ICON_PREV)}
        <span class="cal-nav-title">${monthLabel}</span>
        <div class="flex items-center gap-0.5">
          ${navButton('next-week', t('calendarNextWeek'), ICON_NEXT)}
          ${navButton('add-event', t('calendarAddEvent'), ICON_ADD)}
        </div>
      </div>
      <div class="cal-week-strip">${dayStrip}</div>
      <div class="cal-day-events" aria-label="${t('calendarEventsOn', { date: dayLabel(selectedDate) })}" role="region">${renderEventList(todayEvents, 4, selectedDate)}</div>
    </div>`;
}

/* ── Widget binding ────────────────────────────────────────── */

function bindCalendarEvents(): void {
  // Day selection (both month and week views)
  document.querySelectorAll('[data-cal-day]').forEach(el => {
    el.addEventListener('click', () => {
      const dayNum = parseInt(el.getAttribute('data-cal-day') || '1');
      const month = el.getAttribute('data-cal-month');
      const year = el.getAttribute('data-cal-year');

      if (month !== null && year !== null) {
        // Week view: day has explicit month/year
        calState.selectedDate = new Date(parseInt(year), parseInt(month), dayNum);
        calState.viewMonth = parseInt(month);
        calState.viewYear = parseInt(year);
      } else {
        // Month view: use current view month
        calState.selectedDate = new Date(calState.viewYear, calState.viewMonth, dayNum);
      }
      rerenderCalendar();
    });
  });

  // Navigation
  document.querySelectorAll('[data-cal-action]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = el.getAttribute('data-cal-action');
      switch (action) {
        case 'prev-month':
          calState.viewMonth--;
          if (calState.viewMonth < 0) { calState.viewMonth = 11; calState.viewYear--; }
          calState.selectedDate = new Date(calState.viewYear, calState.viewMonth, 1);
          break;
        case 'next-month':
          calState.viewMonth++;
          if (calState.viewMonth > 11) { calState.viewMonth = 0; calState.viewYear++; }
          calState.selectedDate = new Date(calState.viewYear, calState.viewMonth, 1);
          break;
        case 'prev-week': {
          const d = new Date(calState.selectedDate);
          d.setDate(d.getDate() - 7);
          calState.selectedDate = d;
          calState.viewMonth = d.getMonth();
          calState.viewYear = d.getFullYear();
          break;
        }
        case 'next-week': {
          const d = new Date(calState.selectedDate);
          d.setDate(d.getDate() + 7);
          calState.selectedDate = d;
          calState.viewMonth = d.getMonth();
          calState.viewYear = d.getFullYear();
          break;
        }
        case 'add-event':
          showAddEventModal();
          return;
      }
      rerenderCalendar();
    });
  });
}

function showAddEventModal(): void {
  document.getElementById('opal-add-event-modal')?.remove();

  const dateObj = calState.selectedDate;
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const yyyy = dateObj.getFullYear();
  const defaultDateStr = `${yyyy}-${mm}-${dd}`;

  // Round up to the next quarter hour; 13:50 becomes 14:00, not "13:60".
  const roundedMinutes = Math.min(23 * 60 + 45, Math.ceil((dateObj.getHours() * 60 + dateObj.getMinutes()) / 15) * 15);
  const defaultStartTimeStr = `${String(Math.floor(roundedMinutes / 60)).padStart(2, '0')}:${String(roundedMinutes % 60).padStart(2, '0')}`;

  const overlay = document.createElement('div');
  overlay.id = 'opal-add-event-modal';
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="widget-settings-modal" role="dialog" aria-modal="true" aria-labelledby="add-evt-heading">
      <div class="settings-modal-header">
        <h2 id="add-evt-heading" class="settings-modal-title">${t('calendarNewEvent')}</h2>
        <button type="button" id="add-evt-close" class="settings-close-btn" aria-label="${t('sharedClose')}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="settings-modal-body">
        <div class="settings-field">
          <label for="add-evt-title" class="settings-field-label">${t('calendarEventTitle')}</label>
          <input type="text" id="add-evt-title" class="settings-number-input" required />
        </div>

        <div class="settings-field">
          <label for="add-evt-date" class="settings-field-label">${t('calendarDate')}</label>
          <input type="date" id="add-evt-date" class="settings-number-input" value="${defaultDateStr}" required />
        </div>

        <div class="settings-field flex gap-3">
          <div class="flex-1 min-w-0">
            <label for="add-evt-start" class="settings-field-label">${t('calendarFrom')}</label>
            <input type="time" id="add-evt-start" class="settings-number-input" value="${defaultStartTimeStr}" required />
          </div>
          <div class="flex-1 min-w-0">
            <label for="add-evt-end" class="settings-field-label">${t('calendarUntil')}</label>
            <input type="time" id="add-evt-end" class="settings-number-input" />
          </div>
        </div>

        <div class="settings-field">
          <label for="add-evt-location" class="settings-field-label">${t('calendarLocation')}</label>
          <input type="text" id="add-evt-location" class="settings-number-input" />
        </div>

        <div class="settings-field">
          <div class="settings-switch-list">${switchRow({ id: 'add-evt-deadline', label: t('calendarMarkDeadline'), description: t('calendarMarkDeadlineHint'), checked: false })}</div>
        </div>
      </div>

      <div class="settings-modal-footer">
        <button type="button" id="add-evt-cancel" class="opal-btn">${t('sharedCancel')}</button>
        <button type="button" id="add-evt-save" class="opal-btn opal-btn-primary">${t('sharedSave')}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  openSurface(overlay);

  const addButton = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('#opal-modern-ui [data-cal-action="add-event"]');

  let releaseFocus: ReturnType<typeof bindDialogKeyboard> | null = null;
  const close = () => {
    void closeSurface(overlay, () => releaseFocus?.(addButton));
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelector('#add-evt-cancel')?.addEventListener('click', close);
  overlay.querySelector('#add-evt-close')?.addEventListener('click', close);
  releaseFocus = bindDialogKeyboard(overlay, close, overlay.querySelector<HTMLElement>('#add-evt-title'));

  overlay.querySelector('#add-evt-save')?.addEventListener('click', async () => {
    const title = (document.getElementById('add-evt-title') as HTMLInputElement).value.trim();
    const date = (document.getElementById('add-evt-date') as HTMLInputElement).value;
    const start = (document.getElementById('add-evt-start') as HTMLInputElement).value;
    let end = (document.getElementById('add-evt-end') as HTMLInputElement).value;
    const location = (document.getElementById('add-evt-location') as HTMLInputElement).value.trim();
    const isDeadline = (document.getElementById('add-evt-deadline') as HTMLInputElement).checked;

    if (!title || !date || !start) {
      alert(t('calendarRequiredFields'));
      return;
    }

    if (!end) end = start;

    const startIso = new Date(`${date}T${start}:00`).toISOString();
    const endIso = new Date(`${date}T${end}:00`).toISOString();

    await addCustomEvent({
      title,
      start: startIso,
      end: endIso,
      location: location || undefined,
      isDeadline: isDeadline || undefined,
    });

    close();
    // The calendar re-renders, which replaces the add button; put focus back on the new one.
    refreshCalendarEvents().then(() => addButton()?.focus());
  });
}

function rerenderCalendar(): void {
  const container = document.querySelector('.cal-container');
  if (!container) return;
  const parent = container.parentElement;
  if (!parent) return;

  const html = calState.widgetH >= 5
    ? buildMonthView(calState)
    : buildWeekView(calState);

  parent.innerHTML = html;
  bindCalendarEvents();
}

/* ── Load events once ──────────────────────────────────────── */

async function ensureEventsLoaded(): Promise<void> {
  if (eventsLoaded) return;
  calState.events = await loadCalendarEvents();
  eventsLoaded = true;
}

/* ── Widget export ─────────────────────────────────────────── */

export const calendarWidget: Widget<CalendarData> = {
  id: 'calendar',
  opalPortletOrder: 'Calendar',
  requires: null,
  get title() { return t('calendarTitle'); },
  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  defaultW: 4,
  defaultH: 5,
  hasNativeConfig: true, // We intercept this in main.ts for our own calendar settings

  scrape() {
    // Scrape OPAL native events text
    const portlet = document.querySelector(
      'div[data-portlet-order="Calendar"] section.panel.portlet.calendar'
    );
    const text = portlet?.querySelector('.panel-content')?.textContent?.trim() || '';
    return { text };
  },

  render(_data: CalendarData, widgetH?: number): string {
    if (widgetH !== undefined) {
      calState.widgetH = widgetH;
    }

    // Kick off async load (will rerender when ready)
    if (!eventsLoaded) {
      ensureEventsLoaded().then(() => rerenderCalendar());
    }

    const html = calState.widgetH >= 5
      ? buildMonthView(calState)
      : buildWeekView(calState);

    // Schedule event binding after DOM insertion
    setTimeout(() => bindCalendarEvents(), 50);

    return html;
  },
};

/** Allow external code to trigger event refresh (after import) */
export async function refreshCalendarEvents(): Promise<void> {
  calState.events = await loadCalendarEvents();
  rerenderCalendar();
}

/** Update calendar view when widget is resized */
export function updateCalendarHeight(newH: number): void {
  calState.widgetH = newH;
  rerenderCalendar();
}

/** Expose loaded events synchronously for cross-widget operations (e.g. sorting favorites) */
export function getLoadedEvents(): CalendarEvent[] {
  return calState.events;
}
