/* ━━ Widget System Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** A single dashboard widget definition */
export interface Widget {
    /** Unique ID (e.g. 'favorites', 'calendar') */
    id: string;
    /** Maps to OPAL's data-portlet-order attribute.
     *  Use a string[] when a widget aggregates multiple portlets. */
    opalPortletOrder: string | string[];
    /** Display title */
    title: string;
    /** SVG icon string for the widget header */
    icon: string;
    /** Default grid dimensions { w: columns, h: rows } */
    defaultW: number;
    defaultH: number;
    /** Optional minimum grid size (overrides the global gs-min-w/gs-min-h=2) */
    minW?: number;
    minH?: number;
    /** Whether this widget has native OPAL config (Konfigurieren menu item) */
    hasNativeConfig: boolean;
    /** Whether this widget has its own custom settings modal (non-OPAL) */
    hasSettings?: boolean;
    /** Scrape data from the hidden OPAL DOM. Returns widget-specific data. */
    scrape: () => unknown;
    /** Render widget content HTML from scraped data. widgetH/widgetW are grid units for responsive views. */
    render: (data: unknown, widgetH?: number, widgetW?: number) => string;
}

/** One entry in the persisted layout array (GridStack coordinates) */
export interface LayoutEntry {
    widgetId: string;
    x: number;
    y: number;
    w: number;
    h: number;
    hidden: boolean;
}

/** Full dashboard state */
export interface DashboardState {
    layout: LayoutEntry[];
    editMode: boolean;
}

/** User info scraped from OPAL header */
export interface UserInfo {
    name: string;
}

/** A favorite / bookmark course */
export interface CourseItem {
    title: string;
    href: string;
    type: 'course' | 'enrolled';
    moduleCode: string | null;
}

/** Calendar data scraped from OPAL (minimal, real events in calendar-store) */
export interface CalendarData {
    text: string;
}

/** News data */
export interface NewsData {
    hasNews: boolean;
    text: string;
}

/** Efficiency / performance data */
export interface EfficiencyData {
    hasData: boolean;
    text: string;
}
