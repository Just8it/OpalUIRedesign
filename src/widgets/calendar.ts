/* ━━ Calendar Widget ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Real calendar with month/week views, ICS events, OPAL events.
 * View switches based on widget HEIGHT:
 *   h >= 5  →  Month view (full month grid + day detail)
 *   h <  5  →  Week view (7-day strip + event list)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';
import { escapeHtml } from '../utils';
import {
  type CalendarEvent,
  loadCalendarEvents,
  expandRecurring,
  getEventsForDay,
  getEventsForMonth,
  getWeekStart,
} from '../calendar-store';

/* ── Types ─────────────────────────────────────────────────── */

interface CalendarState {
  events: CalendarEvent[];
  selectedDate: Date;
  viewMonth: number;   // 0-11
  viewYear: number;
  widgetH: number;     // grid height units
}

/* ── Module state ──────────────────────────────────────────── */

let calState: CalendarState = {
  events: [],
  selectedDate: new Date(),
  viewMonth: new Date().getMonth(),
  viewYear: new Date().getFullYear(),
  widgetH: 3,
};

let eventsLoaded = false;

/* ── Event colors ──────────────────────────────────────────── */

const EVENT_COLORS = [
  '#6264f4', '#f472b6', '#34d399', '#fbbf24', '#60a5fa',
  '#a78bfa', '#f87171', '#2dd4bf', '#fb923c', '#818cf8',
];

function getEventColor(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash) + title.charCodeAt(i);
  }
  return EVENT_COLORS[Math.abs(hash) % EVENT_COLORS.length];
}

/* ── Time formatting ───────────────────────────────────────── */

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatDuration(start: string, end: string): string {
  return `${formatTime(start)}–${formatTime(end)}`;
}

/* ── Month names ───────────────────────────────────────────── */

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

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
  monthEvents.forEach(ev => {
    const d = new Date(ev.start);
    if (d.getMonth() === viewMonth) eventDays.add(d.getDate());
  });

  // Calendar grid setup
  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // Monday=0
  const daysInMonth = lastDay.getDate();

  // Day headers
  const headers = DAY_LABELS.map(d =>
    `<div class="cal-day-header">${d}</div>`
  ).join('');

  // Day cells
  const cells: string[] = [];
  // Leading empty cells
  for (let i = 0; i < startDow; i++) {
    cells.push('<div class="cal-day cal-day-empty"></div>');
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

    const dots = hasEvents ? '<div class="cal-event-dot-container"><span class="cal-event-dot"></span></div>' : '';

    cells.push(`<div class="${classes}" data-cal-day="${d}">${d}${dots}</div>`);
  }

  // Events for selected day
  const selectedDayEvents = getEventsForDay(
    expandRecurring(events, new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()),
      new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 23, 59, 59)),
    selectedDate
  );

  const eventList = selectedDayEvents.length > 0
    ? selectedDayEvents.slice(0, 5).map(ev => {
      const color = ev.color || getEventColor(ev.title);
      return `
        <div class="cal-event-item">
          <div class="cal-event-color" style="background:${color}"></div>
          <div class="cal-event-info">
            <span class="cal-event-time">${formatDuration(ev.start, ev.end)}</span>
            <span class="cal-event-title">${escapeHtml(ev.title)}</span>
            ${ev.location ? `<span class="cal-event-location">📍 ${escapeHtml(ev.location)}</span>` : ''}
          </div>
        </div>`;
    }).join('')
    : `<p class="text-xs text-slate-500 py-2">Keine Termine am ${selectedDate.getDate()}. ${MONTH_NAMES[selectedDate.getMonth()]}</p>`;

  return `
    <div class="cal-container cal-month-view">
      <div class="cal-nav">
        <button class="cal-nav-btn" data-cal-action="prev-month">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span class="cal-nav-title">${MONTH_NAMES[viewMonth]} ${viewYear}</span>
        <button class="cal-nav-btn" data-cal-action="next-month">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div class="cal-month-grid">
        ${headers}
        ${cells.join('')}
      </div>
      <div class="cal-day-events">
        ${eventList}
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
  const dayStrip = DAY_LABELS.map((label, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
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

    return `<div class="${classes}" data-cal-day="${d.getDate()}" data-cal-month="${d.getMonth()}" data-cal-year="${d.getFullYear()}">
      <span class="cal-week-label">${label}</span>
      <span class="cal-week-date">${d.getDate()}</span>
      ${hasEvents ? '<span class="cal-event-dot"></span>' : ''}
    </div>`;
  }).join('');

  // Today's events
  const todayEvents = getEventsForDay(expanded, selectedDate);
  const eventList = todayEvents.length > 0
    ? todayEvents.slice(0, 4).map(ev => {
      const color = ev.color || getEventColor(ev.title);
      return `
        <div class="cal-event-item">
          <div class="cal-event-color" style="background:${color}"></div>
          <div class="cal-event-info">
            <span class="cal-event-time">${formatDuration(ev.start, ev.end)}</span>
            <span class="cal-event-title">${escapeHtml(ev.title)}</span>
            ${ev.location ? `<span class="cal-event-location">📍 ${escapeHtml(ev.location)}</span>` : ''}
          </div>
        </div>`;
    }).join('')
    : '<p class="text-xs text-slate-500 py-1">Keine Termine heute.</p>';

  // Week navigation
  const prevWeek = new Date(weekStart);
  prevWeek.setDate(prevWeek.getDate() - 7);
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const monthLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? MONTH_NAMES[weekStart.getMonth()]
    : `${MONTH_NAMES[weekStart.getMonth()].slice(0, 3)}–${MONTH_NAMES[weekEnd.getMonth()].slice(0, 3)}`;

  return `
    <div class="cal-container cal-week-view">
      <div class="cal-nav">
        <button class="cal-nav-btn" data-cal-action="prev-week">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span class="cal-nav-title">${monthLabel} ${weekStart.getFullYear()}</span>
        <button class="cal-nav-btn" data-cal-action="next-week">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div class="cal-week-strip">${dayStrip}</div>
      <div class="cal-day-events">${eventList}</div>
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
      }
      rerenderCalendar();
    });
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

export const calendarWidget: Widget = {
  id: 'calendar',
  opalPortletOrder: 'Calendar',
  title: 'Meine Termine',
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

  render(data: unknown, widgetH?: number): string {
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
