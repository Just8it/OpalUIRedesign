import type { CourseEntry, CourseSection } from '../types.ts';
import type { EntryCategory } from './types.ts';
import { tokenize } from '../../core/search/tokenizer.ts';

export const KEYWORDS = {
    solution: ['loesung', 'loesungen', 'lsg', 'musterloesung', 'solution', 'solutions'],
    exam: ['klausur', 'probeklausur', 'pruefung', 'altklausur', 'exam', 'exams', 'formelsammlung', 'formelblatt'],
    lecture: ['vorlesung', 'vl', 'folien', 'skript', 'kapitel', 'lecture', 'slides', 'week', 'v'],
    exercise: ['uebung', 'uebungen', 'ue', 'aufgabe', 'aufgaben', 'aufgabenstellung', 'blatt', 'uebungsblatt', 'serie', 'exercise', 'sheet', 'praktikum', 'praktikumsunterlagen', 'versuch', 'anleitung'],
} as const;

export function classify(entry: CourseEntry, section: CourseSection): EntryCategory {
    if (entry.kind === 'video' || /(?:^|\/\/)(?:[^/]+\.)?(?:videocampus\.sachsen\.de|youtube\.com|youtu\.be|vimeo\.com)(?:\/|$)/i.test(entry.url)) return 'video';
    const code = /^(m|py|zip)$/i.test(entry.extension ?? entry.fileName?.split('.').pop() ?? entry.title.split('.').pop() ?? '');
    for (const text of [entry.title + ' ' + (entry.fileName ?? ''), entry.folderPath.join(' '), section.title + ' ' + section.path.join(' ')]) {
        const tokens = tokenize(text).flatMap(t => t.match(/^([a-z]+)(\d+)$/)?.slice(1) ?? [t]);
        for (const category of ['solution', 'exam', 'lecture', 'exercise'] as const) {
            if (KEYWORDS[category].some(word => tokens.includes(word) && !(word === 'skript' && code) && !(word === 'v' && !/(?:^|_)v\d+/i.test(text)))) return category;
        }
        if (code && tokens.includes('skript')) return 'other';
    }
    return 'other';
}
