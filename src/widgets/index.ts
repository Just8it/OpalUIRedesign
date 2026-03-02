/* ━━ Widget Registry ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';

import { favoritesWidget } from './favorites';
import { coursesWidget } from './courses';
import { calendarWidget } from './calendar';
import { newsWidget } from './news';
import { performanceWidget } from './performance';
import { quickaccessWidget } from './quickaccess';
import { statsWidget } from './stats';
import { institutionWidget } from './institution';
import { groupsWidget } from './groups';
import { recentWidget } from './recent';
import { aktuellesWidget } from './aktuelles';
import { toolboxWidget } from './toolbox';
import { mensaWidget } from './mensa';
import { deadlineWidget } from './deadline';
import { announcementsWidget } from './announcements';

/** All available widgets, keyed by id */
export const WIDGETS: Map<string, Widget> = new Map([
    [favoritesWidget.id, favoritesWidget],
    [coursesWidget.id, coursesWidget],
    [calendarWidget.id, calendarWidget],
    [newsWidget.id, newsWidget],
    [performanceWidget.id, performanceWidget],
    [quickaccessWidget.id, quickaccessWidget],
    [statsWidget.id, statsWidget],
    [institutionWidget.id, institutionWidget],
    [groupsWidget.id, groupsWidget],
    [recentWidget.id, recentWidget],
    [aktuellesWidget.id, aktuellesWidget],
    [toolboxWidget.id, toolboxWidget],
    [mensaWidget.id, mensaWidget],
    [deadlineWidget.id, deadlineWidget],
    [announcementsWidget.id, announcementsWidget],
]);
