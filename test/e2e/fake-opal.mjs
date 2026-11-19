// Fake bildungsportal.sachsen.de for the e2e smoke test.
// Every request the browser makes is routed here (CDP Fetch interception,
// see smoke.mjs); nothing reaches the network. resolve() returns either a
// response ({status, headers, body}) or {block: true} for hosts we refuse.
//
// Site map (everything else on the OPAL host is a 404):
//   /opal, /opal/, /opal/home*            saved start page from the repo root
//   /opal/<saved>_files/<file>            its saved assets
//   /opal/auth|url/RepositoryEntry/<COURSE_ID>[/CourseNode/<root>]   course page sample
//   /opal/auth/RepositoryEntry/<COURSE_ID>/CourseNode/<id>           course page with a node fragment
//   .../CourseNode/<folder id>/<sub path>  subfolder listing / file
//   /opal/FolderResource/<id>/<x>.html     single-page frame; other files -> tiny PDF/text
//   api.studentenwerk-dresden.de/*         canteen API stub ([] or {})

import fs from 'node:fs';
import path from 'node:path';

export const OPAL_HOST = 'bildungsportal.sachsen.de';
export const START_URL = 'https://bildungsportal.sachsen.de/opal/home';
export const COURSE_ID = '10968662020';
export const COURSE_ROOT_NODE = '84033834447509';
export const COURSE_URL = `https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/${COURSE_ID}`;
export const COURSE_TITLE = 'Aerodynamik';

const START_PAGE = 'Startseite - OPAL mit offenen settings.htm';
const START_ASSETS = 'Startseite - OPAL mit offenen settings_files';
const SAMPLE_COURSE_ID = '11882725376';
const SAMPLE_FOLDER_NODE = '102757417912416';

// Node id -> fragment file in the course samples directory (tree of the Aerodynamik sample).
const NODE_FRAGMENTS = {
    '93401302402327': 'node-enrolment.content.html',
    '1633660519425609008': 'node-enrolment.content.html',
    '1756953390444593003': 'node-announcements.content.html',
    '1759372552148696005': 'node-singlepage.content.html',
    '93229881622260': 'node-structure.content.html',
    '93229881733044': 'node-folder-with-subfolders.content.html', // Vorlesung (links to Kapitel subfolders)
    '94396602896432': 'node-folder-files.content.html',           // Übung
    '93401300636833': 'node-folder-files.content.html',           // Praktikum Xfoil
    '93395536073414': 'node-folder-files.content.html',           // Zusatzmaterial
    '102602285947109': 'node-structure.content.html',
    '102641243827774': 'node-singlepage.content.html',
    '93357136977786': 'node-literature.content.html',
    '1698114595871399006': 'node-singlepage.content.html',
    '93389956003767': 'node-singlepage.content.html',
};
const FOLDER_NODES = new Set(['93229881733044', '94396602896432', '93401300636833', '93395536073414']);

// Smallest valid one-page PDF.
const TINY_PDF = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

const MIME = {
    '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'application/javascript',
    '.css': 'text/css', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function html(body, status = 200) {
    return { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: Buffer.from(body, 'utf8') };
}
function notFound(what = 'Not found') {
    return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from(what) };
}

/** Index of the matching </div> for the <div ...> starting at `start`. */
function matchingDivEnd(src, start) {
    const re = /<div\b|<\/div>/gi;
    re.lastIndex = start;
    let depth = 0, m;
    while ((m = re.exec(src))) {
        depth += m[0][1] === '/' ? -1 : 1;
        if (depth === 0) return m.index + m[0].length;
    }
    return -1;
}

export function createFakeOpal({ repoRoot, samplesDir, startPagePath = path.join(repoRoot, START_PAGE) }) {
    const log = [];
    const counters = { served: 0, notFound: 0, blocked: 0 };
    const hasSamples = !!samplesDir && fs.existsSync(path.join(samplesDir, 'course-root-full-page.html'));
    const read = f => fs.readFileSync(path.join(samplesDir, f), 'utf8');
    const startPage = fs.readFileSync(startPagePath);
    const coursePage = hasSamples ? read('course-root-full-page.html') : null;

    function courseShell(fragment, title) {
        const open = coursePage.indexOf('<div class="content-container');
        const end = open >= 0 ? matchingDivEnd(coursePage, open) : -1;
        let page = end > 0 ? coursePage.slice(0, open) + fragment + coursePage.slice(end) : coursePage;
        if (title) page = page.replace(/<title([^>]*)>[^<]*<\/title>/, `<title$1>${title} - OPAL</title>`);
        return page;
    }

    function nodePage(nodeId, rest) {
        const nodeBase = `/opal/auth/RepositoryEntry/${COURSE_ID}/CourseNode/${nodeId}`;
        const file = NODE_FRAGMENTS[nodeId];
        if (!file) return notFound('unknown course node');
        if (rest) {
            // Inside a folder node: a sub path with an extension is a file, else a subfolder listing.
            if (!FOLDER_NODES.has(nodeId)) return notFound();
            if (/\.[a-z0-9]{2,5}$/i.test(rest)) return fileResponse(rest);
            const subBase = `${nodeBase}/${rest}`;
            const frag = read('node-folder-files.content.html')
                .replaceAll(`/opal/auth/RepositoryEntry/${SAMPLE_COURSE_ID}/CourseNode/${SAMPLE_FOLDER_NODE}`, subBase);
            return html(courseShell(frag));
        }
        let frag = read(file);
        if (file === 'node-folder-files.content.html') {
            frag = frag.replaceAll(`/opal/auth/RepositoryEntry/${SAMPLE_COURSE_ID}/CourseNode/${SAMPLE_FOLDER_NODE}`, nodeBase);
        }
        // Make every in-course node link point at this course.
        frag = frag.replace(/\/opal\/auth\/RepositoryEntry\/\d+\/CourseNode\//g, `/opal/auth/RepositoryEntry/${COURSE_ID}/CourseNode/`);
        return html(courseShell(frag));
    }

    function fileResponse(name) {
        const ext = path.extname(decodeURIComponent(name)).toLowerCase();
        if (ext === '.pdf') return { status: 200, headers: { 'Content-Type': 'application/pdf' }, body: TINY_PDF };
        return { status: 200, headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('fake file ' + name) };
    }

    function opal(u) {
        const p = u.pathname;
        if (p === '/opal' || p === '/opal/' || p.startsWith('/opal/home')) {
            // Wicket ajax / HEAD keep-alive calls carry a query; answer them with an empty page.
            if (u.search && /ajax|wicket|-\d+\./i.test(u.search)) return html('<ajax-response></ajax-response>');
            return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: startPage };
        }
        const decoded = decodeURIComponent(p);
        if (decoded.startsWith(`/opal/${START_ASSETS}/`)) {
            const f = path.join(repoRoot, START_ASSETS, path.basename(decoded));
            if (fs.existsSync(f)) return { status: 200, headers: { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }, body: fs.readFileSync(f) };
            return notFound();
        }
        if (!hasSamples) return notFound('no course samples');
        const m = /^\/opal\/(?:auth|url)\/RepositoryEntry\/(\d+)(?:\/CourseNode\/(\d+))?(?:\/(.+))?\/?$/.exec(p);
        if (m) {
            const [, courseId, nodeId, rest] = m;
            if (courseId !== COURSE_ID) return notFound('unknown course');
            if (u.search && /-\d+\./.test(u.search)) return html('<ajax-response></ajax-response>');
            if (!nodeId || (nodeId === COURSE_ROOT_NODE && !rest)) return html(coursePage);
            return nodePage(nodeId, rest ? decodeURIComponent(rest) : '');
        }
        const fr = /^\/opal\/FolderResource\/(\d+)\/(.+)$/.exec(p);
        if (fr) {
            if (/\.html?$/i.test(fr[2])) return html(read('node-singlepage.frame.html'));
            return fileResponse(fr[2]);
        }
        return notFound();
    }

    function resolve(url, method = 'GET') {
        let u;
        try { u = new URL(url); } catch { counters.blocked++; return { block: true }; }
        let res;
        if (u.hostname === OPAL_HOST && u.protocol === 'https:') {
            res = opal(u);
        } else if (u.hostname === 'api.studentenwerk-dresden.de') {
            const body = /\/canteens\/?$/.test(u.pathname) ? '[]' : /\/meals/.test(u.pathname) ? '[]' : '{}';
            res = { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: Buffer.from(body) };
        } else {
            counters.blocked++;
            log.push({ url, method, result: 'blocked' });
            return { block: true };
        }
        if (res.status === 404) counters.notFound++; else counters.served++;
        log.push({ url, method, result: res.status });
        return res;
    }

    return { resolve, log, counters, hasSamples };
}
