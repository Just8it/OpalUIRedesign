import { neuigkeitenWidget } from './neuigkeiten';
import { whatsNewWidget } from './whats-new';
/* ━━ Widget Registry ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types.ts';

import { favoritesWidget } from './favorites';
import { coursesWidget } from './courses';
import { calendarWidget } from './calendar';
import { performanceWidget } from './performance';
import { quickaccessWidget } from './quickaccess';
import { statsWidget } from './stats';
import { institutionWidget } from './institution';
import { groupsWidget } from './groups';
import { recentWidget } from './recent';
import { toolboxWidget } from './toolbox';
import { mensaWidget } from './mensa';
import { deadlineWidget } from './deadline';

/** All available widgets, keyed by id */
export const WIDGETS: Map<string, Widget<any>> = new Map<string, Widget<any>>([
    [neuigkeitenWidget.id, neuigkeitenWidget],
    [whatsNewWidget.id, whatsNewWidget],
    [favoritesWidget.id, favoritesWidget],
    [coursesWidget.id, coursesWidget],
    [calendarWidget.id, calendarWidget],
    [performanceWidget.id, performanceWidget],
    [quickaccessWidget.id, quickaccessWidget],
    [statsWidget.id, statsWidget],
    [institutionWidget.id, institutionWidget],
    [groupsWidget.id, groupsWidget],
    [recentWidget.id, recentWidget],
    [toolboxWidget.id, toolboxWidget],
    [mensaWidget.id, mensaWidget],
    [deadlineWidget.id, deadlineWidget],
]);
