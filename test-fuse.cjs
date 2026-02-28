const Fuse = require('fuse.js');

const courses = [
    { moduleCode: 'MW-MB-09', title: 'TECHNISCHE MECHANIK - FESTIGKEITSLEHRE 2 WS25/26 - MW-MB-09' }
];

const fuse = new Fuse(courses, {
    keys: [
        { name: 'moduleCode', weight: 3 },
        { name: 'title', weight: 1 },
    ],
    threshold: 0.7, // loosest setting (1 - 30% = 0.7)
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 3,
});

const result = fuse.search('Teschniche Mechanik 2 Festigkeitslehre');
console.log(JSON.stringify(result, null, 2));
